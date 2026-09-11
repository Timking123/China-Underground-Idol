import { resolve } from "node:path";
import {
  applyActivityRun,
  archiveImport,
  collectPublicRun,
  readStageFile,
  validateCaptureImport,
  type CaptureImport,
} from "../src/pipeline.ts";
import {
  createPipelineStore,
  type PipelineStore,
} from "../src/pipelineStore.ts";
import {
  encode,
  isTimestamp,
  sha256,
  type SourceCapture,
} from "../src/sourceCapture.ts";
import {
  requireState,
  validateSourceRegistry,
  type RegisteredSource,
  type SourceRegistry,
} from "../src/sourceRegistry.ts";
import type { CandidateSnapshot } from "../src/eventCandidates.ts";
import type { EventUpdateDraft } from "../src/eventApplication.ts";
import type { EventRecord } from "../../site/src/events/model.ts";
import { buildAggregationDiscoveries } from "../src/eventDiscovery.ts";
import {
  pendingApplicationIntents,
  readDiscoveryBindings,
  retainAggregationSnapshot,
  saveApplicationIntent,
  saveDiscoveryBindings,
} from "./discoveryBootstrap.ts";
import {
  evaluateEventPolicy,
  type EventTimeChange,
  type PolicyEvent,
  type PolicyEventFields,
  type ReviewedEventBinding,
} from "./eventPolicy.ts";

export interface DailyOptions {
  stageRoot: string;
  stateRoot: string;
  profileRoot: string;
  now?: Date;
}
export interface DailyIncident {
  code: string;
  source: string;
  action: string;
}
export interface DailySourceResult {
  source: string;
  status: "complete" | "failed";
  reused: boolean;
  runId: string | null;
  observedAt: string[];
  reviewCount: number;
}
export interface DailyResult {
  changed: boolean;
  incidents: DailyIncident[];
  sources: DailySourceResult[];
  /** 本次新增人工项数量；零不表示历史待复核事项已经解决。 */
  reviewCount: number;
  discovery?: ReturnType<typeof buildAggregationDiscoveries>["summary"];
}
interface DailyCollectors {
  browser: (
    source: RegisteredSource,
    profileRoot: string,
  ) => Promise<{
    capture: SourceCapture;
    proof: CaptureImport["proofs"][number];
  }>;
  http: typeof collectPublicRun;
}
interface HistoricalRun {
  runId: string;
  input: CaptureImport;
}
interface SourceReceipt extends DailySourceResult {
  schemaVersion: "server-daily-source-v1";
  day: string;
  registrySha256: string;
  captureIds: string[];
  failureCode?: string;
}
const FIELDS = [
  "title",
  "date",
  "province",
  "city",
  "venue",
  "address",
  "opensAt",
  "startsAt",
  "endsAt",
  "status",
  "performers",
] as const;
const parse = (bytes: Uint8Array): unknown =>
  JSON.parse(Buffer.from(bytes).toString("utf8"));
const dayOf = (date: Date): string =>
  new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const sourceKey = (capture: SourceCapture): string =>
  encode([capture.registryId, capture.source.sourceUrl]);
const contentKey = (capture: SourceCapture): string =>
  sha256(
    encode({
      body: capture.source.bodySha256,
      hrefs: capture.links
        .filter((link) => link.href.trim())
        .map((link) => link.href),
    }),
  );
const failureCode = (error: unknown): string => {
  const code =
    error instanceof Error
      ? "code" in error
        ? String(error.code)
        : error.message
      : "";
  return /^[a-zA-Z][a-zA-Z0-9_:-]{0,140}$/u.test(code)
    ? code
    : "daily_source_failed";
};

async function optional(
  store: PipelineStore,
  path: string,
): Promise<Buffer | null> {
  try {
    return await store.readRegular(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
async function immutable(
  store: PipelineStore,
  path: string,
  value: unknown,
): Promise<void> {
  await store.withStoreLock("daily-state", () =>
    store.putImmutable(path, Buffer.from(encode(value))),
  );
}
async function importFromRun(
  store: PipelineStore,
  runId: string,
  registry: SourceRegistry,
  now: Date,
): Promise<CaptureImport> {
  const run = await store.readRun("activities", runId);
  requireState(run.status === "complete", "daily_activity_run_not_complete");
  const captures = parse(run.files["captures.json"]) as SourceCapture[];
  return validateCaptureImport(
    {
      schemaVersion: "idol-capture-import-v1",
      captures,
      proofs: captures.map((capture) => {
        const bytes = run.files[`proofs/${capture.captureId}.json`];
        requireState(bytes, "daily_capture_proof_missing");
        return {
          captureId: capture.captureId,
          sha256: sha256(bytes),
          bytesBase64: bytes.toString("base64"),
        };
      }),
      snapshots: parse(run.files["snapshots.json"]),
      mappings: parse(run.files["mappings.json"]),
    },
    registry,
    now,
  );
}
async function historyOf(
  store: PipelineStore,
  registry: SourceRegistry,
  now: Date,
): Promise<HistoricalRun[]> {
  const result: HistoricalRun[] = [];
  for (const run of await store.listRuns("activities")) {
    requireState(
      run.status === "complete",
      "daily_history_incomplete_requires_review",
    );
    result.push({
      runId: run.runId,
      input: await importFromRun(store, run.runId, registry, now),
    });
  }
  return result;
}
function latestCaptures(
  history: HistoricalRun[],
  sourceId: string,
  excludeIds: string[] = [],
): SourceCapture[] {
  const latest = new Map<string, SourceCapture>();
  for (const run of history)
    for (const capture of run.input.captures) {
      if (
        capture.registryId !== sourceId ||
        excludeIds.includes(capture.captureId)
      )
        continue;
      const key = sourceKey(capture),
        previous = latest.get(key);
      if (
        !previous ||
        Date.parse(previous.source.observedAt) <
          Date.parse(capture.source.observedAt)
      )
        latest.set(key, capture);
      else if (previous.source.observedAt === capture.source.observedAt)
        requireState(
          contentKey(previous) === contentKey(capture),
          "daily_history_equal_time_conflict",
        );
    }
  return [...latest.values()];
}
function matchingSnapshot(
  history: HistoricalRun[],
  capture: SourceCapture,
): CandidateSnapshot | undefined {
  return history
    .flatMap((run) => run.input.snapshots)
    .filter(
      (snapshot) =>
        snapshot.source.sourceId === capture.source.sourceId &&
        snapshot.source.sourceUrl === capture.source.sourceUrl &&
        snapshot.source.bodySha256 === capture.source.bodySha256 &&
        Date.parse(snapshot.source.observedAt) <=
          Date.parse(capture.source.observedAt),
    )
    .sort(
      (a, b) =>
        Date.parse(b.source.observedAt) - Date.parse(a.source.observedAt),
    )[0];
}
function bindingsFor(
  history: HistoricalRun[],
  previous: SourceCapture[],
  events: PolicyEvent[],
): ReviewedEventBinding[] {
  const mappings = history.flatMap((run) => run.input.mappings);
  return previous.flatMap((capture) => {
    const owners = events.filter((event) =>
      event.sources.some((source) => source.url === capture.source.sourceUrl),
    );
    if (
      owners.length !== 1 ||
      events.filter((event) => event.id === owners[0].id).length !== 1
    )
      return [];
    const snapshot = matchingSnapshot(history, capture);
    const items =
      snapshot?.items.filter(
        (item) =>
          item.originalUrlIsUnique === true &&
          item.originalEventUrl === capture.source.sourceUrl &&
          item.sourceItemKey?.trim(),
      ) ?? [];
    if (items.length !== 1) return [];
    const item = items[0];
    const mappedIds = [
      ...new Set(
        mappings
          .filter(
            (mapping) =>
              "sourceId" in mapping &&
              mapping.sourceId === capture.source.sourceId &&
              mapping.sourceItemKey === item.sourceItemKey,
          )
          .map((mapping) => mapping.eventId),
      ),
    ];
    if (
      mappedIds.length !== 1 ||
      mappedIds[0] !== owners[0].id ||
      FIELDS.some((field) => item.fields[field] === undefined)
    )
      return [];
    return [
      {
        eventId: owners[0].id,
        registryId: capture.registryId,
        sourceUrl: capture.source.sourceUrl,
        sourceItemKey: item.sourceItemKey!,
        previousCaptureId: capture.captureId,
        previousFields: Object.fromEntries(
          FIELDS.map((field) => [field, item.fields[field]]),
        ) as unknown as PolicyEventFields,
      },
    ];
  });
}
function sourceImport(input: CaptureImport, sourceId: string): CaptureImport {
  const captures = input.captures.filter(
    (capture) => capture.registryId === sourceId,
  );
  return {
    schemaVersion: "idol-capture-import-v1",
    captures,
    proofs: input.proofs.filter((proof) =>
      captures.some((capture) => capture.captureId === proof.captureId),
    ),
    snapshots: input.snapshots.filter((snapshot) =>
      captures.some(
        (capture) => capture.source.sourceId === snapshot.source.sourceId,
      ),
    ),
    mappings: input.mappings,
  };
}
function existingToday(
  history: HistoricalRun[],
  source: RegisteredSource,
  day: string,
): HistoricalRun | undefined {
  return history
    .filter((run) =>
      source.pinnedUrls.every((url) =>
        run.input.captures.some(
          (capture) =>
            capture.registryId === source.id &&
            capture.source.sourceUrl === url &&
            dayOf(new Date(capture.source.observedAt)) === day,
        ),
      ),
    )
    .sort(
      (a, b) =>
        Math.max(
          ...b.input.captures
            .filter((capture) => capture.registryId === source.id)
            .map((capture) => Date.parse(capture.source.observedAt)),
        ) -
        Math.max(
          ...a.input.captures
            .filter((capture) => capture.registryId === source.id)
            .map((capture) => Date.parse(capture.source.observedAt)),
        ),
    )[0];
}
function retainedSnapshots(
  history: HistoricalRun[],
  capture: SourceCapture,
  now: Date,
): CandidateSnapshot[] {
  if (capture.source.kind === "aggregator")
    return retainAggregationSnapshot(capture, now);
  const old = matchingSnapshot(history, capture);
  return old
    ? [{ source: capture.source, items: structuredClone(old.items) }]
    : [];
}

/** 测试仅替换采集传输；归档重建、策略、基线 hash 和正式应用始终执行真实实现。 */
export function dailyWithCollectorsForTest(
  collectors: DailyCollectors,
): (options: DailyOptions) => Promise<DailyResult> {
  return (options) => lockedDaily(options, collectors);
}
export async function runDaily(options: DailyOptions): Promise<DailyResult> {
  return lockedDaily(options, {
    browser: async (source, profileRoot) =>
      (await import("./browserCollector.ts")).collectBrowserSource(
        source,
        profileRoot,
      ),
    http: collectPublicRun,
  });
}

async function lockedDaily(
  options: DailyOptions,
  collectors: DailyCollectors,
): Promise<DailyResult> {
  const lock = await createPipelineStore(resolve(options.stateRoot));
  return lock.withStoreLock("daily-workflow", () =>
    executeDaily(options, collectors),
  );
}

async function executeDaily(
  options: DailyOptions,
  collectors: DailyCollectors,
): Promise<DailyResult> {
  const currentTime = () => (options.now ? new Date(options.now) : new Date());
  const now = currentTime();
  requireState(isTimestamp(now.toISOString()), "daily_invalid_time");
  const day = dayOf(now);
  const stageRoot = resolve(options.stageRoot);
  const registry = validateSourceRegistry(
    parse(await readStageFile(stageRoot, "private/sources.v1.json")),
  );
  const store = await createPipelineStore(resolve(stageRoot, "private/store"));
  const state = await createPipelineStore(resolve(options.stateRoot));
  await createPipelineStore(resolve(options.profileRoot));
  const registrySha256 = sha256(encode(registry));
  const resultPath = `daily/${day}/result.json`;
  const savedResult = await optional(state, resultPath);
  if (savedResult) {
    const saved = parse(savedResult) as DailyResult & {
      registrySha256: string;
    };
    requireState(
      saved.registrySha256 === registrySha256,
      "daily_registry_changed_after_completion",
    );
    return {
      changed: false,
      incidents: [],
      sources: saved.sources.map((source) => ({ ...source, reused: true })),
      reviewCount: 0,
      ...(saved.discovery
        ? { discovery: { ...saved.discovery, created: 0 } }
        : {}),
    };
  }
  const history = await historyOf(store, registry, now);
  const baselineBytes = await readStageFile(
    stageRoot,
    "site/data/events.v1.json",
  );
  const dataset = parse(baselineBytes) as {
    updatedAt: string;
    events: EventRecord[];
  };
  requireState(Array.isArray(dataset.events), "daily_invalid_events");
  const result: DailyResult = {
    changed: false,
    incidents: [],
    sources: [],
    reviewCount: 0,
  };
  const imports: CaptureImport[] = [];
  const previous: SourceCapture[] = [];
  const freshCaptureIds: string[] = [];
  const applicationState = await pendingApplicationIntents(state);
  const blockedEvents = applicationState.blockedEvents;
  const discoveryBindings = await readDiscoveryBindings(stageRoot, state);
  const incident = async (
    code: string,
    source: string,
    evidence: unknown,
    action = "请核对来源正文、身份或访问状态；未确认的候选不会写入正式活动。",
  ) => {
    const fingerprint = sha256(encode({ code, source, evidence }));
    const path = `daily/reviews/${fingerprint}.json`;
    if (await optional(state, path)) return;
    const value = {
      code,
      source,
      action,
    };
    await immutable(state, path, {
      ...value,
      fingerprint,
      firstSeen: now.toISOString(),
    });
    result.incidents.push(value);
    result.reviewCount++;
  };
  // 观测归档不代表正式应用。完成意图归档后仍须另有应用回执，否则逐日提醒。
  for (const intent of applicationState.pending) {
    await incident(
      "daily_unapplied_changes_require_review",
      "daily",
      { day, runId: intent.runId, intentSha256: intent.intentSha256 },
      "请核对私有变更意图、完整前像和原应用回执后恢复；相关活动暂停自动修改，原采集证据保留。",
    );
  }
  const inspectCache = async (
    source: string,
    input: CaptureImport,
  ): Promise<boolean> => {
    const ids = input.captures.map((capture) => capture.captureId);
    const beforeCache = latestCaptures(history, source, ids);
    const changed = input.captures.some((capture) => {
      const before = beforeCache.find(
        (item) => sourceKey(item) === sourceKey(capture),
      );
      return before && contentKey(before) !== contentKey(capture);
    });
    const unbound =
      !beforeCache.length &&
      !bindingsFor(history, input.captures, dataset.events).length;
    if (changed || unbound) {
      for (const event of dataset.events)
        if (
          event.sources.some((formal) =>
            input.captures.some(
              (capture) => capture.source.sourceUrl === formal.url,
            ),
          )
        )
          blockedEvents.add(event.id);
      await incident(
        changed
          ? "cached_changed_observation_requires_review"
          : "cached_new_source_candidate_only",
        source,
        input.captures.map(contentKey),
      );
      return true;
    }
    return false;
  };

  for (const source of registry.sources.filter(
    (item) => item.state === "pilot",
  )) {
    const receiptPath = `daily/${day}/${source.id}.json`;
    try {
      const saved = await optional(state, receiptPath);
      if (saved) {
        const receipt = parse(saved) as SourceReceipt;
        requireState(
          receipt.schemaVersion === "server-daily-source-v1" &&
            receipt.day === day &&
            receipt.source === source.id &&
            receipt.registrySha256 === registrySha256,
          "daily_source_receipt_mismatch",
        );
        if (receipt.status === "complete") {
          requireState(receipt.runId, "daily_complete_run_missing");
          const input = sourceImport(
            await importFromRun(store, receipt.runId, registry, currentTime()),
            source.id,
          );
          requireState(
            encode(input.captures.map((capture) => capture.captureId)) ===
              encode(receipt.captureIds),
            "daily_receipt_capture_mismatch",
          );
          await inspectCache(source.id, input);
          imports.push(input);
        }
        result.sources.push({ ...receipt, reused: true });
        continue;
      }
      const old = latestCaptures(history, source.id);
      let input: CaptureImport;
      let runId: string;
      let reused: boolean;
      const cached = existingToday(history, source, day);
      if (cached) {
        runId = cached.runId;
        input = sourceImport(cached.input, source.id);
        reused = true;
      } else {
        const attemptPath = `daily/${day}/${source.id}.attempt.json`;
        requireState(
          !(await optional(state, attemptPath)),
          "daily_prior_attempt_requires_review",
        );
        const attemptedAt = currentTime().toISOString();
        await immutable(state, attemptPath, {
          source: source.id,
          day,
          attemptedAt,
        });
        if (source.collector === "manual-browser") {
          const collected = await collectors.browser(
            source,
            resolve(options.profileRoot),
          );
          requireState(
            collected.capture.registryId === source.id &&
              source.pinnedUrls.includes(collected.capture.source.sourceUrl),
            "daily_collector_source_mismatch",
          );
          requireState(
            dayOf(new Date(collected.capture.source.observedAt)) === day &&
              Date.parse(collected.capture.source.observedAt) >=
                Date.parse(attemptedAt),
            "daily_fresh_observation_required",
          );
          requireState(
            collected.capture.source.completeness === "complete" &&
              collected.capture.selection?.complete === true,
            "daily_browser_incomplete",
          );
          input = {
            schemaVersion: "idol-capture-import-v1",
            captures: [collected.capture],
            proofs: [collected.proof],
            snapshots: retainedSnapshots(
              history,
              collected.capture,
              currentTime(),
            ),
            mappings: [],
          };
          runId = `server-source-${source.id}-${day}`;
          const archived = await archiveImport(
            store,
            Buffer.from(encode(input)),
            registry,
            runId,
            currentTime(),
          );
          reused = archived.reused;
          input = await importFromRun(store, runId, registry, currentTime());
        } else {
          requireState(
            source.collector === "showstart-public-http",
            "daily_collector_unavailable",
          );
          const collected = await collectors.http(
            store,
            registry,
            source.id,
            currentTime(),
          );
          runId = collected.runId;
          input = await importFromRun(store, runId, registry, currentTime());
          requireState(
            input.captures.every((capture) => capture.registryId === source.id),
            "daily_collector_source_mismatch",
          );
          reused = collected.reused;
        }
      }
      requireState(
        input.captures.length > 0 &&
          source.pinnedUrls.every((url) =>
            input.captures.some((capture) => capture.source.sourceUrl === url),
          ),
        "daily_source_coverage_missing",
      );
      const receipt: SourceReceipt = {
        schemaVersion: "server-daily-source-v1",
        source: source.id,
        day,
        registrySha256,
        status: "complete",
        reused,
        runId,
        observedAt: input.captures.map((capture) => capture.source.observedAt),
        captureIds: input.captures.map((capture) => capture.captureId),
        reviewCount: 0,
      };
      if (reused && (await inspectCache(source.id, input)))
        receipt.reviewCount++;
      await immutable(state, receiptPath, receipt);
      imports.push(input);
      result.sources.push(receipt);
      if (!reused) {
        previous.push(...old);
        freshCaptureIds.push(...receipt.captureIds);
      }
    } catch (error) {
      const code = failureCode(error);
      const receipt: SourceReceipt = {
        schemaVersion: "server-daily-source-v1",
        source: source.id,
        day,
        registrySha256,
        status: "failed",
        reused: false,
        runId: null,
        observedAt: [],
        captureIds: [],
        reviewCount: 1,
        failureCode: code,
      };
      // 成功文件不可覆盖；异常原样留为独立失败文件，不把失败伪装成完成的活动 run。
      const failurePath = `daily/${day}/${source.id}.failed-${sha256(code).slice(0, 16)}.json`;
      if (!(await optional(state, failurePath)))
        await immutable(state, failurePath, receipt);
      await incident(code, source.id, { code });
      result.sources.push(receipt);
    }
  }

  const allCaptures = imports.flatMap((input) => input.captures);
  const fresh = allCaptures.filter((capture) =>
    freshCaptureIds.includes(capture.captureId),
  );
  const bindings = bindingsFor(history, previous, dataset.events);
  const primaryFresh = fresh.filter(
    (capture) => capture.source.kind !== "aggregator",
  );
  const policy = primaryFresh.length
    ? evaluateEventPolicy({
        previousCaptures: previous.filter(
          (capture) => capture.source.kind !== "aggregator",
        ),
        currentCaptures: primaryFresh,
        freshCaptureIds,
        bindings,
        events: dataset.events,
        now: currentTime().toISOString(),
      })
    : null;
  if (policy)
    for (const decision of policy.captures) {
      if (decision.status !== "review") continue;
      const current = fresh.find(
        (capture) => capture.captureId === decision.current?.captureId,
      );
      for (const code of decision.reasons)
        await incident(
          code,
          decision.registryId,
          current ? contentKey(current) : decision.sourceUrl,
        );
      const receipt = result.sources.find(
        (item) => item.source === decision.registryId,
      );
      if (receipt) receipt.reviewCount += decision.reasons.length;
    }
  const changes = (policy?.changes ?? []).filter(
    (change) => !blockedEvents.has(change.eventId),
  );
  const discovery = buildAggregationDiscoveries({
    captures: allCaptures,
    freshCaptureIds,
    events: dataset.events,
    now: currentTime(),
    bindings: [...discoveryBindings, ...applicationState.bindings],
  });
  for (const review of discovery.reviews) {
    const capture = allCaptures.find(
      (item) => item.captureId === review.captureId,
    );
    await incident(
      review.code,
      review.registryId,
      {
        line: review.line,
        eventIds: review.eventIds,
        evidence: capture
          ? review.line === null
            ? contentKey(capture)
            : capture.bodyText.split("\n")[review.line - 1]
          : null,
      },
      review.message,
    );
    const receipt = result.sources.find(
      (source) => source.source === review.registryId,
    );
    if (receipt) receipt.reviewCount++;
  }
  const runId = `server-daily-${day}`;
  let draft: EventUpdateDraft | undefined;
  const snapshots = imports.flatMap((input) => input.snapshots);
  if (changes.length) {
    draft = makeDraft(
      dataset.events,
      changes,
      allCaptures,
      sha256(baselineBytes),
      currentTime(),
    );
    // 只有通过原文掩码与前像核验的确定性时间变化才产生新字段快照。
    for (const capture of fresh) {
      const updates = changes.filter(
        (change) => change.current.captureId === capture.captureId,
      );
      if (!updates.length) continue;
      const before = previous.find(
        (item) => sourceKey(item) === sourceKey(capture),
      );
      const old = before && matchingSnapshot(history, before);
      requireState(old?.items.length === 1, "daily_ready_snapshot_ambiguous");
      const item = structuredClone(old.items[0]);
      for (const update of updates) item.fields[update.field] = update.after;
      item.candidateId = `c-${sha256(capture.captureId + item.sourceItemKey).slice(0, 32)}`;
      item.fieldExcerpts = Object.fromEntries(
        Object.keys(item.fields).map((field) => [field, capture.bodyText]),
      );
      snapshots.push({ source: capture.source, items: [item] });
    }
  }
  const readyDiscoveries = discovery.changes.filter(
    (change) => !blockedEvents.has(change.event.id),
  );
  const capacity = Math.max(0, 100 - (draft?.changes.length ?? 0));
  const creates = readyDiscoveries.slice(0, capacity);
  const overflow = readyDiscoveries.length - creates.length;
  if (overflow)
    await incident(
      "daily_discovery_limit_exceeded",
      "weibo-board",
      { day, overflow },
      "本次混合应用最多 100 项；超出活动保留原文，等待下一次新鲜采集。",
    );
  result.discovery = {
    ...discovery.summary,
    created: 0,
    overflow: discovery.summary.overflow + overflow,
  };
  if (creates.length)
    draft = {
      schemaVersion: "idol-reviewed-event-update-v1",
      baselineSha256: sha256(baselineBytes),
      reviewedAt: currentTime().toISOString(),
      reviewedBy: "server-deterministic-event-policy",
      changes: [...(draft?.changes ?? []), ...creates],
    };
  const confirmedIds = new Set([
    ...dataset.events.map((event) => event.id),
    ...creates.map((change) => change.event.id),
  ]);
  const confirmedBindings = discovery.bindings.filter((binding) =>
    confirmedIds.has(binding.eventId),
  );
  // 在构造聚合归档或调用 apply 之前保存前像，任何后续异常均保留明确的未完成状态。
  const intent = draft
    ? await saveApplicationIntent(
        state,
        runId,
        baselineBytes,
        draft,
        changes,
        confirmedBindings,
        registrySha256,
        day,
      )
    : null;
  if (allCaptures.length) {
    const input: CaptureImport = {
      schemaVersion: "idol-capture-import-v1",
      captures: allCaptures,
      proofs: imports.flatMap((item) => item.proofs),
      snapshots,
      mappings: [
        ...new Map(
          imports
            .flatMap((item) => item.mappings)
            .map((mapping) => [encode(mapping), mapping]),
        ).values(),
      ],
      ...(draft ? { draft } : {}),
    };
    try {
      await archiveImport(
        store,
        Buffer.from(encode(input)),
        registry,
        runId,
        currentTime(),
      );
      if (draft) {
        requireState(
          sha256(await readStageFile(stageRoot, "site/data/events.v1.json")) ===
            draft.baselineSha256,
          "daily_event_baseline_drift",
        );
        const applied = await applyActivityRun(
          stageRoot,
          store,
          registry,
          runId,
          Buffer.from(encode(draft)),
        );
        result.changed = applied.changed;
        result.discovery.created = applied.changed ? creates.length : 0;
        requireState(intent, "daily_application_intent_missing");
        await immutable(state, `daily/applied/${runId}.json`, {
          intentSha256: intent.intentSha256,
          applicationId: applied.applicationId,
          outputSha256: applied.outputSha256,
          appliedAt: currentTime().toISOString(),
        });
      }
      await saveDiscoveryBindings(state, runId, confirmedBindings);
    } catch (error) {
      await incident(failureCode(error), "daily", {
        runId,
        baseline: sha256(baselineBytes),
      });
    }
  }
  if (!allCaptures.length)
    await incident("daily_no_successful_sources", "daily", { day });
  await immutable(state, resultPath, { ...result, registrySha256 });
  return result;
}

function makeDraft(
  events: PolicyEvent[],
  changes: EventTimeChange[],
  captures: SourceCapture[],
  baselineSha256: string,
  now: Date,
): EventUpdateDraft {
  const eventIds = [...new Set(changes.map((change) => change.eventId))];
  return {
    schemaVersion: "idol-reviewed-event-update-v1",
    baselineSha256,
    reviewedAt: now.toISOString(),
    reviewedBy: "server-deterministic-time-policy",
    changes: eventIds.map((eventId) => {
      const event = structuredClone(
        events.find((item) => item.id === eventId)!,
      );
      const updates = changes.filter((change) => change.eventId === eventId);
      for (const change of updates) {
        event[change.field] = change.after;
        const capture = captures.find(
          (item) => item.captureId === change.current.captureId,
        )!;
        const source = capture.source;
        event.sources = event.sources.map((old) =>
          old.url === source.sourceUrl
            ? {
                url: source.sourceUrl,
                label: source.label,
                publisher: source.publisher,
                observedAt: source.observedAt,
                kind: source.kind,
              }
            : old,
        );
      }
      return {
        event: event as EventUpdateDraft["changes"][number]["event"],
        action: "update",
        evidence: updates.map((change) => ({
          captureId: change.current.captureId,
          excerpt: change.currentExcerpt,
          supports: [change.field],
        })),
        rationale:
          "完整新正文与已登记前像逐字比较，身份、日期、非时间正文和非空链接均未变化，仅应用明确入场或开演时刻。",
      };
    }),
  };
}

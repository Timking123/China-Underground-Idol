import { resolve } from "node:path";
import type { EventRecord } from "../../site/src/events/model.ts";
import type {
  EventUpdateDraft,
  ReviewedEventChange,
} from "../src/eventApplication.ts";
import {
  buildAggregationDiscoveries,
  type AggregationDiscoveryBinding,
} from "../src/eventDiscovery.ts";
import {
  applyActivityRun,
  archiveImport,
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
  extractAggregation,
  isTimestamp,
  sha256,
  type SourceCapture,
} from "../src/sourceCapture.ts";
import {
  object,
  requireState,
  validateSourceRegistry,
} from "../src/sourceRegistry.ts";
import type { EventTimeChange } from "./eventPolicy.ts";
import type { CandidateSnapshot } from "../src/eventCandidates.ts";

const parse = (bytes: Uint8Array): unknown =>
  JSON.parse(Buffer.from(bytes).toString("utf8"));
const dayOf = (date: Date): string =>
  new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/** 旧候选快照最多1000项；整页异常或超限只省略派生快照，完整原文与证明照常归档。 */
export function retainAggregationSnapshot(
  capture: SourceCapture,
  now: Date,
): CandidateSnapshot[] {
  try {
    const snapshot = extractAggregation(capture, now).snapshot;
    return snapshot.items.length <= 1000 ? [snapshot] : [];
  } catch {
    return [];
  }
}

export async function optionalState(
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

export async function immutableState(
  store: PipelineStore,
  path: string,
  value: unknown,
): Promise<void> {
  await store.withStoreLock("daily-state", () =>
    store.putImmutable(path, Buffer.from(encode(value))),
  );
}

function validateBindings(input: unknown): AggregationDiscoveryBinding[] {
  requireState(Array.isArray(input), "discovery_bindings_invalid");
  for (const binding of input)
    requireState(
      object(binding) &&
        Object.keys(binding).sort().join(",") ===
          "city,date,detailUrl,eventId" &&
        ["detailUrl", "eventId", "date", "city"].every(
          (key) => typeof binding[key] === "string" && binding[key].trim(),
        ) &&
        /^https:\/\/weibo\.com\/\d+\/[A-Za-z0-9]+$/u.test(
          binding.detailUrl as string,
        ) &&
        /^\d{4}-\d{2}-\d{2}$/u.test(binding.date as string),
      "discovery_binding_invalid",
    );
  return (input as AggregationDiscoveryBinding[]).map(
    ({ detailUrl, eventId, date, city }) => ({
      detailUrl,
      eventId,
      date,
      city,
    }),
  );
}

export async function readDiscoveryBindings(
  stageRoot: string,
  state: PipelineStore,
): Promise<AggregationDiscoveryBinding[]> {
  let configured: AggregationDiscoveryBinding[] = [];
  try {
    const input = parse(
      await readStageFile(stageRoot, "private/discovery-bindings.v1.json"),
    );
    requireState(
      object(input) &&
        input.schemaVersion === "idol-discovery-bindings-v1" &&
        Object.keys(input).sort().join(",") === "bindings,schemaVersion",
      "discovery_binding_schema_invalid",
    );
    configured = validateBindings(input.bindings);
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  for (const run of await state.listRuns("discovery-bindings")) {
    requireState(
      run.status === "complete",
      "discovery_binding_receipt_incomplete",
    );
    const input = parse(run.files["bindings.json"]);
    requireState(
      object(input) &&
        input.schemaVersion === "idol-discovery-bindings-v1" &&
        Object.keys(input).sort().join(",") === "bindings,schemaVersion",
      "discovery_binding_schema_invalid",
    );
    configured.push(...validateBindings(input.bindings));
  }
  return [
    ...new Map(
      configured.map((binding) => [encode(binding), binding]),
    ).values(),
  ];
}

export async function saveDiscoveryBindings(
  state: PipelineStore,
  runId: string,
  bindings: AggregationDiscoveryBinding[],
): Promise<void> {
  if (!bindings.length) return;
  await state.withStoreLock("daily-state", () =>
    state.commitRun(
      "discovery-bindings",
      runId,
      {
        "bindings.json": encode({
          schemaVersion: "idol-discovery-bindings-v1",
          bindings: validateBindings(bindings),
        }),
      },
      {},
    ),
  );
}

interface ApplicationIntentV2 {
  schemaVersion: "server-daily-application-intent-v2";
  changes: ReviewedEventChange[];
  bindings: AggregationDiscoveryBinding[];
}

/** 兼容旧时间意图；新建必须保存完整记录，使失败后仍能锁住稳定身份。 */
export async function pendingApplicationIntents(state: PipelineStore): Promise<{
  blockedEvents: Set<string>;
  bindings: AggregationDiscoveryBinding[];
  pending: { runId: string; intentSha256: string }[];
}> {
  const blockedEvents = new Set<string>(),
    bindings: AggregationDiscoveryBinding[] = [];
  const pending: { runId: string; intentSha256: string }[] = [];
  for (const intent of await state.listRuns("daily-application-intents")) {
    requireState(
      intent.status === "complete",
      "daily_application_intent_requires_review",
    );
    const completed = await optionalState(
      state,
      `daily/applied/${intent.runId}.json`,
    );
    if (completed) {
      const receipt = parse(completed);
      requireState(
        object(receipt) && receipt.intentSha256 === intent.intentSha256,
        "daily_application_receipt_mismatch",
      );
      continue;
    }
    const baseline = parse(intent.files["baseline.json"]);
    requireState(
      object(baseline) && Array.isArray(baseline.events),
      "daily_application_intent_invalid",
    );
    const events = baseline.events as EventRecord[];
    if (intent.files["intent.json"]) {
      const input = parse(intent.files["intent.json"]);
      requireState(
        object(input) &&
          input.schemaVersion === "server-daily-application-intent-v2" &&
          Array.isArray(input.changes) &&
          input.changes.length > 0 &&
          input.changes.length <= 100,
        "daily_application_intent_invalid",
      );
      const value = input as unknown as ApplicationIntentV2;
      const ids = new Set<string>();
      for (const change of value.changes) {
        requireState(
          object(change) &&
            object(change.event) &&
            typeof change.event.id === "string" &&
            !ids.has(change.event.id) &&
            ((change.action === "create" &&
              !events.some((event) => event.id === change.event.id)) ||
              (change.action === "update" &&
                events.some((event) => event.id === change.event.id))),
          "daily_application_intent_invalid",
        );
        ids.add(change.event.id);
        blockedEvents.add(change.event.id);
      }
      bindings.push(
        ...validateBindings(value.bindings).filter((binding) =>
          ids.has(binding.eventId),
        ),
      );
    } else {
      const changes = parse(intent.files["changes.json"]) as EventTimeChange[];
      requireState(
        Array.isArray(changes) &&
          changes.length > 0 &&
          changes.every(
            (change) =>
              object(change) &&
              typeof change.eventId === "string" &&
              events.some((event) => event.id === change.eventId),
          ),
        "daily_application_intent_invalid",
      );
      for (const change of changes) blockedEvents.add(change.eventId);
    }
    pending.push({ runId: intent.runId, intentSha256: intent.intentSha256! });
  }
  return { blockedEvents, bindings, pending };
}

export async function saveApplicationIntent(
  state: PipelineStore,
  runId: string,
  baselineBytes: Uint8Array,
  draft: EventUpdateDraft,
  timeChanges: EventTimeChange[],
  bindings: AggregationDiscoveryBinding[],
  registrySha256: string,
  day: string,
) {
  requireState(
    draft.changes.length > 0 && draft.changes.length <= 100,
    "daily_application_limit_exceeded",
  );
  return state.withStoreLock("daily-state", () =>
    state.commitRun(
      "daily-application-intents",
      runId,
      {
        "baseline.json": baselineBytes,
        "changes.json": encode(timeChanges),
        "intent.json": encode({
          schemaVersion: "server-daily-application-intent-v2",
          changes: draft.changes,
          bindings,
        } satisfies ApplicationIntentV2),
      },
      {
        schemaVersion: "server-daily-application-intent-v2",
        registrySha256,
        baselineSha256: sha256(baselineBytes),
        day,
      },
    ),
  );
}

export interface DiscoveryBootstrapOptions {
  stageRoot: string;
  stateRoot: string;
  now?: Date;
}

export interface DiscoveryBootstrapResult {
  changed: boolean;
  reused: boolean;
  runId: string;
  requests: 0;
  discovery: ReturnType<typeof buildAggregationDiscoveries>["summary"];
  reviews: ReturnType<typeof buildAggregationDiscoveries>["reviews"];
  pendingIntentIds: string[];
}

/** 已授权的一次性补收只复用当天已验证归档；本入口不含网络或浏览器采集。 */
export async function runDiscoveryBootstrap(
  options: DiscoveryBootstrapOptions,
): Promise<DiscoveryBootstrapResult> {
  const stageRoot = resolve(options.stageRoot),
    now = options.now ? new Date(options.now) : new Date();
  requireState(
    isTimestamp(now.toISOString()),
    "discovery_bootstrap_invalid_time",
  );
  // 与 daily 共用工作流锁；写状态使用独立实例，避免同实例嵌套锁。
  const lock = await createPipelineStore(resolve(options.stateRoot));
  return lock.withStoreLock("daily-workflow", async () => {
    const state = await createPipelineStore(resolve(options.stateRoot));
    const day = dayOf(now),
      runId = `server-discovery-bootstrap-${day}`;
    const registry = validateSourceRegistry(
      parse(await readStageFile(stageRoot, "private/sources.v1.json")),
    );
    const registrySha256 = sha256(encode(registry)),
      resultPath = `discovery-bootstrap/${day}/result.json`;
    const saved = await optionalState(state, resultPath);
    if (saved) {
      const result = parse(saved) as DiscoveryBootstrapResult & {
        registrySha256: string;
      };
      requireState(
        result.registrySha256 === registrySha256,
        "discovery_bootstrap_registry_changed",
      );
      return {
        ...result,
        changed: false,
        reused: true,
        requests: 0,
        discovery: { ...result.discovery, created: 0 },
      };
    }
    const store = await createPipelineStore(
      resolve(stageRoot, "private/store"),
    );
    const pending = await pendingApplicationIntents(state);
    requireState(
      !pending.pending.some((intent) => intent.runId === runId),
      "discovery_bootstrap_pending_intent_requires_review",
    );
    requireState(
      !(await optionalState(state, `daily/applied/${runId}.json`)),
      "discovery_bootstrap_result_requires_review",
    );
    const bindings = await readDiscoveryBindings(stageRoot, state);
    const baselineBytes = await readStageFile(
      stageRoot,
      "site/data/events.v1.json",
    );
    const dataset = parse(baselineBytes) as { events: EventRecord[] };
    requireState(Array.isArray(dataset.events), "daily_invalid_events");
    const selected = new Map<
      string,
      { capture: SourceCapture; proof: CaptureImport["proofs"][number] }
    >();
    for (const run of await store.listRuns("activities")) {
      requireState(
        run.status === "complete",
        "daily_history_incomplete_requires_review",
      );
      const captures = parse(run.files["captures.json"]) as SourceCapture[];
      const input = validateCaptureImport(
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
      for (const capture of input.captures) {
        if (
          capture.registryId !== "weibo-board" ||
          capture.source.kind !== "aggregator" ||
          capture.source.completeness !== "complete" ||
          capture.selection?.complete !== true ||
          dayOf(new Date(capture.source.observedAt)) !== day ||
          !registry.sources.some(
            (source) =>
              source.id === capture.registryId && source.state === "pilot",
          )
        )
          continue;
        const old = selected.get(capture.source.sourceUrl)?.capture;
        if (old && old.source.observedAt === capture.source.observedAt)
          requireState(
            old.source.bodySha256 === capture.source.bodySha256 &&
              encode(old.links) === encode(capture.links),
            "daily_history_equal_time_conflict",
          );
        if (
          !old ||
          Date.parse(capture.source.observedAt) >
            Date.parse(old.source.observedAt)
        )
          selected.set(capture.source.sourceUrl, {
            capture,
            proof: input.proofs.find(
              (proof) => proof.captureId === capture.captureId,
            )!,
          });
      }
    }
    requireState(
      selected.size > 0,
      "discovery_bootstrap_today_capture_missing",
    );
    const captures = [...selected.values()].map((item) => item.capture);
    // 补收授权仅覆盖本入口选定的当天归档，原 observedAt、proof 和 daily 回执均保持真实。
    const discovery = buildAggregationDiscoveries({
      captures,
      freshCaptureIds: captures.map((capture) => capture.captureId),
      events: dataset.events,
      now,
      bindings: [...bindings, ...pending.bindings],
    });
    const changes = discovery.changes.filter(
      (change) => !pending.blockedEvents.has(change.event.id),
    );
    const confirmedIds = new Set([
      ...dataset.events.map((event) => event.id),
      ...changes.map((change) => change.event.id),
    ]);
    const confirmedBindings = discovery.bindings.filter((binding) =>
      confirmedIds.has(binding.eventId),
    );
    const draft: EventUpdateDraft | undefined = changes.length
      ? {
          schemaVersion: "idol-reviewed-event-update-v1",
          baselineSha256: sha256(baselineBytes),
          reviewedAt: now.toISOString(),
          reviewedBy: "server-archived-discovery-bootstrap",
          changes,
        }
      : undefined;
    const intent = draft
      ? await saveApplicationIntent(
          state,
          runId,
          baselineBytes,
          draft,
          [],
          confirmedBindings,
          registrySha256,
          day,
        )
      : null;
    await archiveImport(
      store,
      Buffer.from(
        encode({
          schemaVersion: "idol-capture-import-v1",
          captures,
          proofs: [...selected.values()].map((item) => item.proof),
          snapshots: captures.flatMap((capture) =>
            retainAggregationSnapshot(capture, now),
          ),
          mappings: [],
          ...(draft ? { draft } : {}),
        } satisfies CaptureImport),
      ),
      registry,
      runId,
      now,
    );
    let changed = false;
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
      changed = applied.changed;
      requireState(intent, "daily_application_intent_missing");
      await immutableState(state, `daily/applied/${runId}.json`, {
        intentSha256: intent.intentSha256,
        applicationId: applied.applicationId,
        outputSha256: applied.outputSha256,
        appliedAt: now.toISOString(),
      });
    }
    await saveDiscoveryBindings(state, runId, confirmedBindings);
    const result: DiscoveryBootstrapResult = {
      changed,
      reused: false,
      runId,
      requests: 0,
      discovery: {
        ...discovery.summary,
        created: changed ? changes.length : 0,
      },
      reviews: discovery.reviews,
      pendingIntentIds: pending.pending.map((intent) => intent.runId),
    };
    await immutableState(state, resultPath, { ...result, registrySha256 });
    return result;
  });
}

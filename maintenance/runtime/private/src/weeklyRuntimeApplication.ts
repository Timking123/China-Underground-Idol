import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { relative, resolve, sep } from "node:path";
import {
  emptyScopedFollowerObservations,
  overlayCombinedFollowerObservations,
  scopedFollowerBaselineSources,
  scopedFollowerIdentity,
  validateScopedFollowerObservations,
  type ScopedFollowerObservation,
  type ScopedFollowerObservations,
} from "../../site/src/catalog/scopedFollowerObservations.ts";
import {
  latestFollowerBaseline,
  strictFollowerIdentity,
  validateFollowerObservations,
  type FollowerBaseline,
} from "../../site/src/catalog/followerObservations.ts";
import { readStageFile } from "./pipeline.ts";
import {
  createPipelineStore,
  type PipelineStore,
  type PipelineStoreOptions,
  type RunInspection,
} from "./pipelineStore.ts";
import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import { weeklyEvidenceBytes, weeklyObjectHash } from "./weeklyContract.ts";
import { WITHHELD_GROUP, WITHHELD_UID } from "./weeklyReconciliation.ts";
import {
  buildWeeklyScope,
  parseWeeklyRuntimeInputs,
  readWeeklyRuntimeInputs,
  WEEKLY_STAGE,
  type WeeklyInputs,
} from "./weeklyScope.ts";
import {
  weeklyFailureCode,
  withWeeklyRuntimeInspection,
  type WeeklyInspectionAction,
  type WeeklyRuntimeInspection,
} from "./weeklyRuntime.ts";

export const WEEKLY_APPLICATION_ROOT = resolve(
  WEEKLY_STAGE,
  "private/weekly-application-v2",
);
const FIXTURE_ROOT = resolve(WEEKLY_STAGE, "reports/weekly-runtime/fixtures");
const OUTPUT = "site/data/follower-observations.v2.json";
const LEGACY = "site/data/follower-observations.v1.json";
const PLAN_KIND = "weekly-application-plans";
const RECEIPT_KIND = "weekly-applications";
type Mode = "provider" | "synthetic";
type CompleteRun = Extract<RunInspection, { status: "complete" }>;
const same = (a: unknown, b: unknown): boolean => encode(a) === encode(b);
const parse = (bytes: Uint8Array): unknown =>
  JSON.parse(Buffer.from(bytes).toString("utf8"));

export interface WeeklyApplicationReview {
  id: string;
  uid: string;
  reason: string;
}
export interface WeeklyRuntimeProjection {
  status: "ready" | "blocked";
  dataset: ScopedFollowerObservations;
  applied: string[];
  unchanged: string[];
  review: WeeklyApplicationReview[];
  sourceSha256: string | null;
  errors: string[];
}
function observationConflict(
  record: ScopedFollowerObservation,
  baseline: FollowerBaseline | null,
): string | null {
  if (!baseline) return null;
  if (baseline.conflict) return "baseline_observation_conflict";
  const time = Date.parse(record.followersObservedAt);
  if (time < baseline.time) return "older_observation";
  if (
    time === baseline.time &&
    (record.followersValue !== baseline.value ||
      record.followersApproximate !== baseline.approximate)
  )
    return "same_time_conflict";
  return null;
}
const jump = (previous: number, next: number): boolean =>
  Math.abs(next - previous) >= 1000 &&
  Math.abs(next - previous) / Math.max(previous, 1) > 0.5;

function futureBaseline(source: unknown, uid: string, now: Date): boolean {
  if (!object(source)) return false;
  const future = (value: unknown): boolean =>
    typeof value === "string" && Date.parse(value) > now.getTime();
  const count = (value: unknown): boolean =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (
    String(source.weiboUid ?? source.uid ?? "") === uid &&
    source.followersKnown !== false &&
    count(source.followersValue) &&
    future(source.followersObservedAt ?? source.profileObservedAt)
  )
    return true;
  const fields = object(source.fieldEvidence)
    ? source.fieldEvidence.followers
    : null;
  return (
    object(fields) &&
    fields.state === "verified" &&
    String(fields.boundUid ?? source.weiboUid ?? source.uid ?? "") === uid &&
    count(fields.numericValue) &&
    future(fields.observedAt)
  );
}

/** 纯投影不读写文件；生产调用方必须先通过固定provider归档完整复验。 */
export function prepareWeeklyRuntimeProjection(options: {
  inspection: WeeklyRuntimeInspection;
  inputs: WeeklyInputs;
  legacy: unknown;
  current: unknown;
  now: Date;
}): WeeklyRuntimeProjection {
  const result: WeeklyRuntimeProjection = {
    status: "blocked",
    dataset: emptyScopedFollowerObservations(),
    applied: [],
    unchanged: [],
    review: [],
    sourceSha256: null,
    errors: [],
  };
  try {
    const { inspection, now } = options;
    const current = validateScopedFollowerObservations(options.current, now);
    const legacy = validateFollowerObservations(options.legacy, now);
    requireState(
      current.valid && legacy.valid,
      "invalid_weekly_public_baseline",
    );
    result.dataset = current.data;
    const inputs = parseWeeklyRuntimeInputs(options.inputs.files);
    const scope = buildWeeklyScope(inputs, now);
    result.sourceSha256 = scope.sourceSha256;
    requireState(
      scope.activeCount === scope.targets.length && scope.review.length === 0,
      "weekly_current_scope_requires_review",
    );
    const targets = new Map(scope.targets.map((row) => [row.id, row]));
    const frozen = new Map(
      inspection.plan.scope.targets.map((row) => [row.id, row]),
    );
    const display = new Map(
      inputs.displayGroups.map((row) => [String(row.id), row]),
    );
    const master = new Map(
      inputs.masterGroups.map((row) => [String(row.id), row]),
    );
    const previousLegacy = new Map(
      legacy.data.records.map((row) => [row.groupId, row]),
    );
    const withheld = inspection.snapshot.knownWithheld ?? [];
    requireState(
      (inspection.snapshot.schemaVersion === "idol-weekly-snapshot-v2" &&
        !Object.hasOwn(inspection.snapshot, "knownWithheld") &&
        !Object.hasOwn(inspection.snapshot, "profileObservationsComplete")) ||
        (inspection.snapshot.schemaVersion === "idol-weekly-snapshot-v3" &&
          inspection.snapshot.profileObservationsComplete === false &&
          withheld.length === 1),
      "weekly_projection_result_schema_mismatch",
    );
    const population = [...inspection.snapshot.candidates, ...withheld];
    requireState(
      inspection.snapshot.slotId === inspection.slotId &&
        inspection.plan.slot.id === inspection.slotId &&
        inspection.snapshot.planSha256 === weeklyObjectHash(inspection.plan) &&
        inspection.snapshot.complete &&
        population.length === frozen.size &&
        new Set(population.map((row) => row.id)).size === frozen.size &&
        new Set(population.map((row) => row.uid)).size === frozen.size &&
        population.every((row) => frozen.get(row.id)?.uid === row.uid),
      "weekly_projection_snapshot_mismatch",
    );
    for (const record of legacy.data.records)
      requireState(
        strictFollowerIdentity(master.get(record.groupId), record.uid) &&
          strictFollowerIdentity(display.get(record.groupId), record.uid),
        "legacy_public_identity_mismatch",
      );
    for (const record of current.data.records) {
      const target = targets.get(record.groupId);
      const priorMaster = master.get(record.groupId);
      const rejected =
        priorMaster &&
        Array.isArray(priorMaster.rejectedIdentityCandidates) &&
        priorMaster.rejectedIdentityCandidates.some(
          (row: unknown) => object(row) && String(row.uid) === record.uid,
        );
      requireState(
        scopedFollowerIdentity(display.get(record.groupId), record) &&
          (!rejected || record.identityGate === "reviewed_account_scope") &&
          (!target ||
            (target.uid === record.uid &&
              target.identityGate === record.identityGate &&
              target.entityKind === record.entityKind &&
              target.scopeNote === record.scopeNote)),
        "current_public_identity_mismatch",
      );
    }
    const proposed = new Map(
      current.data.records.map((row) => [row.groupId, row]),
    );
    for (const item of withheld) {
      const target = targets.get(item.id);
      requireState(
        same(
          Object.keys(item).sort(),
          [
            "id",
            "uid",
            "reason",
            "observedAt",
            "requestKey",
            "responseSha256",
            "receiptSha256",
            "reconciliationSha256",
          ].sort(),
        ) &&
          item.id === WITHHELD_GROUP &&
          item.uid === WITHHELD_UID &&
          target?.uid === item.uid &&
          item.reason === "provider_european_user" &&
          isTimestamp(item.observedAt) &&
          Date.parse(item.observedAt) <= now.getTime() &&
          [
            item.requestKey,
            item.responseSha256,
            item.receiptSha256,
            item.reconciliationSha256,
          ].every((value) => /^[a-f0-9]{64}$/u.test(value)) &&
          inspection.snapshot.responseReferences.some(
            (ref) =>
              ref.requestKey === item.requestKey &&
              ref.responseSha256 === item.responseSha256 &&
              ref.receiptSha256 === item.receiptSha256 &&
              ref.reconciliationSha256 === item.reconciliationSha256,
          ),
        "weekly_projection_withheld_binding_mismatch",
      );
      result.review.push({
        id: item.id,
        uid: item.uid,
        reason: "known_provider_withheld_preserve_previous",
      });
      result.unchanged.push(item.id);
    }
    const ids = new Set<string>(),
      uids = new Set<string>();
    for (const candidate of inspection.snapshot.candidates) {
      const original = frozen.get(candidate.id),
        target = targets.get(candidate.id);
      requireState(
        original &&
          !ids.has(candidate.id) &&
          !uids.has(candidate.uid) &&
          original.uid === candidate.uid &&
          original.identityGate === candidate.identityGate &&
          original.entityKind === candidate.entityKind &&
          original.scopeNote === candidate.scopeNote &&
          candidate.candidateOnly === true &&
          candidate.identityAcceptedByThisRun === false &&
          candidate.canonicalImpact === "none",
        "weekly_projection_candidate_binding_mismatch",
      );
      ids.add(candidate.id);
      uids.add(candidate.uid);
      const record: ScopedFollowerObservation = {
        groupId: candidate.id,
        uid: candidate.uid,
        followersValue: candidate.followersValue,
        followersDisplay: candidate.followersDisplay,
        followersApproximate: candidate.followersApproximate,
        followersObservedAt: candidate.followersObservedAt,
        sourceUrl: candidate.sourceUrl,
        slotId: inspection.slotId,
        identityGate: candidate.identityGate,
        entityKind: candidate.entityKind,
        scopeNote: candidate.scopeNote,
        responseSha256: candidate.responseSha256,
      };
      requireState(
        validateScopedFollowerObservations(
          {
            schemaVersion: "idol-follower-observations-v2",
            updatedAt: record.followersObservedAt,
            records: [record],
          },
          now,
        ).valid,
        "invalid_weekly_projection_record",
      );
      const queue = (reason: string): void => {
        result.review.push({ id: candidate.id, uid: candidate.uid, reason });
      };
      if (
        !target ||
        target.uid !== record.uid ||
        target.identityGate !== record.identityGate ||
        target.entityKind !== record.entityKind ||
        target.scopeNote !== record.scopeNote ||
        !scopedFollowerIdentity(display.get(record.groupId), record)
      ) {
        queue("current_identity_or_scope_changed");
        continue;
      }
      const previous = proposed.get(candidate.id);
      const currentBaselineSources = [
        ...scopedFollowerBaselineSources(master.get(candidate.id)),
        ...scopedFollowerBaselineSources(display.get(candidate.id)),
      ];
      if (
        currentBaselineSources.some((source) =>
          futureBaseline(source, candidate.uid, now),
        )
      ) {
        queue("future_baseline");
        continue;
      }
      const oldBaseline = original.previous
        ? {
            uid: original.uid,
            followersValue: original.previous.value,
            followersApproximate: original.previous.approximate,
            followersObservedAt: original.previous.observedAt,
          }
        : null;
      const baseline = latestFollowerBaseline(
        [
          ...currentBaselineSources,
          previousLegacy.get(candidate.id),
          previous,
          oldBaseline,
        ],
        now,
      );
      const conflict = observationConflict(record, baseline);
      if (conflict) {
        queue(conflict);
        continue;
      }
      if (previous && same(previous, record)) {
        result.unchanged.push(candidate.id);
        continue;
      }
      if (
        previous &&
        Date.parse(record.followersObservedAt) ===
          Date.parse(previous.followersObservedAt)
      ) {
        // 同一观察时刻不以响应hash变化制造第二次观察或改写既有证据。
        result.unchanged.push(candidate.id);
        continue;
      }
      if (baseline && jump(baseline.value, record.followersValue)) {
        queue("followers_jump");
        continue;
      }
      proposed.set(candidate.id, record);
      result.applied.push(candidate.id);
    }
    const records = [...proposed.values()].sort((a, b) =>
      a.groupId.localeCompare(b.groupId, "en"),
    );
    result.dataset = {
      schemaVersion: "idol-follower-observations-v2",
      updatedAt: records.reduce<string | null>(
        (latest, row) =>
          !latest || Date.parse(row.followersObservedAt) > Date.parse(latest)
            ? row.followersObservedAt
            : latest,
        null,
      ),
      records,
    };
    requireState(
      validateScopedFollowerObservations(result.dataset, now).valid,
      "invalid_weekly_projection_output",
    );
    // 与公开两处消费者共用最终门，避免生成会因新旧层冲突或未来基线而拒绝的公开包。
    overlayCombinedFollowerObservations(
      inputs.displayGroups as { id: string }[],
      legacy.data,
      result.dataset,
      now,
    );
    result.status = "ready";
  } catch (error) {
    result.errors.push(weeklyFailureCode(error));
    result.applied = [];
    result.unchanged = [];
  }
  return result;
}

interface ApplicationPlan {
  schemaVersion: "idol-weekly-application-plan-v2";
  mode: Mode;
  slotId: string;
  preparedAt: string;
  runtimeArchiveSha256: string;
  runtimePlanSha256: string;
  snapshotSha256: string;
  sourceSha256: string;
  legacySha256: string;
  beforeSha256: string;
  afterSha256: string;
  applied: string[];
  unchanged: string[];
  review: WeeklyApplicationReview[];
}
interface Prepared {
  plan: ApplicationPlan;
  files: Record<string, Buffer>;
  projection: WeeklyRuntimeProjection;
}
interface Driver {
  mode: Mode;
  stageRoot: string;
  now: () => Date;
  inputs: () => Promise<WeeklyInputs>;
  withInspection: <T>(
    slotId: string,
    action: WeeklyInspectionAction<T>,
  ) => Promise<T>;
  stageOptions?: PipelineStoreOptions;
  afterReplace?: () => Promise<void>;
}

function prepare(
  inspection: WeeklyRuntimeInspection,
  inputs: WeeklyInputs,
  legacy: Buffer,
  before: Buffer,
  now: Date,
): Prepared {
  const projection = prepareWeeklyRuntimeProjection({
    inspection,
    inputs,
    legacy: parse(legacy),
    current: parse(before),
    now,
  });
  requireState(
    projection.status === "ready" && projection.sourceSha256,
    projection.errors[0] ?? "weekly_projection_blocked",
  );
  const after = projection.applied.length
    ? Buffer.from(encode(projection.dataset))
    : before;
  const plan: ApplicationPlan = {
    schemaVersion: "idol-weekly-application-plan-v2",
    mode: inspection.mode,
    slotId: inspection.slotId,
    preparedAt: now.toISOString(),
    runtimeArchiveSha256: inspection.archiveSha256,
    runtimePlanSha256: weeklyObjectHash(inspection.plan),
    snapshotSha256: weeklyObjectHash(inspection.snapshot),
    sourceSha256: projection.sourceSha256,
    legacySha256: sha256(legacy),
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    applied: projection.applied,
    unchanged: projection.unchanged,
    review: projection.review,
  };
  return {
    plan,
    projection,
    files: {
      "plan.json": weeklyEvidenceBytes(plan),
      "before.json": before,
      "after.json": after,
      "legacy-v1.json": legacy,
      "snapshot.json": weeklyEvidenceBytes(inspection.snapshot),
      "runtime-plan.json": weeklyEvidenceBytes(inspection.plan),
      ...Object.fromEntries(
        Object.entries(inputs.files).map(([name, bytes]) => [
          `sources/${name}`,
          bytes,
        ]),
      ),
    },
  };
}

function savedPrepared(run: CompleteRun, mode: Mode, now: Date): Prepared {
  const plan: unknown = parse(run.files["plan.json"]);
  requireState(
    object(run.metadata) &&
      run.metadata.mode === mode &&
      object(plan) &&
      plan.schemaVersion === "idol-weekly-application-plan-v2" &&
      plan.mode === mode &&
      plan.slotId === run.runId &&
      isTimestamp(plan.preparedAt) &&
      Date.parse(plan.preparedAt) <= now.getTime(),
    "invalid_weekly_application_plan",
  );
  const inspection = {
    mode,
    slotId: plan.slotId,
    archiveSha256: plan.runtimeArchiveSha256,
    plan: parse(run.files["runtime-plan.json"]),
    snapshot: parse(run.files["snapshot.json"]),
  } as WeeklyRuntimeInspection;
  const inputs = parseWeeklyRuntimeInputs(
    Object.fromEntries(
      Object.entries(run.files)
        .filter(([name]) => name.startsWith("sources/"))
        .map(([name, bytes]) => [name.slice(8), bytes]),
    ),
  );
  const rebuilt = prepare(
    inspection,
    inputs,
    run.files["legacy-v1.json"],
    run.files["before.json"],
    new Date(plan.preparedAt),
  );
  requireState(
    same(plan, rebuilt.plan) &&
      same(Object.keys(run.files).sort(), Object.keys(rebuilt.files).sort()) &&
      Object.keys(rebuilt.files).every((name) =>
        run.files[name].equals(rebuilt.files[name]),
      ),
    "weekly_application_plan_content_mismatch",
  );
  return rebuilt;
}

function receiptBytes(plan: ApplicationPlan): Buffer {
  return weeklyEvidenceBytes({
    schemaVersion: "idol-weekly-application-receipt-v2",
    mode: plan.mode,
    slotId: plan.slotId,
    planSha256: weeklyObjectHash(plan),
    outputSha256: plan.afterSha256,
    applied: plan.applied,
    changed: plan.beforeSha256 !== plan.afterSha256,
    appliedAt: null,
    note: "公开输出字节与不可变计划一致；不推断文件替换时刻。",
  });
}

/** 只确认同slot收据完成标志的自有暂存链接中断；内容恢复仍由底层同inode/hash协议执行。 */
async function recoverableReceiptMarker(
  store: PipelineStore,
  run: RunInspection,
  saved: Prepared,
): Promise<boolean> {
  if (
    run.status !== "corrupt" ||
    run.problems.length !== 1 ||
    !run.problems[0].startsWith("HARD_LINK:")
  )
    return false;
  try {
    const base = `runs/${RECEIPT_KIND}/${run.runId}`,
      receipt = receiptBytes(saved.plan);
    // PipelineStore意图按键排序紧凑编码；必须匹配其原始字节，不能改用业务JSON的缩进格式。
    const expectedIntent = Buffer.from(
      JSON.stringify({
        files: [
          {
            path: "receipt.json",
            sha256: sha256(receipt),
            size: receipt.length,
          },
        ],
        kind: RECEIPT_KIND,
        metadata: { mode: saved.plan.mode },
        runId: run.runId,
        schemaVersion: "pipeline-run-intent-v1",
      }) + "\n",
    );
    if (
      !(await store.readRegular(`${base}/intent.json`)).equals(
        expectedIntent,
      ) ||
      !(await store.readRegular(`${base}/files/receipt.json`)).equals(receipt)
    )
      return false;
    if (
      !same((await readdir(resolve(store.storeRoot, base))).sort(), [
        "complete.json",
        "files",
        "intent.json",
      ]) ||
      !same(await readdir(resolve(store.storeRoot, base, "files")), [
        "receipt.json",
      ])
    )
      return false;
    const markerPath = resolve(store.storeRoot, base, "complete.json");
    const before = await lstat(markerPath, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 2n ||
      before.size > 4096n
    )
      return false;
    const handle = await open(
      markerPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let bytes: Buffer;
    try {
      const opened = await handle.stat({ bigint: true });
      if (
        !opened.isFile() ||
        opened.ino !== before.ino ||
        opened.nlink !== 2n ||
        opened.size !== before.size
      )
        return false;
      bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true }),
        current = await lstat(markerPath, { bigint: true });
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        [after, current].some(
          (item) =>
            item.ino !== before.ino ||
            item.nlink !== 2n ||
            item.size !== before.size ||
            item.mtimeNs !== before.mtimeNs ||
            item.ctimeNs !== before.ctimeNs,
        )
      )
        return false;
    } finally {
      await handle.close();
    }
    const marker = parse(bytes);
    if (
      !object(marker) ||
      !same(Object.keys(marker).sort(), [
        "completedAt",
        "intentSha256",
        "kind",
        "runId",
        "schemaVersion",
      ]) ||
      marker.schemaVersion !== "pipeline-run-complete-v1" ||
      marker.kind !== RECEIPT_KIND ||
      marker.runId !== run.runId ||
      marker.intentSha256 !== sha256(expectedIntent) ||
      !isTimestamp(marker.completedAt)
    )
      return false;
    return (
      (await store.readRegular(`${base}/intent.json`)).equals(expectedIntent) &&
      (await store.readRegular(`${base}/files/receipt.json`)).equals(receipt)
    );
  } catch {
    return false;
  }
}

async function auditApplications(
  store: PipelineStore,
  mode: Mode,
  now: Date,
  slotId: string,
  recovery: boolean,
): Promise<{ plans: Map<string, Prepared>; receipts: Set<string> }> {
  try {
    requireState(
      (await readdir(resolve(store.storeRoot, "runs"))).every((name) =>
        [PLAN_KIND, RECEIPT_KIND].includes(name),
      ),
      "unexpected_weekly_application_kind",
    );
  } catch (error) {
    if (!(object(error) && error.code === "ENOENT")) throw error;
  }
  const plans = new Map<string, Prepared>(),
    receipts = new Set<string>();
  for (const run of await store.listRuns(PLAN_KIND)) {
    requireState(
      run.status === "complete",
      "incomplete_weekly_application_plan",
    );
    plans.set(run.runId, savedPrepared(run, mode, now));
  }
  for (const run of await store.listRuns(RECEIPT_KIND)) {
    const saved = plans.get(run.runId);
    requireState(saved, "orphan_weekly_application_receipt");
    if (
      recovery &&
      run.runId === slotId &&
      (["pending", "failed"].includes(run.status) ||
        (await recoverableReceiptMarker(store, run, saved)))
    )
      continue;
    requireState(
      run.status === "complete" &&
        object(run.metadata) &&
        run.metadata.mode === mode &&
        same(Object.keys(run.files), ["receipt.json"]) &&
        run.files["receipt.json"].equals(receiptBytes(saved.plan)),
      "incomplete_or_invalid_weekly_application_receipt",
    );
    receipts.add(run.runId);
  }
  for (const id of plans.keys())
    requireState(
      id === slotId || receipts.has(id),
      "prior_weekly_application_incomplete",
    );
  return { plans, receipts };
}

export interface WeeklyRuntimeApplicationResult {
  status: "ready" | "complete" | "blocked";
  slotId: string;
  changed: boolean | null;
  reused: boolean;
  recovered: boolean;
  publicWrites: number | null;
  outputSha256?: string;
  applied: string[];
  unchanged: string[];
  review: WeeklyApplicationReview[];
  blocker?: string;
}

async function executeApplication(
  store: PipelineStore,
  driver: Driver,
  request: { slotId: string; apply: boolean; recoverWritten?: boolean },
): Promise<WeeklyRuntimeApplicationResult> {
  let publicWrites = 0;
  let uncertainWrite = false;
  const base = {
    slotId: request.slotId,
    changed: false,
    reused: false,
    recovered: false,
    applied: [] as string[],
    unchanged: [] as string[],
    review: [] as WeeklyApplicationReview[],
  };
  try {
    requireState(
      /^(?:manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(request.slotId) &&
        (!request.recoverWritten || request.apply),
      "invalid_weekly_application_request",
    );
    return await store.withStoreLock(
      "weekly-application",
      async () =>
        await driver.withInspection(
          request.slotId,
          async (inspection, recheck) => {
            requireState(
              inspection.mode === driver.mode,
              "weekly_application_mode_mismatch",
            );
            const stageStore = await createPipelineStore(
              driver.stageRoot,
              driver.stageOptions,
            );
            return await stageStore.withStoreLock(
              "public-followers-v2",
              async () => {
                const ledger = await auditApplications(
                  store,
                  driver.mode,
                  driver.now(),
                  request.slotId,
                  request.recoverWritten === true,
                );
                const inputs = await driver.inputs();
                const before = await readStageFile(driver.stageRoot, OUTPUT),
                  legacy = await readStageFile(driver.stageRoot, LEGACY);
                const saved = ledger.plans.get(request.slotId);
                let prepared: Prepared;
                if (saved) {
                  requireState(
                    saved.plan.runtimePlanSha256 ===
                      weeklyObjectHash(inspection.plan) &&
                      saved.plan.snapshotSha256 ===
                        weeklyObjectHash(inspection.snapshot),
                    "weekly_applied_runtime_drift",
                  );
                  requireState(
                    saved.plan.sourceSha256 ===
                      buildWeeklyScope(inputs, driver.now()).sourceSha256 &&
                      saved.plan.legacySha256 === sha256(legacy),
                    "weekly_application_sources_drift",
                  );
                  prepared = saved;
                } else {
                  requireState(
                    !request.recoverWritten,
                    "weekly_recovery_existing_application_required",
                  );
                  prepared = prepare(
                    inspection,
                    inputs,
                    legacy,
                    before,
                    driver.now(),
                  );
                }
                const { plan, projection } = prepared;
                const details = {
                  ...base,
                  outputSha256: plan.afterSha256,
                  applied: plan.applied,
                  unchanged: plan.unchanged,
                  review: plan.review,
                };
                if (ledger.receipts.has(request.slotId)) {
                  requireState(
                    sha256(before) === plan.afterSha256,
                    "weekly_applied_public_drift",
                  );
                  return {
                    ...details,
                    status: "complete",
                    reused: true,
                    publicWrites,
                  };
                }
                const outputAlreadyWritten =
                  saved &&
                  plan.beforeSha256 !== plan.afterSha256 &&
                  sha256(before) === plan.afterSha256;
                const recoveringUnchangedReceipt =
                  saved &&
                  request.recoverWritten &&
                  plan.beforeSha256 === plan.afterSha256 &&
                  sha256(before) === plan.afterSha256;
                if (outputAlreadyWritten)
                  requireState(
                    request.recoverWritten,
                    "weekly_written_output_requires_explicit_recovery",
                  );
                else
                  requireState(
                    sha256(before) === plan.beforeSha256 &&
                      (!request.recoverWritten || recoveringUnchangedReceipt),
                    "weekly_application_preimage_mismatch",
                  );
                if (!request.apply)
                  return { ...details, status: "ready", publicWrites };
                if (!saved)
                  await store.commitRun(
                    PLAN_KIND,
                    request.slotId,
                    prepared.files,
                    { mode: driver.mode },
                  );
                const finalInspection = await recheck();
                requireState(
                  finalInspection.archiveSha256 === inspection.archiveSha256 &&
                    weeklyObjectHash(finalInspection.snapshot) ===
                      plan.snapshotSha256,
                  "weekly_application_archive_changed",
                );
                requireState(
                  buildWeeklyScope(await driver.inputs(), driver.now())
                    .sourceSha256 === plan.sourceSha256 &&
                    sha256(await readStageFile(driver.stageRoot, LEGACY)) ===
                      plan.legacySha256,
                  "weekly_application_sources_drift",
                );
                if (
                  !outputAlreadyWritten &&
                  plan.beforeSha256 !== plan.afterSha256
                ) {
                  try {
                    await stageStore.atomicReplace(
                      OUTPUT,
                      prepared.files["after.json"],
                      plan.beforeSha256,
                    );
                  } catch (error) {
                    // PREIMAGE_DRIFT明确发生于替换前；其余异常不能一概声称公开写入次数为零。
                    uncertainWrite = !(
                      object(error) && error.code === "PREIMAGE_DRIFT"
                    );
                    throw error;
                  }
                  publicWrites += 1;
                  await driver.afterReplace?.();
                }
                requireState(
                  sha256(await readStageFile(driver.stageRoot, OUTPUT)) ===
                    plan.afterSha256,
                  "weekly_application_output_drift",
                );
                // 固定字节的收据允许显式恢复未完成归档，始终不重写已经匹配的公开输出。
                await store.commitRun(
                  RECEIPT_KIND,
                  request.slotId,
                  { "receipt.json": receiptBytes(plan) },
                  { mode: driver.mode },
                );
                return {
                  ...details,
                  status: "complete",
                  changed: publicWrites > 0,
                  reused: Boolean(saved),
                  recovered: Boolean(
                    outputAlreadyWritten || recoveringUnchangedReceipt,
                  ),
                  publicWrites,
                  applied: projection.applied,
                };
              },
            );
          },
        ),
    );
  } catch (error) {
    return {
      ...base,
      status: "blocked",
      publicWrites: uncertainWrite ? null : publicWrites,
      changed: uncertainWrite ? null : publicWrites > 0,
      blocker: weeklyFailureCode(error),
    };
  }
}

export type WeeklyApplicationLockTarget = "application" | "public";
function lockLocation(
  target: WeeklyApplicationLockTarget,
  applicationRoot: string,
  stageRoot: string,
): { root: string; scope: string } {
  requireState(
    target === "application" || target === "public",
    "invalid_weekly_lock_target",
  );
  return target === "application"
    ? { root: applicationRoot, scope: "weekly-application" }
    : { root: stageRoot, scope: "public-followers-v2" };
}

async function inspectLockAt(root: string, scope: string) {
  try {
    const stat = await lstat(root);
    requireState(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "invalid_weekly_lock_root",
    );
    const store = await createPipelineStore(root);
    const bytes = await store.readRegular(`.locks/${scope}.lock.json`),
      lock = parse(bytes);
    requireState(
      object(lock) &&
        same(Object.keys(lock).sort(), [
          "createdAt",
          "host",
          "nonce",
          "pid",
          "schemaVersion",
          "scope",
        ]) &&
        lock.schemaVersion === "pipeline-store-lock-v1" &&
        lock.scope === scope &&
        typeof lock.nonce === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(lock.nonce) &&
        Number.isSafeInteger(lock.pid) &&
        Number(lock.pid) > 0 &&
        typeof lock.host === "string" &&
        lock.host.length > 0 &&
        isTimestamp(lock.createdAt),
      "invalid_weekly_lock_record",
    );
    let ownerState = lock.host === hostname() ? "alive" : "other_host";
    if (ownerState === "alive") {
      try {
        process.kill(Number(lock.pid), 0);
      } catch (error) {
        ownerState =
          object(error) && error.code === "ESRCH" ? "dead" : "unknown";
      }
    }
    return {
      status: "locked",
      scope,
      sha256: sha256(bytes),
      pid: Number(lock.pid),
      host: lock.host,
      nonce: lock.nonce,
      createdAt: lock.createdAt,
      ownerState,
    };
  } catch (error) {
    if (object(error) && error.code === "ENOENT")
      return { status: "missing", scope };
    throw error;
  }
}

/** 检查只读现有锁；恢复入口固定根和固定scope，原SHA绑定nonce且底层再次证明原PID已退出。 */
export async function inspectWeeklyApplicationLock(
  target: WeeklyApplicationLockTarget,
) {
  const location = lockLocation(target, WEEKLY_APPLICATION_ROOT, WEEKLY_STAGE);
  return await inspectLockAt(location.root, location.scope);
}
export async function recoverWeeklyApplicationLock(
  target: WeeklyApplicationLockTarget,
  expectedSha256: string,
) {
  const location = lockLocation(target, WEEKLY_APPLICATION_ROOT, WEEKLY_STAGE);
  requireState(
    (await lstat(location.root)).isDirectory(),
    "weekly_lock_existing_root_required",
  );
  return await (
    await createPipelineStore(location.root)
  ).recoverLock(location.scope, expectedSha256);
}

/** 唯一正式应用入口；固定根、provider归档、唯一v2输出路径，不接受测试回调或任意文件。 */
export async function runWeeklyRuntimeApplication(request: {
  slotId: string;
  apply: boolean;
  recoverWritten?: boolean;
}): Promise<WeeklyRuntimeApplicationResult> {
  const store = await createPipelineStore(WEEKLY_APPLICATION_ROOT);
  return await executeApplication(
    store,
    {
      mode: "provider",
      stageRoot: WEEKLY_STAGE,
      now: () => new Date(),
      inputs: readWeeklyRuntimeInputs,
      withInspection: withWeeklyRuntimeInspection,
    },
    request,
  );
}

/** 合成应用只能写测试子目录；测试根不能映射到正式private或site。 */
export async function createSyntheticWeeklyRuntimeApplication(options: {
  root: string;
  now: () => Date;
  inputs: () => Promise<WeeklyInputs>;
  withInspection: <T>(
    slotId: string,
    action: WeeklyInspectionAction<T>,
  ) => Promise<T>;
  storeOptions?: PipelineStoreOptions;
  stageOptions?: PipelineStoreOptions;
  afterReplace?: () => Promise<void>;
}): Promise<{
  store: PipelineStore;
  stageRoot: string;
  inspectLock: (
    target: WeeklyApplicationLockTarget,
  ) => Promise<Awaited<ReturnType<typeof inspectLockAt>>>;
  recoverLock: (
    target: WeeklyApplicationLockTarget,
    expectedSha256: string,
  ) => Promise<Awaited<ReturnType<PipelineStore["recoverLock"]>>>;
  run: (request: {
    slotId: string;
    apply: boolean;
    recoverWritten?: boolean;
  }) => Promise<WeeklyRuntimeApplicationResult>;
}> {
  const target = resolve(options.root),
    relation = relative(FIXTURE_ROOT, target);
  requireState(
    relation &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !relation.includes(":"),
    "synthetic_weekly_application_root_refused",
  );
  const store = await createPipelineStore(target, options.storeOptions);
  const driver: Driver = {
    mode: "synthetic",
    stageRoot: target,
    now: options.now,
    inputs: options.inputs,
    withInspection: options.withInspection,
    stageOptions: options.stageOptions,
    afterReplace: options.afterReplace,
  };
  return {
    store,
    stageRoot: target,
    inspectLock: async (kind) => {
      const location = lockLocation(kind, target, driver.stageRoot);
      return await inspectLockAt(location.root, location.scope);
    },
    recoverLock: async (kind, expectedSha256) => {
      const location = lockLocation(kind, target, driver.stageRoot);
      return await (
        await createPipelineStore(location.root)
      ).recoverLock(location.scope, expectedSha256);
    },
    run: (request) => executeApplication(store, driver, request),
  };
}

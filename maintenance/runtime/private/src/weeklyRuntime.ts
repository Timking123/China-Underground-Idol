import { lstat, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import {
  createPipelineStore,
  type PipelineStore,
  type RunInspection,
} from "./pipelineStore.ts";
import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import {
  buildWeeklyRuntimePlan,
  parseWeeklyRuntimeInputs,
  readWeeklyRuntimeInputs,
  weeklySlot,
  WEEKLY_STAGE,
  WEEKLY_LIMITS,
  type WeeklyInputs,
  type WeeklyPlan,
  type WeeklyTarget,
} from "./weeklyScope.ts";
import {
  extractWeeklyProfiles,
  validateWeeklyProviderCapability,
  weeklyBudget,
  weeklyEvidenceBytes,
  weeklyObjectHash,
  weeklyProfileArguments,
  type WeeklyCapability,
  type WeeklyProfile,
  type WeeklyRawResponse,
} from "./weeklyContract.ts";
import {
  inspectLegacyWeeklyLedger,
  queryWeeklyProfiles,
  type LegacyWeeklyAudit,
} from "./weeklyRuntimeAdapter.ts";
import { collectCurrentWeeklyProviderCapability } from "./weeklyProviderCapability.ts";
import { readStageFile } from "./pipeline.ts";
import {
  ACCOUNTING_PROOF_PATH,
  WITHHELD_SLOT,
  extractKnownWithheldProfiles,
  extractRecurringPartialProfiles,
  prepareWeeklyReconciliation,
  prepareRecurringWeeklyReconciliation,
  weeklyGuardDeadline,
  type HistoricalWeeklyReconciliation,
  type RecurringWeeklyReconciliation,
  type ReconciliationBatch,
  type WeeklyReconciliation,
} from "./weeklyReconciliation.ts";

export const WEEKLY_RUNTIME_ROOT = resolve(
  WEEKLY_STAGE,
  "private/weekly-runtime",
);
const FIXTURE_ROOT = resolve(WEEKLY_STAGE, "reports/weekly-runtime/fixtures");
const KINDS = [
  "weekly-plans",
  "weekly-guards",
  "weekly-attempts",
  "weekly-responses",
  "weekly-receipts",
  "weekly-collections",
  "weekly-reconciliations",
] as const;
type Kind = (typeof KINDS)[number];
type CompleteRun = Extract<RunInspection, { status: "complete" }>;
type Mode = "provider" | "synthetic";
interface CapabilityBundle {
  capability: WeeklyCapability;
  files: Record<string, Buffer>;
}
interface Driver {
  mode: Mode;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
  inputs: () => Promise<WeeklyInputs>;
  capability: () => Promise<CapabilityBundle>;
  queryProfiles: (uids: string[]) => Promise<WeeklyRawResponse>;
  legacyAudit: () => Promise<LegacyWeeklyAudit>;
}
interface Guard {
  schemaVersion: "idol-weekly-guard-v2";
  slotId: string;
  planSha256: string;
  checkedAt: string;
  capability: WeeklyCapability;
  budget: {
    maximumCredits: number;
    budgetCredits: number;
    reserveCredits: number;
  };
  pendingAccounts: number;
  legacyAudit: LegacyWeeklyAudit;
  resume?: { slotId: string; executionSlotId: string };
}
interface Attempt {
  schemaVersion: "idol-weekly-attempt-v2";
  slotId: string;
  requestKey: string;
  planSha256: string;
  guardId: string;
  guardSha256: string;
  accountScope: string;
  startedAt: string;
  uids: string[];
  groupIds: string[];
  command: string[];
  maximumCredits: number;
  settlement: "pending_reconciliation";
}
interface Receipt {
  schemaVersion: "idol-weekly-receipt-v2";
  slotId: string;
  requestKey: string;
  attemptSha256: string;
  responseSha256: string | null;
  observedAt: string;
  outcome: "success" | "blocked";
  blocker: string | null;
  settlement:
    | "response_received_not_financially_reconciled"
    | "uncertain_requires_reconciliation";
  actualChargedCredits: null;
}
export interface RuntimeWeeklyCandidate {
  id: string;
  uid: string;
  identityGate: WeeklyTarget["identityGate"];
  entityKind: string;
  scopeNote: string | null;
  identityAcceptedByThisRun: false;
  canonicalImpact: "none";
  candidateOnly: true;
  followersValue: number;
  followersDisplay: string;
  followersApproximate: false;
  followersObservedAt: string;
  displayNameCandidate: string | null;
  sourceUrl: string;
  requestKey: string;
  responseSha256: string;
  responsePath: string;
}
export interface WeeklySnapshot {
  schemaVersion:
    | "idol-weekly-snapshot-v2"
    | "idol-weekly-snapshot-v3"
    | "idol-weekly-snapshot-v4";
  slotId: string;
  planSha256: string;
  sourceSha256: string;
  accountScope: string;
  complete: true;
  observedThrough: string;
  candidates: RuntimeWeeklyCandidate[];
  profileObservationsComplete?: false;
  knownWithheld?: (HistoricalWeeklyReconciliation["withheld"] & {
    requestKey: string;
    responseSha256: string;
    receiptSha256: string;
    reconciliationSha256: string;
  })[];
  unavailableProfiles?: (RecurringWeeklyReconciliation["unavailable"][number] & {
    requestKey: string;
    responseSha256: string;
    receiptSha256: string;
    reconciliationSha256: string;
  })[];
  responseReferences: {
    requestKey: string;
    attemptSha256: string;
    responseSha256: string;
    receiptSha256: string;
    reconciliationSha256?: string;
  }[];
  policy: {
    candidateOnly: true;
    automaticIdentityBinding: false;
    automaticPublishing: false;
    actualChargedCredits: null;
  };
}
export interface WeeklyRuntimeResult {
  status: "planned" | "complete" | "blocked";
  slotId: string | null;
  reused: boolean;
  requests: number;
  blocker?: string;
  plan?: WeeklyPlan;
  snapshot?: WeeklySnapshot;
  cachedBatches: number;
  pendingBatches: number;
}
interface Success {
  attempt: Attempt;
  receipt: Receipt;
  profiles: WeeklyProfile[];
  attemptSha256: string;
  responseSha256: string;
  receiptSha256: string;
  reconciliation?: WeeklyReconciliation;
  reconciliationSha256?: string;
}
export interface WeeklyRuntimeInspection {
  mode: "provider" | "synthetic";
  slotId: string;
  plan: WeeklyPlan;
  snapshot: WeeklySnapshot;
  archiveSha256: string;
}
export type WeeklyInspectionAction<T> = (
  inspection: WeeklyRuntimeInspection,
  recheck: () => Promise<WeeklyRuntimeInspection>,
) => Promise<T>;
const same = (left: unknown, right: unknown): boolean =>
  encode(left) === encode(right);
const json = (bytes: Buffer): unknown => JSON.parse(bytes.toString("utf8"));
const batchId = (slotId: string, key: string): string =>
  `${slotId}-${key.slice(0, 16)}`;
export function weeklyFailureCode(error: unknown): string {
  const code =
    object(error) && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.message
        : "";
  return /^[a-z0-9_:-]{1,160}$/u.test(code) ? code : "weekly_runtime_failed";
}
function content<T>(
  run: CompleteRun,
  file: string,
  schema: string,
  mode: Mode,
): T {
  requireState(
    object(run.metadata) && run.metadata.mode === mode && run.files[file],
    "weekly_archive_mode_or_file_mismatch",
  );
  const result = json(run.files[file]);
  requireState(
    object(result) && result.schemaVersion === schema,
    "weekly_archive_schema_mismatch",
  );
  return result as T;
}
async function commit(
  store: PipelineStore,
  kind: Kind,
  id: string,
  file: string,
  value: unknown,
  mode: Mode,
  extra: Record<string, Buffer> = {},
): Promise<CompleteRun> {
  return await store.commitRun(
    kind,
    id,
    { [file]: weeklyEvidenceBytes(value), ...extra },
    { mode },
  );
}
async function readOptional(
  store: PipelineStore,
  name: string,
): Promise<Buffer | null> {
  try {
    return await store.readRegular(name);
  } catch (error) {
    if (object(error) && error.code === "ENOENT") return null;
    throw error;
  }
}
function planFromRun(run: CompleteRun, mode: Mode): WeeklyPlan {
  const saved = content<WeeklyPlan>(
    run,
    "plan.json",
    "idol-weekly-plan-v2",
    mode,
  );
  requireState(
    object(saved.slot) &&
      typeof saved.slot.id === "string" &&
      object(saved.scope) &&
      isTimestamp(saved.scope.frozenAt),
    "invalid_saved_weekly_plan",
  );
  const files: Record<string, Buffer> = {};
  for (const [name, bytes] of Object.entries(run.files)) {
    if (name === "plan.json") continue;
    requireState(name.startsWith("sources/"), "unexpected_weekly_plan_file");
    files[name.slice(8)] = bytes;
  }
  const rebuilt = buildWeeklyRuntimePlan(
    parseWeeklyRuntimeInputs(files),
    saved.slot,
    saved.scope.frozenAt,
  );
  requireState(
    same(saved, rebuilt) && saved.slot.id === run.runId,
    "saved_weekly_plan_mismatch",
  );
  return rebuilt;
}
async function allRuns(
  store: PipelineStore,
  kind: Kind,
  recoverCollection: string | null,
): Promise<Map<string, CompleteRun>> {
  const runs = new Map<string, CompleteRun>();
  for (const run of await store.listRuns(kind)) {
    if (
      kind === "weekly-collections" &&
      run.runId === recoverCollection &&
      ["pending", "failed"].includes(run.status)
    )
      continue;
    requireState(
      run.status === "complete",
      `incomplete_weekly_archive:${kind}:${run.runId}`,
    );
    runs.set(run.runId, run);
  }
  return runs;
}
function validateGuard(run: CompleteRun, plan: WeeklyPlan, mode: Mode): Guard {
  const guard = content<Guard>(run, "guard.json", "idol-weekly-guard-v2", mode);
  weeklyGuardDeadline(plan.slot, guard);
  requireState(
    guard.slotId === plan.slot.id &&
      guard.planSha256 === weeklyObjectHash(plan) &&
      isTimestamp(guard.checkedAt) &&
      guard.checkedAt >= plan.scope.frozenAt &&
      guard.pendingAccounts > 0 &&
      guard.pendingAccounts <= plan.maximumAccounts &&
      object(guard.legacyAudit) &&
      guard.legacyAudit.status === "clear",
    "invalid_weekly_guard_binding",
  );
  requireState(
    same(
      weeklyBudget(
        guard.capability,
        guard.pendingAccounts,
        guard.budget.budgetCredits,
        new Date(guard.checkedAt),
        mode,
      ),
      guard.budget,
    ),
    "invalid_weekly_guard_budget",
  );
  const expectedFiles = ["guard.json"];
  for (const evidence of guard.capability.evidence) {
    requireState(
      /^[a-z0-9][a-z0-9._-]{0,90}\.json$/u.test(evidence.path),
      "invalid_weekly_evidence_name",
    );
    const name = `evidence/${evidence.path}`;
    requireState(
      run.files[name] && sha256(run.files[name]) === evidence.sha256,
      "weekly_guard_evidence_mismatch",
    );
    weeklyEvidenceBytes(json(run.files[name]));
    expectedFiles.push(name);
  }
  requireState(
    same(Object.keys(run.files).sort(), expectedFiles.sort()),
    "unexpected_weekly_guard_files",
  );
  if (mode === "provider") {
    const proofs = Object.fromEntries(
      guard.capability.evidence.map((evidence) => [
        evidence.path,
        run.files[`evidence/${evidence.path}`],
      ]),
    );
    validateWeeklyProviderCapability(
      guard.capability,
      proofs,
      new Date(guard.checkedAt),
    );
  }
  requireState(
    run.runId === weeklyObjectHash(guard),
    "weekly_guard_id_mismatch",
  );
  return guard;
}
function createSnapshot(
  plan: WeeklyPlan,
  hits: Map<string, Success>,
): WeeklySnapshot {
  requireState(
    hits.size === plan.batches.length && plan.batches.length > 0,
    "incomplete_weekly_batches",
  );
  const targets = new Map(plan.scope.targets.map((item) => [item.uid, item]));
  const candidates: RuntimeWeeklyCandidate[] = [],
    responseReferences: WeeklySnapshot["responseReferences"] = [],
    knownWithheld: NonNullable<WeeklySnapshot["knownWithheld"]> = [],
    unavailableProfiles: NonNullable<WeeklySnapshot["unavailableProfiles"]> =
      [];
  let observedThrough = "",
    accountScope = "";
  for (const batch of plan.batches) {
    const success = hits.get(batch.key)!;
    requireState(
      !accountScope || accountScope === success.attempt.accountScope,
      "weekly_account_changed",
    );
    accountScope = success.attempt.accountScope;
    if (success.receipt.observedAt > observedThrough)
      observedThrough = success.receipt.observedAt;
    responseReferences.push({
      requestKey: batch.key,
      attemptSha256: success.attemptSha256,
      responseSha256: success.responseSha256,
      receiptSha256: success.receiptSha256,
      ...(success.reconciliationSha256
        ? { reconciliationSha256: success.reconciliationSha256 }
        : {}),
    });
    if (
      success.reconciliation?.schemaVersion === "idol-weekly-reconciliation-v1"
    )
      knownWithheld.push({
        ...success.reconciliation.withheld,
        requestKey: batch.key,
        responseSha256: success.responseSha256,
        receiptSha256: success.receiptSha256,
        reconciliationSha256: success.reconciliationSha256!,
      });
    if (
      success.reconciliation?.schemaVersion === "idol-weekly-reconciliation-v2"
    )
      for (const unavailable of success.reconciliation.unavailable)
        unavailableProfiles.push({
          ...unavailable,
          requestKey: batch.key,
          responseSha256: success.responseSha256,
          receiptSha256: success.receiptSha256,
          reconciliationSha256: success.reconciliationSha256!,
        });
    for (const profile of success.profiles) {
      const target = targets.get(profile.uid)!;
      candidates.push({
        id: target.id,
        uid: profile.uid,
        identityGate: target.identityGate,
        entityKind: target.entityKind,
        scopeNote: target.scopeNote,
        identityAcceptedByThisRun: false,
        canonicalImpact: "none",
        candidateOnly: true,
        followersValue: profile.followersValue,
        followersDisplay: String(profile.followersValue),
        followersApproximate: false,
        followersObservedAt: success.receipt.observedAt,
        displayNameCandidate: profile.displayName,
        sourceUrl: `https://weibo.com/u/${profile.uid}`,
        requestKey: batch.key,
        responseSha256: success.responseSha256,
        responsePath: `runs/weekly-responses/${batchId(plan.slot.id, batch.key)}/files/response.json`,
      });
    }
  }
  requireState(
    candidates.length + knownWithheld.length + unavailableProfiles.length ===
      plan.maximumAccounts &&
      new Set(
        [...candidates, ...knownWithheld, ...unavailableProfiles].map(
          (item) => item.uid,
        ),
      ).size === plan.maximumAccounts &&
      same(
        [...candidates, ...knownWithheld, ...unavailableProfiles]
          .map((item) => item.uid)
          .sort(),
        plan.scope.targets.map((item) => item.uid).sort(),
      ),
    "weekly_snapshot_population_mismatch",
  );
  return {
    schemaVersion: unavailableProfiles.length
      ? "idol-weekly-snapshot-v4"
      : knownWithheld.length
        ? "idol-weekly-snapshot-v3"
        : "idol-weekly-snapshot-v2",
    slotId: plan.slot.id,
    planSha256: weeklyObjectHash(plan),
    sourceSha256: plan.scope.sourceSha256,
    accountScope,
    complete: true,
    observedThrough,
    candidates,
    ...(knownWithheld.length
      ? { profileObservationsComplete: false as const, knownWithheld }
      : {}),
    ...(unavailableProfiles.length
      ? { profileObservationsComplete: false as const, unavailableProfiles }
      : {}),
    responseReferences,
    policy: {
      candidateOnly: true,
      automaticIdentityBinding: false,
      automaticPublishing: false,
      actualChargedCredits: null,
    },
  };
}

/** 全局扫描所有运行及孤立产物；失败账不会因换周或换名单而被忽略。 */
async function auditLedger(
  store: PipelineStore,
  driver: Driver,
  recoverCollection: string | null = null,
  proposedReconciliation?: { record: WeeklyReconciliation; proofBytes: Buffer },
): Promise<{
  plans: Map<string, WeeklyPlan>;
  hits: Map<string, Map<string, Success>>;
  completed: Map<string, WeeklySnapshot>;
  latestResponse: string | null;
}> {
  try {
    const names = await readdir(resolve(store.storeRoot, "runs"));
    requireState(
      names.every((name) => (KINDS as readonly string[]).includes(name)),
      "unexpected_weekly_run_kind",
    );
  } catch (error) {
    if (!(object(error) && error.code === "ENOENT")) throw error;
  }
  const runs = new Map<Kind, Map<string, CompleteRun>>();
  for (const kind of KINDS)
    runs.set(kind, await allRuns(store, kind, recoverCollection));
  const plans = new Map<string, WeeklyPlan>(),
    hits = new Map<string, Map<string, Success>>();
  for (const [id, run] of runs.get("weekly-plans")!) {
    plans.set(id, planFromRun(run, driver.mode));
    hits.set(id, new Map());
  }
  const guards = new Map<string, Guard>();
  for (const [id, run] of runs.get("weekly-guards")!) {
    const raw = content<Guard>(
      run,
      "guard.json",
      "idol-weekly-guard-v2",
      driver.mode,
    );
    const plan = plans.get(raw.slotId);
    requireState(plan, "orphan_weekly_guard");
    guards.set(id, validateGuard(run, plan, driver.mode));
  }
  const accountBytes = await readOptional(store, "account.json");
  const account = accountBytes ? json(accountBytes) : null;
  if (guards.size)
    requireState(
      object(account) &&
        account.mode === driver.mode &&
        /^[a-f0-9]{16}$/u.test(String(account.accountScope)),
      "weekly_account_record_missing",
    );
  const attempts = runs.get("weekly-attempts")!,
    responses = runs.get("weekly-responses")!,
    receipts = runs.get("weekly-receipts")!;
  const reconciliations = new Map<string, WeeklyReconciliation>();
  const checkReconciliation = (
    record: WeeklyReconciliation,
    proofBytes: Buffer,
  ) => {
    requireState(
      isTimestamp(record.reviewedAt) &&
        Date.parse(record.reviewedAt) <= driver.now().getTime(),
      "invalid_reconciliation_review_time",
    );
    const plan = plans.get(record.slotId),
      planRun = runs.get("weekly-plans")!.get(record.slotId);
    requireState(plan && planRun, "reconciliation_plan_missing");
    const lastIndex = plan.batches.findIndex(
      (batch) => batch.key === record.requestKey,
    );
    requireState(lastIndex >= 0, "reconciliation_batch_missing");
    const batches = plan.batches
      .slice(
        0,
        record.schemaVersion === "idol-weekly-reconciliation-v1"
          ? 3
          : lastIndex + 1,
      )
      .map((batch): ReconciliationBatch => {
        const id = batchId(record.slotId, batch.key),
          attemptRun = attempts.get(id),
          responseRun = responses.get(id),
          receiptRun = receipts.get(id);
        requireState(
          attemptRun && responseRun && receiptRun,
          "reconciliation_batch_missing",
        );
        const attempt = content<Attempt>(
            attemptRun,
            "attempt.json",
            "idol-weekly-attempt-v2",
            driver.mode,
          ),
          guardRun = runs.get("weekly-guards")!.get(attempt.guardId);
        requireState(guardRun, "reconciliation_guard_missing");
        return {
          plan: planRun.files["plan.json"],
          guard: guardRun.files["guard.json"],
          attempt: attemptRun.files["attempt.json"],
          response: responseRun.files["response.json"],
          receipt: receiptRun.files["receipt.json"],
        };
      });
    const prepare =
      record.schemaVersion === "idol-weekly-reconciliation-v1"
        ? prepareWeeklyReconciliation
        : prepareRecurringWeeklyReconciliation;
    const expected = prepare(
      batches,
      proofBytes,
      record.reviewedAt,
      driver.mode,
    );
    requireState(
      same(expected, record),
      "weekly_reconciliation_content_mismatch",
    );
    const id = batchId(record.slotId, record.requestKey);
    requireState(!reconciliations.has(id), "duplicate_weekly_reconciliation");
    reconciliations.set(id, record);
  };
  for (const [id, run] of runs.get("weekly-reconciliations")!) {
    requireState(
      same(Object.keys(run.files).sort(), [
        "official-accounting.json",
        "reconciliation.json",
      ]),
      "invalid_reconciliation_files",
    );
    const schema = json(run.files["reconciliation.json"]);
    requireState(
      object(schema) &&
        [
          "idol-weekly-reconciliation-v1",
          "idol-weekly-reconciliation-v2",
        ].includes(String(schema.schemaVersion)),
      "invalid_reconciliation_schema",
    );
    const record = content<WeeklyReconciliation>(
      run,
      "reconciliation.json",
      String(schema.schemaVersion),
      driver.mode,
    );
    requireState(
      id === batchId(record.slotId, record.requestKey),
      "orphan_weekly_reconciliation",
    );
    checkReconciliation(record, run.files["official-accounting.json"]);
  }
  if (proposedReconciliation)
    checkReconciliation(
      proposedReconciliation.record,
      proposedReconciliation.proofBytes,
    );
  let latestResponse: string | null = null;
  for (const id of new Set([
    ...attempts.keys(),
    ...responses.keys(),
    ...receipts.keys(),
  ])) {
    const attemptRun = attempts.get(id),
      responseRun = responses.get(id),
      receiptRun = receipts.get(id);
    requireState(attemptRun, `orphan_weekly_response:${id}`);
    requireState(
      same(Object.keys(attemptRun.files), ["attempt.json"]),
      "unexpected_weekly_attempt_files",
    );
    const attempt = content<Attempt>(
      attemptRun,
      "attempt.json",
      "idol-weekly-attempt-v2",
      driver.mode,
    );
    const plan = plans.get(attempt.slotId),
      guard = guards.get(attempt.guardId);
    requireState(plan && guard, "orphan_weekly_attempt");
    const batch = plan.batches.find((item) => item.key === attempt.requestKey);
    requireState(
      batch &&
        id === batchId(plan.slot.id, batch.key) &&
        guard.slotId === plan.slot.id &&
        attempt.planSha256 === weeklyObjectHash(plan) &&
        attempt.guardSha256 === weeklyObjectHash(guard) &&
        attempt.accountScope === guard.capability.accountScope &&
        object(account) &&
        account.accountScope === attempt.accountScope &&
        same(attempt.uids, batch.uids) &&
        same(attempt.groupIds, batch.groupIds) &&
        same(attempt.command, weeklyProfileArguments(batch.uids)) &&
        attempt.maximumCredits ===
          batch.uids.length * guard.capability.unitCost &&
        attempt.settlement === "pending_reconciliation" &&
        isTimestamp(attempt.startedAt) &&
        Date.parse(attempt.startedAt) >= Date.parse(guard.checkedAt) &&
        Date.parse(attempt.startedAt) < weeklyGuardDeadline(plan.slot, guard),
      "weekly_attempt_binding_mismatch",
    );
    requireState(responseRun && receiptRun, `weekly_uncertain_attempt:${id}`);
    requireState(
      same(Object.keys(responseRun.files), ["response.json"]) &&
        same(Object.keys(receiptRun.files), ["receipt.json"]),
      "unexpected_weekly_batch_files",
    );
    requireState(
      object(responseRun.metadata) && responseRun.metadata.mode === driver.mode,
      "weekly_response_mode_mismatch",
    );
    const receipt = content<Receipt>(
      receiptRun,
      "receipt.json",
      "idol-weekly-receipt-v2",
      driver.mode,
    );
    requireState(
      receipt.slotId === plan.slot.id &&
        receipt.requestKey === batch.key &&
        receipt.attemptSha256 === sha256(attemptRun.files["attempt.json"]) &&
        receipt.responseSha256 === sha256(responseRun.files["response.json"]) &&
        isTimestamp(receipt.observedAt) &&
        Date.parse(receipt.observedAt) >= Date.parse(attempt.startedAt) &&
        Date.parse(receipt.observedAt) <
          weeklyGuardDeadline(plan.slot, guard) &&
        Date.parse(receipt.observedAt) <= driver.now().getTime(),
      "weekly_receipt_binding_mismatch",
    );
    const reconciliation = reconciliations.get(id);
    requireState(
      Boolean(reconciliation) ||
        (receipt.outcome === "success" &&
          receipt.blocker === null &&
          receipt.settlement ===
            "response_received_not_financially_reconciled" &&
          receipt.actualChargedCredits === null),
      `weekly_uncertain_attempt:${id}`,
    );
    const profiles =
      reconciliation?.schemaVersion === "idol-weekly-reconciliation-v1"
        ? extractKnownWithheldProfiles(
            json(responseRun.files["response.json"]) as WeeklyRawResponse,
            batch.uids,
          )
        : reconciliation?.schemaVersion === "idol-weekly-reconciliation-v2"
          ? extractRecurringPartialProfiles(
              json(responseRun.files["response.json"]) as WeeklyRawResponse,
              batch.uids,
            ).profiles
          : extractWeeklyProfiles(
              json(responseRun.files["response.json"]),
              batch.uids,
            );
    const success = {
      attempt,
      receipt,
      profiles,
      attemptSha256: receipt.attemptSha256,
      responseSha256: receipt.responseSha256!,
      receiptSha256: sha256(receiptRun.files["receipt.json"]),
      ...(reconciliation
        ? {
            reconciliation,
            reconciliationSha256: weeklyObjectHash(reconciliation),
          }
        : {}),
    };
    hits.get(plan.slot.id)!.set(batch.key, success);
    if (
      !latestResponse ||
      Date.parse(receipt.observedAt) > Date.parse(latestResponse)
    )
      latestResponse = receipt.observedAt;
  }
  for (const [id, successes] of hits) {
    const plan = plans.get(id)!;
    const chronological = [...successes.values()].sort(
      (a, b) =>
        Date.parse(a.attempt.startedAt) - Date.parse(b.attempt.startedAt),
    );
    for (let index = 1; index < chronological.length; index += 1)
      requireState(
        Date.parse(chronological[index].attempt.startedAt) -
          Date.parse(chronological[index - 1].attempt.startedAt) >=
          plan.limits.intervalMs,
        "weekly_archived_interval_violation",
      );
    for (let index = 0; index < plan.batches.length; index += 1)
      if (successes.has(plan.batches[index].key))
        requireState(
          plan.batches
            .slice(0, index)
            .every((batch) => successes.has(batch.key)),
          "weekly_archived_batch_order_violation",
        );
  }
  const completed = new Map<string, WeeklySnapshot>();
  for (const [id, run] of runs.get("weekly-collections")!) {
    const plan = plans.get(id);
    requireState(
      plan && same(Object.keys(run.files), ["snapshot.json"]),
      "orphan_weekly_snapshot",
    );
    const expected = createSnapshot(plan, hits.get(id)!);
    const saved = content<WeeklySnapshot>(
      run,
      "snapshot.json",
      expected.schemaVersion,
      driver.mode,
    );
    requireState(same(saved, expected), "weekly_snapshot_content_mismatch");
    completed.set(id, expected);
  }
  return { plans, hits, completed, latestResponse };
}

/** 只读既有归档内容；调用期间持有同一周更锁，阻止合作写入者改变账本。 */
async function inspectExistingSlot(
  store: PipelineStore,
  driver: Driver,
  slotId: string,
): Promise<WeeklyRuntimeInspection> {
  requireState(
    /^(?:manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(slotId),
    "invalid_weekly_inspection_slot",
  );
  const legacy = await driver.legacyAudit();
  requireState(legacy.status === "clear", "legacy_weekly_ledger_blocked");
  const ledger = await auditLedger(store, driver);
  const plan = ledger.plans.get(slotId),
    snapshot = ledger.completed.get(slotId);
  requireState(plan && snapshot, "weekly_inspection_complete_slot_required");
  const records: { kind: string; id: string; intentSha256: string }[] = [];
  for (const kind of KINDS) {
    for (const run of await store.listRuns(kind)) {
      requireState(
        run.status === "complete",
        "weekly_inspection_archive_changed",
      );
      records.push({ kind, id: run.runId, intentSha256: run.intentSha256 });
    }
  }
  const final = await auditLedger(store, driver);
  requireState(
    same(final.plans.get(slotId), plan) &&
      same(final.completed.get(slotId), snapshot),
    "weekly_inspection_archive_changed",
  );
  return {
    mode: driver.mode,
    slotId,
    plan,
    snapshot,
    archiveSha256: sha256(
      encode({
        records: records.sort((a, b) =>
          `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`, "en"),
        ),
        accountSha256: sha256(
          (await readOptional(store, "account.json")) ?? Buffer.alloc(0),
        ),
        legacySourceSha256: legacy.sourceSha256,
        legacyInventorySha256: legacy.inventorySha256 ?? null,
        legacyModuleHashes: legacy.moduleHashes,
      }),
    ),
  };
}

/** 生产桥接固定provider根，不能注入synthetic检查器或改根；不创建新周期/管理探针/业务请求。 */
export async function withWeeklyRuntimeInspection<T>(
  slotId: string,
  action: WeeklyInspectionAction<T>,
): Promise<T> {
  const stat = await lstat(WEEKLY_RUNTIME_ROOT);
  requireState(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "weekly_inspection_existing_root_required",
  );
  const store = await createPipelineStore(WEEKLY_RUNTIME_ROOT);
  const unavailable = async (): Promise<never> => {
    throw new Error("weekly_inspection_io_forbidden");
  };
  const driver: Driver = {
    mode: "provider",
    now: () => new Date(),
    inputs: unavailable,
    capability: unavailable,
    queryProfiles: unavailable,
    wait: unavailable,
    legacyAudit: () => inspectLegacyWeeklyLedger(new Date()),
  };
  return await store.withStoreLock("weekly", async () => {
    const recheck = () => inspectExistingSlot(store, driver, slotId);
    return await action(await recheck(), recheck);
  });
}

export async function inspectWeeklyRuntimeSlot(
  slotId: string,
): Promise<WeeklyRuntimeInspection> {
  return await withWeeklyRuntimeInspection(
    slotId,
    async (inspection) => inspection,
  );
}

export interface RecurringWeeklyAccountingContext {
  expectedAccountScope: string;
  batches: {
    uids: string[];
    startedAt: string;
    observedAt: string;
    maximumCredits: number;
  }[];
}

/** 仅凭完整已有归档定位已请求前缀；此处不会重新请求任何账号。 */
async function recurringReconciliationInputs(
  store: PipelineStore,
  driver: Driver,
  slotId: string,
) {
  requireState(
    /^(?:manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(slotId),
    "invalid_recurring_slot",
  );
  const planRun = await store.readRun("weekly-plans", slotId);
  requireState(planRun.status === "complete", "reconciliation_plan_missing");
  const plan = planFromRun(planRun, driver.mode);
  const batches: ReconciliationBatch[] = [];
  const context: RecurringWeeklyAccountingContext = {
    expectedAccountScope: "",
    batches: [],
  };
  let missing = false;
  for (const batch of plan.batches) {
    const id = batchId(slotId, batch.key);
    const attemptRun = await store.readRun("weekly-attempts", id);
    if (attemptRun.status === "missing") {
      missing = true;
      continue;
    }
    requireState(
      !missing && attemptRun.status === "complete",
      "incomplete_recurring_request_prefix",
    );
    const responseRun = await store.readRun("weekly-responses", id);
    const receiptRun = await store.readRun("weekly-receipts", id);
    requireState(
      responseRun.status === "complete" && receiptRun.status === "complete",
      "reconciliation_batch_missing",
    );
    const attempt = content<Attempt>(
      attemptRun,
      "attempt.json",
      "idol-weekly-attempt-v2",
      driver.mode,
    );
    const receipt = content<Receipt>(
      receiptRun,
      "receipt.json",
      "idol-weekly-receipt-v2",
      driver.mode,
    );
    const guardRun = await store.readRun("weekly-guards", attempt.guardId);
    requireState(
      guardRun.status === "complete",
      "reconciliation_guard_missing",
    );
    const guard = validateGuard(guardRun, plan, driver.mode);
    requireState(
      attempt.slotId === slotId &&
        attempt.requestKey === batch.key &&
        attempt.planSha256 === weeklyObjectHash(plan) &&
        attempt.guardSha256 === weeklyObjectHash(guard) &&
        attempt.accountScope === guard.capability.accountScope &&
        same(attempt.uids, batch.uids) &&
        same(attempt.groupIds, batch.groupIds) &&
        same(attempt.command, weeklyProfileArguments(batch.uids)) &&
        receipt.slotId === slotId &&
        receipt.requestKey === batch.key &&
        receipt.attemptSha256 === sha256(attemptRun.files["attempt.json"]) &&
        receipt.responseSha256 === sha256(responseRun.files["response.json"]) &&
        isTimestamp(attempt.startedAt) &&
        isTimestamp(receipt.observedAt) &&
        Date.parse(attempt.startedAt) <= Date.parse(receipt.observedAt) &&
        Date.parse(receipt.observedAt) <= driver.now().getTime() &&
        (!context.expectedAccountScope ||
          context.expectedAccountScope === attempt.accountScope),
      "recurring_archive_binding_mismatch",
    );
    if (receipt.outcome === "success")
      extractWeeklyProfiles(
        json(responseRun.files["response.json"]),
        batch.uids,
      );
    else {
      requireState(receipt.outcome === "blocked", "recurring_receipt_invalid");
      const partial = extractRecurringPartialProfiles(
        json(responseRun.files["response.json"]) as WeeklyRawResponse,
        batch.uids,
      );
      requireState(
        partial.unavailable.length > 0,
        "recurring_response_not_partial",
      );
    }
    context.expectedAccountScope = attempt.accountScope;
    context.batches.push({
      uids: batch.uids,
      startedAt: attempt.startedAt,
      observedAt: receipt.observedAt,
      maximumCredits: attempt.maximumCredits,
    });
    batches.push({
      plan: planRun.files["plan.json"],
      guard: guardRun.files["guard.json"],
      attempt: attemptRun.files["attempt.json"],
      response: responseRun.files["response.json"],
      receipt: receiptRun.files["receipt.json"],
    });
  }
  requireState(
    batches.length > 0 && batches.length <= WEEKLY_LIMITS.maximumBatches,
    "invalid_recurring_request_prefix",
  );
  const last = json(batches.at(-1)!.receipt) as Receipt;
  requireState(last.outcome === "blocked", "recurring_last_batch_not_blocked");
  return { batches, context, id: batchId(slotId, last.requestKey) };
}

async function appendRecurringWeeklyReconciliation(
  store: PipelineStore,
  driver: Driver,
  slotId: string,
  loadProof: (context: RecurringWeeklyAccountingContext) => Promise<Buffer>,
) {
  return await store.withStoreLock("weekly", async () => {
    const inputs = await recurringReconciliationInputs(store, driver, slotId);
    const existing = await store.readRun("weekly-reconciliations", inputs.id);
    if (existing.status === "complete") {
      await auditLedger(store, driver);
      const record = content<RecurringWeeklyReconciliation>(
        existing,
        "reconciliation.json",
        "idol-weekly-reconciliation-v2",
        driver.mode,
      );
      return {
        status: "complete" as const,
        reused: true,
        requests: 0,
        managementQueries: 0,
        slotId,
        reconciliationSha256: weeklyObjectHash(record),
      };
    }
    requireState(
      existing.status === "missing",
      "incomplete_weekly_reconciliation",
    );
    const proofBytes = await loadProof(inputs.context);
    const record = prepareRecurringWeeklyReconciliation(
      inputs.batches,
      proofBytes,
      driver.now().toISOString(),
      driver.mode,
    );
    // 完整核验所有历史账本，且双读原件一致后才追加处置；原失败回执永不改写。
    await auditLedger(store, driver, null, { record, proofBytes });
    const recheck = await recurringReconciliationInputs(store, driver, slotId);
    requireState(
      same(
        recheck.batches.map((batch) => Object.values(batch).map(sha256)),
        inputs.batches.map((batch) => Object.values(batch).map(sha256)),
      ),
      "recurring_archive_changed",
    );
    await commit(
      store,
      "weekly-reconciliations",
      inputs.id,
      "reconciliation.json",
      record,
      driver.mode,
      { "official-accounting.json": proofBytes },
    );
    await auditLedger(store, driver);
    return {
      status: "complete" as const,
      reused: false,
      requests: 0,
      managementQueries: 3,
      slotId,
      reconciliationSha256: weeklyObjectHash(record),
    };
  });
}

/** 服务器正常登录只读核账；生产入口不接受外部价格、账单或原始响应。 */
export async function reconcileRecurringWeeklyBatch(
  slotId: string,
  profileRoot: string,
) {
  const unavailable = async (): Promise<never> => {
    throw new Error("reconciliation_business_query_forbidden");
  };
  const driver: Driver = {
    mode: "provider",
    now: () => new Date(),
    inputs: unavailable,
    capability: unavailable,
    queryProfiles: unavailable,
    wait: unavailable,
    legacyAudit: () => inspectLegacyWeeklyLedger(new Date()),
  };
  const { collectWeeklyAccounting } =
    await import("../server/weeklyAccounting.ts");
  return await appendRecurringWeeklyReconciliation(
    await createPipelineStore(WEEKLY_RUNTIME_ROOT),
    driver,
    slotId,
    async (context) =>
      await collectWeeklyAccounting({
        stageRoot: WEEKLY_STAGE,
        profileRoot,
        ...context,
      }).catch((error: unknown) => {
        // 已验证为部分账号响应；核账暂不可用不抹掉可恢复阶段。
        throw new Error("incomplete_weekly_response", { cause: error });
      }),
  );
}

async function appendKnownWithheldReconciliation(
  store: PipelineStore,
  driver: Driver,
  proofBytes: Buffer,
) {
  return await store.withStoreLock("weekly", async () => {
    const planRun = await store.readRun("weekly-plans", WITHHELD_SLOT);
    requireState(planRun.status === "complete", "reconciliation_plan_missing");
    const plan = planFromRun(planRun, driver.mode);
    const batches: ReconciliationBatch[] = [];
    for (const batch of plan.batches.slice(0, 3)) {
      const id = batchId(WITHHELD_SLOT, batch.key);
      const attemptRun = await store.readRun("weekly-attempts", id),
        responseRun = await store.readRun("weekly-responses", id),
        receiptRun = await store.readRun("weekly-receipts", id);
      requireState(
        attemptRun.status === "complete" &&
          responseRun.status === "complete" &&
          receiptRun.status === "complete",
        "reconciliation_batch_missing",
      );
      const attempt = content<Attempt>(
        attemptRun,
        "attempt.json",
        "idol-weekly-attempt-v2",
        driver.mode,
      );
      const guard = await store.readRun("weekly-guards", attempt.guardId);
      requireState(guard.status === "complete", "reconciliation_guard_missing");
      batches.push({
        plan: planRun.files["plan.json"],
        guard: guard.files["guard.json"],
        attempt: attemptRun.files["attempt.json"],
        response: responseRun.files["response.json"],
        receipt: receiptRun.files["receipt.json"],
      });
    }
    requireState(plan.batches.length > 2, "reconciliation_third_batch_missing");
    const id = batchId(WITHHELD_SLOT, plan.batches[2].key),
      existing = await store.readRun("weekly-reconciliations", id);
    const reviewedAt =
      existing.status === "complete"
        ? content<WeeklyReconciliation>(
            existing,
            "reconciliation.json",
            "idol-weekly-reconciliation-v1",
            driver.mode,
          ).reviewedAt
        : driver.now().toISOString();
    const record = prepareWeeklyReconciliation(
      batches,
      proofBytes,
      reviewedAt,
      driver.mode,
    );
    if (existing.status === "complete") {
      requireState(
        existing.files["reconciliation.json"].equals(
          weeklyEvidenceBytes(record),
        ) && existing.files["official-accounting.json"]?.equals(proofBytes),
        "conflicting_weekly_reconciliation",
      );
      await auditLedger(store, driver);
      return {
        status: "complete",
        reused: true,
        requests: 0,
        managementQueries: 0,
        slotId: WITHHELD_SLOT,
        reconciliationSha256: weeklyObjectHash(record),
      };
    }
    requireState(
      existing.status === "missing",
      "incomplete_weekly_reconciliation",
    );
    await auditLedger(store, driver, null, { record, proofBytes });
    // 同锁再次读取完整归档；旧attempt/response/receipt从不替换，只有新核账运行追加。
    await auditLedger(store, driver, null, { record, proofBytes });
    await commit(
      store,
      "weekly-reconciliations",
      id,
      "reconciliation.json",
      record,
      driver.mode,
      { "official-accounting.json": proofBytes },
    );
    await auditLedger(store, driver);
    return {
      status: "complete",
      reused: false,
      requests: 0,
      managementQueries: 0,
      slotId: WITHHELD_SLOT,
      reconciliationSha256: weeklyObjectHash(record),
    };
  });
}

/** 人工显式审核后的专用追加入口：固定根与固定官方证据，零管理、零业务。 */
export async function reconcileKnownWithheldWeeklyBatch(
  expectedProofSha256: string,
) {
  requireState(
    /^[a-f0-9]{64}$/u.test(expectedProofSha256),
    "reconciliation_evidence_sha_required",
  );
  const proofBytes = await readStageFile(
    WEEKLY_STAGE,
    ACCOUNTING_PROOF_PATH,
    1024 * 1024,
  );
  requireState(
    sha256(proofBytes) === expectedProofSha256,
    "reconciliation_evidence_sha_mismatch",
  );
  const stat = await lstat(WEEKLY_RUNTIME_ROOT);
  requireState(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "reconciliation_existing_root_required",
  );
  const unavailable = async (): Promise<never> => {
    throw new Error("reconciliation_network_forbidden");
  };
  return await appendKnownWithheldReconciliation(
    await createPipelineStore(WEEKLY_RUNTIME_ROOT),
    {
      mode: "provider",
      now: () => new Date(),
      inputs: unavailable,
      capability: unavailable,
      queryProfiles: unavailable,
      wait: unavailable,
      legacyAudit: unavailable,
    },
    proofBytes,
  );
}

async function execute(
  store: PipelineStore,
  driver: Driver,
  options: {
    trigger: "manual" | "scheduled";
    live: boolean;
    budgetCredits?: number | "auto";
    expectedSlot?: string;
    recoverCollection?: boolean;
    recoverSlot?: string;
    resumeSlot?: string;
  },
): Promise<WeeklyRuntimeResult> {
  let requests = 0,
    slotId: string | null = null;
  let cachedBatches = 0,
    pendingBatches = 0;
  let plan: WeeklyPlan | undefined;
  try {
    return await store.withStoreLock("weekly", async () => {
      let recoveredPlan: WeeklyPlan | undefined;
      if (options.resumeSlot !== undefined) {
        const executionSlot = weeklySlot("scheduled", driver.now());
        requireState(
          options.trigger === "scheduled" &&
            options.recoverCollection !== true &&
            options.recoverSlot === undefined &&
            /^scheduled-\d{4}-\d{2}-\d{2}$/u.test(options.resumeSlot) &&
            options.expectedSlot === options.resumeSlot &&
            options.resumeSlot <= executionSlot.id,
          "weekly_resume_slot_not_allowed",
        );
        const existingPlan = await store.readRun(
          "weekly-plans",
          options.resumeSlot,
        );
        requireState(
          existingPlan.status === "complete",
          "weekly_resume_existing_plan_required",
        );
        recoveredPlan = planFromRun(existingPlan, driver.mode);
        requireState(
          recoveredPlan.slot.id === options.resumeSlot &&
            recoveredPlan.slot.trigger === options.trigger,
          "weekly_resume_slot_mismatch",
        );
      }
      if (options.recoverSlot !== undefined) {
        requireState(
          options.recoverCollection === true &&
            options.live === false &&
            /^(?:manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(
              options.recoverSlot,
            ),
          "weekly_recovery_slot_not_allowed",
        );
        const existingPlan = await store.readRun(
          "weekly-plans",
          options.recoverSlot,
        );
        requireState(
          existingPlan.status === "complete",
          "weekly_recovery_existing_plan_required",
        );
        recoveredPlan = planFromRun(existingPlan, driver.mode);
        requireState(
          recoveredPlan.slot.id === options.recoverSlot &&
            recoveredPlan.slot.trigger === options.trigger,
          "weekly_recovery_slot_mismatch",
        );
      }
      const executionSlot =
        options.recoverSlot !== undefined
          ? recoveredPlan!.slot
          : weeklySlot(options.trigger, driver.now());
      const slot = recoveredPlan?.slot ?? executionSlot;
      slotId = slot.id;
      requireState(
        options.expectedSlot === undefined || options.expectedSlot === slot.id,
        "weekly_expected_slot_mismatch",
      );
      let legacyAudit = await driver.legacyAudit();
      requireState(
        legacyAudit.status === "clear",
        "legacy_weekly_ledger_blocked",
      );
      let ledger = await auditLedger(
        store,
        driver,
        options.recoverCollection ? slot.id : null,
      );
      const saved = ledger.plans.get(slot.id);
      const inputs = recoveredPlan ? undefined : await driver.inputs();
      plan =
        recoveredPlan ??
        buildWeeklyRuntimePlan(
          inputs!,
          slot,
          saved?.scope.frozenAt ?? driver.now().toISOString(),
        );
      if (saved) requireState(same(plan, saved), "frozen_weekly_scope_changed");
      else {
        requireState(
          !options.recoverCollection && options.resumeSlot === undefined,
          "weekly_recovery_plan_missing",
        );
        const sourceFiles = Object.fromEntries(
          Object.entries(inputs!.files).map(([name, bytes]) => [
            `sources/${name}`,
            bytes,
          ]),
        );
        await commit(
          store,
          "weekly-plans",
          slot.id,
          "plan.json",
          plan,
          driver.mode,
          sourceFiles,
        );
        ledger = await auditLedger(store, driver);
      }
      const hits = ledger.hits.get(slot.id)!;
      cachedBatches = hits.size;
      const pending = plan.batches.filter((batch) => !hits.has(batch.key));
      pendingBatches = pending.length;
      if (ledger.completed.has(slot.id))
        return {
          status: "complete",
          slotId,
          reused: true,
          requests: 0,
          plan,
          snapshot: ledger.completed.get(slot.id),
          cachedBatches,
          pendingBatches: 0,
        };
      requireState(
        plan.blockers.length === 0,
        plan.blockers[0] ?? "weekly_scope_blocked",
      );
      if (options.recoverCollection) {
        requireState(pending.length === 0, "weekly_recovery_missing_batches");
        const snapshot = createSnapshot(plan, hits);
        await commit(
          store,
          "weekly-collections",
          slot.id,
          "snapshot.json",
          snapshot,
          driver.mode,
        );
        await auditLedger(store, driver);
        return {
          status: "complete",
          slotId,
          reused: true,
          requests: 0,
          plan,
          snapshot,
          cachedBatches,
          pendingBatches: 0,
        };
      }
      if (!options.live)
        return {
          status: "planned",
          slotId,
          reused: Boolean(saved),
          requests: 0,
          plan,
          cachedBatches,
          pendingBatches,
        };
      if (pending.length) {
        const bundle = await driver.capability();
        const checkedAt = driver.now().toISOString();
        requireState(
          !ledger.latestResponse ||
            Date.parse(bundle.capability.observedAt) >=
              Date.parse(ledger.latestResponse),
          "weekly_balance_predates_previous_response",
        );
        const pendingAccounts = pending.reduce(
          (sum, batch) => sum + batch.uids.length,
          0,
        );
        const budget = weeklyBudget(
          bundle.capability,
          pendingAccounts,
          options.budgetCredits ?? 0,
          new Date(checkedAt),
          driver.mode,
        );
        const files: Record<string, Buffer> = {};
        requireState(
          same(
            Object.keys(bundle.files).sort(),
            bundle.capability.evidence.map((item) => item.path).sort(),
          ),
          "weekly_capability_file_set_mismatch",
        );
        for (const proof of bundle.capability.evidence) {
          requireState(
            /^[a-z0-9][a-z0-9._-]{0,90}\.json$/u.test(proof.path) &&
              bundle.files[proof.path] &&
              sha256(bundle.files[proof.path]) === proof.sha256,
            "weekly_capability_proof_mismatch",
          );
          weeklyEvidenceBytes(json(bundle.files[proof.path]));
          files[`evidence/${proof.path}`] = bundle.files[proof.path];
        }
        await store.putImmutable(
          "account.json",
          weeklyEvidenceBytes({
            schemaVersion: "idol-weekly-account-v2",
            mode: driver.mode,
            accountScope: bundle.capability.accountScope,
          }),
        );
        const guard: Guard = {
          schemaVersion: "idol-weekly-guard-v2",
          slotId: slot.id,
          planSha256: weeklyObjectHash(plan),
          checkedAt,
          capability: bundle.capability,
          budget,
          pendingAccounts,
          legacyAudit,
          ...(options.resumeSlot
            ? { resume: { slotId: slot.id, executionSlotId: executionSlot.id } }
            : {}),
        };
        const guardId = weeklyObjectHash(guard);
        const guardRun = await commit(
          store,
          "weekly-guards",
          guardId,
          "guard.json",
          guard,
          driver.mode,
          files,
        );
        validateGuard(guardRun, plan, driver.mode);
        let lastRequestAt = hits.size
          ? Math.max(
              ...[...hits.values()].map((hit) =>
                Date.parse(hit.attempt.startedAt),
              ),
            )
          : null;
        for (const batch of pending) {
          if (lastRequestAt !== null)
            await driver.wait(
              Math.max(
                0,
                WEEKLY_LIMITS.intervalMs -
                  (driver.now().getTime() - lastRequestAt),
              ),
            );
          requireState(
            lastRequestAt === null ||
              driver.now().getTime() - lastRequestAt >=
                WEEKLY_LIMITS.intervalMs,
            "weekly_interval_not_elapsed",
          );
          requireState(
            same(weeklySlot(options.trigger, driver.now()), executionSlot),
            "weekly_slot_changed_during_run",
          );
          legacyAudit = await driver.legacyAudit();
          requireState(
            legacyAudit.status === "clear",
            "legacy_weekly_ledger_blocked",
          );
          const freshInputs = await driver.inputs();
          requireState(
            same(
              buildWeeklyRuntimePlan(freshInputs, slot, plan.scope.frozenAt),
              plan,
            ),
            "frozen_weekly_scope_changed",
          );
          requireState(
            cachedBatches + requests < plan.maximumBatches,
            "weekly_business_batch_limit",
          );
          const startedAt = driver.now().toISOString();
          requireState(
            Date.parse(startedAt) >= Date.parse(checkedAt),
            "weekly_clock_regressed_before_request",
          );
          weeklyBudget(
            bundle.capability,
            pendingAccounts,
            budget.budgetCredits,
            new Date(startedAt),
            driver.mode,
          );
          const attempt: Attempt = {
            schemaVersion: "idol-weekly-attempt-v2",
            slotId: slot.id,
            requestKey: batch.key,
            planSha256: weeklyObjectHash(plan),
            guardId,
            guardSha256: guardId,
            accountScope: bundle.capability.accountScope,
            startedAt,
            uids: batch.uids,
            groupIds: batch.groupIds,
            command: weeklyProfileArguments(batch.uids),
            maximumCredits: batch.uids.length * bundle.capability.unitCost,
            settlement: "pending_reconciliation",
          };
          const id = batchId(slot.id, batch.key);
          const attemptRun = await commit(
            store,
            "weekly-attempts",
            id,
            "attempt.json",
            attempt,
            driver.mode,
          );
          requests += 1;
          lastRequestAt = Date.parse(startedAt);
          let raw: unknown;
          try {
            raw = await driver.queryProfiles([...batch.uids]);
          } catch {
            raw = {
              cliVersion: "0.9.1",
              stdout: "",
              stderr: "",
              exitCode: 1,
              timedOut: true,
              signal: null,
            };
          }
          const observedAt = driver.now().toISOString();
          let responseSha256: string | null = null,
            profiles: WeeklyProfile[] = [],
            failure: string | null = null;
          try {
            const response = await commit(
              store,
              "weekly-responses",
              id,
              "response.json",
              raw,
              driver.mode,
            );
            responseSha256 = sha256(response.files["response.json"]);
            // 新响应仅消费根层账号；历史完整响应保留原核验语义。
            const partial = extractRecurringPartialProfiles(
              json(response.files["response.json"]) as WeeklyRawResponse,
              batch.uids,
            );
            requireState(
              partial.unavailable.length === 0,
              "incomplete_weekly_response",
            );
            profiles = partial.profiles;
            requireState(
              same(
                weeklySlot(options.trigger, new Date(observedAt)),
                executionSlot,
              ) && Date.parse(observedAt) >= Date.parse(startedAt),
              "weekly_response_time_outside_slot",
            );
          } catch (error) {
            failure = weeklyFailureCode(error);
          }
          const receipt: Receipt = {
            schemaVersion: "idol-weekly-receipt-v2",
            slotId: slot.id,
            requestKey: batch.key,
            attemptSha256: sha256(attemptRun.files["attempt.json"]),
            responseSha256,
            observedAt,
            outcome: failure ? "blocked" : "success",
            blocker: failure,
            settlement: failure
              ? "uncertain_requires_reconciliation"
              : "response_received_not_financially_reconciled",
            actualChargedCredits: null,
          };
          const receiptRun = await commit(
            store,
            "weekly-receipts",
            id,
            "receipt.json",
            receipt,
            driver.mode,
          );
          requireState(!failure, failure ?? "weekly_response_failed");
          hits.set(batch.key, {
            attempt,
            receipt,
            profiles,
            attemptSha256: receipt.attemptSha256,
            responseSha256: responseSha256!,
            receiptSha256: sha256(receiptRun.files["receipt.json"]),
          });
        }
      }
      const snapshot = createSnapshot(plan, hits);
      await commit(
        store,
        "weekly-collections",
        slot.id,
        "snapshot.json",
        snapshot,
        driver.mode,
      );
      await auditLedger(store, driver);
      return {
        status: "complete",
        slotId,
        reused: requests === 0,
        requests,
        plan,
        snapshot,
        cachedBatches,
        pendingBatches: 0,
      };
    });
  } catch (error) {
    return {
      status: "blocked",
      slotId,
      reused: false,
      requests,
      blocker: weeklyFailureCode(error),
      plan,
      cachedBatches,
      pendingBatches,
    };
  }
}

/** 唯一生产入口固定根；合同缺失时在创建业务adapter及请求前停止。 */
export async function runWeeklyRuntime(options: {
  trigger: "manual" | "scheduled";
  live: boolean;
  budgetCredits?: number | "auto";
  expectedSlot?: string;
  evidence?: unknown;
  recoverCollection?: boolean;
  recoverSlot?: string;
  resumeSlot?: string;
}): Promise<WeeklyRuntimeResult> {
  requireState(
    !Object.hasOwn(options, "evidence"),
    "external_weekly_provider_evidence_rejected",
  );
  const store = await createPipelineStore(WEEKLY_RUNTIME_ROOT);
  const driver: Driver = {
    mode: "provider",
    now: () => new Date(),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    inputs: readWeeklyRuntimeInputs,
    capability: collectCurrentWeeklyProviderCapability,
    queryProfiles: queryWeeklyProfiles,
    legacyAudit: () => inspectLegacyWeeklyLedger(new Date()),
  };
  return await execute(store, driver, options);
}

/** 合成验证只能写专门夹具目录，模式写进每份意图；没有网络或生产adapter。 */
export async function createSyntheticWeeklyRuntime(options: {
  root: string;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
  inputs: () => Promise<WeeklyInputs>;
  capability: () => Promise<CapabilityBundle>;
  queryProfiles: (uids: string[]) => Promise<WeeklyRawResponse>;
  legacyAudit?: () => Promise<LegacyWeeklyAudit>;
  storeOptions?: Parameters<typeof createPipelineStore>[1];
}): Promise<{
  store: PipelineStore;
  inspect: (slotId: string) => Promise<WeeklyRuntimeInspection>;
  reconcile: (
    proofBytes: Buffer,
  ) => Promise<Awaited<ReturnType<typeof appendKnownWithheldReconciliation>>>;
  reconcileRecurring: (
    slotId: string,
    proofBytes: Buffer,
  ) => Promise<Awaited<ReturnType<typeof appendRecurringWeeklyReconciliation>>>;
  withInspection: <T>(
    slotId: string,
    action: WeeklyInspectionAction<T>,
  ) => Promise<T>;
  run: (request: {
    trigger: "manual" | "scheduled";
    live: boolean;
    budgetCredits?: number | "auto";
    expectedSlot?: string;
    recoverCollection?: boolean;
    recoverSlot?: string;
    resumeSlot?: string;
  }) => Promise<WeeklyRuntimeResult>;
}> {
  const target = resolve(options.root),
    relation = relative(FIXTURE_ROOT, target);
  requireState(
    relation &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !relation.includes(":") &&
      target !== WEEKLY_RUNTIME_ROOT,
    "synthetic_weekly_root_refused",
  );
  const store = await createPipelineStore(target, options.storeOptions);
  const driver: Driver = {
    mode: "synthetic",
    now: options.now,
    wait: options.wait,
    inputs: options.inputs,
    capability: options.capability,
    queryProfiles: options.queryProfiles,
    legacyAudit:
      options.legacyAudit ??
      (async () => ({
        schemaVersion: "idol-legacy-weekly-audit-v2",
        inspectedAt: options.now().toISOString(),
        status: "clear",
        sourceSha256: "a".repeat(64),
        moduleHashes: [],
      })),
  };
  const withInspection = async <T>(
    slotId: string,
    action: WeeklyInspectionAction<T>,
  ): Promise<T> =>
    await store.withStoreLock("weekly", async () => {
      const recheck = () => inspectExistingSlot(store, driver, slotId);
      return await action(await recheck(), recheck);
    });
  return {
    store,
    run: (request) => execute(store, driver, request),
    reconcile: (proofBytes) =>
      appendKnownWithheldReconciliation(store, driver, proofBytes),
    reconcileRecurring: (slotId, proofBytes) =>
      appendRecurringWeeklyReconciliation(
        store,
        driver,
        slotId,
        async () => proofBytes,
      ),
    inspect: (slotId) =>
      withInspection(slotId, async (inspection) => inspection),
    withInspection,
  };
}

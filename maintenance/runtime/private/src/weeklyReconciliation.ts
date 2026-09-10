import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import {
  extractWeeklyProfiles,
  weeklyEvidenceBytes,
  weeklyProfileArguments,
  weeklyBudget,
  type WeeklyCapability,
  type WeeklyProfile,
  type WeeklyRawResponse,
} from "./weeklyContract.ts";
import { WEEKLY_LIMITS, weeklySlot } from "./weeklyScope.ts";

export const WITHHELD_SLOT = "manual-2026-09-09";
export const WITHHELD_UID = "7817455308";
export const WITHHELD_GROUP = "g384";
export const ACCOUNTING_PROOF_PATH =
  "reports/root-review/weekly-live-20260909/official-accounting-first3.json";
const RESPONSE_SHA =
  "06f4b315aed8da71a1a0e1d51837c776ce598da873511246b73d0252cb2f3fee";
const ACCOUNTING_SHA =
  "2ccaa831cb759134409d467f3ea126ee844ba3d0661879dcec9e5cc4dba140bd";
const same = (a: unknown, b: unknown): boolean => encode(a) === encode(b);
const keys = (
  value: unknown,
  names: string[],
): value is Record<string, unknown> =>
  object(value) && same(Object.keys(value).sort(), [...names].sort());
const parse = (bytes: Buffer): Record<string, unknown> => {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  weeklyEvidenceBytes(value);
  requireState(object(value), "invalid_weekly_reconciliation_json");
  return value;
};

/** 旧保护记录仍用原闭槽时间；续采必须明确绑定原计划与实际执行周。 */
export function weeklyGuardDeadline(slot: unknown, guard: unknown): number {
  requireState(
    object(slot) && object(guard) && isTimestamp(slot.closesAt),
    "weekly_resume_guard_invalid",
  );
  if (!Object.hasOwn(guard, "resume")) return Date.parse(slot.closesAt);
  requireState(
    keys(guard.resume, ["slotId", "executionSlotId"]) &&
      slot.trigger === "scheduled" &&
      guard.resume.slotId === slot.id &&
      isTimestamp(guard.checkedAt),
    "weekly_resume_guard_invalid",
  );
  const executionSlot = weeklySlot("scheduled", new Date(guard.checkedAt));
  requireState(
    guard.resume.executionSlotId === executionSlot.id &&
      typeof slot.id === "string" &&
      slot.id <= executionSlot.id,
    "weekly_resume_guard_slot_mismatch",
  );
  return Date.parse(executionSlot.closesAt);
}
export interface ReconciliationBatch {
  plan: Buffer;
  guard: Buffer;
  attempt: Buffer;
  response: Buffer;
  receipt: Buffer;
}
export interface HistoricalWeeklyReconciliation {
  schemaVersion: "idol-weekly-reconciliation-v1";
  slotId: typeof WITHHELD_SLOT;
  requestKey: string;
  reviewedAt: string;
  reason: "known_provider_withheld";
  bindings: {
    planSha256: string;
    guardSha256: string;
    attemptSha256: string;
    responseSha256: string;
    receiptSha256: string;
  };
  accountingSha256: string;
  accounting: {
    usageIds: string[];
    ledgerIds: string[];
    chargedCredits: 150;
    totalChargedCredits: 450;
    balanceBefore: 21581;
    balanceAfter: 21131;
  };
  withheld: {
    id: typeof WITHHELD_GROUP;
    uid: typeof WITHHELD_UID;
    reason: "provider_european_user";
    observedAt: string;
  };
}

export interface RecurringWeeklyReconciliation extends Omit<
  HistoricalWeeklyReconciliation,
  "schemaVersion" | "slotId" | "accounting" | "reason" | "withheld"
> {
  schemaVersion: "idol-weekly-reconciliation-v2";
  slotId: string;
  reason: "provider_partial_profiles";
  accounting: {
    usageIds: string[];
    ledgerIds: string[];
    chargedCredits: number;
    totalChargedCredits: number;
    balanceBefore: number;
    balanceAfter: number;
  };
  unavailable: {
    id: string;
    uid: string;
    reason: string;
    observedAt: string;
  }[];
}

export type WeeklyReconciliation =
  HistoricalWeeklyReconciliation | RecurringWeeklyReconciliation;

/** 只识别已复核的精确两字段哨兵；49份正常资料仍经过原严格解析器。 */
export function extractKnownWithheldProfiles(
  raw: WeeklyRawResponse,
  expectedUids: string[],
) {
  weeklyProfileArguments(expectedUids);
  weeklyEvidenceBytes(raw);
  requireState(
    expectedUids.length === 50 && expectedUids.includes(WITHHELD_UID),
    "withheld_request_scope_mismatch",
  );
  const payload: unknown = JSON.parse(raw.stdout);
  requireState(
    keys(payload, ["total_number", "users", "states"]) &&
      payload.total_number === 50 &&
      Array.isArray(payload.users) &&
      payload.users.length === 50 &&
      Array.isArray(payload.states),
    "invalid_withheld_response_shape",
  );
  const sentinels = payload.users.filter(
    (row: unknown) => object(row) && "european_user" in row,
  );
  requireState(
    sentinels.length === 1 &&
      keys(sentinels[0], ["european_user", "id"]) &&
      sentinels[0].european_user === true &&
      sentinels[0].id === Number(WITHHELD_UID),
    "unknown_weekly_withheld_sentinel",
  );
  const users = payload.users.filter((row: unknown) => row !== sentinels[0]);
  requireState(
    users.every((row: unknown) => object(row) && "followers_count" in row),
    "unknown_weekly_missing_profile",
  );
  const stateUids: string[] = [];
  for (const row of payload.states) {
    requireState(
      object(row) && Object.keys(row).length === 1,
      "invalid_withheld_states",
    );
    const uid = Object.keys(row)[0];
    requireState(
      expectedUids.includes(uid) &&
        !stateUids.includes(uid) &&
        [1, 2].includes(Number(row[uid])) &&
        typeof row[uid] === "number",
      "invalid_withheld_states",
    );
    stateUids.push(uid);
  }
  requireState(stateUids.length === 50, "incomplete_withheld_states");
  return extractWeeklyProfiles(
    { ...raw, stdout: JSON.stringify({ ...payload, users }) },
    expectedUids.filter((uid) => uid !== WITHHELD_UID),
  );
}

/** 独立核对三次请求、唯一官方匹配与余额链；不把根任务的验证结论当证据。 */
export function prepareWeeklyReconciliation(
  batches: ReconciliationBatch[],
  proofBytes: Buffer,
  reviewedAt: string,
  mode: "provider" | "synthetic",
): HistoricalWeeklyReconciliation {
  requireState(
    batches.length === 3 && isTimestamp(reviewedAt),
    "invalid_reconciliation_scope",
  );
  const proof = parse(proofBytes);
  requireState(
    keys(proof, [
      "schemaVersion",
      "projectionAt",
      "accountScopeHash",
      "sourceKind",
      "sources",
      "ledger",
      "usage",
      "notes",
    ]) &&
      proof.schemaVersion === "idol-official-accounting-observation-v1" &&
      proof.sourceKind === "official_browser_response_whitelist_projection" &&
      isTimestamp(proof.projectionAt) &&
      Date.parse(proof.projectionAt) <= Date.parse(reviewedAt) &&
      same(proof.sources, {
        ledger:
          "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
        usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
        page: "https://open.weibo.com/cli/logs",
      }) &&
      Array.isArray(proof.notes) &&
      proof.notes.every((note: unknown) => typeof note === "string") &&
      Array.isArray(proof.ledger) &&
      proof.ledger.length === 3 &&
      Array.isArray(proof.usage) &&
      proof.usage.length === 3,
    "invalid_official_accounting_proof",
  );
  const ledger = proof.ledger as Record<string, unknown>[],
    usage = proof.usage as Record<string, unknown>[];
  for (const row of ledger)
    requireState(
      keys(row, [
        "id",
        "source_id",
        "createdAt",
        "delta",
        "balanceAfter",
        "description",
        "type",
        "sourceType",
        "accountMatched",
      ]) &&
        typeof row.id === "string" &&
        /^\d+$/u.test(row.id) &&
        typeof row.source_id === "string" &&
        /^[a-f0-9-]{36}$/u.test(row.source_id) &&
        isTimestamp(row.createdAt) &&
        row.delta === "-150" &&
        typeof row.balanceAfter === "string" &&
        /^\d+$/u.test(row.balanceAfter) &&
        row.description ===
          "[users/show_batch/other] per_record: 50 records × 3 pts" &&
        row.type === "api_deduct" &&
        row.sourceType === "api_call" &&
        row.accountMatched === true,
      "invalid_official_ledger_row",
    );
  for (const row of usage)
    requireState(
      keys(row, [
        "id",
        "createdAt",
        "method",
        "commandPath",
        "status",
        "recordCount",
        "billingType",
        "creditsDeducted",
        "requestParams",
        "accountMatched",
      ]) &&
        typeof row.id === "string" &&
        /^\d+$/u.test(row.id) &&
        isTimestamp(row.createdAt) &&
        row.method === "GET" &&
        row.commandPath === "users/show_batch/other" &&
        row.status === 200 &&
        row.recordCount === 50 &&
        row.billingType === 1 &&
        row.creditsDeducted === 150 &&
        keys(row.requestParams, ["uids"]) &&
        typeof row.requestParams.uids === "string" &&
        row.accountMatched === true,
      "invalid_official_usage_row",
    );
  requireState(
    new Set(ledger.map((row) => row.id)).size === 3 &&
      new Set(ledger.map((row) => row.source_id)).size === 3 &&
      new Set(usage.map((row) => row.id)).size === 3,
    "duplicate_official_accounting_row",
  );
  let balance = 21581;
  const usageIds: string[] = [],
    ledgerIds: string[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    const bytes = batches[index],
      plan = parse(bytes.plan),
      guard = parse(bytes.guard),
      attempt = parse(bytes.attempt),
      receipt = parse(bytes.receipt);
    requireState(
      object(plan.slot) &&
        plan.slot.id === WITHHELD_SLOT &&
        Array.isArray(plan.batches) &&
        object(plan.batches[index]) &&
        object(guard.capability) &&
        guard.capability.balance === 21581 &&
        guard.capability.unitCost === 3 &&
        attempt.slotId === WITHHELD_SLOT &&
        attempt.requestKey === plan.batches[index].key &&
        attempt.planSha256 === sha256(bytes.plan) &&
        attempt.guardSha256 === sha256(bytes.guard) &&
        attempt.accountScope === proof.accountScopeHash &&
        attempt.accountScope === guard.capability.accountScope &&
        same(attempt.uids, plan.batches[index].uids) &&
        Array.isArray(attempt.uids) &&
        attempt.uids.length === 50 &&
        same(
          attempt.command,
          weeklyProfileArguments(attempt.uids as string[]),
        ) &&
        attempt.maximumCredits === 150 &&
        receipt.attemptSha256 === sha256(bytes.attempt) &&
        receipt.responseSha256 === sha256(bytes.response) &&
        isTimestamp(attempt.startedAt) &&
        isTimestamp(receipt.observedAt) &&
        Date.parse(receipt.observedAt) >= Date.parse(attempt.startedAt) &&
        Date.parse(receipt.observedAt) <=
          Date.parse(proof.projectionAt as string),
      "reconciliation_archive_binding_mismatch",
    );
    if (index < 2) {
      requireState(
        receipt.outcome === "success" &&
          receipt.blocker === null &&
          receipt.actualChargedCredits === null,
        "reconciliation_prior_batch_not_success",
      );
      extractWeeklyProfiles(parse(bytes.response), attempt.uids as string[]);
    } else {
      requireState(
        receipt.outcome === "blocked" &&
          receipt.blocker === "incomplete_weekly_response" &&
          receipt.settlement === "uncertain_requires_reconciliation" &&
          receipt.actualChargedCredits === null &&
          Array.isArray(attempt.groupIds) &&
          attempt.groupIds[(attempt.uids as string[]).indexOf(WITHHELD_UID)] ===
            WITHHELD_GROUP,
        "reconciliation_blocked_receipt_required",
      );
      extractKnownWithheldProfiles(
        parse(bytes.response) as unknown as WeeklyRawResponse,
        attempt.uids as string[],
      );
    }
    const at = Date.parse(receipt.observedAt as string),
      start = Date.parse(attempt.startedAt as string);
    const matchedUsage = usage.filter(
      (row) =>
        object(row.requestParams) &&
        row.requestParams.uids === (attempt.uids as string[]).join(",") &&
        Date.parse(String(row.createdAt)) >= start &&
        Date.parse(String(row.createdAt)) <= at &&
        at - Date.parse(String(row.createdAt)) < 1000,
    );
    requireState(matchedUsage.length === 1, "nonunique_official_usage_match");
    const matchedLedger = ledger.filter(
      (row) => row.createdAt === matchedUsage[0].createdAt,
    );
    requireState(
      matchedLedger.length === 1 &&
        Number(matchedLedger[0].balanceAfter) === balance - 150,
      "official_balance_chain_mismatch",
    );
    balance -= 150;
    usageIds.push(String(matchedUsage[0].id));
    ledgerIds.push(String(matchedLedger[0].id));
  }
  requireState(
    new Set(usageIds).size === 3 &&
      new Set(ledgerIds).size === 3 &&
      balance === 21131,
    "reconciliation_accounting_reuse",
  );
  const third = batches[2],
    attempt = parse(third.attempt),
    receipt = parse(third.receipt);
  if (mode === "provider")
    requireState(
      sha256(third.response) === RESPONSE_SHA &&
        sha256(proofBytes) === ACCOUNTING_SHA &&
        proof.accountScopeHash === "448a8bc60cfb3fa0",
      "unreviewed_provider_reconciliation",
    );
  return {
    schemaVersion: "idol-weekly-reconciliation-v1",
    slotId: WITHHELD_SLOT,
    requestKey: String(attempt.requestKey),
    reviewedAt,
    reason: "known_provider_withheld",
    bindings: {
      planSha256: sha256(third.plan),
      guardSha256: sha256(third.guard),
      attemptSha256: sha256(third.attempt),
      responseSha256: sha256(third.response),
      receiptSha256: sha256(third.receipt),
    },
    accountingSha256: sha256(proofBytes),
    accounting: {
      usageIds,
      ledgerIds,
      chargedCredits: 150,
      totalChargedCredits: 450,
      balanceBefore: 21581,
      balanceAfter: 21131,
    },
    withheld: {
      id: WITHHELD_GROUP,
      uid: WITHHELD_UID,
      reason: "provider_european_user",
      observedAt: String(receipt.observedAt),
    },
  };
}

/** 新周期只接受完整返回中的已知哨兵；普通丢项继续失败关闭。 */
export function extractRecurringWithheldProfiles(
  raw: WeeklyRawResponse,
  expectedUids: string[],
): WeeklyProfile[] {
  let incomplete = false;
  try {
    extractWeeklyProfiles(raw, expectedUids);
  } catch (error) {
    if (!object(error) || error.code !== "incomplete_weekly_response")
      throw error;
    incomplete = true;
  }
  requireState(
    incomplete && expectedUids.includes(WITHHELD_UID),
    "recurring_withheld_scope_mismatch",
  );
  const payload = recurringPayload(raw, expectedUids);
  requireState(
    payload.total_number === expectedUids.length &&
      payload.users.length === expectedUids.length,
    "invalid_withheld_response_shape",
  );
  const sentinels = payload.users.filter((row) => "european_user" in row);
  requireState(
    sentinels.length === 1 &&
      keys(sentinels[0], ["european_user", "id"]) &&
      sentinels[0].european_user === true &&
      sentinels[0].id === Number(WITHHELD_UID),
    "unknown_weekly_withheld_sentinel",
  );
  const users = payload.users.filter((row) => row !== sentinels[0]);
  requireState(
    users.every((row) => "followers_count" in row),
    "unknown_weekly_missing_profile",
  );
  const remaining = expectedUids.filter((uid) => uid !== WITHHELD_UID);
  return remaining.length
    ? extractWeeklyProfiles(
        { ...raw, stdout: JSON.stringify({ ...payload, users }) },
        remaining,
      )
    : [];
}

function recurringPayload(
  raw: WeeklyRawResponse,
  expectedUids: string[],
): {
  total_number: number;
  users: Record<string, unknown>[];
  states: unknown[];
} {
  const payload: unknown = JSON.parse(raw.stdout);
  requireState(
    keys(payload, ["total_number", "users", "states"]) &&
      Number.isSafeInteger(payload.total_number) &&
      Number(payload.total_number) <= expectedUids.length &&
      Array.isArray(payload.users) &&
      Number(payload.total_number) >= payload.users.length &&
      payload.users.every(object) &&
      Array.isArray(payload.states) &&
      payload.states.length === expectedUids.length,
    "invalid_recurring_response_shape",
  );
  const stateUids = payload.states.map((row: unknown) => {
    requireState(
      object(row) && Object.keys(row).length === 1,
      "invalid_withheld_states",
    );
    const uid = Object.keys(row)[0];
    requireState(
      expectedUids.includes(uid) && (row[uid] === 1 || row[uid] === 2),
      "invalid_withheld_states",
    );
    return uid;
  });
  requireState(
    new Set(stateUids).size === expectedUids.length,
    "invalid_withheld_states",
  );
  return {
    total_number: payload.total_number as number,
    users: payload.users as Record<string, unknown>[],
    states: payload.states,
  };
}

/** 逐账号终止缺失或受限资料；只解析users根对象，不从正文内嵌用户补造资料。 */
export function extractRecurringPartialProfiles(
  raw: WeeklyRawResponse,
  expectedUids: string[],
): {
  profiles: WeeklyProfile[];
  unavailable: { uid: string; reason: string }[];
  returnedCount: number;
} {
  weeklyProfileArguments(expectedUids);
  weeklyEvidenceBytes(raw);
  requireState(
    keys(raw, [
      "cliVersion",
      "exitCode",
      "signal",
      "stderr",
      "stdout",
      "timedOut",
    ]) &&
      raw.cliVersion === "0.9.1" &&
      raw.exitCode === 0 &&
      raw.signal === null &&
      raw.timedOut === false &&
      typeof raw.stderr === "string" &&
      raw.stderr.trim() === "" &&
      typeof raw.stdout === "string",
    "invalid_recurring_cli_response",
  );
  const payload = recurringPayload(raw, expectedUids);
  const found = new Map<string, WeeklyProfile>();
  const unavailable = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of payload.users) {
    const aliases = [row.idstr, row.uid, row.id].filter(
      (value) => value != null,
    );
    requireState(
      aliases.length > 0 &&
        aliases.every(
          (value) =>
            (typeof value === "string" ||
              (typeof value === "number" && Number.isSafeInteger(value))) &&
            /^\d{4,20}$/u.test(String(value)),
        ),
      "unsafe_weekly_uid",
    );
    const uid = String(aliases[0]);
    requireState(
      expectedUids.includes(uid) &&
        !seen.has(uid) &&
        aliases.every((value) => String(value) === uid),
      "weekly_uid_mismatch_or_duplicate",
    );
    seen.add(uid);
    if ("european_user" in row) {
      requireState(
        keys(row, ["european_user", "id"]) && row.european_user === true,
        "unknown_weekly_withheld_sentinel",
      );
      unavailable.set(uid, "provider_european_user");
    } else if (
      row.ok === false ||
      row.success === false ||
      row.error ||
      row.error_code ||
      !("followers_count" in row) ||
      (row.screen_name != null && typeof row.screen_name !== "string")
    ) {
      unavailable.set(uid, "provider_profile_unavailable");
    } else if (
      typeof row.followers_count !== "number" ||
      !Number.isSafeInteger(row.followers_count) ||
      row.followers_count < 0
    ) {
      unavailable.set(uid, "provider_invalid_followers_count");
    } else {
      found.set(uid, {
        uid,
        followersValue: row.followers_count,
        displayName:
          typeof row.screen_name === "string" ? row.screen_name : null,
      });
    }
  }
  for (const uid of expectedUids)
    if (!seen.has(uid)) unavailable.set(uid, "provider_missing_profile");
  return {
    profiles: expectedUids
      .filter((uid) => found.has(uid))
      .map((uid) => found.get(uid)!),
    unavailable: expectedUids
      .filter((uid) => unavailable.has(uid))
      .map((uid) => ({ uid, reason: unavailable.get(uid)! })),
    returnedCount: payload.total_number,
  };
}

/** 积分按百万分之一精度核账；不能用浮点近似容差掩盖金额差异。 */
function recurringCreditMicros(value: unknown, text = false): number {
  if (text) {
    requireState(
      typeof value === "string" &&
        /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value),
      "invalid_recurring_credit_amount",
    );
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    requireState(
      micros <= BigInt(Number.MAX_SAFE_INTEGER),
      "recurring_credit_overflow",
    );
    return Number(micros) * (negative ? -1 : 1);
  }
  requireState(
    typeof value === "number" && Number.isSafeInteger(value * 1_000_000),
    "invalid_recurring_credit_amount",
  );
  return value * 1_000_000;
}

/**
 * 周期核账纯函数：输入必须是已请求的连续批次前缀，末批为个别资料不可用。
 * 仅核对调用方取得的官方投影及原件绑定；不请求网络、不推断或改写扣费。
 */
export function prepareRecurringWeeklyReconciliation(
  batches: ReconciliationBatch[],
  proofBytes: Buffer,
  reviewedAt: string,
  mode: "provider" | "synthetic",
): RecurringWeeklyReconciliation {
  requireState(
    batches.length > 0 &&
      batches.length <= WEEKLY_LIMITS.maximumBatches &&
      isTimestamp(reviewedAt) &&
      ["provider", "synthetic"].includes(mode),
    "invalid_recurring_reconciliation_scope",
  );
  const proof = parse(proofBytes);
  requireState(
    keys(proof, [
      "schemaVersion",
      "projectionAt",
      "accountScopeHash",
      "sourceKind",
      "sources",
      "ledger",
      "usage",
      "notes",
    ]) &&
      proof.schemaVersion === "idol-official-accounting-observation-v1" &&
      proof.sourceKind === "official_browser_response_whitelist_projection" &&
      typeof proof.accountScopeHash === "string" &&
      /^[a-f0-9]{16}$/u.test(proof.accountScopeHash) &&
      isTimestamp(proof.projectionAt) &&
      Date.parse(proof.projectionAt) <= Date.parse(reviewedAt) &&
      same(proof.sources, {
        ledger:
          "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
        usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
        page: "https://open.weibo.com/cli/logs",
      }) &&
      Array.isArray(proof.notes) &&
      proof.notes.every((note: unknown) => typeof note === "string") &&
      Array.isArray(proof.ledger) &&
      proof.ledger.length <= batches.length &&
      Array.isArray(proof.usage) &&
      proof.usage.length === batches.length,
    "invalid_official_accounting_proof",
  );
  const ledger = proof.ledger as unknown[];
  const usage = proof.usage as unknown[];
  const ledgerRows = ledger.map((row) => {
    requireState(
      keys(row, [
        "id",
        "source_id",
        "createdAt",
        "delta",
        "balanceAfter",
        "description",
        "type",
        "sourceType",
        "accountMatched",
      ]) &&
        typeof row.id === "string" &&
        /^\d+$/u.test(row.id) &&
        typeof row.source_id === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.source_id) &&
        isTimestamp(row.createdAt) &&
        Date.parse(row.createdAt) <= Date.parse(proof.projectionAt as string) &&
        typeof row.description === "string" &&
        row.type === "api_deduct" &&
        row.sourceType === "api_call" &&
        row.accountMatched === true &&
        recurringCreditMicros(row.delta, true) <= 0 &&
        recurringCreditMicros(row.balanceAfter, true) >= 0,
      "invalid_official_ledger_row",
    );
    return row;
  });
  const usageRows = usage.map((row) => {
    requireState(
      keys(row, [
        "id",
        "createdAt",
        "method",
        "commandPath",
        "status",
        "recordCount",
        "billingType",
        "creditsDeducted",
        "requestParams",
        "accountMatched",
      ]) &&
        typeof row.id === "string" &&
        /^\d+$/u.test(row.id) &&
        isTimestamp(row.createdAt) &&
        Date.parse(row.createdAt) <= Date.parse(proof.projectionAt as string) &&
        row.method === "GET" &&
        row.commandPath === "users/show_batch/other" &&
        row.status === 200 &&
        Number.isSafeInteger(row.recordCount) &&
        Number(row.recordCount) >= 0 &&
        Number(row.recordCount) <= WEEKLY_LIMITS.batchSize &&
        row.billingType === 1 &&
        recurringCreditMicros(row.creditsDeducted) >= 0 &&
        keys(row.requestParams, ["uids"]) &&
        typeof row.requestParams.uids === "string" &&
        row.accountMatched === true,
      "invalid_official_usage_row",
    );
    return row;
  });
  requireState(
    new Set(ledgerRows.map((row) => row.id)).size === ledgerRows.length &&
      new Set(ledgerRows.map((row) => row.source_id)).size ===
        ledgerRows.length &&
      new Set(usageRows.map((row) => row.id)).size === batches.length,
    "duplicate_official_accounting_row",
  );
  const plan = parse(batches[0].plan);
  requireState(
    plan.schemaVersion === "idol-weekly-plan-v2" &&
      object(plan.slot) &&
      (plan.slot.trigger === "manual" || plan.slot.trigger === "scheduled") &&
      isTimestamp(plan.slot.startsAt) &&
      isTimestamp(plan.slot.closesAt) &&
      same(
        plan.slot,
        weeklySlot(plan.slot.trigger, new Date(plan.slot.startsAt)),
      ) &&
      object(plan.scope) &&
      plan.scope.schemaVersion === "idol-weekly-scope-v2" &&
      isTimestamp(plan.scope.frozenAt) &&
      same(
        plan.slot,
        weeklySlot(plan.slot.trigger, new Date(plan.scope.frozenAt)),
      ) &&
      typeof plan.scope.sourceSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(plan.scope.sourceSha256) &&
      Array.isArray(plan.scope.targets) &&
      Array.isArray(plan.scope.review) &&
      plan.scope.review.length === 0 &&
      Array.isArray(plan.batches) &&
      plan.batches.length >= batches.length &&
      plan.batches.length <= WEEKLY_LIMITS.maximumBatches &&
      plan.maximumBatches === plan.batches.length &&
      same(plan.limits, WEEKLY_LIMITS) &&
      Array.isArray(plan.blockers) &&
      plan.blockers.length === 0,
    "invalid_recurring_weekly_plan",
  );
  const slotId = String(plan.slot.id);
  const planBatches = plan.batches.map((batch: unknown) => {
    requireState(
      keys(batch, ["key", "uids", "groupIds"]) &&
        Array.isArray(batch.uids) &&
        batch.uids.every((uid: unknown) => typeof uid === "string") &&
        Array.isArray(batch.groupIds) &&
        batch.groupIds.length === batch.uids.length &&
        batch.groupIds.every(
          (id: unknown) => typeof id === "string" && /^g\d+$/u.test(id),
        ),
      "invalid_recurring_plan_batch",
    );
    const uids = batch.uids as string[],
      groupIds = batch.groupIds as string[];
    weeklyProfileArguments(uids);
    requireState(
      batch.key ===
        sha256(
          encode({
            slot: slotId,
            sourceSha256: (plan.scope as Record<string, unknown>).sourceSha256,
            uids,
            groupIds,
          }),
        ),
      "recurring_plan_batch_key_mismatch",
    );
    return { key: String(batch.key), uids, groupIds };
  });
  const expectedTargets = planBatches.flatMap((batch) =>
    batch.uids.map((uid, index) => ({ uid, id: batch.groupIds[index] })),
  );
  requireState(
    plan.maximumAccounts === expectedTargets.length &&
      plan.scope.activeCount === expectedTargets.length &&
      new Set(expectedTargets.map((row) => row.uid)).size ===
        expectedTargets.length &&
      new Set(expectedTargets.map((row) => row.id)).size ===
        expectedTargets.length &&
      same(
        plan.scope.targets.map((row: unknown) =>
          object(row) ? { uid: row.uid, id: row.id } : null,
        ),
        expectedTargets,
      ) &&
      planBatches.every(
        (batch, index) =>
          index === planBatches.length - 1 ||
          batch.uids.length === WEEKLY_LIMITS.batchSize,
      ),
    "recurring_plan_population_mismatch",
  );
  const usageIds: string[] = [],
    ledgerIds: string[] = [];
  const guards = new Set<string>();
  let balance: number | undefined,
    balanceBefore = 0,
    totalCharged = 0,
    charged = 0;
  let previousStart = -Infinity,
    previousObserved = -Infinity,
    processedAccounts = 0,
    previousGuardSha = "";
  let lastUnavailable: RecurringWeeklyReconciliation["unavailable"] = [];
  for (let index = 0; index < batches.length; index += 1) {
    const bytes = batches[index],
      expected = planBatches[index];
    const guard = parse(bytes.guard),
      attempt = parse(bytes.attempt),
      receipt = parse(bytes.receipt);
    const planSha = sha256(bytes.plan),
      guardSha = sha256(bytes.guard);
    requireState(
      bytes.plan.equals(batches[0].plan) &&
        guard.schemaVersion === "idol-weekly-guard-v2" &&
        guard.slotId === slotId &&
        guard.planSha256 === planSha &&
        isTimestamp(guard.checkedAt) &&
        Date.parse(guard.checkedAt) >= Date.parse(plan.scope.frozenAt) &&
        object(guard.capability) &&
        object(guard.budget) &&
        object(guard.legacyAudit) &&
        guard.legacyAudit.status === "clear" &&
        Number.isSafeInteger(guard.pendingAccounts) &&
        Number(guard.pendingAccounts) > 0 &&
        Number(guard.pendingAccounts) <= expectedTargets.length,
      "recurring_guard_binding_mismatch",
    );
    const capability = guard.capability as unknown as WeeklyCapability;
    const deadline = weeklyGuardDeadline(plan.slot, guard);
    requireState(
      same(
        weeklyBudget(
          capability,
          Number(guard.pendingAccounts),
          guard.budget.budgetCredits as number,
          new Date(guard.checkedAt),
          mode,
        ),
        guard.budget,
      ) && capability.accountScope === proof.accountScopeHash,
      "recurring_guard_budget_or_account_mismatch",
    );
    requireState(
      keys(attempt, [
        "schemaVersion",
        "slotId",
        "requestKey",
        "planSha256",
        "guardId",
        "guardSha256",
        "accountScope",
        "startedAt",
        "uids",
        "groupIds",
        "command",
        "maximumCredits",
        "settlement",
      ]) &&
        attempt.schemaVersion === "idol-weekly-attempt-v2" &&
        attempt.slotId === slotId &&
        attempt.requestKey === expected.key &&
        attempt.planSha256 === planSha &&
        attempt.guardId === guardSha &&
        attempt.guardSha256 === guardSha &&
        attempt.accountScope === proof.accountScopeHash &&
        same(attempt.uids, expected.uids) &&
        same(attempt.groupIds, expected.groupIds) &&
        same(attempt.command, weeklyProfileArguments(expected.uids)) &&
        attempt.settlement === "pending_reconciliation" &&
        isTimestamp(attempt.startedAt) &&
        Date.parse(attempt.startedAt) >= Date.parse(guard.checkedAt) &&
        Date.parse(attempt.startedAt) >= previousObserved &&
        Date.parse(attempt.startedAt) - previousStart >=
          WEEKLY_LIMITS.intervalMs &&
        Date.parse(attempt.startedAt) >= Date.parse(plan.slot.startsAt) &&
        Date.parse(attempt.startedAt) < deadline,
      "recurring_attempt_binding_mismatch",
    );
    weeklyBudget(
      capability,
      expected.uids.length,
      guard.budget.budgetCredits as number,
      new Date(attempt.startedAt),
      mode,
    );
    requireState(
      keys(receipt, [
        "schemaVersion",
        "slotId",
        "requestKey",
        "attemptSha256",
        "responseSha256",
        "observedAt",
        "outcome",
        "blocker",
        "settlement",
        "actualChargedCredits",
      ]) &&
        receipt.schemaVersion === "idol-weekly-receipt-v2" &&
        receipt.slotId === slotId &&
        receipt.requestKey === expected.key &&
        receipt.attemptSha256 === sha256(bytes.attempt) &&
        receipt.responseSha256 === sha256(bytes.response) &&
        isTimestamp(receipt.observedAt) &&
        Date.parse(receipt.observedAt) >= Date.parse(attempt.startedAt) &&
        Date.parse(receipt.observedAt) < deadline &&
        Date.parse(receipt.observedAt) <=
          Date.parse(proof.projectionAt as string) &&
        receipt.actualChargedCredits === null,
      "recurring_receipt_binding_mismatch",
    );
    const raw = parse(bytes.response) as unknown as WeeklyRawResponse;
    const partial = extractRecurringPartialProfiles(raw, expected.uids);
    if (index < batches.length - 1 && receipt.outcome === "success") {
      requireState(
        partial.unavailable.length === 0 &&
          receipt.blocker === null &&
          receipt.settlement === "response_received_not_financially_reconciled",
        "reconciliation_prior_batch_not_success",
      );
    } else {
      requireState(
        receipt.outcome === "blocked" &&
          receipt.blocker === "incomplete_weekly_response" &&
          receipt.settlement === "uncertain_requires_reconciliation" &&
          partial.unavailable.length > 0,
        "reconciliation_blocked_receipt_required",
      );
    }
    if (index === batches.length - 1)
      lastUnavailable = partial.unavailable.map((item) => ({
        id: expected.groupIds[expected.uids.indexOf(item.uid)],
        uid: item.uid,
        reason: item.reason,
        observedAt: String(receipt.observedAt),
      }));
    if (!guards.has(guardSha)) {
      requireState(
        guard.pendingAccounts === expectedTargets.length - processedAccounts &&
          Date.parse(capability.observedAt) >= previousObserved &&
          (balance === undefined ||
            recurringCreditMicros(capability.balance) === balance),
        "recurring_guard_balance_chain_mismatch",
      );
      guards.add(guardSha);
      if (balance === undefined)
        balanceBefore = balance = recurringCreditMicros(capability.balance);
    } else
      requireState(
        previousGuardSha === guardSha,
        "recurring_guard_order_violation",
      );
    charged =
      partial.returnedCount * recurringCreditMicros(capability.unitCost);
    requireState(
      Number.isSafeInteger(charged) &&
        recurringCreditMicros(attempt.maximumCredits) ===
          expected.uids.length * recurringCreditMicros(capability.unitCost),
      "recurring_attempt_budget_mismatch",
    );
    const start = Date.parse(attempt.startedAt),
      observed = Date.parse(receipt.observedAt);
    // 供应方整秒时间可比本地回执晚不足一秒；容差两端固定为1000ms，不随失败扩大。
    const matchedUsage = usageRows.filter(
      (row) =>
        object(row.requestParams) &&
        row.requestParams.uids === expected.uids.join(",") &&
        Date.parse(String(row.createdAt)) >= start - 1000 &&
        Date.parse(String(row.createdAt)) <= observed + 1000,
    );
    requireState(matchedUsage.length === 1, "nonunique_official_usage_match");
    const usageRow = matchedUsage[0];
    requireState(
      usageRow.recordCount === partial.returnedCount &&
        recurringCreditMicros(usageRow.creditsDeducted) === charged,
      "recurring_usage_charge_mismatch",
    );
    const matchedLedger = ledgerRows.filter(
      (row) => row.createdAt === usageRow.createdAt,
    );
    requireState(
      matchedLedger.length === 1 ||
        (charged === 0 && matchedLedger.length === 0),
      "nonunique_official_ledger_match",
    );
    requireState(balance !== undefined, "recurring_missing_initial_balance");
    if (matchedLedger.length) {
      const ledgerRow = matchedLedger[0];
      const description =
        /^\[users\/show_batch\/other\] per_record: (\d+) records × ((?:0|[1-9]\d*)(?:\.\d{1,6})?) pts$/u.exec(
          String(ledgerRow.description),
        );
      requireState(
        description &&
          Number(description[1]) === partial.returnedCount &&
          recurringCreditMicros(description[2], true) ===
            recurringCreditMicros(capability.unitCost) &&
          recurringCreditMicros(ledgerRow.delta, true) === -charged &&
          recurringCreditMicros(ledgerRow.balanceAfter, true) ===
            balance - charged &&
          balance - charged >= WEEKLY_LIMITS.reserveCredits * 1_000_000,
        "official_balance_chain_mismatch",
      );
      ledgerIds.push(String(ledgerRow.id));
    }
    balance -= charged;
    totalCharged += charged;
    requireState(
      Number.isSafeInteger(totalCharged),
      "recurring_credit_overflow",
    );
    usageIds.push(String(usageRow.id));
    processedAccounts += expected.uids.length;
    previousStart = start;
    previousObserved = observed;
    previousGuardSha = guardSha;
  }
  requireState(
    new Set(usageIds).size === batches.length &&
      ledgerIds.length === ledgerRows.length &&
      new Set(ledgerIds).size === ledgerRows.length &&
      balance !== undefined,
    "reconciliation_accounting_reuse",
  );
  const last = batches[batches.length - 1],
    attempt = parse(last.attempt);
  return {
    schemaVersion: "idol-weekly-reconciliation-v2",
    slotId,
    requestKey: String(attempt.requestKey),
    reviewedAt,
    reason: "provider_partial_profiles",
    bindings: {
      planSha256: sha256(last.plan),
      guardSha256: sha256(last.guard),
      attemptSha256: sha256(last.attempt),
      responseSha256: sha256(last.response),
      receiptSha256: sha256(last.receipt),
    },
    accountingSha256: sha256(proofBytes),
    accounting: {
      usageIds,
      ledgerIds,
      chargedCredits: charged / 1_000_000,
      totalChargedCredits: totalCharged / 1_000_000,
      balanceBefore: balanceBefore / 1_000_000,
      balanceAfter: balance / 1_000_000,
    },
    unavailable: lastUnavailable,
  };
}

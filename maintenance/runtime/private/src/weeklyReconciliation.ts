import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import {
  extractWeeklyProfiles,
  weeklyEvidenceBytes,
  weeklyProfileArguments,
  type WeeklyRawResponse,
} from "./weeklyContract.ts";

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
export interface ReconciliationBatch {
  plan: Buffer;
  guard: Buffer;
  attempt: Buffer;
  response: Buffer;
  receipt: Buffer;
}
export interface WeeklyReconciliation {
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
): WeeklyReconciliation {
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

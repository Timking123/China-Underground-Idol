// 由 weekly_reconciliation.ts 严格编译生成；请修改 TS 源文件后重建。
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value, min, max) {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.length <= max
  );
}
function hash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function requireCondition(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
export function validateReconciliationProof(proof, expectedWeek, now) {
  requireCondition(
    record(proof) &&
      proof.schemaVersion === "weekly-profile-reconciliation-v1" &&
      proof.decision === "close_without_retry" &&
      proof.confirmedByMaintainer === true &&
      typeof proof.weekId === "string" &&
      /^week-\d{4}-\d{2}-\d{2}$/u.test(proof.weekId) &&
      proof.weekId === expectedWeek &&
      hash(proof.requestKey) &&
      hash(proof.attemptSha256) &&
      (proof.responseSha256 === null || hash(proof.responseSha256)) &&
      (proof.receiptSha256 === null || hash(proof.receiptSha256)) &&
      typeof proof.accountScope === "string" &&
      /^[a-f0-9]{16}$/u.test(proof.accountScope),
    "invalid_reconciliation_identity",
  );
  // 拒绝附带未知内容，避免把无关账号资料复制进核账收据。
  requireCondition(
    Object.keys(proof).sort().join(",") ===
      "accountScope,attemptSha256,confirmedByMaintainer,decision,evidence,receiptSha256,requestKey,responseSha256,schemaVersion,weekId",
    "unexpected_reconciliation_fields",
  );
  const evidence = proof.evidence;
  requireCondition(
    record(evidence) &&
      evidence.kind === "provider_statement" &&
      text(evidence.reference, 4, 200) &&
      text(evidence.reviewedBy, 2, 100) &&
      text(evidence.statement, 20, 8000) &&
      typeof evidence.checkedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
        evidence.checkedAt,
      ) &&
      Number.isFinite(Date.parse(evidence.checkedAt)) &&
      Date.parse(evidence.checkedAt) <= now.getTime() &&
      typeof evidence.settlement === "string" &&
      ["not_charged", "charged", "refunded"].includes(evidence.settlement) &&
      typeof evidence.chargedCredits === "number" &&
      Number.isFinite(evidence.chargedCredits) &&
      evidence.chargedCredits >= 0 &&
      (evidence.settlement === "not_charged"
        ? evidence.chargedCredits === 0
        : evidence.chargedCredits > 0),
    "explicit_provider_reconciliation_required",
  );
  requireCondition(
    Object.keys(evidence).sort().join(",") ===
      "chargedCredits,checkedAt,kind,reference,reviewedBy,settlement,statement",
    "unexpected_reconciliation_fields",
  );
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  validateLegacyWeekInventory,
  validateLegacyWeekReferences,
} from "../src/weeklyRuntimeAdapter.ts";
import { encode, sha256 } from "../src/sourceCapture.ts";
import { weeklyProfileArguments } from "../src/weeklyContract.ts";

const week = "week-2026-09-07";
const now = new Date("2026-09-09T10:00:00.000Z");
function evidence() {
  const uids = ["1234567890"];
  const key = sha256(encode(uids));
  const files = {};
  const put = (name, data) => {
    files[name] = Buffer.from(encode(data));
  };
  const ref = (name) => ({ path: name, sha256: sha256(files[name]) });
  put("plan.json", {
    schemaVersion: "weekly-profile-plan-v1",
    weekId: week,
    sourceSha256: "a".repeat(64),
    batches: [{ key, values: uids, groupIds: ["g001"] }],
  });
  put("management.json", { observedAt: now.toISOString(), kind: "synthetic" });
  put("guard.json", {
    accountScope: "b".repeat(16),
    managementEvidence: [ref("management.json")],
  });
  put(`${key}.attempt.json`, {
    schemaVersion: "weekly-profile-attempt-v1",
    weekId: week,
    requestKey: key,
    planSha256: sha256(files["plan.json"]),
    uids,
    command: weeklyProfileArguments(uids),
    accountScope: "b".repeat(16),
    startedAt: now.toISOString(),
    capabilityReceipt: ref("guard.json"),
  });
  put(`${key}.response.json`, {
    cliVersion: "0.9.1",
    stdout: JSON.stringify({
      users: [{ idstr: uids[0], followers_count: 123 }],
    }),
    stderr: "",
    exitCode: 0,
    timedOut: false,
    signal: null,
  });
  put(`${key}.receipt.json`, {
    schemaVersion: "weekly-profile-receipt-v1",
    weekId: week,
    requestKey: key,
    outcome: "success",
    observedAt: now.toISOString(),
    attemptSha256: sha256(files[`${key}.attempt.json`]),
    responseSha256: sha256(files[`${key}.response.json`]),
  });
  put("snapshot.json", {
    schemaVersion: "weekly-profile-snapshot-v1",
    weekId: week,
    sourceSha256: "a".repeat(64),
    complete: true,
  });
  return { files, key, put, ref, plan: JSON.parse(files["plan.json"]) };
}

test("当期与旧期一律拦截计划外孤立请求及无计划snapshot", () => {
  const f = evidence();
  validateLegacyWeekReferences(week, f.files, now);
  const rogue = `${"c".repeat(64)}.attempt.json`;
  for (const date of [week, "week-2026-08-31"]) {
    assert.throws(
      () =>
        validateLegacyWeekInventory(date, { ...f.plan, weekId: date }, [
          ...Object.keys(f.files),
          rogue,
        ]),
      /legacy_orphan_record_outside_plan/,
    );
    assert.throws(
      () => validateLegacyWeekInventory(date, null, [rogue]),
      /legacy_orphan_artifacts_without_plan/,
    );
    assert.throws(
      () => validateLegacyWeekInventory(date, null, ["snapshot.json"]),
      /legacy_orphan_artifacts_without_plan/,
    );
  }
  assert.throws(
    () =>
      validateLegacyWeekInventory(week, f.plan, [
        "plan.json",
        `${f.key}.attempt.json`,
      ]),
    /legacy_attempt_requires_reconciliation/,
  );
  assert.throws(
    () =>
      validateLegacyWeekInventory(week, f.plan, [
        "plan.json",
        `${f.key}.response.json`,
        `${f.key}.receipt.json`,
      ]),
    /legacy_attempt_missing/,
  );
  assert.throws(
    () =>
      validateLegacyWeekInventory(week, f.plan, ["plan.json", "snapshot.json"]),
    /legacy_snapshot_missing_or_closed_batches/,
  );
  assert.throws(
    () => validateLegacyWeekInventory(week, f.plan, ["plan.json", "run.lock"]),
    /legacy_weekly_writer_locked/,
  );
});

test("闭合文件名不能代替attempt、guard、原响应和收据的引用校验", () => {
  for (const [name, mutate, expected] of [
    [
      "plan.json",
      (value) => {
        value.sourceSha256 = "d".repeat(64);
      },
      /legacy_attempt_reference_mismatch/,
    ],
    [
      "guard.json",
      (value) => {
        value.accountScope = "c".repeat(16);
      },
      /legacy_reference_hash_mismatch/,
    ],
    [
      "management.json",
      (value) => {
        value.kind = "changed";
      },
      /legacy_reference_hash_mismatch/,
    ],
    [
      "receipt",
      (value) => {
        value.outcome = "failed";
      },
      /legacy_receipt_reference_mismatch/,
    ],
    [
      "snapshot.json",
      (value) => {
        value.complete = false;
      },
      /legacy_snapshot_reference_mismatch/,
    ],
  ]) {
    const f = evidence(),
      file = name === "receipt" ? `${f.key}.receipt.json` : name;
    const value = JSON.parse(f.files[file]);
    mutate(value);
    f.put(file, value);
    assert.throws(
      () => validateLegacyWeekReferences(week, f.files, now),
      expected,
    );
  }
  const f = evidence(),
    response = `${f.key}.response.json`,
    receipt = `${f.key}.receipt.json`;
  const raw = JSON.parse(f.files[response]);
  raw.stdout = JSON.stringify({ users: [] });
  f.put(response, raw);
  const receiptValue = JSON.parse(f.files[receipt]);
  receiptValue.responseSha256 = sha256(f.files[response]);
  f.put(receipt, receiptValue);
  assert.throws(
    () => validateLegacyWeekReferences(week, f.files, now),
    /incomplete_weekly_response/,
  );
});

test("核账文件也必须绑定原attempt和已有响应收据，不能借完整snapshot掩盖核账", () => {
  const f = evidence();
  f.put(`${f.key}.reconciliation.json`, {
    schemaVersion: "weekly-profile-reconciliation-v1",
    weekId: week,
    requestKey: f.key,
    accountScope: "b".repeat(16),
    attemptSha256: sha256(f.files[`${f.key}.attempt.json`]),
    responseSha256: sha256(f.files[`${f.key}.response.json`]),
    receiptSha256: sha256(f.files[`${f.key}.receipt.json`]),
  });
  assert.throws(
    () => validateLegacyWeekReferences(week, f.files, now),
    /legacy_snapshot_missing_or_closed_batches/,
  );
  delete f.files["snapshot.json"];
  validateLegacyWeekReferences(week, f.files, now);
  const proof = JSON.parse(f.files[`${f.key}.reconciliation.json`]);
  proof.attemptSha256 = "0".repeat(64);
  f.put(`${f.key}.reconciliation.json`, proof);
  assert.throws(
    () => validateLegacyWeekReferences(week, f.files, now),
    /legacy_reconciliation_reference_mismatch/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareWeeklyReconciliation,
  extractKnownWithheldProfiles,
  WITHHELD_UID,
} from "../src/weeklyReconciliation.ts";
import {
  weeklyEvidenceBytes,
  weeklyProfileArguments,
} from "../src/weeklyContract.ts";
import { sha256 } from "../src/sourceCapture.ts";

function fixture() {
  const uids = Array.from({ length: 150 }, (_, i) => String(7700000000 + i));
  uids[110] = WITHHELD_UID;
  const plans = [0, 1, 2].map((index) => ({
    key: String(index + 1).repeat(64),
    uids: uids.slice(index * 50, index * 50 + 50),
  }));
  const plan = weeklyEvidenceBytes({
    slot: { id: "manual-2026-09-09" },
    batches: plans,
  });
  const guard = weeklyEvidenceBytes({
    capability: { balance: 21581, unitCost: 3, accountScope: "1".repeat(16) },
  });
  const ledger = [],
    usage = [];
  const batches = plans.map((batch, index) => {
    const seconds = 27 + index * 7,
      createdAt = `2026-09-09T13:43:${seconds}.000Z`,
      observedAt = `2026-09-09T13:43:${seconds}.250Z`;
    const attempt = weeklyEvidenceBytes({
      slotId: "manual-2026-09-09",
      requestKey: batch.key,
      planSha256: sha256(plan),
      guardSha256: sha256(guard),
      accountScope: "1".repeat(16),
      uids: batch.uids,
      groupIds: batch.uids.map((uid, i) =>
        uid === WITHHELD_UID ? "g384" : `g${index * 50 + i}`,
      ),
      command: weeklyProfileArguments(batch.uids),
      maximumCredits: 150,
      startedAt: `2026-09-09T13:43:${seconds - 6}.000Z`,
    });
    const raw = {
      cliVersion: "0.9.1",
      exitCode: 0,
      timedOut: false,
      signal: null,
      stderr: "",
      stdout: JSON.stringify({
        total_number: 50,
        users: batch.uids.map((uid) =>
          uid === WITHHELD_UID
            ? { european_user: true, id: Number(uid) }
            : { idstr: uid, followers_count: 1000 },
        ),
        states: batch.uids.map((uid) => ({ [uid]: 1 })),
      }),
    };
    const response = weeklyEvidenceBytes(raw);
    const receipt = weeklyEvidenceBytes({
      attemptSha256: sha256(attempt),
      responseSha256: sha256(response),
      observedAt,
      outcome: index === 2 ? "blocked" : "success",
      blocker: index === 2 ? "incomplete_weekly_response" : null,
      settlement:
        index === 2
          ? "uncertain_requires_reconciliation"
          : "response_received_not_financially_reconciled",
      actualChargedCredits: null,
    });
    ledger.push({
      id: String(100 + index),
      source_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      createdAt,
      delta: "-150",
      balanceAfter: String(21581 - (index + 1) * 150),
      description: "[users/show_batch/other] per_record: 50 records × 3 pts",
      type: "api_deduct",
      sourceType: "api_call",
      accountMatched: true,
    });
    usage.push({
      id: String(200 + index),
      createdAt,
      method: "GET",
      commandPath: "users/show_batch/other",
      status: 200,
      recordCount: 50,
      billingType: 1,
      creditsDeducted: 150,
      requestParams: { uids: batch.uids.join(",") },
      accountMatched: true,
    });
    return { plan, guard, attempt, response, receipt };
  });
  const proof = {
    schemaVersion: "idol-official-accounting-observation-v1",
    projectionAt: "2026-09-09T13:50:00.000Z",
    accountScopeHash: "1".repeat(16),
    sourceKind: "official_browser_response_whitelist_projection",
    sources: {
      ledger: "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
      usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
      page: "https://open.weibo.com/cli/logs",
    },
    ledger,
    usage,
    notes: ["离线合成核账"],
  };
  return {
    batches,
    proof,
    run: () =>
      prepareWeeklyReconciliation(
        batches,
        weeklyEvidenceBytes(proof),
        "2026-09-09T14:00:00.000Z",
        "synthetic",
      ),
  };
}

test("三笔核账独立重建：绑定五类原件、唯一请求与余额链，原收据保持blocked", () => {
  const h = fixture(),
    before = Buffer.from(h.batches[2].receipt),
    result = h.run();
  assert.equal(result.accounting.totalChargedCredits, 450);
  assert.equal(result.accounting.balanceAfter, 21131);
  assert.equal(result.bindings.receiptSha256, sha256(before));
  assert.deepEqual(h.batches[2].receipt, before);
  assert.equal(JSON.parse(before).outcome, "blocked");
  assert.throws(
    () =>
      prepareWeeklyReconciliation(
        h.batches,
        weeklyEvidenceBytes(h.proof),
        result.reviewedAt,
        "provider",
      ),
    /unreviewed_provider/,
  );
});

test("哨兵错UID、额外字段、重复、普通资料损坏与未知缺项全部拒绝", () => {
  const h = fixture(),
    raw = JSON.parse(h.batches[2].response),
    uids = JSON.parse(h.batches[2].attempt).uids;
  assert.equal(extractKnownWithheldProfiles(raw, uids).length, 49);
  for (const mutate of [
    (p) => {
      p.users[10].id += 1;
    },
    (p) => {
      p.users[10].extra = true;
    },
    (p) => {
      p.users[10].european_user = false;
    },
    (p) => {
      p.users[0] = { ...p.users[10] };
    },
    (p) => {
      p.users[0].followers_count = -1;
    },
    (p) => {
      delete p.users[0].followers_count;
    },
    (p) => {
      p.users[0].idstr = uids[1];
    },
  ]) {
    const payload = JSON.parse(raw.stdout);
    mutate(payload);
    assert.throws(() =>
      extractKnownWithheldProfiles(
        { ...raw, stdout: JSON.stringify(payload) },
        uids,
      ),
    );
  }
});

test("官方多匹配、UID改写、余额链断、错账号和原件hash漂移均阻止恢复", () => {
  for (const mutate of [
    (h) => {
      h.proof.usage[1] = globalThis.structuredClone(h.proof.usage[0]);
    },
    (h) => {
      h.proof.usage[2].requestParams.uids += ",9999";
    },
    (h) => {
      h.proof.ledger[1].balanceAfter = "21280";
    },
    (h) => {
      h.proof.accountScopeHash = "2".repeat(16);
    },
    (h) => {
      h.proof.ledger[2].createdAt = h.proof.ledger[1].createdAt;
    },
    (h) => {
      h.batches[2].response = Buffer.from("{}\n");
    },
  ]) {
    const h = fixture();
    mutate(h);
    assert.throws(h.run);
  }
});

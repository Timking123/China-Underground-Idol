import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareRecurringWeeklyReconciliation,
  prepareWeeklyReconciliation,
  extractRecurringWithheldProfiles,
  extractRecurringPartialProfiles,
  WITHHELD_UID,
  WITHHELD_GROUP,
} from "../src/weeklyReconciliation.ts";
import {
  weeklyEvidenceBytes,
  weeklyProfileArguments,
} from "../src/weeklyContract.ts";
import { encode, sha256 } from "../src/sourceCapture.ts";

// 独立构造完整归档与官方投影；不导入实现的计划、预算或账单生成函数。
function fixture(options = {}) {
  const date = options.date ?? "2026-09-11";
  const trigger = options.trigger ?? "scheduled";
  const start = Date.parse(`${date}T00:00:00+08:00`);
  const time = (offset) => new Date(start + offset).toISOString();
  const account = "c".repeat(16);
  const mode = options.mode ?? "synthetic";
  const count = options.count ?? 375;
  const blockedIndex = options.blockedIndex ?? 2;
  const cost = options.cost ?? 3;
  const balanceBefore = options.balance ?? 20456;
  const slot = {
    id: `${trigger}-${date}`,
    trigger,
    date,
    startsAt: time(0),
    closesAt:
      trigger === "manual" ? "2026-09-10T16:00:00.000Z" : time(7 * 86400000),
    timezone: "Asia/Shanghai",
  };
  const targets = Array.from({ length: count }, (_, index) => ({
    uid: String(7700000000 + index),
    id: `g${String(index + 1).padStart(3, "0")}`,
  }));
  const sentinelIndex = Math.min(blockedIndex * 50 + 10, count - 1);
  targets[sentinelIndex] = { uid: WITHHELD_UID, id: WITHHELD_GROUP };
  const scope = {
    schemaVersion: "idol-weekly-scope-v2",
    frozenAt: time(1000),
    sourceSha256: "a".repeat(64),
    sourceFiles: [],
    targets,
    excluded: [],
    review: [],
    activeCount: count,
  };
  const planBatches = [];
  for (let index = 0; index < count; index += 50) {
    const rows = targets.slice(index, index + 50);
    const uids = rows.map((row) => row.uid),
      groupIds = rows.map((row) => row.id);
    planBatches.push({
      key: sha256(
        encode({
          slot: slot.id,
          sourceSha256: scope.sourceSha256,
          uids,
          groupIds,
        }),
      ),
      uids,
      groupIds,
    });
  }
  const planValue = {
    schemaVersion: "idol-weekly-plan-v2",
    slot,
    scope,
    batches: planBatches,
    limits: {
      batchSize: 50,
      maximumBatches: 8,
      intervalMs: 2000,
      reserveCredits: 4000,
    },
    maximumAccounts: count,
    maximumBatches: planBatches.length,
    blockers: [],
  };
  const plan = weeklyEvidenceBytes(planValue);
  const guardValue = {
    schemaVersion: "idol-weekly-guard-v2",
    slotId: slot.id,
    planSha256: sha256(plan),
    checkedAt: time(5000),
    capability: {
      schemaVersion: "idol-weekly-capability-v2",
      evidenceKind: mode,
      accountScope: account,
      serviceKind: "formal_active",
      commandId: 318,
      command: "users/show_batch/other",
      billingUnit: "returned_item",
      unitCost: cost,
      balance: balanceBefore,
      observedAt: time(4000),
      priceObservedAt: time(3000),
      evidence: [{ path: "provider-price.json", sha256: "b".repeat(64) }],
    },
    budget: {
      maximumCredits: count * cost,
      budgetCredits: count * cost,
      reserveCredits: 4000,
    },
    pendingAccounts: count,
    legacyAudit: { status: "clear" },
  };
  const guard = weeklyEvidenceBytes(guardValue);
  const ledger = [],
    usage = [];
  let balance = balanceBefore;
  const batches = planBatches.slice(0, blockedIndex + 1).map((batch, index) => {
    const blocked = index === blockedIndex;
    const attemptedAt = time(79000 + 3000 * index);
    const observedAt = time(81764 + 3000 * index);
    const createdAt = time(82000 + 3000 * index);
    const charge = batch.uids.length * cost;
    const attempt = weeklyEvidenceBytes({
      schemaVersion: "idol-weekly-attempt-v2",
      slotId: slot.id,
      requestKey: batch.key,
      planSha256: sha256(plan),
      guardId: sha256(guard),
      guardSha256: sha256(guard),
      accountScope: account,
      startedAt: attemptedAt,
      uids: batch.uids,
      groupIds: batch.groupIds,
      command: weeklyProfileArguments(batch.uids),
      maximumCredits: charge,
      settlement: "pending_reconciliation",
    });
    const response = weeklyEvidenceBytes({
      cliVersion: "0.9.1",
      exitCode: 0,
      timedOut: false,
      signal: null,
      stderr: "",
      stdout: JSON.stringify({
        total_number: batch.uids.length,
        users: batch.uids.map((uid) =>
          uid === WITHHELD_UID
            ? { european_user: true, id: Number(uid) }
            : { idstr: uid, followers_count: 1000 },
        ),
        states: batch.uids.map((uid) => ({ [uid]: 1 })),
      }),
    });
    const receipt = weeklyEvidenceBytes({
      schemaVersion: "idol-weekly-receipt-v2",
      slotId: slot.id,
      requestKey: batch.key,
      attemptSha256: sha256(attempt),
      responseSha256: sha256(response),
      observedAt,
      outcome: blocked ? "blocked" : "success",
      blocker: blocked ? "incomplete_weekly_response" : null,
      settlement: blocked
        ? "uncertain_requires_reconciliation"
        : "response_received_not_financially_reconciled",
      actualChargedCredits: null,
    });
    balance -= charge;
    ledger.push({
      id: String(1000 + index),
      source_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      createdAt,
      delta: String(-charge),
      balanceAfter: String(balance),
      description: `[users/show_batch/other] per_record: ${batch.uids.length} records × ${cost} pts`,
      type: "api_deduct",
      sourceType: "api_call",
      accountMatched: true,
    });
    usage.push({
      id: String(2000 + index),
      createdAt,
      method: "GET",
      commandPath: "users/show_batch/other",
      status: 200,
      recordCount: batch.uids.length,
      billingType: 1,
      creditsDeducted: charge,
      requestParams: { uids: batch.uids.join(",") },
      accountMatched: true,
    });
    return { plan, guard, attempt, response, receipt };
  });
  const proof = {
    schemaVersion: "idol-official-accounting-observation-v1",
    projectionAt: time(240000),
    accountScopeHash: account,
    sourceKind: "official_browser_response_whitelist_projection",
    sources: {
      ledger: "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
      usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
      page: "https://open.weibo.com/cli/logs",
    },
    ledger,
    usage,
    notes: ["离线合成证据，仅验证结构与动态绑定，不代表供应方真实账单。"],
  };
  const reviewedAt = time(300000);
  return {
    batches,
    proof,
    reviewedAt,
    mode,
    run: () =>
      prepareRecurringWeeklyReconciliation(
        batches,
        weeklyEvidenceBytes(proof),
        reviewedAt,
        mode,
      ),
  };
}

function mutateFile(batch, name, mutate, rebind = true) {
  const value = JSON.parse(batch[name]);
  mutate(value);
  batch[name] = weeklyEvidenceBytes(value);
  if (rebind && (name === "attempt" || name === "response")) {
    const receipt = JSON.parse(batch.receipt);
    receipt[`${name}Sha256`] = sha256(batch[name]);
    batch.receipt = weeklyEvidenceBytes(receipt);
  }
}

function mutatePayload(h, mutate) {
  mutateFile(h.batches.at(-1), "response", (raw) => {
    const payload = JSON.parse(raw.stdout);
    mutate(payload);
    raw.stdout = JSON.stringify(payload);
  });
}

test("v2本周期动态核账：供应方时间晚236ms、三笔450C闭合且原件不改", () => {
  const h = fixture();
  const before = h.batches.map((batch) =>
    Object.fromEntries(
      Object.entries(batch).map(([key, bytes]) => [key, sha256(bytes)]),
    ),
  );
  const result = h.run();
  assert.equal(result.schemaVersion, "idol-weekly-reconciliation-v2");
  assert.equal(result.slotId, "scheduled-2026-09-11");
  assert.deepEqual(result.accounting, {
    usageIds: ["2000", "2001", "2002"],
    ledgerIds: ["1000", "1001", "1002"],
    chargedCredits: 150,
    totalChargedCredits: 450,
    balanceBefore: 20456,
    balanceAfter: 20006,
  });
  assert.equal(result.bindings.receiptSha256, sha256(h.batches[2].receipt));
  assert.equal(result.accountingSha256, sha256(weeklyEvidenceBytes(h.proof)));
  assert.equal(result.reason, "provider_partial_profiles");
  assert.equal(
    result.unavailable[0].observedAt,
    JSON.parse(h.batches[2].receipt).observedAt,
  );
  assert.deepEqual(h.run(), result);
  assert.deepEqual(
    h.batches.map((batch) =>
      Object.fromEntries(
        Object.entries(batch).map(([key, bytes]) => [key, sha256(bytes)]),
      ),
    ),
    before,
  );
  assert.equal(JSON.parse(h.batches[2].receipt).outcome, "blocked");
  assert.equal(JSON.parse(h.batches[2].receipt).actualChargedCredits, null);
  assert.throws(() =>
    prepareWeeklyReconciliation(
      h.batches,
      weeklyEvidenceBytes(h.proof),
      h.reviewedAt,
      "provider",
    ),
  );
});

test("v2支持新周期、动态单价、非第三批和末批不足50；provider必须匹配guard模式", () => {
  for (const options of [
    {
      date: "2026-09-18",
      cost: 5,
      balance: 30000,
      blockedIndex: 1,
      mode: "provider",
    },
    {
      date: "2026-09-25",
      cost: 0.125,
      balance: 9000.5,
      count: 75,
      blockedIndex: 1,
    },
    { count: 1, blockedIndex: 0, cost: 7, balance: 5000 },
    { date: "2026-09-09", trigger: "manual", balance: 21581 },
  ]) {
    const h = fixture(options),
      result = h.run();
    assert.equal(
      result.slotId,
      `${options.trigger ?? "scheduled"}-${options.date ?? "2026-09-11"}`,
    );
    const requested = h.batches.reduce(
      (n, batch) => n + JSON.parse(batch.attempt).uids.length,
      0,
    );
    assert.equal(
      result.accounting.totalChargedCredits,
      requested * (options.cost ?? 3),
    );
  }
  const synthetic = fixture();
  assert.throws(
    () =>
      prepareRecurringWeeklyReconciliation(
        synthetic.batches,
        weeklyEvidenceBytes(synthetic.proof),
        synthetic.reviewedAt,
        "provider",
      ),
    /invalid_weekly_capability/,
  );
});

test("固定1000ms时钟容差接受边界，正负超界1ms均拒绝", () => {
  for (const [anchor, offset, accepted] of [
    ["observedAt", 1000, true],
    ["observedAt", 1001, false],
    ["startedAt", -1000, true],
    ["startedAt", -1001, false],
  ]) {
    const h = fixture(),
      batch = h.batches[2];
    const base = JSON.parse(
      anchor === "startedAt" ? batch.attempt : batch.receipt,
    )[anchor];
    const value = new Date(Date.parse(base) + offset).toISOString();
    h.proof.usage[2].createdAt = h.proof.ledger[2].createdAt = value;
    if (accepted)
      assert.equal(h.run().schemaVersion, "idol-weekly-reconciliation-v2");
    else assert.throws(h.run, /nonunique_official_usage_match/);
  }
});

for (const [label, mutate] of [
  [
    "哨兵错UID",
    (p) => {
      p.users[10].id += 1;
    },
  ],
  [
    "哨兵附加字段",
    (p) => {
      p.users[10].followers_count = 0;
    },
  ],
  [
    "哨兵false",
    (p) => {
      p.users[10].european_user = false;
    },
  ],
  [
    "重复哨兵",
    (p) => {
      p.users[0] = { ...p.users[10] };
    },
  ],
  [
    "普通资料重复UID",
    (p) => {
      p.users[0].idstr = p.users[1].idstr;
    },
  ],
  [
    "普通资料错UID",
    (p) => {
      p.users[0].idstr = "9999999999";
    },
  ],
  [
    "states丢项",
    (p) => {
      p.states.pop();
    },
  ],
  [
    "states重复",
    (p) => {
      p.states[0] = { ...p.states[1] };
    },
  ],
  [
    "states非法类型",
    (p) => {
      p.states[0][Object.keys(p.states[0])[0]] = "1";
    },
  ],
  [
    "伪造完整总数",
    (p) => {
      p.total_number = 49;
    },
  ],
]) {
  test(`未知响应不得终止放行：${label}`, () => {
    const h = fixture();
    mutatePayload(h, mutate);
    assert.throws(h.run);
  });
}

for (const [label, mutate] of [
  [
    "账户投影错配",
    (h) => {
      h.proof.accountScopeHash = "d".repeat(16);
    },
  ],
  [
    "usage账号未核对",
    (h) => {
      h.proof.usage[2].accountMatched = false;
    },
  ],
  [
    "ledger账号未核对",
    (h) => {
      h.proof.ledger[2].accountMatched = false;
    },
  ],
  [
    "usage完整UID被替换",
    (h) => {
      h.proof.usage[2].requestParams.uids += ",9999";
    },
  ],
  [
    "usage多匹配",
    (h) => {
      h.proof.usage[1] = { ...h.proof.usage[2], id: "9999" };
    },
  ],
  [
    "usage重复ID",
    (h) => {
      h.proof.usage[2].id = h.proof.usage[0].id;
    },
  ],
  [
    "ledger重复ID",
    (h) => {
      h.proof.ledger[2].id = h.proof.ledger[0].id;
    },
  ],
  [
    "ledger重复扣费源",
    (h) => {
      h.proof.ledger[2].source_id = h.proof.ledger[0].source_id;
    },
  ],
  [
    "ledger时间不对应usage",
    (h) => {
      h.proof.ledger[2].createdAt = h.proof.ledger[1].createdAt;
    },
  ],
  [
    "usage返回数量不足",
    (h) => {
      h.proof.usage[2].recordCount = 49;
    },
  ],
  [
    "usage少扣1分",
    (h) => {
      h.proof.usage[2].creditsDeducted = 149;
    },
  ],
  [
    "ledger借记少1分",
    (h) => {
      h.proof.ledger[2].delta = "-149";
    },
  ],
  [
    "账单描述数量错误",
    (h) => {
      h.proof.ledger[2].description =
        "[users/show_batch/other] per_record: 49 records × 3 pts";
    },
  ],
  [
    "账单描述单价错误",
    (h) => {
      h.proof.ledger[2].description =
        "[users/show_batch/other] per_record: 50 records × 4 pts";
    },
  ],
  [
    "余额链断",
    (h) => {
      h.proof.ledger[1].balanceAfter = "20155";
    },
  ],
  [
    "余额超精度",
    (h) => {
      h.proof.ledger[1].balanceAfter = "20156.0000001";
    },
  ],
  [
    "缺一份usage",
    (h) => {
      h.proof.usage.pop();
    },
  ],
  [
    "多一份账单",
    (h) => {
      h.proof.ledger.push({ ...h.proof.ledger[2], id: "9999" });
    },
  ],
  [
    "投影早于响应",
    (h) => {
      h.proof.projectionAt = JSON.parse(h.batches[0].attempt).startedAt;
    },
  ],
  [
    "投影晚于审核",
    (h) => {
      h.proof.projectionAt = new Date(
        Date.parse(h.reviewedAt) + 1,
      ).toISOString();
    },
  ],
  [
    "伪造来源",
    (h) => {
      h.proof.sourceKind = "manual_estimate";
    },
  ],
  [
    "旧周期账单重放",
    (h) => {
      Object.assign(h.proof, fixture({ date: "2026-09-04" }).proof);
    },
  ],
]) {
  test(`官方核账错配拒绝：${label}`, () => {
    const h = fixture();
    mutate(h);
    assert.throws(h.run);
  });
}

for (const [label, name, mutate, rebind] of [
  [
    "响应hash漂移",
    "response",
    (raw) => {
      raw.stdout += " ";
    },
    false,
  ],
  [
    "attempthash漂移",
    "attempt",
    (a) => {
      a.maximumCredits = 149;
    },
    false,
  ],
  [
    "attempt错误周期",
    "attempt",
    (a) => {
      a.slotId = "scheduled-2026-09-18";
    },
    true,
  ],
  [
    "attempt错账户",
    "attempt",
    (a) => {
      a.accountScope = "d".repeat(16);
    },
    true,
  ],
  [
    "attempt错group",
    "attempt",
    (a) => {
      a.groupIds[10] = "g385";
    },
    true,
  ],
  [
    "attempt命令错UID",
    "attempt",
    (a) => {
      a.command[2] += ",9999";
    },
    true,
  ],
  [
    "attempt早于guard",
    "attempt",
    (a) => {
      a.startedAt = "2026-09-10T16:00:01.000Z";
    },
    true,
  ],
  [
    "attempt已知金额猜造",
    "attempt",
    (a) => {
      a.maximumCredits = 0;
    },
    true,
  ],
  [
    "末批伪造success",
    "receipt",
    (r) => {
      r.outcome = "success";
    },
    true,
  ],
  [
    "末批伪造已核账",
    "receipt",
    (r) => {
      r.actualChargedCredits = 150;
    },
    true,
  ],
  [
    "receipt错周期",
    "receipt",
    (r) => {
      r.slotId = "scheduled-2026-09-18";
    },
    true,
  ],
  [
    "receipt错批次",
    "receipt",
    (r) => {
      r.requestKey = "e".repeat(64);
    },
    true,
  ],
  [
    "CLI超时",
    "response",
    (raw) => {
      raw.timedOut = true;
    },
    true,
  ],
  [
    "CLI失败",
    "response",
    (raw) => {
      raw.exitCode = 1;
    },
    true,
  ],
]) {
  test(`归档原件绑定拒绝：${label}`, () => {
    const h = fixture();
    mutateFile(h.batches[2], name, mutate, rebind);
    assert.throws(h.run);
  });
}

test("跳过已请求前缀、换序、前批无异常却记失败均拒绝", () => {
  for (const mutate of [
    (h) => {
      h.batches.splice(0, 1);
    },
    (h) => {
      [h.batches[0], h.batches[1]] = [h.batches[1], h.batches[0]];
    },
    (h) => {
      mutateFile(h.batches[0], "receipt", (r) => {
        r.outcome = "blocked";
      });
    },
  ]) {
    const h = fixture();
    mutate(h);
    assert.throws(h.run);
  }
});

test("多个账号受限、粉丝缺失或非法、省略UID均终止为保留旧值", () => {
  const h = fixture();
  mutatePayload(h, (payload) => {
    payload.users[0] = {
      european_user: true,
      id: Number(payload.users[0].idstr),
    };
    payload.users[1].followers_count = -1;
    payload.users[2].followers_count = "888";
    payload.users[3].nested = {
      idstr: payload.users[3].idstr,
      followers_count: 99999,
    };
    delete payload.users[3].followers_count;
    payload.users.pop();
  });
  const raw = JSON.parse(h.batches[2].response),
    uids = JSON.parse(h.batches[2].attempt).uids;
  const parsed = extractRecurringPartialProfiles(raw, uids);
  assert.equal(parsed.returnedCount, 50);
  assert.equal(parsed.profiles.length, 44);
  assert.equal(parsed.unavailable.length, 6);
  assert.ok(
    parsed.unavailable.some(
      (row) =>
        row.uid === uids[49] && row.reason === "provider_missing_profile",
    ),
  );
  assert.ok(
    parsed.unavailable.some(
      (row) =>
        row.uid === uids[3] && row.reason === "provider_profile_unavailable",
    ),
  );
  assert.equal(h.run().unavailable.length, 6);
  assert.equal(h.run().accounting.chargedCredits, 150);
});

test("收费数量取total_number并与官方usage闭合，不把请求50冒充实际49", () => {
  const h = fixture();
  mutatePayload(h, (payload) => {
    payload.users.pop();
    payload.total_number = 49;
  });
  assert.throws(h.run, /recurring_usage_charge_mismatch/);
  h.proof.usage[2].recordCount = 49;
  h.proof.usage[2].creditsDeducted = 147;
  h.proof.ledger[2].delta = "-147";
  h.proof.ledger[2].description =
    "[users/show_batch/other] per_record: 49 records × 3 pts";
  h.proof.ledger[2].balanceAfter = "20009";
  const result = h.run();
  assert.equal(result.accounting.chargedCredits, 147);
  assert.equal(result.accounting.totalChargedCredits, 447);
  assert.equal(result.unavailable.length, 2);
});

test("全批无返回仅凭明确官方零费usage结束，不合成借记或粉丝值", () => {
  const h = fixture();
  mutatePayload(h, (payload) => {
    payload.users = [];
    payload.total_number = 0;
  });
  assert.throws(h.run, /recurring_usage_charge_mismatch/);
  h.proof.usage[2].recordCount = 0;
  h.proof.usage[2].creditsDeducted = 0;
  h.proof.ledger.pop();
  const result = h.run();
  assert.equal(result.unavailable.length, 50);
  assert.equal(result.accounting.chargedCredits, 0);
  assert.equal(result.accounting.totalChargedCredits, 300);
  assert.equal(result.accounting.balanceAfter, 20156);
  assert.equal(result.accounting.usageIds.length, 3);
  assert.equal(result.accounting.ledgerIds.length, 2);
  h.proof.usage[2].creditsDeducted = null;
  assert.throws(h.run);
});

test("连续两个partial批次可按前缀分别核账，旧blocked记录和前缀总额不改写", () => {
  const h = fixture();
  mutateFile(h.batches[0], "response", (raw) => {
    const payload = JSON.parse(raw.stdout);
    delete payload.users[0].followers_count;
    raw.stdout = JSON.stringify(payload);
  });
  mutateFile(h.batches[0], "receipt", (receipt) => {
    receipt.outcome = "blocked";
    receipt.blocker = "incomplete_weekly_response";
    receipt.settlement = "uncertain_requires_reconciliation";
  });
  const partialProof = {
    ...h.proof,
    usage: h.proof.usage.slice(0, 1),
    ledger: h.proof.ledger.slice(0, 1),
  };
  const first = prepareRecurringWeeklyReconciliation(
    h.batches.slice(0, 1),
    weeklyEvidenceBytes(partialProof),
    h.reviewedAt,
    h.mode,
  );
  assert.equal(first.unavailable.length, 1);
  assert.equal(first.accounting.totalChargedCredits, 150);
  const original = sha256(h.batches[0].receipt);
  const later = h.run();
  assert.equal(later.unavailable.length, 1);
  assert.equal(later.accounting.totalChargedCredits, 450);
  assert.notEqual(first.requestKey, later.requestKey);
  assert.equal(sha256(h.batches[0].receipt), original);
});

test("续采换guard支持新余额和新价格；旧guard重用不重扣其初始余额", () => {
  const h = fixture();
  const priorObserved = Date.parse(JSON.parse(h.batches[0].receipt).observedAt);
  const guard = JSON.parse(h.batches[1].guard);
  guard.checkedAt = new Date(priorObserved + 100).toISOString();
  guard.capability.observedAt = new Date(priorObserved + 50).toISOString();
  guard.capability.priceObservedAt = guard.capability.observedAt;
  guard.capability.balance = 20306;
  guard.capability.unitCost = 5;
  guard.pendingAccounts = 325;
  guard.budget.maximumCredits = guard.budget.budgetCredits = 325 * 5;
  const bytes = weeklyEvidenceBytes(guard);
  for (const index of [1, 2]) {
    h.batches[index].guard = bytes;
    mutateFile(h.batches[index], "attempt", (attempt) => {
      attempt.guardId = attempt.guardSha256 = sha256(bytes);
      attempt.maximumCredits = 250;
    });
    h.proof.usage[index].creditsDeducted = 250;
    h.proof.ledger[index].delta = "-250";
    h.proof.ledger[index].balanceAfter = String(20306 - index * 250);
    h.proof.ledger[index].description =
      "[users/show_batch/other] per_record: 50 records × 5 pts";
  }
  assert.equal(h.run().accounting.totalChargedCredits, 650);
  assert.equal(h.run().accounting.balanceAfter, 19806);
  const changed = JSON.parse(bytes);
  changed.capability.balance += 1;
  const wrong = weeklyEvidenceBytes(changed);
  h.batches[1].guard = wrong;
  mutateFile(h.batches[1], "attempt", (attempt) => {
    attempt.guardId = attempt.guardSha256 = sha256(wrong);
  });
  assert.throws(h.run, /recurring_guard_balance_chain_mismatch/);
});

test("全局错误、未知顶层结构、根UID矛盾与损坏JSON仍阻断", () => {
  for (const mutate of [
    (p) => {
      p.error = "service failed";
    },
    (p) => {
      p.ok = false;
    },
    (p) => {
      p.users[0].uid = p.users[1].idstr;
    },
    (p) => {
      p.users[0] = { nested: p.users[0] };
    },
    (p) => {
      p.total_number = 51;
    },
    (p) => {
      p.total_number = -1;
    },
    (p) => {
      p.users[0].id = 9007199254740992;
    },
  ]) {
    const h = fixture();
    mutatePayload(h, mutate);
    assert.throws(h.run);
  }
  const h = fixture();
  mutateFile(h.batches[2], "response", (raw) => {
    raw.stdout = "{";
  });
  assert.throws(h.run);
});

test("能匹配UID的单账号错误保留旧值，不把错误对象内旧粉丝当新观察", () => {
  for (const fields of [
    { ok: false },
    { success: false },
    { error: "profile unavailable" },
    { error_code: 123 },
    { screen_name: 123 },
    { screen_name: {} },
  ]) {
    const h = fixture();
    mutatePayload(h, (payload) => Object.assign(payload.users[0], fields));
    const result = h.run();
    assert.equal(result.unavailable.length, 2);
    assert.equal(result.unavailable[0].reason, "provider_profile_unavailable");
  }
});

test("零费时间容差重叠也不能把一条ledger重复匹配两次usage", () => {
  const h = fixture({ count: 100, blockedIndex: 1 });
  for (const batch of h.batches) {
    mutateFile(batch, "response", (raw) => {
      const payload = JSON.parse(raw.stdout);
      payload.users = [];
      payload.total_number = 0;
      raw.stdout = JSON.stringify(payload);
    });
    mutateFile(batch, "receipt", (receipt) => {
      receipt.outcome = "blocked";
      receipt.blocker = "incomplete_weekly_response";
      receipt.settlement = "uncertain_requires_reconciliation";
    });
  }
  const createdAt = h.proof.usage[0].createdAt;
  for (const row of h.proof.usage) {
    row.recordCount = 0;
    row.creditsDeducted = 0;
    row.createdAt = createdAt;
  }
  h.proof.ledger = [
    {
      ...h.proof.ledger[0],
      delta: "0",
      balanceAfter: "20456",
      description: "[users/show_batch/other] per_record: 0 records × 3 pts",
    },
  ];
  assert.throws(h.run, /reconciliation_accounting_reuse/);
});

test("只含已知哨兵的单账号响应保留空观察，但完整CLI与states仍须校验", () => {
  const h = fixture({ count: 1, blockedIndex: 0 });
  const raw = JSON.parse(h.batches[0].response);
  assert.deepEqual(extractRecurringWithheldProfiles(raw, [WITHHELD_UID]), []);
  assert.throws(() =>
    extractRecurringWithheldProfiles({ ...raw, stderr: "failed" }, [
      WITHHELD_UID,
    ]),
  );
});

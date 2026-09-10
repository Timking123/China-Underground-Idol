import assert from "node:assert/strict";
import test from "node:test";
import { collectWeeklyWithRecovery } from "../server/weeklyCollection.ts";

const SLOT = "scheduled-2026-09-11";
const OTHER_SLOT = "scheduled-2026-09-18";
const PARTIAL = "incomplete_weekly_response";
const sha = (number) => number.toString(16).padStart(64, "0");
const recovered = (number) => ({
  reused: false,
  reconciliationSha256: sha(number),
});

function runtime(status, patch = {}) {
  return {
    status,
    slotId: SLOT,
    reused: status === "complete",
    requests: 0,
    cachedBatches: status === "complete" ? 8 : 0,
    pendingBatches: status === "complete" ? 0 : 8,
    ...(status === "blocked" ? { blocker: PARTIAL } : {}),
    ...patch,
  };
}

// 只注入状态和操作结果；不导入真实 runtime、浏览器、账户或任何网络客户端。
function scripted(runs, recoveries = [], priceError) {
  const calls = { runs: [], reconciliations: [], prices: 0, order: [] };
  const deps = {
    run: async (live) => {
      calls.runs.push(live);
      calls.order.push(`run:${live}`);
      const next = runs.shift();
      assert.ok(next, "不得多执行一次 runtime");
      assert.equal(live, next.live, "观察与收费运行的顺序必须匹配");
      if (next.error) throw next.error;
      return next.result;
    },
    refreshPrice: async () => {
      calls.prices++;
      calls.order.push("price");
      if (priceError) throw priceError;
    },
    reconcile: async (slotId) => {
      calls.reconciliations.push(slotId);
      calls.order.push("reconcile");
      assert.equal(slotId, SLOT);
      const next = recoveries.shift();
      assert.ok(next, "不得多查询一次核账");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return {
    calls,
    deps,
    remaining: () => ({ runs: runs.length, recoveries: recoveries.length }),
  };
}

test("全成功只在初始观察后刷新一次价目，返回完整结果及八次实际请求", async () => {
  const complete = runtime("complete", {
    requests: 8,
    reused: false,
    snapshot: { marker: "完整集合" },
  });
  const f = scripted([
    { live: false, result: runtime("planned") },
    { live: true, result: complete },
  ]);
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.deepEqual(result, { ...complete, requests: 8, reconciledBatches: 0 });
  assert.deepEqual(f.calls.order, ["run:false", "price", "run:true"]);
  assert.deepEqual(f.calls.reconciliations, []);
  assert.deepEqual(f.remaining(), { runs: 0, recoveries: 0 });
});

test("起始已有失败先核账再启动后续运行，不把历史三次请求计入本次五次请求", async () => {
  const f = scripted(
    [
      {
        live: false,
        result: runtime("blocked", {
          cachedBatches: 2,
          pendingBatches: 6,
          blocker: `weekly_uncertain_attempt:${SLOT}-batch03`,
        }),
      },
      {
        live: false,
        result: runtime("planned", {
          reused: true,
          cachedBatches: 3,
          pendingBatches: 5,
        }),
      },
      {
        live: true,
        result: runtime("complete", { requests: 5, reused: false }),
      },
    ],
    [recovered(3)],
  );
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.equal(result.requests, 5);
  assert.equal(result.reconciledBatches, 1);
  assert.deepEqual(f.calls.order, [
    "run:false",
    "reconcile",
    "run:false",
    "price",
    "run:true",
  ]);
  assert.deepEqual(f.calls.reconciliations, [SLOT]);
});

test("一次 partial 后先核账并观察缓存进展，再继续剩余五批，请求总数为三加五", async () => {
  const f = scripted(
    [
      { live: false, result: runtime("planned") },
      {
        live: true,
        result: runtime("blocked", {
          requests: 3,
          cachedBatches: 2,
          pendingBatches: 6,
        }),
      },
      {
        live: false,
        result: runtime("planned", {
          reused: true,
          cachedBatches: 3,
          pendingBatches: 5,
        }),
      },
      {
        live: true,
        result: runtime("complete", { requests: 5, reused: false }),
      },
    ],
    [recovered(3)],
  );
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.equal(result.status, "complete");
  assert.equal(result.requests, 8);
  assert.equal(result.reconciledBatches, 1);
  assert.deepEqual(f.calls.order, [
    "run:false",
    "price",
    "run:true",
    "reconcile",
    "run:false",
    "price",
    "run:true",
  ]);
});

test("同一轮两次 partial 可分别核账，请求累计为二加三加三且不会重新收费失败批次", async () => {
  const f = scripted(
    [
      { live: false, result: runtime("planned") },
      {
        live: true,
        result: runtime("blocked", {
          requests: 2,
          cachedBatches: 1,
          pendingBatches: 7,
        }),
      },
      {
        live: false,
        result: runtime("planned", {
          reused: true,
          cachedBatches: 2,
          pendingBatches: 6,
        }),
      },
      {
        live: true,
        result: runtime("blocked", {
          requests: 3,
          cachedBatches: 4,
          pendingBatches: 4,
        }),
      },
      {
        live: false,
        result: runtime("planned", {
          reused: true,
          cachedBatches: 5,
          pendingBatches: 3,
        }),
      },
      {
        live: true,
        result: runtime("complete", { requests: 3, reused: false }),
      },
    ],
    [recovered(2), recovered(5)],
  );
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.equal(result.requests, 8);
  assert.equal(result.reconciledBatches, 2);
  assert.equal(f.calls.prices, 3);
  assert.deepEqual(f.calls.runs, [false, true, false, true, false, true]);
  assert.deepEqual(f.calls.reconciliations, [SLOT, SLOT]);
  assert.deepEqual(f.remaining(), { runs: 0, recoveries: 0 });
});

test("八批都 partial 时全部核账后允许零请求完成集合，不能在第八次恢复处提前触顶", async () => {
  const runs = [{ live: false, result: runtime("planned") }];
  for (let batch = 1; batch <= 8; batch++) {
    runs.push({
      live: true,
      result: runtime("blocked", {
        requests: 1,
        cachedBatches: batch - 1,
        pendingBatches: 9 - batch,
      }),
    });
    // 真实 runtime 在 live=false 时即使 pending=0 仍返回 planned。
    runs.push({
      live: false,
      result: runtime("planned", {
        reused: true,
        cachedBatches: batch,
        pendingBatches: 8 - batch,
      }),
    });
  }
  runs.push({ live: true, result: runtime("complete", { requests: 0 }) });
  const f = scripted(
    runs,
    Array.from({ length: 8 }, (_, index) => recovered(index + 1)),
  );
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.equal(result.status, "complete");
  assert.equal(result.requests, 8);
  assert.equal(result.reconciledBatches, 8);
  assert.equal(result.pendingBatches, 0);
  assert.equal(f.calls.runs.filter((live) => live).length, 9);
  assert.equal(f.calls.reconciliations.length, 8);
  assert.equal(f.calls.prices, 8);
  assert.deepEqual(f.remaining(), { runs: 0, recoveries: 0 });
});

test("末批 partial 核账后观察已 complete，可直接返回且累计之前失败调用的请求", async () => {
  const f = scripted(
    [
      { live: false, result: runtime("planned") },
      {
        live: true,
        result: runtime("blocked", {
          requests: 8,
          cachedBatches: 7,
          pendingBatches: 1,
        }),
      },
      { live: false, result: runtime("complete") },
    ],
    [recovered(8)],
  );
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.equal(result.requests, 8);
  assert.equal(result.reconciledBatches, 1);
  assert.equal(f.calls.prices, 1);
  assert.deepEqual(f.calls.runs, [false, true, false]);
});

test("所有批次已有缓存但集合待完成时，直接执行零请求完成，不刷新价目", async () => {
  const f = scripted([
    {
      live: false,
      result: runtime("planned", {
        reused: true,
        cachedBatches: 8,
        pendingBatches: 0,
      }),
    },
    { live: true, result: runtime("complete") },
  ]);
  const result = await collectWeeklyWithRecovery(SLOT, f.deps);
  assert.equal(result.requests, 0);
  assert.equal(result.reconciledBatches, 0);
  assert.deepEqual(f.calls.order, ["run:false", "run:true"]);
});

for (const [name, completed] of [
  ["出现额外业务请求", runtime("complete", { requests: 1 })],
  ["返回错误周期", runtime("complete", { slotId: OTHER_SLOT })],
  ["仍未完成", runtime("blocked")],
]) {
  test(`零请求完成分支${name}时拒绝宣称成功且不再次运行`, async () => {
    const f = scripted([
      {
        live: false,
        result: runtime("planned", {
          reused: true,
          cachedBatches: 8,
          pendingBatches: 0,
        }),
      },
      { live: true, result: completed },
    ]);
    await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
      message: "weekly_recovery_collection_incomplete",
    });
    assert.deepEqual(f.calls.order, ["run:false", "run:true"]);
    assert.equal(f.calls.prices, 0);
    assert.deepEqual(f.calls.reconciliations, []);
  });
}

for (const initiallyBlocked of [true, false]) {
  test(`${initiallyBlocked ? "已有" : "本次"}失败的核账未通过时不再启动业务请求`, async () => {
    const accountingFailure = new Error("weekly_accounting_account_mismatch");
    const runs = initiallyBlocked
      ? [{ live: false, result: runtime("blocked") }]
      : [
          { live: false, result: runtime("planned") },
          { live: true, result: runtime("blocked", { requests: 3 }) },
        ];
    const f = scripted(runs, [accountingFailure]);
    await assert.rejects(
      collectWeeklyWithRecovery(SLOT, f.deps),
      (error) => error === accountingFailure,
    );
    assert.equal(
      f.calls.runs.filter((live) => live).length,
      initiallyBlocked ? 0 : 1,
    );
    assert.equal(f.calls.prices, initiallyBlocked ? 0 : 1);
    assert.deepEqual(f.calls.reconciliations, [SLOT]);
    assert.equal(f.calls.order.at(-1), "reconcile");
  });
}

test("核账 reused 表明未推进，立即停止且不刷新价目", async () => {
  const f = scripted(
    [{ live: false, result: runtime("blocked") }],
    [{ reused: true, reconciliationSha256: sha(1) }],
  );
  await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
    message: "weekly_recovery_no_progress",
  });
  assert.deepEqual(f.calls.order, ["run:false", "reconcile"]);
});

test("不同失败返回相同 reconciliation SHA 时拒绝重复推进", async () => {
  const f = scripted(
    [
      { live: false, result: runtime("blocked") },
      {
        live: false,
        result: runtime("planned", { cachedBatches: 1, pendingBatches: 7 }),
      },
      { live: true, result: runtime("blocked", { requests: 1 }) },
    ],
    [recovered(1), recovered(1)],
  );
  await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
    message: "weekly_recovery_no_progress",
  });
  assert.deepEqual(f.calls.order, [
    "run:false",
    "reconcile",
    "run:false",
    "price",
    "run:true",
    "reconcile",
  ]);
  assert.equal(f.calls.prices, 1);
});

test("初始观察属于错误 slot 时不查询价目或核账", async () => {
  const f = scripted([
    { live: false, result: runtime("blocked", { slotId: OTHER_SLOT }) },
  ]);
  await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
    message: "weekly_collection_slot_mismatch",
  });
  assert.deepEqual(f.calls.order, ["run:false"]);
});

test("业务运行返回错误 slot 时不再核账或继续业务", async () => {
  const f = scripted([
    { live: false, result: runtime("planned") },
    {
      live: true,
      result: runtime("blocked", { slotId: OTHER_SLOT, requests: 1 }),
    },
  ]);
  await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
    message: "weekly_collection_slot_mismatch",
  });
  assert.deepEqual(f.calls.order, ["run:false", "price", "run:true"]);
});

for (const status of ["planned", "complete"]) {
  test(`核账后的 ${status} 属于错误 slot 时必须停止，不能继续收费或返回假完成`, async () => {
    const f = scripted(
      [
        { live: false, result: runtime("blocked") },
        { live: false, result: runtime(status, { slotId: OTHER_SLOT }) },
      ],
      [recovered(1)],
    );
    await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
      message: "weekly_collection_slot_mismatch",
    });
    assert.deepEqual(f.calls.order, ["run:false", "reconcile", "run:false"]);
    assert.equal(f.calls.prices, 0);
  });
}

for (const blocker of [
  "weekly_price_unavailable",
  "unknown_weekly_withheld_sentinel",
  `weekly_uncertain_attempt:${OTHER_SLOT}-batch01`,
  undefined,
]) {
  test(`未知或跨周期 blocker ${blocker ?? "缺失"} 不触发核账及业务请求`, async () => {
    const f = scripted([
      { live: false, result: runtime("blocked", { blocker }) },
    ]);
    await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
      message: blocker ?? "weekly_collection_blocked",
    });
    assert.deepEqual(f.calls.order, ["run:false"]);
    assert.deepEqual(f.calls.reconciliations, []);
  });
}

test("核账后的观察仍 blocked 时停止，不以新核账记录为由重发业务", async () => {
  const f = scripted(
    [
      { live: false, result: runtime("blocked") },
      { live: false, result: runtime("blocked") },
    ],
    [recovered(1)],
  );
  await assert.rejects(collectWeeklyWithRecovery(SLOT, f.deps), {
    message: PARTIAL,
  });
  assert.deepEqual(f.calls.order, ["run:false", "reconcile", "run:false"]);
});

test("重复 complete 两次均只观察一次，零价目、零核账和零业务请求", async () => {
  const complete = runtime("complete", { snapshot: { marker: "已完成集合" } });
  const f = scripted([
    { live: false, result: complete },
    { live: false, result: complete },
  ]);
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await collectWeeklyWithRecovery(SLOT, f.deps);
    assert.deepEqual(result, {
      ...complete,
      requests: 0,
      reconciledBatches: 0,
    });
  }
  assert.deepEqual(f.calls.order, ["run:false", "run:false"]);
  assert.equal(f.calls.prices, 0);
  assert.deepEqual(f.calls.reconciliations, []);
});

test("价目刷新失败不能执行随后的业务运行", async () => {
  const priceFailure = new Error("weekly_price_unavailable");
  const f = scripted(
    [{ live: false, result: runtime("planned") }],
    [],
    priceFailure,
  );
  await assert.rejects(
    collectWeeklyWithRecovery(SLOT, f.deps),
    (error) => error === priceFailure,
  );
  assert.deepEqual(f.calls.order, ["run:false", "price"]);
});

test("业务运行直接抛错时不尝试按异常重发收费请求", async () => {
  const failure = new Error("runtime transport unavailable");
  const f = scripted([
    { live: false, result: runtime("planned") },
    { live: true, error: failure },
  ]);
  await assert.rejects(
    collectWeeklyWithRecovery(SLOT, f.deps),
    (error) => error === failure,
  );
  assert.deepEqual(f.calls.order, ["run:false", "price", "run:true"]);
});

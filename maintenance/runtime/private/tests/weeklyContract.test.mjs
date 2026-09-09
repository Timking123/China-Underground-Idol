import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWeeklyProfiles,
  resolveCurrentWeeklyCapability,
  weeklyBudget,
  weeklyEvidenceBytes,
  weeklyProfileArguments,
} from "../src/weeklyContract.ts";

const raw = (users) => ({
  cliVersion: "0.9.1",
  stdout: JSON.stringify({ users }),
  stderr: "",
  exitCode: 0,
  timedOut: false,
  signal: null,
});

test("真实生产合同缺失时历史余额、command318和猜测单价都不能放行", () => {
  for (const evidence of [
    null,
    {},
    { commandId: 318 },
    { billingUnit: "returned_item", unitCost: 3, balance: 21581 },
  ])
    assert.throws(
      () => resolveCurrentWeeklyCapability(evidence, new Date()),
      /current_returned_item_price_unavailable/,
    );
});

test("请求参数严格UID单批50上限，响应按UID重排而不按昵称改绑", () => {
  assert.deepEqual(weeklyProfileArguments(["123456", "654321"]), [
    "users",
    "show_batch/other",
    "--uids=123456,654321",
    "--output",
    "json",
  ]);
  const profiles = extractWeeklyProfiles(
    raw([
      { idstr: "654321", followers_count: 2, screen_name: "新昵称" },
      { idstr: "123456", followers_count: 1 },
    ]),
    ["123456", "654321"],
  );
  assert.deepEqual(
    profiles.map((item) => item.uid),
    ["123456", "654321"],
  );
  assert.equal(profiles[1].displayName, "新昵称");
  for (const uids of [
    [],
    ["1234", "1234"],
    ["1234;echo"],
    Array.from({ length: 51 }, (_, i) => String(10000 + i)),
  ])
    assert.throws(() => weeklyProfileArguments(uids));
});

test("缺项、额外项、重复UID及数值UID冲突都拒绝为完整返回", () => {
  for (const users of [
    [],
    [
      { idstr: "1234", followers_count: 1 },
      { idstr: "1234", followers_count: 2 },
    ],
    [{ idstr: "1234", id: 5678, followers_count: 1 }],
    [{ idstr: "5678", followers_count: 1 }],
    [{ id: Number.MAX_SAFE_INTEGER + 1, followers_count: 1 }],
    [{ idstr: "1234", followers_count: -1 }],
  ])
    assert.throws(() => extractWeeklyProfiles(raw(users), ["1234"]));
});

test("超时、信号、非零退出、stderr与嵌套业务错误保持失败", () => {
  const valid = raw([{ idstr: "1234", followers_count: 1 }]);
  for (const change of [
    { timedOut: true },
    { signal: "SIGTERM" },
    { exitCode: 1 },
    { stderr: "warning" },
    { stdout: "{not-json}" },
    {
      stdout: JSON.stringify({
        users: [{ idstr: "1234", followers_count: 1 }],
        nested: { error_code: 1 },
      }),
    },
  ])
    assert.throws(() =>
      extractWeeklyProfiles({ ...valid, ...change }, ["1234"]),
    );
});

test("嵌套JSON凭据形态拒绝，普通公开团名Token不误判", () => {
  assert.doesNotThrow(() =>
    weeklyEvidenceBytes({ name: "Token", bio: "Token 新企划" }),
  );
  for (const value of [
    { access_token: "canary" },
    { stdout: JSON.stringify({ nested: { token: "canary" } }) },
    { stdout: JSON.stringify({ note: "Authorization: Bearer canary012345" }) },
    {
      raw: JSON.stringify({
        nested: JSON.stringify({ refresh_token: "canary" }),
      }),
    },
  ])
    assert.throws(
      () => weeklyEvidenceBytes(value),
      /sensitive_weekly_evidence_rejected/,
    );
});

test("预算保留4000C，分数单价计算最大值，不宣称实际扣费", () => {
  const now = new Date("2026-09-09T10:00:00.000Z");
  const capability = {
    schemaVersion: "idol-weekly-capability-v2",
    evidenceKind: "synthetic",
    accountScope: "a".repeat(16),
    serviceKind: "formal_active",
    commandId: 318,
    command: "users/show_batch/other",
    billingUnit: "returned_item",
    unitCost: 0.1,
    balance: 4037.5,
    observedAt: now.toISOString(),
    priceObservedAt: now.toISOString(),
    evidence: [{ path: "synthetic.json", sha256: "b".repeat(64) }],
  };
  const result = weeklyBudget(capability, 375, "auto", now, "synthetic");
  assert.deepEqual(result, {
    maximumCredits: 37.5,
    budgetCredits: 37.5,
    reserveCredits: 4000,
  });
  assert.throws(
    () =>
      weeklyBudget(
        { ...capability, balance: 4037.4 },
        375,
        "auto",
        now,
        "synthetic",
      ),
    /weekly_budget_or_reserve_exceeded/,
  );
  assert.throws(
    () => weeklyBudget(capability, 375, 37.4, now, "synthetic"),
    /weekly_budget_or_reserve_exceeded/,
  );
});

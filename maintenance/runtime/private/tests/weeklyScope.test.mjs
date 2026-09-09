import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWeeklyRuntimePlan,
  buildWeeklyScope,
  weeklySlot,
} from "../src/weeklyScope.ts";
import { TEST_NOW, weeklyFixture } from "./weeklyFixtures.mjs";

test("全范围375账号拆8批，严格279、编辑94、企划2保留身份与24个排除项", () => {
  const plan = buildWeeklyRuntimePlan(
    weeklyFixture().inputs(),
    weeklySlot("manual", new Date(TEST_NOW)),
    TEST_NOW,
  );
  assert.equal(plan.scope.activeCount, 375);
  assert.equal(plan.scope.targets.length, 375);
  assert.deepEqual(
    plan.batches.map((batch) => batch.uids.length),
    [50, 50, 50, 50, 50, 50, 50, 25],
  );
  assert.equal(plan.maximumBatches, 8);
  assert.equal(plan.maximumAccounts, 375);
  assert.deepEqual(plan.blockers, []);
  const counts = plan.scope.targets.reduce(
    (result, row) => ({
      ...result,
      [row.identityGate]: (result[row.identityGate] ?? 0) + 1,
    }),
    {},
  );
  assert.deepEqual(counts, {
    strict_uid_match: 279,
    reviewed_account_scope: 2,
    accepted_candidate: 94,
  });
  assert.equal(plan.scope.excluded.length, 24);
  for (const id of ["g275", "g303"]) {
    assert.ok(plan.scope.excluded.some((row) => row.id === id));
    assert.ok(!plan.scope.targets.some((row) => row.id === id));
  }
  assert.ok(
    plan.scope.targets.every(
      (row) =>
        row.identityAcceptedByThisRun === false &&
        row.canonicalImpact === "none",
    ),
  );
});

test("两个企划范围接受保留原单团拒绝及免责声明，不假造strict", () => {
  const fixture = weeklyFixture();
  const scope = buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW));
  for (const id of ["g060", "g360"]) {
    const row = scope.targets.find((item) => item.id === id);
    assert.equal(row.identityGate, "reviewed_account_scope");
    assert.match(row.scopeNote, /不属于旗下任意单团/);
    assert.equal(
      fixture.model.display.groups.find((item) => item.id === id).fieldEvidence
        .profileIdentity.state,
      "blocked",
    );
  }
});

test("取消账号范围复核后不借旧拒绝账号继续抓取", () => {
  const fixture = weeklyFixture();
  fixture.model.publicReview.records =
    fixture.model.publicReview.records.filter((row) => row.id !== "g360");
  const scope = buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW));
  assert.ok(
    scope.review.some(
      (row) =>
        row.id === "g360" && row.reason === "unresolved_identity_rejection",
    ),
  );
  assert.ok(!scope.targets.some((row) => row.id === "g360"));
});

test("编辑补充须联合pending基础UID与接受决定，不能只看展示层high", () => {
  const fixture = weeklyFixture();
  const base = fixture.model.acceptance.records[0],
    id = base.id;
  base.status = "pending_timeline";
  fixture.model.editorial.records.find(
    (row) => row.id === id,
  ).profileSupplement.sourceFile =
    "sources/微博编辑身份补充复核批次_2026-09-04.json";
  let scope = buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW));
  assert.ok(scope.review.some((row) => row.id === id));
  fixture.model.supplement.records.push({
    id,
    priorStatus: "pending_timeline",
    decisionStatus: "accepted",
    identityEvidenceSummary: base.identityEvidenceSummary,
    reviewBasis: "weak_exact_handle_and_timeline",
  });
  scope = buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW));
  const accepted = scope.targets.find((row) => row.id === id);
  assert.equal(accepted.identityGate, "accepted_candidate");
  assert.equal(accepted.identityBasis, "weak_exact_handle_and_timeline");
  assert.equal(accepted.identityEvidence, base.identityEvidenceSummary);
  base.uid = "9999999999";
  assert.ok(
    buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW)).review.some(
      (row) => row.id === id,
    ),
  );
});

test("Edge已复核更名沿用UID，不以旧handle和新昵称不同制造冲突", () => {
  const fixture = weeklyFixture();
  const base = fixture.model.acceptance.records.find(
    (row) => row.id === "g320",
  );
  fixture.model.edge.records.push({
    ...base,
    screenName: "Asobou_channel",
    reviewBasis: "renamed_successor_official_profile",
  });
  fixture.model.editorial.records.find(
    (row) => row.id === "g320",
  ).profileSupplement.sourceFile =
    "sources/Edge微博人工复核补充_2026-09-04.json";
  const target = buildWeeklyScope(
    fixture.inputs(),
    new Date(TEST_NOW),
  ).targets.find((row) => row.id === "g320");
  assert.equal(target.uid, base.uid);
  assert.equal(target.identityGate, "accepted_candidate");
  assert.equal(target.identityBasis, "renamed_successor_official_profile");
});

test("重复UID和未解决严格拒绝阻断整个全范围计划，不静默少采", () => {
  const fixture = weeklyFixture();
  fixture.model.display.groups[1].weiboUid =
    fixture.model.display.groups[0].weiboUid;
  const third = fixture.model.display.groups[2];
  fixture.model.conflicts.records.push({ id: third.id, uid: third.weiboUid });
  const plan = buildWeeklyRuntimePlan(
    fixture.inputs(),
    weeklySlot("manual", new Date(TEST_NOW)),
    TEST_NOW,
  );
  assert.deepEqual(plan.blockers, ["weekly_scope_requires_review"]);
  assert.equal(plan.scope.review.length, 3);
});

test("状态布尔与文本矛盾进入复核，不用旧master存续补入", () => {
  const fixture = weeklyFixture();
  fixture.model.display.groups.find((row) => row.id === "g303").isActive = true;
  const scope = buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW));
  assert.ok(
    scope.review.some(
      (row) => row.id === "g303" && row.reason === "active_status_conflict",
    ),
  );
  assert.ok(!scope.targets.some((row) => row.id === "g303"));
});

test("解析对象篡改不能脱离冻结字节改变范围，原字节变化改变sourcehash", () => {
  const fixture = weeklyFixture(),
    inputs = fixture.inputs();
  const expected = buildWeeklyScope(inputs, new Date(TEST_NOW));
  inputs.displayGroups[0].weiboUid = "9999999999";
  assert.deepEqual(buildWeeklyScope(inputs, new Date(TEST_NOW)), expected);
  fixture.model.display.groups[0].name += "已审更名";
  assert.notEqual(
    buildWeeklyScope(fixture.inputs(), new Date(TEST_NOW)).sourceSha256,
    expected.sourceSha256,
  );
});

test("超过已授权8批必须停线，不能把401项截到400", () => {
  const fixture = weeklyFixture(401);
  const plan = buildWeeklyRuntimePlan(
    fixture.inputs(),
    weeklySlot("manual", new Date(TEST_NOW)),
    TEST_NOW,
  );
  assert.equal(plan.scope.activeCount, 401);
  assert.equal(plan.scope.targets.length, 401);
  assert.equal(plan.batches.length, 9);
  assert.deepEqual(plan.blockers, ["weekly_scope_exceeds_authorized_batches"]);
});

test("手动槽与同周周五槽独立，周五零点边界精确且不接受任意运行ID", () => {
  const manual = weeklySlot("manual", new Date(TEST_NOW));
  assert.equal(manual.id, "manual-2026-09-09");
  assert.equal(
    weeklySlot("manual", new Date("2026-09-10T15:59:59.999Z")).id,
    manual.id,
  );
  assert.throws(
    () => weeklySlot("scheduled", new Date("2026-09-10T15:59:59.999Z")),
    /weekly_schedule_not_started/,
  );
  assert.throws(
    () => weeklySlot("manual", new Date("2026-09-10T16:00:00.000Z")),
    /weekly_slot_closed/,
  );
  const friday = weeklySlot("scheduled", new Date("2026-09-10T16:00:00.000Z"));
  assert.equal(friday.id, "scheduled-2026-09-11");
  assert.equal(
    weeklySlot("scheduled", new Date("2026-09-17T15:59:59.999Z")).id,
    friday.id,
  );
  assert.equal(
    weeklySlot("scheduled", new Date("2026-09-17T16:00:00.000Z")).id,
    "scheduled-2026-09-18",
  );
  assert.throws(
    () => weeklySlot("retry-1", new Date(TEST_NOW)),
    /invalid_weekly_trigger/,
  );
  const source = weeklyFixture().inputs();
  const p1 = buildWeeklyRuntimePlan(source, manual, TEST_NOW);
  const p2 = buildWeeklyRuntimePlan(source, friday, friday.startsAt);
  assert.notEqual(p1.batches[0].key, p2.batches[0].key);
});

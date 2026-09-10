import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { emptyFollowerObservations } from "../../site/src/catalog/followerObservations.ts";
import { createSyntheticWeeklyRuntime } from "../src/weeklyRuntime.ts";
import { prepareWeeklyRuntimeProjection } from "../src/weeklyRuntimeApplication.ts";
import { buildWeeklyRuntimePlan, weeklySlot } from "../src/weeklyScope.ts";
import { sha256 } from "../src/sourceCapture.ts";
import { weeklyFixture } from "./weeklyFixtures.mjs";

const fixtures = path.resolve("reports/weekly-runtime/fixtures");
const unitCost = 3;
const accountScope = "9".repeat(16);
const jsonBytes = (value) => Buffer.from(JSON.stringify(value) + "\n");

// 两周共用同一真实归档仓库，仅替换外部 IO；账单根据请求记录独立生成。
async function recurringHarness() {
  await mkdir(fixtures, { recursive: true });
  const fixture = weeklyFixture(375);
  const state = {
    time: Date.parse("2026-09-11T00:00:00+08:00"),
    slotId: "scheduled-2026-09-11",
    followers: 1035,
    balance: 24000,
    inputsCount: 0,
    probes: 0,
    requests: [],
    cacheOnly: false,
  };
  const now = () => new Date(state.time);
  const plan = buildWeeklyRuntimePlan(
    fixture.inputs(),
    weeklySlot("scheduled", now()),
    now().toISOString(),
  );
  const europeanUid = plan.batches[2].uids[11];
  const invalidUid = plan.batches[3].uids[8];
  const unavailable = [europeanUid, invalidUid].map((uid) =>
    plan.scope.targets.find((target) => target.uid === uid),
  );
  assert.notEqual(europeanUid, "7817455308");
  assert.notEqual(unavailable[0].id, "g384");
  const root = await mkdtemp(path.join(fixtures, "recurring-multi-partial-"));
  const runtime = await createSyntheticWeeklyRuntime({
    root,
    now,
    inputs: async () => {
      state.inputsCount += 1;
      return fixture.inputs();
    },
    wait: async (ms) => {
      state.time += ms;
    },
    capability: async () => {
      state.probes += 1;
      assert.equal(state.cacheOnly, false, "完成槽不得再次探测能力");
      const observedAt = now().toISOString();
      const proof = jsonBytes({
        kind: "synthetic",
        observedAt,
        note: "离线合成余额与价格，不是供应方合同",
      });
      return {
        capability: {
          schemaVersion: "idol-weekly-capability-v2",
          evidenceKind: "synthetic",
          accountScope,
          serviceKind: "formal_active",
          commandId: 318,
          command: "users/show_batch/other",
          billingUnit: "returned_item",
          unitCost,
          balance: state.balance,
          observedAt,
          priceObservedAt: observedAt,
          evidence: [{ path: "synthetic.json", sha256: sha256(proof) }],
        },
        files: { "synthetic.json": proof },
      };
    },
    queryProfiles: async (uids) => {
      assert.equal(state.cacheOnly, false, "完成槽不得再次查询账号");
      const startedAt = now().toISOString();
      state.time += 20;
      state.balance -= uids.length * unitCost;
      state.requests.push({
        id: state.requests.length + 1,
        slotId: state.slotId,
        uids: [...uids],
        startedAt,
        observedAt: now().toISOString(),
        balanceAfter: state.balance,
      });
      return {
        cliVersion: "0.9.1",
        stdout: JSON.stringify({
          total_number: uids.length,
          states: uids.map((uid) => ({ [uid]: 1 })),
          users: uids.map((uid) => {
            if (uid === europeanUid)
              return { european_user: true, id: Number(uid) };
            if (uid === invalidUid) return { idstr: uid, followers_count: -7 };
            return { idstr: uid, followers_count: state.followers };
          }),
        }),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        signal: null,
      };
    },
  });
  return {
    runtime,
    state,
    now,
    fixture,
    unavailable,
    run: () =>
      runtime.run({ trigger: "scheduled", live: true, budgetCredits: "auto" }),
  };
}

function accountingProof(h, slotId) {
  const requests = h.state.requests.filter((row) => row.slotId === slotId);
  const createdAt = (row) =>
    new Date(
      Math.floor(Date.parse(row.observedAt) / 1000) * 1000,
    ).toISOString();
  return jsonBytes({
    schemaVersion: "idol-official-accounting-observation-v1",
    projectionAt: h.now().toISOString(),
    accountScopeHash: accountScope,
    sourceKind: "official_browser_response_whitelist_projection",
    sources: {
      ledger: "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
      usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
      page: "https://open.weibo.com/cli/logs",
    },
    ledger: requests.map((row) => ({
      id: String(5000 + row.id),
      source_id: `00000000-0000-0000-0000-${String(row.id).padStart(12, "0")}`,
      createdAt: createdAt(row),
      delta: String(-row.uids.length * unitCost),
      balanceAfter: String(row.balanceAfter),
      description: `[users/show_batch/other] per_record: ${row.uids.length} records × ${unitCost} pts`,
      type: "api_deduct",
      sourceType: "api_call",
      accountMatched: true,
    })),
    usage: requests.map((row) => ({
      id: String(8000 + row.id),
      createdAt: createdAt(row),
      method: "GET",
      commandPath: "users/show_batch/other",
      status: 200,
      recordCount: row.uids.length,
      billingType: 1,
      creditsDeducted: row.uids.length * unitCost,
      requestParams: { uids: row.uids.join(",") },
      accountMatched: true,
    })),
    notes: ["合成核账，未访问网络或供应方"],
  });
}

async function immutableBytes(store) {
  const runs = [
    ...(await store.listRuns("weekly-attempts")),
    ...(await store.listRuns("weekly-receipts")),
  ];
  return new Map(
    runs.flatMap((run) =>
      Object.entries(run.files).map(([name, bytes]) => [
        `${run.kind}/${run.runId}/${name}`,
        Buffer.from(bytes),
      ]),
    ),
  );
}

async function assertOriginalsUnchanged(store, original) {
  const current = await immutableBytes(store);
  for (const [name, bytes] of original)
    assert.deepEqual(current.get(name), bytes, `原始归档被改写：${name}`);
}

async function reconcileTwice(h, slotId) {
  const original = await immutableBytes(h.runtime.store);
  const proof = accountingProof(h, slotId);
  const counters = [h.state.probes, h.state.requests.length];
  const first = await h.runtime.reconcileRecurring(slotId, proof);
  const repeated = await h.runtime.reconcileRecurring(slotId, proof);
  assert.equal(first.status, "complete");
  assert.equal(first.reused, false);
  assert.equal(first.requests, 0);
  assert.equal(repeated.status, "complete");
  assert.equal(repeated.reused, true);
  assert.equal(repeated.requests, 0);
  assert.equal(repeated.managementQueries, 0);
  assert.equal(repeated.reconciliationSha256, first.reconciliationSha256);
  assert.deepEqual([h.state.probes, h.state.requests.length], counters);
  await assertOriginalsUnchanged(h.runtime.store, original);
  return original;
}

test("expectedSlot：跨周后拒绝旧槽，零输入读取、能力探针、查询和新计划", async () => {
  const h = await recurringHarness();
  h.state.time = Date.parse("2026-09-17T23:59:59.999+08:00");
  const expectedSlot = weeklySlot("scheduled", h.now()).id;
  assert.equal(expectedSlot, "scheduled-2026-09-11");
  h.state.time += 1;
  assert.equal(weeklySlot("scheduled", h.now()).id, "scheduled-2026-09-18");
  const result = await h.runtime.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
    expectedSlot,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.blocker, "weekly_expected_slot_mismatch");
  assert.equal(result.requests, 0);
  assert.equal(h.state.inputsCount, 0);
  assert.equal(h.state.probes, 0);
  assert.equal(h.state.requests.length, 0);
  for (const kind of [
    "weekly-plans",
    "weekly-guards",
    "weekly-attempts",
    "weekly-receipts",
  ])
    assert.deepEqual(await h.runtime.store.listRuns(kind), []);
});

test("两个周五375账号各自两次partial核账，8批不重采，v4投影保留2项旧值时间", async () => {
  const h = await recurringHarness();
  const previousAt = "2026-09-10T15:50:00.000Z";
  const previous = {
    schemaVersion: "idol-follower-observations-v2",
    updatedAt: previousAt,
    records: h.unavailable.map((target, index) => ({
      groupId: target.id,
      uid: target.uid,
      followersValue: 777 + index * 111,
      followersDisplay: String(777 + index * 111),
      followersApproximate: false,
      followersObservedAt: previousAt,
      sourceUrl: `https://weibo.com/u/${target.uid}`,
      slotId: "manual-2026-09-09",
      identityGate: target.identityGate,
      entityKind: target.entityKind,
      scopeNote: target.scopeNote,
      responseSha256: String(index + 3).repeat(64),
    })),
  };
  let current = globalThis.structuredClone(previous);
  let priorSnapshot;
  for (const [cycle, date] of ["2026-09-11", "2026-09-18"].entries()) {
    const slotId = `scheduled-${date}`;
    h.state.time = Date.parse(`${date}T00:00:00+08:00`);
    h.state.slotId = slotId;
    h.state.followers = 1035 + cycle * 24;
    h.state.cacheOnly = false;
    const requestsBefore = h.state.requests.length;
    const probesBefore = h.state.probes;
    const balanceBefore = h.state.balance;
    const first = await h.run();
    assert.equal(first.status, "blocked", first.blocker);
    assert.equal(first.slotId, slotId);
    assert.equal(first.blocker, "incomplete_weekly_response");
    assert.equal(first.requests, 3);
    const untouched = await h.run();
    assert.equal(untouched.status, "blocked");
    assert.equal(untouched.requests, 0);
    assert.equal(h.state.probes, probesBefore + 1);
    const firstOriginals = await reconcileTwice(h, slotId);

    const second = await h.run();
    assert.equal(second.status, "blocked", second.blocker);
    assert.equal(second.blocker, "incomplete_weekly_response");
    assert.equal(second.requests, 1);
    assert.equal(second.cachedBatches, 3);
    const secondOriginals = await reconcileTwice(h, slotId);
    const complete = await h.run();
    assert.equal(complete.status, "complete", complete.blocker);
    assert.equal(complete.requests, 4);
    assert.equal(complete.cachedBatches, 4);
    assert.equal(complete.pendingBatches, 0);
    const cycleRequests = h.state.requests.slice(requestsBefore);
    assert.equal(cycleRequests.length, 8);
    assert.deepEqual(
      cycleRequests.map((row) => row.uids.length),
      [50, 50, 50, 50, 50, 50, 50, 25],
    );
    const uids = cycleRequests.flatMap((row) => row.uids);
    assert.equal(uids.length, 375);
    assert.equal(new Set(uids).size, 375);
    assert.deepEqual(
      [...uids].sort(),
      complete.plan.scope.targets.map((row) => row.uid).sort(),
    );
    assert.equal(h.state.balance, balanceBefore - 375 * unitCost);
    assert.equal(h.state.probes, probesBefore + 3);
    for (let index = 1; index < cycleRequests.length; index += 1)
      assert.ok(
        Date.parse(cycleRequests[index].startedAt) -
          Date.parse(cycleRequests[index - 1].startedAt) >=
          2000,
      );

    const { snapshot } = complete;
    assert.equal(snapshot.schemaVersion, "idol-weekly-snapshot-v4");
    assert.equal(snapshot.profileObservationsComplete, false);
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.candidates.length, 373);
    assert.equal(snapshot.unavailableProfiles.length, 2);
    assert.equal(snapshot.responseReferences.length, 8);
    assert.deepEqual(
      snapshot.unavailableProfiles.map((row) => [row.uid, row.reason]),
      [
        [h.unavailable[0].uid, "provider_european_user"],
        [h.unavailable[1].uid, "provider_invalid_followers_count"],
      ],
    );
    for (const row of snapshot.candidates) {
      const request = cycleRequests.find((item) => item.uids.includes(row.uid));
      assert.equal(row.followersObservedAt, request.observedAt);
      assert.equal(row.followersValue, h.state.followers);
    }
    for (const row of snapshot.unavailableProfiles) {
      const request = cycleRequests.find((item) => item.uids.includes(row.uid));
      assert.equal(row.observedAt, request.observedAt);
      assert.equal(Object.hasOwn(row, "followersValue"), false);
      assert.ok(
        snapshot.responseReferences.some(
          (ref) =>
            ref.requestKey === row.requestKey &&
            ref.reconciliationSha256 === row.reconciliationSha256,
        ),
      );
    }
    await assertOriginalsUnchanged(h.runtime.store, firstOriginals);
    await assertOriginalsUnchanged(h.runtime.store, secondOriginals);

    h.state.cacheOnly = true;
    const counters = [h.state.probes, h.state.requests.length];
    const replay = await h.run();
    assert.equal(replay.status, "complete", replay.blocker);
    assert.equal(replay.requests, 0);
    assert.equal(replay.reused, true);
    assert.deepEqual(replay.snapshot, snapshot);
    const inspection = await h.runtime.inspect(slotId);
    assert.deepEqual(inspection.snapshot, snapshot);
    assert.deepEqual([h.state.probes, h.state.requests.length], counters);
    const inputsBefore = jsonBytes(h.fixture.model);
    const currentBefore = jsonBytes(current);
    const projection = prepareWeeklyRuntimeProjection({
      inspection,
      inputs: h.fixture.inputs(),
      current,
      legacy: emptyFollowerObservations(),
      now: h.now(),
    });
    assert.equal(projection.status, "ready", projection.errors.join(","));
    assert.equal(projection.applied.length, 373);
    assert.equal(projection.dataset.records.length, 375);
    assert.deepEqual(
      projection.unchanged,
      h.unavailable.map((row) => row.id),
    );
    assert.deepEqual(
      projection.review,
      h.unavailable.map((row) => ({
        id: row.id,
        uid: row.uid,
        reason: "provider_profile_unavailable_preserve_previous",
      })),
    );
    for (const old of previous.records)
      assert.deepEqual(
        projection.dataset.records.find((row) => row.groupId === old.groupId),
        old,
      );
    assert.ok(
      projection.dataset.records
        .filter(
          (row) => !previous.records.some((old) => old.groupId === row.groupId),
        )
        .every(
          (row) =>
            row.slotId === slotId && row.followersValue === h.state.followers,
        ),
    );
    assert.deepEqual(jsonBytes(h.fixture.model), inputsBefore);
    assert.deepEqual(jsonBytes(current), currentBefore);
    current = projection.dataset;
    if (priorSnapshot) {
      const oldKeys = new Set(
        priorSnapshot.responseReferences.map((row) => row.requestKey),
      );
      assert.ok(
        snapshot.responseReferences.every(
          (row) => !oldKeys.has(row.requestKey),
        ),
      );
      const earlier = await h.runtime.inspect(priorSnapshot.slotId);
      assert.deepEqual(earlier.snapshot, priorSnapshot);
    }
    priorSnapshot = snapshot;
  }
  assert.equal(h.state.requests.length, 16);
  assert.equal(h.state.probes, 6);
  assert.equal(
    (await h.runtime.store.listRuns("weekly-reconciliations")).length,
    4,
  );
});

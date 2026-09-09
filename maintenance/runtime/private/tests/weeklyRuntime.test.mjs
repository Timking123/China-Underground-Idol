import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createSyntheticWeeklyRuntime,
  WEEKLY_RUNTIME_ROOT,
} from "../src/weeklyRuntime.ts";
import { sha256 } from "../src/sourceCapture.ts";
import { TEST_NOW, weeklyFixture } from "./weeklyFixtures.mjs";

const fixtureRoot = path.resolve("reports/weekly-runtime/fixtures");
await mkdir(fixtureRoot, { recursive: true });

async function harness(count = 3, options = {}) {
  const fixture = weeklyFixture(count);
  if (options.recovery)
    Object.assign(
      fixture.model,
      JSON.parse(
        JSON.stringify(fixture.model)
          .replace(/10000000(\d{3})/gu, (_, index) =>
            Number(index) === 118
              ? "7817455308"
              : String(7700000000 + Number(index) * 1000000),
          )
          .replace(/g118/gu, "g384"),
      ),
    );
  const state = {
    time: Date.parse(TEST_NOW),
    requests: [],
    waits: [],
    probes: 0,
    auditCount: 0,
    inputsCount: 0,
    query: null,
    capability: null,
    audit: null,
    onInputs: null,
  };
  const root = await mkdtemp(
    path.join(
      fixtureRoot,
      options.recovery ? "provider-recovery-runtime-" : "unit-",
    ),
  );
  const now = () => new Date(state.time);
  const capability = async () => {
    state.probes += 1;
    const at = now().toISOString();
    const proof = Buffer.from(
      JSON.stringify({
        kind: "synthetic",
        observedAt: at,
        note: "离线测试数值，绝非供应方计价合同",
      }) + "\n",
    );
    const result = {
      capability: {
        schemaVersion: "idol-weekly-capability-v2",
        evidenceKind: "synthetic",
        accountScope: "1".repeat(16),
        serviceKind: "formal_active",
        commandId: 318,
        command: "users/show_batch/other",
        billingUnit: "returned_item",
        unitCost: options.recovery ? 3 : 2,
        balance: options.recovery ? 21581 : 20_000,
        observedAt: at,
        priceObservedAt: at,
        evidence: [{ path: "synthetic-proof.json", sha256: sha256(proof) }],
      },
      files: { "synthetic-proof.json": proof },
    };
    return state.capability ? await state.capability(result) : result;
  };
  const runtime = await createSyntheticWeeklyRuntime({
    root,
    now,
    inputs: async () => {
      state.inputsCount += 1;
      await state.onInputs?.();
      return fixture.inputs();
    },
    wait: async (ms) => {
      state.waits.push(ms);
      if (!options.brokenWait) state.time += ms;
    },
    capability,
    queryProfiles: async (uids) => {
      state.requests.push({ uids: [...uids], time: state.time });
      state.time += 10;
      const response = {
        cliVersion: "0.9.1",
        stdout: JSON.stringify({
          users: uids.map((uid) => ({
            idstr: uid,
            followers_count: 1001,
            screen_name: "合成已更名昵称",
          })),
        }),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        signal: null,
      };
      if (options.recovery)
        response.stdout = JSON.stringify({
          total_number: uids.length,
          users: uids.map((uid) =>
            uid === "7817455308"
              ? { european_user: true, id: Number(uid) }
              : { idstr: uid, followers_count: 1001 },
          ),
          states: uids.map((uid) => ({ [uid]: 1 })),
        });
      return state.query ? await state.query(response) : response;
    },
    legacyAudit: async () => {
      state.auditCount += 1;
      if (state.audit) await state.audit();
      return {
        schemaVersion: "idol-legacy-weekly-audit-v2",
        inspectedAt: now().toISOString(),
        status: "clear",
        sourceSha256: "b".repeat(64),
        moduleHashes: [],
      };
    },
    storeOptions: options.storeOptions,
  });
  return {
    ...runtime,
    fixture,
    state,
    root,
    now,
    live: () =>
      runtime.run({ trigger: "manual", live: true, budgetCredits: "auto" }),
  };
}

test("provider recovery：追加核账幂等、原150不重发、只续225、374加1及最终零探针缓存", async () => {
  const h = await harness(375, { recovery: true });
  const blocked = await h.live();
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.requests, 3);
  const attempts = await h.store.listRuns("weekly-attempts"),
    receipts = await h.store.listRuns("weekly-receipts");
  const original = new Map(
    [...attempts, ...receipts].flatMap((run) =>
      Object.entries(run.files).map(([name, bytes]) => [
        `${run.kind}/${run.runId}/${name}`,
        sha256(bytes),
      ]),
    ),
  );
  const pairs = attempts
    .map((run) => ({
      attempt: JSON.parse(run.files["attempt.json"]),
      receipt: JSON.parse(
        receipts.find((r) => r.runId === run.runId).files["receipt.json"],
      ),
    }))
    .sort((a, b) => a.attempt.startedAt.localeCompare(b.attempt.startedAt));
  const proof = {
    schemaVersion: "idol-official-accounting-observation-v1",
    projectionAt: h.now().toISOString(),
    accountScopeHash: "1".repeat(16),
    sourceKind: "official_browser_response_whitelist_projection",
    sources: {
      ledger: "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
      usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
      page: "https://open.weibo.com/cli/logs",
    },
    ledger: pairs.map(({ receipt }, i) => ({
      id: String(100 + i),
      source_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      createdAt: new Date(
        Math.floor(Date.parse(receipt.observedAt) / 1000) * 1000,
      ).toISOString(),
      delta: "-150",
      balanceAfter: String(21581 - (i + 1) * 150),
      description: "[users/show_batch/other] per_record: 50 records × 3 pts",
      type: "api_deduct",
      sourceType: "api_call",
      accountMatched: true,
    })),
    usage: pairs.map(({ attempt, receipt }, i) => ({
      id: String(200 + i),
      createdAt: new Date(
        Math.floor(Date.parse(receipt.observedAt) / 1000) * 1000,
      ).toISOString(),
      method: "GET",
      commandPath: "users/show_batch/other",
      status: 200,
      recordCount: 50,
      billingType: 1,
      creditsDeducted: 150,
      requestParams: { uids: attempt.uids.join(",") },
      accountMatched: true,
    })),
    notes: ["离线合成核账"],
  };
  const bytes = Buffer.from(JSON.stringify(proof) + "\n"),
    probes = h.state.probes;
  assert.equal((await h.reconcile(bytes)).reused, false);
  assert.equal((await h.reconcile(bytes)).reused, true);
  assert.equal(h.state.probes, probes);
  assert.equal(h.state.requests.length, 3);
  const modified = globalThis.structuredClone(proof);
  modified.ledger[2].balanceAfter = "21130";
  await assert.rejects(
    h.reconcile(Buffer.from(JSON.stringify(modified))),
    /balance_chain/,
  );
  h.state.capability = (bundle) => {
    bundle.capability.balance = 21131;
    return bundle;
  };
  const complete = await h.run({
    trigger: "manual",
    live: true,
    budgetCredits: 675,
  });
  assert.equal(complete.status, "complete", complete.blocker);
  assert.equal(complete.requests, 5);
  assert.equal(complete.cachedBatches, 3);
  assert.equal(
    h.state.requests.slice(3).reduce((sum, r) => sum + r.uids.length, 0),
    225,
  );
  assert.equal(new Set(h.state.requests.flatMap((r) => r.uids)).size, 375);
  assert.equal(complete.snapshot.schemaVersion, "idol-weekly-snapshot-v3");
  assert.equal(complete.snapshot.profileObservationsComplete, false);
  assert.equal(complete.snapshot.candidates.length, 374);
  assert.equal(complete.snapshot.knownWithheld.length, 1);
  assert.equal(complete.snapshot.knownWithheld[0].uid, "7817455308");
  assert.equal(
    complete.snapshot.knownWithheld[0].observedAt,
    pairs[2].receipt.observedAt,
  );
  for (const profile of complete.snapshot.candidates.filter((r) =>
    pairs.slice(0, 3).some((p) => p.attempt.uids.includes(r.uid)),
  ))
    assert.equal(
      profile.followersObservedAt,
      pairs.find((p) => p.attempt.uids.includes(profile.uid)).receipt
        .observedAt,
    );
  for (const run of [
    ...(await h.store.listRuns("weekly-attempts")),
    ...(await h.store.listRuns("weekly-receipts")),
  ])
    for (const [name, b] of Object.entries(run.files))
      if (original.has(`${run.kind}/${run.runId}/${name}`))
        assert.equal(
          sha256(b),
          original.get(`${run.kind}/${run.runId}/${name}`),
        );
  h.state.capability = () => {
    throw new Error("cache_must_not_probe");
  };
  h.state.query = () => {
    throw new Error("cache_must_not_query");
  };
  const beforeProbes = h.state.probes,
    beforeQueries = h.state.requests.length;
  const cache = await h.live();
  assert.equal(cache.status, "complete", cache.blocker);
  assert.deepEqual(cache.snapshot, complete.snapshot);
  assert.equal(h.state.probes, beforeProbes);
  assert.equal(h.state.requests.length, beforeQueries);
});

test("375账号8批真实走完合成IO；同运行重放0请求、0能力探针并保留原观察时间", async () => {
  const h = await harness(375);
  const result = await h.live();
  assert.equal(result.status, "complete", result.blocker);
  assert.equal(result.requests, 8);
  assert.equal(result.snapshot.candidates.length, 375);
  assert.equal(
    result.snapshot.candidates.filter(
      (row) => row.identityGate === "reviewed_account_scope",
    ).length,
    2,
  );
  assert.equal(
    result.snapshot.candidates.filter(
      (row) => row.identityGate === "accepted_candidate",
    ).length,
    94,
  );
  assert.deepEqual(
    h.state.requests.map((item) => item.uids.length),
    [50, 50, 50, 50, 50, 50, 50, 25],
  );
  for (let index = 1; index < h.state.requests.length; index += 1)
    assert.ok(
      h.state.requests[index].time - h.state.requests[index - 1].time >= 2000,
    );
  assert.equal(h.state.probes, 1);
  assert.ok(
    result.snapshot.candidates.every(
      (item) =>
        item.candidateOnly &&
        !item.identityAcceptedByThisRun &&
        item.canonicalImpact === "none",
    ),
  );
  h.state.capability = () => {
    throw new Error("must_not_probe_cache");
  };
  const cached = await h.live();
  assert.equal(cached.status, "complete", cached.blocker);
  assert.equal(cached.requests, 0);
  assert.equal(cached.reused, true);
  assert.equal(h.state.requests.length, 8);
  assert.equal(h.state.probes, 1);
  assert.deepEqual(cached.snapshot, result.snapshot);
});

test("同一自然周的周五使用独立槽重新获取375项，不冒用周三缓存", async () => {
  const h = await harness(375);
  const manual = await h.live();
  assert.equal(manual.status, "complete", manual.blocker);
  h.state.time = Date.parse("2026-09-10T16:00:00.000Z");
  const friday = await h.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
  });
  assert.equal(friday.status, "complete", friday.blocker);
  assert.equal(friday.slotId, "scheduled-2026-09-11");
  assert.equal(friday.requests, 8);
  assert.equal(h.state.requests.length, 16);
  assert.notEqual(
    friday.snapshot.candidates[0].followersObservedAt,
    manual.snapshot.candidates[0].followersObservedAt,
  );
  assert.notEqual(
    friday.snapshot.responseReferences[0].requestKey,
    manual.snapshot.responseReferences[0].requestKey,
  );
});

test("批次响应缺项后立即停止，原运行和下周期都不能绕失败继续付费", async () => {
  const h = await harness(125);
  h.state.query = (raw) => {
    if (h.state.requests.length === 2) {
      const payload = JSON.parse(raw.stdout);
      payload.users.pop();
      raw.stdout = JSON.stringify(payload);
    }
    return raw;
  };
  const failed = await h.live();
  assert.equal(failed.status, "blocked");
  assert.equal(failed.blocker, "incomplete_weekly_response");
  assert.equal(failed.requests, 2);
  assert.equal(h.state.requests.length, 2);
  h.state.query = null;
  assert.equal((await h.live()).requests, 0);
  h.state.time = Date.parse("2026-09-10T16:00:00.000Z");
  const friday = await h.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
  });
  assert.equal(friday.status, "blocked");
  assert.equal(friday.requests, 0);
  assert.match(friday.blocker, /weekly_uncertain_attempt/);
  assert.equal(h.state.requests.length, 2);
});

test("能力合同或预算不足时零业务请求，不能用旧余额或synthetic冒充provider", async () => {
  for (const mutate of [
    (bundle) => {
      bundle.capability.balance = 4001;
      return bundle;
    },
    (bundle) => {
      bundle.capability.billingUnit = "per_call";
      return bundle;
    },
    (bundle) => {
      bundle.capability.observedAt = "2026-09-09T09:00:00.000Z";
      return bundle;
    },
    (bundle) => {
      bundle.capability.evidenceKind = "provider";
      return bundle;
    },
    (bundle) => {
      bundle.files["synthetic-proof.json"] = Buffer.from("{}\n");
      return bundle;
    },
  ]) {
    const h = await harness();
    h.state.capability = mutate;
    const result = await h.live();
    assert.equal(result.status, "blocked");
    assert.equal(result.requests, 0);
    assert.equal(h.state.requests.length, 0);
  }
  const h = await harness();
  assert.equal(
    (await h.run({ trigger: "manual", live: true, budgetCredits: 1 })).requests,
    0,
  );
});

test("旧账本失败在第一批前停止，批次间新发现旧写入者也停止", async () => {
  const first = await harness();
  first.state.audit = () => {
    throw new Error("legacy_weekly_ledger_blocked:prior_failed");
  };
  assert.equal((await first.live()).requests, 0);
  assert.equal(first.state.probes, 0);
  const later = await harness(75);
  later.state.audit = () => {
    if (later.state.requests.length)
      throw new Error("legacy_weekly_writer_locked");
  };
  const result = await later.live();
  assert.equal(result.status, "blocked");
  assert.equal(result.requests, 1);
  assert.equal(result.blocker, "legacy_weekly_writer_locked");
});

test("能力过期在下一批调用前停止，刷新真实观察时间的合成证据后只续未发批次", async () => {
  const h = await harness(75);
  h.state.query = (raw) => {
    if (h.state.requests.length === 1) h.state.time += 6 * 60_000;
    return raw;
  };
  const paused = await h.live();
  assert.equal(paused.status, "blocked");
  assert.equal(paused.blocker, "stale_weekly_capability");
  assert.equal(paused.requests, 1);
  h.state.query = null;
  const resumed = await h.live();
  assert.equal(resumed.status, "complete", resumed.blocker);
  assert.equal(resumed.requests, 1);
  assert.equal(resumed.cachedBatches, 1);
  assert.equal(h.state.requests.length, 2);
});

test("等待器未推进到2秒时拒绝第二批；时钟倒退在业务调用前拒绝", async () => {
  const h = await harness(75, { brokenWait: true });
  const result = await h.live();
  assert.equal(result.requests, 1);
  assert.equal(result.blocker, "weekly_interval_not_elapsed");
  const clock = await harness();
  clock.state.onInputs = () => {
    if (clock.state.inputsCount === 2) clock.state.time -= 1000;
  };
  const regressed = await clock.live();
  assert.equal(regressed.requests, 0);
  assert.equal(regressed.blocker, "weekly_clock_regressed_before_request");
});

test("attempt落盘中断时不发请求，不能把pending当成安全重试", async () => {
  let fired = false;
  const h = await harness(3, {
    storeOptions: {
      failpoint: (event) => {
        if (
          !fired &&
          event.kind === "weekly-attempts" &&
          event.point === "run:after-intent"
        ) {
          fired = true;
          throw new Error("synthetic_crash");
        }
      },
    },
  });
  const failed = await h.live();
  assert.equal(failed.requests, 0);
  assert.equal(h.state.requests.length, 0);
  const repeated = await h.live();
  assert.equal(repeated.status, "blocked");
  assert.equal(repeated.requests, 0);
  assert.match(repeated.blocker, /incomplete_weekly_archive/);
});

test("收到响应但归档中断后不继续或重试，保留不确定收据", async () => {
  let fired = false;
  const h = await harness(75, {
    storeOptions: {
      failpoint: (event) => {
        if (
          !fired &&
          event.kind === "weekly-responses" &&
          event.point === "run:after-intent"
        ) {
          fired = true;
          throw new Error("synthetic_crash");
        }
      },
    },
  });
  const failed = await h.live();
  assert.equal(failed.requests, 1);
  assert.equal(failed.status, "blocked");
  assert.equal((await h.live()).requests, 0);
  assert.equal(h.state.requests.length, 1);
  const receipts = await h.store.listRuns("weekly-receipts");
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(receipts[0].files["receipt.json"]);
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.responseSha256, null);
  assert.equal(receipt.actualChargedCredits, null);
});

test("完成标志前中断仅显式恢复snapshot，恢复0请求且保留原观察时间", async () => {
  let fired = false;
  const h = await harness(3, {
    storeOptions: {
      failpoint: (event) => {
        if (
          !fired &&
          event.kind === "weekly-collections" &&
          event.point === "run:before-complete"
        ) {
          fired = true;
          throw new Error("synthetic_crash");
        }
      },
    },
  });
  assert.equal((await h.live()).requests, 1);
  const repeated = await h.live();
  assert.equal(repeated.status, "blocked");
  assert.equal(repeated.requests, 0);
  const restored = await h.run({
    trigger: "manual",
    live: false,
    recoverCollection: true,
  });
  assert.equal(restored.status, "complete", restored.blocker);
  assert.equal(restored.requests, 0);
  assert.equal(h.state.requests.length, 1);
  assert.equal(
    restored.snapshot.observedThrough,
    new Date(Date.parse(TEST_NOW) + 10).toISOString(),
  );
});

test("跨周只凭既有原计划显式恢复完成标志，不读取已变化范围或再次调用接口", async () => {
  let fired = false;
  const h = await harness(3, {
    storeOptions: {
      failpoint: (event) => {
        if (
          !fired &&
          event.kind === "weekly-collections" &&
          event.point === "run:before-complete"
        ) {
          fired = true;
          throw new Error("synthetic_crash");
        }
      },
    },
  });
  h.state.time = Date.parse("2026-09-10T16:00:00.000Z");
  const first = await h.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
  });
  assert.equal(first.status, "blocked");
  assert.equal(first.requests, 1);
  const observedAt = new Date(h.state.time).toISOString();
  h.state.time = Date.parse("2026-09-17T16:00:00.000Z");
  const next = await h.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
  });
  assert.equal(next.status, "blocked");
  assert.equal(next.requests, 0);
  assert.equal(h.state.probes, 1);
  for (const request of [
    {
      trigger: "scheduled",
      live: true,
      recoverCollection: true,
      recoverSlot: first.slotId,
    },
    { trigger: "scheduled", live: false, recoverSlot: first.slotId },
    {
      trigger: "scheduled",
      live: false,
      recoverCollection: true,
      recoverSlot: "scheduled-2026-09-04",
    },
    {
      trigger: "manual",
      live: false,
      recoverCollection: true,
      recoverSlot: first.slotId,
    },
  ]) {
    const rejected = await h.run(request);
    assert.equal(rejected.status, "blocked");
    assert.equal(rejected.requests, 0);
  }
  h.fixture.model.display.groups[0].name += "新一期改名";
  h.state.onInputs = () => {
    throw new Error("old_slot_must_not_read_current_inputs");
  };
  const recovered = await h.run({
    trigger: "scheduled",
    live: false,
    recoverCollection: true,
    recoverSlot: first.slotId,
  });
  assert.equal(recovered.status, "complete", recovered.blocker);
  assert.equal(recovered.requests, 0);
  assert.equal(recovered.slotId, "scheduled-2026-09-11");
  assert.equal(recovered.snapshot.observedThrough, observedAt);
  assert.equal(h.state.probes, 1);
  assert.equal(h.state.requests.length, 1);
  h.state.onInputs = null;
  const resumed = await h.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
  });
  assert.equal(resumed.status, "complete", resumed.blocker);
  assert.equal(resumed.slotId, "scheduled-2026-09-18");
  assert.equal(resumed.requests, 1);
});

test("完成缓存的证据漂移或范围变动都停止，不能偷偷建立同周期新计划", async () => {
  const h = await harness();
  const result = await h.live();
  assert.equal(result.status, "complete", result.blocker);
  h.fixture.model.display.groups[0].name += "变更";
  assert.equal((await h.live()).blocker, "frozen_weekly_scope_changed");
  h.fixture.model.display.groups[0].name =
    h.fixture.model.display.groups[0].name.replace("变更", "");
  const entry = result.snapshot.candidates[0].responsePath;
  const bytes = await readFile(path.join(h.root, entry));
  await writeFile(
    path.join(h.root, entry),
    Buffer.concat([bytes, Buffer.from(" ")]),
  );
  const corrupt = await h.live();
  assert.equal(corrupt.status, "blocked");
  assert.equal(corrupt.requests, 0);
  assert.equal(h.state.requests.length, 1);
});

test("合成工厂拒绝正式根和夹具父目录，防止测试资料写入正式账本", async () => {
  for (const root of [
    WEEKLY_RUNTIME_ROOT,
    path.dirname(fixtureRoot),
    fixtureRoot,
  ]) {
    await assert.rejects(
      createSyntheticWeeklyRuntime({ root }),
      /synthetic_weekly_root_refused/,
    );
  }
});

test("敏感响应拒绝写盘并停止，账本只保留不确定状态而不泄漏原值", async () => {
  const h = await harness();
  const canary = "weekly-sensitive-canary-do-not-copy";
  h.state.query = (raw) => {
    raw.stdout = JSON.stringify({ access_token: canary });
    return raw;
  };
  const result = await h.live();
  assert.equal(result.status, "blocked");
  assert.equal(result.blocker, "sensitive_weekly_evidence_rejected");
  assert.equal(result.requests, 1);
  assert.equal((await h.store.listRuns("weekly-responses")).length, 0);
  const receipt = (await h.store.listRuns("weekly-receipts"))[0];
  assert.ok(!receipt.files["receipt.json"].toString("utf8").includes(canary));
  assert.equal((await h.live()).requests, 0);
});

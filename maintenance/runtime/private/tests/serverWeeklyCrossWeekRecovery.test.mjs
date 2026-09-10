import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createSyntheticWeeklyRuntime } from "../src/weeklyRuntime.ts";
import {
  createSyntheticWeeklyRuntimeApplication,
  prepareWeeklyRuntimeProjection,
} from "../src/weeklyRuntimeApplication.ts";
import * as reconciliation from "../src/weeklyReconciliation.ts";
import { weeklySlot } from "../src/weeklyScope.ts";
import { sha256 } from "../src/sourceCapture.ts";
import { weeklyFixture } from "./weeklyFixtures.mjs";
import { collectWeeklyWithRecovery } from "../server/weeklyCollection.ts";
import * as preflight from "../server/weeklyPreflight.ts";
import {
  requestWeeklyRunRecovery,
  completeWeeklyRunRecovery,
  readWeeklyRunReceipt,
} from "../server/weeklyRunRecovery.ts";
import { writeOnce } from "../server/state.ts";

const OLD = "scheduled-2026-09-11";
const CURRENT = "scheduled-2026-09-18";
const accountScope = "9".repeat(16);
const bytes = (value) => Buffer.from(JSON.stringify(value) + "\n");
const fixtures = path.resolve("reports/weekly-runtime/fixtures");

// 全部 IO 为合成函数；时间推进只发生在测试时钟，不调用生产 adapter。
async function harness(count = 125) {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, "crossweek-"));
  const source = weeklyFixture(count);
  const state = {
    time: Date.parse("2026-09-11T00:00:00+08:00"),
    balance: 24000,
    probes: 0,
    inputs: 0,
    requests: [],
    partial: true,
  };
  const now = () => new Date(state.time);
  const runtime = await createSyntheticWeeklyRuntime({
    root,
    now,
    inputs: async () => {
      state.inputs++;
      return source.inputs();
    },
    wait: async (ms) => {
      state.time += ms;
    },
    capability: async () => {
      state.probes++;
      const observedAt = now().toISOString();
      const proof = bytes({ kind: "synthetic", observedAt });
      return {
        capability: {
          schemaVersion: "idol-weekly-capability-v2",
          evidenceKind: "synthetic",
          accountScope,
          serviceKind: "formal_active",
          commandId: 318,
          command: "users/show_batch/other",
          billingUnit: "returned_item",
          unitCost: 3,
          balance: state.balance,
          observedAt,
          priceObservedAt: observedAt,
          evidence: [{ path: "synthetic.json", sha256: sha256(proof) }],
        },
        files: { "synthetic.json": proof },
      };
    },
    queryProfiles: async (uids) => {
      const startedAt = now().toISOString();
      state.time += 20;
      state.balance -= uids.length * 3;
      const partial = state.partial && state.requests.length < 2;
      state.requests.push({
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
          users: uids.map((uid, index) =>
            partial && index === 1
              ? { id: Number(uid), european_user: true }
              : { idstr: uid, followers_count: 1050 },
          ),
        }),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        signal: null,
      };
    },
  });
  return { root, source, state, now, runtime };
}

function accounting(h) {
  const createdAt = (row) =>
    new Date(
      Math.floor(Date.parse(row.observedAt) / 1000) * 1000,
    ).toISOString();
  return bytes({
    schemaVersion: "idol-official-accounting-observation-v1",
    projectionAt: h.now().toISOString(),
    accountScopeHash: accountScope,
    sourceKind: "official_browser_response_whitelist_projection",
    sources: {
      ledger: "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
      usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
      page: "https://open.weibo.com/cli/logs",
    },
    ledger: h.state.requests.map((row, index) => ({
      id: String(5000 + index),
      source_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      createdAt: createdAt(row),
      delta: String(-row.uids.length * 3),
      balanceAfter: String(row.balanceAfter),
      description: `[users/show_batch/other] per_record: ${row.uids.length} records × 3 pts`,
      type: "api_deduct",
      sourceType: "api_call",
      accountMatched: true,
    })),
    usage: h.state.requests.map((row, index) => ({
      id: String(8000 + index),
      createdAt: createdAt(row),
      method: "GET",
      commandPath: "users/show_batch/other",
      status: 200,
      recordCount: row.uids.length,
      billingType: 1,
      creditsDeducted: row.uids.length * 3,
      requestParams: { uids: row.uids.join(",") },
      accountMatched: true,
    })),
    notes: ["离线合成核账"],
  });
}

async function archiveBytes(store) {
  const result = new Map();
  for (const kind of [
    "weekly-plans",
    "weekly-guards",
    "weekly-attempts",
    "weekly-responses",
    "weekly-receipts",
    "weekly-reconciliations",
  ])
    for (const run of await store.listRuns(kind))
      for (const [name, value] of Object.entries(run.files))
        result.set(`${kind}/${run.runId}/${name}`, Buffer.from(value));
  return result;
}

test("跨周核账暂断恢复后只续旧槽 pending，再执行当前槽；原归档不动", async () => {
  const h = await harness();
  const first = await h.runtime.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
    expectedSlot: OLD,
  });
  assert.equal(first.blocker, "incomplete_weekly_response");
  assert.equal(first.requests, 1);
  const original = await archiveBytes(h.runtime.store);
  h.state.time = Date.parse("2026-09-18T00:00:00+08:00");
  const run = (live) =>
    h.runtime.run({
      trigger: "scheduled",
      live,
      budgetCredits: "auto",
      expectedSlot: OLD,
      resumeSlot: OLD,
    });
  await assert.rejects(
    collectWeeklyWithRecovery(OLD, {
      run,
      refreshPrice: async () => {},
      reconcile: async () => {
        throw new Error("synthetic_accounting_unavailable");
      },
    }),
    /synthetic_accounting_unavailable/,
  );
  assert.equal(h.state.requests.length, 1);
  let refreshes = 0;
  const recovered = await collectWeeklyWithRecovery(OLD, {
    run,
    refreshPrice: async () => {
      refreshes++;
    },
    reconcile: (slot) => h.runtime.reconcileRecurring(slot, accounting(h)),
  });
  assert.equal(recovered.status, "complete", recovered.blocker);
  assert.equal(recovered.slotId, OLD);
  assert.equal(recovered.requests, 2);
  assert.equal(
    recovered.reconciledBatches,
    2,
    "恢复周新 partial 也必须能核账闭合",
  );
  assert.equal(refreshes, 2);
  assert.deepEqual(
    h.state.requests.map((row) => row.uids.length),
    [50, 50, 25],
  );
  assert.equal(new Set(h.state.requests.flatMap((row) => row.uids)).size, 125);
  const currentArchive = await archiveBytes(h.runtime.store);
  for (const [name, value] of original)
    assert.deepEqual(currentArchive.get(name), value, name);
  const guards = await h.runtime.store.listRuns("weekly-guards");
  assert.ok(
    guards.slice(0).some((row) => {
      const guard = JSON.parse(row.files["guard.json"]);
      return (
        guard.resume?.slotId === OLD &&
        guard.resume.executionSlotId === CURRENT &&
        Date.parse(guard.checkedAt) >= Date.parse("2026-09-18T00:00:00+08:00")
      );
    }),
  );
  const inspection = await h.runtime.inspect(OLD);
  assert.equal(inspection.snapshot.candidates.length, 123);
  assert.ok(
    inspection.snapshot.candidates.some(
      (row) =>
        Date.parse(row.followersObservedAt) <
        Date.parse("2026-09-18T00:00:00+08:00"),
    ),
  );
  const preserved = inspection.snapshot.unavailableProfiles.map((item) => {
    const target = inspection.plan.scope.targets.find(
      (row) => row.uid === item.uid,
    );
    return {
      groupId: target.id,
      uid: target.uid,
      followersValue: 900,
      followersDisplay: "900",
      followersApproximate: false,
      followersObservedAt: "2026-09-09T12:00:00.000Z",
      sourceUrl: `https://weibo.com/u/${target.uid}`,
      slotId: "manual-2026-09-09",
      identityGate: target.identityGate,
      entityKind: target.entityKind,
      scopeNote: target.scopeNote,
      responseSha256: "f".repeat(64),
    };
  });
  const projection = prepareWeeklyRuntimeProjection({
    inspection,
    inputs: h.source.inputs(),
    current: {
      schemaVersion: "idol-follower-observations-v2",
      updatedAt: "2026-09-09T12:00:00.000Z",
      records: preserved,
    },
    legacy: {
      schemaVersion: "idol-follower-observations-v1",
      updatedAt: null,
      records: [],
    },
    now: h.now(),
  });
  assert.equal(projection.status, "ready", projection.errors.join(","));
  assert.equal(projection.dataset.records.length, 125);
  for (const previous of preserved)
    assert.deepEqual(
      projection.dataset.records.find(
        (row) => row.groupId === previous.groupId,
      ),
      previous,
    );
  for (const row of projection.dataset.records.filter(
    (row) => !preserved.some((old) => old.groupId === row.groupId),
  )) {
    assert.equal(
      row.followersObservedAt,
      inspection.snapshot.candidates.find(
        (candidate) => candidate.id === row.groupId,
      ).followersObservedAt,
    );
    assert.equal(
      row.slotId,
      weeklySlot("scheduled", new Date(row.followersObservedAt)).id,
    );
  }
  assert.equal(
    projection.dataset.records.filter((row) => row.slotId === OLD).length,
    49,
  );
  assert.equal(
    projection.dataset.records.filter((row) => row.slotId === CURRENT).length,
    74,
  );
  const applicationRoot = await mkdtemp(path.join(fixtures, "crossweek-app-"));
  const outputPath = path.join(
    applicationRoot,
    "site/data/follower-observations.v2.json",
  );
  await writeOnce(outputPath, {
    schemaVersion: "idol-follower-observations-v2",
    updatedAt: "2026-09-09T12:00:00.000Z",
    records: preserved,
  });
  await writeOnce(
    path.join(applicationRoot, "site/data/follower-observations.v1.json"),
    {
      schemaVersion: "idol-follower-observations-v1",
      updatedAt: null,
      records: [],
    },
  );
  const application = await createSyntheticWeeklyRuntimeApplication({
    root: applicationRoot,
    now: h.now,
    inputs: async () => h.source.inputs(),
    withInspection: h.runtime.withInspection,
  });
  const oldApplication = await application.run({ slotId: OLD, apply: true });
  assert.equal(oldApplication.status, "complete", oldApplication.blocker);
  assert.equal(oldApplication.slotId, OLD);
  assert.equal(oldApplication.publicWrites, 1);
  assert.deepEqual(
    JSON.parse(await readFile(outputPath, "utf8")),
    projection.dataset,
  );
  const applicationReplay = await application.run({ slotId: OLD, apply: true });
  assert.equal(applicationReplay.status, "complete", applicationReplay.blocker);
  assert.equal(applicationReplay.reused, true);
  assert.equal(applicationReplay.publicWrites, 0);
  const replay = await run(true);
  assert.equal(replay.status, "complete", replay.blocker);
  assert.equal(replay.requests, 0);
  const current = await h.runtime.run({
    trigger: "scheduled",
    live: true,
    budgetCredits: "auto",
    expectedSlot: CURRENT,
  });
  assert.equal(current.status, "complete", current.blocker);
  assert.equal(current.slotId, CURRENT);
  assert.equal(current.requests, 3);
  assert.equal(h.state.requests.length, 6);
  const currentApplication = await application.run({
    slotId: CURRENT,
    apply: true,
  });
  assert.equal(
    currentApplication.status,
    "complete",
    currentApplication.blocker,
  );
  assert.equal(currentApplication.slotId, CURRENT);
  assert.ok(
    JSON.parse(await readFile(outputPath, "utf8")).records.every(
      (row) => row.slotId === CURRENT,
    ),
  );
});

test("resume 要求已有 scheduled 计划与精确 pin，未来或手动槽零读取、探测与收费", async () => {
  const h = await harness(3);
  h.state.time = Date.parse("2026-09-18T00:00:00+08:00");
  for (const options of [
    {
      resumeSlot: "scheduled-2026-09-25",
      expectedSlot: "scheduled-2026-09-25",
    },
    { resumeSlot: OLD, expectedSlot: CURRENT },
    { resumeSlot: OLD },
    { resumeSlot: "manual-2026-09-09", expectedSlot: "manual-2026-09-09" },
    { resumeSlot: OLD, expectedSlot: OLD, recoverCollection: true },
    { resumeSlot: OLD, expectedSlot: OLD },
  ]) {
    const result = await h.runtime.run({
      trigger: "scheduled",
      live: true,
      budgetCredits: "auto",
      ...options,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.requests, 0);
    assert.match(
      result.blocker,
      /weekly_resume_(?:slot_not_allowed|existing_plan_required)/,
    );
  }
  assert.equal(h.state.inputs, 0);
  assert.equal(h.state.probes, 0);
  assert.equal(h.state.requests.length, 0);
  assert.deepEqual(await h.runtime.store.listRuns("weekly-plans"), []);
});

test("旧 guard 不获跨周时窗；新 guard 的计划/执行周错绑均拒绝", async () => {
  const slot = weeklySlot("scheduled", new Date("2026-09-11T00:00:00+08:00"));
  const checkedAt = "2026-09-18T00:00:00+08:00";
  assert.equal(
    reconciliation.weeklyGuardDeadline(slot, { checkedAt }),
    Date.parse(slot.closesAt),
  );
  assert.equal(
    reconciliation.weeklyGuardDeadline(slot, {
      checkedAt,
      resume: { slotId: OLD, executionSlotId: CURRENT },
    }),
    Date.parse("2026-09-25T00:00:00+08:00"),
  );
  for (const resume of [
    null,
    {},
    { slotId: CURRENT, executionSlotId: CURRENT },
    { slotId: OLD, executionSlotId: "scheduled-2026-09-25" },
  ])
    assert.throws(
      () => reconciliation.weeklyGuardDeadline(slot, { checkedAt, resume }),
      /weekly_resume_guard/,
    );
});

async function serverFixture() {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, "crossweek-server-"));
  const stageRoot = path.join(root, "stage"),
    stateRoot = path.join(root, "state");
  await mkdir(path.join(stageRoot, "private"), { recursive: true });
  await mkdir(stateRoot);
  await writeOnce(
    path.join(stageRoot, "site/data/follower-observations.v2.json"),
    {
      schemaVersion: "idol-follower-observations-v2",
      updatedAt: null,
      records: [],
    },
  );
  const add = async (date, code = "incomplete_weekly_response") => {
    const runId = `weekly-${date}`;
    const folder = path.join(stateRoot, "runs", runId);
    await writeOnce(path.join(folder, "attempt.json"), {
      schemaVersion: "idol-server-attempt-v1",
      runId,
      kind: "weekly",
      startedAt: "2026-09-10T16:00:00.000Z",
    });
    const receipt = path.join(folder, "receipt.json");
    await writeOnce(receipt, {
      schemaVersion: "idol-server-run-v1",
      runId,
      status: "blocked",
      code,
      finishedAt: "2026-09-10T16:00:00.020Z",
    });
    return {
      runId,
      expectedReceiptSha256: sha256(await readFile(receipt)),
      receipt,
    };
  };
  return { stageRoot, stateRoot, add };
}

test("server 从最早既存失败槽恢复，未来槽与未知失败仍挡在收费前", async () => {
  const h = await serverFixture();
  const now = new Date("2026-09-18T00:00:00+08:00");
  assert.equal(
    await preflight.selectWeeklyRunId(h.stateRoot, now),
    "weekly-2026-09-18",
    "无旧计划不补往周",
  );
  const recovery = await h.add("2026-09-11");
  const original = await readFile(recovery.receipt);
  assert.equal(
    await preflight.selectWeeklyRunId(h.stateRoot, now),
    recovery.runId,
  );
  await assert.rejects(
    preflight.assertWeeklyApplicationReady(
      h.stageRoot,
      h.stateRoot,
      now,
      recovery,
    ),
    /request_missing/,
  );
  await requestWeeklyRunRecovery(
    h.stateRoot,
    recovery.runId,
    recovery.expectedReceiptSha256,
  );
  await preflight.assertWeeklyApplicationReady(
    h.stageRoot,
    h.stateRoot,
    now,
    recovery,
  );
  await assert.rejects(
    preflight.assertWeeklyApplicationReady(h.stageRoot, h.stateRoot, now, {
      ...recovery,
      expectedReceiptSha256: "0".repeat(64),
    }),
    /original_hash_mismatch/,
  );
  await completeWeeklyRunRecovery(
    h.stateRoot,
    recovery.runId,
    recovery.expectedReceiptSha256,
    {
      schemaVersion: "idol-server-run-v1",
      runId: recovery.runId,
      status: "complete",
      changed: false,
      result: {
        collection: { slotId: OLD },
        application: {
          slotId: OLD,
          status: "complete",
          changed: false,
          publicWrites: 0,
        },
      },
      publication: { changed: false },
      finishedAt: new Date().toISOString(),
    },
  );
  assert.equal(
    (await readWeeklyRunReceipt(h.stateRoot, recovery.runId, now)).status,
    "complete",
  );
  assert.equal(
    await preflight.selectWeeklyRunId(h.stateRoot, now),
    "weekly-2026-09-18",
  );
  assert.deepEqual(await readFile(recovery.receipt), original);
  const unknown = await serverFixture();
  await unknown.add("2026-09-11", "unexpected_failure");
  await assert.rejects(
    preflight.selectWeeklyRunId(unknown.stateRoot, now),
    /prior_weekly_server_run_failed/,
  );
  const future = await serverFixture();
  await future.add("2026-09-25");
  await assert.rejects(
    preflight.selectWeeklyRunId(future.stateRoot, now),
    /invalid_server_run/,
  );
});

test("跨周 pending 仍受余额保底与当前身份源冻结检查限制", async () => {
  for (const variant of ["balance", "source"]) {
    const h = await harness(75);
    await h.runtime.run({
      trigger: "scheduled",
      live: true,
      budgetCredits: "auto",
    });
    h.state.time = Date.parse("2026-09-18T00:00:00+08:00");
    await h.runtime.reconcileRecurring(OLD, accounting(h));
    if (variant === "balance") h.state.balance = 10;
    else h.source.model.display.groups[0].name = "已变更身份来源";
    const result = await h.runtime.run({
      trigger: "scheduled",
      live: true,
      budgetCredits: "auto",
      resumeSlot: OLD,
      expectedSlot: OLD,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.requests, 0);
    assert.equal(h.state.requests.length, 1);
    assert.match(
      result.blocker,
      variant === "balance"
        ? /balance|budget|reserve/
        : /frozen_weekly_scope_changed/,
    );
  }
});

test("health 完成一槽即交 supervisor 发布，新 pending 不被本轮告警或站点检查阻断", () => {
  const runner = new URL("../server/runner.ts", import.meta.url).href;
  for (const existingPending of [false, true]) {
    // 真实 runner 与采集编排，模块边界全部替换为内存依赖；不访问固定服务器根。
    const stubs = {
      "/server/state.ts": `
        let pending = ${existingPending};
        export const privateDirectory = async () => {};
        export const listDirectories = async () => [];
        export const readOptional = async (p) => p.replaceAll(String.fromCharCode(92), '/').endsWith('publish/pending.json') && pending ? { runId: 'previous' } : null;
        export const writeOnce = async () => {};
        export const safeFailure = (e) => e.message;
        export const prepare = () => { if (pending) throw new Error('duplicate_pending'); pending = true; console.log('TEST_PUBLICATION_PREPARED'); };
      `,
      "/server/weeklyRunRecovery.ts": `
        export const readWeeklyRunReceipt = async () => null;
        export const requestWeeklyRunRecovery = async () => {};
        export const completeWeeklyRunRecovery = async () => {};
      `,
      "/server/weeklyPreflight.ts": `
        export const selectWeeklyRunId = async () => 'weekly-2026-09-18';
        export const assertWeeklyApplicationReady = async () => {};
      `,
      "/src/weeklyRuntime.ts": `
        export const runWeeklyRuntime = async () => ({ status: 'complete', slotId: '${CURRENT}', requests: 0, pendingBatches: 0 });
        export const reconcileRecurringWeeklyBatch = async () => { throw new Error('unexpected_accounting'); };
      `,
      "/server/weeklyProbe.ts": `export const refreshWeeklyPrice = async () => { throw new Error('unexpected_price'); };`,
      "/src/weeklyRuntimeApplication.ts": `
        export const runWeeklyRuntimeApplication = async () => ({ status: 'complete', slotId: '${CURRENT}', changed: true, publicWrites: 1, review: [] });
      `,
      "/server/publisher.ts": `
        import { prepare } from 'crossweek:/server/state.ts';
        export const preparePublication = async () => { prepare(); return { changed: true }; };
      `,
      "/server/incident.ts": `
        export const sendMaintenanceNotice = async () => { throw new Error('unexpected_notice'); };
        export const sendMaintenanceIncident = async (incident) => { console.log('TEST_INCIDENT_' + incident.code); throw new Error('synthetic_notify_unavailable'); };
      `,
    };
    const loader = `
      const stubs = ${JSON.stringify(stubs)};
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith('crossweek:')) return { url: specifier, shortCircuit: true };
        if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
          const url = new URL(specifier, context.parentURL);
          const key = Object.keys(stubs).find((item) => url.pathname.endsWith('/private' + item));
          if (key) return { url: 'crossweek:' + key, shortCircuit: true };
        }
        return next(specifier, context);
      }
      export async function load(url, context, next) {
        if (url.startsWith('crossweek:')) return { format: 'module', source: stubs[url.slice(10)], shortCircuit: true };
        return next(url, context);
      }
    `;
    const script = `
      import { register } from 'node:module';
      register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loader)}), import.meta.url);
      const RealDate = Date;
      globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-09-18T00:00:00+08:00'])); } };
      globalThis.fetch = async () => { console.log('TEST_UNEXPECTED_FETCH'); throw new Error('network_forbidden'); };
      process.argv[2] = 'health';
      await import(${JSON.stringify(runner)});
    `;
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.error, undefined);
    assert.doesNotMatch(result.stdout, /TEST_UNEXPECTED_FETCH/);
    if (existingPending) {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /TEST_INCIDENT_publication_unconfirmed/);
      assert.doesNotMatch(result.stdout, /TEST_PUBLICATION_PREPARED/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /TEST_PUBLICATION_PREPARED/);
      assert.match(
        result.stdout,
        /"weeklyMaintenance":\{"runId":"weekly-2026-09-18"/,
      );
      assert.doesNotMatch(result.stdout, /TEST_INCIDENT/);
    }
  }
});

import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// 开发树未物化 site 时，测试仅把两个已知源目录之间的相对导入对齐。
const site = new URL("../../site/src/", import.meta.url);
try {
  await lstat(site);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const fallback = new URL("../../../../src/", import.meta.url);
  await lstat(fallback);
  register(
    `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && context.parentURL) {
        const url = new URL(specifier, context.parentURL).href;
        if (url.startsWith(${JSON.stringify(site.href)})) return nextResolve(${JSON.stringify(fallback.href)} + url.slice(${site.href.length}), context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
    import.meta.url,
  );
}
const { assertWeeklyApplicationReady } =
  await import("../server/weeklyPreflight.ts");
const { createPipelineStore } = await import("../src/pipelineStore.ts");
const { prepareWeeklyRuntimeProjection } =
  await import("../src/weeklyRuntimeApplication.ts");
const { weeklyFixture } = await import("./weeklyFixtures.mjs");
const { buildWeeklyRuntimePlan, weeklySlot } =
  await import("../src/weeklyScope.ts");
const { encode, sha256 } = await import("../src/sourceCapture.ts");
const empty = {
  schemaVersion: "idol-follower-observations-v2",
  updatedAt: null,
  records: [],
};
const legacy = {
  schemaVersion: "idol-follower-observations-v1",
  updatedAt: null,
  records: [],
};
const NOW = new Date("2026-09-18T00:00:00.000Z");
const PLAN = "weekly-application-plans",
  RECEIPT = "weekly-applications";

async function fixture(t) {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "idol-weekly-preflight-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith("idol-weekly-preflight-"));
    assert.equal((await lstat(temporary)).isSymbolicLink(), false);
    await rm(temporary, { recursive: true, force: true });
  });
  const stageRoot = path.join(temporary, "stage"),
    stateRoot = path.join(temporary, "state");
  await mkdir(path.join(stageRoot, "private"), { recursive: true });
  await mkdir(path.join(stageRoot, "site/data"), { recursive: true });
  await mkdir(stateRoot);
  const output = path.join(
    stageRoot,
    "site/data/follower-observations.v2.json",
  );
  await writeFile(output, encode(empty));
  const root = path.join(stageRoot, "private/weekly-application-v2");
  const store = await createPipelineStore(root);
  const sources = weeklyFixture(3);
  const calls = { prices: 0, queries: 0 };
  return {
    temporary,
    stageRoot,
    stateRoot,
    output,
    root,
    store,
    sources,
    calls,
    check: () => assertWeeklyApplicationReady(stageRoot, stateRoot, NOW),
    next: async () => {
      await assertWeeklyApplicationReady(stageRoot, stateRoot, NOW);
      calls.prices++;
      calls.queries++;
    },
  };
}

async function addApplication(
  h,
  date = "2026-09-11",
  complete = true,
  mutate = () => {},
) {
  const now = new Date(`${date}T00:00:00.000Z`);
  const plan = buildWeeklyRuntimePlan(
    h.sources.inputs(),
    weeklySlot("scheduled", now),
    now.toISOString(),
  );
  const snapshot = {
    schemaVersion: "idol-weekly-snapshot-v2",
    slotId: plan.slot.id,
    planSha256: sha256(encode(plan)),
    sourceSha256: plan.scope.sourceSha256,
    accountScope: "1".repeat(16),
    complete: true,
    observedThrough: now.toISOString(),
    responseReferences: [],
    policy: {
      candidateOnly: true,
      automaticIdentityBinding: false,
      automaticPublishing: false,
      actualChargedCredits: null,
    },
    candidates: plan.scope.targets.map((target) => ({
      id: target.id,
      uid: target.uid,
      identityGate: target.identityGate,
      entityKind: target.entityKind,
      scopeNote: target.scopeNote,
      identityAcceptedByThisRun: false,
      canonicalImpact: "none",
      candidateOnly: true,
      followersValue: 1001,
      followersDisplay: "1001",
      followersApproximate: false,
      followersObservedAt: now.toISOString(),
      displayNameCandidate: null,
      sourceUrl: `https://weibo.com/u/${target.uid}`,
      requestKey: "a".repeat(64),
      responseSha256: "b".repeat(64),
      responsePath: "synthetic-only",
    })),
  };
  const inspection = {
    mode: "provider",
    slotId: plan.slot.id,
    plan,
    snapshot,
    archiveSha256: "c".repeat(64),
  };
  const before = await readFile(h.output),
    old = Buffer.from(encode(legacy));
  const projection = prepareWeeklyRuntimeProjection({
    inspection,
    inputs: h.sources.inputs(),
    current: JSON.parse(before),
    legacy,
    now,
  });
  assert.equal(projection.status, "ready", projection.errors.join(","));
  const after = Buffer.from(encode(projection.dataset));
  const application = {
    schemaVersion: "idol-weekly-application-plan-v2",
    mode: "provider",
    slotId: plan.slot.id,
    preparedAt: now.toISOString(),
    runtimeArchiveSha256: inspection.archiveSha256,
    runtimePlanSha256: sha256(encode(plan)),
    snapshotSha256: sha256(encode(snapshot)),
    sourceSha256: projection.sourceSha256,
    legacySha256: sha256(old),
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    applied: projection.applied,
    unchanged: projection.unchanged,
    review: projection.review,
  };
  mutate(application);
  await h.store.withStoreLock("weekly-application", async () => {
    await h.store.commitRun(
      PLAN,
      plan.slot.id,
      {
        "plan.json": Buffer.from(encode(application)),
        "before.json": before,
        "after.json": after,
        "legacy-v1.json": old,
        "runtime-plan.json": Buffer.from(encode(plan)),
        "snapshot.json": Buffer.from(encode(snapshot)),
        ...Object.fromEntries(
          Object.entries(h.sources.inputs().files).map(([name, bytes]) => [
            `sources/${name}`,
            bytes,
          ]),
        ),
      },
      { mode: "provider" },
    );
    // 与真实反例相同：公开输出已替换，但收据归档可能尚未完成。
    await writeFile(h.output, after);
    if (complete)
      await h.store.commitRun(
        RECEIPT,
        plan.slot.id,
        {
          "receipt.json": Buffer.from(
            encode({
              schemaVersion: "idol-weekly-application-receipt-v2",
              mode: "provider",
              slotId: plan.slot.id,
              planSha256: sha256(encode(application)),
              outputSha256: application.afterSha256,
              applied: application.applied,
              changed: application.beforeSha256 !== application.afterSha256,
              appliedAt: null,
              note: "公开输出字节与不可变计划一致；不推断文件替换时刻。",
            }),
          ),
        },
        { mode: "provider" },
      );
  });
  return { slotId: plan.slot.id, application };
}

async function tree(root) {
  const entries = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const target = path.join(directory, name),
        stat = await lstat(target);
      entries.push([
        path.relative(root, target),
        stat.mode,
        stat.mtimeMs,
        stat.isFile() ? sha256(await readFile(target)) : null,
      ]);
      if (stat.isDirectory()) await walk(target);
    }
  }
  await walk(root);
  return entries;
}

test("首次空账本检查不创建状态，完整及同槽缓存归档允许继续", async (t) => {
  const h = await fixture(t);
  const initial = await tree(h.temporary);
  await h.check();
  assert.deepEqual(await tree(h.temporary), initial);
  await addApplication(h);
  const archived = await tree(h.temporary);
  await h.check();
  await h.check();
  assert.deepEqual(await tree(h.temporary), archived);
  await addApplication(h, "2026-09-18");
  await h.next();
  assert.deepEqual(h.calls, { prices: 1, queries: 1 });
});

test("跨周反例：前周 publicWrites 后缺收据，任何新价目与业务调用前阻塞", async (t) => {
  const h = await fixture(t);
  await addApplication(h, "2026-09-11", false);
  assert.equal(JSON.parse(await readFile(h.output)).records.length, 3);
  const before = await tree(h.temporary);
  await assert.rejects(h.next(), /prior_weekly_application_incomplete/);
  assert.deepEqual(h.calls, { prices: 0, queries: 0 });
  assert.deepEqual(await tree(h.temporary), before);
});

for (const problem of [
  "missing-plan",
  "missing-marker",
  "changed-archive",
  "public-drift",
  "unknown-kind",
  "extra-file",
]) {
  test(`不完整或不一致归档 ${problem} 在付费前阻塞`, async (t) => {
    const h = await fixture(t),
      saved = await addApplication(h);
    const base = path.join(h.root, "runs", PLAN, saved.slotId);
    if (problem === "missing-plan")
      await rename(base, path.join(h.temporary, "removed-plan"));
    if (problem === "missing-marker")
      await rename(
        path.join(base, "complete.json"),
        path.join(h.temporary, "removed-marker.json"),
      );
    if (problem === "changed-archive")
      await writeFile(path.join(base, "files/after.json"), encode(empty));
    if (problem === "public-drift") await writeFile(h.output, encode(empty));
    if (problem === "unknown-kind")
      await mkdir(path.join(h.root, "runs", "unexpected"));
    if (problem === "extra-file")
      await writeFile(path.join(base, "unexpected"), "extra");
    await assert.rejects(h.next());
    assert.deepEqual(h.calls, { prices: 0, queries: 0 });
  });
}

test("既有公开观察缺整个应用账本时阻塞，不自动重新初始化", async (t) => {
  const h = await fixture(t);
  await addApplication(h);
  await rename(h.root, path.join(h.temporary, "removed-ledger"));
  await assert.rejects(h.next(), /weekly_preflight_application_ledger_missing/);
  await assert.rejects(lstat(h.root), { code: "ENOENT" });
  assert.deepEqual(h.calls, { prices: 0, queries: 0 });
});

test("哈希自洽但内容与纯投影不符的计划也必须阻塞", async (t) => {
  const h = await fixture(t);
  await addApplication(h, "2026-09-11", true, (plan) => {
    plan.applied = [];
  });
  await assert.rejects(h.next(), /weekly_preflight_plan_content_mismatch/);
  assert.deepEqual(h.calls, { prices: 0, queries: 0 });
});

for (const kind of ["staging", "failure"]) {
  test(`孤立的 ${kind} 状态不会被完整历史掩盖`, async (t) => {
    const h = await fixture(t);
    await addApplication(h);
    const target =
      kind === "staging"
        ? path.join(h.root, ".staging", "orphan")
        : path.join(h.root, ".run-failures", PLAN, "scheduled-2026-09-04");
    await mkdir(target, { recursive: true });
    if (kind === "staging")
      await writeFile(path.join(target, "payload"), "unfinished");
    await assert.rejects(
      h.next(),
      /weekly_preflight_(unfinished_staging|orphan_failure)/,
    );
    assert.deepEqual(h.calls, { prices: 0, queries: 0 });
  });
}

for (const outcome of [
  "blocked",
  "missing",
  "complete",
  "unknown-writes",
  "blocked-application",
]) {
  test(`前周服务器回执 ${outcome} 按闭合状态保护新调用`, async (t) => {
    const h = await fixture(t);
    const id = "weekly-2026-09-11",
      folder = path.join(h.stateRoot, "runs", id);
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "attempt.json"),
      encode({
        schemaVersion: "idol-server-attempt-v1",
        runId: id,
        kind: "weekly",
        startedAt: "2026-09-11T00:00:00.000Z",
      }),
    );
    if (outcome !== "missing")
      await writeFile(
        path.join(folder, "receipt.json"),
        encode({
          schemaVersion: "idol-server-run-v1",
          runId: id,
          status: outcome === "blocked" ? "blocked" : "complete",
          changed: false,
          result: {
            application: {
              slotId: "scheduled-2026-09-11",
              status:
                outcome === "blocked-application" ? "blocked" : "complete",
              publicWrites: outcome === "unknown-writes" ? null : 0,
              changed: false,
            },
          },
          finishedAt: "2026-09-11T00:01:00.000Z",
        }),
      );
    if (outcome === "complete") await h.check();
    else
      await assert.rejects(h.next(), /prior_weekly_server_(run|application)/);
    assert.deepEqual(h.calls, { prices: 0, queries: 0 });
  });
}

test("本槽新 attempt 可继续，归档符号链接必须拒绝", async (t) => {
  const h = await fixture(t);
  const id = "weekly-2026-09-18",
    folder = path.join(h.stateRoot, "runs", id);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "attempt.json"),
    encode({
      schemaVersion: "idol-server-attempt-v1",
      runId: id,
      kind: "weekly",
      startedAt: NOW.toISOString(),
    }),
  );
  await h.check();
  const outside = path.join(h.temporary, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    path.join(h.root, "runs"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(h.next(), /symbolic_link/);
  assert.deepEqual(h.calls, { prices: 0, queries: 0 });
  assert.deepEqual(await readdir(outside), []);
});

test("公开输出遗留锁在新调用前阻塞，且不清理锁或接受父级穿越", async (t) => {
  const h = await fixture(t);
  const lock = path.join(
    h.stageRoot,
    ".locks",
    "public-followers-v2.lock.json",
  );
  await mkdir(path.dirname(lock));
  await writeFile(lock, "existing-lock");
  await assert.rejects(h.next(), /weekly_preflight_public_locked/);
  assert.equal(await readFile(lock, "utf8"), "existing-lock");
  assert.deepEqual(h.calls, { prices: 0, queries: 0 });
  await assert.rejects(
    assertWeeklyApplicationReady(`${h.stageRoot}/../stage`, h.stateRoot, NOW),
    /weekly_preflight_invalid_root/,
  );
});

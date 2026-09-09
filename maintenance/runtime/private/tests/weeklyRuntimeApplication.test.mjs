import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  emptyFollowerObservations,
  observationWeek,
} from "../../site/src/catalog/followerObservations.ts";
import { emptyScopedFollowerObservations } from "../../site/src/catalog/scopedFollowerObservations.ts";
import { createSyntheticWeeklyRuntime } from "../src/weeklyRuntime.ts";
import {
  createSyntheticWeeklyRuntimeApplication,
  prepareWeeklyRuntimeProjection,
  WEEKLY_APPLICATION_ROOT,
} from "../src/weeklyRuntimeApplication.ts";
import { buildWeeklyRuntimePlan, weeklySlot } from "../src/weeklyScope.ts";
import { weeklyObjectHash } from "../src/weeklyContract.ts";
import { encode, sha256 } from "../src/sourceCapture.ts";
import { TEST_NOW, weeklyFixture } from "./weeklyFixtures.mjs";

const fixtures = path.resolve("reports/weekly-runtime/fixtures");
await mkdir(fixtures, { recursive: true });

async function harness(count = 3, options = {}) {
  const fixture = weeklyFixture(count);
  const runtimeRoot = await mkdtemp(path.join(fixtures, "unit-app-runtime-"));
  const stageRoot = await mkdtemp(path.join(fixtures, "unit-app-target-"));
  const state = {
    time: Date.parse(TEST_NOW),
    queryCount: 0,
    capabilityCount: 0,
    followers: 1001,
    onInputs: null,
    onPlan: null,
    onStage: null,
    afterReplace: null,
  };
  const now = () => new Date(state.time);
  const runtime = await createSyntheticWeeklyRuntime({
    root: runtimeRoot,
    now,
    wait: async (ms) => {
      state.time += ms;
    },
    inputs: async () => fixture.inputs(),
    capability: async () => {
      state.capabilityCount += 1;
      const proof = Buffer.from(
        encode({ kind: "synthetic", observedAt: now().toISOString() }),
      );
      return {
        capability: {
          schemaVersion: "idol-weekly-capability-v2",
          evidenceKind: "synthetic",
          accountScope: "1".repeat(16),
          serviceKind: "formal_active",
          commandId: 318,
          command: "users/show_batch/other",
          billingUnit: "returned_item",
          unitCost: 2,
          balance: 20000,
          observedAt: now().toISOString(),
          priceObservedAt: now().toISOString(),
          evidence: [{ path: "synthetic.json", sha256: sha256(proof) }],
        },
        files: { "synthetic.json": proof },
      };
    },
    queryProfiles: async (uids) => {
      state.queryCount += 1;
      state.time += 10;
      return {
        cliVersion: "0.9.1",
        stdout: JSON.stringify({
          users: uids.map((uid) => ({
            idstr: uid,
            followers_count: state.followers,
            screen_name: "新昵称仅候选",
          })),
        }),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        signal: null,
      };
    },
  });
  await mkdir(path.join(stageRoot, "site/data"), { recursive: true });
  const outputPath = path.join(
    stageRoot,
    "site/data/follower-observations.v2.json",
  );
  await writeFile(outputPath, encode(emptyScopedFollowerObservations()));
  await writeFile(
    path.join(stageRoot, "site/data/follower-observations.v1.json"),
    encode(emptyFollowerObservations()),
  );
  const app = await createSyntheticWeeklyRuntimeApplication({
    root: stageRoot,
    now,
    inputs: async () => {
      await state.onInputs?.();
      return fixture.inputs();
    },
    withInspection: options.withInspection ?? runtime.withInspection,
    storeOptions: {
      failpoint: async (event) => {
        await state.onPlan?.(event);
      },
    },
    stageOptions: {
      failpoint: async (event) => {
        await state.onStage?.(event);
      },
    },
    afterReplace: async () => {
      await state.afterReplace?.();
    },
  });
  return {
    fixture,
    state,
    now,
    runtime,
    app,
    runtimeRoot,
    stageRoot,
    outputPath,
    collect: (trigger = "manual") =>
      runtime.run({ trigger, live: true, budgetCredits: "auto" }),
    apply: (slotId = "manual-2026-09-09", extra = {}) =>
      app.run({ slotId, apply: true, ...extra }),
    output: async () => JSON.parse(await readFile(outputPath, "utf8")),
  };
}

function pureFixture() {
  const fixture = weeklyFixture(375),
    now = new Date(TEST_NOW);
  const plan = buildWeeklyRuntimePlan(
    fixture.inputs(),
    weeklySlot("manual", now),
    now.toISOString(),
  );
  const snapshot = {
    schemaVersion: "idol-weekly-snapshot-v2",
    slotId: plan.slot.id,
    planSha256: weeklyObjectHash(plan),
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
      displayNameCandidate: "合成新昵称",
      sourceUrl: `https://weibo.com/u/${target.uid}`,
      requestKey: "a".repeat(64),
      responseSha256: "b".repeat(64),
      responsePath: "仅供纯函数测试，不能进入正式入口",
    })),
  };
  const inspection = {
    mode: "synthetic",
    slotId: plan.slot.id,
    plan,
    snapshot,
    archiveSha256: "c".repeat(64),
  };
  return {
    fixture,
    now,
    inspection,
    project: (overrides = {}) =>
      prepareWeeklyRuntimeProjection({
        inspection,
        inputs: fixture.inputs(),
        current: emptyScopedFollowerObservations(),
        legacy: emptyFollowerObservations(),
        now,
        ...overrides,
      }),
  };
}

test("provider recovery应用：374项可更新，g384保留旧128和原时间，不创建本轮观察", () => {
  const h = pureFixture();
  Object.assign(
    h.fixture.model,
    JSON.parse(
      JSON.stringify(h.fixture.model)
        .replace(/10000000(\d{3})/gu, (_, index) =>
          Number(index) === 118
            ? "7817455308"
            : String(7700000000 + Number(index) * 1000000),
        )
        .replace(/g118/gu, "g384"),
    ),
  );
  for (const source of [h.fixture.model.display, h.fixture.model.master]) {
    const row = source.groups.find((item) => item.id === "g384");
    row.followersValue = 128;
    row.followersObservedAt = "2026-09-04T15:10:00+08:00";
  }
  const before = JSON.stringify(h.fixture.model);
  const plan = buildWeeklyRuntimePlan(
    h.fixture.inputs(),
    weeklySlot("manual", h.now),
    h.now.toISOString(),
  );
  const template = h.inspection.snapshot.candidates[0];
  const known = {
    id: "g384",
    uid: "7817455308",
    reason: "provider_european_user",
    observedAt: h.now.toISOString(),
    requestKey: "a".repeat(64),
    responseSha256: "b".repeat(64),
    receiptSha256: "c".repeat(64),
    reconciliationSha256: "d".repeat(64),
  };
  const snapshot = {
    ...h.inspection.snapshot,
    schemaVersion: "idol-weekly-snapshot-v3",
    planSha256: weeklyObjectHash(plan),
    sourceSha256: plan.scope.sourceSha256,
    profileObservationsComplete: false,
    knownWithheld: [known],
    responseReferences: [
      {
        requestKey: known.requestKey,
        attemptSha256: "e".repeat(64),
        responseSha256: known.responseSha256,
        receiptSha256: known.receiptSha256,
        reconciliationSha256: known.reconciliationSha256,
      },
    ],
    candidates: plan.scope.targets
      .filter((row) => row.id !== "g384")
      .map((target) => ({
        ...template,
        id: target.id,
        uid: target.uid,
        identityGate: target.identityGate,
        entityKind: target.entityKind,
        scopeNote: target.scopeNote,
        sourceUrl: `https://weibo.com/u/${target.uid}`,
      })),
  };
  const inspect = { ...h.inspection, plan, snapshot };
  const project = (value = inspect) =>
    prepareWeeklyRuntimeProjection({
      inspection: value,
      inputs: h.fixture.inputs(),
      current: emptyScopedFollowerObservations(),
      legacy: emptyFollowerObservations(),
      now: h.now,
    });
  const result = project();
  assert.equal(result.status, "ready", result.errors.join(","));
  assert.equal(result.applied.length, 374);
  assert.equal(
    result.dataset.records.some((row) => row.groupId === "g384"),
    false,
  );
  assert.ok(
    result.review.some(
      (row) =>
        row.id === "g384" &&
        row.reason === "known_provider_withheld_preserve_previous",
    ),
  );
  assert.equal(JSON.stringify(h.fixture.model), before);
  assert.deepEqual(
    plan.scope.targets.find((row) => row.id === "g384").previous,
    {
      value: 128,
      approximate: false,
      observedAt: "2026-09-04T15:10:00+08:00",
      time: Date.parse("2026-09-04T15:10:00+08:00"),
      conflict: false,
    },
  );
  for (const mutate of [
    (s) => {
      s.knownWithheld[0].uid = s.candidates[0].uid;
    },
    (s) => {
      s.knownWithheld[0].followersValue = 128;
    },
    (s) => {
      s.knownWithheld = [];
    },
    (s) => {
      s.candidates.pop();
    },
  ]) {
    const altered = globalThis.structuredClone(inspect);
    mutate(altered.snapshot);
    assert.equal(project(altered).status, "blocked");
  }
});

test("375项从完整合成归档投影并原子写一次，保留三类身份，重复应用零写入", async () => {
  const h = await harness(375);
  const collected = await h.collect();
  assert.equal(collected.status, "complete", collected.blocker);
  assert.equal(collected.requests, 8);
  const before = await readFile(h.outputPath);
  const reviewed = await h.app.run({ slotId: collected.slotId, apply: false });
  assert.equal(reviewed.status, "ready", reviewed.blocker);
  assert.equal(reviewed.applied.length, 375);
  assert.equal(reviewed.publicWrites, 0);
  assert.deepEqual(await readFile(h.outputPath), before);
  const applied = await h.apply();
  assert.equal(applied.status, "complete", applied.blocker);
  assert.equal(applied.publicWrites, 1);
  assert.equal(applied.applied.length, 375);
  const output = await h.output();
  assert.deepEqual(
    ["strict_uid_match", "accepted_candidate", "reviewed_account_scope"].map(
      (gate) =>
        output.records.filter((record) => record.identityGate === gate).length,
    ),
    [279, 94, 2],
  );
  const project = output.records.find((record) => record.groupId === "g360");
  assert.equal(project.uid, "8257746955");
  assert.equal(project.entityKind, "多团企划");
  assert.match(project.scopeNote, /不属于旗下任意单团/);
  for (const record of output.records)
    assert.deepEqual(
      Object.keys(record).sort(),
      [
        "groupId",
        "uid",
        "followersValue",
        "followersDisplay",
        "followersApproximate",
        "followersObservedAt",
        "sourceUrl",
        "slotId",
        "identityGate",
        "entityKind",
        "scopeNote",
        "responseSha256",
      ].sort(),
    );
  assert.ok(!JSON.stringify(output).includes("新昵称"));
  const savedStat = await stat(h.outputPath),
    savedBytes = await readFile(h.outputPath);
  const repeated = await h.apply();
  assert.equal(repeated.status, "complete", repeated.blocker);
  assert.equal(repeated.publicWrites, 0);
  assert.equal(repeated.reused, true);
  assert.equal((await stat(h.outputPath)).mtimeMs, savedStat.mtimeMs);
  assert.deepEqual(await readFile(h.outputPath), savedBytes);
  assert.equal(h.state.queryCount, 8);
  assert.equal(h.state.capabilityCount, 1);
});

test("同自然周的周五较新观察更新周三结果，不被旧sameWeek规则挡住", async () => {
  const h = await harness();
  assert.equal((await h.collect()).status, "complete");
  assert.equal((await h.apply()).publicWrites, 1);
  h.state.time = Date.parse("2026-09-10T16:00:00.000Z");
  h.state.followers = 1002;
  const friday = await h.collect("scheduled");
  assert.equal(friday.status, "complete", friday.blocker);
  const applied = await h.apply(friday.slotId);
  assert.equal(applied.status, "complete", applied.blocker);
  assert.equal(applied.applied.length, 3);
  assert.equal(applied.publicWrites, 1);
  assert.ok(
    (await h.output()).records.every(
      (row) =>
        row.slotId === "scheduled-2026-09-11" && row.followersValue === 1002,
    ),
  );
  assert.equal(h.state.queryCount, 2);
});

test("当前人工或v1/v2较新观察、同刻冲突与大幅跳变分别复核，不写假strict", () => {
  for (const source of ["manual", "legacy", "scoped"]) {
    const h = pureFixture();
    const candidate = h.inspection.snapshot.candidates[0];
    const later = "2026-09-09T10:00:01.000Z";
    const record = {
      groupId: candidate.id,
      uid: candidate.uid,
      followersValue: 1002,
      followersDisplay: "1002",
      followersApproximate: false,
      followersObservedAt: later,
      sourceUrl: candidate.sourceUrl,
      responseSha256: "d".repeat(64),
      identityGate: "strict_uid_match",
    };
    const overrides = { now: new Date("2026-09-09T10:01:00.000Z") };
    if (source === "manual") {
      const group = h.fixture.model.display.groups.find(
        (row) => row.id === candidate.id,
      );
      group.followersValue = record.followersValue;
      group.followersObservedAt = later;
    } else if (source === "legacy")
      overrides.legacy = {
        schemaVersion: "idol-follower-observations-v1",
        updatedAt: later,
        records: [{ ...record, weekId: observationWeek(later) }],
      };
    else
      overrides.current = {
        schemaVersion: "idol-follower-observations-v2",
        updatedAt: later,
        records: [
          {
            ...record,
            slotId: "manual-2026-09-09",
            entityKind: "团体账号",
            scopeNote: null,
          },
        ],
      };
    const projected = h.project(overrides);
    assert.equal(projected.status, "ready", projected.errors.join(","));
    assert.ok(
      projected.review.some(
        (row) => row.id === candidate.id && row.reason === "older_observation",
      ),
    );
    assert.ok(!projected.applied.includes(candidate.id));
  }
  const same = pureFixture(),
    first = same.inspection.snapshot.candidates[0];
  const group = same.fixture.model.display.groups.find(
    (row) => row.id === first.id,
  );
  group.followersValue = 1002;
  group.followersObservedAt = TEST_NOW;
  assert.ok(
    same
      .project()
      .review.some(
        (row) => row.id === first.id && row.reason === "same_time_conflict",
      ),
  );
  const jumping = pureFixture(),
    jump = jumping.inspection.snapshot.candidates[0];
  jump.followersValue = 10000;
  jump.followersDisplay = "10000";
  assert.ok(
    jumping
      .project()
      .review.some(
        (row) => row.id === jump.id && row.reason === "followers_jump",
      ),
  );
  const rejected = pureFixture();
  const accepted = rejected.inspection.snapshot.candidates.find(
    (row) => row.identityGate === "accepted_candidate",
  );
  rejected.fixture.model.master.groups.find(
    (row) => row.id === accepted.id,
  ).rejectedIdentityCandidates = [
    { uid: accepted.uid, reason: "合成当期拒绝" },
  ];
  const result = rejected.project();
  assert.equal(result.status, "blocked");
  assert.equal(result.applied.length, 0);
  assert.ok(result.errors.includes("weekly_current_scope_requires_review"));
});

test("已替换但回执前中断必须显式恢复，恢复零重复写且保留观察时间", async () => {
  const h = await harness();
  await h.collect();
  h.state.afterReplace = () => {
    throw new Error("synthetic_after_replace");
  };
  const failed = await h.apply();
  assert.equal(failed.status, "blocked");
  assert.equal(failed.publicWrites, 1);
  h.state.afterReplace = null;
  const bytes = await readFile(h.outputPath),
    originalStat = await stat(h.outputPath);
  const ordinary = await h.apply();
  assert.equal(
    ordinary.blocker,
    "weekly_written_output_requires_explicit_recovery",
  );
  assert.equal(ordinary.publicWrites, 0);
  const recovered = await h.apply("manual-2026-09-09", {
    recoverWritten: true,
  });
  assert.equal(recovered.status, "complete", recovered.blocker);
  assert.equal(recovered.publicWrites, 0);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(await readFile(h.outputPath), bytes);
  assert.equal((await stat(h.outputPath)).mtimeMs, originalStat.mtimeMs);
  assert.equal(h.state.queryCount, 1);
  assert.equal((await h.apply()).publicWrites, 0);
});

test("收据intent中断也可明确恢复固定字节，不重复改写公开文件", async () => {
  const h = await harness();
  await h.collect();
  let fired = false;
  h.state.onPlan = (event) => {
    if (
      !fired &&
      event.kind === "weekly-applications" &&
      event.point === "run:after-intent"
    ) {
      fired = true;
      throw new Error("synthetic_receipt_crash");
    }
  };
  const failed = await h.apply();
  assert.equal(failed.status, "blocked");
  assert.equal(failed.publicWrites, 1);
  const bytes = await readFile(h.outputPath);
  assert.equal((await h.apply()).status, "blocked");
  const recovered = await h.apply("manual-2026-09-09", {
    recoverWritten: true,
  });
  assert.equal(recovered.status, "complete", recovered.blocker);
  assert.equal(recovered.publicWrites, 0);
  assert.deepEqual(await readFile(h.outputPath), bytes);
});

test("公开原像在原子替换前漂移时不覆盖外来字节", async () => {
  const h = await harness();
  await h.collect();
  const external = Buffer.from(encode(emptyScopedFollowerObservations()) + " ");
  h.state.onStage = async (event) => {
    if (event.point === "replace:before-commit")
      await writeFile(h.outputPath, external);
  };
  const failed = await h.apply();
  assert.equal(failed.status, "blocked");
  assert.equal(failed.publicWrites, 0);
  assert.deepEqual(await readFile(h.outputPath), external);
});

test("应用计划完成后来源或原响应发生变化均停止，公开输出保持原像", async () => {
  for (const mutation of ["source", "response"]) {
    const h = await harness();
    const collected = await h.collect();
    const before = await readFile(h.outputPath);
    let fired = false;
    h.state.onPlan = async (event) => {
      if (
        fired ||
        event.kind !== "weekly-application-plans" ||
        event.point !== "run:before-complete"
      )
        return;
      fired = true;
      if (mutation === "source")
        h.fixture.model.display.groups[0].name += "外来修改";
      else {
        const file = path.join(
          h.runtimeRoot,
          collected.snapshot.candidates[0].responsePath,
        );
        await writeFile(
          file,
          Buffer.concat([await readFile(file), Buffer.from(" ")]),
        );
      }
    };
    const failed = await h.apply();
    assert.equal(failed.status, "blocked");
    assert.equal(failed.publicWrites, 0);
    assert.deepEqual(await readFile(h.outputPath), before);
  }
});

test("未完成应用计划阻断当前及后续周期，不把半完成计划当成可跳过历史", async () => {
  const h = await harness();
  await h.collect();
  let fired = false;
  h.state.onPlan = (event) => {
    if (
      !fired &&
      event.kind === "weekly-application-plans" &&
      event.point === "run:after-intent"
    ) {
      fired = true;
      throw new Error("synthetic_plan_crash");
    }
  };
  assert.equal((await h.apply()).publicWrites, 0);
  assert.equal((await h.apply()).blocker, "incomplete_weekly_application_plan");
  h.state.time = Date.parse("2026-09-10T16:00:00.000Z");
  const friday = await h.collect("scheduled");
  const next = await h.apply(friday.slotId);
  assert.equal(next.status, "blocked");
  assert.equal(next.publicWrites, 0);
  assert.equal((await h.output()).records.length, 0);
});

test("合成根不能映射正式应用目录，模式不匹配不能生成公开输出", async () => {
  for (const root of [
    WEEKLY_APPLICATION_ROOT,
    fixtures,
    path.dirname(fixtures),
  ])
    await assert.rejects(
      createSyntheticWeeklyRuntimeApplication({ root }),
      /synthetic_weekly_application_root_refused/,
    );
  const h = await harness(3, {
    withInspection: async (_slot, action) =>
      action({ mode: "provider" }, () => {
        throw new Error("must_not_recheck");
      }),
  });
  const failed = await h.apply();
  assert.equal(failed.status, "blocked");
  assert.equal(failed.blocker, "weekly_application_mode_mismatch");
  assert.equal(failed.publicWrites, 0);
});

test("主档未来粉丝时间不能被latest baseline过滤后继续应用", () => {
  for (const location of ["top", "field"]) {
    const h = pureFixture(),
      first = h.inspection.snapshot.candidates[0];
    const master = h.fixture.model.master.groups.find(
      (row) => row.id === first.id,
    );
    if (location === "top")
      master.followersObservedAt = "2026-09-09T11:00:00.000Z";
    else
      master.fieldEvidence.followers = {
        state: "verified",
        boundUid: first.uid,
        numericValue: 1002,
        observedAt: "2026-09-09T11:00:00.000Z",
      };
    const result = h.project({ now: new Date("2026-09-09T10:45:00.000Z") });
    assert.ok(!result.applied.includes(first.id));
    assert.ok(
      result.review.some(
        (row) => row.id === first.id && row.reason === "future_baseline",
      ),
    );
  }
});

test("master和display的已采用编辑粉丝及strictSnapshot字段证据共用最新与未来基线", () => {
  for (const area of ["master", "display"]) {
    for (const kind of ["editorial", "strictSnapshot"]) {
      for (const future of [false, true]) {
        const h = pureFixture();
        const candidate = h.inspection.snapshot.candidates.find(
          (row) =>
            row.identityGate ===
            (kind === "editorial" ? "accepted_candidate" : "strict_uid_match"),
        );
        const source = h.fixture.model[area].groups.find(
          (row) => row.id === candidate.id,
        );
        source.weiboUid = candidate.uid;
        const observedAt = future
          ? "2026-09-09T11:00:00.000Z"
          : "2026-09-09T10:00:01.000Z";
        if (kind === "editorial")
          source.editorialProfileSupplement = {
            ...source.editorialProfileSupplement,
            state: "accepted_candidate",
            uid: candidate.uid,
            profileUrl: candidate.sourceUrl,
            appliedFields: ["identity", "followers"],
            followersValue: 1002,
            followersApproximate: false,
            observedAt,
          };
        else
          source.strictSnapshot = {
            profile: {
              uid: candidate.uid,
              followersValue: 1002,
              followersApproximate: false,
              followerEvidence: {
                state: "verified",
                boundUid: candidate.uid,
                numericValue: 1002,
                followersApproximate: false,
                observedAt,
              },
            },
          };
        const result = h.project({ now: new Date("2026-09-09T10:45:00.000Z") });
        assert.ok(
          !result.applied.includes(candidate.id),
          `${area}/${kind}/${future}`,
        );
        assert.ok(
          result.review.some(
            (row) =>
              row.id === candidate.id &&
              row.reason === (future ? "future_baseline" : "older_observation"),
          ),
          JSON.stringify(result),
        );
      }
    }
  }
});

test("全批次跳变仅记录复核且零公开写，未完成的零变化收据也能显式恢复", async () => {
  const h = await harness();
  h.state.followers = 10000;
  await h.collect();
  let fired = false;
  h.state.onPlan = (event) => {
    if (
      !fired &&
      event.kind === "weekly-applications" &&
      event.point === "run:after-intent"
    ) {
      fired = true;
      throw new Error("synthetic_nochange_receipt_crash");
    }
  };
  const bytes = await readFile(h.outputPath);
  const failed = await h.apply();
  assert.equal(failed.status, "blocked");
  assert.equal(failed.publicWrites, 0);
  assert.deepEqual(await readFile(h.outputPath), bytes);
  const recovered = await h.apply("manual-2026-09-09", {
    recoverWritten: true,
  });
  assert.equal(recovered.status, "complete", recovered.blocker);
  assert.equal(recovered.publicWrites, 0);
  assert.equal(recovered.review.length, 3);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(await readFile(h.outputPath), bytes);
});

test("收据完成标志自有暂存硬链接中断可显式收尾，其他corrupt仍拒绝", async () => {
  for (const corruptReceipt of [false, true]) {
    const h = await harness();
    await h.collect();
    let fired = false;
    h.state.onPlan = (event) => {
      if (
        !fired &&
        event.point === "immutable:after-link" &&
        event.relative ===
          "runs/weekly-applications/manual-2026-09-09/complete.json"
      ) {
        fired = true;
        throw new Error("synthetic_receipt_marker_link_crash");
      }
    };
    const failed = await h.apply();
    assert.equal(failed.status, "blocked");
    assert.equal(failed.publicWrites, 1);
    const marker = path.join(
      h.stageRoot,
      "runs/weekly-applications/manual-2026-09-09/complete.json",
    );
    assert.equal((await stat(marker)).nlink, 2);
    const receipt = path.join(
      h.stageRoot,
      "runs/weekly-applications/manual-2026-09-09/files/receipt.json",
    );
    if (corruptReceipt)
      await writeFile(
        receipt,
        Buffer.concat([await readFile(receipt), Buffer.from(" ")]),
      );
    const bytes = await readFile(h.outputPath);
    assert.equal((await h.apply()).status, "blocked");
    const recovered = await h.apply("manual-2026-09-09", {
      recoverWritten: true,
    });
    assert.equal(
      recovered.status,
      corruptReceipt ? "blocked" : "complete",
      recovered.blocker,
    );
    assert.equal(recovered.publicWrites, 0);
    assert.deepEqual(await readFile(h.outputPath), bytes);
    assert.equal((await stat(marker)).nlink, corruptReceipt ? 2 : 1);
  }
});

test("两个新增锁固定scope恢复：拒绝错hash/活owner，合成死owner确认nonce后可恢复", async () => {
  const h = await harness();
  await h.collect();
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0);
  for (const [kind, scope] of [
    ["application", "weekly-application"],
    ["public", "public-followers-v2"],
  ]) {
    assert.equal((await h.app.inspectLock(kind)).status, "missing");
    const lockPath = path.join(h.stageRoot, ".locks", `${scope}.lock.json`);
    await mkdir(path.dirname(lockPath), { recursive: true });
    const live = Buffer.from(
      encode({
        schemaVersion: "pipeline-store-lock-v1",
        scope,
        nonce: randomUUID(),
        pid: process.pid,
        host: hostname(),
        createdAt: TEST_NOW,
      }),
    );
    await writeFile(lockPath, live);
    const inspect = await h.app.inspectLock(kind);
    assert.equal(inspect.sha256, sha256(live));
    assert.equal(inspect.ownerState, "alive");
    await assert.rejects(
      h.app.recoverLock(kind, "0".repeat(64)),
      (error) => error.code === "LOCK_DRIFT",
    );
    await assert.rejects(
      h.app.recoverLock(kind, sha256(live)),
      (error) => error.code === "PID_ALIVE",
    );
    assert.deepEqual(await readFile(lockPath), live);
    const deadRecord = {
      ...JSON.parse(live),
      nonce: randomUUID(),
      pid: child.pid,
    };
    const dead = Buffer.from(encode(deadRecord));
    await writeFile(lockPath, dead);
    const deadInspection = await h.app.inspectLock(kind);
    assert.equal(deadInspection.ownerState, "dead");
    assert.equal(deadInspection.nonce, deadRecord.nonce);
    assert.equal((await h.apply()).status, "blocked");
    const recovery = await h.app.recoverLock(kind, deadInspection.sha256);
    assert.equal(recovery.status, "recovered");
    assert.equal((await h.app.inspectLock(kind)).status, "missing");
    const recoveryIntent = JSON.parse(
      await readFile(path.join(h.stageRoot, recovery.intentPath), "utf8"),
    );
    assert.equal(recoveryIntent.originalNonce, deadRecord.nonce);
    assert.equal(recoveryIntent.originalPid, child.pid);
  }
  const result = await h.apply();
  assert.equal(result.status, "complete", result.blocker);
  assert.equal(result.publicWrites, 1);
  assert.equal(h.state.queryCount, 1);
  await assert.rejects(
    h.app.inspectLock("arbitrary-root"),
    /invalid_weekly_lock_target/,
  );
});

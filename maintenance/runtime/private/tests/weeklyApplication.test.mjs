import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectWeeklyApplication,
  applyWeeklyCandidates,
} from "../src/weeklyApplication.ts";
import { emptyFollowerObservations } from "../../site/src/catalog/followerObservations.ts";
import {
  readWeeklyInputs,
  buildWeeklyPlan,
} from "../../../../outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01/tools/weekly_profile_refresh.mjs";

// 所有资料均为隔离合成夹具；只读调用真实采集器，不创建业务adapter。
const NOW = new Date("2026-09-21T03:00:00Z");
const OBSERVED = "2026-09-13T02:00:00.000Z";
const WEEK = "week-2026-09-07";
const report = fileURLToPath(
  new URL("../../reports/weekly-application/fixtures/", import.meta.url),
);
await mkdir(report, { recursive: true });
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const makeGroup = (id = "g001", uid = "7000000001") => ({
  id,
  name: "合成团体",
  weiboUid: uid,
  uidConfidence: "high",
  followersValue: 5000,
  followersDisplay: "5000",
  followersApproximate: false,
  profileObservedAt: "2026-09-01T02:00:00Z",
  fieldEvidence: {
    profileIdentity: {
      state: "verified",
      confidence: "high",
      candidateUid: uid,
    },
  },
});
const write = async (target, value) => writeFile(target, encode(value), "utf8");

async function fixture({
  values = [6000],
  previousValues,
  observedAt = OBSERVED,
  profiles: suppliedProfiles,
} = {}) {
  const archiveRoot = await mkdtemp(path.join(report, "synthetic-"));
  const groups = values.map((_, index) =>
    makeGroup(
      `g${String(index + 1).padStart(3, "0")}`,
      String(7000000001 + index),
    ),
  );
  if (previousValues)
    for (const [index, group] of groups.entries()) {
      group.followersValue = previousValues[index];
      group.followersDisplay = String(previousValues[index]);
    }
  await mkdir(path.join(archiveRoot, "data"));
  await mkdir(path.join(archiveRoot, "sources"));
  await write(path.join(archiveRoot, "data/群体分布数据.json"), { groups });
  await write(
    path.join(archiveRoot, "sources/微博官方接口候选主档冲突_2026-09-02.json"),
    { schemaVersion: "weibo-official-strict-master-conflicts-v1", records: [] },
  );
  const inputs = await readWeeklyInputs(archiveRoot);
  const plan = buildWeeklyPlan({
    ...inputs,
    now: new Date("2026-09-07T00:00:00+08:00"),
  });
  const directory = path.join(
    archiveRoot,
    "sources/weekly-profile-refresh",
    WEEK,
  );
  await mkdir(directory, { recursive: true });
  await write(path.join(directory, "plan.json"), plan);
  const observations = [];
  for (const batch of plan.batches) {
    const attempt = {
      schemaVersion: "weekly-profile-attempt-v1",
      weekId: WEEK,
      requestKey: batch.key,
      planSha256: hash(encode(plan)),
      uids: batch.values,
      startedAt: observedAt,
    };
    const profiles =
      suppliedProfiles ??
      batch.values.map((uid) => ({
        idstr: uid,
        followers_count:
          values[groups.findIndex((group) => group.weiboUid === uid)],
        screen_name: "新名称不会自动采用",
        description: "新简介不会自动采用",
      }));
    const response = {
      cliVersion: "0.9.1",
      stdout: JSON.stringify({ data: profiles }),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      signal: null,
    };
    const receipt = {
      schemaVersion: "weekly-profile-receipt-v1",
      weekId: WEEK,
      requestKey: batch.key,
      attemptSha256: hash(encode(attempt)),
      responseSha256: hash(encode(response)),
      outcome: "success",
      observedAt,
    };
    await write(path.join(directory, `${batch.key}.attempt.json`), attempt);
    await write(path.join(directory, `${batch.key}.response.json`), response);
    await write(path.join(directory, `${batch.key}.receipt.json`), receipt);
    for (const uid of batch.values) {
      const selected = plan.selected.find((item) => item.uid === uid);
      const followersValue =
        values[groups.findIndex((group) => group.weiboUid === uid)];
      const previous = selected.previous.followersValue;
      const jump =
        Math.abs(followersValue - previous) >= 1000 &&
        Math.abs(followersValue - previous) / Math.max(previous, 1) > 0.5;
      observations.push({
        id: selected.id,
        uid,
        followersValue,
        followersDisplay: String(followersValue),
        followersApproximate: false,
        followersObservedAt: observedAt,
        sourceUrl: `https://weibo.com/u/${uid}`,
        reviewReason: jump ? "followers_jump" : null,
        evidence: {
          requestKey: batch.key,
          responsePath: `sources/weekly-profile-refresh/${WEEK}/${batch.key}.response.json`,
          responseSha256: hash(encode(response)),
        },
      });
    }
  }
  const snapshot = {
    schemaVersion: "weekly-profile-snapshot-v1",
    weekId: WEEK,
    sourceSha256: plan.sourceSha256,
    complete: true,
    completedAt: observedAt,
    candidates: observations.filter((record) => !record.reviewReason),
    review: [
      ...plan.review,
      ...observations.filter((record) => record.reviewReason),
    ],
    diff: observations.map((record) => ({
      id: record.id,
      uid: record.uid,
      previous: plan.selected.find((item) => item.id === record.id).previous,
      next: record,
      reviewRequired: Boolean(record.reviewReason),
    })),
    policy: {
      automaticIdentityBinding: false,
      automaticPublishing: false,
      allowedFields: [
        "followersValue",
        "followersDisplay",
        "followersApproximate",
        "followersObservedAt",
        "sourceUrl",
        "evidence",
      ],
    },
  };
  await write(path.join(directory, "snapshot.json"), snapshot);
  const options = {
    archiveRoot,
    weekId: WEEK,
    displayGroups: globalThis.structuredClone(groups),
    current: emptyFollowerObservations(),
    now: NOW,
  };
  const applyOptions = {
    candidates: observations,
    masterGroups: groups,
    displayGroups: options.displayGroups,
    selected: plan.selected,
    current: options.current,
    now: NOW,
  };
  return {
    archiveRoot,
    directory,
    groups,
    plan,
    snapshot,
    observations,
    options,
    applyOptions,
  };
}

async function inventory(root) {
  const result = {};
  const walk = async (directory, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        await walk(path.join(directory, entry.name), `${relative}/`);
      else
        result[relative] = hash(
          await readFile(path.join(directory, entry.name)),
        );
    }
  };
  await walk(root);
  return result;
}

test("完整计划/账证/响应/快照闭合后仅输出粉丝白名单，归档字节不变", async () => {
  const f = await fixture();
  const before = await inventory(f.archiveRoot);
  const result = await inspectWeeklyApplication(f.options);
  assert.equal(result.status, "ready", result.errors.join(","));
  assert.deepEqual(result.applied, ["g001"]);
  assert.equal(result.dataset.records[0].followersValue, 6000);
  assert.equal(result.dataset.updatedAt, OBSERVED);
  assert.equal(result.verifiedInputHashes.length, 7);
  assert.ok(
    result.review.some(
      (item) =>
        item.reason === "non_follower_fields_manual_only" &&
        item.fields.includes("screen_name"),
    ),
  );
  assert.equal(
    /responsePath|accountScope|stdout|description|新名称|profileObservedAt/u.test(
      JSON.stringify(result.dataset),
    ),
    false,
  );
  assert.deepEqual(await inventory(f.archiveRoot), before);
  assert.equal(f.groups[0].name, "合成团体");
});

test("同周缓存复用及重跑幂等保留真正观察时间", async () => {
  const f = await fixture();
  const first = await inspectWeeklyApplication(f.options);
  const second = await inspectWeeklyApplication({
    ...f.options,
    current: first.dataset,
    now: new Date("2026-09-22T03:00:00Z"),
  });
  assert.equal(second.status, "ready", second.errors.join(","));
  assert.deepEqual(second.dataset, first.dataset);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.unchanged, ["g001"]);
  assert.equal(second.dataset.updatedAt, OBSERVED);
});

test("部分、额外、篡改候选或复核清单和diff都拒绝完整标志", async () => {
  for (const change of [
    (snapshot) => {
      snapshot.candidates = [];
    },
    (snapshot) => {
      snapshot.candidates.push(
        globalThis.structuredClone(snapshot.candidates[0]),
      );
    },
    (snapshot) => {
      snapshot.candidates[0].followersValue += 1;
    },
    (snapshot) => {
      snapshot.candidates[0].name = "不准改名";
    },
    (snapshot) => {
      snapshot.review.push({ id: "g999", reason: "fake" });
    },
    (snapshot) => {
      snapshot.diff[0].previous.followersValue = 1;
    },
    (snapshot) => {
      snapshot.policy.automaticIdentityBinding = true;
    },
  ]) {
    const f = await fixture();
    change(f.snapshot);
    await write(path.join(f.directory, "snapshot.json"), f.snapshot);
    const result = await inspectWeeklyApplication(f.options);
    assert.equal(result.status, "blocked");
    assert.ok(result.errors.includes("completed_snapshot_content_mismatch"));
  }
});

test("篡改响应哈希、未知残留批次和计划变化均拒绝", async () => {
  for (const kind of ["response", "extra", "plan"]) {
    const f = await fixture();
    if (kind === "response")
      await writeFile(
        path.join(f.directory, `${f.plan.batches[0].key}.response.json`),
        "{}",
        "utf8",
      );
    if (kind === "extra")
      await write(
        path.join(f.directory, `${"f".repeat(64)}.response.json`),
        {},
      );
    if (kind === "plan") {
      f.plan.selected[0].previous.followersValue = 10;
      await write(path.join(f.directory, "plan.json"), f.plan);
    }
    const result = await inspectWeeklyApplication(f.options);
    assert.equal(result.status, "blocked", kind);
  }
});

test("缺失响应、重复UID、跨UID和未知/小数/不安全整数值均拒绝", async () => {
  for (const profiles of [
    [],
    [{ idstr: "7000000002", followers_count: 6000 }],
    [{ idstr: "7000000001", uid: "7000000002", followers_count: 6000 }],
    [{ idstr: "7000000001", followers_count: null }],
    [{ idstr: "7000000001", followers_count: 1.5 }],
    [{ idstr: "7000000001", followers_count: Number.MAX_SAFE_INTEGER + 1 }],
  ]) {
    const f = await fixture({ profiles });
    assert.equal((await inspectWeeklyApplication(f.options)).status, "blocked");
  }
  const f = await fixture({
    values: [6000, 6000],
    profiles: [
      { idstr: "7000000001", followers_count: 6000 },
      { idstr: "7000000001", followers_count: 6000 },
    ],
  });
  assert.equal((await inspectWeeklyApplication(f.options)).status, "blocked");
});

test("展示身份冲突只留review，已发布层身份冲突阻止输出", async () => {
  const f = await fixture();
  f.options.displayGroups[0].fieldEvidence.profileIdentity.state = "blocked";
  const result = await inspectWeeklyApplication(f.options);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.dataset.records, []);
  assert.ok(
    result.review.some(
      (item) => item.reason === "cross_master_display_identity_mismatch",
    ),
  );
  f.options.displayGroups = globalThis.structuredClone(f.groups);
  const good = await inspectWeeklyApplication(f.options);
  f.options.displayGroups[0].weiboUid = "7000000002";
  assert.equal(
    (await inspectWeeklyApplication({ ...f.options, current: good.dataset }))
      .status,
    "blocked",
  );
  const direct = applyWeeklyCandidates({
    ...f.applyOptions,
    displayGroups: globalThis.structuredClone(f.groups),
    current: good.dataset,
    selected: [],
  });
  assert.equal(direct.status, "blocked");
  assert.ok(direct.errors[0].startsWith("current_identity_mismatch"));
});

test("跳变同时满足至少1000及超过50%才复核，并重新对当前层判断", async () => {
  for (const [value, expected] of [
    [7500, 1],
    [7501, 0],
    [4001, 1],
  ]) {
    const f = await fixture({ values: [value] });
    const result = await inspectWeeklyApplication(f.options);
    assert.equal(result.status, "ready");
    assert.equal(result.applied.length, expected);
  }
  const f = await fixture();
  const first = await inspectWeeklyApplication(f.options);
  const current = globalThis.structuredClone(first.dataset);
  Object.assign(current.records[0], {
    followersValue: 1000,
    followersDisplay: "1000",
    followersObservedAt: "2026-09-06T02:00:00Z",
    weekId: "week-2026-08-31",
  });
  current.updatedAt = current.records[0].followersObservedAt;
  const result = await inspectWeeklyApplication({ ...f.options, current });
  assert.deepEqual(result.dataset, current);
  assert.ok(result.review.some((item) => item.reason === "followers_jump"));
});

test("旧观察不能回退、同周不能刷新今天、相同时刻不同值留review", async () => {
  const f = await fixture();
  const good = await inspectWeeklyApplication(f.options);
  for (const [time, week, reason] of [
    ["2026-09-20T02:00:00Z", "week-2026-09-14", "older_observation"],
    ["2026-09-12T02:00:00Z", WEEK, "same_week_observation_conflict"],
    [OBSERVED, WEEK, "same_time_conflict"],
  ]) {
    const current = globalThis.structuredClone(good.dataset);
    Object.assign(current.records[0], {
      followersValue: 5500,
      followersDisplay: "5500",
      followersObservedAt: time,
      weekId: week,
    });
    current.updatedAt = time;
    const result = await inspectWeeklyApplication({ ...f.options, current });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.dataset, current);
    assert.ok(result.review.some((item) => item.reason === reason));
  }
});

test("future receipt/completedAt、非法日期与不正确周ID均拒绝", async () => {
  for (const observedAt of [
    "2026-09-22T02:00:00Z",
    "2026-02-30T02:00:00Z",
    "2026-09-13",
    "invalid",
  ]) {
    const f = await fixture({ observedAt });
    assert.equal((await inspectWeeklyApplication(f.options)).status, "blocked");
  }
  const f = await fixture();
  assert.equal(
    (
      await inspectWeeklyApplication({
        ...f.options,
        now: new Date("2026-09-12T00:00:00Z"),
      })
    ).status,
    "blocked",
  );
  assert.equal(
    (
      await inspectWeeklyApplication({
        ...f.options,
        weekId: "week-2026-09-08",
      })
    ).status,
    "blocked",
  );
});

test("缺少完整周归档时保持HOLD，不生成真实快照", async () => {
  const f = await fixture();
  const result = await inspectWeeklyApplication({
    ...f.options,
    weekId: "week-2026-09-14",
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.errors.includes("incomplete_archived_batches"));
});

test("归档采集维护锁存在时不可应用已完成快照", async () => {
  const f = await fixture();
  await write(
    path.join(f.archiveRoot, "sources/weekly-profile-refresh/maintenance.lock"),
    { synthetic: true },
  );
  const result = await inspectWeeklyApplication(f.options);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.errors, ["weekly_maintenance_locked"]);
});

test("纯应用门的重复候选整批拒绝；零基数和千人边界不混同未知", async () => {
  const f = await fixture();
  const duplicate = applyWeeklyCandidates({
    ...f.applyOptions,
    candidates: [f.observations[0], f.observations[0]],
  });
  assert.equal(duplicate.status, "blocked");
  assert.deepEqual(duplicate.applied, []);
  assert.deepEqual(duplicate.dataset.records, []);
  for (const [previous, next, applied] of [
    [0, 999, true],
    [0, 1000, false],
    [null, 0, true],
  ]) {
    const candidate = {
      ...f.observations[0],
      followersValue: next,
      followersDisplay: String(next),
      reviewReason: null,
    };
    const masterGroups = [{ ...f.groups[0], followersValue: previous }];
    const result = applyWeeklyCandidates({
      ...f.applyOptions,
      masterGroups,
      displayGroups: globalThis.structuredClone(masterGroups),
      candidates: [candidate],
    });
    assert.equal(result.status, "ready");
    assert.equal(result.applied.length === 1, applied);
  }
});

test("主档或展示的最新有效观察统一决定时点和跳变，同刻不同值留复核", async () => {
  const f = await fixture();
  for (const newerSource of ["masterGroups", "displayGroups"]) {
    const base = globalThis.structuredClone(f.groups);
    Object.assign(base[0], {
      followersValue: 6500,
      followersDisplay: "6500",
      followersObservedAt: "2026-09-14T02:00:00Z",
    });
    const result = applyWeeklyCandidates({
      ...f.applyOptions,
      [newerSource]: base,
    });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.applied, []);
    assert.ok(
      result.review.some((item) => item.reason === "older_observation"),
    );
  }
  const displayGroups = globalThis.structuredClone(f.groups);
  Object.assign(displayGroups[0], {
    followersValue: 6500,
    followersDisplay: "6500",
  });
  const conflict = applyWeeklyCandidates({ ...f.applyOptions, displayGroups });
  assert.equal(conflict.applied.length, 0);
  assert.ok(
    conflict.review.some(
      (item) => item.reason === "baseline_observation_conflict",
    ),
  );
});

test("过时current必须由更晚观察替换，保留过时层则整次HOLD", async () => {
  const f = await fixture();
  const current = applyWeeklyCandidates(f.applyOptions).dataset;
  const displayGroups = globalThis.structuredClone(f.groups);
  Object.assign(displayGroups[0], {
    followersValue: 7000,
    followersDisplay: "7000",
    followersObservedAt: "2026-09-15T02:00:00Z",
  });
  const retained = applyWeeklyCandidates({
    ...f.applyOptions,
    current,
    displayGroups,
    candidates: [],
  });
  assert.equal(retained.status, "blocked");
  assert.ok(
    retained.errors.includes("current_follower_older_observation:g001"),
  );
  const candidate = globalThis.structuredClone(f.observations[0]);
  Object.assign(candidate, {
    followersValue: 7100,
    followersDisplay: "7100",
    followersObservedAt: "2026-09-20T02:00:00Z",
  });
  candidate.evidence.responsePath = candidate.evidence.responsePath.replace(
    WEEK,
    "week-2026-09-14",
  );
  const updated = applyWeeklyCandidates({
    ...f.applyOptions,
    current,
    displayGroups,
    candidates: [candidate],
  });
  assert.equal(updated.status, "ready", updated.errors.join(","));
  assert.deepEqual(updated.applied, ["g001"]);
  assert.equal(updated.dataset.records[0].followersValue, 7100);
});

test("上游冻结主档的跳变标记须按更晚已接受粉丝观察重算", async () => {
  const f = await fixture({ values: [5100], previousValues: [100] });
  assert.equal(f.snapshot.candidates.length, 0);
  assert.equal(f.snapshot.review[0].reviewReason, "followers_jump");
  Object.assign(f.options.displayGroups[0], {
    followersValue: 5000,
    followersDisplay: "5000",
    followersObservedAt: "2026-09-12T02:00:00Z",
  });
  const before = await inventory(f.archiveRoot);
  const result = await inspectWeeklyApplication(f.options);
  assert.equal(result.status, "ready", result.errors.join(","));
  assert.deepEqual(result.applied, ["g001"]);
  assert.equal(result.dataset.records[0].followersValue, 5100);
  assert.deepEqual(await inventory(f.archiveRoot), before);
});

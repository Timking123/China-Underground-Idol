import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGroupCatalog } from "../scripts/groupCatalog.mjs";
import {
  validateFollowerObservations,
  emptyFollowerObservations,
  overlayFollowerObservations,
  readFollowerObservations,
} from "../scripts/followerObservations.mjs";

const now = new Date("2026-09-14T03:00:00Z");
const group = () => ({
  id: "g001",
  name: "历史名称",
  weiboUid: "7000000001",
  uidConfidence: "high",
  profileObservedAt: "2026-09-01T02:00:00Z",
  followersValue: 100,
  followersText: "100",
  followersKnown: true,
  baseX: 200,
  x: 210,
  fieldEvidence: {
    profileIdentity: {
      state: "verified",
      confidence: "high",
      candidateUid: "7000000001",
    },
    followers: { observedAt: "2026-09-01T02:00:00Z" },
  },
});
const row = () => ({
  groupId: "g001",
  uid: "7000000001",
  followersValue: 0,
  followersDisplay: "0",
  followersApproximate: false,
  followersObservedAt: "2026-09-13T02:00:00Z",
  sourceUrl: "https://weibo.com/u/7000000001",
  weekId: "week-2026-09-07",
  identityGate: "strict_uid_match",
  responseSha256: "a".repeat(64),
});
const dataset = (record = row()) => ({
  schemaVersion: "idol-follower-observations-v1",
  updatedAt: record.followersObservedAt,
  records: [record],
});

test("正式补充层为空且更新时间为null，没有合成发布记录", async () => {
  const formal = JSON.parse(
    await readFile(
      new URL("../data/follower-observations.v1.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(formal, emptyFollowerObservations());
  assert.deepEqual(
    await readFollowerObservations(new URL("..", import.meta.url)),
    formal,
  );
});

test("精确零值单独保留，未知记录不伪装为零值", () => {
  assert.equal(validateFollowerObservations(dataset(), now).valid, true);
  assert.equal(
    validateFollowerObservations(
      dataset({ ...row(), followersValue: null }),
      now,
    ).valid,
    false,
  );
  assert.equal(
    validateFollowerObservations(
      dataset({ ...row(), followersDisplay: "未知" }),
      now,
    ).valid,
    false,
  );
  assert.equal(
    overlayFollowerObservations([group()], dataset(), now)[0].followersKnown,
    true,
  );
});

test("近似值必须明确标识，不能冒充精确值", () => {
  assert.equal(
    validateFollowerObservations(
      dataset({
        ...row(),
        followersValue: 1000,
        followersDisplay: "约1000",
        followersApproximate: true,
      }),
      now,
    ).valid,
    true,
  );
  assert.equal(
    validateFollowerObservations(
      dataset({ ...row(), followersApproximate: true }),
      now,
    ).valid,
    false,
  );
});

test("嵌套私有字段、非公开链接、额外字段及重复UID拒绝", () => {
  for (const patch of [
    { responsePath: "private/raw.json" },
    { accountScope: "private" },
    { evidence: {} },
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://weibo.com/u/7000000002" },
    { followersValue: -1 },
    { followersValue: 1.5 },
  ]) {
    assert.equal(
      validateFollowerObservations(dataset({ ...row(), ...patch }), now).valid,
      false,
    );
  }
  assert.equal(
    validateFollowerObservations(
      { ...dataset(), records: [row(), { ...row(), groupId: "g002" }] },
      now,
    ).valid,
    false,
  );
});

test("非法、未来与错周观察时间以及用今天替代更新时间均拒绝", () => {
  for (const time of [
    "2026-02-30T00:00:00Z",
    "2026-09-13",
    "2026-09-15T00:00:00Z",
    "bad",
  ])
    assert.equal(
      validateFollowerObservations(
        dataset({ ...row(), followersObservedAt: time }),
        now,
      ).valid,
      false,
    );
  assert.equal(
    validateFollowerObservations(
      dataset({ ...row(), weekId: "week-2026-09-14" }),
      now,
    ).valid,
    false,
  );
  assert.equal(
    validateFollowerObservations(
      { ...dataset(), updatedAt: now.toISOString() },
      now,
    ).valid,
    false,
  );
});

test("内存覆盖仅影响粉丝及独立证据，旧来源对象和档案时间不变", () => {
  const original = group();
  const before = globalThis.structuredClone(original);
  const [next] = overlayFollowerObservations([original], dataset(), now);
  assert.equal(next.followersValue, 0);
  assert.equal(next.name, before.name);
  assert.equal(next.profileObservedAt, before.profileObservedAt);
  assert.deepEqual(next.fieldEvidence, before.fieldEvidence);
  next.fieldEvidence.followers.observedAt = "test-mutation";
  assert.deepEqual(original, before);
  const changed = Object.keys(next).filter(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]),
  );
  assert.deepEqual(
    changed.sort(),
    [
      "fieldEvidence",
      "followerObservation",
      "followersApproximate",
      "followersDisplay",
      "followersObservedAt",
      "followersText",
      "followersValue",
    ].sort(),
  );
});

test("归档图模式保留原值、未知状态和坐标，只附加独立观察", () => {
  const original = {
    ...group(),
    followersValue: null,
    followersKnown: false,
    followersText: "未知",
  };
  const [next] = overlayFollowerObservations(
    [original],
    dataset(),
    now,
    "archive",
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(next).filter(([key]) => key !== "followerObservation"),
    ),
    original,
  );
  assert.equal(next.followerObservation.followersValue, 0);
});

test("显式、字段证据及旧主页观察时间均保护较新的人工展示", () => {
  for (const field of [
    "followersObservedAt",
    "fieldEvidence",
    "profileObservedAt",
  ]) {
    const source = group();
    source.followersApproximate = false;
    if (field === "fieldEvidence")
      source.fieldEvidence.followers.observedAt = "2026-09-14T02:00:00Z";
    else source[field] = "2026-09-14T02:00:00Z";
    for (const mode of ["current", "archive"])
      assert.throws(
        () => overlayFollowerObservations([source], dataset(), now, mode),
        /follower_older_observation/u,
      );
  }
});

test("同刻值或精度不同不可覆盖，同刻相同观察可幂等读取", () => {
  const source = {
    ...group(),
    followersObservedAt: row().followersObservedAt,
    followersValue: 0,
    followersApproximate: false,
  };
  assert.equal(
    overlayFollowerObservations([source], dataset(), now)[0].followersValue,
    0,
  );
  assert.throws(
    () =>
      overlayFollowerObservations(
        [{ ...source, followersValue: 1 }],
        dataset(),
        now,
      ),
    /follower_same_time_conflict/u,
  );
  assert.throws(
    () =>
      overlayFollowerObservations(
        [{ ...source, followersApproximate: true }],
        dataset(),
        now,
      ),
    /follower_same_time_conflict/u,
  );
});

test("跨展示UID、低置信、blocked、conflict及拒绝账均失败关闭", () => {
  for (const mutate of [
    (value) => {
      value.weiboUid = "7000000002";
    },
    (value) => {
      value.uidConfidence = "medium";
    },
    (value) => {
      value.fieldEvidence.profileIdentity.state = "blocked";
    },
    (value) => {
      value.fieldEvidence.profileIdentity.state = "conflict";
    },
    (value) => {
      value.fieldEvidence.profileIdentity.confidence = "medium";
    },
    (value) => {
      value.rejectedIdentityCandidates = [{ uid: "7000000001" }];
    },
  ]) {
    const value = group();
    mutate(value);
    assert.throws(
      () => overlayFollowerObservations([value], dataset(), now),
      /identity_mismatch/u,
    );
  }
  assert.throws(
    () =>
      overlayFollowerObservations(
        [group(), { ...group(), id: "g002" }],
        dataset(),
        now,
      ),
    /identity_mismatch/u,
  );
});

test("团体索引实际入口采用新观察且不刷新主页来源观察时间", async () => {
  const sourceText = await readFile(
    new URL("../data.js", import.meta.url),
    "utf8",
  );
  const source = JSON.parse(
    /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(sourceText)[1],
  );
  const original = source.groups.find(
    (item) =>
      item.uidConfidence === "high" &&
      item.fieldEvidence?.profileIdentity?.state === "verified" &&
      item.fieldEvidence?.profileIdentity?.confidence === "high" &&
      String(item.fieldEvidence?.profileIdentity?.candidateUid) ===
        String(item.weiboUid) &&
      !item.rejectedIdentityCandidates?.length,
  );
  assert.ok(original);
  const sample = globalThis.structuredClone(original);
  sample.weiboAvatarPath = null;
  sample.avatarPath = null;
  sample.preferredVisual = null;
  const output = fileURLToPath(
    new URL("../../reports/weekly-application/site-fixtures/", import.meta.url),
  );
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(path.join(output, "catalog-"));
  await mkdir(path.join(root, "data"));
  const inputText = `window.IDOL_MAP_DATA=${JSON.stringify({ meta: { archiveCutoffDate: "2026-09-01", population: { total: 1 } }, groups: [sample] })};\n`;
  await writeFile(path.join(root, "data.js"), inputText, "utf8");
  const archivedCatalog = await buildGroupCatalog(root);
  assert.equal(
    archivedCatalog.groups[0].followers?.observedAt ?? null,
    sample.followersValue == null ? null : (sample.profileObservedAt ?? null),
  );
  const record = {
    ...row(),
    groupId: sample.id,
    uid: String(sample.weiboUid),
    sourceUrl: `https://weibo.com/u/${sample.weiboUid}`,
    followersObservedAt: "2026-09-06T02:00:00Z",
    weekId: "week-2026-08-31",
  };
  await writeFile(
    path.join(root, "data/follower-observations.v1.json"),
    JSON.stringify(dataset(record)),
    "utf8",
  );
  const catalog = await buildGroupCatalog(root);
  assert.equal(catalog.groups[0].followers.value, 0);
  assert.equal(
    catalog.groups[0].followers.observedAt,
    record.followersObservedAt,
  );
  assert.equal(
    catalog.groups[0].sources.find((item) => item.label === "粉丝独立观察来源")
      .observedAt,
    record.followersObservedAt,
  );
  const profile = catalog.groups[0].sources.find(
    (item) =>
      item.label === "已收录账号主页" || item.label === "已复核账号主页",
  );
  assert.equal(
    profile.observedAt,
    sample.publicReview?.profile?.observedAt ?? sample.profileObservedAt,
  );
  assert.equal(await readFile(path.join(root, "data.js"), "utf8"), inputText);
});

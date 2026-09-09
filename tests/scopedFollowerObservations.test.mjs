import assert from "node:assert/strict";
import test from "node:test";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import {
  emptyScopedFollowerObservations,
  scopedFollowerIdentity,
  scopedFollowerBaselineSources,
  validateScopedFollowerObservations,
  overlayCombinedFollowerObservations,
} from "../src/catalog/scopedFollowerObservations.ts";
import {
  emptyFollowerObservations,
  latestFollowerBaseline,
} from "../src/catalog/followerObservations.ts";
import { buildGroupCatalog } from "../scripts/groupCatalog.mjs";
import { entryPoints, publicFiles } from "../scripts/siteManifest.mjs";

const now = new Date("2026-09-18T16:00:00Z");
const root = new URL("../", import.meta.url);
const sourceText = await readFile(new URL("data.js", root), "utf8");
const source = JSON.parse(
  /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(sourceText)[1],
);
const group = () => ({
  id: "g001",
  name: "测试团原名称",
  weiboUid: "7000000001",
  uidSource: "weibo_browser_profile",
  uidConfidence: "high",
  profileUrl: "https://weibo.com/u/7000000001",
  profileObservedAt: "2026-09-01T02:00:00Z",
  followersValue: 100,
  followersText: "100",
  followersApproximate: false,
  followersKnown: true,
  x: 10,
  baseX: 20,
  fieldEvidence: {
    profileIdentity: {
      state: "verified",
      confidence: "high",
      candidateUid: "7000000001",
    },
  },
});
const row = (extra = {}) => ({
  groupId: "g001",
  uid: "7000000001",
  followersValue: 0,
  followersDisplay: "0",
  followersApproximate: false,
  followersObservedAt: "2026-09-13T02:00:00Z",
  sourceUrl: "https://weibo.com/u/7000000001",
  slotId: "scheduled-2026-09-11",
  identityGate: "strict_uid_match",
  entityKind: "团体账号",
  scopeNote: null,
  responseSha256: "a".repeat(64),
  ...extra,
});
const dataset = (...records) => ({
  schemaVersion: "idol-follower-observations-v2",
  updatedAt:
    records.toSorted(
      (a, b) =>
        Date.parse(b.followersObservedAt) - Date.parse(a.followersObservedAt),
    )[0]?.followersObservedAt ?? null,
  records,
});
function legacy(record = row()) {
  const rest = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !["slotId", "entityKind", "scopeNote"].includes(key),
    ),
  );
  const date = new Date(Date.parse(record.followersObservedAt) + 8 * 3_600_000);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return {
    schemaVersion: "idol-follower-observations-v1",
    updatedAt: record.followersObservedAt,
    records: [{ ...rest, weekId: `week-${date.toISOString().slice(0, 10)}` }],
  };
}
const overlay = (
  groups,
  records,
  mode = "current",
  old = emptyFollowerObservations(),
) =>
  overlayCombinedFollowerObservations(
    groups,
    old,
    dataset(...records),
    now,
    mode,
  );

function scopeRecord(current, observedAt = "2026-09-09T01:00:00Z") {
  return row({
    groupId: current.id,
    uid: String(current.weiboUid),
    sourceUrl: current.profileUrl,
    followersObservedAt: observedAt,
    slotId: "manual-2026-09-09",
    identityGate:
      current.uidSource === "public_reviewed_account_scope"
        ? "reviewed_account_scope"
        : current.uidSource === "editorial_profile_supplement"
          ? "accepted_candidate"
          : "strict_uid_match",
    entityKind: current.publicReview?.entityKind ?? "团体账号",
    scopeNote: current.publicReview?.summary ?? null,
  });
}

test("v2 正式数据通过公开合同，重读不刷新任何数值或观察日期", async () => {
  const file = new URL("data/follower-observations.v2.json", root);
  const before = await readFile(file, "utf8");
  const formal = JSON.parse(before);
  assert.deepEqual(validateScopedFollowerObservations(formal, new Date()), {
    valid: true,
    data: formal,
    errors: [],
  });
  assert.equal(await readFile(file, "utf8"), before);
});

test("精确零值、近似标识及公开字段白名单严格验证", () => {
  assert.equal(
    validateScopedFollowerObservations(dataset(row()), now).valid,
    true,
  );
  assert.equal(
    validateScopedFollowerObservations(
      dataset(
        row({
          followersValue: 1200,
          followersDisplay: "约1200",
          followersApproximate: true,
        }),
      ),
      now,
    ).valid,
    true,
  );
  for (const patch of [
    { followersValue: null },
    { followersValue: -1 },
    { followersValue: 0.5 },
    { followersValue: Number.MAX_SAFE_INTEGER + 1 },
    { followersApproximate: true },
    { followersDisplay: "未知" },
    { accountScope: "private" },
    { billing: {} },
    { responsePath: "private/raw.json" },
    { request: {} },
    { evidence: {} },
    { responseSha256: "x".repeat(64) },
    { uid: "bad" },
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://weibo.com/u/7000000002" },
    { identityGate: "manual_required" },
    { entityKind: "group" },
    { scopeNote: "自定范围" },
  ])
    assert.equal(
      validateScopedFollowerObservations(dataset(row(patch)), now).valid,
      false,
      JSON.stringify(patch),
    );
  for (const extra of [
    { updatedAt: now.toISOString() },
    { accountScope: "private" },
  ])
    assert.equal(
      validateScopedFollowerObservations({ ...dataset(row()), ...extra }, now)
        .valid,
      false,
    );
  const result = validateScopedFollowerObservations(
    { ...dataset(row()), updatedAt: null },
    now,
  );
  assert.equal(result.valid, false);
  assert.equal(Object.hasOwn(result, "data"), false);
  const missing = row();
  delete missing.scopeNote;
  assert.equal(
    validateScopedFollowerObservations(dataset(missing), now).valid,
    false,
  );
});

test("UTC+8 固定首次手动窗口与周五七日槽覆盖边界，不能借用旧周一", () => {
  for (const [observedAt, slotId] of [
    ["2026-09-10T16:00:00Z", "scheduled-2026-09-11"],
    ["2026-09-17T15:59:59.999Z", "scheduled-2026-09-11"],
    ["2026-09-17T16:00:00Z", "scheduled-2026-09-18"],
    ["2026-09-08T16:00:00Z", "manual-2026-09-09"],
    ["2026-09-10T00:00:00+08:00", "manual-2026-09-09"],
    ["2026-09-10T15:59:59.999Z", "manual-2026-09-09"],
    ["2026-09-11T00:00:00+08:00", "scheduled-2026-09-11"],
  ])
    assert.equal(
      validateScopedFollowerObservations(
        dataset(row({ followersObservedAt: observedAt, slotId })),
        now,
      ).valid,
      true,
      slotId,
    );
  for (const [observedAt, slotId] of [
    ["2026-09-08T15:59:59.999Z", "manual-2026-09-09"],
    ["2026-09-10T16:00:00Z", "manual-2026-09-09"],
    ["2026-09-11T00:00:00+08:00", "manual-2026-09-09"],
    ["2026-09-10T00:00:00+08:00", "manual-2026-09-10"],
    ["2026-09-08T12:00:00+08:00", "manual-2026-09-08"],
    ["2026-09-10T15:59:59.999Z", "scheduled-2026-09-04"],
    ["2026-09-04T00:00:00+08:00", "scheduled-2026-09-04"],
  ])
    assert.equal(
      validateScopedFollowerObservations(
        dataset(row({ followersObservedAt: observedAt, slotId })),
        now,
      ).valid,
      false,
      `${observedAt}/${slotId}`,
    );
  for (const slotId of [
    "week-2026-09-07",
    "scheduled-2026-09-07",
    "scheduled-2026-09-18",
    "manual-2026-09-12",
    "manual-2026-02-30",
  ])
    assert.equal(
      validateScopedFollowerObservations(dataset(row({ slotId })), now).valid,
      false,
      slotId,
    );
  for (const followersObservedAt of [
    "2026-02-30T00:00:00Z",
    "2026-09-13",
    "bad",
    "2026-09-19T00:00:00Z",
  ])
    assert.equal(
      validateScopedFollowerObservations(
        dataset(row({ followersObservedAt })),
        now,
      ).valid,
      false,
    );
});

test("重复团体、重复 UID 和缺少当前展示身份均拒绝", () => {
  for (const record of [
    row({ uid: "7000000002", sourceUrl: "https://weibo.com/u/7000000002" }),
    row({ groupId: "g002" }),
  ])
    assert.equal(
      validateScopedFollowerObservations(dataset(row(), record), now).valid,
      false,
    );
  assert.throws(() => overlay([], [row()]), /display_identity_mismatch/u);
  assert.throws(
    () => overlay([group(), group()], [row()]),
    /duplicate_display_group_id/u,
  );
  assert.throws(
    () => overlay([group(), { ...group(), id: "g002" }], [row()]),
    /display_identity_mismatch/u,
  );
});

test("当前 375 个存续账号沿用 279 严格、94 编辑接受和 2 企划的真实范围", () => {
  const active = source.groups.filter((item) => item.isActive);
  const records = active.map((item) => scopeRecord(item));
  const counts = {};
  for (const record of records)
    counts[record.identityGate] = (counts[record.identityGate] ?? 0) + 1;
  assert.deepEqual(counts, {
    strict_uid_match: 279,
    accepted_candidate: 94,
    reviewed_account_scope: 2,
  });
  assert.equal(
    validateScopedFollowerObservations(dataset(...records), now).valid,
    true,
  );
  const result = overlay(active, records);
  assert.equal(result.length, 375);
  for (const [index, original] of active.entries()) {
    assert.equal(
      scopedFollowerIdentity(original, records[index]),
      true,
      original.id,
    );
    assert.equal(result[index].weiboUid, original.weiboUid);
    assert.equal(result[index].uidSource, original.uidSource);
    assert.deepEqual(result[index].publicReview, original.publicReview);
    assert.deepEqual(result[index].fieldEvidence, original.fieldEvidence);
  }
});

test("严格身份继续旧裁决，编辑接受不能提升为 strict 或由未接受候选冒充", () => {
  const accepted = source.groups.find(
    (item) =>
      item.isActive &&
      item.editorialProfileSupplement?.state === "accepted_candidate",
  );
  const record = scopeRecord(accepted);
  assert.equal(scopedFollowerIdentity(accepted, record), true);
  assert.equal(
    scopedFollowerIdentity(accepted, {
      ...record,
      identityGate: "strict_uid_match",
    }),
    false,
  );
  for (const mutate of [
    (item) => {
      item.weiboUid = "7000000002";
    },
    (item) => {
      item.uidConfidence = "medium";
    },
    (item) => {
      item.uidSource = "weibo_api_candidate";
    },
    (item) => {
      item.editorialProfileSupplement.state = "candidate";
    },
    (item) => {
      item.editorialProfileSupplement.uid = "7000000002";
    },
    (item) => {
      item.editorialProfileSupplement.profileUrl =
        "https://weibo.com/u/7000000002";
    },
    (item) => {
      item.editorialProfileSupplement.appliedFields = ["followers"];
    },
    (item) => {
      item.rejectedIdentityCandidates = [{ uid: item.weiboUid }];
    },
  ]) {
    const value = globalThis.structuredClone(accepted);
    mutate(value);
    assert.throws(
      () => overlay([value], [record]),
      /display_identity_mismatch/u,
    );
  }
  for (const patch of [
    { state: "blocked" },
    { state: "conflict" },
    { confidence: "medium" },
    { candidateUid: "7000000002" },
  ]) {
    const value = group();
    Object.assign(value.fieldEvidence.profileIdentity, patch);
    assert.throws(
      () => overlay([value], [row()]),
      /display_identity_mismatch/u,
    );
  }
});

test("企划只接受固定 ID、UID 和当前复核说明，旧单团拒绝仍然保留", () => {
  for (const id of ["g060", "g360"]) {
    const original = source.groups.find((item) => item.id === id);
    const record = scopeRecord(original);
    const [result] = overlay([original], [record]);
    assert.equal(
      result.followerObservation.entityKind,
      original.publicReview.entityKind,
    );
    assert.equal(
      result.followerObservation.scopeNote,
      original.publicReview.summary,
    );
    assert.deepEqual(
      result.rejectedIdentityCandidates,
      original.rejectedIdentityCandidates,
    );
    for (const identityGate of ["strict_uid_match", "accepted_candidate"])
      assert.throws(
        () =>
          overlay(
            [original],
            [
              {
                ...record,
                identityGate,
                entityKind: "团体账号",
                scopeNote: null,
              },
            ],
          ),
        /identity_mismatch/u,
      );
    for (const mutate of [
      (item) => {
        item.publicReview.profile.uid = "7000000002";
      },
      (item) => {
        item.publicReview.profile.sourceUrl = "https://weibo.com/u/7000000002";
      },
      (item) => {
        item.publicReview.summary += "变更";
      },
      (item) => {
        item.publicReview.entityKind = "普通团体";
      },
      (item) => {
        item.publicReview.expectedHandle = "@另一个账号";
      },
      (item) => {
        item.publicReview.id = "g111";
      },
      (item) => {
        item.uidSource = "editorial_profile_supplement";
      },
    ]) {
      const value = globalThis.structuredClone(original);
      mutate(value);
      assert.throws(
        () => overlay([value], [record]),
        /display_identity_mismatch/u,
      );
    }
    for (const patch of [
      { groupId: "g111" },
      { uid: "7000000002" },
      { scopeNote: null },
      { entityKind: "" },
    ])
      assert.equal(
        validateScopedFollowerObservations(
          dataset({ ...record, ...patch }),
          now,
        ).valid,
        false,
      );
  }
});

test("两版本同时按最新真实观察选择，较旧层不会制造串行覆盖冲突", () => {
  const earlier = row({
    followersObservedAt: "2026-09-12T02:00:00Z",
    followersValue: 1,
    followersDisplay: "1",
  });
  for (const [old, current, expected] of [
    [legacy(earlier), row(), 0],
    [legacy(row()), earlier, 0],
  ]) {
    const [result] = overlay([group()], [current], "current", old);
    assert.equal(result.followersValue, expected);
    assert.equal(
      result.followerObservation.followersObservedAt,
      row().followersObservedAt,
    );
  }
  const [same] = overlay([group()], [row()], "current", legacy());
  assert.equal(same.followerObservation.slotId, row().slotId);
  for (const patch of [
    { followersValue: 1, followersDisplay: "1" },
    { followersApproximate: true, followersDisplay: "约0" },
  ])
    assert.throws(
      () => overlay([group()], [row(patch)], "current", legacy()),
      /follower_same_time_conflict/u,
    );
  assert.throws(
    () =>
      overlayCombinedFollowerObservations(
        [group()],
        legacy(row({ followersObservedAt: "2026-09-20T00:00:00Z" })),
        dataset(row()),
        now,
      ),
    /invalid_follower_record/u,
  );
});

test("原展示、已采用人工、同 UID 主档和独立观察都保护较新值", () => {
  for (const patch of [
    { followersObservedAt: "2026-09-14T02:00:00Z" },
    { profileObservedAt: "2026-09-14T02:00:00Z" },
    {
      publicReview: {
        profile: {
          uid: row().uid,
          followersValue: 200,
          followersApproximate: false,
          observedAt: "2026-09-14T02:00:00Z",
        },
      },
    },
    {
      strictSnapshot: {
        profile: {
          weiboUid: row().uid,
          followersValue: 200,
          followersApproximate: false,
          profileObservedAt: "2026-09-14T02:00:00Z",
        },
      },
    },
    {
      followerObservation: row({ followersObservedAt: "2026-09-14T02:00:00Z" }),
    },
    {
      fieldEvidence: {
        ...group().fieldEvidence,
        followers: {
          state: "verified",
          boundUid: row().uid,
          numericValue: 200,
          followersApproximate: false,
          observedAt: "2026-09-14T02:00:00Z",
        },
      },
    },
  ])
    for (const mode of ["current", "archive"])
      assert.throws(
        () => overlay([{ ...group(), ...patch }], [row()], mode),
        /follower_older_observation/u,
      );
  const same = {
    ...group(),
    followersObservedAt: row().followersObservedAt,
    followersValue: 0,
  };
  assert.equal(overlay([same], [row()])[0].followersValue, 0);
  assert.throws(
    () => overlay([{ ...same, followersValue: 1 }], [row()]),
    /follower_same_time_conflict/u,
  );
  assert.throws(
    () =>
      overlay(
        [
          {
            ...same,
            followerObservation: row({
              followersValue: 1,
              followersDisplay: "1",
            }),
          },
        ],
        [row()],
      ),
    /follower_baseline_observation_conflict/u,
  );
});

test("当前模式只改粉丝字段，归档模式只附加观察且克隆保留坐标和警示", () => {
  const original = {
    ...group(),
    followersKnown: false,
    followersValue: null,
    followersText: "未知",
    dataWarnings: ["保留身份警示"],
  };
  const before = globalThis.structuredClone(original);
  const [archive] = overlay([original], [row()], "archive");
  const { followerObservation, ...rest } = archive;
  assert.deepEqual(rest, original);
  assert.equal(followerObservation.followersValue, 0);
  const [current] = overlay([original], [row()]);
  const changed = Object.keys(current).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(original[key]),
  );
  assert.deepEqual(
    changed.sort(),
    [
      "followersValue",
      "followersDisplay",
      "followersText",
      "followersApproximate",
      "followersObservedAt",
      "followersKnown",
      "followerObservation",
    ]
      .filter(
        (key) => JSON.stringify(current[key]) !== JSON.stringify(original[key]),
      )
      .sort(),
  );
  current.fieldEvidence.profileIdentity.state = "changed";
  assert.deepEqual(original, before);
});

test("当前同 UID 基线的未来时间失败关闭，不把未来观察当成缺失", () => {
  for (const patch of [
    { followersObservedAt: "2026-09-20T00:00:00Z" },
    { profileObservedAt: "2026-09-20T00:00:00Z" },
    {
      publicReview: {
        profile: {
          uid: row().uid,
          followersValue: 200,
          observedAt: "2026-09-20T00:00:00Z",
        },
      },
    },
    {
      followerObservation: row({ followersObservedAt: "2026-09-20T00:00:00Z" }),
    },
    {
      fieldEvidence: {
        ...group().fieldEvidence,
        followers: {
          state: "verified",
          boundUid: row().uid,
          numericValue: 200,
          observedAt: "2026-09-20T00:00:00Z",
        },
      },
    },
  ])
    assert.throws(
      () => overlay([{ ...group(), ...patch }], [row()]),
      /follower_future_baseline/u,
    );
  assert.equal(
    overlay(
      [
        {
          ...group(),
          followerObservation: row({
            uid: "7000000002",
            followersObservedAt: "2026-09-20T00:00:00Z",
          }),
        },
      ],
      [row()],
    )[0].followersValue,
    0,
  );
});

test("已采用编辑补充及主档粉丝字段证据统一保护较晚、同刻冲突和未来观察", () => {
  for (const id of ["g057", "g001"]) {
    for (const [observedAt, expected] of [
      ["2026-09-10T02:00:00Z", /follower_older_observation/u],
      ["2026-09-09T01:00:00Z", /follower_same_time_conflict/u],
      ["2026-09-19T02:00:00Z", /follower_future_baseline/u],
    ]) {
      const original = globalThis.structuredClone(
        source.groups.find((item) => item.id === id),
      );
      const adopted =
        id === "g057"
          ? original.editorialProfileSupplement
          : original.strictSnapshot.profile.followerEvidence;
      adopted.observedAt = observedAt;
      const record = scopeRecord(original);
      record.followersValue = original.followersValue + 1;
      record.followersApproximate = original.followersApproximate;
      record.followersDisplay = `${record.followersApproximate ? "约" : ""}${record.followersValue}`;
      for (const mode of ["current", "archive"])
        assert.throws(
          () => overlay([original], [record], mode),
          expected,
          `${id}/${observedAt}/${mode}`,
        );
    }
  }
});

test("共享来源 helper 克隆已采用证据、保留原精度，并排除未采用和跨 UID 来源", () => {
  const time = "2026-09-10T02:00:00Z";
  for (const id of ["g057", "g001"]) {
    const original = globalThis.structuredClone(
      source.groups.find((item) => item.id === id),
    );
    const adopted =
      id === "g057"
        ? original.editorialProfileSupplement
        : original.strictSnapshot.profile.followerEvidence;
    adopted.observedAt = time;
    if (id === "g001") {
      adopted.numericValue = original.followersValue + 7;
      adopted.approximate = false;
    }
    const before = globalThis.structuredClone(original);
    const sources = scopedFollowerBaselineSources(original);
    const baseline = latestFollowerBaseline(sources, now);
    assert.equal(baseline.observedAt, time);
    assert.equal(
      baseline.value,
      id === "g057" ? adopted.followersValue : adopted.numericValue,
    );
    assert.equal(baseline.approximate, false);
    sources[0].name = "克隆变更";
    if (id === "g057")
      sources[0].editorialProfileSupplement.observedAt = "克隆变更";
    else
      sources[0].strictSnapshot.profile.followerEvidence.observedAt =
        "克隆变更";
    assert.deepEqual(original, before);
  }
  for (const [id, mutate] of [
    [
      "g057",
      (item) => {
        item.editorialProfileSupplement.state = "candidate";
      },
    ],
    [
      "g057",
      (item) => {
        item.editorialProfileSupplement.uid = "7000000002";
      },
    ],
    [
      "g057",
      (item) => {
        item.editorialProfileSupplement.appliedFields = ["identity"];
      },
    ],
    [
      "g001",
      (item) => {
        item.strictSnapshot.profile.weiboUid = "7000000002";
      },
    ],
    [
      "g001",
      (item) => {
        item.strictSnapshot.profile.followerEvidence.boundUid = "7000000002";
      },
    ],
    [
      "g001",
      (item) => {
        item.strictSnapshot.profile.followerEvidence.state = "candidate";
      },
    ],
  ]) {
    const original = globalThis.structuredClone(
      source.groups.find((item) => item.id === id),
    );
    const adopted =
      id === "g057"
        ? original.editorialProfileSupplement
        : original.strictSnapshot.profile.followerEvidence;
    adopted.observedAt = time;
    mutate(original);
    const baseline = latestFollowerBaseline(
      scopedFollowerBaselineSources(original),
      now,
    );
    assert.ok(baseline.time < Date.parse(time), id);
  }
  assert.deepEqual(scopedFollowerBaselineSources(null), []);
});

test("构建缺失 v2 在普通及 partial 模式先拒绝，partial 仍可暂缺代码入口", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "idol-scoped-follower-build-"),
  );
  const missingEntry = Object.values(entryPoints)[0];
  for (const file of [
    ...Object.values(entryPoints),
    ...publicFiles.filter((file) => !file.startsWith("assets/")),
    "data/follower-observations.v1.json",
  ]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), "", "utf8");
  }
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("scripts/build.mjs", root))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "scoped-build-guard",
        setup(builder) {
          builder.onResolve(
            { filter: /^(esbuild|\.\/(eventAssets|groupCatalog)\.mjs)$/ },
            (args) => ({ path: args.path, namespace: "scoped-build-probe" }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "scoped-build-probe" },
            (args) => {
              const name =
                args.path === "esbuild"
                  ? "build"
                  : args.path.includes("eventAssets")
                    ? "readEventAssets"
                    : "writeGroupCatalog";
              return {
                contents: `export async function ${name}(input) { globalThis.SCOPED_FOLLOWER_BUILD_CALLS.push({name: ${JSON.stringify(name)}, input}); }`,
                loader: "js",
              };
            },
          );
        },
      },
    ],
  });
  const fixtureBuild = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
  globalThis.SCOPED_FOLLOWER_BUILD_CALLS = [];
  try {
    for (const partial of [false, true]) {
      await assert.rejects(
        fixtureBuild.buildSite(directory, { partial }),
        /data\/follower-observations\.v2\.json/u,
      );
      assert.deepEqual(globalThis.SCOPED_FOLLOWER_BUILD_CALLS, []);
    }
    await writeFile(
      path.join(directory, "data/follower-observations.v2.json"),
      JSON.stringify(emptyScopedFollowerObservations()),
      "utf8",
    );
    await unlink(path.join(directory, missingEntry));
    await fixtureBuild.buildSite(directory, { partial: true });
    assert.deepEqual(
      globalThis.SCOPED_FOLLOWER_BUILD_CALLS.map((item) => item.name),
      ["readEventAssets", "writeGroupCatalog", "build"],
    );
    const buildCall = globalThis.SCOPED_FOLLOWER_BUILD_CALLS.at(-1);
    assert.equal(
      Object.values(buildCall.input.entryPoints).includes(missingEntry),
      false,
    );
  } finally {
    delete globalThis.SCOPED_FOLLOWER_BUILD_CALLS;
  }
});

test("实际 catalog 同时读取两个版本，保留主页日期与企划说明，并拒绝额外私有字段", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "idol-scoped-follower-catalog-"),
  );
  await mkdir(path.join(directory, "data"));
  const samples = ["g001", "g060", "g360"].map((id) => {
    const sample = globalThis.structuredClone(
      source.groups.find((item) => item.id === id),
    );
    sample.weiboAvatarPath = null;
    sample.avatarPath = null;
    sample.preferredVisual = null;
    return sample;
  });
  const input = `window.IDOL_MAP_DATA=${JSON.stringify({ meta: { archiveCutoffDate: "2026-09-01", population: { total: samples.length } }, groups: samples })};\n`;
  await writeFile(path.join(directory, "data.js"), input, "utf8");
  const records = samples.map((sample) =>
    scopeRecord(sample, "2026-09-09T01:00:00Z"),
  );
  await writeFile(
    path.join(directory, "data/follower-observations.v1.json"),
    JSON.stringify(
      legacy({
        ...records[0],
        followersObservedAt: "2026-09-08T01:00:00Z",
        followersValue: 1,
        followersDisplay: "1",
      }),
    ),
    "utf8",
  );
  await writeFile(
    path.join(directory, "data/follower-observations.v2.json"),
    JSON.stringify(dataset(...records)),
    "utf8",
  );
  const catalog = await buildGroupCatalog(directory);
  for (const [index, current] of catalog.groups.entries()) {
    assert.equal(current.followers.value, 0);
    assert.equal(
      current.followers.observedAt,
      records[index].followersObservedAt,
    );
    const profile = current.sources.find((item) =>
      ["已收录账号主页", "已复核账号主页"].includes(item.label),
    );
    assert.equal(
      profile.observedAt,
      samples[index].publicReview?.profile?.observedAt ??
        samples[index].profileObservedAt,
    );
    if (index > 0)
      assert.ok(
        current.sources.some((item) =>
          item.note.includes(samples[index].publicReview.summary),
        ),
      );
  }
  assert.equal(await readFile(path.join(directory, "data.js"), "utf8"), input);
  await writeFile(
    path.join(directory, "data/follower-observations.v2.json"),
    JSON.stringify(dataset({ ...records[0], accountScope: "private" })),
    "utf8",
  );
  await assert.rejects(
    buildGroupCatalog(directory),
    /invalid_scoped_follower_record/u,
  );
});

test("catalog 对缺失 v2 使用空层，对链接数据目录失败关闭", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "idol-scoped-follower-path-"),
  );
  const input = `window.IDOL_MAP_DATA=${JSON.stringify({ meta: { archiveCutoffDate: "2026-09-01", population: { total: 0 } }, groups: [] })};\n`;
  await writeFile(path.join(directory, "data.js"), input, "utf8");
  assert.deepEqual((await buildGroupCatalog(directory)).groups, []);
  const outside = await mkdtemp(
    path.join(tmpdir(), "idol-scoped-follower-external-"),
  );
  await symlink(outside, path.join(directory, "data"), "junction");
  await assert.rejects(
    buildGroupCatalog(directory),
    /unsafe_follower_directory|禁止符号链接/u,
  );
});

test("实际 map 入口合成注入双版本：保持归档主值，错误层显示失败标记", async () => {
  const older = row({
    followersObservedAt: "2026-09-08T01:00:00Z",
    followersValue: 1,
    followersDisplay: "1",
  });
  const recent = row({
    followersObservedAt: "2026-09-09T01:00:00Z",
    slotId: "manual-2026-09-09",
  });
  for (const fail of [false, true]) {
    const compiled = await build({
      entryPoints: [fileURLToPath(new URL("src/site/map.ts", root))],
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      plugins: [
        {
          name: "scoped-fixture",
          setup(builder) {
            builder.onLoad(
              { filter: /follower-observations\.v[12]\.json$/ },
              (args) => ({
                contents: JSON.stringify(
                  args.path.endsWith("v1.json")
                    ? legacy(older)
                    : dataset({
                        ...recent,
                        ...(fail ? { accountScope: "private" } : {}),
                      }),
                ),
                loader: "json",
              }),
            );
          },
        },
      ],
    });
    const current = group();
    const holder = { IDOL_MAP_DATA: { groups: [current] } };
    vm.runInNewContext(compiled.outputFiles[0].text, {
      window: holder,
      structuredClone: globalThis.structuredClone,
    });
    if (fail) {
      assert.equal(holder.IDOL_FOLLOWER_LAYER_ERROR, true);
      assert.deepEqual(holder.IDOL_MAP_DATA.groups, [current]);
    } else {
      assert.equal(holder.IDOL_FOLLOWER_LAYER_ERROR, undefined);
      const next = holder.IDOL_MAP_DATA.groups[0];
      assert.equal(next.followersValue, current.followersValue);
      assert.equal(next.x, current.x);
      assert.equal(next.baseX, current.baseX);
      assert.equal(next.followerObservation.followersValue, 0);
      assert.equal(next.followerObservation.slotId, recent.slotId);
    }
  }
});

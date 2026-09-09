import assert from "node:assert/strict";
import test from "node:test";
/* global structuredClone */
import {
  buildCandidateReview,
  deduplicateCandidates,
  diffSourceSnapshots,
  getCollectionWindow,
  normalizeCandidate,
} from "../src/eventCandidates.ts";

// 全部为离线合成数据，example.test 和伪 SHA 不进入正式活动 JSON。
function source(id = "post-a", overrides = {}) {
  return {
    sourceId: id,
    sourceUrl: `https://example.test/posts/${id}`,
    label: "合成官宣",
    publisher: "合成发布者",
    kind: "official",
    observedAt: "2026-09-09T00:00:00Z",
    bodySha256: "a".repeat(64),
    completeness: "complete",
    ...overrides,
  };
}
function item(id = "candidate-a", overrides = {}) {
  return {
    candidateId: id,
    sourceItemKey: `saved-${id}`,
    fields: {
      title: "合成秋日演出",
      date: "2026-09-10",
      province: "广东",
      city: "深圳",
      venue: "合成场馆",
      address: null,
      opensAt: "18:30",
      startsAt: "19:00",
      endsAt: null,
      status: "scheduled",
      performers: [{ groupId: null, name: "合成团体" }],
      notes: "合成测试",
      poster: null,
      ...overrides.fields,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "fields"),
    ),
  };
}
function candidate(
  id = "candidate-a",
  fields = {},
  sourceId = `post-${id}`,
  extra = {},
) {
  return normalizeCandidate(item(id, { fields, ...extra }), source(sourceId));
}
function snapshot(items, overrides = {}) {
  return { source: source("post-a", overrides), items };
}
const has = (result, kind) =>
  result.reviews.some((entry) => entry.kind === kind);
const mapped = (candidateId, eventId = "e-synthetic-a") => ({
  candidateId,
  eventId,
});

test("缺失或非法字段保留原候选，不补造活动状态", () => {
  const result = normalizeCandidate(
    {
      candidateId: "partial",
      fields: { title: " 已找到条目 ", date: "2026-02-30", startsAt: "25:10" },
    },
    source(),
  );
  assert.equal(result.fields.title, "已找到条目");
  assert.equal(result.fields.date, null);
  assert.equal(result.fields.status, null);
  assert.equal(result.rawFields.date, "2026-02-30");
  assert.equal(result.blockedForPublication, true);
  assert.ok(result.issues.some((issue) => issue.field === "status"));
});

test("输入与原始字段不被规范化或输出引用反向修改", () => {
  const input = item("a", {
    fields: {
      title: "  合成 ＬＩＶＥ  ",
      performers: [{ groupId: null, name: " 合成Ａ " }],
    },
  });
  const origin = source();
  const before = structuredClone({ input, origin });
  const normalized = normalizeCandidate(input, origin);
  assert.equal(normalized.fields.title, "合成 LIVE");
  assert.equal(normalized.fields.performers[0].name, "合成A");
  normalized.source.label = "输出修改";
  normalized.rawFields.performers[0].name = "输出修改";
  assert.deepEqual({ input, origin }, before);
});

test("六类来源均保留，不把聚合来源改写为官宣", () => {
  for (const kind of [
    "aggregator",
    "official",
    "organizer",
    "venue",
    "wiki",
    "ticketing",
  ]) {
    const result = normalizeCandidate(item(), source("a", { kind }));
    assert.equal(result.source.kind, kind);
  }
});

test("非法时间顺序、出演者和海报均阻塞，但不丢失原值", () => {
  const result = candidate("a", {
    opensAt: "20:00",
    startsAt: "19:00",
    endsAt: "01:00",
    performers: [{ groupId: null, name: "" }],
    poster: {
      src: "javascript:alert(1)",
      alt: "海报",
      sourceUrl: "https://example.test/a",
    },
  });
  assert.equal(result.blockedForPublication, true);
  assert.equal(result.fields.poster, null);
  assert.equal(result.rawFields.poster.src, "javascript:alert(1)");
  assert.ok(result.issues.some((issue) => issue.field === "opensAt"));
  assert.ok(result.issues.some((issue) => issue.field === "endsAt"));
  assert.ok(result.issues.some((issue) => issue.field === "performers"));
});

test("一帖多活动不会因相同来源 URL 聚为一个活动", () => {
  const origin = source("summary", { kind: "aggregator" });
  const first = normalizeCandidate(item("a"), origin);
  const second = normalizeCandidate(
    item("b", { fields: { title: "合成另一场", date: "2026-09-11" } }),
    origin,
  );
  const result = deduplicateCandidates([first, second]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every((group) => group.eventId === null));
});

test("聚合帖 URL 被错误声明 unique 时仍不用于自动合并", () => {
  const origin = source("summary", { kind: "aggregator" });
  const inputs = ["a", "b"].map((id) =>
    normalizeCandidate(
      item(id, {
        originalEventUrl: origin.sourceUrl,
        originalUrlIsUnique: true,
      }),
      origin,
    ),
  );
  const result = deduplicateCandidates(inputs);
  assert.equal(result.groups.length, 2);
  assert.ok(
    result.candidates.every(
      (entry) => !entry.originalUrlIsUnique && entry.blockedForPublication,
    ),
  );
});

test("同日同名同城的午场晚场只生成疑似重复复核", () => {
  const result = deduplicateCandidates([
    candidate("a", { session: "午场", startsAt: "13:00", opensAt: "12:30" }),
    candidate("b", { session: "晚场", startsAt: "19:00" }),
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(has(result, "possible_duplicate"), true);
});

test("非常相似标题和字段完全相同都不会凭相似性生成稳定活动 ID", () => {
  const result = deduplicateCandidates([candidate("a"), candidate("b")]);
  assert.equal(result.groups.length, 2);
  assert.ok(
    result.groups.every(
      (group) => group.eventId === null && group.blockedForPublication,
    ),
  );
  assert.equal(has(result, "possible_duplicate"), true);
});

test("多来源无冲突唯一原始活动 URL 可以聚组，但新稳定 ID 仍由维护者保存", () => {
  const extra = {
    originalEventUrl: "https://example.test/events/unique-a",
    originalUrlIsUnique: true,
  };
  const result = deduplicateCandidates([
    candidate("a", {}, "post-a", extra),
    candidate("b", {}, "post-b", extra),
  ]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].sources.length, 2);
  assert.equal(result.groups[0].fields.title.evidence.length, 2);
  assert.equal(result.groups[0].eventId, null);
  assert.equal(result.groups[0].reviewRequired, true);
});

test("原始活动 URL 相同但日期不同，拒绝自动聚组", () => {
  const extra = {
    originalEventUrl: "https://example.test/events/shared",
    originalUrlIsUnique: true,
  };
  const result = deduplicateCandidates([
    candidate("a", {}, "post-a", extra),
    candidate("b", { date: "2026-09-11" }, "post-b", extra),
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("同一帖不同已保存分段共享 unique URL 仍拒绝自动合并", () => {
  const extra = {
    originalEventUrl: "https://example.test/events/shared",
    originalUrlIsUnique: true,
  };
  const result = deduplicateCandidates([
    candidate("a", {}, "summary", extra),
    candidate("b", {}, "summary", extra),
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("URL 查询参数和片段不被删除以免合并不同场次", () => {
  const a = candidate("a", {}, "a", {
    originalEventUrl: "https://example.test/events/a?session=1#one",
    originalUrlIsUnique: true,
  });
  const b = candidate("b", {}, "b", {
    originalEventUrl: "https://example.test/events/a?session=2#two",
    originalUrlIsUnique: true,
  });
  const result = deduplicateCandidates([a, b]);
  assert.equal(result.groups.length, 2);
});

test("延期与更名跨日沿用保存 sourceItemKey 的稳定 ID", () => {
  const previous = snapshot([
    item("old", { sourceItemKey: "maintainer-event-a" }),
  ]);
  const current = snapshot(
    [
      item("new", {
        sourceItemKey: "maintainer-event-a",
        fields: {
          title: "合成延期改名",
          date: "2026-09-20",
          status: "postponed",
        },
      }),
    ],
    { bodySha256: "b".repeat(64) },
  );
  const result = buildCandidateReview({
    snapshots: [current],
    previousSnapshots: [previous],
    mappings: [
      {
        sourceId: "post-a",
        sourceItemKey: "maintainer-event-a",
        eventId: "e-existing",
      },
    ],
    now: new Date("2026-09-09T00:00:00Z"),
  });
  assert.equal(result.groups[0].eventId, "e-existing");
  assert.equal(result.groups[0].fields.date.value, "2026-09-20");
  assert.equal(result.groups[0].fields.status.value, "postponed");
  assert.deepEqual(result.sourceDiffs[0].missing, []);
  assert.deepEqual(
    result.sourceDiffs[0].changed[0].changes.map((change) => change.field),
    ["title", "date", "status"],
  );
});

test("已保存唯一活动 URL 映射可关联多个来源且保留原 ID", () => {
  const url = "https://example.test/events/unique";
  const extra = { originalEventUrl: url, originalUrlIsUnique: true };
  const result = deduplicateCandidates(
    [candidate("a", {}, "a", extra), candidate("b", {}, "b", extra)],
    [{ originalEventUrl: url, eventId: "e-existing" }],
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].eventId, "e-existing");
  assert.equal(result.groups[0].blockedForPublication, false);
});

test("不 unique 的普通来源 URL 无法匹配原始唯一 URL 映射", () => {
  const url = "https://example.test/events/ambiguous";
  const result = deduplicateCandidates(
    [candidate("a", {}, "a", { originalEventUrl: url })],
    [{ originalEventUrl: url, eventId: "e-existing" }],
  );
  assert.equal(result.groups[0].eventId, null);
});

test("维护者明确多源关联保留冲突字段、原值和摘录，不让后来源覆盖", () => {
  const a = candidate("a", {}, "a", {
    fieldExcerpts: { startsAt: "合成原文 START 19:00" },
  });
  const b = candidate("b", { startsAt: "20:00" });
  const result = deduplicateCandidates([a, b], [mapped("a"), mapped("b")]);
  assert.equal(result.groups.length, 1);
  const group = result.groups[0];
  assert.equal(group.fields.startsAt.value, null);
  assert.equal(group.fields.startsAt.conflict, true);
  assert.deepEqual(
    group.fields.startsAt.evidence.map((entry) => entry.value),
    ["19:00", "20:00"],
  );
  assert.equal(
    group.fields.startsAt.evidence[0].excerpt,
    "合成原文 START 19:00",
  );
  assert.equal(group.sources.length, 2);
  assert.equal(group.blockedForPublication, true);
});

test("相互矛盾的多选择器映射拒绝而非静默优先 candidateId", () => {
  const result = deduplicateCandidates(
    [candidate("a")],
    [
      {
        candidateId: "a",
        sourceId: "post-a",
        sourceItemKey: "saved-a",
        eventId: "e-a",
      },
    ],
  );
  assert.equal(result.groups[0].eventId, null);
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("同一候选通过不同映射指向多个稳定 ID 时拒绝关联", () => {
  const result = deduplicateCandidates(
    [candidate("a", {}, "post-a")],
    [
      mapped("a", "e-one"),
      { sourceId: "post-a", sourceItemKey: "saved-a", eventId: "e-two" },
    ],
  );
  assert.equal(result.groups[0].eventId, null);
  assert.ok(
    result.reviews.some(
      (entry) =>
        entry.kind === "ambiguous_identity" && entry.eventIds.length === 2,
    ),
  );
});

test("两个现存活动 ID 即使共享原始 URL 也不被合并", () => {
  const extra = {
    originalEventUrl: "https://example.test/events/a",
    originalUrlIsUnique: true,
  };
  const result = deduplicateCandidates(
    [candidate("a", {}, "a", extra), candidate("b", {}, "b", extra)],
    [mapped("a", "e-one"), mapped("b", "e-two")],
  );
  assert.equal(result.groups.length, 2);
  assert.deepEqual(
    result.groups.map((group) => group.eventId),
    ["e-one", "e-two"],
  );
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("完全重复导入幂等，字段证据和来源都只计一次", () => {
  const a = candidate("a");
  const result = deduplicateCandidates([a, structuredClone(a)], [mapped("a")]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].fields.title.evidence.length, 1);
  assert.equal(result.groups[0].blockedForPublication, false);
  assert.equal(has(result, "duplicate_import"), true);
});

test("相同 candidateId 的不同正文 SHA 观察不被静默覆盖", () => {
  const a = normalizeCandidate(item("a"), source("post-a"));
  const b = normalizeCandidate(
    item("a"),
    source("post-a", { bodySha256: "b".repeat(64) }),
  );
  const result = deduplicateCandidates([a, b], [mapped("a")]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.groups.length, 2);
  assert.ok(
    result.groups.every(
      (group) => group.eventId === null && group.blockedForPublication,
    ),
  );
});

test("同源同 sourceItemKey 对应两条不同候选时拒绝身份映射", () => {
  const result = deduplicateCandidates(
    [
      candidate("a", {}, "post-a", { sourceItemKey: "saved" }),
      candidate("b", {}, "post-a", { sourceItemKey: "saved" }),
    ],
    [{ sourceId: "post-a", sourceItemKey: "saved", eventId: "e-one" }],
  );
  assert.equal(result.candidates.length, 2);
  assert.ok(result.groups.every((group) => group.eventId === null));
});

test("旧帖字段相同但完整正文 SHA 变化仍报告编辑", () => {
  const result = diffSourceSnapshots(
    snapshot([item()]),
    snapshot([item()], { bodySha256: "b".repeat(64) }),
  );
  assert.equal(result.contentChanged, true);
  assert.equal(has(result, "source_edited"), true);
  assert.deepEqual(result.changed, []);
});

test("完整帖删除一段只生成 source_item_missing 复核，不改变活动状态", () => {
  const previous = snapshot([item("a"), item("b")]);
  const copy = structuredClone(previous);
  const result = diffSourceSnapshots(
    previous,
    snapshot([item("a")], { bodySha256: "b".repeat(64) }),
  );
  assert.deepEqual(result.missing, ["b"]);
  assert.equal(has(result, "source_item_missing"), true);
  assert.deepEqual(previous, copy);
  assert.equal(previous.items[1].fields.status, "scheduled");
});

test("完整转 partial 与 partial 转完整都不判断分段消失", () => {
  for (const [oldComplete, newComplete] of [
    ["complete", "partial"],
    ["partial", "complete"],
    ["partial", "partial"],
  ]) {
    const result = diffSourceSnapshots(
      snapshot([item("a"), item("b")], { completeness: oldComplete }),
      snapshot([item("a")], {
        completeness: newComplete,
        bodySha256: "b".repeat(64),
      }),
    );
    assert.equal(result.comparableForMissing, false);
    assert.deepEqual(result.missing, []);
    assert.equal(has(result, "source_item_missing"), false);
    assert.equal(has(result, "source_partial"), true);
  }
});

test("删除段内时间字段作为 after null 留待复核", () => {
  const result = diffSourceSnapshots(
    snapshot([item("a")]),
    snapshot([item("a", { fields: { startsAt: null } })], {
      bodySha256: "b".repeat(64),
    }),
  );
  assert.deepEqual(result.changed[0].changes, [
    { field: "startsAt", before: "19:00", after: null },
  ]);
});

test("没有稳定分段键时不以行号、排序或相同标题跨版本匹配", () => {
  const a = item("row-0", { sourceItemKey: undefined });
  const b = item("row-1", { sourceItemKey: undefined });
  const result = diffSourceSnapshots(
    snapshot([a, b]),
    snapshot([b, a], { bodySha256: "b".repeat(64) }),
  );
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.missing, []);
  assert.equal(has(result, "source_item_unmatched"), true);
});

test("稳定分段键移动顺序后正确比较，不把行号当身份", () => {
  const result = diffSourceSnapshots(
    snapshot([item("a"), item("b")]),
    snapshot([item("b"), item("a", { fields: { title: "合成新标题" } })], {
      bodySha256: "b".repeat(64),
    }),
  );
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].sourceItemKey, "saved-a");
  assert.deepEqual(result.missing, []);
});

test("重复 sourceItemKey 不比较含糊分段也不误报另一段消失", () => {
  const previous = snapshot([
    item("a", { sourceItemKey: "one" }),
    item("b", { sourceItemKey: "one" }),
  ]);
  const current = snapshot([item("a", { sourceItemKey: "one" })], {
    bodySha256: "b".repeat(64),
  });
  const result = diffSourceSnapshots(previous, current);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.missing, []);
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("不同来源或来源 ID 对应不同 URL 的快照拒绝比较", () => {
  assert.throws(
    () =>
      diffSourceSnapshots(
        snapshot([]),
        snapshot([], { sourceId: "different" }),
      ),
    /只允许比较/,
  );
  assert.throws(
    () =>
      diffSourceSnapshots(
        snapshot([]),
        snapshot([], { sourceUrl: "https://example.test/other" }),
      ),
    /只允许比较/,
  );
});

test("UTC+8 今天、7日和30日窗口使用半开区间并跨月计算", () => {
  assert.deepEqual(getCollectionWindow(new Date("2026-09-08T16:00:00Z")), {
    timezone: "UTC+08:00",
    fromInclusive: "2026-09-09",
    focusToExclusive: "2026-09-16",
    toExclusive: "2026-10-09",
  });
  assert.equal(
    getCollectionWindow(new Date("2026-09-08T15:59:59Z")).fromInclusive,
    "2026-09-08",
  );
  assert.equal(
    getCollectionWindow(new Date("2028-02-28T16:00:00Z")).fromInclusive,
    "2028-02-29",
  );
  assert.throws(() => getCollectionWindow(new Date("invalid")), RangeError);
});

test("窗口只标记候选，保留过去、未知日期和第30日边界候选", () => {
  const dates = [
    "2026-09-08",
    "2026-09-09",
    "2026-09-15",
    "2026-09-16",
    "2026-10-08",
    "2026-10-09",
    null,
  ];
  const result = buildCandidateReview({
    snapshots: [
      snapshot(
        dates.map((date, index) => item(`a${index}`, { fields: { date } })),
      ),
    ],
    now: new Date("2026-09-08T16:00:00Z"),
  });
  assert.equal(result.candidates.length, 7);
  assert.deepEqual(result.focusCandidateIds, ["a1", "a2"]);
  assert.deepEqual(result.inWindowCandidateIds, ["a1", "a2", "a3", "a4"]);
});

test("本轮无来源返回不报告活动消失或取消", () => {
  const result = buildCandidateReview({
    snapshots: [],
    previousSnapshots: [snapshot([item()])],
    now: new Date("2026-09-09T00:00:00Z"),
  });
  assert.deepEqual(result.sourceDiffs, []);
  assert.equal(has(result, "source_item_missing"), false);
});

test("同源重复快照即使正文相同也显式拒绝版本含糊", () => {
  const snap = snapshot([item("a")]);
  const result = buildCandidateReview({
    snapshots: [snap, structuredClone(snap)],
    mappings: [mapped("a")],
    now: new Date("2026-09-09T00:00:00Z"),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(has(result, "ambiguous_identity"), true);
  assert.equal(result.groups[0].blockedForPublication, true);
});

test("观察时间不同的重复键不被覆盖，即使正文 SHA 相同", () => {
  const a = normalizeCandidate(item("a"), source());
  const b = normalizeCandidate(
    item("a"),
    source("post-a", { observedAt: "2026-09-10T00:00:00Z" }),
  );
  const result = deduplicateCandidates([a, b], [mapped("a")]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.groups.length, 2);
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("唯一 URL 的状态冲突不能绕过无冲突自动合并条件", () => {
  const extra = {
    originalEventUrl: "https://example.test/events/a",
    originalUrlIsUnique: true,
  };
  const result = deduplicateCandidates([
    candidate("a", {}, "a", extra),
    candidate("b", { status: "cancelled" }, "b", extra),
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(has(result, "ambiguous_identity"), true);
});

test("同一帖无稳定分段键的两条候选不能靠共同原始 URL 聚组", () => {
  const extra = {
    sourceItemKey: undefined,
    originalEventUrl: "https://example.test/posts/post-a",
    originalUrlIsUnique: true,
  };
  const result = deduplicateCandidates([
    candidate("a", {}, "post-a", extra),
    candidate("b", {}, "post-a", extra),
  ]);
  assert.equal(result.groups.length, 2);
});

test("唯一 URL 自动加入已映射组前检查整个组而不是单一匹配来源", () => {
  const extra = {
    originalEventUrl: "https://example.test/events/a",
    originalUrlIsUnique: true,
  };
  const a = candidate("a", {}, "a", extra);
  const b = candidate("b", { date: "2026-09-20" });
  const c = candidate("c", {}, "c", extra);
  const result = deduplicateCandidates([a, b, c], [mapped("a"), mapped("b")]);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(
    result.groups.find((group) => group.eventId === "e-synthetic-a")
      .candidateIds,
    ["a", "b"],
  );
  assert.equal(
    result.groups.find((group) => group.candidateIds.includes("c")).eventId,
    null,
  );
});

test("稳定分段键不被 trim 后静默匹配另一份已保存身份", () => {
  const a = candidate("a", {}, "post-a", { sourceItemKey: " saved-a " });
  const result = deduplicateCandidates(
    [a],
    [{ sourceId: "post-a", sourceItemKey: "saved-a", eventId: "e-existing" }],
  );
  assert.equal(a.sourceItemKey, " saved-a ");
  assert.equal(a.blockedForPublication, true);
  assert.equal(result.groups[0].eventId, null);
});

test("同一稳定分段原始链接改变或消失时保留身份目标但阻断复核", () => {
  for (const newUrl of ["https://example.test/events/other", undefined]) {
    const previous = snapshot([
      item("old", {
        sourceItemKey: "stable",
        originalEventUrl: "https://example.test/events/original",
        originalUrlIsUnique: true,
      }),
    ]);
    const current = snapshot(
      [
        item("new", {
          sourceItemKey: "stable",
          originalEventUrl: newUrl,
          originalUrlIsUnique: true,
        }),
      ],
      { observedAt: "2026-09-09T01:00:00Z" },
    );
    const result = buildCandidateReview({
      snapshots: [current],
      previousSnapshots: [previous],
      mappings: [
        { sourceId: "post-a", sourceItemKey: "stable", eventId: "e-existing" },
      ],
      now: new Date("2026-09-09T04:00:00Z"),
    });
    assert.equal(result.groups[0].eventId, "e-existing");
    assert.equal(result.groups[0].blockedForPublication, true);
    assert.equal(has(result, "ambiguous_identity"), true);
  }
});

test("业务字段和链接不变但唯一性声明双向变化也须重新确认身份", () => {
  for (const originalUrlIsUnique of [true, false]) {
    const previous = snapshot([
      item("old", {
        sourceItemKey: "stable",
        originalEventUrl: "https://example.test/events/original",
        originalUrlIsUnique,
      }),
    ]);
    const current = snapshot(
      [
        item("new", {
          sourceItemKey: "stable",
          originalEventUrl: "https://example.test/events/original",
          originalUrlIsUnique: !originalUrlIsUnique,
        }),
      ],
      { observedAt: "2026-09-09T01:00:00Z" },
    );
    const result = buildCandidateReview({
      snapshots: [current],
      previousSnapshots: [previous],
      mappings: [
        { sourceId: "post-a", sourceItemKey: "stable", eventId: "e-existing" },
      ],
      now: new Date("2026-09-09T04:00:00Z"),
    });
    assert.equal(result.groups[0].blockedForPublication, true);
    assert.equal(has(result, "ambiguous_identity"), true);
  }
});

test("倒退观察即使正文和字段不变也阻断，不当作新证据", () => {
  const previous = snapshot([item("a")]);
  const current = snapshot([item("a")], { observedAt: "2026-09-08T00:00:00Z" });
  const result = buildCandidateReview({
    snapshots: [current],
    previousSnapshots: [previous],
    mappings: [mapped("a")],
    now: new Date("2026-09-09T04:00:00Z"),
  });
  assert.equal(result.groups[0].blockedForPublication, true);
  assert.equal(has(result, "source_observation_regressed"), true);
  assert.equal(result.candidates[0].source.observedAt, "2026-09-08T00:00:00Z");
});

test("倒退观察的完整快照不生成消失分段结论", () => {
  const result = diffSourceSnapshots(
    snapshot([item("a")]),
    snapshot([], { observedAt: "2026-09-08T00:00:00Z" }),
  );
  assert.equal(result.comparableForMissing, false);
  assert.deepEqual(result.missing, []);
  assert.equal(has(result, "source_item_missing"), false);
  assert.equal(has(result, "source_observation_regressed"), true);
});

test("时区表达不同的相同观察瞬间不会误判倒退", () => {
  const previous = snapshot([item("a")]);
  const current = snapshot([item("a")], {
    observedAt: "2026-09-09T08:00:00+08:00",
  });
  const result = buildCandidateReview({
    snapshots: [current],
    previousSnapshots: [previous],
    mappings: [mapped("a")],
    now: new Date("2026-09-09T04:00:00Z"),
  });
  assert.equal(result.groups[0].blockedForPublication, false);
  assert.equal(has(result, "source_observation_regressed"), false);
});

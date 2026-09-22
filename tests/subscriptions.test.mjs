import assert from "node:assert/strict";
import test from "node:test";
import {
  createFeedRevision,
  validateFeedLedger,
} from "../scripts/generateSubscriptions.mjs";
import {
  buildSubscriptionIcs,
  buildFeedManifest,
  feedPath,
  foldIcsLine,
  validateFeedState,
} from "../src/subscriptions/model.ts";
import { buildCalendarIcs } from "../src/events/model.ts";
import {
  formatUpdateValue,
  selectUpdates,
  validateUpdates,
} from "../src/updates/model.ts";
/* global structuredClone */

const INIT = "2026-09-19T02:00:00.000Z";
const NEXT = "2026-09-19T03:00:00.000Z";
const GROUP = { type: "group", id: "g001", label: "测试团" };
// 合成数据只用于测试，不写入公开资料。
function event(overrides = {}) {
  return {
    id: "e-test-one",
    title: "测试演出",
    date: "2026-12-31",
    province: "广东",
    city: "深圳",
    venue: null,
    address: null,
    opensAt: null,
    startsAt: null,
    endsAt: null,
    status: "scheduled",
    performers: [{ groupId: "g001", name: "测试团" }],
    sources: [
      {
        url: "https://example.org/announcement",
        label: "测试官宣",
        publisher: "测试方",
        observedAt: "2026-09-18T12:00:00.000Z",
        kind: "official",
      },
    ],
    notes: "",
    poster: null,
    ...overrides,
  };
}
const dataset = (events = [event()]) => ({
  schemaVersion: "idol-events-v1",
  coverage: "partial",
  updatedAt: INIT,
  events,
});
const initial = (events = dataset()) =>
  createFeedRevision({ events, recordedAt: INIT, reason: "初始化真实快照" });
const revise = (prior, events, extra = {}) =>
  createFeedRevision({
    events,
    previousState: prior.state,
    previousUpdates: prior.history,
    recordedAt: NEXT,
    reason: "按已核验官宣更新",
    ...extra,
  });
const unfold = (text) => text.replace(/\r\n[ \t]/gu, "");

test("修订结果与调用方输入隔离，后续编辑不会污染已生成的基线", () => {
  const input = dataset();
  const generated = initial(input);
  input.events[0].title = "调用方继续编辑";
  assert.equal(generated.state.records[0].snapshot.event.title, "测试演出");
  validateFeedLedger(generated.state, generated.history);
});

test("首次基线后新增记录有真实新增差异，多次修订链可回溯", () => {
  const first = initial(dataset([]));
  const added = revise(first, dataset());
  assert.equal(added.history.entries[0].kind, "added");
  assert.equal(added.history.entries[0].beforeHash, null);
  const changed = revise(added, dataset([event({ venue: "第二个测试场地" })]), {
    recordedAt: "2026-09-19T04:00:00.000Z",
  });
  validateFeedLedger(changed.state, changed.history);
  assert.equal(changed.state.records[0].sequence, 1);
  const missing = structuredClone(changed.history);
  missing.entries = missing.entries.slice(1);
  // 删除新增记录会丢失创建来源；正常链应从新增的第0版开始。
  assert.throws(() => validateFeedLedger(changed.state, missing), /起始记录/u);
  assert.match(
    formatUpdateValue(
      JSON.stringify([{ groupId: "g001", name: "测试团" }]),
      "performers",
    ),
    /^测试团$/u,
  );
  assert(
    !formatUpdateValue(
      JSON.stringify({ outcome: "partial", fields: { date: "verified" } }),
      "verification",
    ).includes("{"),
  );
});

test("初次启用不伪造历史；相同数据跨构建、重复候选逐字节稳定", () => {
  const one = initial();
  assert.deepEqual(one.history.entries, []);
  const two = revise(
    one,
    { ...dataset(), updatedAt: NEXT },
    { recordedAt: "2027-01-01T00:00:00.000Z" },
  );
  assert.deepEqual(two, one);
  const first = buildSubscriptionIcs(GROUP, one.state);
  assert.equal(buildSubscriptionIcs(GROUP, two.state), first);
  assert.match(first, /DTSTAMP:20260919T020000Z/u);
  assert.match(first, /SEQUENCE:0/u);
});

test("同事件跨城市、团体、旧手动导出保持UID；真实变化只推进一次修订", () => {
  const old = initial();
  const next = revise(
    old,
    dataset([event({ venue: "新场地", status: "cancelled" })]),
  );
  const group = unfold(buildSubscriptionIcs(GROUP, next.state));
  const city = unfold(
    buildSubscriptionIcs(
      { type: "city", id: "深圳", label: "深圳" },
      next.state,
    ),
  );
  const manual = buildCalendarIcs([event()], new Date(INIT));
  const uid = "UID:e-test-one@idol-events.local";
  for (const ics of [group, city, manual]) assert(ics.includes(uid));
  assert.match(group, /STATUS:CANCELLED/u);
  assert.match(group, /SEQUENCE:1/u);
  assert.match(group, /LAST-MODIFIED:20260919T030000Z/u);
  assert.deepEqual(
    next.history.entries[0].changes.map((change) => change.field).sort(),
    ["status", "venue"],
  );
  assert.deepEqual(
    revise(next, dataset([event({ venue: "新场地", status: "cancelled" })])),
    next,
  );
});

test("日程状态取主档，未知字段或核验失败不降级已计划活动", () => {
  const one = initial();
  assert.match(buildSubscriptionIcs(GROUP, one.state), /STATUS:CONFIRMED/u);
  const fields = Object.fromEntries(
    ["date", "status", "venue", "address", "opensAt", "startsAt", "endsAt"].map(
      (field) => [field, "unverified"],
    ),
  );
  const two = revise(one, dataset(), {
    verification: {
      records: [
        {
          eventId: "e-test-one",
          outcome: "unverified",
          fields,
          checkedAt: NEXT,
          evidence: [],
        },
      ],
    },
  });
  assert.deepEqual(two, one);
});

test("未知时间和延期明确日期占位；待确认不变成确认", () => {
  const unknown = unfold(buildSubscriptionIcs(GROUP, initial().state));
  assert.match(unknown, /DTSTART;VALUE=DATE:20261231/u);
  assert.match(unknown, /不表示全天演出/u);
  assert(!unknown.includes("DTEND:"));
  const postponed = unfold(
    buildSubscriptionIcs(
      GROUP,
      initial(dataset([event({ status: "postponed", startsAt: "18:00" })]))
        .state,
    ),
  );
  assert.match(postponed, /STATUS:TENTATIVE/u);
  assert.match(postponed, /原日期占位/u);
  assert.match(postponed, /DTSTART;VALUE=DATE:20261231/u);
  assert.match(
    buildSubscriptionIcs(
      GROUP,
      initial(dataset([event({ status: "unconfirmed" })])).state,
    ),
    /STATUS:TENTATIVE/u,
  );
});

test("UTC+8跨日跨年正确换算；未知结束不补造时长", () => {
  const ics = buildSubscriptionIcs(
    GROUP,
    initial(dataset([event({ date: "2027-01-01", startsAt: "00:30" })])).state,
  );
  assert.match(ics, /DTSTART:20261231T163000Z/u);
  assert(!ics.includes("DTEND:"));
  assert(!ics.includes("VALARM"));
});

test("UTF8折行每物理行至多75字节，转义防日历属性注入", () => {
  const title = "中文，;\\🎤".repeat(20);
  const notes = "资料\r\nBEGIN:VEVENT\nSUMMARY:伪造";
  const ics = buildSubscriptionIcs(
    GROUP,
    initial(dataset([event({ title, notes })])).state,
  );
  for (const line of ics.split("\r\n"))
    assert(Buffer.byteLength(line, "utf8") <= 75);
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 2);
  assert.equal(ics.match(/^BEGIN:VEVENT\r$/gmu)?.length, 1);
  assert(!ics.includes("\ufffd"));
  assert(unfold(ics).includes("\\nBEGIN:VEVENT\\nSUMMARY:伪造"));
  assert.equal(
    foldIcsLine("中".repeat(26)).replace(/\r\n /gu, ""),
    "中".repeat(26),
  );
});

test("来源或记录缺席只产生撤下变更，保留UID且不伪造取消", () => {
  const old = initial();
  const withdrawn = revise(old, dataset([]));
  const ics = unfold(buildSubscriptionIcs(GROUP, withdrawn.state));
  assert.equal(withdrawn.history.entries[0].kind, "withdrawn");
  assert.match(ics, /UID:e-test-one@idol-events.local/u);
  assert.match(ics, /来源缺席不等于取消/u);
  assert(!ics.includes("STATUS:CANCELLED"));
  assert.deepEqual(revise(withdrawn, dataset([])), withdrawn);
  const restored = revise(withdrawn, dataset(), {
    recordedAt: "2026-09-19T04:00:00.000Z",
  });
  assert.equal(restored.state.records[0].sequence, 2);
  assert.equal(restored.history.entries[1].kind, "restored");
});

test("移城与换阵容仍向原订阅提供修订，关注按前后范围并集筛选", () => {
  const result = revise(
    initial(),
    dataset([
      event({
        city: "广州",
        performers: [{ groupId: "g002", name: "另一个测试团" }],
      }),
    ]),
  );
  for (const scope of [
    GROUP,
    { type: "city", id: "深圳", label: "深圳" },
    { type: "city", id: "广州", label: "广州" },
  ])
    assert.match(buildSubscriptionIcs(scope, result.state), /SEQUENCE:1/u);
  assert.equal(
    selectUpdates(
      result.history,
      { groups: ["g001"], cities: [], events: [] },
      true,
    ).length,
    1,
  );
  assert.equal(
    selectUpdates(
      result.history,
      { groups: [], cities: ["广州"], events: [] },
      true,
    ).length,
    1,
  );
  assert.equal(
    selectUpdates(
      result.history,
      { groups: [], cities: [], events: ["e-test-one"] },
      true,
    ).length,
    1,
  );
  assert.equal(
    selectUpdates(
      result.history,
      { groups: [], cities: ["上海"], events: [] },
      true,
    ).length,
    0,
  );
});

test("固定目录严格命名、空范围也有订阅、不允许路径注入", () => {
  const state = initial(dataset([])).state;
  const manifest = buildFeedManifest(
    {
      groups: [
        {
          id: "g001",
          name: "测试团",
          activity: { city: "深圳" },
          founding: { city: null },
        },
      ],
    },
    state,
  );
  assert.deepEqual(manifest.feeds.map((feed) => feed.path).sort(), [
    "feeds/v1/cities/e6b7b1e59cb3.ics",
    "feeds/v1/groups/g001.ics",
  ]);
  assert.equal(manifest.feeds[0].eventCount, 0);
  assert.match(buildSubscriptionIcs(GROUP, state), /BEGIN:VCALENDAR\r\n/u);
  assert(!buildSubscriptionIcs(GROUP, state).includes("BEGIN:VEVENT"));
  assert.throws(() => feedPath({ ...GROUP, id: "../secret" }));
});

test("候选时间倒退、哈希改写、修订缺失与恶意来源均失败关闭", () => {
  const one = initial();
  assert.throws(
    () =>
      revise(one, dataset([event({ venue: "新场地" })]), { recordedAt: INIT }),
    /晚于/u,
  );
  const tampered = structuredClone(one);
  tampered.state.records[0].snapshot.event.title = "被改写";
  assert.throws(
    () => validateFeedLedger(tampered.state, tampered.history),
    /哈希/u,
  );
  const next = revise(one, dataset([event({ venue: "新场地" })]));
  assert.throws(() => validateFeedLedger(next.state, one.history), /末次修订/u);
  const fake = structuredClone(next);
  fake.history.entries[0].changes[0].before = '"捏造的旧场地"';
  assert.throws(
    () => validateFeedLedger(fake.state, fake.history),
    /修订前哈希/u,
  );
  next.history.entries[0].sources[0].url = "javascript:alert(1)";
  assert.throws(() => validateUpdates(next.history), /来源/u);
  const invalid = structuredClone(one.state);
  invalid.records[0].snapshot.event.sources[0].url =
    "https://example.org/\r\nATTACH:bad";
  assert.throws(() => validateFeedState(invalid), /快照/u);
});

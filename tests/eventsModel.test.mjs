import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  readEventAssets,
  validatePublishedEvents,
} from "../scripts/eventAssets.mjs";
import {
  validateEventDataset,
  filterEvents,
  getEventTemporalState,
  buildCalendarIcs,
} from "../src/events/model.ts";

// 以下均为测试专用活动，不能复制到正式数据。
const KNOWN_IDS = ["g001", "g002"];
const GENERATED_AT = new Date("2026-09-05T08:00:00Z");
function event(overrides = {}) {
  return {
    id: "e-test-1",
    title: "测试活动",
    date: "2026-09-05",
    province: "广东",
    city: "深圳",
    venue: "测试场地",
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
        publisher: "测试发布者",
        observedAt: "2026-09-01T10:00:00+08:00",
        kind: "official",
      },
    ],
    notes: "",
    poster: null,
    ...overrides,
  };
}
function dataset(events = [event()]) {
  return {
    schemaVersion: "idol-events-v1",
    updatedAt: GENERATED_AT.toISOString(),
    coverage: "partial",
    events,
  };
}
function rejected(value, path) {
  const result = validateEventDataset(value, KNOWN_IDS);
  assert.equal(result.valid, false);
  assert(
    result.errors.some((error) => error.path === path),
    JSON.stringify(result.errors),
  );
  assert(!("data" in result));
}
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, "");

test("正式活动通过完整主档、来源与本地素材维护合同，不限制首批数量", async () => {
  const { dataset: value } = await readEventAssets(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  assert.equal(value.coverage, "partial");
});

test("固定首批证据夹具保留五条微博来源与未知海报、开演口径", async () => {
  const master = JSON.parse(
    await readFile(
      new URL("../data/群体分布数据.json", import.meta.url),
      "utf8",
    ),
  );
  const value = JSON.parse(
    await readFile(
      new URL("fixtures/events-seed-20260905.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(master.groups.length, 399);
  const result = validateEventDataset(
    value,
    master.groups.map((group) => group.id),
  );
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(value.coverage, "partial");
  assert.equal(value.events.length, 5);
  for (const record of value.events) {
    assert(
      record.sources.every((source) =>
        /^https:\/\/weibo.com\/detail\/\d+$/.test(source.url),
      ),
    );
    assert.equal(record.poster, null);
    assert(!record.id.includes("test"));
  }
  assert.equal(
    value.events.find((record) => record.id === "e-weibo-5338755200452940")
      .startsAt,
    null,
  );
});

test("发布门允许合法新增记录、非微博来源和远程海报，拒绝测试标识与示例来源", async () => {
  const seed = JSON.parse(
    await readFile(
      new URL("fixtures/events-seed-20260905.json", import.meta.url),
      "utf8",
    ),
  );
  const master = JSON.parse(
    await readFile(
      new URL("../data/群体分布数据.json", import.meta.url),
      "utf8",
    ),
  );
  const known = master.groups.map((group) => group.id);
  const addition = {
    ...seed.events[0],
    id: "e-maintenance-addition",
    sources: [
      {
        ...seed.events[0].sources[0],
        url: "https://venue.org/announcement",
        kind: "venue",
      },
    ],
    poster: {
      src: "https://venue.org/poster.webp",
      alt: "内存回归海报",
      sourceUrl: "https://venue.org/announcement",
    },
  };
  const value = { ...seed, events: [...seed.events, addition] };
  assert.equal(validatePublishedEvents(value, known).events.length, 6);
  assert.throws(
    () =>
      validatePublishedEvents(
        { ...seed, events: [{ ...addition, id: "e-test-accidental" }] },
        known,
      ),
    /测试保留 ID/,
  );
  assert.throws(
    () =>
      validatePublishedEvents(
        {
          ...seed,
          events: [
            {
              ...addition,
              sources: [
                { ...addition.sources[0], url: "https://example.org/mock" },
              ],
            },
          ],
        },
        known,
      ),
    /示例来源/,
  );
});

test("合法数据和零活动有效，校验不修改输入", () => {
  for (const value of [dataset(), dataset([])]) {
    const before = globalThis.structuredClone(value);
    assert.equal(validateEventDataset(value, new Set(KNOWN_IDS)).valid, true);
    assert.deepEqual(value, before);
  }
  assert.equal(
    validateEventDataset(dataset([event({ performers: [] })]), KNOWN_IDS).valid,
    true,
  );
});

test("拒绝顶层无效版本、覆盖声明、额外字段和错误类型", () => {
  for (const value of [null, 7, "数据", []]) rejected(value, "$");
  rejected({ ...dataset(), schemaVersion: "v2" }, "$.schemaVersion");
  rejected({ ...dataset(), coverage: "complete" }, "$.coverage");
  rejected({ ...dataset(), rawCache: "私有字段" }, "$.rawCache");
  rejected({ ...dataset(), events: {} }, "$.events");
});

test("拒绝非法、重复活动 ID 与缺失必需字段", () => {
  for (const id of [
    "",
    "g001",
    "e-A",
    "e-x\r\nBEGIN:VEVENT",
    "e-" + "x".repeat(100),
  ])
    rejected(dataset([event({ id })]), "$.events[0].id");
  rejected(dataset([event(), event()]), "$.events[1].id");
  const value = event();
  delete value.venue;
  rejected(dataset([value]), "$.events[0].venue");
  rejected(
    dataset([event({ privateNote: "不应公开" })]),
    "$.events[0].privateNote",
  );
});

test("拒绝正则末尾换行和稀疏数组，避免校验绕过", () => {
  rejected(dataset([event({ id: "e-test\n" })]), "$.events[0].id");
  rejected(dataset([event({ startsAt: "19:00\n" })]), "$.events[0].startsAt");
  rejected(dataset([event({ city: "深圳\n" })]), "$.events[0].city");
  rejected(dataset(new Array(1)), "$.events[0]");
  rejected(
    dataset([event({ sources: new Array(1) })]),
    "$.events[0].sources[0]",
  );
  rejected(
    dataset([event({ performers: new Array(1) })]),
    "$.events[0].performers[0]",
  );
});

test("真实日期与时区校验不接受自动溢出、模糊时间或时区缺失", () => {
  for (const date of [
    "2026-02-29",
    "2026-04-31",
    "2026-9-5",
    "2026-09-00",
    "2026-13-01",
    "0000-01-01",
    "待定",
    null,
  ])
    rejected(dataset([event({ date })]), "$.events[0].date");
  assert.equal(
    validateEventDataset(dataset([event({ date: "2028-02-29" })]), KNOWN_IDS)
      .valid,
    true,
  );
  for (const updatedAt of [
    "2026-09-05",
    "2026-09-05T08:00:00",
    "2026-02-30T08:00:00Z",
    "2026-09-05T24:00:00Z",
    "2026-09-05T08:00:00+14:30",
  ])
    rejected({ ...dataset(), updatedAt }, "$.updatedAt");
  assert.equal(
    validateEventDataset(
      { ...dataset(), updatedAt: "2026-09-05T08:00:00.1234567+08:00" },
      KNOWN_IDS,
    ).valid,
    true,
  );
});

test("可空字段必须显式为 null，空白和超长文字被拒", () => {
  for (const field of [
    "province",
    "city",
    "venue",
    "address",
    "opensAt",
    "startsAt",
    "endsAt",
  ])
    rejected(dataset([event({ [field]: "" })]), `$.events[0].${field}`);
  for (const title of [" ", "字".repeat(161), 1])
    rejected(dataset([event({ title })]), "$.events[0].title");
  rejected(dataset([event({ province: "Guangdong" })]), "$.events[0].province");
  rejected(dataset([event({ notes: null })]), "$.events[0].notes");
  rejected(dataset([event({ startsAt: "24:00" })]), "$.events[0].startsAt");
  rejected(
    dataset([event({ opensAt: "20:00", startsAt: "19:00" })]),
    "$.events[0].opensAt",
  );
  rejected(
    dataset([event({ startsAt: "23:00", endsAt: "01:00" })]),
    "$.events[0].endsAt",
  );
  rejected(
    dataset([event({ startsAt: "19:00", endsAt: "19:00" })]),
    "$.events[0].endsAt",
  );
});

test("拒绝未知团体 ID、未知状态和不可追溯来源", () => {
  rejected(
    dataset([event({ performers: [{ groupId: "g999", name: "测试团" }] })]),
    "$.events[0].performers[0].groupId",
  );
  assert.equal(
    validateEventDataset(
      dataset([event({ performers: [{ groupId: null, name: "未绑定团" }] })]),
      KNOWN_IDS,
    ).valid,
    true,
  );
  for (const status of ["held", "toString", null])
    rejected(dataset([event({ status })]), "$.events[0].status");
  for (const sources of [[], null, [{}]])
    rejected(
      dataset([event({ sources })]),
      sources?.length ? "$.events[0].sources[0].url" : "$.events[0].sources",
    );
  for (const field of ["label", "publisher", "observedAt", "kind"]) {
    const value = event();
    value.sources[0][field] = "";
    rejected(dataset([value]), `$.events[0].sources[0].${field}`);
  }
});

test("来源 URL 禁止危险协议、凭据、CRLF、反斜杠与畸形地址", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//example.org",
    "/page",
    "https://",
    "https://user:pass@example.org/",
    "https://example.org/\r\nBEGIN:VEVENT",
    "https://example.org/%0aX",
    "https://example.org\\evil",
    " https://example.org/",
  ]) {
    const value = event();
    value.sources[0].url = url;
    rejected(dataset([value]), "$.events[0].sources[0].url");
    assert.throws(() => buildCalendarIcs([value], GENERATED_AT), TypeError);
  }
});

test("海报路径与来源分别校验，拒绝路径穿越和脚本素材", () => {
  const poster = {
    src: "assets/event-posters/event-1.webp",
    alt: "活动海报",
    sourceUrl: "https://example.org/poster",
  };
  assert.equal(
    validateEventDataset(dataset([event({ poster })]), KNOWN_IDS).valid,
    true,
  );
  for (const src of [
    "../private/file.png",
    "assets/../private.png",
    "assets/%2e%2e/x.png",
    "assets/poster.svg",
    "assets/posters/event-1.webp",
    "assets/other/event-1.png",
    "assets/event-posters/nested/event.png",
    "assets/event-posters/event.svg",
    "assets/event-posters/event.gif",
    "assets/event-posters/Event.PNG",
    "assets/event-posters/event.png\n",
    "javascript:alert(1)",
  ])
    rejected(
      dataset([event({ poster: { ...poster, src } })]),
      "$.events[0].poster.src",
    );
  rejected(
    dataset([event({ poster: { ...poster, sourceUrl: "file:///x" } })]),
    "$.events[0].poster.sourceUrl",
  );
  rejected(
    dataset([event({ poster: { ...poster, alt: "" } })]),
    "$.events[0].poster.alt",
  );
});

const regions = [
  event({ id: "e-sz", city: "深圳", title: "ＡＢＣ 摇滚" }),
  event({
    id: "e-gz",
    city: "广州",
    date: "2026-09-06",
    performers: [{ groupId: "g002", name: "另一团" }],
  }),
  event({ id: "e-gl", province: "广西", city: "桂林", status: "cancelled" }),
  event({ id: "e-nn", province: "广西", city: "南宁", date: "2026-09-07" }),
  event({ id: "e-unknown", province: null, city: null, status: "postponed" }),
];
const ids = (records) => records.map((record) => record.id);

test("广东＋广西、深圳＋桂林、广东＋桂林按省市并集筛选", () => {
  assert.deepEqual(ids(filterEvents(regions, { province: ["广东", "广西"] })), [
    "e-sz",
    "e-gz",
    "e-gl",
    "e-nn",
  ]);
  assert.deepEqual(ids(filterEvents(regions, { city: ["深圳", "桂林"] })), [
    "e-sz",
    "e-gl",
  ]);
  assert.deepEqual(
    ids(filterEvents(regions, { province: ["广东"], city: ["桂林"] })),
    ["e-sz", "e-gz", "e-gl"],
  );
  assert.deepEqual(
    ids(
      filterEvents(regions, {
        province: ["广东"],
        city: ["深圳", "桂林", "桂林"],
      }),
    ),
    ["e-sz", "e-gz", "e-gl"],
  );
});

test("地区再与日期、团体、文本求交，日期边界包含两端", () => {
  assert.deepEqual(
    ids(
      filterEvents(regions, {
        province: ["广东"],
        city: ["桂林"],
        from: "2026-09-05",
        to: "2026-09-05",
        group: "g001",
        q: "abc 摇滚",
      }),
    ),
    ["e-sz"],
  );
  assert.deepEqual(
    ids(
      filterEvents(regions, {
        from: "2026-09-06",
        to: "2026-09-07",
        q: "测试场地",
      }),
    ),
    ["e-gz", "e-nn"],
  );
  assert.deepEqual(ids(filterEvents(regions, { q: "另一团" })), ["e-gz"]);
  assert.deepEqual(filterEvents(regions, { group: "g999" }), []);
  assert.deepEqual(filterEvents(regions, { from: "2026-02-30" }), []);
  assert.deepEqual(
    filterEvents(regions, { from: "2026-09-07", to: "2026-09-05" }),
    [],
  );
});

test("重置、空数据和零结果保留语义；筛选不修改或重复原记录", () => {
  const before = globalThis.structuredClone(regions);
  const all = filterEvents(regions, { q: " ", province: [], city: [] });
  assert.deepEqual(all, regions);
  assert.notEqual(all, regions);
  assert.deepEqual(filterEvents([], {}), []);
  assert.deepEqual(filterEvents(regions, { q: "不存在的关键字" }), []);
  assert.deepEqual(regions, before);
});

test("UTC+8 午夜分界、年界与取消/延期的时间状态独立", () => {
  assert.equal(
    getEventTemporalState(event(), new Date("2026-09-04T15:59:59.999Z")),
    "upcoming",
  );
  assert.equal(
    getEventTemporalState(event(), new Date("2026-09-04T16:00:00Z")),
    "today",
  );
  assert.equal(
    getEventTemporalState(
      event({ status: "cancelled" }),
      new Date("2026-09-05T16:00:00Z"),
    ),
    "past",
  );
  assert.equal(
    getEventTemporalState(event({ status: "postponed" }), GENERATED_AT),
    "today",
  );
  assert.equal(
    getEventTemporalState(
      { date: "2027-01-01" },
      new Date("2026-12-31T16:00:00Z"),
    ),
    "today",
  );
  assert.throws(
    () => getEventTemporalState({ date: "2026-02-30" }, GENERATED_AT),
    RangeError,
  );
  assert.throws(
    () => getEventTemporalState(event(), new Date("invalid")),
    RangeError,
  );
});

test("系统时区变化不改变日期判定或 ICS UTC 时刻", () => {
  const moduleUrl = new URL("../src/events/model.ts", import.meta.url).href;
  const record = event({ startsAt: "00:30" });
  const code = `import { getEventTemporalState, buildCalendarIcs } from ${JSON.stringify(moduleUrl)}; const e = ${JSON.stringify(record)}; console.log(getEventTemporalState(e, new Date('2026-09-04T16:00:00Z'))); console.log(buildCalendarIcs([e], new Date('2026-09-05T08:00:00Z')));`;
  const outputs = ["UTC", "America/Los_Angeles", "Asia/Shanghai"].map((TZ) => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", code],
      { encoding: "utf8", env: { ...process.env, TZ } },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[1], outputs[2]);
  assert.match(outputs[0], /DTSTART:20260904T163000Z/);
});

test("无确认开演时间按全天导出，跨月跨年结束日为次日", () => {
  for (const [date, next] of [
    ["2026-09-30", "20261001"],
    ["2026-12-31", "20270101"],
    ["2028-02-29", "20280301"],
  ]) {
    const ics = unfold(
      buildCalendarIcs(
        [event({ date, opensAt: "18:00", endsAt: "23:00" })],
        GENERATED_AT,
      ),
    );
    assert(ics.includes(`DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`));
    assert(ics.includes(`DTEND;VALUE=DATE:${next}`));
    assert(!ics.includes("DTSTART:"));
  }
});

test("定时导出正确转换 UTC+8，未知结束不补造时长", () => {
  const timed = buildCalendarIcs(
    [event({ opensAt: "18:45", startsAt: "19:00", endsAt: "21:30" })],
    GENERATED_AT,
  );
  assert.match(timed, /DTSTART:20260905T110000Z\r\n/);
  assert.match(timed, /DTEND:20260905T133000Z\r\n/);
  assert.match(timed, /DTSTAMP:20260905T080000Z\r\n/);
  assert(
    !buildCalendarIcs([event({ startsAt: "19:00" })], GENERATED_AT).includes(
      "DTEND",
    ),
  );
});

test("取消、延期及未确认在日历状态、摘要与正文中明确标记", () => {
  for (const [status, expected, label] of [
    ["cancelled", "CANCELLED", "已取消"],
    ["postponed", "TENTATIVE", "已延期"],
    ["unconfirmed", "TENTATIVE", "安排待确认"],
  ]) {
    const ics = unfold(buildCalendarIcs([event({ status })], GENERATED_AT));
    assert(ics.includes(`STATUS:${expected}\r\n`));
    assert(ics.includes(`SUMMARY:【${label}`));
    assert(ics.includes(`DESCRIPTION:状态：${label}`));
  }
});

test("ICS 正确转义 CRLF、分号、逗号、反斜杠，不能注入组件", () => {
  const attack =
    "文字,分号;反斜杠\\\r\nBEGIN:VEVENT\nATTENDEE:mailto:test@example.org\rEND:VEVENT";
  const record = event({
    title: attack,
    notes: attack,
    venue: attack,
    performers: [{ groupId: "g001", name: attack }],
  });
  record.sources[0].publisher = attack;
  const ics = buildCalendarIcs([record], GENERATED_AT);
  const logical = unfold(ics);
  assert.equal(
    logical.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length,
    1,
  );
  assert.equal(
    logical.split("\r\n").filter((line) => line.startsWith("ATTENDEE:")).length,
    0,
  );
  assert(
    logical.includes("文字\\,分号\\;反斜杠\\\\\\nBEGIN:VEVENT\\nATTENDEE:"),
  );
  assert(!ics.replaceAll("\r\n", "").match(/[\r\n]/));
});

test("中文和 emoji 折行按 UTF-8 字节计数，展开后保持全文", () => {
  const title = "中国偶像🎸".repeat(26);
  const ics = buildCalendarIcs(
    [event({ title, notes: "长备注🙂".repeat(700) })],
    GENERATED_AT,
  );
  for (const line of ics.split("\r\n"))
    assert(Buffer.byteLength(line, "utf8") <= 75, line);
  assert(unfold(ics).includes(`SUMMARY:${title}\r\n`));
  assert(!ics.includes("\uFFFD"));
});

test("稳定 UID、确定输出、重复 UID 拒绝和空日历导出", () => {
  const a = buildCalendarIcs([event()], GENERATED_AT);
  assert.equal(a, buildCalendarIcs([event()], GENERATED_AT));
  assert.match(a, /UID:e-test-1@idol-events.local\r\n/);
  assert.match(
    buildCalendarIcs(
      [event({ title: "已改名", date: "2026-10-01" })],
      GENERATED_AT,
    ),
    /UID:e-test-1@idol-events.local/,
  );
  assert.throws(
    () => buildCalendarIcs([event(), event()], GENERATED_AT),
    TypeError,
  );
  assert.throws(
    () => buildCalendarIcs([event()], new Date("invalid")),
    RangeError,
  );
  assert.throws(
    () => buildCalendarIcs([event({ date: "2026-02-30" })], GENERATED_AT),
    TypeError,
  );
  const empty = buildCalendarIcs([], GENERATED_AT);
  assert(empty.startsWith("BEGIN:VCALENDAR\r\n"));
  assert(empty.endsWith("END:VCALENDAR\r\n"));
  assert(!empty.includes("BEGIN:VEVENT"));
});

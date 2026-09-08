import assert from "node:assert/strict";
import { build } from "esbuild";
import test from "node:test";
import { fileURLToPath } from "node:url";

const output = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/events/navigation.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const nav = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);
const now = new Date("2026-09-08T04:00:00Z");
const options = {
  groupIds: new Set(["g001"]),
  provinces: new Set(["广东省", "北京市"]),
  cities: new Set(["深圳市", "北京市"]),
};
const fixture = (id, date, extra = {}) => ({
  id: `e-fixture-${id}`,
  date,
  title: "测试活动",
  province: "广东省",
  city: "深圳市",
  venue: null,
  startsAt: null,
  performers: [{ groupId: "g001", name: "测试团" }],
  status: "scheduled",
  notes: "",
  ...extra,
});
const events = [
  fixture("past", "2026-09-07"),
  fixture("today", "2026-09-08", { status: "cancelled" }),
  fixture("future", "2026-09-09", {
    status: "postponed",
    province: null,
    city: null,
  }),
];
const ids = (filters, time = now) =>
  nav
    .selectPageEvents(events, { ...nav.emptyFilters(), ...filters }, time)
    .map((event) => event.id);

test("默认近期包含今天，历史与取消延期互相独立", () => {
  assert.deepEqual(ids({}), ["e-fixture-today", "e-fixture-future"]);
  assert.deepEqual(ids({ period: "past" }), ["e-fixture-past"]);
  assert.equal(ids({ period: "all" }).length, 3);
  assert.deepEqual(ids({}, new Date("2026-09-08T16:00:00Z")), [
    "e-fixture-future",
  ]);
});

test("一期显式日期保持历史可达，明确 period 则与日期求交", () => {
  const parsed = nav.parseFilters(
    "?from=2026-09-01&to=2026-09-07&group=g001",
    options,
  );
  assert.equal(parsed.filters.period, "all");
  assert.deepEqual(ids(parsed.filters), ["e-fixture-past"]);
  assert.deepEqual(ids({ ...parsed.filters, period: "upcoming" }), []);
  assert.deepEqual(ids({ period: "past", from: "2026-09-08" }), []);
});

test("非法及重复时间模式回退，控制字符与倒置日期被拒绝", () => {
  for (const search of [
    "?period=future",
    "?period=all&period=past",
    "?period=all%0a",
    "?from=2026-09-09&to=2026-09-01",
  ]) {
    const parsed = nav.parseFilters(search, options);
    assert.equal(parsed.ignored, true);
    assert.deepEqual(parsed.filters, nav.emptyFilters());
  }
});

test("所有时间模式与显式日期序列化往返不会暗改语义", () => {
  for (const period of ["upcoming", "past", "all"]) {
    for (const from of ["", "2026-09-01"]) {
      const filters = { ...nav.emptyFilters(), period, from, city: ["深圳市"] };
      assert.deepEqual(
        nav.parseFilters(nav.serializeFilters(filters), options).filters,
        filters,
      );
    }
  }
  assert.equal(nav.serializeFilters(nav.emptyFilters()), "");
});

test("本周末按中国周一至周日计算，周日仍含周六并覆盖跨年", () => {
  assert.deepEqual(nav.weekendDates(now), {
    from: "2026-09-12",
    to: "2026-09-13",
  });
  assert.deepEqual(nav.weekendDates(new Date("2026-09-13T12:00:00Z")), {
    from: "2026-09-12",
    to: "2026-09-13",
  });
  assert.deepEqual(nav.weekendDates(new Date("2026-12-31T12:00:00Z")), {
    from: "2027-01-02",
    to: "2027-01-03",
  });
  assert.deepEqual(nav.weekendDates(new Date("2026-09-13T16:00:00Z")), {
    from: "2026-09-19",
    to: "2026-09-20",
  });
});

test("城市常见后缀合并且未知地区不混入具体城市", () => {
  assert.deepEqual(
    nav.parseFilters("?city=深圳&province=北京", options).filters.city,
    ["深圳市"],
  );
  assert.deepEqual(
    nav.parseFilters("?city=深圳&province=北京", options).filters.province,
    ["北京市"],
  );
  assert.deepEqual(ids({ city: ["深圳"] }), ["e-fixture-today"]);
  assert.deepEqual(ids({ city: ["不存在"] }), []);
  const mixed = [
    ...events,
    fixture("beijing", "2026-09-08", { province: "北京", city: "北京" }),
  ];
  assert.deepEqual(
    nav
      .selectPageEvents(mixed, { ...nav.emptyFilters(), city: ["北京市"] }, now)
      .map((e) => e.id),
    ["e-fixture-beijing"],
  );
  assert.equal(
    nav.selectPageEvents(
      mixed,
      { ...nav.emptyFilters(), province: ["广东"], city: ["北京市"] },
      now,
    ).length,
    2,
  );
});

test("历史 hash 与冲突筛选仍可到达真实活动，并明确提示调整", () => {
  for (const search of [
    "",
    "?q=不匹配",
    "?from=2026-09-08",
    "?period=past&city=北京",
  ]) {
    const result = nav.resolveEventLocation(
      search,
      "#e-fixture-past",
      options,
      events,
      now,
    );
    assert.equal(result.anchor.id, "e-fixture-past");
    assert.equal(result.adjusted, true);
    assert.deepEqual(result.filters, { ...nav.emptyFilters(), period: "all" });
    assert.equal(result.invalidAnchor, false);
  }
  const visible = nav.resolveEventLocation(
    "",
    "#e-fixture-today",
    options,
    events,
    now,
  );
  assert.equal(visible.adjusted, false);
  assert.equal(visible.filters.period, "upcoming");
});

test("未知和恶意 hash 不能构造活动，普通页内锚点不误报", () => {
  for (const hash of [
    "#e-no-such-event",
    "#e-fixture-past%22",
    "#%E0%A4%A",
    "#" + "x".repeat(257),
  ]) {
    const result = nav.resolveEventLocation("", hash, options, events, now);
    assert.equal(result.anchor, null);
    assert.equal(result.invalidAnchor, true);
    assert.equal(result.adjusted, false);
  }
  assert.equal(
    nav.resolveEventLocation("", "#events-heading", options, events, now)
      .invalidAnchor,
    false,
  );
  assert.equal(
    nav.resolveEventLocation("", "#%65-fixture-past", options, events, now)
      .anchor.id,
    "e-fixture-past",
  );
});

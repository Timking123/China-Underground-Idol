import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(
  new URL("../src/discover/model.ts", import.meta.url),
  "utf8",
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const {
  discoveryDate,
  discoveryGroups,
  discoveryEvents,
  discoveryCities,
  cityUrl,
  groupUrl,
  eventUrl,
} = await import(moduleUrl);
const group = (id, patch = {}) => ({
  id,
  name: id,
  isActive: true,
  activity: { province: null, city: null },
  founding: { province: "广东", city: "深圳" },
  ...patch,
});
const event = (id, date, patch = {}) => ({
  id,
  date,
  startsAt: null,
  city: null,
  status: "scheduled",
  ...patch,
});
const now = new Date("2026-09-08T12:00:00Z");
const normalize = (value) => value.replace(/市$/u, "");

test("近期按 UTC+8 跨日，不依赖宿主时区", () => {
  assert.equal(discoveryDate(new Date("2026-09-07T15:59:59Z")), "2026-09-07");
  assert.equal(discoveryDate(new Date("2026-09-07T16:00:00Z")), "2026-09-08");
  assert.equal(discoveryDate(new Date("2026-09-08T16:00:00Z")), "2026-09-09");
  assert.throws(() => discoveryDate(new Date("bad-date")), RangeError);
});

test("近期不会借用历史活动，取消延期与日期维度分别保留", () => {
  const records = [
    event("e-past", "2026-09-07"),
    event("e-today", "2026-09-08", { status: "cancelled" }),
    event("e-future", "2026-09-13", { status: "postponed" }),
  ];
  assert.deepEqual(
    discoveryEvents(records, now).map((item) => [item.id, item.status]),
    [
      ["e-today", "cancelled"],
      ["e-future", "postponed"],
    ],
  );
  assert.deepEqual(discoveryEvents([records[0]], now), []);
  assert.deepEqual(discoveryEvents([], now), []);
});

test("同日按已知时刻排列，未知时间最后，且不修改源记录", () => {
  const records = [
    event("e-null", "2026-09-09"),
    event("e-b", "2026-09-09", { startsAt: "19:00" }),
    event("e-a", "2026-09-09", { startsAt: "12:00" }),
    event("e-earlier", "2026-09-08"),
  ];
  const before = JSON.parse(JSON.stringify(records));
  assert.deepEqual(
    discoveryEvents(records, now, 10).map((item) => item.id),
    ["e-earlier", "e-a", "e-b", "e-null"],
  );
  assert.deepEqual(records, before);
  assert.equal(discoveryEvents(records, now, 2).length, 2);
  assert.deepEqual(discoveryEvents(records, now, 0), []);
});

test("选读团体保持档案顺序，不按图片或粉丝数排序", () => {
  const records = [
    group("g001", { visual: null, followers: null }),
    group("g002", { isActive: false }),
    group("g003", {
      visual: { src: "assets/a.jpg" },
      followers: { value: 999999 },
    }),
    ...Array.from({ length: 6 }, (_, i) =>
      group(`g${String(i + 4).padStart(3, "0")}`),
    ),
  ];
  assert.deepEqual(
    discoveryGroups(records).map((item) => item.id),
    ["g001", "g003", "g004", "g005", "g006", "g007"],
  );
  assert.equal(records.length, 9);
  assert.deepEqual(discoveryGroups([group("g010", { isActive: false })]), []);
  assert.deepEqual(discoveryGroups(records, 0), []);
});

test("已知主要活动城市与活动城市并集，不把建团地或场馆名当活动地", () => {
  const groups = [
    group("g001"),
    group("g002", { activity: { city: "上海市", province: "上海" } }),
    group("g003", {
      isActive: false,
      activity: { city: "北京", province: "北京" },
    }),
  ];
  const events = [
    event("e-unknown", "2026-09-13", { venue: "深圳演出空间" }),
    event("e-known", "2026-09-15", { city: "上海" }),
    event("e-history", "2026-09-07", { city: "广州" }),
  ];
  const cities = discoveryCities(groups, events, now, normalize);
  assert.deepEqual(
    new Set(cities.map((city) => city.name)),
    new Set(["上海", "广州"]),
  );
  assert.deepEqual(
    cities.find((city) => city.name === "上海"),
    { name: "上海", groupCount: 1, upcomingCount: 1, pastCount: 0 },
  );
  assert.deepEqual(
    cities.find((city) => city.name === "广州"),
    { name: "广州", groupCount: 0, upcomingCount: 0, pastCount: 1 },
  );
});

test("缺失城市不会生成虚构入口，空资料保持空列表", () => {
  assert.deepEqual(
    discoveryCities(
      [group("g001")],
      [event("e-unknown", "2026-09-13")],
      now,
      normalize,
    ),
    [],
  );
  assert.deepEqual(discoveryCities([], [], now, normalize), []);
});

test("城市入口按其真实可用内容进入团体、近期或历史页", () => {
  assert.equal(
    cityUrl({ name: "上海", groupCount: 1, upcomingCount: 0, pastCount: 0 }),
    "groups.html?regionRole=activity&city=%E4%B8%8A%E6%B5%B7",
  );
  assert.equal(
    cityUrl({ name: "上海", groupCount: 0, upcomingCount: 1, pastCount: 0 }),
    "events.html?period=upcoming&city=%E4%B8%8A%E6%B5%B7",
  );
  assert.equal(
    cityUrl({ name: "上海", groupCount: 0, upcomingCount: 0, pastCount: 1 }),
    "events.html?period=past&city=%E4%B8%8A%E6%B5%B7",
  );
});

test("团体与活动使用稳定公开标识，跨日详情链接仍包含历史范围", () => {
  assert.equal(groupUrl("g001"), "group.html?group=g001");
  assert.equal(
    eventUrl({ id: "e-official-123" }),
    "events.html?period=all#e-official-123",
  );
  assert.equal(
    new URLSearchParams(groupUrl("g001&extra=1").split("?")[1]).get("group"),
    "g001&extra=1",
  );
});

test("发现页只接入轻量索引、模块脚本和普通相对导航", async () => {
  const html = await readFile(
    new URL("../discover.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /lang="zh-CN"/u);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(scripts, ["assets/groups-data.js", "assets/discover.js"]);
  for (const path of ["groups.html", "events.html", "index.html", "guide.html"])
    assert.ok(html.includes(`href="${path}"`));
  assert.match(html, /action="groups.html"\s+method="get"/u);
  assert.match(html, /page=discover&amp;kind=event/u);
  assert.match(html, /href="#discover-cities-heading"/u);
});

test("错误状态和图像回退在页面层显式处理，正文不经过 HTML 插入", async () => {
  const page = await readFile(
    new URL("../src/discover/page.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    page,
    /innerHTML|insertAdjacentHTML|fetch\(|XMLHttpRequest/u,
  );
  assert.match(page, /validateEventDataset/u);
  assert.match(page, /暂时无法读取/u);
  assert.match(page, /尚未收录近期活动/u);
  assert.match(page, /addEventListener\("error"/u);
  assert.match(page, /资料图不代表当前完整阵容/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  citySelection,
  cityGroups,
  cityVenues,
  cityPeriod,
} from "../src/city/model.ts";
import { followedEvents } from "../src/favorites/model.ts";
const normalize = (value) => value.replace(/市$/u, "");
const event = (id, patch = {}) => ({
  id,
  date: "2026-09-19",
  city: "深圳市",
  startsAt: null,
  performers: [],
  sources: [],
  ...patch,
});
test("城市周末深链独立可访问，重复及未知范围安全回退", () => {
  assert.equal(cityPeriod("?city=深圳&period=weekend"), "weekend");
  for (const search of [
    "",
    "?period=unknown",
    "?period=weekend&period=upcoming",
  ])
    assert.equal(cityPeriod(search), "upcoming");
});
test("城市深链只接受唯一已知规范城市，不从建团地推断活动地", () => {
  assert.equal(citySelection("?city=深圳市", ["深圳"], normalize), "深圳");
  for (const query of [
    "",
    "?city=深圳&city=广州",
    "?city=<script>",
    "?city=未知",
  ])
    assert.equal(citySelection(query, ["深圳"], normalize), null);
  assert.deepEqual(
    cityGroups(
      [
        {
          id: "g1",
          isActive: true,
          activity: { city: null },
          founding: { city: "深圳" },
        },
        { id: "g2", isActive: false, activity: { city: "深圳" } },
        { id: "g3", isActive: true, activity: { city: "深圳市" } },
      ],
      "深圳",
      normalize,
    ).map((item) => item.id),
    ["g3"],
  );
});
test("相关活动按稳定团体 ID/城市/演出取并集，保留取消延期并跨日排除历史", () => {
  const preferences = {
    group: ["g1"],
    city: ["深圳"],
    event: ["e3"],
    activeCity: null,
    version: 1,
  };
  const rows = [
    event("e1", { date: "2026-09-18" }),
    event("e2", { status: "cancelled" }),
    event("e3", { city: null, status: "postponed" }),
    event("e4", { city: null, performers: [{ groupId: "g1", name: "未知" }] }),
    event("e5", { city: null, performers: [{ groupId: null, name: "g1" }] }),
  ];
  assert.deepEqual(
    followedEvents(rows, preferences, "2026-09-19", normalize).map(
      (item) => item.id,
    ),
    ["e2", "e3", "e4"],
  );
  assert.deepEqual(
    followedEvents(
      rows,
      { ...preferences, group: [], city: [], event: [] },
      "2026-09-19",
      normalize,
    ),
    [],
  );
});
test("可信场馆须同时有地址与合格来源，按最近记录去重但不猜测营业", () => {
  const venue = {
    venue: "现场",
    address: "测试路 1 号",
    sources: [{ kind: "venue" }],
  };
  const records = [
    event("old", { ...venue, date: "2020-01-01" }),
    event("new", venue),
    event("missing", { ...venue, address: null }),
    event("wiki", { ...venue, venue: "仅百科", sources: [{ kind: "wiki" }] }),
  ];
  assert.deepEqual(
    cityVenues(records).map((item) => item.event.id),
    ["new"],
  );
});

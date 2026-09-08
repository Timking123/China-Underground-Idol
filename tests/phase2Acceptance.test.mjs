import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { build } from "esbuild";
import { buildGroupCatalog } from "../scripts/groupCatalog.mjs";

// 独立验收使用公开合同和人工期望集合，不读取实现者的测试夹具。
const root = new URL("../", import.meta.url);
async function moduleAt(relative) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relative, root))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const catalog = await moduleAt("src/catalog/model.ts");
const runtime = await moduleAt("src/catalog/runtime.ts");
const eventModel = await moduleAt("src/events/model.ts");
const navigation = await moduleAt("src/events/navigation.ts");
const idsOf = (items) => items.map((item) => item.id).sort();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function group(id, patch = {}) {
  return {
    id,
    name: `独立验收团体${id}`,
    handle: `@${id}`,
    aliases: [],
    status: "确认存续",
    isActive: true,
    founding: { province: null, city: null },
    activity: { province: null, city: null },
    styleLabel: "风格暂未判定",
    styleState: "uncertain",
    styleNote: "仅为合成验收数据",
    tags: [],
    avatar: null,
    visual: null,
    officialUrl: null,
    wikiUrl: null,
    followers: null,
    sources: [],
    ...patch,
  };
}
const synthetic = {
  schemaVersion: "idol-catalog-v1",
  archiveDate: "2026-09-01",
  groups: [
    group("g901", {
      name: "白昼电波",
      aliases: ["Day Signal"],
      activity: { province: "北京市", city: "北京市" },
      founding: { province: "浙江省", city: "杭州市" },
      styleLabel: "摇滚",
      styleState: "editorial",
    }),
    group("g902", {
      name: "白昼梦",
      activity: { province: "浙江省", city: "杭州市" },
      founding: { province: "北京市", city: "北京市" },
      styleLabel: "摇滚",
      styleState: "editorial",
    }),
    group("g903", {
      name: "白昼旧梦",
      isActive: false,
      status: "已解散",
      activity: { province: "浙江省", city: "宁波市" },
      styleLabel: "摇滚",
      styleState: "editorial",
    }),
    group("g904", {
      name: "白昼未明",
      styleLabel: "摇滚",
      styleState: "editorial",
    }),
    group("g905", { activity: { province: "河北省", city: "保定市" } }),
  ],
};

test("A05 地区并集与文本、存续、风格交集有独立期望值", () => {
  assert.equal(catalog.validateCatalog(synthetic).valid, true);
  const filters = {
    ...catalog.defaultCatalogFilters(),
    q: "白昼",
    province: ["浙江"],
    city: ["北京"],
    style: "摇滚",
  };
  assert.deepEqual(
    idsOf(catalog.filterCatalogGroups(synthetic.groups, filters)),
    ["g901", "g902"],
  );
  assert.deepEqual(
    idsOf(
      catalog.filterCatalogGroups(synthetic.groups, {
        ...filters,
        status: "all",
      }),
    ),
    ["g901", "g902", "g903"],
  );
  assert.deepEqual(
    idsOf(
      catalog.filterCatalogGroups(synthetic.groups, {
        ...filters,
        province: [],
        city: ["北京"],
        regionRole: "founding",
      }),
    ),
    ["g902"],
  );
  assert.deepEqual(
    idsOf(
      catalog.filterCatalogGroups(synthetic.groups, {
        ...filters,
        province: [],
        city: [],
      }),
    ),
    ["g901", "g902", "g904"],
  );
  assert.deepEqual(
    idsOf(
      catalog.filterCatalogGroups(synthetic.groups, {
        ...catalog.defaultCatalogFilters(),
        q: "day signal",
      }),
    ),
    ["g901"],
  );
  assert.notEqual(
    catalog.normalizeRegionName("北京"),
    catalog.normalizeRegionName("保定市"),
  );
});

test("A04 查询往返保留筛选语义，重复单值和超长输入被明确忽略", () => {
  const first = catalog.parseCatalogFilters(
    "?q=白昼&status=all&province=浙江&city=北京&style=摇滚",
    synthetic,
  );
  assert.equal(first.ignored, false);
  const second = catalog.parseCatalogFilters(
    catalog.serializeCatalogFilters(first.filters),
    synthetic,
  );
  assert.equal(second.ignored, false);
  assert.deepEqual(
    idsOf(catalog.filterCatalogGroups(synthetic.groups, second.filters)),
    ["g901", "g902", "g903"],
  );
  assert.equal(
    catalog.serializeCatalogFilters(second.filters),
    catalog.serializeCatalogFilters(first.filters),
  );
  for (const search of [
    "?status=all&status=active",
    "?regionRole=founding&regionRole=activity",
    "?q=a&q=b",
    "?city=不存在",
    "?q=%00",
    "?q=%ZZ",
    `?q=${"x".repeat(5000)}`,
  ]) {
    assert.equal(
      catalog.parseCatalogFilters(search, synthetic).ignored,
      true,
      search.slice(0, 90),
    );
  }
});

test("A04 历史档案可达；未知、重复与恶意团体深链失败降级", () => {
  assert.equal(
    catalog.parseCatalogGroupLink("?group=g903", synthetic.groups).group.id,
    "g903",
  );
  assert.equal(
    catalog.parseCatalogGroupLink("", synthetic.groups).state,
    "none",
  );
  for (const search of [
    "?group=g999",
    "?group=g903&group=g903",
    "?group=g901&group=g903",
    "?group=g903%00",
    "?group=%3Cscript%3E",
    "?group=%ZZ",
    `?group=${"g".repeat(9000)}`,
  ]) {
    assert.equal(
      catalog.parseCatalogGroupLink(search, synthetic.groups).state,
      "invalid",
      search.slice(0, 90),
    );
  }
});

test("A08/A11 索引逐层拒绝未知字段、类型漂移及危险 URL/资源路径", () => {
  const mutations = [
    (data) => {
      data.receipt = {};
    },
    (data) => {
      data.groups[0].uid = "123456";
    },
    (data) => {
      data.groups[0].activity.rawResponse = {};
    },
    (data) => {
      data.groups[0].isActive = "true";
    },
    (data) => {
      data.groups.push(globalThis.structuredClone(data.groups[0]));
    },
    (data) => {
      data.groups[0].officialUrl = "javascript:alert(1)";
    },
    (data) => {
      data.groups[0].officialUrl = "https://user:secret@example.org/";
    },
    (data) => {
      data.groups[0].officialUrl = "https://example.org/%0d%0aInjected";
    },
    (data) => {
      data.groups[0].sources = [
        {
          label: "来源",
          url: "https://example.org",
          observedAt: "2026-02-30",
          note: "",
        },
      ];
    },
    (data) => {
      data.groups[0].avatar = {
        src: "assets/avatars/../private.png",
        alt: "图",
        label: "资料",
        sourceUrl: null,
      };
    },
    (data) => {
      data.groups[0].avatar = {
        src: "//example.org/a.png",
        alt: "图",
        label: "资料",
        sourceUrl: null,
      };
    },
    (data) => {
      data.groups[0].avatar = {
        src: "data:image/svg+xml,<svg></svg>",
        alt: "图",
        label: "资料",
        sourceUrl: null,
      };
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = globalThis.structuredClone(synthetic);
    mutate(input);
    const result = catalog.validateCatalog(input);
    assert.equal(result.valid, false, `边界反例 ${index + 1}`);
    assert.ok(result.errors.length > 0);
  }
  const publicLink = globalThis.structuredClone(synthetic);
  publicLink.groups[0].officialUrl = "https://weibo.com/u/1234567890";
  assert.equal(
    catalog.validateCatalog(publicLink).valid,
    true,
    "公开官号 URL 中的标识不是独立 UID 泄漏",
  );
});

test("A08 运行时缺索引与合法零条索引状态不同", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    });
    const missing = runtime.readCatalog();
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.length > 0);
    globalThis.window.IDOL_GROUPS_DATA = {
      schemaVersion: "idol-catalog-v1",
      archiveDate: "2026-09-01",
      groups: [],
    };
    const empty = runtime.readCatalog();
    assert.equal(empty.valid, true);
    assert.deepEqual(empty.data.groups, []);
    globalThis.window.IDOL_GROUPS_DATA = { groups: [] };
    assert.equal(runtime.readCatalog().valid, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});

test("A01/A02/A03 实际399条索引确定性、身份说明与既有事实完整保留", async () => {
  const sourceBytes = await readFile(new URL("data.js", root));
  const context = { window: {} };
  vm.runInNewContext(sourceBytes.toString("utf8"), context, { timeout: 5000 });
  const original = JSON.parse(JSON.stringify(context.window.IDOL_MAP_DATA));
  const first = await buildGroupCatalog(fileURLToPath(root));
  const second = await buildGroupCatalog(fileURLToPath(root));
  assert.equal(catalog.validateCatalog(first).valid, true);
  assert.equal(first.groups.length, 399);
  assert.deepEqual(idsOf(first.groups), idsOf(original.groups));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(
    digest(await readFile(new URL("data.js", root))),
    digest(sourceBytes),
  );
  assert.equal(first.archiveDate, original.meta.archiveCutoffDate);
  for (const source of original.groups) {
    const output = first.groups.find((item) => item.id === source.id);
    assert.equal(output.isActive, source.isActive, source.id);
    assert.equal(output.status, source.status, source.id);
    for (const role of ["founding", "activity"]) {
      assert.deepEqual(
        output[role],
        {
          province: source.regionPlacement?.[role]?.province ?? null,
          city: source.regionPlacement?.[role]?.city ?? null,
        },
        `${source.id} ${role}`,
      );
    }
    if (source.publicReview?.summary)
      assert.ok(
        output.sources.some((item) =>
          item.note.includes(source.publicReview.summary),
        ),
        `${source.id} 必须保留完整身份复核说明`,
      );
    if (source.followersValue != null) {
      assert.equal(output.followers.value, source.followersValue, source.id);
      assert.equal(
        output.followers.observedAt,
        source.profileObservedAt ?? null,
        source.id,
      );
    }
  }
  const agency = first.groups.find((item) => item.id === "g060");
  assert.ok(
    catalog
      .filterCatalogGroups(first.groups, {
        ...catalog.defaultCatalogFilters(),
        q: "neokoro",
      })
      .some((item) => item.id === "g060"),
  );
  assert.match(agency.followers.display, /事务所/u);
  assert.match(agency.visual.label, /品牌|非成员/u);
  const historical = first.groups.find((item) => item.id === "g303");
  assert.equal(historical.isActive, false);
  assert.equal(first.groups.find((item) => item.id === "g123").isActive, true);
  assert.equal(
    catalog.parseCatalogGroupLink("?group=g303", first.groups).state,
    "valid",
  );
});

function event(id, date, patch = {}) {
  return {
    id,
    title: `独立验收活动 ${id}`,
    date,
    province: null,
    city: null,
    venue: null,
    address: null,
    opensAt: null,
    startsAt: null,
    endsAt: null,
    status: "scheduled",
    performers: [{ groupId: "g901", name: "白昼电波" }],
    sources: [
      {
        url: "https://example.org/official-show",
        label: "合成来源",
        publisher: "合成主办",
        observedAt: "2026-09-01T00:00:00Z",
        kind: "organizer",
      },
    ],
    notes: "仅为合成验收数据",
    poster: null,
    ...patch,
  };
}
const eventFixtures = [
  event("e-before", "2026-09-07", { status: "cancelled" }),
  event("e-today", "2026-09-08", { province: "北京市", city: "北京市" }),
  event("e-later", "2026-09-09", {
    status: "postponed",
    province: "浙江省",
    city: "杭州市",
  }),
];
const options = {
  groupIds: new Set(["g901"]),
  provinces: new Set(["北京市", "浙江省"]),
  cities: new Set(["北京市", "杭州市"]),
};
const now = new Date("2026-09-08T04:00:00Z");

test("A06 UTC+8 午夜、默认近期、旧日期和历史锚点独立验证", () => {
  assert.equal(
    eventModel.getEventTemporalState(
      { date: "2026-09-08" },
      new Date("2026-09-07T15:59:59.999Z"),
    ),
    "upcoming",
  );
  assert.equal(
    eventModel.getEventTemporalState(
      { date: "2026-09-08" },
      new Date("2026-09-07T16:00:00.000Z"),
    ),
    "today",
  );
  assert.equal(
    eventModel.getEventTemporalState(
      { date: "2026-09-08" },
      new Date("2026-09-08T16:00:00.000Z"),
    ),
    "past",
  );
  assert.deepEqual(
    idsOf(
      navigation.selectPageEvents(
        eventFixtures,
        navigation.parseFilters("", options).filters,
        now,
      ),
    ),
    ["e-later", "e-today"],
  );
  const old = navigation.parseFilters(
    "?from=2026-09-07&to=2026-09-07",
    options,
  );
  assert.equal(old.filters.period, "all");
  assert.deepEqual(
    idsOf(navigation.selectPageEvents(eventFixtures, old.filters, now)),
    ["e-before"],
  );
  const anchor = navigation.resolveEventLocation(
    "",
    "#e-before",
    options,
    eventFixtures,
    now,
  );
  assert.equal(anchor.anchor.id, "e-before");
  assert.equal(anchor.adjusted, true);
  assert.ok(
    navigation
      .selectPageEvents(eventFixtures, anchor.filters, now)
      .some((item) => item.id === "e-before"),
  );
  const invalid = navigation.resolveEventLocation(
    "",
    "#e-unknown",
    options,
    eventFixtures,
    now,
  );
  assert.equal(invalid.invalidAnchor, true);
  assert.equal(invalid.anchor, null);
  for (const search of [
    "?from=2026-02-30",
    "?from=2026-09-09&to=2026-09-01",
    "?period=past&period=all",
    "?group=g999",
  ])
    assert.equal(
      navigation.parseFilters(search, options).ignored,
      true,
      search,
    );
});

test("A05/A07 活动城市同名后缀、省市并集与状态独立于日期", () => {
  const parsed = navigation.parseFilters(
    "?period=all&province=浙江&city=北京",
    options,
  );
  assert.equal(parsed.ignored, false);
  assert.deepEqual(
    idsOf(navigation.selectPageEvents(eventFixtures, parsed.filters, now)),
    ["e-later", "e-today"],
  );
  assert.equal(eventModel.getEventTemporalState(eventFixtures[0], now), "past");
  assert.equal(eventFixtures[0].status, "cancelled");
  assert.equal(
    eventModel.getEventTemporalState(eventFixtures[2], now),
    "upcoming",
  );
  assert.equal(eventFixtures[2].status, "postponed");
  const roundtrip = navigation.parseFilters(
    navigation.serializeFilters(parsed.filters),
    options,
  );
  assert.deepEqual(
    idsOf(navigation.selectPageEvents(eventFixtures, roundtrip.filters, now)),
    ["e-later", "e-today"],
  );
});

test("A07 ICS 中文折行、唯一事件、取消延期、全天与精确时刻", () => {
  const entries = [
    event("e-ics-day", "2026-09-08", {
      status: "cancelled",
      title: "取消中文🎵".repeat(15),
      notes: "第一行\r\nBEGIN:VEVENT\r\nUID:injected",
    }),
    event("e-ics-time", "2026-09-09", {
      status: "postponed",
      startsAt: "19:30",
    }),
  ];
  const ics = eventModel.buildCalendarIcs(entries, now);
  const lines = ics.split("\r\n");
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 2);
  assert.equal(lines.filter((line) => line.startsWith("UID:")).length, 2);
  assert.equal(
    new Set(lines.filter((line) => line.startsWith("UID:"))).size,
    2,
  );
  assert.ok(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75));
  const unfolded = ics.replace(/\r\n[ \t]/gu, "");
  assert.ok(
    unfolded.includes(
      "DTSTART;VALUE=DATE:20260908\r\nDTEND;VALUE=DATE:20260909",
    ),
  );
  assert.ok(unfolded.includes("DTSTART:20260909T113000Z"));
  assert.ok(unfolded.includes("STATUS:CANCELLED"));
  assert.ok(unfolded.includes("STATUS:TENTATIVE"));
  assert.equal(
    lines.filter((line) => line.startsWith("DTEND")).length,
    1,
    "未知结束时刻不伪造时长",
  );
  assert.equal(
    eventModel.buildCalendarIcs([], now).includes("BEGIN:VEVENT"),
    false,
  );
  assert.throws(() =>
    eventModel.buildCalendarIcs([entries[0], entries[0]], now),
  );
  assert.throws(() =>
    eventModel.buildCalendarIcs(
      [event("e-inject\r\nUID:bad", "2026-09-08")],
      now,
    ),
  );
});

test("A13 当前真实活动与合法扩容保持开放合同", async () => {
  const actual = JSON.parse(
    await readFile(new URL("data/events.v1.json", root), "utf8"),
  );
  const currentCatalog = await buildGroupCatalog(fileURLToPath(root));
  const currentIds = currentCatalog.groups.map((item) => item.id);
  const validated = eventModel.validateEventDataset(actual, currentIds);
  assert.equal(validated.valid, true, JSON.stringify(validated.errors));
  const expanded = globalThis.structuredClone(actual);
  expanded.events.push(
    event("e-w7-growth-fixture", "2026-10-01", {
      performers: [{ groupId: currentIds[0], name: "合成演出阵容" }],
      poster: {
        src: "assets/event-posters/w7-synthetic.webp",
        alt: "已核验海报的合成占位",
        sourceUrl: "https://example.org/venue-show",
      },
    }),
  );
  const result = eventModel.validateEventDataset(expanded, currentIds);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.data.events.length, actual.events.length + 1);
});

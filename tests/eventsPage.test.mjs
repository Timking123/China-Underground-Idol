import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// 分工阶段允许只读引用其他工作树；集成后默认使用本仓库依赖和真实模型。
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  path.join(process.env.EVENT_TEST_TOOLS_ROOT || root, "package.json"),
);
const { build } = require("esbuild");
const dataRoot = process.env.EVENT_TEST_DATA_ROOT;
const plugins = dataRoot
  ? [
      {
        name: "read-only-event-contract",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/model$/ }, () => ({
            path: path.join(dataRoot, "src/events/model.ts"),
          }));
          builder.onResolve({ filter: /events\.v1\.json$/ }, () => ({
            path: path.join(dataRoot, "data/events.v1.json"),
          }));
        },
      },
    ]
  : [];
const output = await build({
  entryPoints: [path.join(root, "src/events/page.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins,
});
const page = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);
const options = {
  groupIds: new Set(["g001", "g002", "g303"]),
  provinces: new Set(["广东省", "广西壮族自治区"]),
  cities: new Set(["深圳市", "桂林市"]),
};
const fixture = (overrides) => ({
  id: "e-test-only-a",
  title: "测试夹具：夜间 LIVE",
  date: "2026-09-06",
  province: "广东省",
  city: "深圳市",
  venue: "测试场地",
  address: null,
  opensAt: null,
  startsAt: null,
  endsAt: null,
  status: "scheduled",
  performers: [{ groupId: "g001", name: "测试团体" }],
  sources: [
    {
      url: "https://example.org/test-only",
      label: "测试夹具",
      publisher: "测试",
      observedAt: "2026-09-05T00:00:00Z",
      kind: "official",
    },
  ],
  notes: "",
  poster: null,
  ...overrides,
});

test("URL 保留省市混选并去重，序列化可往返", () => {
  const parsed = page.parseFilters(
    "?province=广东省&city=桂林市&city=桂林市&group=g303&q=LIVE&from=2026-09-01&to=2026-09-30",
    options,
  );
  assert.equal(parsed.ignored, false);
  assert.deepEqual(parsed.filters.province, ["广东省"]);
  assert.deepEqual(parsed.filters.city, ["桂林市"]);
  assert.deepEqual(
    page.parseFilters(page.serializeFilters(parsed.filters), options).filters,
    parsed.filters,
  );
});

test("重复单值、未知团体、无效日期和倒置范围安全降级", () => {
  for (const query of [
    "?group=g001&group=g002",
    "?group=g999",
    "?from=2026-02-30",
    "?from=2026-09-09&to=2026-09-01",
    "?group=g001%0a",
    "?group=" + "g".repeat(200),
  ]) {
    const parsed = page.parseFilters(query, options);
    assert.equal(parsed.ignored, true);
    assert.deepEqual(parsed.filters, page.emptyFilters());
  }
  assert.equal(page.parseFilters("?group=g303", options).filters.group, "g303");
});

test("超长地址、超多地区、控制字符和未知参数均受限", () => {
  assert.deepEqual(page.parseFilters("?q=" + "x".repeat(9000), options), {
    filters: page.emptyFilters(),
    ignored: true,
  });
  assert.equal(
    page.parseFilters("?q=" + "x".repeat(121), options).filters.q,
    "",
  );
  assert.equal(page.parseFilters("?q=%0a", options).ignored, true);
  assert.equal(
    page.parseFilters("?province=未知&city=桂林市", options).filters.city[0],
    "桂林市",
  );
  assert.equal(
    page.parseFilters(
      "?" + Array(33).fill("province=广东省").join("&"),
      options,
    ).filters.province.length,
    0,
  );
  assert.equal(
    page.parseFilters("?unknown=value&q=保留", options).filters.q,
    "保留",
  );
});

test("页面过滤真正消费领域模型：省市并集与日期、团体、模糊文本求交", () => {
  const events = [
    fixture({}),
    fixture({
      id: "e-test-only-b",
      province: "广西壮族自治区",
      city: "桂林市",
      date: "2026-09-07",
      status: "cancelled",
    }),
    fixture({
      id: "e-test-only-c",
      date: "2026-10-01",
      performers: [{ groupId: "g002", name: "另一测试团体" }],
    }),
  ];
  const filters = {
    ...page.emptyFilters(),
    period: "all",
    province: ["广东省"],
    city: ["桂林市"],
    from: "2026-09-01",
    to: "2026-09-30",
    group: "g001",
    q: "ｌｉｖｅ 夜间",
  };
  assert.deepEqual(
    page.selectPageEvents(events, filters).map((event) => event.id),
    ["e-test-only-a", "e-test-only-b"],
  );
  assert.equal(
    page.selectPageEvents(events, { ...filters, group: "g303" }).length,
    0,
  );
});

test("日程按日期和开演时间排序且不修改原始数组", () => {
  const events = [
    fixture({ id: "e-test-only-c", date: "2026-09-07" }),
    fixture({ id: "e-test-only-b" }),
    fixture({ id: "e-test-only-a", startsAt: "18:00" }),
  ];
  const before = globalThis.structuredClone(events);
  assert.deepEqual(
    page
      .selectPageEvents(events, { ...page.emptyFilters(), period: "all" })
      .map((event) => event.id),
    ["e-test-only-a", "e-test-only-b", "e-test-only-c"],
  );
  assert.deepEqual(events, before);
});

test("月历按周一排列，覆盖闰年、跨年与边界", () => {
  const dates = page.monthDates("2024-02");
  assert.deepEqual(dates.slice(0, 4), [null, null, null, "2024-02-01"]);
  assert.equal(dates.filter(Boolean).length, 29);
  assert.equal(dates.length % 7, 0);
  assert.equal(page.monthDates("2026-02").filter(Boolean).length, 28);
  assert.deepEqual(page.monthDates("2026-13"), []);
  assert.equal(page.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(page.shiftMonth("1900-01", -1), "1900-01");
  assert.equal(page.shiftMonth("2100-12", 1), "2100-12");
});

test("中国当地日期在 UTC 的下午四点切日", () => {
  assert.equal(page.chinaToday(new Date("2026-09-05T15:59:59Z")), "2026-09-05");
  assert.equal(page.chinaToday(new Date("2026-09-05T16:00:00Z")), "2026-09-06");
  assert.equal(page.isValidPageDate("2024-02-29"), true);
  assert.equal(page.isValidPageDate("2026-02-29"), false);
});

test("来源链接仅放行无凭据的 HTTP(S)", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.org",
    "https://user:password@example.org",
    "https://example.org/%0d%0a",
    "https://exa\nmple.org",
  ])
    assert.equal(page.safeExternalUrl(url), null);
  assert.equal(
    page.safeExternalUrl("https://example.org/source"),
    "https://example.org/source",
  );
});

test("HTML 保留原生键盘语义、数据缺失说明和普通脚本离线入口", async () => {
  const html = await readFile(path.join(root, "events.html"), "utf8");
  assert.match(html, /<html lang="zh-CN">/u);
  assert.match(html, /id="events-heading" tabindex="-1"/u);
  assert.match(html, /<script src="assets\/events\.js" defer><\/script>/u);
  assert.match(html, /<noscript\s*>/u);
  assert.match(html, /id="events-export"[^>]*disabled/u);
  assert.match(html, /<details class="events-regions">/u);
});

test("页面海报入口与领域本地目录合同一致，远程规则保留", () => {
  assert.equal(
    page.safePosterUrl("assets/event-posters/event-1.png"),
    "assets/event-posters/event-1.png",
  );
  assert.equal(
    page.safePosterUrl("https://venue.org/poster.webp"),
    "https://venue.org/poster.webp",
  );
  for (const src of [
    "assets/posters/event-1.png",
    "assets/private/event.png",
    "assets/event-posters/../x.png",
    "assets/event-posters/x.svg",
  ])
    assert.equal(page.safePosterUrl(src), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("src/site/map.ts", root))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const site = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const ids = new Set(["g001", "g123", "g303", "g399"]);

test("已收录团体深链与历史 ID 可解析", () => {
  for (const groupId of ids)
    assert.deepEqual(site.parseGroupLink(`?group=${groupId}`, ids), {
      state: "valid",
      groupId,
    });
  assert.deepEqual(site.parseGroupLink("?q=test", ids), { state: "none" });
});

test("未知、重复、超长、注入及格式错误参数安全降级", () => {
  for (const search of [
    "?group=g000",
    "?group=g400",
    "?group=g1",
    "?group=",
    "?group=G001",
    "?group=g001&group=g001",
    "?group=g001&group=g303",
    "?group=%3Cscript%3E",
    "?group=g001%00",
    `?group=g001&q=${"a".repeat(2048)}`,
  ]) {
    assert.deepEqual(
      site.parseGroupLink(search, ids),
      { state: "invalid" },
      search.slice(0, 100),
    );
  }
  assert.equal(site.groupEventsHref("g303"), "events.html?group=g303");
});

test("全部 399 条与当前存续 375 条口径保持", async () => {
  const context = { window: {} };
  vm.runInNewContext(await readFile(new URL("data.js", root), "utf8"), context);
  const groups = context.window.IDOL_MAP_DATA.groups;
  assert.equal(groups.length, 399);
  assert.equal(groups.filter((group) => group.isActive).length, 375);
  assert.equal(groups.find((group) => group.id === "g303").isActive, false);
  assert.equal(new Set(groups.map((group) => group.id)).size, 399);
});

test("地图普通脚本顺序与相对导航", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.ok(
    html.indexOf('src="data.js"') < html.indexOf('src="assets/site.js"'),
  );
  assert.ok(
    html.indexOf('src="assets/site.js"') < html.indexOf('src="app.js"'),
  );
  for (const page of [
    "index",
    "discover",
    "groups",
    "events",
    "guide",
    "contribute",
    "about",
  ])
    assert.ok(html.includes(`href="${page}.html"`));
  assert.match(html, /id="group-link-status"[^>]*role="status"/);
});

test("固定夹具的活动摘要按团体关联，零收录不声称没有活动", async () => {
  const dataset = JSON.parse(
    await readFile(
      new URL("tests/fixtures/events-seed-20260905.json", root),
      "utf8",
    ),
  );
  const now = new Date("2026-09-05T08:00:00Z");
  const matched = site.getGroupActivitySummary(dataset.events, "g185", now);
  assert.equal(matched.total, 1);
  assert.equal(matched.upcoming[0].startsAt, "14:00");
  const empty = site.getGroupActivitySummary(dataset.events, "g001", now);
  assert.equal(empty.total, 0);
  assert.match(empty.message, /尚未收录相关活动，不代表/);
  const past = site.getGroupActivitySummary(
    dataset.events,
    "g185",
    new Date("2026-10-01T00:00:00Z"),
  );
  assert.equal(past.upcoming.length, 0);
  assert.match(past.message, /不代表实际举办/);
});

test("旧页面导航顺序、可展开资料状态与指南锚点保持可达", async () => {
  for (const page of ["index", "guide", "contribute", "about"]) {
    const html = await readFile(new URL(`${page}.html`, root), "utf8");
    const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0];
    assert.deepEqual(
      [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
      [
        "discover.html",
        "groups.html",
        "events.html",
        "index.html",
        "guide.html",
      ],
    );
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /href="about.html"/);
    assert.match(html, /href="contribute.html(?:\?[^"]*)?"/);
  }
  const map = await readFile(new URL("index.html", root), "utf8");
  assert.match(
    map,
    /<details class="site-evidence-details">[\s\S]*?id="api-coverage-line"[\s\S]*?<\/details>/,
  );
  assert.match(map, /id="group-profile-link"/);
  assert.match(map, /id="group-correction-link"/);
  const guide = await readFile(new URL("guide.html", root), "utf8");
  for (const id of [
    "announcement",
    "prepare",
    "flow",
    "etiquette",
    "changes",
    "help",
    "faq",
  ])
    assert.ok(guide.includes(`id="${id}"`));
});

test("摘要不隐藏取消延期，按 UTC+8 午夜筛选，最多显示三条且不修改源数组", async () => {
  const dataset = JSON.parse(
    await readFile(
      new URL("tests/fixtures/events-seed-20260905.json", root),
      "utf8",
    ),
  );
  const events = ["cancelled", "postponed", "unconfirmed", "scheduled"].map(
    (status, i) => ({
      ...dataset.events[0],
      id: `e-summary-${i}`,
      date: "2026-09-06",
      status,
    }),
  );
  events.push({ ...events[0], id: "e-summary-past", date: "2026-09-05" });
  const before = JSON.stringify(events);
  const summary = site.getGroupActivitySummary(
    events,
    "g263",
    new Date("2026-09-05T16:00:00Z"),
  );
  assert.equal(summary.total, 5);
  assert.equal(summary.upcomingCount, 4);
  assert.equal(summary.upcoming.length, 3);
  assert.deepEqual(
    summary.upcoming.map((event) => event.status),
    ["cancelled", "postponed", "unconfirmed"],
  );
  assert.equal(JSON.stringify(events), before);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicFiles } from "../scripts/siteManifest.mjs";

const root = new URL("../", import.meta.url);

test("所有公开页面可达全国地图且继续保留风格图", async () => {
  const expected = [
    "discover.html",
    "groups.html",
    "events.html",
    "geography.html",
    "index.html",
    "guide.html",
  ];
  for (const name of publicFiles.filter((file) => file.endsWith(".html"))) {
    const html = await readFile(new URL(name, root), "utf8");
    const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/u);
    assert.ok(nav, `${name} 缺主导航`);
    assert.deepEqual(
      [...nav[0].matchAll(/href="([^"]+)"/gu)].map((match) => match[1]),
      expected,
      name,
    );
    assert.match(nav[0], /href="geography.html"[^>]*>全国地图<\/a\s*>/u);
    assert.match(nav[0], /href="index.html"[^>]*>风格图<\/a\s*>/u);
  }
});

test("全国地图使用离线公开索引和独立普通脚本", async () => {
  const html = await readFile(new URL("geography.html", root), "utf8");
  assert.deepEqual(
    [...html.matchAll(/<script\b[^>]*src="([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    ["assets/groups-data.js", "assets/geography.js", "assets/metrics.js"],
  );
  assert.match(html, /href="styles\/geography.css"/u);
  assert.match(html, /lang="zh-CN"/u);
  assert.doesNotMatch(html, /<script\b[^>]*type="module"/u);
  const styleMap = await readFile(new URL("index.html", root), "utf8");
  assert.doesNotMatch(styleMap, /src="assets\/geography.js"/u);
});

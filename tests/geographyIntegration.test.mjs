import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { entryPoints, publicFiles } from "../scripts/siteManifest.mjs";

const root = new URL("../", import.meta.url);

test("全国地图构建、预览、两级发布器共用相同的最小公开清单", async () => {
  assert.equal(entryPoints.geography, "src/geography/page.ts");
  for (const name of [
    "geography.html",
    "styles/geography.css",
    "assets/geography.js",
  ])
    assert.ok(publicFiles.includes(name), name);

  const output = await build({
    entryPoints: [
      fileURLToPath(
        new URL("maintenance/runtime/private/server/publisher.ts", root),
      ),
    ],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
  });
  const publisher = await import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
  assert.deepEqual([...publisher.PUBLIC_FILES].sort(), [...publicFiles].sort());
  assert.deepEqual(
    [...publisher.GENERATED_FILES].sort(),
    [
      "assets/groups-data.js",
      ...Object.keys(entryPoints).map((name) => `assets/${name}.js`),
    ].sort(),
  );

  const python = await readFile(
    new URL("maintenance/publish.py", root),
    "utf8",
  );
  const required = python.match(/REQUIRED = frozenset\(\[([\s\S]*?)\]\)/u);
  assert.ok(required, "Python 发布器必须显式列出固定公开文件");
  assert.deepEqual(
    [...required[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]).sort(),
    [...publicFiles].sort(),
  );
  assert.ok(!publicFiles.some((name) => name.startsWith("data/")));
});

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
    assert.match(nav[0], /href="geography.html"[^>]*>全国地图<\/a>/u);
    assert.match(nav[0], /href="index.html"[^>]*>风格图<\/a>/u);
  }
});

test("全国地图使用离线公开索引和独立普通脚本", async () => {
  const html = await readFile(new URL("geography.html", root), "utf8");
  assert.deepEqual(
    [...html.matchAll(/<script\b[^>]*src="([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    ["assets/groups-data.js", "assets/geography.js"],
  );
  assert.match(html, /href="styles\/geography.css"/u);
  assert.match(html, /lang="zh-CN"/u);
  assert.doesNotMatch(html, /<script\b[^>]*type="module"/u);
  const styleMap = await readFile(new URL("index.html", root), "utf8");
  assert.doesNotMatch(styleMap, /src="assets\/geography.js"/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { entryPoints, publicFiles } from "../scripts/siteManifest.mjs";

const root = new URL("../", import.meta.url);

test("全国地图构建、预览、物化与两级发布器共用最小公开清单", async () => {
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
  const materializer = await readFile(
    new URL("maintenance/materialize.mjs", root),
    "utf8",
  );
  const exclusions = materializer.match(
    /CONSOLE_ONLY_FILES = new Set\(\[([\s\S]*?)\]\)/u,
  );
  assert.ok(exclusions);
  assert.deepEqual(
    [...publisher.CONSOLE_ONLY_FILES].sort(),
    [...exclusions[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]).sort(),
  );
  const roots = materializer.match(
    /PUBLIC_ROOT_FILES = new Set\(\[([\s\S]*?)\]\)/u,
  );
  assert.ok(roots);
  const allowedRoots = new Set(
    [...roots[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]),
  );
  for (const name of publicFiles.filter((name) => !name.includes("/")))
    assert.ok(allowedRoots.has(name), `物化清单缺少 ${name}`);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { setImmediate } from "node:timers";
import { build } from "esbuild";
import { entryPoints, publicFiles } from "../scripts/siteManifest.mjs";

const root = new URL("../", import.meta.url);
const model = await readFile(new URL("src/metrics/visit.ts", root), "utf8");
const { publicVisit, publicPages } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(model)).toString("base64")}`
);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("src/metrics/page.ts", root))],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const metrics = compiled.outputFiles[0].text;

test("固定公开页面允许统计，路径和来源在上传前最小化", () => {
  assert.equal(publicPages.length, 13);
  for (const page of publicPages) {
    assert.deepEqual(
      publicVisit(
        `https://example.com/${page}.html?private=secret#draft`,
        "https://user:pass@source.example:8443/private?q=secret#x",
      ),
      {
        path: `/${page}.html`,
        referrer: "https://source.example",
      },
    );
  }
  assert.equal(publicVisit("https://example.com/", "").path, "/index.html");
  for (const href of [
    "file:///site/index.html",
    "https://example.com/admin/",
    "https://example.com/api/v1/pageviews",
    "https://example.com/assets/site.js",
    "https://example.com/nested/index.html",
    "https://example.com/unknown.html",
    "https://user:pass@example.com/index.html",
    "invalid",
  ]) {
    assert.equal(publicVisit(href, ""), null, href);
  }
  assert.equal(
    publicVisit("https://example.com/index.html", "file:///private/path")
      .referrer,
    "",
  );
});

test("生成页只统计本次精确登记的详情和索引，不上传关注查询参数", () => {
  const generated = [
    "/groups/g001.html",
    "/groups/index.html",
    "/events/index.html",
    "/events/e-known.html",
  ];
  for (const path of generated)
    assert.deepEqual(
      publicVisit(
        `https://example.com${path}?following=1#private`,
        "",
        generated,
      ),
      { path, referrer: "" },
    );
  assert.equal(
    publicVisit("https://example.com/groups/g999.html", "", generated),
    null,
  );
  assert.equal(publicVisit("https://example.com/groups/g001.html", ""), null);
});

async function visit({
  href = "https://example.com/group.html?group=g001#private",
  visible = "visible",
  dnt = "0",
  fail = false,
} = {}) {
  const requests = [];
  let consumed = 0;
  const events = {};
  const document = {
    visibilityState: visible,
    referrer: "https://source.example/secret?contact=private",
    addEventListener: (name, callback) => {
      events[name] = callback;
    },
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (fail) throw new Error("offline");
    return {
      text: async () => {
        consumed += 1;
        return "";
      },
    };
  };
  const window = {
    location: new URL(href),
    crypto: { randomUUID: () => "bbddeeff-1122-4334-8990-aabbccddeeff" },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(metrics, {
    document,
    window,
    navigator: { doNotTrack: dnt },
    fetch,
    URL,
    AbortController,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { requests, document, events, consumed };
}

test("可见文档只发一次，DNT和离线不发；失败不会阻断页面或重试", async () => {
  const normal = await visit();
  assert.equal(normal.requests.length, 1);
  assert.equal(normal.consumed, 1, "统计响应必须完整消费，避免请求长期未结束");
  for (const scenario of [
    { dnt: "1" },
    { href: "file:///site/index.html" },
    { href: "https://example.com/admin/" },
  ]) {
    assert.equal((await visit(scenario)).requests.length, 0);
  }
  const state = await visit({ visible: "hidden", fail: true });
  assert.equal(state.requests.length, 0);
  state.document.visibilityState = "visible";
  state.events.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  state.events.visibilitychange();
  assert.equal(state.requests.length, 1);
  const request = state.requests[0];
  assert.equal(request.url, "/api/v1/pageviews");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(request.options.body), {
    id: "bbddeeff-1122-4334-8990-aabbccddeeff",
    path: "/group.html",
    referrer: "https://source.example",
  });
});

test("九个页面各挂载一次普通埋点脚本；静态入口不含后台与数据库", async () => {
  assert.equal(entryPoints.metrics, "src/metrics/page.ts");
  for (const page of publicPages) {
    const html = await readFile(new URL(`${page}.html`, root), "utf8");
    assert.equal(
      (html.match(/<script src="assets\/metrics\.js" defer><\/script>/g) ?? [])
        .length,
      1,
    );
  }
  assert.ok(publicFiles.includes("assets/metrics.js"));
  assert.ok(
    !publicFiles.some((name) =>
      /admin|console|\.sqlite|\.key|\.env/u.test(name),
    ),
  );
  const about = await readFile(new URL("about.html", root), "utf8");
  for (const phrase of [
    'id="privacy"',
    "90 天",
    "Do Not Track",
    "仅管理员",
    "邮件服务",
  ])
    assert.ok(about.replace(/\s+/gu, " ").includes(phrase), phrase);
});

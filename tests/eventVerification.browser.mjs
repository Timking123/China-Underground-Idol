import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const output = path.join(root, "reports/city-upgrade-a");
const preview = path.join(output, "preview");
await mkdir(preview, { recursive: true });
const files = [
  "events.html",
  "app.css",
  "styles/events.css",
  "styles/site.css",
  "styles/preferences.css",
  "assets/groups-data.js",
];
for (const file of files) {
  await mkdir(path.dirname(path.join(preview, file)), { recursive: true });
  await cp(path.join(root, file), path.join(preview, file));
}
const bundle = await build({
  entryPoints: ["src/events/page.ts"],
  bundle: true,
  format: "iife",
  write: false,
  target: "es2022",
});
await writeFile(
  path.join(preview, "assets/events.js"),
  bundle.outputFiles[0].contents,
);
const allowed = new Set([...files, "assets/events.js"]);
const server = createServer(async (req, res) => {
  const file = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
  if (!allowed.has(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html;charset=utf-8"
        : file.endsWith(".css")
          ? "text/css;charset=utf-8"
          : "text/javascript;charset=utf-8",
    );
    res.end(await readFile(path.join(preview, file)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(
  modulePath ? pathToFileURL(modulePath).href : "playwright"
);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const findings = [];
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-09-19T01:00:00Z"));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/events.html`);
  await page.locator(".events-entry").first().waitFor();
  assert.equal(await page.locator(".events-entry").count(), 45);
  assert.match(
    await page.locator("#events-verification-summary").textContent(),
    /核心安排已核验 3 场.*部分核验 6 场.*36 场/u,
  );
  assert.equal(
    await page
      .locator(".events-entry-actions a[href^='https://uri.amap.com/']")
      .count(),
    4,
  );
  const flower = "#e-board-213e82626ff7719e1f0720152daff7d6";
  await page.locator(`${flower} summary`).click();
  assert.match(
    await page.locator(`${flower} .events-verification`).textContent(),
    /资料变化/u,
  );
  assert.match(
    await page.locator(`${flower} .events-verification`).textContent(),
    /鲜花着锦事务所/u,
  );
  const follow = page.locator(`${flower} button[data-follow-type=event]`);
  await follow.click();
  assert.equal(await follow.getAttribute("aria-pressed"), "true");
  await page.reload();
  await page.locator(".events-entry").first().waitFor();
  assert.equal(
    await page
      .locator(`${flower} button[data-follow-type=event]`)
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(`${flower} button[data-follow-type=event]`).click();
  await page.locator("#events-query").fill("不存在的演出检索词");
  await page.locator("#events-query").press("Enter");
  assert.equal(await page.locator("#events-empty").isVisible(), true);
  assert.match(
    await page.locator("#events-empty-reason").textContent(),
    /尚未收录不代表没有活动/u,
  );
  await page.goto(`${base}/events.html?q=不存在${flower}`);
  assert.equal(
    await page.locator(`${flower} details`).getAttribute("open"),
    "",
  );
  assert.match(
    await page.locator("#events-filter-notice").textContent(),
    /为显示链接中的活动/u,
  );
  await page.goto(`${base}/events.html`);
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".skip-link")
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.notEqual(
    await page
      .locator(".skip-link")
      .evaluate((node) => window.getComputedStyle(node).outlineStyle),
    "none",
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .locator("#events-heading")
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .locator("body")
      .evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    true,
  );
  await page.goto(`${base}/events.html?city=北京`);
  await page.screenshot({
    path: path.join(output, "events-1440.png"),
    fullPage: false,
  });
  findings.push(
    "1440px：核验计数、4 条可靠地图、真实变化详情、关注/刷新/移除、空态、冲突深链、键盘焦点与无溢出通过。",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/events.html?city=北京${flower}`);
  assert.equal(
    await page
      .locator("body")
      .evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    true,
  );
  assert.equal(
    await page.locator(`${flower} details`).getAttribute("open"),
    "",
  );
  await page.screenshot({
    path: path.join(output, "events-375-detail.png"),
    fullPage: false,
  });
  await page.goto(`${base}/events.html?city=北京`);
  await page.screenshot({
    path: path.join(output, "events-375.png"),
    fullPage: false,
  });
  assert.ok(
    await page
      .locator(".events-entry button")
      .first()
      .evaluate(
        (node) =>
          parseFloat(window.getComputedStyle(node).transitionDuration) <= 0.001,
      ),
  );
  findings.push(
    "375px：展开详情及长来源可换行，无水平溢出；减少动画设置生效。",
  );
  const blocked = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await blocked.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("测试禁用存储");
      },
    }),
  );
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(`${base}/events.html`);
  await blockedPage.locator(".events-entry").first().waitFor();
  await blockedPage.locator("button[data-follow-type=event]").first().click();
  assert.match(
    await blockedPage.locator("#follow-status").textContent(),
    /仅暂存/u,
  );
  findings.push("存储禁用：关注仍可暂存，明确告知离开/刷新可能丢失。");
  const broken = await build({
    entryPoints: ["src/events/page.ts"],
    bundle: true,
    format: "iife",
    write: false,
    plugins: [
      {
        name: "synthetic-invalid-verification",
        setup(builder) {
          builder.onLoad({ filter: /event-verifications\.v1\.json$/ }, () => ({
            contents: "{}",
            loader: "json",
          }));
        },
      },
    ],
  });
  await page.route("**/assets/events.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: broken.outputFiles[0].text,
    }),
  );
  await page.goto(`${base}/events.html`);
  await page.locator(".events-entry").first().waitFor();
  assert.match(
    await page.locator("#events-verification-summary").textContent(),
    /核验补充资料暂不可用/u,
  );
  assert.equal(
    await page.locator("a[href^='https://uri.amap.com/']").count(),
    0,
  );
  assert.equal(await page.locator("[data-verification=verified]").count(), 0);
  findings.push("损坏核验层：主档仍可浏览，明确降级，地图与确认徽标全部关闭。");
  // 合成状态只进入内存测试包，不进入正式活动数据或共享资产。
  const stamp = "2026-09-18T12:00:00Z";
  const master = JSON.parse(
    await readFile(path.join(root, "data/events.v1.json"), "utf8"),
  );
  const cases = ["cancelled", "postponed", "scheduled"].map((status, i) => ({
    ...master.events[0],
    id: `e-test-browser-${i}`,
    title: `测试状态 ${status} <img src=x onerror=window.__eventXss=1>`,
    date: "2026-09-19",
    city: "北京",
    province: "北京",
    venue: "测试场馆",
    address: "测试街1号",
    status,
    opensAt: null,
    startsAt: null,
    endsAt: null,
    performers: [],
    poster: null,
    notes: "仅供浏览器验收的合成数据",
    sources: [
      {
        url: "https://venue.example.org/case",
        publisher: "测试主办",
        kind: "organizer",
        observedAt: stamp,
        label: "合成来源",
      },
    ],
  }));
  const snapshots = [
    "title",
    "city",
    "province",
    "date",
    "status",
    "venue",
    "address",
    "opensAt",
    "startsAt",
    "endsAt",
  ];
  const supplemental = {
    schemaVersion: "idol-event-verifications-v1",
    updatedAt: stamp,
    coverage: "partial",
    records: cases.map((event) => ({
      eventId: event.id,
      snapshot: Object.fromEntries(
        snapshots.map((field) => [field, event[field]]),
      ),
      checkedAt: stamp,
      verifiedAt: stamp,
      outcome: "partial",
      summary: "合成状态验收",
      fields: {
        date: "verified",
        status: "verified",
        venue: "verified",
        address: "verified",
        opensAt: "unannounced",
        startsAt: "unverified",
        endsAt: "unverified",
      },
      evidence: [
        {
          url: event.sources[0].url,
          publisher: "测试主办",
          role: "organizer",
          observedAt: stamp,
          result: "read",
          fields: ["date", "status", "venue", "address", "opensAt"],
          note: "合成原文明示入场尚未公布。",
        },
      ],
      changes: [],
    })),
  };
  const synthetic = await build({
    entryPoints: ["src/events/page.ts"],
    bundle: true,
    format: "iife",
    write: false,
    plugins: [
      {
        name: "synthetic-event-states",
        setup(builder) {
          builder.onLoad({ filter: /[\\/]events\.v1\.json$/ }, () => ({
            contents: JSON.stringify({ ...master, events: cases }),
            loader: "json",
          }));
          builder.onLoad({ filter: /event-verifications\.v1\.json$/ }, () => ({
            contents: JSON.stringify(supplemental),
            loader: "json",
          }));
        },
      },
    ],
  });
  await page.unroute("**/assets/events.js");
  await page.route("**/assets/events.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: synthetic.outputFiles[0].text,
    }),
  );
  await page.goto(`${base}/events.html`);
  await page.locator(".events-entry").first().waitFor();
  assert.equal(await page.locator(".events-entry").count(), 3);
  assert.match(
    await page.locator("#e-test-browser-0").textContent(),
    /已取消/u,
  );
  assert.match(
    await page.locator("#e-test-browser-1").textContent(),
    /已延期/u,
  );
  for (const id of ["0", "1"]) {
    assert.equal(
      await page
        .locator(`#e-test-browser-${id} a[href^='https://uri.amap.com/']`)
        .count(),
      0,
    );
  }
  await page.locator("#e-test-browser-2 summary").click();
  assert.match(
    await page.locator("#e-test-browser-2 .events-detail-body").textContent(),
    /入场：尚未公布.*整场开演：尚未核实/u,
  );
  assert.equal(await page.locator(".events-entry h3 img").count(), 0);
  assert.equal(await page.evaluate(() => window.__eventXss), undefined);
  findings.push(
    "合成边界：取消/延期标签明确且无旧地址导航；尚未公布与尚未核实区分；恶意 HTML 仅作文本。",
  );
  const invalidMain = await build({
    entryPoints: ["src/events/page.ts"],
    bundle: true,
    format: "iife",
    write: false,
    plugins: [
      {
        name: "synthetic-invalid-main",
        setup(builder) {
          builder.onLoad({ filter: /[\\/]events\.v1\.json$/ }, () => ({
            contents: "{}",
            loader: "json",
          }));
        },
      },
    ],
  });
  await page.unroute("**/assets/events.js");
  await page.route("**/assets/events.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: invalidMain.outputFiles[0].text,
    }),
  );
  await page.goto(`${base}/events.html`);
  await page.waitForFunction(() =>
    document
      .getElementById("events-result-status")
      .textContent.includes("暂时无法读取"),
  );
  assert.equal(await page.locator("#events-export").isDisabled(), true);
  assert.match(
    await page.locator("#events-verification-summary").textContent(),
    /核验记录暂停展示/u,
  );
  assert.equal(await page.locator("#events-query").isDisabled(), true);
  findings.push("主档损坏：显示读取失败并禁用筛选/导出，不显示伪造的零活动。");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "browser-results.json"),
    JSON.stringify(
      { passed: true, base, findings, pageErrors: errors },
      null,
      2,
    ) + "\n",
  );
  console.log(findings.join("\n"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

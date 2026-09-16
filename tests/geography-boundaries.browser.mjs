import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(
  modulePath ? pathToFileURL(modulePath).href : "playwright"
);
const base = process.env.GEOGRAPHY_PREVIEW_URL ?? "http://127.0.0.1:4188";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/geography.html`);
  await page.locator(".geography-marker").first().waitFor();
  const catalog = await page.evaluate(() => window.IDOL_GROUPS_DATA);
  // 仅测试页面的公开索引替身；两个正式城市坐标及地理底图保持原值。
  const fixture = {
    ...catalog,
    groups: [
      {
        ...catalog.groups[0],
        name: "边界测试深圳团",
        activity: { province: null, city: "深圳市" },
      },
      {
        ...catalog.groups[1],
        name: "边界测试香港团",
        activity: { province: "香港特别行政区", city: "香港" },
      },
    ],
  };
  const nearby = await context.newPage();
  nearby.on("pageerror", (error) => errors.push(error.message));
  await nearby.route("**/assets/groups-data.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.IDOL_GROUPS_DATA=${JSON.stringify(fixture)};`,
    }),
  );
  await nearby.goto(`${base}/geography.html?lng=114.1&lat=22.44&zoom=32`);
  const cluster = nearby.getByRole("button", {
    name: "2 个城市，2 支团体，选择城市",
    exact: true,
  });
  await cluster.waitFor();
  await cluster.click();
  assert.equal(new URL(nearby.url()).searchParams.getAll("city").length, 2);
  assert.match(
    await nearby.locator("#geography-result-summary").textContent(),
    /最大缩放/u,
  );
  assert.equal(await nearby.locator("#geography-cities button").count(), 2);
  await nearby
    .locator("#geography-cities")
    .getByRole("button", { name: /深圳/u })
    .click();
  assert.equal(new URL(nearby.url()).searchParams.has("province"), false);
  assert.deepEqual(
    await nearby.locator(".geography-group-name").allTextContents(),
    ["边界测试深圳团"],
  );
  assert.equal(
    await nearby
      .locator("#geography-cities")
      .getByRole("button", { name: /深圳/u })
      .textContent(),
    "深圳市 1",
  );
  await nearby.goBack();
  assert.equal(await nearby.locator("#geography-cities button").count(), 2);
  results.push(
    "32倍仍同簇的深圳/香港有逐城入口，名单与URL/后退一致，不移动真实坐标",
  );
  results.push("缺省份的深圳记录仍显示城市入口1支，与点击名单一致");

  const symbols = page.locator(".geography-geographic-symbol");
  assert.equal(await symbols.count(), 2);
  const inspectSymbols = () =>
    symbols.evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: node.getAttribute("aria-label"),
        role: node.getAttribute("role"),
        tabIndex: node.getAttribute("tabindex"),
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        fill: window.getComputedStyle(node).fill,
      })),
    );
  const before = await inspectSymbols();
  assert.deepEqual(
    new Set(before.map((item) => item.name)),
    new Set(["东沙岛", "曾母暗沙"]),
  );
  assert.ok(
    before.every((item) => item.role !== "button" && item.tabIndex === null),
  );
  const numericCount = await page.locator("#geography-count").textContent();
  await page.locator("#geography-zoom-in").click();
  await page.waitForFunction(
    () => Number(new URL(window.location.href).searchParams.get("zoom")) > 1,
  );
  const after = await inspectSymbols();
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(after[i].width - before[i].width) < 0.2);
    assert.ok(Math.abs(after[i].height - before[i].height) < 0.2);
    assert.ok(after[i].width <= 7 && after[i].height <= 7);
  }
  assert.equal(
    await page.locator("#geography-count").textContent(),
    numericCount,
  );
  const markerFill = await page
    .locator(".geography-marker circle")
    .first()
    .evaluate((node) => window.getComputedStyle(node).fill);
  assert.notEqual(before[0].fill, markerFill);
  results.push(
    "东沙/曾母地理符号固定屏幕尺寸、无团体角色/数量，颜色与团体聚合点区分",
  );
  assert.deepEqual(errors, []);
  const output = path.resolve("reports/geography-ui");
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "boundary-evidence.json"),
    JSON.stringify({ passed: results, consoleErrors: errors }, null, 2),
    "utf8",
  );
  console.log(results.join("\n"));
} finally {
  await browser.close();
}

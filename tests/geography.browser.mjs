import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// 使用宿主已有 Playwright，避免仅为人工验收增加生产依赖。
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(
  modulePath ? pathToFileURL(modulePath).href : "playwright"
);
const base = process.env.GEOGRAPHY_PREVIEW_URL ?? "http://127.0.0.1:4188";
const output = path.resolve("reports/geography-ui");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/geography.html`);
  await page.locator(".geography-marker").first().waitFor();
  assert.equal(await page.locator("#geography-map-status").isVisible(), false);
  const initialLinks = await page
    .locator("#geography-group-list a")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  assert.equal(initialLinks.length, 24);
  assert.equal(new Set(initialLinks).size, 24);
  assert.equal((await page.locator(".geography-province").count()) > 20, true);
  const options = await page
    .locator("#geography-province option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, label: node.textContent })),
    );
  const gd = options.find((entry) => /广东/u.test(entry.label));
  assert.ok(gd, "完整字典应有广东省");
  await page.locator("#geography-province").selectOption(gd.value);
  assert.match(new URL(page.url()).searchParams.get("province"), /广东/u);
  const provinceUrl = page.url();
  const cities = await page
    .locator("#geography-city option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, label: node.textContent })),
    );
  const sz = cities.find((entry) => /深圳/u.test(entry.label));
  assert.ok(sz);
  await page.locator("#geography-city").selectOption(sz.value);
  assert.equal(new URL(page.url()).searchParams.has("province"), false);
  assert.match(new URL(page.url()).searchParams.get("city"), /深圳/u);
  assert.match(
    await page.locator("#geography-results-heading").textContent(),
    /深圳/u,
  );
  const cityMeta = await page
    .locator(".geography-group-meta")
    .allTextContents();
  assert.ok(
    cityMeta.length > 0 && cityMeta.every((text) => /深圳/u.test(text)),
  );
  await page.goBack();
  assert.equal(page.url(), provinceUrl);
  assert.equal(await page.locator("#geography-city").inputValue(), "");
  await page.locator("#geography-city").selectOption(sz.value);
  await page.locator("#geography-parent").click();
  assert.match(new URL(page.url()).searchParams.get("province"), /广东/u);
  assert.equal(new URL(page.url()).searchParams.has("city"), false);
  results.push("广东→深圳仅匹配深圳；浏览器后退恢复广东");

  await page.goto(`${base}/geography.html?province=广东&city=深圳`);
  assert.equal(
    await page.locator("#geography-province").inputValue(),
    "__combined",
  );
  assert.equal(
    await page.locator("#geography-city").inputValue(),
    "__combined",
  );
  assert.match(
    await page.locator("#geography-result-summary").textContent(),
    /广东.*或.*深圳/u,
  );
  results.push("旧省市并集链接显示组合地区");

  await page.goto(`${base}/geography.html?province=青海`);
  await page.locator("#geography-empty").waitFor();
  assert.match(
    await page.locator("#geography-map-heading").textContent(),
    /青海/u,
  );
  await page.reload();
  assert.match(
    await page.locator("#geography-map-heading").textContent(),
    /青海/u,
  );
  results.push("空地区尚未收录与刷新恢复");

  await page.locator("#geography-reset").click();
  await page.locator("#geography-query").fill('<img src=x onerror="alert(1)">');
  await page.locator("#geography-query").press("Enter");
  await page.locator("#geography-empty").waitFor();
  assert.equal(await page.locator("#geography-result-summary img").count(), 0);
  assert.match(
    await page.locator("#geography-result-summary").textContent(),
    /<img/u,
  );
  results.push("团名检索、空结果和XSS文本呈现");

  await page.locator("#geography-reset").click();
  const viewport = page.locator("#geography-map svg");
  await viewport.focus();
  await viewport.press("+");
  await page.waitForFunction(
    () => Number(new URL(window.location.href).searchParams.get("zoom")) > 1,
  );
  await viewport.press("ArrowRight");
  const beforePan = new URL(page.url()).searchParams.get("lng");
  await page.waitForFunction(
    (previous) =>
      new URL(window.location.href).searchParams.get("lng") !== previous,
    beforePan,
  );
  assert.equal(
    await viewport.evaluate((node) => node.matches(":focus-visible")),
    true,
  );
  results.push("键盘缩放、方向键平移与清晰焦点");

  await page.locator("#geography-reset").click();
  const initialZoom = await page.locator("#geography-scale").textContent();
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -180);
  await page.waitForFunction(
    (text) => document.querySelector("#geography-scale").textContent !== text,
    initialZoom,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  results.push("鼠标滚轮与拖动");

  await page.locator("#geography-reset").click();
  const multi = page.getByRole("button", { name: /个城市.*放大展开/u }).first();
  if (await multi.count()) {
    await multi.focus();
    await multi.press("Enter");
    await page.waitForFunction(
      () => Number(new URL(window.location.href).searchParams.get("zoom")) > 1,
    );
    results.push("全国聚合点键盘展开");
  }
  await page.locator("#geography-reset").click();
  const single = page
    .getByRole("button", { name: /支团体，查看名单/u })
    .first();
  if (await single.count()) {
    await single.click();
    assert.ok(new URL(page.url()).searchParams.has("city"));
    assert.ok((await page.locator(".geography-group-link").count()) > 0);
    const href = await page
      .locator(".geography-group-link")
      .first()
      .getAttribute("href");
    assert.match(href, /^group\.html\?group=g\d+/u);
    results.push("城市点点击联动名单与独立档案链接");
  }

  await page.locator("#geography-reset").click();
  if (await page.locator("#geography-unknown").isVisible()) {
    await page.locator("#geography-unknown").click();
    assert.equal(new URL(page.url()).searchParams.get("unknown"), "1");
    assert.equal(await page.locator(".geography-marker").count(), 0);
    assert.match(
      await page.locator("#geography-results-heading").textContent(),
      /待核实/u,
    );
    results.push("未知地区保留入口且不伪造地图点位");
  }
  await page.locator("#geography-reset").click();
  await page.screenshot({
    path: path.join(output, "desktop-1440.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  assert.equal(
    await page
      .locator("#geography-reset")
      .evaluate((node) => window.getComputedStyle(node).transitionDuration),
    "0s",
  );

  const mobile = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const phone = await mobile.newPage();
  await phone.goto(`${base}/geography.html`);
  await phone.locator(".geography-marker").first().waitFor();
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const undersized = await phone
    .locator(
      ".geography-page button:not([hidden]), .geography-filters select, .geography-filters input, .site-nav a",
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.width < 40 || rect.height < 40);
        })
        .map((node) => node.textContent),
    );
  assert.deepEqual(undersized, []);
  await phone.screenshot({
    path: path.join(output, "mobile-375.png"),
    fullPage: true,
  });
  await phone.screenshot({
    path: path.join(output, "mobile-375-viewport.png"),
    fullPage: false,
  });
  await phone.locator("#geography-map").scrollIntoViewIfNeeded();
  const touchBox = await phone.locator("#geography-map svg").boundingBox();
  const centerX = touchBox.x + touchBox.width / 2;
  const centerY = touchBox.y + touchBox.height / 2;
  const cdp = await mobile.newCDPSession(phone);
  const touchPoints = (radius, dx = 0) => [
    { x: centerX - radius + dx, y: centerY, id: 1 },
    { x: centerX + radius + dx, y: centerY, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touchPoints(35),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touchPoints(65, 10),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await phone.waitForFunction(
    () => Number(new URL(window.location.href).searchParams.get("zoom")) > 1.5,
  );
  results.push("375px真实触摸事件双指缩放与平移");
  await phone.locator("#geography-reset").click();
  await phone.locator("#geography-province").selectOption(gd.value);
  await phone.locator("#geography-city").selectOption(sz.value);
  await phone.screenshot({
    path: path.join(output, "mobile-375-city.png"),
    fullPage: true,
  });
  results.push("1440px与375px无水平溢出，控件至少40px，减少动画偏好有效");

  const failed = await context.newPage();
  await failed.route("**/assets/groups-data.js", (route) => route.abort());
  await failed.goto(`${base}/geography.html`);
  await failed.getByRole("alert").waitFor();
  assert.equal(await failed.locator("#geography-query").isDisabled(), true);
  assert.match(
    await failed.locator("#geography-result-summary").textContent(),
    /无法读取/u,
  );
  const failedMap = await context.newPage();
  await failedMap.addInitScript(() => {
    window.ResizeObserver = class {
      constructor() {
        throw new Error("模拟渲染资源不可用");
      }
    };
  });
  await failedMap.goto(`${base}/geography.html`);
  await failedMap.locator("#geography-map-status[role=alert]").waitFor();
  assert.ok((await failedMap.locator(".geography-group-link").count()) > 0);
  assert.equal(
    await failedMap.locator("#geography-province").isEnabled(),
    true,
  );
  results.push("团体资源失败和底图渲染失败有明确回退");
  const failedImages = await context.newPage();
  await failedImages.route("**/assets/**", (route) =>
    route.request().resourceType() === "image"
      ? route.abort()
      : route.continue(),
  );
  await failedImages.goto(`${base}/geography.html`);
  await failedImages
    .locator(".geography-avatar img")
    .first()
    .waitFor({ state: "hidden" });
  assert.ok(
    (
      await failedImages.locator(".geography-avatar").first().textContent()
    ).trim(),
  );
  results.push("头像加载失败保留文字与原有占位");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "browser-evidence.json"),
    JSON.stringify({ passed: results, consoleErrors: errors }, null, 2),
    "utf8",
  );
  console.log(results.join("\n"));
} finally {
  await browser.close();
}

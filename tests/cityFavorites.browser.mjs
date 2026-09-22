import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 使用独立浏览器上下文，既不读取也不清空用户浏览器收藏。 */
export async function runBrowserChecks(
  browser,
  { base = "http://127.0.0.1:4192", output = "reports/city-upgrade-b" } = {},
) {
  await mkdir(output, { recursive: true });
  const checks = [];
  const check = (condition, name) => {
    assert.ok(condition, name);
    checks.push(name);
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const screenshot = async (name) =>
    page.screenshot({ path: path.join(output, name), fullPage: true });
  const noOverflow = async () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        [...document.querySelectorAll("main *, header *")].every(
          (node) => node.getBoundingClientRect().right <= window.innerWidth + 1,
        ),
    );
  try {
    await page.goto(`${base}/city.html?city=深圳`);
    await page.locator("#city-actions button").waitFor();
    check(await noOverflow(), "城市1440无横向溢出");
    check(
      (await page.locator("#city-upcoming li").count()) > 0,
      "深圳已收录近期演出非空",
    );
    check(
      !(await page.locator("#city-content").innerText()).includes("待公布"),
      "未知字段不推定尚未公布",
    );
    await screenshot("city-1440.png");
    await page.getByRole("link", { name: "本周末", exact: true }).click();
    check(
      new URL(page.url()).searchParams.get("period") === "weekend",
      "周末使用独立深链",
    );
    check(
      (await page.locator("#city-upcoming-title").innerText()) === "本周末演出",
      "周末区块取代近期重复内容",
    );
    check(
      (await page.locator("#city-upcoming .city-note").innerText()).includes(
        "UTC+8",
      ),
      "周末明确日期范围",
    );
    await page.goBack();
    check(
      (await page.locator("#city-upcoming-title").innerText()) === "近期演出",
      "浏览器返回恢复近期范围",
    );
    await page.locator("#city-actions button").click();
    await page.locator("#city-groups button").first().click();
    await page.locator("#city-upcoming button").first().click();
    check(
      (await page
        .locator("#city-actions button")
        .getAttribute("aria-pressed")) === "true",
      "城市关注状态反馈",
    );
    await page.getByRole("link", { name: "我的关注", exact: true }).click();
    await page.locator('#favorites-content[aria-busy="false"]').waitFor();
    check(
      (await page.locator("#favorites-count").innerText()).startsWith("3 /"),
      "三类关注跨页持久化",
    );
    await page.reload();
    check(
      (await page.locator("#favorites-count").innerText()).startsWith("3 /"),
      "刷新保留关注",
    );
    check(
      (await page.locator("#favorites-upcoming li").count()) > 0,
      "聚合相关近期演出",
    );
    check(
      (await page.locator("#follow-status").count()) === 0,
      "关注页仅一处存储说明",
    );
    await screenshot("favorites-1440.png");
    await page.locator("#favorites-groups li a").first().click();
    check(
      (await page
        .locator("header button[data-follow-type=group]")
        .getAttribute("aria-pressed")) === "true",
      "团体详情读取已有关注",
    );
    await page.goBack();
    check(page.url().endsWith("favorites.html"), "团体深链返回关注页");
    await page.locator("#favorites-cities button").focus();
    check(
      await page
        .locator("#favorites-cities button")
        .evaluate(
          (node) => window.getComputedStyle(node).outlineStyle !== "none",
        ),
      "键盘焦点可见",
    );
    await page.keyboard.press("Enter");
    check(
      (await page.locator("#favorites-count").innerText()).startsWith("2 /"),
      "键盘移除关注",
    );
    check(
      await page
        .locator("#favorites-title")
        .evaluate((node) => node === document.activeElement),
      "移除后焦点可预测",
    );
    await page.locator("#favorites-clear").click();
    await page.locator("#favorites-confirm-no").click();
    check(
      (await page.locator("#favorites-count").innerText()).startsWith("2 /"),
      "取消清空保留资料",
    );
    await page.locator("#favorites-clear").click();
    await page.locator("#favorites-confirm-yes").click();
    check(
      await page.locator("#favorites-empty").isVisible(),
      "确认清空进入空态",
    );
    await page.goto(`${base}/discover.html`);
    await page.locator("#discover-active-city").selectOption("深圳");
    await page.getByRole("button", { name: "记住选择" }).click();
    await page.reload();
    check(
      (await page.locator("#discover-active-city").inputValue()) === "深圳",
      "首页记住主动城市",
    );
    await page.setViewportSize({ width: 375, height: 900 });
    check(await noOverflow(), "发现375无横向溢出");
    await screenshot("discover-375.png");
    await page.goto(`${base}/city.html?city=深圳`);
    check(await noOverflow(), "城市375无横向溢出");
    await screenshot("city-375.png");
    check(
      await page
        .locator("#city-actions button")
        .evaluate(
          (node) =>
            parseFloat(window.getComputedStyle(node).transitionDuration) <=
            0.00001,
        ),
      "减少动画设置生效",
    );
    await page.locator("#city-actions button").click();
    await page.goto(`${base}/favorites.html`);
    check(await noOverflow(), "关注375无横向溢出");
    await screenshot("favorites-375.png");
    await page.evaluate(() =>
      window.localStorage.setItem("idol.preferences.v1", "{broken"),
    );
    await page.reload();
    check(
      (await page.locator("#favorites-storage").innerText()).includes(
        "已保留原数据",
      ),
      "损坏存储明确降级",
    );
    await screenshot("favorites-corrupt-375.png");
    await page.goto(`${base}/city.html?city=深圳`);
    await page.locator("#city-actions button").click();
    check(
      (await page.evaluate(() =>
        window.localStorage.getItem("idol.preferences.v1"),
      )) === "{broken",
      "损坏原字节不覆盖",
    );
    await page.goto(`${base}/city.html?city=unknown`);
    check(
      (await page.locator("#city-content").innerText()).includes("未找到"),
      "未知城市安全空态",
    );
    check(errors.length === 0, "正常路径无脚本异常");
    await page.evaluate(() =>
      window.localStorage.removeItem("idol.preferences.v1"),
    );
    await page.goto(`${base}/groups.html`);
    await page.setViewportSize({ width: 1440, height: 1050 });
    check(await noOverflow(), "团体列表1440无横向溢出");
    const first = page
      .locator("#groups-results button[data-follow-type=group]")
      .first();
    await first.click();
    check(
      (await first.getAttribute("aria-pressed")) === "true",
      "团体卡关注操作",
    );
    await screenshot("groups-1440.png");
    await page.locator("#groups-next").click();
    const next = page
      .locator("#groups-results button[data-follow-type=group]")
      .first();
    await next.click();
    check(
      (await next.getAttribute("aria-pressed")) === "true",
      "翻页后关注按钮重新绑定",
    );
    await page.setViewportSize({ width: 375, height: 900 });
    check(await noOverflow(), "团体列表375无横向溢出");
    await screenshot("groups-375.png");
    await page.locator("#groups-results h3 a").first().click();
    await page.locator('header button[data-follow-type="group"]').waitFor();
    check(
      (await page
        .locator('header button[data-follow-type="group"]')
        .getAttribute("aria-pressed")) === "true",
      "团体卡关注跨页传递到详情",
    );
    check(await noOverflow(), "团体详情375无横向溢出");
    await screenshot("group-375.png");
    await page.setViewportSize({ width: 1440, height: 1050 });
    check(await noOverflow(), "团体详情1440无横向溢出");
    await screenshot("group-1440.png");
  } finally {
    await context.close();
  }
  const disabled = await browser.newContext({
    viewport: { width: 375, height: 900 },
  });
  try {
    await disabled.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new window.DOMException("disabled", "SecurityError");
        },
      }),
    );
    const p = await disabled.newPage();
    await p.goto(`${base}/city.html?city=深圳`);
    await p.locator("#city-actions button").click();
    check(
      (await p.locator("#city-actions button").getAttribute("aria-pressed")) ===
        "true",
      "禁用存储仍可当前页关注",
    );
    check(
      (await p.locator("#follow-status").innerText()).includes("仅暂存"),
      "禁用存储显示暂存边界",
    );
    await p.screenshot({
      path: path.join(output, "city-storage-disabled-375.png"),
      fullPage: true,
    });
    await p.reload();
    check(
      (await p.locator("#city-actions button").getAttribute("aria-pressed")) ===
        "false",
      "暂存刷新不伪装持久化",
    );
  } finally {
    await disabled.close();
  }
  const failure = await browser.newContext({
    viewport: { width: 375, height: 900 },
  });
  try {
    await failure.route("**/assets/groups-data.js", (route) => route.abort());
    const p = await failure.newPage();
    await p.goto(`${base}/city.html?city=深圳`);
    check(
      (await p.locator("#city-content").innerText()).includes("无法读取"),
      "主档加载失败不伪装无活动",
    );
    await p.screenshot({
      path: path.join(output, "city-data-error-375.png"),
      fullPage: true,
    });
  } finally {
    await failure.close();
  }
  const loading = await browser.newContext({
    viewport: { width: 375, height: 900 },
  });
  try {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await loading.route("**/assets/city.js", async (route) => {
      await gate;
      await route.continue();
    });
    const p = await loading.newPage();
    await p.goto(`${base}/city.html?city=深圳`, { waitUntil: "commit" });
    await p.locator('#city-content[aria-busy="true"]').waitFor();
    check(
      (await p.locator("#city-content").innerText()).includes("正在读取"),
      "脚本未就绪显示真实加载状态",
    );
    await p.screenshot({
      path: path.join(output, "city-loading-375.png"),
      fullPage: true,
    });
    release();
    await p.locator('#city-content[aria-busy="false"]').waitFor();
  } finally {
    await loading.close();
  }
  const result = { base, checkedAt: new Date().toISOString(), checks, errors };
  await writeFile(
    path.join(output, "browser-results.json"),
    JSON.stringify(result, null, 2) + "\n",
    "utf8",
  );
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE
      ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
      : "playwright"
  );
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
  });
  try {
    const result = await runBrowserChecks(browser, {
      base: process.env.CITY_PREVIEW_URL,
      output: process.env.CITY_REPORT_DIR,
    });
    console.log(`${result.checks.length} 项浏览器检查通过`);
  } finally {
    await browser.close();
  }
}

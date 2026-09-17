import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// 可复跑浏览器验收。PLAYWRIGHT_MODULE 指向宿主已有模块，不改变项目依赖。
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = path.resolve("reports/console-ui");
await mkdir(output, { recursive: true });
const fixturePassword = process.env.IDOL_UI_FIXTURE_PASSWORD;
if (!fixturePassword)
  throw new Error("请通过 IDOL_UI_FIXTURE_PASSWORD 注入一次性合成测试密码");
const credentials = { username: "ui-fixture-admin", password: fixturePassword };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "zh-CN",
});
const page = await context.newPage();
const checks = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
const screenshot = async (name) => {
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
  });
};
const ready = async () => {
  await page.waitForFunction(
    () =>
      document.querySelector("#view").getAttribute("aria-busy") === "false" &&
      !document.querySelector("#console").hidden,
  );
};
const nav = async (name) => {
  await page.locator(`[data-view="${name}"]`).click();
  await page.waitForFunction(
    (name) =>
      location.hash === `#${name}` &&
      document
        .querySelector(`[data-view="${name}"]`)
        .getAttribute("aria-current") === "page" &&
      document.querySelector("#view").getAttribute("aria-busy") === "false",
    name,
  );
};
const login = async () => {
  await page.getByLabel("管理员账号").fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.locator("#login-submit").click();
  await page.locator("#console").waitFor({ state: "visible" });
  await ready();
};
try {
  await page.goto("http://127.0.0.1:8791/admin/");
  await page.locator("#login-submit:enabled").waitFor();
  await screenshot("login-1440");
  check("匿名页面无私人 DOM", (await page.locator("#view").innerText()) === "");
  await login();
  await screenshot("overview-1440");
  check("真实登录与总览", (await page.locator(".metric").count()) === 4);
  await page.locator("#range").selectOption("7");
  await ready();
  await page.getByText("查看每日数据表", { exact: true }).click();
  check(
    "每日折线范围与数据表",
    (await page.locator(".chart-details table tbody tr").count()) === 7,
  );
  const province = page.locator(".province").first();
  await province.focus();
  await page.keyboard.press("Enter");
  check(
    "省级地图键盘选择",
    (await page.locator(".map-selection").innerText()).includes("次浏览"),
  );
  const fills = await page
    .locator(".province")
    .evaluateAll((nodes) => [
      ...new Set(nodes.map((node) => node.getAttribute("fill"))),
    ]);
  check("省级热力亮度有差异", fills.length > 2);
  await nav("regions");
  await screenshot("regions-1440");
  await page.getByText("地图来源与授权说明", { exact: true }).click();
  check(
    "地图授权说明可展开",
    await page
      .getByRole("link", { name: "CC BY 4.0", exact: false })
      .isVisible(),
  );
  await nav("feedback");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await ready();
  check(
    "反馈分页可到末页",
    await page
      .getByRole("button", { name: "下一页", exact: true })
      .isDisabled(),
  );
  await page.locator("#feedback-filter").focus();
  await page.locator("#feedback-filter").selectOption("pending");
  await ready();
  check(
    "筛选重置第一页并恢复焦点",
    (await page.locator(".pagination").innerText()).includes("1 /") &&
      (await page
        .locator("#feedback-filter")
        .evaluate((node) => node === document.activeElement)),
  );
  await page
    .getByRole("button", { name: /^查看处理：/ })
    .first()
    .click();
  check(
    "反馈文本防注入",
    (await page.locator(".detail-panel img").count()) === 0 &&
      (await page.locator(".detail-panel").innerText()).includes("<img"),
  );
  await page
    .locator("#review-note")
    .fill("合成验收：保存失败后保留，再保存成功。");
  await page.route("**/api/v1/admin/feedback/*", (route) =>
    route.fulfill({
      status: 503,
      json: { code: 503, data: null, message: "合成网络故障" },
    }),
  );
  await page.getByRole("button", { name: "保存处理结果" }).click();
  await page.getByText("合成网络故障；输入仍保留。", { exact: true }).waitFor();
  check(
    "保存失败保留输入",
    (await page.locator("#review-note").inputValue()).startsWith("合成验收"),
  );
  await screenshot("feedback-error-1440");
  await page.unroute("**/api/v1/admin/feedback/*");
  await page.locator("#review-status").selectOption("reviewing");
  await page.getByRole("button", { name: "保存处理结果" }).click();
  await page
    .getByText("处理结果已加密保存；该记录已移出当前状态筛选。", {
      exact: true,
    })
    .waitFor();
  check(
    "审核真实保存并同步筛选",
    await page.locator(".detail-panel").isHidden(),
  );
  await page.locator("#feedback-filter").selectOption("reviewing");
  await ready();
  await page
    .getByRole("button", { name: /^查看处理：/ })
    .first()
    .click();
  check(
    "审核真实读回",
    (await page.locator("#review-note").inputValue()).startsWith("合成验收"),
  );
  await screenshot("feedback-1440");
  await page.keyboard.press("Escape");
  check(
    "详情 Esc 关闭并返回触发器",
    (await page.locator(".detail-panel").isHidden()) &&
      (
        await page.evaluate(() =>
          document.activeElement.getAttribute("aria-label"),
        )
      ).startsWith("查看处理"),
  );
  await page.locator("#feedback-filter").selectOption("");
  await ready();
  const reopenButtons = page.getByRole("button", { name: /^查看处理：/ });
  await reopenButtons.first().click();
  const originalTitle = await page.locator(".detail-panel h3").innerText();
  await page
    .locator("#review-note")
    .fill("延迟 PATCH 合成验收：响应后仍应显示新意见。");
  await page.locator("#review-status").selectOption("resolved");
  let releasePatch;
  let patchArrived;
  const heldPatch = new Promise((resolve) => {
    releasePatch = resolve;
  });
  const patchReceived = new Promise((resolve) => {
    patchArrived = resolve;
  });
  await page.route("**/api/v1/admin/feedback/*", async (route) => {
    const response = await route.fetch();
    patchArrived();
    await heldPatch;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "保存处理结果" }).click();
  await patchReceived;
  check(
    "延迟PATCH期间同记录与其他记录按钮均禁用",
    await reopenButtons.evaluateAll(
      (nodes) => nodes.length > 1 && nodes.every((node) => node.disabled),
    ),
  );
  // 强制派发事件覆盖守卫本身，避免仅验证按钮的 disabled 样式。
  await reopenButtons.first().dispatchEvent("click");
  await reopenButtons.nth(1).dispatchEvent("click");
  check(
    "延迟PATCH不能替换保存中表单",
    (await page.locator(".detail-panel h3").innerText()) === originalTitle &&
      (await page.locator("#review-note").inputValue()) ===
        "延迟 PATCH 合成验收：响应后仍应显示新意见。",
  );
  await screenshot("feedback-pending-1440");
  releasePatch();
  await page.getByText("处理结果已加密保存。", { exact: true }).waitFor();
  await page.unroute("**/api/v1/admin/feedback/*");
  await reopenButtons.first().click();
  check(
    "延迟PATCH响应同步列表及重开详情",
    (await page.locator("#review-status").inputValue()) === "resolved" &&
      (await page.locator("#review-note").inputValue()).startsWith(
        "延迟 PATCH",
      ) &&
      (await page
        .locator("tbody tr")
        .first()
        .locator(".status-pill")
        .innerText()) === "已处理",
  );
  await nav("visits");
  check(
    "完整合成 IPv4 与 IPv6",
    (await page.locator("#view").innerText()).includes("192.0.2.") &&
      (await page.locator("#view").innerText()).includes("2001:db8::10"),
  );
  await screenshot("visits-1440");
  await nav("content");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  check(
    "内容巡检超过50条可翻页",
    (await page.locator("tbody tr").count()) === 8,
  );
  await page.getByRole("searchbox").fill("不存在的合成团体");
  check(
    "内容搜索空态",
    await page.getByText("没有匹配的档案", { exact: true }).isVisible(),
  );
  await nav("settings");
  await page.locator("#feedback-notice").fill("本机合成验收提示");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByText("设置已保存。", { exact: true }).waitFor();
  await page.locator("#refresh").click();
  await ready();
  check(
    "设置真实保存读回",
    (await page.locator("#feedback-notice").inputValue()) ===
      "本机合成验收提示",
  );
  await nav("security");
  await screenshot("security-1440");
  check(
    "安全审计读取真实服务",
    (await page.locator("#view").innerText()).includes("AES-256-GCM"),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  for (const name of [
    "overview",
    "regions",
    "feedback",
    "visits",
    "content",
    "settings",
    "security",
  ]) {
    await nav(name);
    await screenshot(`${name}-375`);
    check(
      `375px ${name} 无页面横向溢出`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "减少动画设置",
    await page
      .locator("#view")
      .evaluate((node) => getComputedStyle(node).animationName === "none"),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  let releaseSlow;
  const slow = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  await page.route("**/api/v1/admin/dashboard?*", async (route) => {
    const result = await route.fetch();
    await slow;
    await route.fulfill({ response: result }).catch(() => {});
  });
  await page.locator('[data-view="overview"]').click();
  await page.locator('[data-view="settings"]').click();
  await ready();
  releaseSlow();
  await page.unroute("**/api/v1/admin/dashboard?*");
  await page.waitForTimeout(200);
  check(
    "慢请求不能覆盖较新的页面",
    (await page.locator("#feedback-notice").isVisible()) &&
      (await page.locator(".metric-strip").count()) === 0,
  );
  await page.route("**/api/v1/admin/dashboard?*", (route) =>
    route.fulfill({
      json: {
        code: 0,
        message: "成功",
        data: {
          days: [],
          regions: [],
          totalPv: 0,
          dailyUv: 0,
          pending: 0,
          firstDay: null,
          generatedAt: Date.now(),
        },
      },
    }),
  );
  await nav("overview");
  await screenshot("empty-1440");
  check(
    "无采集历史展示真实空态",
    await page
      .getByText(
        "尚无访问记录。统计会从功能启用后开始，之前的日期没有历史数据。",
        { exact: true },
      )
      .isVisible(),
  );
  await page.unroute("**/api/v1/admin/dashboard?*");
  await nav("visits");
  await context.clearCookies();
  await page.locator("#refresh").click();
  await page.getByText("登录已过期，请重新登录。", { exact: true }).waitFor();
  check(
    "真实401清除私人DOM及管理员名",
    (await page.locator("#view").innerText()) === "" &&
      (await page.locator("#admin-name").innerText()) === "",
  );
  await login();
  await nav("feedback");
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  );
  check(
    "历史页面隐藏清除私人DOM",
    (await page.locator("#view").innerText()) === "",
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await ready();
  check(
    "历史恢复重新校验会话并恢复页面",
    await page.locator("#feedback-filter").isVisible(),
  );
  await page.locator("#logout").click();
  check(
    "退出点击立即清除私人DOM",
    (await page.locator("#view").innerText()) === "",
  );
  await page.getByText("已安全退出。", { exact: true }).waitFor();
  const response = await context.request.get(
    "http://127.0.0.1:8791/api/v1/admin/session",
  );
  check("真实退出服务端会话失效", response.status() === 401);
  await login();
  const sessionResponse = await context.request.get(
    "http://127.0.0.1:8791/api/v1/admin/session",
  );
  const sessionData = (await sessionResponse.json()).data;
  check(
    "服务端返回有效绝对剩余期限",
    Number.isFinite(sessionData.absoluteRemainingMs) &&
      sessionData.absoluteRemainingMs > 0 &&
      sessionData.absoluteRemainingMs <= 8 * 3600000,
  );
  await page.clock.install();
  await page.route("**/api/v1/admin/session", async (route) => {
    const actual = await route.fetch();
    const body = await actual.json();
    body.data.absoluteRemainingMs = 60000;
    await route.fulfill({ response: actual, json: body });
  });
  await page.reload();
  await ready();
  await nav("visits");
  await page.clock.runFor(45000);
  await page.locator("#refresh").click();
  await ready();
  check(
    "绝对截止前成功读取私人页面",
    (await page.locator("#console").isVisible()) &&
      (await page.locator("#view").innerText()).includes("192.0.2."),
  );
  let deadlineRequests = 0;
  const countDeadlineRequests = (request) => {
    if (request.url().includes("/api/v1/admin/")) deadlineRequests++;
  };
  page.on("request", countDeadlineRequests);
  await page.clock.runFor(16000);
  page.off("request", countDeadlineRequests);
  check(
    "静止可见页绝对到期无需请求即清除私人DOM",
    deadlineRequests === 0 &&
      (await page.locator("#console").isHidden()) &&
      (await page.locator("#view").innerText()) === "" &&
      (await page.locator("#admin-name").innerText()) === "" &&
      (await page.locator("#login-status").innerText()).includes("最长有效期"),
  );
  await screenshot("absolute-expired-1440");
  await page.unroute("**/api/v1/admin/session");
  await page.clock.resume();
  await page.setViewportSize({ width: 375, height: 812 });
  await screenshot("login-375");
  check("浏览器无未捕获错误", errors.length === 0);
  await writeFile(
    path.join(output, "browser-results.json"),
    JSON.stringify(
      {
        checks,
        count: checks.length,
        errors,
        screenshotNote:
          "全部为本地合成样本；延迟PATCH访问真实后端并延后响应；绝对到期用真实session响应缩短剩余期限与浏览器虚拟时钟验证，不等待实际8小时。历史恢复事件为模拟事件，不能等同于所有浏览器实际BFCache恢复。",
      },
      null,
      2,
    ),
  );
  console.log(
    `管理界面浏览器验收通过：${checks.length} 项；1440px 与 375px 截图已保存。`,
  );
} finally {
  await browser.close();
}

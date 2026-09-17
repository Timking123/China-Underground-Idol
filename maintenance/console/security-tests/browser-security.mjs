import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  evidenceRoot,
  removeFixture,
  storage,
  crypto,
  serverModule,
  repository,
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const id = `browser-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`;
const evidence = path.join(evidenceRoot, id);
const scratch = path.join(evidenceRoot, "work", id);
const admin = path.join(scratch, "public");
mkdirSync(admin, { recursive: true });
mkdirSync(evidence, { recursive: true });
const hashes = {};
for (const name of ["index.html", "admin.css", "admin.js"]) {
  const content = readFileSync(
    path.join(repository, ".build/console/public", name),
  );
  hashes[`public/${name}`] = createHash("sha256").update(content).digest("hex");
  writeFileSync(path.join(admin, name), content);
}
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const store = new storage.ConsoleStore(
  path.join(scratch, "data"),
  randomBytes(32),
);
const password = randomBytes(32).toString("base64url");
store.put(
  "account",
  "admin",
  {
    username: "security-browser-admin",
    passwordHash: await crypto.hashPassword(password),
    version: randomUUID(),
  },
  Date.now(),
);
const privateText =
  '<img src="https://attacker.invalid/pixel" onerror="window.securityInjected=1">SECURITY-PRIVATE-DOM';
const record = store.createFeedback(
  {
    kind: "feedback",
    target: "合成安全记录",
    details: privateText,
    contact: "browser-synthetic@example.invalid",
    source: "https://example.invalid/source",
    consent: true,
    website: "",
    requestId: randomUUID(),
  },
  "192.0.2.231",
  Date.now(),
);
const server = serverModule.createConsoleServer({
  store,
  origin,
  trustedProxy: false,
  devStatic: true,
  adminDirectory: admin,
  geo: {
    ready: false,
    locate: async () => ({ country: "未知", province: "未知", city: "未知" }),
    close() {},
  },
});
server.listen(port, "127.0.0.1");
await once(server, "listening");
const checks = [];
const errors = [];
let browser;
let failure;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      errors.push("外部网络请求");
      await route.abort();
    } else await route.continue();
  });
  page.on("pageerror", (error) => errors.push(error.name));
  const check = (name, valid) => {
    assert.ok(valid, name);
    checks.push(name);
  };
  const login = async () => {
    await page.locator("#login-submit:enabled").waitFor();
    await page.locator("#username").fill("security-browser-admin");
    await page.locator("#password").fill(password);
    await page.locator("#login-submit").click();
    await page.locator("#console").waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        document.querySelector("#view").getAttribute("aria-busy") === "false",
    );
  };
  await page.goto(`${origin}/admin/#feedback`);
  check(
    "SEC-UI-01 匿名入口不存在私人正文",
    !(await page.locator("body").innerText()).includes("SECURITY-PRIVATE-DOM"),
  );
  await login();
  await page.locator("table button").first().click();
  check(
    "SEC-UI-02 恶意投稿仅作为文本展示",
    (await page.locator(".detail-panel").innerText()).includes(privateText) &&
      (await page.locator("#view img").count()) === 0 &&
      !(await page.evaluate(() => window.securityInjected)),
  );
  check(
    "SEC-UI-03 管理员可见合成完整IP和联系方式",
    (await page.locator(".detail-panel").innerText()).includes("192.0.2.231") &&
      (await page.locator(".detail-panel").innerText()).includes(
        "browser-synthetic@example.invalid",
      ),
  );

  let releaseResponse;
  let patchArrived;
  const held = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const arrived = new Promise((resolve) => {
    patchArrived = resolve;
  });
  await page.route(`**/api/v1/admin/feedback/${record.id}`, async (route) => {
    const response = await route.fetch();
    patchArrived();
    await held;
    await route.fulfill({ response });
  });
  await page.locator("#review-note").fill("独立安全复核-新意见");
  await page.locator("#review-status").selectOption("resolved");
  await page.getByRole("button", { name: "保存处理结果", exact: true }).click();
  await arrived;
  try {
    check(
      "SEC-UI-04 已提交但响应未返回时禁止重开详情",
      await page.locator("table button").first().isDisabled(),
    );
    await page.locator("table button").first().dispatchEvent("click");
    check(
      "SEC-UI-05 直接分发重开事件仍保留保存中意见",
      (await page.locator("#review-note").inputValue()) ===
        "独立安全复核-新意见",
    );
  } finally {
    releaseResponse();
  }
  await page
    .locator(".form-status")
    .filter({ hasText: "处理结果已加密保存。" })
    .waitFor();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.locator("table button").first().click();
  check(
    "SEC-UI-06 保存后重开得到新状态和意见",
    (await page.locator("#review-status").inputValue()) === "resolved" &&
      (await page.locator("#review-note").inputValue()) ===
        "独立安全复核-新意见",
  );
  check(
    "SEC-UI-07 真实后端同步保存",
    store.get("feedback", record.id).note === "独立安全复核-新意见",
  );
  await page.unroute(`**/api/v1/admin/feedback/${record.id}`);

  await page.locator("#logout").click();
  await page.locator("#login-submit:enabled").waitFor();
  check(
    "SEC-UI-08 退出立即移除私人DOM",
    (await page.locator("#view").innerText()) === "" &&
      !(await page.locator("body").innerText()).includes(
        "browser-synthetic@example.invalid",
      ),
  );
  await login();
  await page.clock.install();
  await page.route("**/api/v1/admin/session", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    assert.equal(response.status(), 200);
    assert.ok(payload.data.absoluteRemainingMs > 0);
    payload.data.absoluteRemainingMs = 60000;
    await route.fulfill({ response, json: payload });
  });
  await page.reload();
  await page.locator("#console").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("#view").getAttribute("aria-busy") === "false",
  );
  await page.locator("table button").first().click();
  await page.clock.runFor(45000);
  await page.locator("#refresh").click();
  await page.waitForFunction(
    () => document.querySelector("#view").getAttribute("aria-busy") === "false",
  );
  check(
    "SEC-UI-09 普通API刷新后私人视图仍正常",
    await page.locator("#console").isVisible(),
  );
  await page.clock.runFor(16000);
  check(
    "SEC-UI-10 无需新请求，绝对期限到达即清除私人DOM",
    (await page.locator("#login").isVisible()) &&
      (await page.locator("#view").innerText()) === "",
  );
  await page.screenshot({ path: path.join(evidence, "absolute-expiry.png") });
  await page.clock.resume();
  await page.unroute("**/api/v1/admin/session");
  await page.setViewportSize({ width: 375, height: 812 });
  await login();
  await page.locator("table button").first().click();
  check(
    "SEC-UI-11 窄屏恶意正文仍无可执行节点",
    (await page.locator(".detail-panel").innerText()).includes(privateText) &&
      (await page.locator("#view img").count()) === 0,
  );
  await page.locator("#logout").click();
  check(
    "SEC-UI-12 窄屏退出清除私人DOM",
    (await page.locator("#view").innerText()) === "",
  );
  await page.screenshot({ path: path.join(evidence, "logout-375.png") });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.message;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  store.close();
  removeFixture(scratch);
  const manifest = {
    sourceSnapshot: process.env.CONSOLE_SECURITY_SOURCE_ROOT,
    uiHashes: hashes,
    checks,
    errors,
    failure: failure ?? null,
    passed: !failure && checks.length === 12,
    scope:
      "本机合成浏览器安全复核；绝对期限缩为60秒并推进时钟，非实际等待8小时；不是视觉全量验收",
  };
  writeFileSync(
    path.join(evidence, "result.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `浏览器安全用例 ${checks.length}/12，${manifest.passed ? "通过" : "失败"}；证据：${path.relative(repository, evidence)}`,
  );
  if (failure) console.error(failure);
  process.exitCode = manifest.passed ? 0 : 1;
}

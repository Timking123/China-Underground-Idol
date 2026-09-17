import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { publicFiles } from "../scripts/siteManifest.mjs";

// 使用宿主已有浏览器；HTTP 替身仅监听本机，不向真实接口提交反馈。
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = path.join(root, "reports/console-integration");
await mkdir(evidence, { recursive: true });
const assets = new Map();
for (const name of ["contribute", "metrics"]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [
      name === "contribute" ? "src/content/page.ts" : "src/metrics/page.ts",
    ],
    bundle: true,
    format: "iife",
    write: false,
    charset: "utf8",
  });
  assets.set(`assets/${name}.js`, result.outputFiles[0].text);
}
let responseMode = "ok";
let acceptFeedback = true;
let notice = "";
const submissions = [];
const receivedIds = new Map();
const events = [];
const server = createServer(async (request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  const reply = (data, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        code: status >= 400 ? status : 0,
        data,
        message: "合成测试",
      }),
    );
  };
  if (route === "/api/v1/public-config") {
    reply({ acceptFeedback, feedbackNotice: notice, analyticsEnabled: true });
    return;
  }
  if (route === "/api/v1/pageviews") {
    request.resume();
    events.push(request.headers.referer ?? "");
    reply({ recorded: true });
    return;
  }
  if (route === "/api/v1/feedback") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    submissions.push({ data, referer: request.headers.referer });
    if (!receivedIds.has(data.requestId))
      receivedIds.set(data.requestId, `test-feedback-${receivedIds.size + 1}`);
    if (responseMode === "lost") {
      request.socket.destroy();
      return;
    }
    if (responseMode === "fail") {
      reply(null, 503);
      return;
    }
    if (responseMode === "malformed") {
      reply({});
      return;
    }
    reply({ id: receivedIds.get(data.requestId) }, 201);
    return;
  }
  const name = route.slice(1);
  if (!publicFiles.includes(name)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const bytes = assets.get(name) ?? (await readFile(path.join(root, name)));
    response.writeHead(200, {
      "Content-Type": name.endsWith(".html")
        ? "text/html; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".js")
            ? "text/javascript"
            : "application/octet-stream",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/contribute.html`);
  await page.waitForFunction(
    () => !document.querySelector("#online-submit").disabled,
  );
  await page.locator("#draft-target").fill("合成测试页面");
  await page.locator("#draft-details").fill("浏览器接入测试，无真实私人资料。");
  assert.equal(submissions.length, 0);
  await page.locator("#online-submit").click();
  assert.equal(submissions.length, 0);
  assert.match(await page.locator("#draft-status").textContent(), /请先勾选/u);
  await page.locator("#online-consent").check();
  responseMode = "lost";
  await page.locator("#online-submit").click();
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("内容已保留"),
  );
  assert.equal(
    await page.locator("#draft-details").inputValue(),
    "浏览器接入测试，无真实私人资料。",
  );
  const retryId = submissions.at(-1).data.requestId;
  responseMode = "ok";
  await page.locator("#online-submit").click();
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("反馈编号"),
  );
  assert.equal(submissions.at(-1).data.requestId, retryId);
  assert.equal(receivedIds.size, 1);
  assert.equal(await page.locator("#online-submit").isDisabled(), true);
  checks.push("用户点击与隐私确认后才上传；断线保留输入；重复请求沿用编号");
  for (const kind of [
    "submission",
    "error",
    "event",
    "outdated",
    "rights",
    "feedback",
    "suggestion",
  ]) {
    await page.locator("#draft-kind").selectOption(kind);
    await page.locator("#draft-details").fill(`合成测试类别：${kind}`);
    await page.locator("#online-submit").click();
    await page.waitForFunction(() =>
      document.querySelector("#draft-status").textContent.includes("反馈编号"),
    );
    assert.equal(submissions.at(-1).data.kind, kind);
    assert.equal(submissions.at(-1).referer, undefined);
  }
  checks.push("七类反馈可提交；请求不携带页面 Referer");
  for (const mode of ["fail", "malformed"]) {
    responseMode = mode;
    await page.locator("#draft-details").fill(`失败保留测试：${mode}`);
    await page.locator("#online-submit").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#draft-status")
        .textContent.includes("内容已保留"),
    );
    assert.equal(
      await page.locator("#draft-details").inputValue(),
      `失败保留测试：${mode}`,
    );
  }
  await page.getByRole("button", { name: "生成邮件草稿", exact: true }).click();
  assert.equal(await page.locator("#draft-result").isVisible(), true);
  assert.match(
    await page.locator("#draft-preview").inputValue(),
    /失败保留测试/u,
  );
  checks.push("服务错误与无效响应保留输入，邮件草稿仍可生成");
  responseMode = "ok";
  acceptFeedback = false;
  notice = "<img src=x onerror=alert(1)> 暂停接收";
  await page.reload();
  await page.getByText(notice, { exact: true }).waitFor();
  assert.equal(await page.locator("#online-submit").isDisabled(), true);
  assert.equal(await page.locator(".content-callout img").count(), 0);
  checks.push("暂停收件与通知文本安全渲染");
  acceptFeedback = true;
  notice = "";
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector("#online-submit").disabled,
  );
  await page.locator("#draft-target").fill("合成资料");
  await page.locator("#draft-details").fill("请补充来源，确认后提交。");
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `feedback-${width}.png`),
      fullPage: true,
    });
  }
  checks.push("1440px 与 375px 无横向溢出并留存截图");
  const offlineRoot = path.join(evidence, "offline");
  await mkdir(path.join(offlineRoot, "assets"), { recursive: true });
  // 离线验收复用同一页面与 bundle，不依赖 HTTP 或模块脚本。
  for (const name of [
    "contribute.html",
    "app.css",
    "styles/content.css",
    "styles/site.css",
    "assets/groups-data.js",
  ]) {
    await mkdir(path.dirname(path.join(offlineRoot, name)), {
      recursive: true,
    });
    await writeFile(
      path.join(offlineRoot, name),
      await readFile(path.join(root, name)),
    );
  }
  for (const [name, value] of assets)
    await writeFile(path.join(offlineRoot, name), value);
  const priorCount = submissions.length;
  await page.goto(
    pathToFileURL(path.join(offlineRoot, "contribute.html")).href,
  );
  await page
    .getByText("离线访问可生成邮件草稿；直接提交请打开在线网站。", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator("#online-submit").isDisabled(), true);
  await page.locator("#draft-target").fill("离线草稿");
  await page.locator("#draft-details").fill("仅在本机生成。");
  await page.getByRole("button", { name: "生成邮件草稿", exact: true }).click();
  assert.equal(await page.locator("#draft-result").isVisible(), true);
  assert.equal(submissions.length, priorCount);
  assert.equal(errors.length, 0);
  assert.ok(events.length > 0);
  assert.ok(events.every((referer) => referer === ""));
  checks.push("file:// 不上传，离线提示不被覆盖，邮件后备可用；无页面脚本错误");
  await writeFile(
    path.join(evidence, "browser-results.json"),
    JSON.stringify({ checks, failures: 0 }, null, 2) + "\n",
  );
  console.log(
    `浏览器接入验收通过：${checks.length} 组，七类反馈、幂等、失败、离线和双视口。`,
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

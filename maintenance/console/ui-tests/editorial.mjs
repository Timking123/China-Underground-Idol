import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { createServer } from "node:net";
import { createConsoleServer } from "../server.ts";
import {
  createEditorialFixture,
  editorialTime,
} from "../tests/editorial-fixture.mjs";
import { recordEditorialReceipt } from "../editorial.ts";

// 只使用宿主已安装的浏览器工具，所有编译和截图写入 E 独占报告目录。
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(".");
const output = path.join(root, "reports/city-upgrade-e/ui");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(path.join(output, "synthetic-"));
const password = randomBytes(32).toString("base64url");
const fixture = await createEditorialFixture(directory, password);
const admin = path.join(directory, "admin");
await build({
  absWorkingDir: root,
  entryPoints: ["src/admin/page.ts"],
  outfile: path.join(admin, "admin.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  charset: "utf8",
});
for (const name of ["index.html", "admin.css"])
  await copyFile(
    path.join(root, "maintenance/console/public", name),
    path.join(admin, name),
  );
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = createConsoleServer({
  store: fixture.store,
  origin,
  trustedProxy: false,
  devStatic: true,
  adminDirectory: admin,
  siteDirectory: fixture.site,
  now: () => editorialTime,
  geo: {
    ready: false,
    locate: async () => ({ country: "未知", province: "未知", city: "未知" }),
    close() {},
  },
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  locale: "zh-CN",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
}
async function screenshot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
  });
}
async function ready() {
  await page.waitForFunction(() => {
    const title = { "#editorial": "活动资料修订", "#feedback": "投稿与反馈" }[
      location.hash
    ];
    return (
      document.querySelector("#view")?.getAttribute("aria-busy") === "false" &&
      !document.querySelector("#console")?.hidden &&
      (!title || document.querySelector("#view-title")?.textContent === title)
    );
  });
}
async function fillSource() {
  await page.getByLabel("来源标题", { exact: true }).fill("合成主办方公告");
  await page.getByLabel("发布者", { exact: true }).fill("合成主办方");
  await page.getByLabel("来源类型", { exact: true }).selectOption("organizer");
  await page
    .getByLabel("真实观察时间（UTC）", { exact: true })
    .fill("2026-09-19T01:00:00.000Z");
  await page
    .getByLabel("支持修订的原文摘录", { exact: true })
    .fill("合成验收演出将于合成星光现场举办。");
  await page
    .locator(".editorial-supports")
    .getByLabel("场馆", { exact: true })
    .check();
  await page
    .getByLabel("公开修订依据", { exact: true })
    .fill("已逐字段核对合成主办方原文，本次补充已公布场馆。");
}
try {
  await page.goto(origin + "/admin/");
  await page.getByLabel("管理员账号", { exact: true }).fill("editorial-admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录管理后台" }).click();
  await ready();
  await page.locator('[data-view="editorial"]').click();
  await ready();
  check(
    "空列表准确表达尚无修订",
    await page.getByText("尚无结构化修订。", { exact: false }).isVisible(),
  );
  await page.locator('[data-view="feedback"]').click();
  await ready();
  await page.getByRole("button", { name: "查看处理：", exact: false }).click();
  await page.getByRole("button", { name: "整理活动修订", exact: true }).click();
  await ready();
  check(
    "投稿编号与活动稳定身份自动带入",
    (await page.getByLabel("关联投稿编号").inputValue()) ===
      fixture.feedback.id &&
      (await page.getByLabel("目标活动").inputValue()) ===
        fixture.input.target.id,
  );
  await page.getByLabel("修订场馆", { exact: true }).check();
  const venue = page
    .locator(".editorial-patch-field")
    .filter({ has: page.getByLabel("修订场馆", { exact: true }) });
  await venue.getByLabel("尚未公布 / 未知", { exact: true }).uncheck();
  await venue.getByLabel("场馆", { exact: true }).fill("合成星光现场");
  await fillSource();
  check(
    "表单提供真实前后差异",
    await page
      .locator(".editorial-diff")
      .innerText()
      .then(
        (text) => text.includes("尚未公布") && text.includes("合成星光现场"),
      ),
  );
  check(
    "活动状态以中文显示",
    await page.getByText("当前：尚未核实", { exact: true }).isVisible(),
  );
  await screenshot("desktop-editor");
  await page.setViewportSize({ width: 375, height: 812 });
  check(
    "375px 修订表单没有横向溢出",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await screenshot("mobile-editor");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "保存修订并待审核" }).click();
  await page
    .getByRole("heading", { name: "待审核 · 第 1 版", exact: true })
    .waitFor();
  check(
    "未归档证据显示待核验且不能审核",
    await page
      .getByRole("button", { name: "核验通过", exact: true })
      .isDisabled(),
  );
  await page.getByRole("button", { name: "编辑修订 / 重载基线" }).click();
  await page
    .getByText("维护归档关联（尚未归档可留空）", { exact: true })
    .click();
  await page
    .getByLabel("维护证据编号", { exact: true })
    .fill("synthetic-editorial-capture");
  // 使用真实 API 失败响应核实输入保留，不修改 DOM 或模拟成功状态。
  await page
    .getByLabel("公开来源链接", { exact: true })
    .fill("http://127.0.0.1/private");
  await page.getByRole("button", { name: "保存修订并待审核" }).click();
  await page
    .getByText("证据须为不含凭据的公开网页链接；输入仍保留。", { exact: true })
    .waitFor();
  check(
    "保存错误保留表单",
    (await venue.getByLabel("场馆", { exact: true }).inputValue()) ===
      "合成星光现场",
  );
  await page
    .getByLabel("公开来源链接", { exact: true })
    .fill("https://example.org/editorial-proof");
  await page.getByRole("button", { name: "保存修订并待审核" }).click();
  await page
    .getByRole("heading", { name: "待审核 · 第 2 版", exact: true })
    .waitFor();
  await page
    .getByLabel("内部处理说明", { exact: true })
    .fill("已核验合成归档来源与所改字段");
  await page.getByRole("button", { name: "核验通过", exact: true }).click();
  await page
    .getByRole("heading", { name: "已审核待交付 · 第 3 版", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "交付维护候选", exact: true }).click();
  await page
    .getByRole("heading", { name: "已交付待维护 · 第 4 版", exact: true })
    .waitFor();
  check(
    "交付后只显示待维护并提供候选",
    await page.getByRole("button", { name: "下载受限候选" }).isVisible(),
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载受限候选" }).click(),
  ]);
  check("候选可下载", download.suggestedFilename().startsWith("editorial-"));
  await screenshot("desktop-handoff");
  await page.setViewportSize({ width: 375, height: 812 });
  check(
    "375px 页面没有横向溢出",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await screenshot("mobile-handoff");
  await page
    .getByLabel("内部处理说明", { exact: true })
    .fill("合成来源待重新核验，请求撤回");
  await page.getByRole("button", { name: "申请撤回候选", exact: true }).click();
  await page
    .getByRole("heading", { name: "等待维护确认撤回 · 第 5 版", exact: true })
    .waitFor();
  check(
    "撤回不会伪造完成状态",
    await page
      .getByText("已请求撤回，等待维护确认。", { exact: false })
      .isVisible(),
  );
  const revision = fixture.store.recordPage("editorial", 1, 20).items[0];
  recordEditorialReceipt(
    fixture.store,
    revision.id,
    {
      schemaVersion: "idol-editorial-receipt-v1",
      candidateId: revision.candidate.candidateId,
      candidateSha256: revision.candidateSha256,
      baselineSha256: revision.baselineSha256,
      resultSha256: null,
      snapshotManifestSha256: null,
      status: "withdrawn",
      runId: "synthetic-ui-maintenance",
      publicationId: null,
      message: "合成维护确认候选尚未应用，撤回完成。",
      completedAt: new Date(editorialTime).toISOString(),
    },
    "synthetic-maintenance",
    editorialTime,
  );
  await page.getByRole("button", { name: "刷新维护结果" }).click();
  await page.getByRole("button", { name: "已撤回 ·", exact: false }).click();
  await page
    .getByText("合成维护确认候选尚未应用，撤回完成。", { exact: true })
    .waitFor();
  check(
    "UI通过真实HTTP读取可信模块回执",
    await page.getByRole("heading", { name: "已撤回 · 第 6 版" }).isVisible(),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  check(
    "键盘焦点可见且减少动画生效",
    await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        active !== document.body &&
        getComputedStyle(document.querySelector("button"))
          .transitionDuration.split(",")
          .every((value) => parseFloat(value) <= 0.01)
      );
    }),
  );
  await screenshot("mobile-receipt");
  await page.setViewportSize({ width: 1440, height: 1050 });
  check(
    "1440px 页面没有横向溢出",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await screenshot("desktop-receipt");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.locator("#login").waitFor({ state: "visible" });
  check(
    "退出清空修订私有节点",
    (await page.locator("#view").innerText()) === "",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "checks.json"),
    JSON.stringify(
      {
        checks,
        browserErrors: errors,
        screenshots: [
          "desktop-editor",
          "mobile-editor",
          "desktop-handoff",
          "mobile-handoff",
          "mobile-receipt",
          "desktop-receipt",
        ],
        limitation: "回执由可信本地模块写入合成结果；完整维护发布由 F 验证。",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    `编辑工作台真实浏览器验收通过：${checks.length} 项，截图位于 reports/city-upgrade-e/ui。`,
  );
} catch (error) {
  await screenshot("failure");
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fixture.store.close();
  assert.ok(directory.startsWith(output + path.sep));
  await rm(directory, { recursive: true, force: true });
}

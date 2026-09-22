import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import {
  readFile,
  writeFile,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { ConsoleStore } from "../store.ts";
import { hashPassword } from "../crypto.ts";
import { createConsoleServer } from "../server.ts";

// 只复制已完成的合成测试库；生产库、原测试库及发布目录均不写入。
const root = path.resolve(".");
const successPath = path.resolve(
  process.env.EDITORIAL_SUCCESS_FILE ||
    "reports/city-upgrade-f/local-editorial-success.json",
);
const success = JSON.parse(await readFile(successPath, "utf8"));
const fixtureRoot =
  path.join(root, "reports/city-upgrade-f/local-editorial-tests") + path.sep;
assert.ok(
  path.resolve(success.directory).startsWith(fixtureRoot),
  "仅接受 F 明确的合成夹具",
);
assert.ok(
  path
    .resolve(success.output)
    .startsWith(path.resolve(success.directory) + path.sep),
);
const snapshotBytes = await readFile(
  path.join(success.output, "snapshot.json"),
);
const snapshotHash = createHash("sha256").update(snapshotBytes).digest("hex");
const completion = JSON.parse(
  await readFile(path.join(success.output, "completed.json"), "utf8"),
);
assert.equal(snapshotHash, success.snapshotManifestSha256);
assert.equal(completion.receipt.snapshotManifestSha256, snapshotHash);
assert.equal(completion.receipt.status, "applied");
const originalFiles = await readdir(path.join(success.directory, "private"));
assert.deepEqual(
  originalFiles,
  ["console.sqlite"],
  "原合成库须已关闭并完成 WAL 检查点",
);
const output = path.join(root, "reports/city-upgrade-e/maintenance-readback");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(output, "synthetic-"));
await mkdir(path.join(temporary, "private"));
await copyFile(
  path.join(success.directory, "private/console.sqlite"),
  path.join(temporary, "private/console.sqlite"),
);
const key = await readFile(path.join(success.directory, "synthetic.key"));
const store = new ConsoleStore(path.join(temporary, "private"), key);
const password = randomBytes(32).toString("base64url");
store.put(
  "account",
  "admin",
  { username: "readback-admin", passwordHash: await hashPassword(password) },
  Date.now(),
);
const admin = path.join(temporary, "admin");
await mkdir(admin);
await build({
  absWorkingDir: root,
  entryPoints: ["src/admin/page.ts"],
  outfile: path.join(admin, "admin.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
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
  store,
  origin,
  trustedProxy: false,
  devStatic: true,
  adminDirectory: admin,
  siteDirectory: path.join(success.output, "source/.build/site"),
  geo: {
    ready: false,
    locate: async () => ({ country: "未知", province: "未知", city: "未知" }),
    close() {},
  },
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  locale: "zh-CN",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(origin + "/admin/");
  await page.getByLabel("管理员账号", { exact: true }).fill("readback-admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录管理后台" }).click();
  await page.locator("#console").waitFor({ state: "visible" });
  const response = await page.request.get(
    origin + `/api/v1/admin/editorial/${success.revisionId}`,
  );
  assert.equal(response.status(), 200);
  const detail = (await response.json()).data;
  assert.equal(detail.revision.status, "applied");
  assert.equal(detail.revision.receipt.snapshotManifestSha256, snapshotHash);
  assert.deepEqual(detail.revision.receipt, completion.receipt);
  const publishedEvents = await page.request.get(
    origin + "/data/events.v1.json",
  );
  assert.equal(publishedEvents.status(), 200);
  assert.equal(
    createHash("sha256")
      .update(await publishedEvents.body())
      .digest("hex"),
    completion.receipt.resultSha256,
    "发行资料必须保留维护结果的原始字节",
  );
  const dataset = await publishedEvents.json();
  assert.equal(
    dataset.events.find((event) => event.id === detail.revision.target.id)
      .venue,
    "合成星光现场",
  );
  await page.locator('[data-view="editorial"]').click();
  await page
    .getByRole("button", { name: "维护已应用 ·", exact: false })
    .click();
  await page.getByText(completion.receipt.message, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText(`完整快照：${snapshotHash}`, { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await page.getByText("保存时的公开资料", { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.getByText("当前公开基线已变化。", { exact: false }).count(),
    0,
    "已应用结果不再被误报为待交付冲突",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "交付维护候选", exact: true })
      .count(),
    0,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, "desktop-applied.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(output, "mobile-applied.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        snapshotManifestSha256: snapshotHash,
        publicationId: completion.receipt.publicationId,
        revisionId: success.revisionId,
        checks: [
          "完整快照与回执哈希一致",
          "真实HTTP读取维护applied回执",
          "公开候选原字节哈希及实际场馆修订一致",
          "浏览器显示真实维护结果及历史差异",
          "已应用结果不会显示待交付冲突或重复交付按钮",
          "1440px及375px截图且手机无横溢",
          "零浏览器异常",
        ],
        productionDeployment: false,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log("完整维护快照真实 HTTP/浏览器回读通过；7 项检查，未部署。");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  store.close();
  assert.ok(temporary.startsWith(output + path.sep));
  await rm(temporary, { recursive: true, force: true });
}

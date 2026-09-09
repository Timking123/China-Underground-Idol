import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { calls, configure, TARGET } from "./serverWeeklyProbe.fixture.mjs";

const producerURL = new URL("../server/weeklyProbe.ts", import.meta.url).href;
const contractURL = new URL("../src/weeklyContract.ts", import.meta.url).href;
const fixtureURL = new URL("./serverWeeklyProbe.fixture.mjs", import.meta.url)
  .href;
// Node 的测试进程内仅替换这两个精确导入；正式接口没有浏览器或证据注入参数。
register(
  `data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if ((specifier === "playwright" && context.parentURL === ${JSON.stringify(producerURL)}) ||
        (specifier === "./weeklyScope.ts" && context.parentURL === ${JSON.stringify(contractURL)})) {
      return { url: ${JSON.stringify(fixtureURL)}, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`,
  import.meta.url,
);
const { refreshWeeklyPrice } = await import(producerURL);
const { parseWeeklyProviderPrice } = await import(contractURL);

async function fixture(t, patch = {}) {
  configure(patch);
  const temporary = await mkdtemp(path.join(tmpdir(), "idol-weekly-probe-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith("idol-weekly-probe-"));
    assert.equal((await lstat(temporary)).isSymbolicLink(), false);
    await rm(temporary, { recursive: true, force: true });
  });
  const stageRoot = path.join(temporary, "stage");
  const profileRoot = path.join(temporary, "synthetic-profile");
  const root = path.join(stageRoot, "private", "provider-price");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(profileRoot, { mode: 0o700 });
  const current = path.join(root, "current.json");
  const old =
    '{"observedAt":"2000-01-01T00:00:00.000Z","marker":"旧证据不能重盖时间"}\n';
  await writeFile(current, old, { mode: 0o600 });
  return { temporary, stageRoot, profileRoot, root, current, old };
}

async function unchanged(f) {
  assert.equal(await readFile(f.current, "utf8"), f.old);
  await assert.rejects(lstat(path.join(f.root, "observations")), {
    code: "ENOENT",
  });
  await assert.rejects(lstat(path.join(f.root, ".refresh.lock")), {
    code: "ENOENT",
  });
}

test("周更价目测试使用 Node 22 strip-types，完全离线替换浏览器", () => {
  assert.equal(process.versions.node.split(".")[0], "22");
  assert.ok(process.execArgv.includes("--experimental-strip-types"));
});

test("本次四来源与可见价格共同产生实际合约可解析的新证据", async (t) => {
  const f = await fixture(t);
  const before = Date.now();
  const result = await refreshWeeklyPrice(f);
  const bytes = await readFile(f.current);
  const price = parseWeeklyProviderPrice(bytes, new Date());
  assert.ok(Date.parse(price.observedAt) >= before);
  assert.ok(Date.parse(price.observedAt) <= Date.now());
  assert.equal(
    price.accountScopeHash,
    createHash("sha256").update("9000000001").digest("hex").slice(0, 16),
  );
  assert.equal(result.accountScopeHash, price.accountScopeHash);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(calls.launches.length, 1);
  assert.equal(calls.launches[0].profileRoot, f.profileRoot);
  assert.equal(calls.launches[0].options.locale, "zh-CN");
  assert.equal(calls.launches[0].options.serviceWorkers, "block");
  assert.equal(calls.launches[0].options.acceptDownloads, false);
  assert.equal(calls.navigation.url, price.sources.plan.url);
  assert.deepEqual(
    calls.requests.map((request) => request.url),
    [
      price.sources.account.url,
      price.sources.commands.url,
      price.sources.subscription.url,
    ],
  );
  for (const request of calls.requests) {
    assert.equal(request.options.maxRedirects, 0);
    assert.equal(request.options.maxRetries, 0);
    assert.equal(request.options.headers["Cache-Control"], "no-cache");
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.options.headers.Cookie, undefined);
  }
  assert.deepEqual(calls.disposed, ["account", "commands", "subscription"]);
  assert.equal(calls.closed, 1);
  const observations = await readdir(path.join(f.root, "observations"));
  assert.equal(observations.length, 1);
  assert.deepEqual(
    await readFile(path.join(f.root, "observations", observations[0])),
    bytes,
  );
  for (const forbidden of [
    "SYNTHETIC_CSRF_SECRET",
    "合成姓名",
    "合成敏感字段",
    "合成账单",
    "99999",
  ]) {
    assert.equal(bytes.toString("utf8").includes(forbidden), false);
  }
  await assert.rejects(lstat(path.join(f.root, ".refresh.lock")), {
    code: "ENOENT",
  });
});

test("每次刷新重新访问官方来源，旧的独立观察记录保持原字节", async (t) => {
  const f = await fixture(t);
  await refreshWeeklyPrice(f);
  const directory = path.join(f.root, "observations");
  const first = (await readdir(directory))[0];
  const firstBytes = await readFile(path.join(directory, first));
  await refreshWeeklyPrice(f);
  assert.equal(calls.requests.length, 6);
  assert.equal((await readdir(directory)).length, 2);
  assert.deepEqual(await readFile(path.join(directory, first)), firstBytes);
});

test("首列 CSS 大写 USERS 仍能生成有效的 users 价目合约", async (t) => {
  const f = await fixture(t, {
    cells: ["USERS", TARGET.apiPath, TARGET.title, "3C/条"],
  });
  await refreshWeeklyPrice(f);
  const price = parseWeeklyProviderPrice(await readFile(f.current), new Date());
  assert.equal(price.target.group, "users");
  assert.equal(price.displayPrice, "3C/条");
});

test("首列为不同组名 STATUSES 时仍拒绝并保留旧证据", async (t) => {
  const f = await fixture(t, {
    cells: ["STATUSES", TARGET.apiPath, TARGET.title, "3C/条"],
  });
  await assert.rejects(refreshWeeklyPrice(f), {
    message: "weekly_price_visible_price_mismatch",
  });
  await unchanged(f);
});

test("缺少服务器会话目录明确要求登录，不创建或读取本地浏览器状态", async (t) => {
  const f = await fixture(t);
  await rmdir(f.profileRoot);
  await assert.rejects(refreshWeeklyPrice(f), {
    message: "weekly_price_login_required",
  });
  assert.equal(calls.launches.length, 0);
  await unchanged(f);
});

for (const [name, patch, code] of [
  [
    "账号 401",
    { responses: { account: { status: 401 } } },
    "weekly_price_login_required",
  ],
  [
    "账号页被替换为登录 HTML",
    { responses: { account: { headers: { "content-type": "text/html" } } } },
    "weekly_price_login_required",
  ],
  [
    "页面跳转登录",
    { pageURL: "https://open.weibo.com/cli/login" },
    "weekly_price_login_required",
  ],
  ["页面源非 200", { planStatus: 503 }, "weekly_price_source_http_failure"],
  [
    "缺少当前身份",
    { account: { username: "只有名字" } },
    "weekly_price_login_required",
  ],
  [
    "计费命令 401",
    { responses: { commands: { status: 401 } } },
    "weekly_price_login_required",
  ],
  [
    "订阅非 200",
    { responses: { subscription: { status: 500 } } },
    "weekly_price_source_http_failure",
  ],
  [
    "接口落到另一 URL",
    {
      responses: {
        commands: { url: "https://open.weibo.com/cli/api/cli/commands" },
      },
    },
    "weekly_price_source_http_failure",
  ],
  [
    "接口返回坏 JSON",
    { responses: { commands: { body: "{bad" } } },
    "weekly_price_response_invalid",
  ],
  [
    "响应声明超限",
    { responses: { commands: { headers: { "content-length": "999999999" } } } },
    "weekly_price_response_too_large",
  ],
  [
    "体验服务",
    { subscription: { serviceStatus: { kind: "trial_active" } } },
    "weekly_price_formal_service_required",
  ],
  [
    "命令重复",
    { commands: { commands: [TARGET, TARGET] } },
    "weekly_price_target_ambiguous",
  ],
  ["缺少命令", { commands: { commands: [] } }, "weekly_price_target_ambiguous"],
  [
    "计费单位变化",
    { commands: { commands: [{ ...TARGET, billingType: 2 }] } },
    "weekly_price_billing_changed",
  ],
  [
    "价格变化",
    { commands: { commands: [{ ...TARGET, pricePerUnit: 4 }] } },
    "weekly_price_billing_changed",
  ],
  [
    "缺少真实价格字段",
    { commands: { commands: [{ ...TARGET, pricePerUnit: undefined }] } },
    "weekly_price_billing_changed",
  ],
  [
    "路径别名冲突",
    { commands: { commands: [{ ...TARGET, api_path: "users/show/biz" }] } },
    "weekly_price_billing_changed",
  ],
  [
    "可见价格不同",
    { cells: ["users", TARGET.apiPath, TARGET.title, "3C/次"] },
    "weekly_price_visible_price_mismatch",
  ],
  ["可见接口有重复行", { rowCount: 2 }, "weekly_price_target_ambiguous"],
  [
    "浏览器关闭失败",
    { closeError: "原始 Cookie 私密错误" },
    "weekly_price_browser_close_failed",
  ],
]) {
  test(`${name} 时不刷新旧证据或伪造成功来源`, async (t) => {
    const f = await fixture(t, patch);
    await assert.rejects(refreshWeeklyPrice(f), { message: code });
    await unchanged(f);
    assert.ok(calls.closed >= 1);
  });
}

test("未知网络异常只返回固定码，原始凭据与账单不进入日志或异常", async (t) => {
  const f = await fixture(t, {
    requestError: "Authorization Bearer SYNTHETIC_TOKEN_PRIVATE 账单",
  });
  const logged = [];
  for (const name of ["log", "warn", "error", "info", "debug"]) {
    t.mock.method(console, name, (...args) => logged.push(args));
  }
  await assert.rejects(refreshWeeklyPrice(f), (error) => {
    assert.equal(error.message, "weekly_price_unavailable");
    assert.equal(error.stack.includes("SYNTHETIC_TOKEN_PRIVATE"), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.deepEqual(logged, []);
  await unchanged(f);
});

test("正常网页仅准许本站只读元数据请求，拒绝购买、登录提交和外域", async (t) => {
  const f = await fixture(t);
  await refreshWeeklyPrice(f);
  const handler = calls.route.handler;
  for (const [url, method, expected] of [
    ["https://open.weibo.com/cli/assets/app.js", "GET", "continue"],
    ["https://open.weibo.com/cli/api/auth/me", "GET", "continue"],
    [
      "https://open.weibo.com/cli/api/me/billing/subscription",
      "GET",
      "continue",
    ],
    ["https://open.weibo.com/cli/api/me/billing/purchase", "POST", "abort"],
    ["https://open.weibo.com/cli/api/auth/login", "POST", "abort"],
    [
      "https://open.weibo.com/cli/api/cli/users/show_batch/other",
      "GET",
      "abort",
    ],
    ["https://unexpected.example/private", "GET", "abort"],
  ]) {
    let action;
    await handler({
      request: () => ({ url: () => url, method: () => method }),
      continue: async () => {
        action = "continue";
      },
      abort: async () => {
        action = "abort";
      },
    });
    assert.equal(action, expected);
  }
});

test("并发和遗留锁均不抢占，也不启动第二个浏览器", async (t) => {
  let entered;
  let release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    onLaunch: async () => {
      entered();
      await paused;
    },
  });
  const first = refreshWeeklyPrice(f);
  await started;
  await assert.rejects(refreshWeeklyPrice(f), {
    message: "weekly_price_locked",
  });
  assert.equal(calls.launches.length, 1);
  release();
  await first;
});

test("拒绝 current 目录联接，不向边界外写价目", async (t) => {
  const f = await fixture(t);
  await rm(f.current);
  const external = path.join(f.temporary, "outside");
  await mkdir(external);
  await symlink(
    external,
    f.current,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(refreshWeeklyPrice(f), {
    message: "weekly_price_unsafe_path",
  });
  assert.deepEqual(await readdir(external), []);
  assert.equal(calls.launches.length, 0);
});

test("拒绝 current 硬链接，不覆盖其他路径共享的证据", async (t) => {
  const f = await fixture(t);
  const duplicate = path.join(f.temporary, "shared-price.json");
  await link(f.current, duplicate);
  await assert.rejects(refreshWeeklyPrice(f), {
    message: "weekly_price_unsafe_path",
  });
  assert.equal(await readFile(duplicate, "utf8"), f.old);
  assert.equal(calls.launches.length, 0);
  await unchanged(f);
});

test("总观察时间预算到期时不进入下一个来源或更新旧证据", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await fixture(t, {
    onRequest: async (kind) => {
      if (kind === "account") t.mock.timers.tick(90_001);
    },
  });
  await assert.rejects(refreshWeeklyPrice(f), {
    message: "weekly_price_timeout",
  });
  assert.equal(calls.requests.length, 1);
  await unchanged(f);
});

test("不接受相对 profile 或带父级穿越的 stage", async (t) => {
  const f = await fixture(t);
  await assert.rejects(refreshWeeklyPrice({ ...f, profileRoot: "relative" }), {
    message: "weekly_price_unsafe_path",
  });
  await assert.rejects(
    refreshWeeklyPrice({
      ...f,
      stageRoot: `${f.stageRoot}${path.sep}..${path.sep}other`,
    }),
    { message: "weekly_price_unsafe_path" },
  );
  assert.equal(calls.launches.length, 0);
  await unchanged(f);
});

test(
  "Linux 下独立证据和 current 均为 0600，输出目录为 0700",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    await refreshWeeklyPrice(f);
    assert.equal((await lstat(f.current)).mode & 0o777, 0o600);
    assert.equal((await lstat(f.root)).mode & 0o777, 0o700);
    const observations = path.join(f.root, "observations");
    assert.equal((await lstat(observations)).mode & 0o777, 0o700);
    for (const file of await readdir(observations)) {
      assert.equal(
        (await lstat(path.join(observations, file))).mode & 0o777,
        0o600,
      );
    }
  },
);

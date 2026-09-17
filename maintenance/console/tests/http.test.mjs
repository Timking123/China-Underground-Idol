import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { ConsoleStore } from "../store.ts";
import { hashPassword, verifyPassword } from "../crypto.ts";
import { createConsoleServer } from "../server.ts";

const scratch = path.resolve("work/console-backend-tests");
mkdirSync(scratch, { recursive: true });
const PASSWORD = "HTTP-测试专用长密码-123";
const ORIGIN = "https://console.example.invalid";
const settings = {
  acceptFeedback: true,
  analyticsEnabled: true,
  feedbackNotice: "测试通知",
};
async function fixture(t, extra = {}) {
  const directory = mkdtempSync(path.join(scratch, "http-"));
  const store = new ConsoleStore(path.join(directory, "data"), randomBytes(32));
  store.put(
    "account",
    "admin",
    { username: "admin", passwordHash: await hashPassword(PASSWORD) },
    Date.now(),
  );
  mkdirSync(path.join(directory, "site/assets"), { recursive: true });
  mkdirSync(path.join(directory, "admin"));
  writeFileSync(path.join(directory, "site/index.html"), "公开站点");
  writeFileSync(
    path.join(directory, "site/assets/groups-data.js"),
    'window.IDOL_GROUPS = [{"id":"sample"}];',
  );
  writeFileSync(path.join(directory, "admin/index.html"), "管理入口");
  let time = Date.UTC(2026, 8, 17);
  const server = createConsoleServer({
    store,
    origin: ORIGIN,
    trustedProxy: true,
    adminDirectory: path.join(directory, "admin"),
    siteDirectory: path.join(directory, "site"),
    geo: {
      ready: false,
      locate: async () => ({ country: "未知", province: "未知", city: "未知" }),
      close() {},
    },
    now: () => time,
    ...extra,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function api(
    route,
    { method = "GET", body, cookie, csrf, headers = {} } = {},
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        origin: ORIGIN,
        "x-console-client-ip": "192.0.2.241",
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    return {
      status: response.status,
      data: value.data,
      message: value.message,
      headers: response.headers,
    };
  }
  async function login(password = PASSWORD) {
    const result = await api("/api/v1/admin/login", {
      method: "POST",
      body: { username: "admin", password },
    });
    assert.equal(result.status, 200);
    return {
      cookie: result.headers.get("set-cookie").split(";")[0],
      csrf: result.data.csrf,
      absoluteRemainingMs: result.data.absoluteRemainingMs,
      header: result.headers.get("set-cookie"),
    };
  }
  return {
    store,
    server,
    api,
    login,
    base,
    setTime: (next) => {
      time = next;
    },
    time: () => time,
  };
}

test("所有管理员 API 匿名时拒绝，包括未知路由和所有写入口", async (t) => {
  const { api } = await fixture(t);
  for (const [method, route] of [
    ["GET", "session"],
    ["GET", "dashboard"],
    ["GET", "feedback"],
    ["GET", "visits"],
    ["GET", "audit"],
    ["GET", "settings"],
    ["GET", "system"],
    ["GET", "catalog"],
    ["GET", "unknown"],
    ["PATCH", "settings"],
    ["PATCH", `feedback/${"0".repeat(24)}`],
    ["POST", "password"],
    ["POST", "logout"],
    ["POST", "logout-all"],
  ])
    assert.equal(
      (
        await api(`/api/v1/admin/${route}`, {
          method,
          ...(method !== "GET" ? { body: {} } : {}),
        })
      ).status,
      401,
      route,
    );
});

test("实际登录、Cookie 安全属性、CSRF、跨站写请求和退出", async (t) => {
  const { api, login } = await fixture(t);
  assert.equal(
    (
      await api("/api/v1/admin/login", {
        method: "POST",
        body: { username: "admin", password: "错误密码" },
      })
    ).status,
    401,
  );
  const auth = await login();
  for (const flag of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/api/v1/admin",
  ])
    assert.ok(auth.header.includes(flag));
  assert.equal((await api("/api/v1/admin/session", auth)).data.csrf, auth.csrf);
  assert.equal(
    (
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        cookie: auth.cookie,
        body: settings,
      })
    ).status,
    403,
  );
  for (const headers of [
    { origin: "https://evil.example.invalid" },
    { "sec-fetch-site": "cross-site" },
    { origin: "" },
  ])
    assert.equal(
      (
        await api("/api/v1/admin/settings", {
          method: "PATCH",
          ...auth,
          body: settings,
          headers,
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        ...auth,
        body: settings,
      })
    ).status,
    200,
  );
  const response = await api("/api/v1/admin/logout", {
    method: "POST",
    ...auth,
  });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
  assert.equal((await api("/api/v1/admin/session", auth)).status, 401);
});

test("空闲 30 分钟和绝对 8 小时会话到期", async (t) => {
  const { api, login, setTime, time } = await fixture(t);
  const idle = await login();
  const start = time();
  assert.equal(idle.absoluteRemainingMs, 8 * 3600000);
  setTime(start + 30 * 60000);
  assert.equal((await api("/api/v1/admin/session", idle)).status, 401);
  const active = await login();
  const next = time();
  assert.equal(
    (await api("/api/v1/admin/session", active)).data.absoluteRemainingMs,
    8 * 3600000,
  );
  for (let minute = 20; minute < 480; minute += 20) {
    setTime(next + minute * 60000);
    assert.equal((await api("/api/v1/admin/settings", active)).status, 200);
    const session = await api("/api/v1/admin/session", active);
    assert.equal(session.status, 200);
    assert.equal(
      session.data.absoluteRemainingMs,
      8 * 3600000 - minute * 60000,
    );
  }
  setTime(next + 480 * 60000);
  assert.equal((await api("/api/v1/admin/session", active)).status, 401);
});

test("全部公开反馈类型、幂等、审核、分页、设置、系统与公开档案", async (t) => {
  const { api, login, store } = await fixture(t);
  const auth = await login();
  let first;
  const kinds = [
    "submission",
    "error",
    "event",
    "outdated",
    "rights",
    "feedback",
    "suggestion",
  ];
  for (let i = 0; i < kinds.length; i++) {
    const body = {
      kind: kinds[i],
      target: "测试目标",
      source: "https://example.invalid/source",
      details: "反馈测试正文",
      contact: "test@example.invalid",
      consent: true,
      website: "",
      requestId: randomUUID(),
    };
    const headers = { "x-console-client-ip": `192.0.2.${20 + i}` };
    const result = await api("/api/v1/feedback", {
      method: "POST",
      body,
      headers,
    });
    assert.equal(result.status, 201);
    first ??= result.data.id;
    assert.equal(
      (await api("/api/v1/feedback", { method: "POST", body, headers })).data
        .id,
      result.data.id,
    );
    assert.equal(Object.hasOwn(result.data, "details"), false);
  }
  const listed = await api("/api/v1/admin/feedback", auth);
  assert.equal(listed.data.total, 7);
  assert.equal(
    (
      await api(`/api/v1/admin/feedback/${first}`, {
        method: "PATCH",
        ...auth,
        body: { status: "resolved", note: "核查完成" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/api/v1/admin/feedback?status=resolved", auth)).data.total,
    1,
  );
  assert.equal(
    (await api("/api/v1/admin/feedback?page=2", auth)).data.items.length,
    0,
  );
  assert.equal((await api("/api/v1/admin/feedback?page=0", auth)).status, 400);
  assert.equal(
    (await api("/api/v1/admin/dashboard?days=7", auth)).data.pending,
    6,
  );
  assert.equal((await api("/api/v1/admin/dashboard?days=1", auth)).status, 400);
  assert.equal((await api("/api/v1/admin/audit", auth)).data.total, 9);
  assert.equal(
    (await api("/api/v1/admin/system", auth)).data.retentionDays,
    90,
  );
  assert.equal((await api("/api/v1/admin/catalog", auth)).data[0].id, "sample");
  assert.equal(
    (
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        ...auth,
        body: { ...settings, acceptFeedback: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/api/v1/feedback", { method: "POST", body: {} })).status,
    503,
  );
  assert.equal(store.feedbackPage(1, "").total, 7);
});

test("访问采集清除敏感 URL、忽略伪造身份时间地区且支持 IPv6 和幂等", async (t) => {
  const { api, login, store, time } = await fixture(t);
  const body = {
    id: randomUUID(),
    path: "/group.html?secret=hidden#private",
    referrer: "https://source.example.invalid/private?secret=x",
    ip: "203.0.113.200",
    createdAt: 1,
    province: "伪造地区",
  };
  const headers = {
    "x-console-client-ip": "2001:db8::25",
    "x-forwarded-for": "203.0.113.201",
    "user-agent": "Firefox/100",
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await api("/api/v1/pageviews", { method: "POST", body, headers }))
        .status,
      200,
    );
  const auth = await login();
  const page = await api("/api/v1/admin/visits", auth);
  assert.equal(page.data.total, 1);
  const saved = page.data.items[0];
  assert.equal(saved.path, "/group.html");
  assert.equal(saved.referrer, "source.example.invalid");
  assert.equal(saved.ip, "2001:db8::25");
  assert.equal(saved.createdAt, time());
  assert.equal(saved.province, "未知");
  assert.equal(store.dashboard(7, time()).totalPv, 1);
  for (const extra of [{ dnt: "1" }, { "user-agent": "example-bot" }])
    assert.equal(
      (
        await api("/api/v1/pageviews", {
          method: "POST",
          body: { ...body, id: randomUUID() },
          headers: extra,
        })
      ).data.recorded,
      false,
    );
  for (const pathname of [
    "/admin",
    "/data.js",
    "//evil.example.invalid/",
    "/\\evil.example.invalid/",
    "https://evil.example.invalid/",
  ])
    assert.equal(
      (
        await api("/api/v1/pageviews", {
          method: "POST",
          body: { ...body, path: pathname },
        })
      ).status,
      400,
    );
});

test("退出时仍在读取请求体的操作不能凭旧会话修改设置", async (t) => {
  const { server, api, login, base, store } = await fixture(t);
  const auth = await login();
  const payload = JSON.stringify({
    ...settings,
    feedbackNotice: "过期请求不应写入",
  });
  const reached = new Promise((resolve) => server.once("request", resolve));
  let request;
  const response = new Promise((resolve, reject) => {
    request = httpRequest(
      base + "/api/v1/admin/settings",
      {
        method: "PATCH",
        headers: {
          origin: ORIGIN,
          cookie: auth.cookie,
          "x-csrf-token": auth.csrf,
          "x-console-client-ip": "192.0.2.241",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (incoming) => {
        incoming.resume();
        incoming.on("end", () => resolve(incoming.statusCode));
      },
    );
    request.on("error", reject);
    request.write(payload.slice(0, 10));
  });
  await reached;
  assert.equal(
    (await api("/api/v1/admin/logout-all", { method: "POST", ...auth })).status,
    200,
  );
  request.end(payload.slice(10));
  assert.equal(await response, 401);
  assert.equal(store.settings().feedbackNotice, "");
});

test("两个同时改密请求仅一个成功，旧会话与旧密码随后失效", async (t) => {
  const { api, login, store } = await fixture(t);
  const auth = await login();
  const passwords = ["第一份新的测试长密码-123", "第二份新的测试长密码-456"];
  const results = await Promise.all(
    passwords.map((newPassword) =>
      api("/api/v1/admin/password", {
        method: "POST",
        ...auth,
        body: { currentPassword: PASSWORD, newPassword },
      }),
    ),
  );
  assert.equal(results.filter((item) => item.status === 200).length, 1);
  const winner = results.findIndex((item) => item.status === 200);
  assert.equal(
    await verifyPassword(
      passwords[winner],
      store.get("account", "admin").passwordHash,
    ),
    true,
  );
  assert.equal((await api("/api/v1/admin/session", auth)).status, 401);
  assert.equal(
    (
      await api("/api/v1/admin/login", {
        method: "POST",
        body: { username: "admin", password: PASSWORD },
      })
    ).status,
    401,
  );
  await login(passwords[winner]);
});

test("错误类型、超大体积、无效代理头和持久限流返回明确状态", async (t) => {
  const { api, base } = await fixture(t);
  assert.equal(
    (
      await api("/api/v1/feedback", {
        method: "POST",
        body: {},
        headers: { "content-type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await api("/api/v1/feedback", {
        method: "POST",
        body: { details: "x".repeat(25000) },
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await api("/api/v1/public-config", {
        headers: { "x-console-client-ip": "192.0.2.1,192.0.2.2" },
      })
    ).status,
    400,
  );
  assert.equal((await fetch(base + "/api/v1/public-config")).status, 400);
  for (let n = 0; n < 8; n++)
    assert.equal(
      (
        await api("/api/v1/admin/login", {
          method: "POST",
          body: { username: "admin", password: "错误" },
        })
      ).status,
      401,
    );
  const blocked = await api("/api/v1/admin/login", {
    method: "POST",
    body: {},
  });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
});

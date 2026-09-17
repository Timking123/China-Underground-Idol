import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, login, feedback, ORIGIN, PASSWORD, NOW } from "./helpers.mjs";

test("SEC-HTTP-01 匿名不能读取任一后台接口或修改状态", async (t) => {
  const f = await fixture(t);
  for (const route of [
    "session",
    "dashboard",
    "feedback",
    "visits",
    "audit",
    "settings",
    "system",
    "catalog",
  ]) {
    const response = await f.api(`/api/v1/admin/${route}`);
    assert.equal(response.status, 401, route);
    assert.equal(response.payload.data, null);
    assert.match(response.headers["cache-control"], /no-store/u);
  }
  for (const [method, route] of [
    ["PATCH", "settings"],
    ["POST", "password"],
    ["POST", "logout-all"],
    ["PATCH", "feedback/aaaaaaaaaaaaaaaaaaaaaaaa"],
  ]) {
    assert.equal(
      (await f.api(`/api/v1/admin/${route}`, { method, body: {} })).status,
      401,
    );
  }
});

test("SEC-HTTP-02 登录 Cookie 属性、跨站请求及 CSRF 守卫", async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  for (const property of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/api/v1/admin",
  ])
    assert.ok(session.result.headers["set-cookie"][0].includes(property));
  const body = {
    acceptFeedback: false,
    analyticsEnabled: false,
    feedbackNotice: "禁止写入的合成内容",
  };
  for (const headers of [
    { ...session.headers, Origin: "https://attacker.invalid" },
    { ...session.headers, Origin: null },
    { ...session.headers, "Sec-Fetch-Site": "cross-site" },
    { Cookie: session.cookie },
    { ...session.headers, "X-CSRF-Token": "wrong" },
  ])
    assert.equal(
      (
        await f.api("/api/v1/admin/settings", {
          method: "PATCH",
          headers,
          body,
        })
      ).status,
      403,
    );
  assert.equal(f.store.settings().acceptFeedback, true);
  assert.equal(
    (
      await f.api("/api/v1/admin/login", {
        method: "POST",
        headers: { Origin: "null" },
        body: { username: f.account.username, password: PASSWORD },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.api("/api/v1/feedback", {
        method: "POST",
        headers: { Origin: "https://attacker.invalid" },
        body: feedback(),
      })
    ).status,
    403,
  );
});

test("SEC-HTTP-03 代理专用头缺失、重复、地址链均拒绝；通用伪造头无效", async (t) => {
  const f = await fixture(t);
  for (const header of [
    null,
    "192.0.2.1, 198.51.100.1",
    ["192.0.2.1", "198.51.100.1"],
    "not-an-ip",
    "fe80::1%eth0",
  ]) {
    assert.equal(
      (
        await f.api("/api/v1/public-config", {
          headers: { "X-Console-Client-IP": header },
        })
      ).status,
      400,
    );
  }
  const response = await f.api("/api/v1/feedback", {
    method: "POST",
    headers: {
      "X-Console-Client-IP": "2001:0db8:0000::123",
      "X-Forwarded-For": "198.51.100.99",
      "X-Real-IP": "203.0.113.99",
    },
    body: feedback(),
  });
  assert.equal(response.status, 201);
  assert.equal(
    f.store.get("feedback", response.payload.data.id).ip,
    "2001:db8::123",
  );
});

test("SEC-HTTP-04 非代理模式忽略客户自报 IP", async (t) => {
  const f = await fixture(t, { trustedProxy: false });
  const response = await f.api("/api/v1/feedback", {
    method: "POST",
    headers: {
      "X-Console-Client-IP": "198.51.100.8",
      "X-Forwarded-For": "203.0.113.7",
    },
    body: feedback(),
  });
  assert.equal(response.status, 201);
  assert.equal(
    f.store.get("feedback", response.payload.data.id).ip,
    "127.0.0.1",
  );
});

test("SEC-HTTP-05 拒绝恶意来源、非法类型、畸形 JSON、超大正文", async (t) => {
  const f = await fixture(t);
  for (const body of [
    feedback({ source: "javascript:alert(1)" }),
    feedback({ source: "https://name:password@example.invalid" }),
    feedback({ consent: false }),
    feedback({ kind: "__proto__" }),
    feedback({ target: "\u0000" }),
    feedback({ requestId: "../../secrets" }),
    [],
  ]) {
    assert.equal(
      (await f.api("/api/v1/feedback", { method: "POST", body })).status,
      400,
    );
  }
  assert.equal(
    (await f.api("/api/v1/feedback", { method: "POST", rawBody: "{" })).status,
    400,
  );
  assert.equal(
    (
      await f.api("/api/v1/feedback", {
        method: "POST",
        rawBody: Buffer.from([0xff, 0xfe]),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.api("/api/v1/feedback", {
        method: "POST",
        rawBody: "x".repeat(24001),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.api("/api/v1/feedback", {
        method: "POST",
        body: feedback(),
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal(f.store.feedbackPage(1, "").total, 0);
});

test("SEC-HTTP-06 页面统计只存白名单路径、来源域名和服务端 IP/时间", async (t) => {
  const f = await fixture(t);
  const response = await f.api("/api/v1/pageviews", {
    method: "POST",
    body: {
      id: randomUUID(),
      path: "/guide.html?private=sentinel#secret",
      referrer: "https://name:password@example.invalid/private?contact=secret",
      ip: "203.0.113.17",
      createdAt: 0,
      province: "恶意自报地区",
    },
  });
  assert.equal(response.status, 200);
  const visits = f.store.visitsPage(1, NOW);
  assert.equal(visits.total, 1);
  assert.equal(visits.items[0].path, "/guide.html");
  assert.equal(visits.items[0].referrer, "example.invalid");
  assert.equal(visits.items[0].ip, "192.0.2.231");
  assert.equal(visits.items[0].createdAt, NOW);
  assert.equal(visits.items[0].province, "测试省");
  for (const pathname of [
    "/admin/",
    "/.env",
    "/api/v1/admin/visits",
    "//attacker.invalid/",
    "https://attacker.invalid/",
  ]) {
    assert.equal(
      (
        await f.api("/api/v1/pageviews", {
          method: "POST",
          body: { id: randomUUID(), path: pathname, referrer: "" },
        })
      ).status,
      400,
    );
  }
  for (const headers of [{ DNT: "1" }, { "User-Agent": "Googlebot" }]) {
    const response = await f.api("/api/v1/pageviews", {
      method: "POST",
      headers,
      body: { id: randomUUID(), path: "/", referrer: "" },
    });
    assert.equal(response.payload.data.recorded, false);
  }
  assert.equal(f.store.visitsPage(1, NOW).total, 1);
});

test("SEC-HTTP-07 顺序改密后旧 Cookie 与旧密码失效，新密码可用", async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const changed = await f.api("/api/v1/admin/password", {
    method: "POST",
    headers: session.headers,
    body: {
      currentPassword: PASSWORD,
      newPassword: "合成安全测试-更换后的长密码-20260917",
    },
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await f.api("/api/v1/admin/session", { headers: session.headers })).status,
    401,
  );
  assert.equal(
    (
      await f.api("/api/v1/admin/login", {
        method: "POST",
        body: { username: f.account.username, password: PASSWORD },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.api("/api/v1/admin/login", {
        method: "POST",
        body: {
          username: f.account.username,
          password: "合成安全测试-更换后的长密码-20260917",
        },
      })
    ).status,
    200,
  );
});

test("SEC-HTTP-08 空闲 30 分钟及绝对 8 小时边界拒绝会话", async (t) => {
  const f = await fixture(t);
  const first = await login(f);
  f.setTime(NOW + 30 * 60000);
  assert.equal(
    (await f.api("/api/v1/admin/session", { headers: first.headers })).status,
    401,
  );
  const second = await login(f);
  for (let n = 1; n < 16; n++) {
    f.setTime(NOW + 30 * 60000 + n * 29 * 60000);
    assert.equal(
      (await f.api("/api/v1/admin/session", { headers: second.headers }))
        .status,
      200,
    );
  }
  f.setTime(NOW + 30 * 60000 + 8 * 3600000);
  assert.equal(
    (await f.api("/api/v1/admin/session", { headers: second.headers })).status,
    401,
  );
});

test("SEC-HTTP-09 私有文件与源码路径均不由 API 服务公开", async (t) => {
  const f = await fixture(t);
  for (const pathname of [
    "/.env",
    "/console.sqlite",
    "/console.sqlite-wal",
    "/admin/../private/console.sqlite",
    "/admin/%2e%2e/private/console.sqlite",
    "/maintenance/console/server.ts",
    "/reports/console-security/",
    "/admin/admin.js.map",
  ]) {
    assert.equal((await f.api(pathname)).status, 404, pathname);
  }
  assert.equal(
    (await f.api("/api/v1/public-config", { headers: { Origin: ORIGIN } }))
      .status,
    200,
  );
});

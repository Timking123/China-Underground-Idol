import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixture,
  login,
  delayedBody,
  feedback,
  PASSWORD,
  NEW_PASSWORD,
  NOW,
  crypto,
  storage,
} from "./helpers.mjs";

test("SEC-RACE-01 退出全部会话后补齐旧请求体，设置、审核和改密均不能提交", async (t) => {
  for (const action of ["settings", "feedback", "password"]) {
    await t.test(action, async (subtest) => {
      const f = await fixture(subtest);
      const session = await login(f);
      const saved = f.store.createFeedback(feedback(), "192.0.2.231", NOW);
      const pathname = action === "feedback" ? `feedback/${saved.id}` : action;
      const body =
        action === "settings"
          ? {
              acceptFeedback: false,
              analyticsEnabled: false,
              feedbackNotice: "撤销后不能保存",
            }
          : action === "feedback"
            ? { status: "resolved", note: "撤销后不能保存" }
            : { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };
      const delayed = delayedBody(
        f,
        `/api/v1/admin/${pathname}`,
        body,
        session.headers,
        action === "password" ? "POST" : "PATCH",
      );
      await delayed.received;
      assert.equal(
        (
          await f.api("/api/v1/admin/logout-all", {
            method: "POST",
            headers: session.headers,
            body: {},
          })
        ).status,
        200,
      );
      delayed.finish();
      assert.equal((await delayed.completed).status, 401);
      assert.equal(f.store.settings().acceptFeedback, true);
      assert.equal(f.store.get("feedback", saved.id).status, "pending");
      assert.equal(
        await crypto.verifyPassword(
          PASSWORD,
          f.store.get("account", "admin").passwordHash,
        ),
        true,
      );
    });
  }
});

test("SEC-RACE-02 两个旧密码改密请求并发时，最多一个提交且旧会话全部失效", async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const passwords = [NEW_PASSWORD, `${NEW_PASSWORD}-another`];
  const results = await Promise.all(
    passwords.map((newPassword) =>
      f.api("/api/v1/admin/password", {
        method: "POST",
        headers: session.headers,
        body: { currentPassword: PASSWORD, newPassword },
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.every((result) => [200, 401].includes(result.status)));
  const winningIndex = results.findIndex((result) => result.status === 200);
  assert.equal(
    await crypto.verifyPassword(
      passwords[winningIndex],
      f.store.get("account", "admin").passwordHash,
    ),
    true,
  );
  assert.equal(
    (await f.api("/api/v1/admin/session", { headers: session.headers })).status,
    401,
  );
  assert.equal(f.store.list("sessions").length, 0);
});

test("SEC-RACE-03 部分登录正文占用并发槽位，第三个登录不能排队执行密码校验", async (t) => {
  const f = await fixture(t);
  const body = { username: f.account.username, password: PASSWORD };
  const first = delayedBody(f, "/api/v1/admin/login", body, {}, "POST");
  await first.received;
  const second = delayedBody(
    f,
    "/api/v1/admin/login",
    body,
    { "X-Console-Client-IP": "192.0.2.232" },
    "POST",
  );
  await second.received;
  const third = await f.api("/api/v1/admin/login", {
    method: "POST",
    body,
    headers: { "X-Console-Client-IP": "192.0.2.233" },
  });
  first.finish();
  second.finish();
  const completed = await Promise.all([first.completed, second.completed]);
  assert.equal(third.status, 503);
  assert.ok(completed.every((result) => result.status === 200));
});

test("SEC-RACE-04 已登录写请求跨过空闲期限再补正文，拒绝续活已失效会话", async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const delayed = delayedBody(
    f,
    "/api/v1/admin/settings",
    {
      acceptFeedback: false,
      analyticsEnabled: false,
      feedbackNotice: "过期后不能保存",
    },
    session.headers,
  );
  await delayed.received;
  f.setTime(NOW + 30 * 60000);
  delayed.finish();
  assert.equal((await delayed.completed).status, 401);
  assert.equal(f.store.settings().acceptFeedback, true);
});

test("SEC-RACE-05 登录校验旧快照期间另一连接撤销账户版本，不得重新签发会话", async (t) => {
  const f = await fixture(t);
  const other = new storage.ConsoleStore(f.dataDirectory, f.key);
  const originalGet = f.store.get.bind(f.store);
  let armed = true;
  let revocationApplied = false;
  // 仅安排并发数据库事务的时间点；密码计算与 HTTP 登录仍运行真实实现。
  f.store.get = (bucket, id) => {
    const value = originalGet(bucket, id);
    if (armed && bucket === "account" && id === "admin") {
      armed = false;
      queueMicrotask(() => {
        other.transaction(() => {
          other.put(
            "account",
            "admin",
            { ...value, version: "synthetic-revoked-version" },
            NOW,
          );
          other.db.prepare("DELETE FROM records WHERE bucket='sessions'").run();
        });
        revocationApplied = true;
      });
    }
    return value;
  };
  try {
    const response = await f.api("/api/v1/admin/login", {
      method: "POST",
      body: { username: f.account.username, password: PASSWORD },
    });
    assert.equal(
      revocationApplied,
      true,
      "必须实际执行另一个 SQLite 连接的撤销事务",
    );
    assert.equal(response.status, 401);
    assert.equal(f.store.list("sessions").length, 0);
  } finally {
    f.store.get = originalGet;
    other.close();
  }
});

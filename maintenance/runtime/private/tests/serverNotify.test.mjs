import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReadableStream } from "node:stream/web";
import test from "node:test";
import { notifyIncident } from "../server/notify.ts";

const KEY = "SCTOfflineTestKey123";
const NOW = Date.parse("2026-09-10T15:59:00Z");
const DAY = 86_400_000;
const INCIDENT = {
  runId: "maintenance-20260910T155900Z",
  kind: "source_failure",
  code: "SOURCE_UNAVAILABLE",
  source: "weibo",
  message: "这段原始错误含用户资料和账单，禁止推送与落盘。",
  action: "check_source",
};

async function fixture(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), "idol-notify-test-"));
  t.after(async () => {
    // 仅删除本测试创建且仍位于临时根目录内的普通目录。
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith("idol-notify-test-"));
    assert.equal((await lstat(temporary)).isSymbolicLink(), false);
    await rm(temporary, { recursive: true, force: true });
  });
  const stateRoot = path.join(temporary, "state");
  const directory = path.join(stateRoot, "server-notify");
  const options = {
    stateRoot,
    sendKey: KEY,
    now: NOW,
    fetchImpl: async () => new Response('{"code":0}'),
  };
  return { temporary, stateRoot, directory, options };
}

async function records(directory, type) {
  const target = path.join(directory, type);
  return Promise.all(
    (await readdir(target)).map(async (name) => ({
      file: path.join(target, name),
      text: await readFile(path.join(target, name), "utf8"),
    })),
  );
}

test("通知离线测试固定使用 Node 22 标准库及 strip-types", () => {
  assert.equal(process.versions.node.split(".")[0], "22");
  assert.ok(process.execArgv.includes("--experimental-strip-types"));
});

test("成功前已持久化 attempt，固定端点与表单，仅留安全成功收据", async (t) => {
  const { directory, stateRoot, options } = await fixture(t);
  let calls = 0;
  const result = await notifyIncident(INCIDENT, {
    ...options,
    fetchImpl: async (url, request) => {
      calls++;
      assert.equal(url, `https://sctapi.ftqq.com/${KEY}.send`);
      assert.equal(request.method, "POST");
      assert.equal(request.redirect, "error");
      assert.ok(request.signal instanceof AbortSignal);
      const form = request.body;
      assert.ok(form instanceof URLSearchParams);
      assert.deepEqual([...form.keys()].sort(), ["desp", "noip", "title"]);
      assert.equal(form.get("noip"), "1");
      assert.match(form.get("title"), /需要人工处理/);
      assert.match(form.get("desp"), /运行 ID：maintenance-/);
      assert.match(form.get("desp"), /来源名：weibo/);
      assert.match(form.get("desp"), /失败码：SOURCE_UNAVAILABLE/);
      assert.match(form.get("desp"), /处理建议：请核查/);
      assert.equal(form.get("desp").includes(INCIDENT.message), false);
      const attempts = await records(directory, "attempts");
      assert.equal(attempts.length, 1);
      assert.equal(JSON.parse(attempts[0].text).day, "2026-09-10");
      assert.equal((await records(directory, "receipts")).length, 0);
      return new Response(
        JSON.stringify({ code: 0, data: { pushid: KEY, readkey: "敏感响应" } }),
      );
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "sent");
  assert.equal(result.code, "DELIVERED");
  const receipt = await records(directory, "receipts");
  assert.equal(receipt.length, 1);
  assert.equal((await records(directory, "failures")).length, 0);
  assert.deepEqual(JSON.parse(receipt[0].text), {
    version: 1,
    id: result.attemptId,
    at: NOW,
    status: "sent",
  });
  assert.equal(receipt[0].text.includes(KEY), false);
  await assert.rejects(lstat(path.join(directory, "lock")), { code: "ENOENT" });
  if (process.platform !== "win32") {
    for (const dir of [
      stateRoot,
      directory,
      path.join(directory, "attempts"),
      path.join(directory, "receipts"),
      path.join(directory, "failures"),
    ]) {
      assert.equal((await lstat(dir)).mode & 0o777, 0o700);
    }
    for (const entry of [
      ...receipt,
      ...(await records(directory, "attempts")),
    ]) {
      assert.equal((await lstat(entry.file)).mode & 0o777, 0o600);
    }
  }
});

test("相同种类、失败码与来源按 24 小时去重，不依赖运行 ID 或原文", async (t) => {
  const { options } = await fixture(t);
  let calls = 0;
  options.fetchImpl = async () => {
    calls++;
    return new Response('{"code":0}');
  };
  assert.equal((await notifyIncident(INCIDENT, options)).status, "sent");
  assert.deepEqual(
    await notifyIncident(
      { ...INCIDENT, runId: "another-run", message: "另一个原文" },
      { ...options, now: NOW + DAY - 1 },
    ),
    { status: "suppressed", code: "DUPLICATE" },
  );
  assert.equal(
    (await notifyIncident(INCIDENT, { ...options, now: NOW + DAY })).status,
    "sent",
  );
  assert.equal(calls, 2);
});

test("新建空状态根可以初始化，完整账本中的成功通知正常去重", async (t) => {
  const { options, stateRoot } = await fixture(t);
  await mkdir(stateRoot, { mode: 0o700 });
  let calls = 0;
  options.fetchImpl = async () => {
    calls++;
    return new Response('{"code":0}');
  };
  assert.equal((await notifyIncident(INCIDENT, options)).status, "sent");
  assert.deepEqual(
    await notifyIncident(INCIDENT, { ...options, now: NOW + 60_000 }),
    { status: "suppressed", code: "DUPLICATE" },
  );
  assert.equal(calls, 1);
});

for (const outcome of ["receipts", "failures"]) {
  test(`账本 ${outcome} 保留但 attempt 丢失时阻塞，不在零点后重新发送`, async (t) => {
    const { options, directory, temporary } = await fixture(t);
    let calls = 0;
    options.fetchImpl = async () => {
      calls++;
      return new Response(outcome === "receipts" ? '{"code":0}' : "broken");
    };
    const first = await notifyIncident(INCIDENT, options);
    assert.equal(first.status, outcome === "receipts" ? "sent" : "blocked");
    const attempt = (await records(directory, "attempts"))[0];
    await rename(attempt.file, path.join(temporary, "removed-attempt.json"));
    const original = await records(directory, outcome);
    for (const incident of [INCIDENT, { ...INCIDENT, source: "unrelated" }]) {
      assert.deepEqual(
        await notifyIncident(incident, { ...options, now: NOW + 60_000 }),
        { status: "blocked", code: "INVALID_STATE" },
      );
    }
    assert.equal(calls, 1);
    assert.deepEqual(await records(directory, outcome), original);
    assert.equal((await records(directory, "attempts")).length, 0);
  });
}

for (const missing of ["attempts", "receipts", "failures"]) {
  test(`已有通知根缺失 ${missing} 账本目录时阻塞且不重新创建`, async (t) => {
    const { options, directory, temporary } = await fixture(t);
    let calls = 0;
    options.fetchImpl = async () => {
      calls++;
      return new Response('{"code":0}');
    };
    assert.equal((await notifyIncident(INCIDENT, options)).status, "sent");
    const target = path.join(directory, missing);
    await rename(target, path.join(temporary, `removed-${missing}`));
    assert.deepEqual(
      await notifyIncident(
        { ...INCIDENT, source: "new" },
        { ...options, now: NOW + DAY * 2 },
      ),
      { status: "blocked", code: "INVALID_STATE" },
    );
    assert.equal(calls, 1);
    await assert.rejects(lstat(target), { code: "ENOENT" });
  });
}

test("已有通知根的全部账本目录缺失不能冒充首次初始化", async (t) => {
  const { options, directory } = await fixture(t);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  options.fetchImpl = async () => assert.fail("不应访问网络");
  assert.deepEqual(await notifyIncident(INCIDENT, options), {
    status: "blocked",
    code: "INVALID_STATE",
  });
  assert.deepEqual(await readdir(directory), []);
});

test("其他来源的损坏结果账本也必须先阻塞发送", async (t) => {
  const { options, directory } = await fixture(t);
  assert.equal((await notifyIncident(INCIDENT, options)).status, "sent");
  const receipt = (await records(directory, "receipts"))[0];
  const original = JSON.parse(receipt.text);
  await writeFile(receipt.file, JSON.stringify({ ...original, at: NOW + 1 }));
  options.fetchImpl = async () => assert.fail("不应访问网络");
  assert.deepEqual(
    await notifyIncident({ ...INCIDENT, source: "new" }, options),
    { status: "blocked", code: "INVALID_STATE" },
  );
});

test("所有来源共享北京时间每日 4 次上限，在北京时间零点重新计数", async (t) => {
  const { options, directory } = await fixture(t);
  let calls = 0;
  options.fetchImpl = async () => {
    calls++;
    return new Response('{"code":0}');
  };
  for (let index = 0; index < 4; index++) {
    assert.equal(
      (
        await notifyIncident(
          { ...INCIDENT, source: `source-${index}` },
          options,
        )
      ).status,
      "sent",
    );
  }
  const fifth = { ...INCIDENT, source: "source-5" };
  assert.deepEqual(await notifyIncident(fifth, options), {
    status: "suppressed",
    code: "DAILY_LIMIT",
  });
  assert.equal(calls, 4);
  assert.equal((await records(directory, "attempts")).length, 4);
  assert.equal(
    (await notifyIncident(fifth, { ...options, now: NOW + 60_000 })).status,
    "sent",
  );
  assert.equal(calls, 5);
});

test("未配置、非 SCT 字母数字密钥及不安全标识符在落盘前明确阻塞", async (t) => {
  const { options, stateRoot } = await fixture(t);
  options.fetchImpl = async () => assert.fail("不应访问网络");
  for (const key of [undefined, ""]) {
    assert.deepEqual(
      await notifyIncident(INCIDENT, { ...options, sendKey: key }),
      {
        status: "blocked",
        code: "SEND_KEY_MISSING",
      },
    );
  }
  for (const key of ["SC123", "SCT", "SCTa/b", "SCTabc\n", "SCTa?x=1"]) {
    assert.deepEqual(
      await notifyIncident(INCIDENT, { ...options, sendKey: key }),
      {
        status: "blocked",
        code: "SEND_KEY_INVALID",
      },
    );
  }
  for (const patch of [
    { runId: KEY },
    { runId: "SCTOtherCredential" },
    { source: "https://private.example" },
    { source: "username@example.com" },
    { code: "RAW\nPRIVATE" },
    { runId: "../outside" },
  ]) {
    assert.deepEqual(await notifyIncident({ ...INCIDENT, ...patch }, options), {
      status: "blocked",
      code: "INVALID_INCIDENT",
    });
  }
  await assert.rejects(lstat(stateRoot), { code: "ENOENT" });
});

test("密钥、原始异常、原文及任意 action 不进入日志、返回值或状态", async (t) => {
  const { options, directory } = await fixture(t);
  const logged = [];
  for (const name of ["log", "warn", "error", "info", "debug"]) {
    t.mock.method(console, name, (...args) => logged.push(args));
  }
  let form;
  const result = await notifyIncident(
    { ...INCIDENT, action: `${KEY} 私人账单`, message: `${KEY} 私人资料` },
    {
      ...options,
      fetchImpl: async (_url, request) => {
        form = request.body;
        throw new Error(`https://sctapi.ftqq.com/${KEY}.send 私人响应`);
      },
    },
  );
  assert.equal(result.code, "FETCH_FAILED");
  assert.match(form.get("desp"), /自动维护无法完成/);
  const evidence = JSON.stringify([
    result,
    logged,
    form.get("desp"),
    ...(await records(directory, "attempts")),
    ...(await records(directory, "failures")),
  ]);
  for (const forbidden of [
    KEY,
    "私人账单",
    "私人资料",
    "私人响应",
    "ftqq.com",
  ]) {
    assert.equal(evidence.includes(forbidden), false);
  }
  assert.deepEqual(logged, []);
});

for (const scenario of [
  {
    name: "HTTP 拒绝",
    response: () => new Response("private", { status: 500 }),
    code: "HTTP_ERROR",
    known: true,
  },
  {
    name: "业务非零",
    response: () => new Response('{"code":40001,"message":"private"}'),
    code: "SERVICE_REJECTED",
    known: true,
  },
  {
    name: "JSON 畸形",
    response: () => new Response("not-json"),
    code: "RESPONSE_MALFORMED",
  },
  {
    name: "缺少业务码",
    response: () => new Response('{"data":"private"}'),
    code: "RESPONSE_MALFORMED",
  },
  {
    name: "业务码错误类型",
    response: () => new Response('{"code":"0"}'),
    code: "RESPONSE_MALFORMED",
  },
  {
    name: "响应体超限",
    response: () => new Response("x".repeat(16_385)),
    code: "RESPONSE_TOO_LARGE",
  },
  {
    name: "声明响应超限",
    response: () =>
      new Response('{"code":0}', { headers: { "content-length": "999999" } }),
    code: "RESPONSE_TOO_LARGE",
  },
]) {
  test(`${scenario.name} 留失败回执且不会误报成功或立即重发`, async (t) => {
    const { options, directory } = await fixture(t);
    let calls = 0;
    options.fetchImpl = async () => {
      calls++;
      return scenario.response();
    };
    const result = await notifyIncident(INCIDENT, options);
    assert.equal(result.status, "blocked");
    assert.equal(result.code, scenario.code);
    assert.equal((await records(directory, "receipts")).length, 0);
    const failures = await records(directory, "failures");
    assert.equal(failures.length, 1);
    assert.equal(JSON.parse(failures[0].text).code, scenario.code);
    assert.deepEqual(await notifyIncident(INCIDENT, options), {
      status: "suppressed",
      code: scenario.known ? "DUPLICATE" : "UNKNOWN_OUTCOME",
    });
    if (!scenario.known) {
      assert.deepEqual(
        await notifyIncident(INCIDENT, { ...options, now: NOW + DAY * 2 }),
        { status: "suppressed", code: "UNKNOWN_OUTCOME" },
      );
    }
    assert.equal(calls, 1);
  });
}

test("网络实现不响应 AbortSignal 时仍在 10 秒预算后返回，未知结果不重发", async (t) => {
  const { options, directory } = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  const reachedFetch = new Promise((resolve) => {
    started = resolve;
  });
  let signal;
  const pending = notifyIncident(INCIDENT, {
    ...options,
    fetchImpl: async (_url, request) => {
      signal = request.signal;
      started();
      return new Promise(() => {});
    },
  });
  await reachedFetch;
  t.mock.timers.tick(10_001);
  const result = await pending;
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "TIMEOUT");
  assert.equal(signal.aborted, true);
  assert.equal(
    JSON.parse((await records(directory, "failures"))[0].text).outcome,
    "unknown",
  );
  assert.deepEqual(
    await notifyIncident(INCIDENT, { ...options, now: NOW + DAY * 3 }),
    { status: "suppressed", code: "UNKNOWN_OUTCOME" },
  );
});

test("响应流挂起同样受总超时预算保护", async (t) => {
  const { options } = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reading;
  const reachedRead = new Promise((resolve) => {
    reading = resolve;
  });
  const pending = notifyIncident(INCIDENT, {
    ...options,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          pull() {
            reading();
            return new Promise(() => {});
          },
        }),
      ),
  });
  await reachedRead;
  t.mock.timers.tick(10_001);
  assert.equal((await pending).code, "TIMEOUT");
});

test("锁冲突不抢锁；正常持锁发送完成后锁才释放", async (t) => {
  const { options, directory } = await fixture(t);
  let started;
  let finish;
  const reachedFetch = new Promise((resolve) => {
    started = resolve;
  });
  const response = new Promise((resolve) => {
    finish = resolve;
  });
  const first = notifyIncident(INCIDENT, {
    ...options,
    fetchImpl: async () => {
      started();
      return response;
    },
  });
  await reachedFetch;
  assert.deepEqual(
    await notifyIncident({ ...INCIDENT, source: "other" }, options),
    {
      status: "blocked",
      code: "LOCKED",
    },
  );
  assert.ok((await lstat(path.join(directory, "lock"))).isDirectory());
  finish(new Response('{"code":0}'));
  assert.equal((await first).status, "sent");
  await assert.rejects(lstat(path.join(directory, "lock")), { code: "ENOENT" });
});

test("发送后成功回执落盘失败，已持久 attempt 阻止后续自动重发", async (t) => {
  const { options, directory } = await fixture(t);
  let calls = 0;
  const result = await notifyIncident(INCIDENT, {
    ...options,
    fetchImpl: async () => {
      calls++;
      const attempt = JSON.parse(
        (await records(directory, "attempts"))[0].text,
      );
      await writeFile(
        path.join(directory, "receipts", `${attempt.id}.json`),
        "",
        { mode: 0o600 },
      );
      return new Response('{"code":0}');
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "STATE_IO_FAILED");
  const receipt = (await records(directory, "receipts"))[0];
  await rm(receipt.file);
  assert.deepEqual(
    await notifyIncident(INCIDENT, { ...options, now: NOW + DAY * 2 }),
    { status: "suppressed", code: "UNKNOWN_OUTCOME" },
  );
  assert.equal(calls, 1);
});

test("已持久化但未发出的崩溃 attempt 也保守抑制，坏记录阻塞新发送", async (t) => {
  const { options, directory } = await fixture(t);
  for (const name of ["attempts", "receipts", "failures"]) {
    await mkdir(path.join(directory, name), { recursive: true, mode: 0o700 });
  }
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const target = path.join(directory, "attempts", `${id}.json`);
  await writeFile(
    target,
    JSON.stringify({
      version: 1,
      id,
      at: NOW,
      day: "2026-09-10",
      fingerprint: createHash("sha256")
        .update(JSON.stringify([INCIDENT.kind, INCIDENT.code, INCIDENT.source]))
        .digest("hex"),
    }),
    { mode: 0o600 },
  );
  options.fetchImpl = async () => assert.fail("不应访问网络");
  assert.deepEqual(await notifyIncident(INCIDENT, options), {
    status: "suppressed",
    code: "UNKNOWN_OUTCOME",
  });
  await writeFile(target, "{broken");
  assert.deepEqual(
    await notifyIncident({ ...INCIDENT, source: "new" }, options),
    {
      status: "blocked",
      code: "INVALID_STATE",
    },
  );
});

test("失败尝试同样占每日额度，时钟倒退仍不重复发送", async (t) => {
  const { options } = await fixture(t);
  options.fetchImpl = async () => new Response('{"code":1}');
  for (let index = 0; index < 4; index++) {
    assert.equal(
      (
        await notifyIncident(
          { ...INCIDENT, source: `failed-${index}` },
          options,
        )
      ).status,
      "blocked",
    );
  }
  assert.deepEqual(await notifyIncident(INCIDENT, options), {
    status: "suppressed",
    code: "DAILY_LIMIT",
  });
  assert.deepEqual(
    await notifyIncident(
      { ...INCIDENT, source: "failed-0" },
      { ...options, now: NOW - 1 },
    ),
    {
      status: "suppressed",
      code: "DUPLICATE",
    },
  );
});

test("拒绝相对路径和父级穿越；状态目录链接不能越界写入", async (t) => {
  const { options, temporary, stateRoot } = await fixture(t);
  options.fetchImpl = async () => assert.fail("不应访问网络");
  for (const root of [
    "relative-state",
    `${temporary}${path.sep}..${path.sep}outside`,
  ]) {
    assert.deepEqual(
      await notifyIncident(INCIDENT, { ...options, stateRoot: root }),
      {
        status: "blocked",
        code: "UNSAFE_STATE_PATH",
      },
    );
  }
  const target = path.join(temporary, "outside");
  await mkdir(target);
  await symlink(
    target,
    stateRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.deepEqual(await notifyIncident(INCIDENT, options), {
    status: "blocked",
    code: "UNSAFE_STATE_PATH",
  });
  assert.deepEqual(await readdir(target), []);
});

test("状态文件硬链接不会被读作有效历史", async (t) => {
  const { options, directory, temporary } = await fixture(t);
  assert.equal((await notifyIncident(INCIDENT, options)).status, "sent");
  const attempt = (await records(directory, "attempts"))[0];
  await link(attempt.file, path.join(temporary, "outside-hardlink"));
  options.fetchImpl = async () => assert.fail("不应访问网络");
  assert.deepEqual(
    await notifyIncident({ ...INCIDENT, source: "new" }, options),
    {
      status: "blocked",
      code: "UNSAFE_STATE_PATH",
    },
  );
});

test(
  "Linux 下状态文件不安全权限阻塞发送",
  { skip: process.platform === "win32" },
  async (t) => {
    const { options, directory } = await fixture(t);
    assert.equal((await notifyIncident(INCIDENT, options)).status, "sent");
    const attempt = (await records(directory, "attempts"))[0];
    await chmod(attempt.file, 0o644);
    options.fetchImpl = async () => assert.fail("不应访问网络");
    assert.deepEqual(
      await notifyIncident({ ...INCIDENT, source: "new" }, options),
      {
        status: "blocked",
        code: "INVALID_STATE",
      },
    );
  },
);

test("成功推送后锁释放异常不能被报告为完整成功，也不能抢占遗留锁", async (t) => {
  const { options, directory } = await fixture(t);
  const result = await notifyIncident(INCIDENT, {
    ...options,
    fetchImpl: async () => {
      await writeFile(path.join(directory, "lock", "unexpected"), "占用", {
        mode: 0o600,
      });
      return new Response('{"code":0}');
    },
  });
  assert.deepEqual(result, { status: "blocked", code: "LOCK_RELEASE_FAILED" });
  assert.equal((await records(directory, "receipts")).length, 1);
  assert.deepEqual(await notifyIncident(INCIDENT, options), {
    status: "blocked",
    code: "LOCKED",
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
  readFileSync,
  linkSync,
} from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { ConsoleStore } from "../store.ts";
import { hashPassword } from "../crypto.ts";
import { createConsoleServer } from "../server.ts";
import { createSiteFileResolver } from "../security.ts";

const origin = "http://127.0.0.1";
const password = "合成发行路径回归专用密码-20260917";
const linkType = process.platform === "win32" ? "junction" : "dir";
async function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), "idol-release-test-"));
  const releases = path.join(root, "releases");
  const current = path.join(root, "current");
  const data = path.join(releases, "private");
  const keys = path.join(releases, "keys");
  const admin = path.join(releases, "admin");
  for (const name of ["A", "B", "private", "keys", "admin"]) {
    const directory = path.join(releases, name);
    mkdirSync(path.join(directory, "assets"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(directory, "index.html"), name);
    writeFileSync(
      path.join(directory, "assets/groups-data.js"),
      `window.IDOL_GROUPS = ${JSON.stringify({ release: name, whole: name.repeat(25000) })};`,
    );
  }
  mkdirSync(path.join(root, "outside/assets"), { recursive: true });
  writeFileSync(path.join(root, "outside/index.html"), "outside");
  writeFileSync(
    path.join(root, "outside/assets/groups-data.js"),
    'window.IDOL_GROUPS = {"release":"outside"};',
  );
  const key = randomBytes(32);
  const keyFile = path.join(keys, "master.key");
  writeFileSync(keyFile, key, { mode: 0o600 });
  let linked = false;
  const switchTo = (target) => {
    if (linked) unlinkSync(current);
    symlinkSync(target, current, linkType);
    linked = true;
  };
  switchTo(path.join(releases, "A"));
  const store = new ConsoleStore(data, key);
  store.put(
    "account",
    "admin",
    { username: "admin", passwordHash: await hashPassword(password) },
    Date.now(),
  );
  const options = {
    store,
    origin,
    trustedProxy: false,
    devStatic: true,
    adminDirectory: admin,
    siteDirectory: current,
    keyFile,
    geo: {
      ready: false,
      locate: async () => ({ country: "未知", province: "未知", city: "未知" }),
      close() {},
    },
  };
  const cleanup = [];
  t.after(async () => {
    for (const action of cleanup) await action();
    store.close();
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("idol-release-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    releases,
    current,
    data,
    keys,
    keyFile,
    admin,
    store,
    options,
    switchTo,
    cleanup,
  };
}

async function client(base) {
  const login = await fetch(base + "/api/v1/admin/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const csrf = (await login.json()).data.csrf;
  return (route, method = "GET") =>
    fetch(base + route, {
      method,
      headers: { cookie, origin, "x-csrf-token": csrf },
    });
}

async function launch(t, fixture) {
  const server = createConsoleServer(fixture.options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fixture.cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, api: await client(base), base };
}

test("同一HTTP服务随current A→B→A切换，catalog/system/devStatic读取一致", async (t) => {
  const fixture = await setup(t);
  const { api, base } = await launch(t, fixture);
  for (const name of ["A", "B", "A"]) {
    fixture.switchTo(path.join(fixture.releases, name));
    const response = await api("/api/v1/admin/catalog");
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.release, name);
    assert.equal(data.whole, name.repeat(25000));
    assert.equal(
      (await (await api("/api/v1/admin/system")).json()).data.siteAvailable,
      true,
    );
    assert.equal(await (await fetch(base + "/index.html")).text(), name);
    assert.equal((await fetch(base + "/api/v1/admin/catalog")).status, 401);
    assert.equal((await fetch(base + "/master.key")).status, 404);
  }
});

test("断链、越界、允许根本身和私人目录均失败关闭，包括发行文件内部链接", async (t) => {
  const fixture = await setup(t);
  const { api, base } = await launch(t, fixture);
  for (const target of [
    path.join(fixture.root, "missing"),
    path.join(fixture.root, "outside"),
    fixture.releases,
    fixture.data,
    fixture.keys,
    fixture.admin,
  ]) {
    fixture.switchTo(target);
    assert.equal((await api("/api/v1/admin/catalog")).status, 503);
    assert.equal(
      (await (await api("/api/v1/admin/system")).json()).data.siteAvailable,
      false,
    );
    assert.equal((await fetch(base + "/index.html")).status, 503);
  }
  fixture.switchTo(path.join(fixture.releases, "A"));
  const index = path.join(fixture.releases, "A/index.html");
  unlinkSync(index);
  linkSync(path.join(fixture.keys, "index.html"), index);
  assert.equal((await fetch(base + "/index.html")).status, 503);
  assert.equal(
    (await (await api("/api/v1/admin/system")).json()).data.siteAvailable,
    false,
  );
  const assets = path.join(fixture.releases, "A/assets");
  // 只删除本测试创建的公开合成目录，然后链接到同样是合成的私人目录。
  assert.ok(assets.startsWith(fixture.root + path.sep));
  rmSync(assets, { recursive: true });
  symlinkSync(path.join(fixture.keys, "assets"), assets, linkType);
  assert.equal((await api("/api/v1/admin/catalog")).status, 503);
  assert.equal((await fetch(base + "/assets/groups-data.js")).status, 503);
});

test("一次解析返回具体发行路径，current随后切换不改变本次读取", async (t) => {
  const fixture = await setup(t);
  const resolve = createSiteFileResolver(fixture.current, [
    fixture.data,
    fixture.keys,
    fixture.admin,
  ]);
  for (let index = 0; index < 30; index++) {
    const name = index % 2 ? "A" : "B";
    fixture.switchTo(path.join(fixture.releases, name));
    const filename = await resolve("assets/groups-data.js");
    fixture.switchTo(path.join(fixture.releases, name === "A" ? "B" : "A"));
    assert.equal(
      filename,
      path.join(fixture.releases, name, "assets/groups-data.js"),
    );
    assert.ok(readFileSync(filename, "utf8").includes(name.repeat(25000)));
  }
  await assert.rejects(resolve("../keys/master.key"));
});

test("公开目录异步解析期间注销，会话复查仍阻止catalog/system响应", async (t) => {
  const fixture = await setup(t);
  const { api } = await launch(t, fixture);
  const original = fsPromises.realpath;
  let release;
  let entered;
  const barrier = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const mock = t.mock.method(fsPromises, "realpath", async (...args) => {
    if (args[0] === fixture.current) {
      entered();
      await wait;
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const pending = [api("/api/v1/admin/catalog"), api("/api/v1/admin/system")];
    await barrier;
    assert.equal((await api("/api/v1/admin/logout-all", "POST")).status, 200);
    release();
    for (const result of await Promise.all(pending))
      assert.equal(result.status, 401);
  } finally {
    release();
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});

test(
  "真实main子进程保留current配置并在运行中跟随A→B→A",
  { timeout: 15000 },
  async (t) => {
    const fixture = await setup(t);
    const reservation = createNetServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        process.env.CONSOLE_TEST_MAIN ??
          path.resolve("maintenance/console/main.ts"),
        "serve",
        "--data-dir",
        fixture.data,
        "--key-file",
        fixture.keyFile,
        "--admin-dir",
        fixture.admin,
        "--site-dir",
        fixture.current,
        "--origin",
        origin,
        "--port",
        String(port),
        "--dev",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const closed = new Promise((resolve) => child.once("close", resolve));
    fixture.cleanup.push(async () => {
      child.kill();
      await closed;
    });
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("已监听")) resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`服务提前退出，退出码 ${code}`)),
      );
    });
    const api = await client(`http://127.0.0.1:${port}`);
    for (const name of ["A", "B", "A"]) {
      fixture.switchTo(path.join(fixture.releases, name));
      const result = await api("/api/v1/admin/catalog");
      assert.equal(result.status, 200);
      assert.equal((await result.json()).data.release, name);
    }
  },
);

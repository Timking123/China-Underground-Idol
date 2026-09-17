import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  linkSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fixture, login, security } from "./helpers.mjs";

// 真正的原子符号链接替换在独占 Linux 临时目录执行，不以 Windows junction 替代。
const native = { skip: process.platform !== "linux" };
const privateMarker = "SYNTHETIC-PRIVATE-SITE-CONTENT-DO-NOT-SERVE";

function createRelease(directory, marker) {
  mkdirSync(path.join(directory, "assets"), { recursive: true });
  writeFileSync(path.join(directory, "index.html"), marker);
  writeFileSync(
    path.join(directory, "assets/groups-data.js"),
    `window.IDOL_GROUPS = ${JSON.stringify({ marker })};\n`,
  );
}

function replacePointer(current, target) {
  const next = `${current}.next`;
  symlinkSync(target, next, "dir");
  renameSync(next, current);
}

async function publicFixture(t) {
  return fixture(t, {
    trustedProxy: false,
    prepare({ directory, dataDirectory, key }) {
      const first = path.join(directory, "release-a");
      const second = path.join(directory, "release-b");
      const admin = path.join(directory, "public");
      const secrets = path.join(directory, "keys");
      const current = path.join(directory, "current");
      createRelease(first, "public-a");
      createRelease(second, "public-b");
      for (const privatePath of [dataDirectory, admin, secrets])
        createRelease(privatePath, privateMarker);
      const keyFile = path.join(secrets, "master.key");
      writeFileSync(keyFile, key, { mode: 0o600 });
      symlinkSync(first, current, "dir");
      return {
        first,
        second,
        current,
        admin,
        secrets,
        serverOptions: { siteDirectory: current, keyFile, devStatic: true },
      };
    },
  });
}

test(
  "SEC-SITE-01 同一进程跟随 A→B→A，目录、系统状态与匿名预览一致",
  native,
  async (t) => {
    const f = await publicFixture(t);
    const session = await login(f);
    for (const [target, marker] of [
      [f.prepared.first, "public-a"],
      [f.prepared.second, "public-b"],
      [f.prepared.first, "public-a"],
    ]) {
      replacePointer(f.prepared.current, target);
      const catalog = await f.api("/api/v1/admin/catalog", session);
      assert.equal(catalog.status, 200);
      assert.equal(catalog.payload.data.marker, marker);
      const state = await f.api("/api/v1/admin/system", session);
      assert.equal(state.status, 200);
      assert.equal(state.payload.data.siteAvailable, true);
      const preview = await f.api("/index.html");
      assert.equal(preview.status, 200);
      assert.equal(preview.text, marker);
    }
  },
);

test(
  "SEC-SITE-02 current 指向允许父根内的数据库、密钥或后台目录仍拒绝",
  native,
  async (t) => {
    const f = await publicFixture(t);
    const session = await login(f);
    for (const target of [
      f.dataDirectory,
      f.prepared.secrets,
      f.prepared.admin,
      f.directory,
    ]) {
      replacePointer(f.prepared.current, target);
      for (const [endpoint, options] of [
        ["/api/v1/admin/catalog", session],
        ["/index.html", {}],
      ]) {
        const response = await f.api(endpoint, options);
        assert.equal(response.status, 503);
        assert.equal(response.text.includes(privateMarker), false);
        assert.equal(response.text.includes(f.directory), false);
      }
      const state = await f.api("/api/v1/admin/system", session);
      assert.equal(state.status, 200);
      assert.equal(state.payload.data.siteAvailable, false);
    }
  },
);

test(
  "SEC-SITE-03 断链与越出启动时固定父根失败关闭，修复链接后恢复",
  native,
  async (t) => {
    const f = await publicFixture(t);
    const session = await login(f);
    replacePointer(f.prepared.current, path.join(f.directory, "absent"));
    assert.equal((await f.api("/api/v1/admin/catalog", session)).status, 503);
    assert.equal((await f.api("/index.html")).status, 503);
    replacePointer(f.prepared.current, f.prepared.second);
    assert.equal(
      (await f.api("/api/v1/admin/catalog", session)).payload.data.marker,
      "public-b",
    );

    const narrow = path.join(f.directory, "fixed-releases");
    const release = path.join(narrow, "one");
    const current = path.join(f.directory, "fixed-current");
    createRelease(release, "fixed");
    symlinkSync(release, current, "dir");
    const resolve = security.createSiteFileResolver(current, [f.dataDirectory]);
    assert.equal(readFileSync(await resolve("index.html"), "utf8"), "fixed");
    replacePointer(current, f.prepared.first);
    await assert.rejects(resolve("index.html"));
    await assert.rejects(resolve("../release-a/index.html"));
    await assert.rejects(resolve(path.join(f.prepared.first, "index.html")));
  },
);

test(
  "SEC-SITE-04 release 内成员链接不能把私人资料引入匿名预览或目录 API",
  native,
  async (t) => {
    const f = await publicFixture(t);
    const session = await login(f);
    for (const kind of ["symbolic", "hard"]) {
      for (const name of ["index.html", "assets/groups-data.js"]) {
        const file = path.join(f.prepared.first, name);
        unlinkSync(file);
        if (kind === "symbolic")
          symlinkSync(path.join(f.dataDirectory, name), file, "file");
        else linkSync(path.join(f.dataDirectory, name), file);
      }
      for (const [endpoint, options] of [
        ["/index.html", {}],
        ["/api/v1/admin/catalog", session],
      ]) {
        const response = await f.api(endpoint, options);
        assert.equal(response.status, 503);
        assert.equal(response.text.includes(privateMarker), false);
      }
      assert.equal(
        (await f.api("/api/v1/admin/system", session)).payload.data
          .siteAvailable,
        false,
      );
    }
  },
);

test(
  "SEC-SITE-05 解析结果固定具体版本，并发切换只得到完整 A 或 B",
  native,
  async (t) => {
    const f = await publicFixture(t);
    const resolve = security.createSiteFileResolver(f.prepared.current, [
      f.dataDirectory,
      f.prepared.admin,
      f.prepared.secrets,
    ]);
    const firstFile = await resolve("index.html");
    replacePointer(f.prepared.current, f.prepared.second);
    assert.equal(readFileSync(firstFile, "utf8"), "public-a");
    assert.equal(readFileSync(await resolve("index.html"), "utf8"), "public-b");
    const pending = [];
    for (let index = 0; index < 40; index++) {
      replacePointer(
        f.prepared.current,
        index % 2 ? f.prepared.first : f.prepared.second,
      );
      pending.push(resolve("index.html"));
    }
    const expected = new Set([
      path.join(f.prepared.first, "index.html"),
      path.join(f.prepared.second, "index.html"),
    ]);
    for (const filename of await Promise.all(pending)) {
      assert.ok(expected.has(filename));
      assert.ok(
        ["public-a", "public-b"].includes(readFileSync(filename, "utf8")),
      );
    }
  },
);

test(
  "SEC-SITE-06 文件异步读取期间撤销会话，catalog/system 均不能返回数据",
  native,
  async (t) => {
    const f = await publicFixture(t);
    for (const endpoint of ["catalog", "system"]) {
      const session = await login(f);
      const original = f.store.get;
      let armed = true;
      // 只安排撤销时点；真实 SQLite、目录解析、HTTP 与末尾认证校验仍执行。
      f.store.get = function (bucket, id) {
        const value = original.call(this, bucket, id);
        if (bucket === "sessions" && armed) {
          armed = false;
          queueMicrotask(() =>
            this.db
              .prepare("DELETE FROM records WHERE bucket='sessions'")
              .run(),
          );
        }
        return value;
      };
      try {
        const response = await f.api(`/api/v1/admin/${endpoint}`, session);
        assert.equal(response.status, 401);
        assert.equal(response.text.includes("public-a"), false);
      } finally {
        f.store.get = original;
      }
    }
  },
);

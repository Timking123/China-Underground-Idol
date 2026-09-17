import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture, NOW, storage, crypto, security } from "./helpers.mjs";

const DAY = 86400000;
const expiredAt = NOW - (storage.RETENTION_DAYS * DAY + 1);

function syntheticFeedback(createdAt = NOW) {
  return {
    kind: "feedback",
    target: "存储验收-私人目标-SECURITY-SENTINEL",
    source: "https://example.invalid/source",
    details: "存储验收-私人正文-SECURITY-SENTINEL",
    contact: "storage-sentinel@example.invalid",
    consent: true,
    website: "",
    requestId: randomUUID(),
    createdAt,
  };
}

test("SEC-STORE-01 私人投稿、完整 IP 和访问载荷在数据库、WAL 与 journal 中均不是明文", async (t) => {
  const f = await fixture(t);
  const input = syntheticFeedback();
  const saved = f.store.createFeedback(input, "192.0.2.231", NOW);
  f.store.addVisit(
    {
      id: f.store.vault.tag("event", randomUUID()),
      createdAt: NOW,
      ip: "192.0.2.231",
      path: "/guide.html",
      referrer: "example.invalid",
      browser: "Chrome",
      device: "电脑",
      country: "测试国家",
      province: "测试省",
      city: "测试市",
    },
    "Chrome/电脑",
  );
  const files = readdirSync(f.dataDirectory).filter((name) =>
    name.startsWith("console.sqlite"),
  );
  assert.ok(files.includes("console.sqlite"));
  for (const name of files) {
    const bytes = readFileSync(path.join(f.dataDirectory, name));
    for (const sentinel of [
      input.target,
      input.details,
      input.contact,
      "192.0.2.231",
    ])
      assert.equal(
        bytes.includes(Buffer.from(sentinel)),
        false,
        `${name} 泄露 ${sentinel}`,
      );
  }
  assert.deepEqual(f.store.get("feedback", saved.id).details, input.details);
  assert.equal(f.store.visitsPage(1, NOW).items[0].ip, "192.0.2.231");
});

test("SEC-STORE-02 错误主密钥、交换作用域和损坏密文均拒绝，原库不被替换", async (t) => {
  const f = await fixture(t);
  const saved = f.store.createFeedback(syntheticFeedback(), "192.0.2.231", NOW);
  assert.throws(
    () => new storage.ConsoleStore(f.dataDirectory, randomBytes(32)),
  );
  assert.equal(f.store.get("feedback", saved.id).id, saved.id);
  const sealed = f.store.vault.seal("feedback/a", { secret: "AAD-SENTINEL" });
  assert.throws(() => f.store.vault.open("feedback/b", sealed));
  const [version, nonce, tag, ciphertext] = sealed.split(".");
  const bytes = Buffer.from(ciphertext, "base64");
  bytes[0] ^= 1;
  assert.throws(() =>
    f.store.vault.open(
      "feedback/a",
      [version, nonce, tag, bytes.toString("base64")].join("."),
    ),
  );
});

test("SEC-STORE-03 90 天清理移除过期明细与访问记录、清空过期 IP，但保留汇总和边界内数据", async (t) => {
  const f = await fixture(t);
  const old = f.store.createFeedback(
    syntheticFeedback(expiredAt),
    "192.0.2.231",
    expiredAt,
  );
  const oldVisit = {
    id: f.store.vault.tag("event", "old"),
    createdAt: expiredAt,
    ip: "192.0.2.231",
    path: "/",
    referrer: "直接访问",
    browser: "其他",
    device: "电脑",
    country: "测试国家",
    province: "测试省",
    city: "测试市",
  };
  const boundaryVisit = {
    ...oldVisit,
    id: f.store.vault.tag("event", "boundary"),
    createdAt: expiredAt + 1,
  };
  f.store.addVisit(oldVisit, "其他/电脑");
  f.store.addVisit(boundaryVisit, "其他/电脑");
  f.store.cleanup(NOW);
  assert.equal(f.store.get("feedback", old.id).ip, "");
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) AS n FROM visits WHERE id=?")
      .get(oldVisit.id).n,
    0,
  );
  assert.equal(
    f.store.db
      .prepare("SELECT count(*) AS n FROM visits WHERE id=?")
      .get(boundaryVisit.id).n,
    1,
  );
  assert.equal(f.store.get("daily", storage.chinaDay(expiredAt)).pv, 2);
  assert.equal(f.store.list(`regions:${storage.chinaDay(expiredAt)}`)[0].pv, 2);
  f.store.cleanup(NOW);
  assert.equal(f.store.get("daily", storage.chinaDay(expiredAt)).pv, 2);
});

test("SEC-STORE-04 事务、限流和密钥/公开目录隔离失败时不留下半成品", async (t) => {
  const f = await fixture(t);
  assert.throws(() =>
    f.store.transaction(() => {
      f.store.put("probe", "a", { private: "SENTINEL" }, NOW);
      throw new Error("synthetic rollback");
    }),
  );
  assert.equal(f.store.get("probe", "a"), null);
  assert.equal(f.store.allow("security", "synthetic", 2, 1000, NOW), true);
  assert.equal(f.store.allow("security", "synthetic", 2, 1000, NOW), true);
  assert.equal(f.store.allow("security", "synthetic", 2, 1000, NOW), false);
  assert.throws(() =>
    security.assertStorageIsolation(
      path.join(f.directory, "private"),
      path.join(f.directory, "private", "key"),
      [path.join(f.directory, "public")],
    ),
  );
  assert.throws(() =>
    security.assertStorageIsolation(
      path.join(f.directory, "private"),
      path.join(f.directory, "key"),
      [path.join(f.directory, "private", "public")],
    ),
  );
  await crypto
    .verifyPassword("合成安全验收-不存在的密码", "s1$invalid$invalid")
    .then((result) => assert.equal(result, false));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ConsoleStore, chinaDay, RETENTION_DAYS } from "../store.ts";
import { Vault, hashPassword, verifyPassword } from "../crypto.ts";

const scratch = path.resolve("work/console-backend-tests");
mkdirSync(scratch, { recursive: true });
const time = Date.UTC(2026, 8, 17);
const day = 86400000;
function fixture(t) {
  const directory = mkdtempSync(path.join(scratch, "storage-"));
  const key = randomBytes(32);
  const store = new ConsoleStore(directory, key);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory, key };
}
function feedback(id, createdAt = time) {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    kind: "feedback",
    status: "pending",
    note: "",
    target: "测试目标",
    source: "",
    details: "私人测试正文-加密哨兵",
    contact: "private-sentinel@example.invalid",
    ip: "192.0.2.231",
  };
}
function visit(id, createdAt = time) {
  return {
    id,
    createdAt,
    ip: "192.0.2.231",
    path: "/",
    referrer: "直接访问",
    browser: "其他",
    device: "电脑",
    country: "中国",
    province: "测试省",
    city: "测试市",
  };
}

test("认证加密拒绝错误主密钥、交换记录与损坏密文", () => {
  const vault = new Vault(randomBytes(32));
  const encrypted = vault.seal("feedback/a", { secret: "私人哨兵" });
  assert.deepEqual(vault.open("feedback/a", encrypted), { secret: "私人哨兵" });
  assert.notEqual(vault.seal("feedback/a", { secret: "私人哨兵" }), encrypted);
  assert.throws(() => vault.open("feedback/b", encrypted));
  assert.throws(() => new Vault(randomBytes(32)).open("feedback/a", encrypted));
  const parts = encrypted.split(".");
  const bytes = Buffer.from(parts[3], "base64");
  bytes[0] ^= 1;
  parts[3] = bytes.toString("base64");
  assert.throws(() => vault.open("feedback/a", parts.join(".")));
});

test("密码采用随机盐且错误密码和畸形摘要失败", async () => {
  const password = "测试用长密码-不属于真实凭据";
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("错误密码", first), false);
  assert.equal(await verifyPassword(password, "s1$invalid$invalid"), false);
  await assert.rejects(hashPassword("短密码"));
});

test("超过一万条的反馈分页、状态筛选与待处理计数不会截断", (t) => {
  const { store } = fixture(t);
  store.transaction(() => {
    for (let n = 0; n < 10005; n++) {
      const id = String(n).padStart(24, "0");
      store.put("feedback", id, feedback(id), time);
    }
  });
  assert.equal(store.feedbackPage(1, "").total, 10005);
  assert.equal(store.feedbackPage(401, "pending").items.length, 5);
  assert.equal(store.dashboard(7, time).pending, 10005);
  const seen = new Set();
  for (let page = 1; page <= 401; page++)
    for (const item of store.feedbackPage(page, "").items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
  assert.equal(seen.size, 10005);
  store.reviewFeedback(
    "000000000000000000000000",
    "resolved",
    "处理测试",
    "admin",
    time,
  );
  assert.equal(store.feedbackPage(1, "resolved").total, 1);
  assert.equal(store.feedbackPage(1, "pending").total, 10004);
});

test("90 天清理遍历全部过期记录、删除去重标签并保留每日与地区汇总", (t) => {
  const { store } = fixture(t);
  const expired = time - RETENTION_DAYS * day - 1;
  store.transaction(() => {
    for (let n = 0; n < 10005; n++) {
      const id = String(n).padStart(24, "0");
      store.put("feedback", id, feedback(id, expired), expired);
    }
  });
  store.addVisit(visit("expired", expired), "其他/电脑");
  store.addVisit(visit("boundary", expired + 1), "其他/电脑");
  store.cleanup(time);
  assert.equal(store.get("feedback", "000000000000000000000000").ip, "");
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM visits WHERE id='expired'")
      .get().n,
    0,
  );
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM visits").get().n, 1);
  assert.equal(store.get("daily", chinaDay(expired)).pv, 2);
  assert.equal(store.list(`regions:${chinaDay(expired)}`)[0].pv, 2);
  store.cleanup(time);
  assert.equal(store.get("daily", chinaDay(expired)).pv, 2);
});

test("访问和投稿幂等、跨日 UV/IP 以及数据库和 WAL 无私人明文", (t) => {
  const { store, directory } = fixture(t);
  const input = {
    kind: "feedback",
    target: "私人测试目标",
    source: "",
    details: "私人测试正文-加密哨兵",
    contact: "private-sentinel@example.invalid",
    consent: true,
    website: "",
    requestId: randomUUID(),
  };
  const first = store.createFeedback(input, "192.0.2.231", time);
  assert.equal(
    store.createFeedback(input, "192.0.2.231", time + 1).id,
    first.id,
  );
  for (const record of [
    visit("a"),
    visit("a"),
    visit("b"),
    visit("c", time + day),
  ])
    store.addVisit(record, "其他/电脑");
  assert.deepEqual(store.get("daily", chinaDay(time)), {
    day: chinaDay(time),
    pv: 2,
    uv: 1,
    ips: 1,
  });
  assert.equal(store.get("daily", chinaDay(time + day)).uv, 1);
  const files = readdirSync(directory).filter((name) =>
    name.startsWith("console.sqlite"),
  );
  assert.ok(files.includes("console.sqlite-wal"));
  for (const name of files) {
    const bytes = readFileSync(path.join(directory, name));
    for (const sentinel of [
      input.target,
      input.details,
      input.contact,
      "192.0.2.231",
    ])
      assert.equal(
        bytes.includes(Buffer.from(sentinel)),
        false,
        "存储中不应出现私人哨兵",
      );
  }
});

test("错误密钥与损坏数据库标记拒绝打开且不覆盖现有数据", (t) => {
  const { store, directory, key } = fixture(t);
  store.put("feedback", "a", feedback("a"), time);
  assert.throws(() => new ConsoleStore(directory, randomBytes(32)));
  assert.equal(store.get("feedback", "a").id, "a");
  store.db
    .prepare(
      "UPDATE records SET payload='damaged' WHERE bucket='meta' AND id='key-check'",
    )
    .run();
  assert.throws(() => new ConsoleStore(directory, key));
});

test("事务失败回滚，限流跨连接和重启保持", (t) => {
  const { store, directory, key } = fixture(t);
  assert.throws(() =>
    store.transaction(() => {
      store.put("probe", "a", { x: 1 }, time);
      throw new Error("模拟事务中断");
    }),
  );
  assert.equal(store.get("probe", "a"), null);
  assert.equal(store.allow("test", "identity", 2, 1000, time), true);
  const other = new ConsoleStore(directory, key);
  try {
    assert.equal(other.allow("test", "identity", 2, 1000, time), true);
    assert.equal(store.allow("test", "identity", 2, 1000, time), false);
    assert.equal(other.allow("test", "identity", 2, 1000, time + 1000), true);
  } finally {
    other.close();
  }
});

test("空数据库初始化中断后可以使用原密钥恢复", (t) => {
  const directory = mkdtempSync(path.join(scratch, "empty-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  new DatabaseSync(path.join(directory, "console.sqlite")).close();
  const store = new ConsoleStore(directory, randomBytes(32));
  try {
    assert.equal(store.get("meta", "key-check").check, "idol-console-v1");
  } finally {
    store.close();
  }
});

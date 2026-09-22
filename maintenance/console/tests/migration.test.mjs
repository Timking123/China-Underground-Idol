import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ConsoleStore } from "../store.ts";
import { packageMigration } from "../../../scripts/packageMigration.mjs";

test("在线 backup 纳入 WAL，原 key 验证旧新 bucket 与原始到期；只读核验拒绝错 key/空库", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "idol-migration-store-"));
  const live = path.join(root, "live"),
    copy = path.join(root, "snapshot"),
    key = randomBytes(32);
  mkdirSync(copy, { mode: 0o700 });
  const keyFile = path.join(root, "master.key");
  writeFileSync(keyFile, key, { mode: 0o600 });
  const store = new ConsoleStore(live, key);
  const time = 1_700_000_000_000;
  try {
    store.db.exec("PRAGMA wal_autocheckpoint=0");
    store.put(
      "account",
      "admin",
      { username: "synthetic", passwordHash: "synthetic" },
      time,
    );
    store.put(
      "sessions",
      "old-session",
      { createdAt: time, touchedAt: time + 1 },
      time,
    );
    store.put(
      "editorial-revisions",
      "new-revision",
      { status: "draft", details: "合成迁移隐私哨兵" },
      time + 2,
    );
    store.put(
      "future-encrypted-bucket",
      "future-id",
      { preserved: true },
      time + 3,
    );
    store.db
      .prepare("INSERT INTO limits VALUES (?,?,?)")
      .run("synthetic-limit", time + 999, 3);
    assert.ok(readFileSync(`${store.filename}-wal`).length > 0);
    const source = fileURLToPath(
      new URL("../../migration/snapshot.py", import.meta.url),
    );
    const py =
      "import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('migration',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.online_database_copy(Path(sys.argv[2]),Path(sys.argv[3]))";
    const result = spawnSync(
      "python",
      ["-c", py, source, store.filename, path.join(copy, "console.sqlite")],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const restored = new ConsoleStore(copy, key, { readOnly: true });
    try {
      assert.deepEqual(restored.get("future-encrypted-bucket", "future-id"), {
        preserved: true,
      });
      assert.equal(
        restored.get("editorial-revisions", "new-revision").status,
        "draft",
      );
      assert.equal(restored.get("sessions", "old-session").touchedAt, time + 1);
      assert.equal(
        restored.db.prepare("SELECT expires FROM limits").get().expires,
        time + 999,
      );
      assert.equal(
        restored.db
          .prepare("SELECT updated_at FROM records WHERE bucket='sessions'")
          .get().updated_at,
        time,
      );
    } finally {
      restored.close();
    }
    const before = readFileSync(path.join(copy, "console.sqlite"));
    assert.throws(
      () => new ConsoleStore(copy, randomBytes(32), { readOnly: true }),
    );
    assert.deepEqual(readFileSync(path.join(copy, "console.sqlite")), before);
    assert.equal(before.includes(Buffer.from("合成迁移隐私哨兵")), false);
    const tools = await packageMigration(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    const validate =
      "import importlib.util,sys,json;from pathlib import Path;s=importlib.util.spec_from_file_location('migration',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.inspect_database(Path(sys.argv[2]),Path(sys.argv[3]),Path(sys.argv[4]),sys.argv[5])))";
    const cli = spawnSync(
      "python",
      ["-c", validate, source, copy, keyFile, tools.output, process.execPath],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).initialized, false);
    const empty = path.join(root, "empty");
    mkdirSync(empty, { mode: 0o700 });
    writeFileSync(path.join(empty, "console.sqlite"), Buffer.alloc(0), {
      mode: 0o600,
    });
    assert.throws(() => new ConsoleStore(empty, key, { readOnly: true }));
    assert.equal(readFileSync(path.join(empty, "console.sqlite")).length, 0);
  } finally {
    store.close();
  }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPipelineStore, sha256Bytes } from "../src/pipelineStore.ts";

// 仅在自有报告目录创建合成夹具；不接触真实 private/store 或公开活动数据。
const evidenceRoot = fileURLToPath(
  new URL("../../reports/pipeline-store/fixtures/", import.meta.url),
);
async function fixture(options = {}) {
  await mkdir(evidenceRoot, { recursive: true });
  const directory = await mkdtemp(join(evidenceRoot, "case-"));
  const storeRoot = join(directory, "store");
  const store = await createPipelineStore(storeRoot, options);
  return { directory, storeRoot, store };
}
function isCode(code) {
  return (error) => error?.code === code;
}
function lockRecord(scope, pid, overrides = {}) {
  return {
    schemaVersion: "pipeline-store-lock-v1",
    scope,
    nonce: randomUUID(),
    pid,
    host: hostname(),
    createdAt: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}
async function installLock(storeRoot, record) {
  await mkdir(join(storeRoot, ".locks"), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(record));
  await writeFile(
    join(storeRoot, ".locks", `${record.scope}.lock.json`),
    bytes,
  );
  return bytes;
}
async function child(code, args = []) {
  const process = spawn(
    globalThis.process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", code, ...args],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  process.stdout.on("data", (chunk) => {
    output += chunk;
  });
  process.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exitCode = await new Promise((fulfill, reject) => {
    process.once("error", reject);
    process.once("close", fulfill);
  });
  return { pid: process.pid, exitCode, output };
}
async function deadPid() {
  const result = await child("process.exit(0)");
  assert.equal(result.exitCode, 0, result.output);
  return result.pid;
}

test("创建真实 storeRoot，拒绝相对根、盘符根和符号链接根", async () => {
  const { directory, storeRoot } = await fixture();
  assert.equal((await lstat(storeRoot)).isDirectory(), true);
  await assert.rejects(
    () => createPipelineStore("relative-root"),
    isCode("UNSAFE_ROOT"),
  );
  await assert.rejects(
    () => createPipelineStore(resolve(storeRoot, "/")),
    isCode("UNSAFE_ROOT"),
  );
  const alias = join(directory, "alias");
  await symlink(storeRoot, alias, "junction");
  await assert.rejects(() => createPipelineStore(alias), isCode("UNSAFE_ROOT"));
});

test("readRegular 拒绝越界、绝对路径、反斜线、ADS、设备名和尾点别名", async () => {
  const { store } = await fixture();
  for (const relative of [
    "../outside",
    "/absolute",
    "C:/absolute",
    "x\\y",
    "x/../y",
    "x//y",
    "x:stream",
    "NUL.json",
    "CON",
    "x. ",
    "x.",
    "./x",
  ]) {
    await assert.rejects(
      () => store.readRegular(relative),
      isCode("UNSAFE_PATH"),
      relative,
    );
  }
});

test("readRegular 拒绝 junction 软链接作为最终文件或中间路径", async () => {
  const { directory, storeRoot, store } = await fixture();
  const outside = join(directory, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.bin"), "合成边界");
  await symlink(outside, join(storeRoot, "linked-dir"), "junction");
  await assert.rejects(
    () => store.readRegular("linked-dir/secret.bin"),
    isCode("UNSAFE_PATH"),
  );
  await assert.rejects(
    () => store.readRegular("linked-dir"),
    isCode("NOT_REGULAR"),
  );
});

test("readRegular 拒绝文件符号链接（宿主有创建权限时）", async (context) => {
  const { directory, storeRoot, store } = await fixture();
  await writeFile(join(directory, "synthetic.txt"), "合成边界");
  try {
    await symlink(
      join(directory, "synthetic.txt"),
      join(storeRoot, "linked-file"),
      "file",
    );
  } catch (error) {
    if (error.code === "EPERM" && process.platform === "win32") {
      context.skip(
        "Windows 普通与提升运行均拒绝创建文件 symlink；目录 junction 软链接另有实际断言",
      );
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => store.readRegular("linked-file"),
    isCode("NOT_REGULAR"),
  );
});

test("readRegular 拒绝多硬链接、目录和超大文件", async () => {
  const { directory, storeRoot, store } = await fixture({ maxFileBytes: 4096 });
  await writeFile(join(directory, "external.bin"), "合成硬链接");
  await link(join(directory, "external.bin"), join(storeRoot, "shared.bin"));
  await assert.rejects(
    () => store.readRegular("shared.bin"),
    isCode("HARD_LINK"),
  );
  await mkdir(join(storeRoot, "folder"));
  await assert.rejects(
    () => store.readRegular("folder"),
    isCode("NOT_REGULAR"),
  );
  await writeFile(join(storeRoot, "large.bin"), Buffer.alloc(4097));
  await assert.rejects(
    () => store.readRegular("large.bin"),
    isCode("FILE_TOO_LARGE"),
  );
});

test("所有公共写入要求有效锁且不允许直接修改内部命名空间", async () => {
  const { store } = await fixture();
  await assert.rejects(
    () => store.putImmutable("data/a.txt", "合成"),
    isCode("LOCK_REQUIRED"),
  );
  await assert.rejects(
    () => store.atomicReplace("data/a.txt", "合成", null),
    isCode("LOCK_REQUIRED"),
  );
  await assert.rejects(
    () => store.commitRun("manual", "a", { "a.txt": "合成" }, {}),
    isCode("LOCK_REQUIRED"),
  );
  await store.withStoreLock("write", async () => {
    await assert.rejects(
      () => store.putImmutable(".locks/write.lock.json", "替换"),
      isCode("RESERVED_PATH"),
    );
    await assert.rejects(
      () => store.atomicReplace("runs/manual/a/intent.json", "替换", null),
      isCode("RESERVED_PATH"),
    );
  });
});

test("锁冲突不抢占；回调正常完成后仅释放自己的锁", async () => {
  const { storeRoot, store } = await fixture();
  const other = await createPipelineStore(storeRoot);
  await store.withStoreLock("import", async () => {
    const record = JSON.parse(
      await store.readRegular(".locks/import.lock.json"),
    );
    assert.equal(record.pid, process.pid);
    assert.equal(record.host, hostname());
    assert.ok(record.nonce);
    await assert.rejects(
      () => other.withStoreLock("import", async () => assert.fail("不能执行")),
      isCode("LOCKED"),
    );
  });
  await assert.rejects(
    () => readFile(join(storeRoot, ".locks/import.lock.json")),
    isCode("ENOENT"),
  );
});

test("锁异常不按年龄抢占，缺失或损坏锁元数据不自动修复", async () => {
  const { storeRoot, store } = await fixture();
  await mkdir(join(storeRoot, ".locks"));
  await writeFile(join(storeRoot, ".locks/import.lock.json"), "半截 JSON {");
  await assert.rejects(
    () => store.withStoreLock("import", () => assert.fail("不能执行")),
    isCode("LOCKED"),
  );
  const bytes = await readFile(join(storeRoot, ".locks/import.lock.json"));
  await assert.rejects(
    () => store.recoverLock("import", sha256Bytes(bytes)),
    isCode("INVALID_JSON"),
  );
  assert.deepEqual(
    await readFile(join(storeRoot, ".locks/import.lock.json")),
    bytes,
  );
});

test("锁内容漂移时不继续写入也不删除其他持有者锁", async () => {
  const { storeRoot, store } = await fixture();
  const replacement = Buffer.from("合成其他持有者锁");
  await assert.rejects(
    () =>
      store.withStoreLock("import", async () => {
        await writeFile(
          join(storeRoot, ".locks/import.lock.json"),
          replacement,
        );
        await assert.rejects(
          () => store.putImmutable("data/a", "不能写"),
          isCode("LOCK_DRIFT"),
        );
      }),
    isCode("LOCK_DRIFT"),
  );
  assert.deepEqual(
    await readFile(join(storeRoot, ".locks/import.lock.json")),
    replacement,
  );
  await assert.rejects(
    () => readFile(join(storeRoot, "data/a")),
    isCode("ENOENT"),
  );
});

test("锁被同字节新 inode 替换也视为漂移并保留新锁", async () => {
  const { directory, storeRoot, store } = await fixture();
  const lockPath = join(storeRoot, ".locks/import.lock.json");
  const originalPath = join(directory, "original-lock.json");
  let original;
  await assert.rejects(
    () =>
      store.withStoreLock("import", async () => {
        original = await readFile(lockPath);
        // 保留旧 inode，避免 Linux 将 unlink 后的 inode 立即复用给新锁。
        await rename(lockPath, originalPath);
        await writeFile(lockPath, original, { flag: "wx" });
        assert.notEqual(
          (await lstat(lockPath, { bigint: true })).ino,
          (await lstat(originalPath, { bigint: true })).ino,
          "合成替换必须实际创建不同 inode",
        );
      }),
    isCode("LOCK_DRIFT"),
  );
  assert.deepEqual(await readFile(lockPath), original);
  assert.deepEqual(await readFile(originalPath), original);
});

test("回调抛错仍释放自己的锁，异常本身原样返回", async () => {
  const { storeRoot, store } = await fixture();
  const original = new Error("合成回调失败");
  await assert.rejects(
    () =>
      store.withStoreLock("import", async () => {
        throw original;
      }),
    (error) => error === original,
  );
  await assert.rejects(
    () => readFile(join(storeRoot, ".locks/import.lock.json")),
    isCode("ENOENT"),
  );
});

test("回调返回后遗留异步链不能继续借用已释放的锁", async () => {
  const { store } = await fixture();
  let later;
  await store.withStoreLock("import", async () => {
    later = new Promise((fulfill) =>
      setTimeout(async () => {
        try {
          await store.putImmutable("late.txt", "合成");
          fulfill("unexpected-write");
        } catch (error) {
          fulfill(error.code);
        }
      }, 20),
    );
  });
  assert.equal(await later, "LOCK_REQUIRED");
});

test("putImmutable 相同内容复用，不同内容拒绝且不改变原 inode", async () => {
  const { storeRoot, store } = await fixture();
  await store.withStoreLock("import", async () => {
    const first = await store.putImmutable("objects/a.txt", "合成原像");
    const stat = await lstat(join(storeRoot, "objects/a.txt"), {
      bigint: true,
    });
    const second = await store.putImmutable("objects/a.txt", "合成原像");
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.sha256, sha256Bytes("合成原像"));
    await assert.rejects(
      () => store.putImmutable("objects/a.txt", "不同原像"),
      isCode("IMMUTABLE_CONFLICT"),
    );
    assert.equal(
      (await lstat(join(storeRoot, "objects/a.txt"), { bigint: true })).ino,
      stat.ino,
    );
    assert.equal(
      (await store.readRegular("objects/a.txt")).toString(),
      "合成原像",
    );
  });
});

test("exclusive 发布前被插入不同目标时拒绝覆盖", async () => {
  let root;
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (
        point.point === "immutable:after-stage" &&
        point.relative === "objects/a.txt"
      ) {
        await mkdir(join(root, "objects"), { recursive: true });
        await writeFile(join(root, "objects/a.txt"), "合成外部写入");
      }
    },
  });
  root = storeRoot;
  await store.withStoreLock("import", async () => {
    await assert.rejects(
      () => store.putImmutable("objects/a.txt", "合成目标"),
      isCode("IMMUTABLE_CONFLICT"),
    );
  });
  assert.equal(
    (await readFile(join(root, "objects/a.txt"))).toString(),
    "合成外部写入",
  );
});

test("暂存后中断保留现场，同输入可以完成缺失目标", async () => {
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "immutable:after-stage") throw new Error("合成中断");
    },
  });
  await assert.rejects(
    () =>
      store.withStoreLock("import", () =>
        store.putImmutable("objects/a.txt", "合成原像"),
      ),
    /合成中断/,
  );
  await assert.rejects(
    () => store.readRegular("objects/a.txt"),
    isCode("ENOENT"),
  );
  const resumed = await createPipelineStore(storeRoot);
  await resumed.withStoreLock("import", () =>
    resumed.putImmutable("objects/a.txt", "合成原像"),
  );
  assert.equal(
    (await resumed.readRegular("objects/a.txt")).toString(),
    "合成原像",
  );
});

test("exclusive link 后中断的自有暂存双链接可在同输入恢复时解除", async () => {
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "immutable:after-link")
        throw new Error("合成链接后中断");
    },
  });
  await assert.rejects(
    () =>
      store.withStoreLock("import", () =>
        store.putImmutable("objects/a.txt", "合成原像"),
      ),
    /合成链接后中断/,
  );
  await assert.rejects(
    () => store.readRegular("objects/a.txt"),
    isCode("HARD_LINK"),
  );
  const resumed = await createPipelineStore(storeRoot);
  const result = await resumed.withStoreLock("import", () =>
    resumed.putImmutable("objects/a.txt", "合成原像"),
  );
  assert.equal(result.reused, true);
  assert.equal((await lstat(join(storeRoot, "objects/a.txt"))).nlink, 1);
  assert.equal(
    (await resumed.readRegular("objects/a.txt")).toString(),
    "合成原像",
  );
});

test("putImmutable 和 atomicReplace 不修改外部共享硬链接 inode", async () => {
  const { directory, storeRoot, store } = await fixture();
  await writeFile(join(directory, "original.txt"), "合成共享原像");
  await link(join(directory, "original.txt"), join(storeRoot, "shared.txt"));
  await store.withStoreLock("import", async () => {
    await assert.rejects(() => store.putImmutable("shared.txt", "合成新值"));
    await assert.rejects(
      () =>
        store.atomicReplace(
          "shared.txt",
          "合成新值",
          sha256Bytes("合成共享原像"),
        ),
      isCode("HARD_LINK"),
    );
  });
  assert.equal(
    (await readFile(join(directory, "original.txt"))).toString(),
    "合成共享原像",
  );
  assert.equal(
    (await readFile(join(storeRoot, "shared.txt"))).toString(),
    "合成共享原像",
  );
});

test("commitRun 固定意图、完整文件集合和完成标志，重复同输入复用", async () => {
  const { storeRoot, store } = await fixture();
  const files = { "b.txt": "合成 B", "nested/a.json": '{"synthetic":true}' };
  const first = await store.withStoreLock("import", () =>
    store.commitRun("manual", "run-a", files, {
      synthetic: true,
      note: "合成",
    }),
  );
  assert.equal(first.status, "complete");
  assert.equal(first.reused, false);
  assert.equal(first.files["b.txt"].toString(), "合成 B");
  const intentBefore = await readFile(
    join(storeRoot, "runs/manual/run-a/intent.json"),
  );
  const completeBefore = await readFile(
    join(storeRoot, "runs/manual/run-a/complete.json"),
  );
  const second = await store.withStoreLock("import", () =>
    store.commitRun(
      "manual",
      "run-a",
      { "nested/a.json": files["nested/a.json"], "b.txt": files["b.txt"] },
      { note: "合成", synthetic: true },
    ),
  );
  assert.equal(second.reused, true);
  assert.deepEqual(
    await readFile(join(storeRoot, "runs/manual/run-a/intent.json")),
    intentBefore,
  );
  assert.deepEqual(
    await readFile(join(storeRoot, "runs/manual/run-a/complete.json")),
    completeBefore,
  );
  assert.deepEqual(
    (await store.listRuns("manual")).map((run) => run.status),
    ["complete"],
  );
});

test("部分文件落盘失败明确 failed，同原像补齐后保留失败凭证", async () => {
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "run:after-file" && point.relative === "a.txt")
        throw new Error("合成中途失败");
    },
  });
  const files = { "a.txt": "合成 A", "b.txt": "合成 B" };
  await assert.rejects(
    () =>
      store.withStoreLock("import", () =>
        store.commitRun("manual", "resume-a", files, {}),
      ),
    /合成中途失败/,
  );
  const pending = await store.readRun("manual", "resume-a");
  assert.equal(pending.status, "failed");
  assert.equal(pending.failedAttempts.length, 1);
  await assert.rejects(
    () => readFile(join(storeRoot, "runs/manual/resume-a/complete.json")),
    isCode("ENOENT"),
  );
  const originalA = await lstat(
    join(storeRoot, "runs/manual/resume-a/files/a.txt"),
    { bigint: true },
  );
  const resumed = await createPipelineStore(storeRoot);
  const result = await resumed.withStoreLock("import", () =>
    resumed.commitRun("manual", "resume-a", files, {}),
  );
  assert.equal(result.status, "complete");
  assert.equal(result.failedAttempts.length, 1);
  assert.equal(
    (
      await lstat(join(storeRoot, "runs/manual/resume-a/files/a.txt"), {
        bigint: true,
      })
    ).ino,
    originalA.ino,
  );
});

test("中断后输入文件、集合或 metadata 改变均拒绝，原意图不变", async () => {
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "run:after-intent") throw new Error("合成暂停");
    },
  });
  await assert.rejects(
    () =>
      store.withStoreLock("import", () =>
        store.commitRun(
          "manual",
          "fixed",
          { "a.txt": "合成 A" },
          { version: 1 },
        ),
      ),
    /合成暂停/,
  );
  const before = await readFile(
    join(storeRoot, "runs/manual/fixed/intent.json"),
  );
  const resumed = await createPipelineStore(storeRoot);
  for (const [files, metadata] of [
    [{ "a.txt": "改变" }, { version: 1 }],
    [{ "b.txt": "合成 A" }, { version: 1 }],
    [{ "a.txt": "合成 A" }, { version: 2 }],
  ]) {
    await assert.rejects(
      () =>
        resumed.withStoreLock("import", () =>
          resumed.commitRun("manual", "fixed", files, metadata),
        ),
      isCode("IMMUTABLE_CONFLICT"),
    );
  }
  assert.deepEqual(
    await readFile(join(storeRoot, "runs/manual/fixed/intent.json")),
    before,
  );
  assert.equal((await resumed.readRun("manual", "fixed")).status, "failed");
});

test("完整归档内容被篡改后读为 corrupt，重跑不修补或覆盖历史", async () => {
  const { storeRoot, store } = await fixture();
  await store.withStoreLock("import", () =>
    store.commitRun("manual", "tampered", { "a.txt": "合成 A" }, {}),
  );
  await writeFile(
    join(storeRoot, "runs/manual/tampered/files/a.txt"),
    "合成篡改",
  );
  assert.equal((await store.readRun("manual", "tampered")).status, "corrupt");
  await assert.rejects(
    () =>
      store.withStoreLock("import", () =>
        store.commitRun("manual", "tampered", { "a.txt": "合成 A" }, {}),
      ),
    isCode("CORRUPT_RUN"),
  );
  assert.equal(
    (
      await readFile(join(storeRoot, "runs/manual/tampered/files/a.txt"))
    ).toString(),
    "合成篡改",
  );
});

test("完整归档多文件、缺文件、空目录或标志篡改均不返回 complete", async () => {
  for (const variant of ["extra", "missing", "directory", "marker"]) {
    const { storeRoot, store } = await fixture();
    await store.withStoreLock("import", () =>
      store.commitRun("manual", "check", { "a.txt": "合成 A" }, {}),
    );
    const base = join(storeRoot, "runs/manual/check");
    if (variant === "extra")
      await writeFile(join(base, "extra.txt"), "额外合成内容");
    if (variant === "missing") await unlink(join(base, "files/a.txt"));
    if (variant === "directory") await mkdir(join(base, "extra-directory"));
    if (variant === "marker")
      await writeFile(join(base, "complete.json"), "{}");
    assert.equal(
      (await store.readRun("manual", "check")).status,
      "corrupt",
      variant,
    );
    assert.equal(
      (await store.listRuns("manual"))[0].status,
      "corrupt",
      variant,
    );
  }
});

test("真实子进程中断保留 pending；显式死锁恢复后只能同输入接续", async () => {
  const { storeRoot, store } = await fixture();
  const moduleUrl = new URL("../src/pipelineStore.ts", import.meta.url).href;
  const result = await child(
    `import { createPipelineStore } from ${JSON.stringify(moduleUrl)};
    const store = await createPipelineStore(process.argv[1], { failpoint(point) { if (point.point === 'run:after-file' && point.relative === 'a.txt') process.exit(23); } });
    await store.withStoreLock('import', () => store.commitRun('manual', 'crashed', { 'a.txt': 'synthetic A', 'b.txt': 'synthetic B' }, { synthetic: true }));`,
    [storeRoot],
  );
  assert.equal(result.exitCode, 23, result.output);
  const pending = await store.readRun("manual", "crashed");
  assert.equal(pending.status, "pending");
  assert.equal(pending.failedAttempts.length, 0);
  const lockBytes = await store.readRegular(".locks/import.lock.json");
  assert.equal(JSON.parse(lockBytes).pid, result.pid);
  await store.recoverLock("import", sha256Bytes(lockBytes));
  const resumed = await store.withStoreLock("import", () =>
    store.commitRun(
      "manual",
      "crashed",
      { "a.txt": "synthetic A", "b.txt": "synthetic B" },
      { synthetic: true },
    ),
  );
  assert.equal(resumed.status, "complete");
  assert.equal(resumed.files["b.txt"].toString(), "synthetic B");
});

test("recoverLock 要求原 SHA、同主机及已退出 PID", async () => {
  const pid = await deadPid();
  const { storeRoot, store } = await fixture();
  const original = await installLock(storeRoot, lockRecord("import", pid));
  await assert.rejects(
    () => store.recoverLock("import", "0".repeat(64)),
    isCode("LOCK_DRIFT"),
  );
  assert.deepEqual(
    await readFile(join(storeRoot, ".locks/import.lock.json")),
    original,
  );
  const live = await installLock(storeRoot, lockRecord("import", process.pid));
  await assert.rejects(
    () => store.recoverLock("import", sha256Bytes(live)),
    isCode("PID_ALIVE"),
  );
  const otherHost = await installLock(
    storeRoot,
    lockRecord("import", pid, { host: "synthetic-other-host" }),
  );
  await assert.rejects(
    () => store.recoverLock("import", sha256Bytes(otherHost)),
    isCode("HOST_MISMATCH"),
  );
  const dead = await installLock(storeRoot, lockRecord("import", pid));
  const recovered = await store.recoverLock("import", sha256Bytes(dead));
  assert.equal(recovered.status, "recovered");
  const intent = JSON.parse(await store.readRegular(recovered.intentPath));
  const complete = JSON.parse(await store.readRegular(recovered.completePath));
  assert.equal(intent.originalPid, pid);
  assert.equal(complete.expectedSha256, sha256Bytes(dead));
  await assert.rejects(
    () => readFile(join(storeRoot, ".locks/import.lock.json")),
    isCode("ENOENT"),
  );
});

test("恢复临近删除时锁漂移：保留他人锁，仅留恢复意图而无成功标志", async () => {
  let root;
  const replacement = Buffer.from("合成新锁");
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "recovery:before-unlink")
        await writeFile(join(root, ".locks/import.lock.json"), replacement);
    },
  });
  root = storeRoot;
  const bytes = await installLock(
    storeRoot,
    lockRecord("import", await deadPid()),
  );
  await assert.rejects(
    () => store.recoverLock("import", sha256Bytes(bytes)),
    isCode("LOCK_DRIFT"),
  );
  assert.deepEqual(
    await readFile(join(root, ".locks/import.lock.json")),
    replacement,
  );
  const names = await readdir(join(root, ".lock-recoveries/import"));
  assert.equal(names.filter((name) => name.endsWith(".intent.json")).length, 1);
  assert.equal(
    names.filter((name) => name.endsWith(".complete.json")).length,
    0,
  );
});

test("atomicReplace expected null 首次写，指定 SHA 替换，错误原像拒绝", async () => {
  const { storeRoot, store } = await fixture();
  await store.withStoreLock("publish", async () => {
    const first = await store.atomicReplace(
      "data/events.json",
      "合成第一版",
      null,
    );
    const before = await lstat(join(storeRoot, "data/events.json"), {
      bigint: true,
    });
    await assert.rejects(
      () => store.atomicReplace("data/events.json", "不能写", null),
      isCode("PREIMAGE_DRIFT"),
    );
    await assert.rejects(
      () => store.atomicReplace("data/events.json", "不能写", "0".repeat(64)),
      isCode("PREIMAGE_DRIFT"),
    );
    const second = await store.atomicReplace(
      "data/events.json",
      "合成第二版",
      first.sha256,
    );
    assert.equal(second.sha256, sha256Bytes("合成第二版"));
    assert.equal(
      (await store.readRegular("data/events.json")).toString(),
      "合成第二版",
    );
    assert.notEqual(
      (await lstat(join(storeRoot, "data/events.json"), { bigint: true })).ino,
      before.ino,
    );
  });
});

test("atomicReplace 临近写前原像漂移时拒绝覆盖外部新值", async () => {
  let root;
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "replace:before-commit")
        await writeFile(join(root, "target.txt"), "合成外部新值");
    },
  });
  root = storeRoot;
  await writeFile(join(root, "target.txt"), "合成旧值");
  await store.withStoreLock("publish", async () => {
    await assert.rejects(
      () =>
        store.atomicReplace("target.txt", "不应写入", sha256Bytes("合成旧值")),
      isCode("PREIMAGE_DRIFT"),
    );
  });
  assert.equal(
    (await readFile(join(root, "target.txt"))).toString(),
    "合成外部新值",
  );
});

test("atomicReplace 首次写过程中出现目标，即使新字节相同也拒绝", async () => {
  let root;
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (point.point === "replace:before-commit")
        await writeFile(join(root, "target.txt"), "合成目标");
    },
  });
  root = storeRoot;
  await store.withStoreLock("publish", async () => {
    await assert.rejects(
      () => store.atomicReplace("target.txt", "合成目标", null),
      isCode("PREIMAGE_DRIFT"),
    );
  });
  assert.equal(
    (await readFile(join(root, "target.txt"))).toString(),
    "合成目标",
  );
});

test("运行路径穿越、冲突文件目录、非法 metadata 与数量限制失败关闭", async () => {
  const { store } = await fixture({ maxRunFiles: 2 });
  await store.withStoreLock("import", async () => {
    await assert.rejects(
      () => store.commitRun("manual", "bad", { "../outside": "合成" }, {}),
      isCode("UNSAFE_PATH"),
    );
    await assert.rejects(
      () => store.commitRun("manual", "bad", { a: "合成", "a/b": "合成" }, {}),
      isCode("INVALID_RUN_INTENT"),
    );
    await assert.rejects(
      () =>
        store.commitRun("manual", "bad", { a: "合成" }, { invalid: undefined }),
      isCode("INVALID_JSON"),
    );
    await assert.rejects(
      () => store.commitRun("manual", "bad", { a: "", b: "", c: "" }, {}),
      isCode("INVALID_RUN_FILES"),
    );
  });
  assert.equal((await store.readRun("manual", "bad")).status, "missing");
});

test("完成标志发布后暂存链接未解除的中断可由同原像收尾", async () => {
  const { storeRoot, store } = await fixture({
    failpoint: async (point) => {
      if (
        point.point === "immutable:after-link" &&
        point.relative.endsWith("/complete.json")
      )
        throw new Error("合成完成标志中断");
    },
  });
  await assert.rejects(
    () =>
      store.withStoreLock("import", () =>
        store.commitRun("manual", "marker-resume", { "a.txt": "合成" }, {}),
      ),
    /合成完成标志中断/,
  );
  assert.notEqual(
    (await store.readRun("manual", "marker-resume")).status,
    "complete",
  );
  const resumed = await createPipelineStore(storeRoot);
  const result = await resumed.withStoreLock("import", () =>
    resumed.commitRun("manual", "marker-resume", { "a.txt": "合成" }, {}),
  );
  assert.equal(result.status, "complete");
  assert.equal(
    (await lstat(join(storeRoot, "runs/manual/marker-resume/complete.json")))
      .nlink,
    1,
  );
  assert.equal(result.failedAttempts.length, 1);
});

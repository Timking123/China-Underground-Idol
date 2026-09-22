import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  acquireLocalEditorialLock,
  recoverLocalEditorialLock,
  localLockName,
} from "../maintenance/localEditorialLock.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const parent = path.join(root, "reports/city-upgrade-f/lock-tests");
await mkdir(parent, { recursive: true });
const hash = (raw) => createHash("sha256").update(raw).digest("hex");

test("真实进程退出遗留完整锁，显式恢复核验死PID与原哈希后允许重放", async () => {
  const workspace = await mkdtemp(path.join(parent, "crash-"));
  const script = `import {acquireLocalEditorialLock} from ${JSON.stringify(new URL("../maintenance/localEditorialLock.mjs", import.meta.url).href)}; await acquireLocalEditorialLock(process.argv[1]); process.exit(77);`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, workspace],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 77, child.stderr);
  const raw = await readFile(path.join(workspace, localLockName));
  assert.equal(JSON.parse(raw).pid, child.pid);
  await assert.rejects(acquireLocalEditorialLock(workspace), {
    code: "EEXIST",
  });
  await assert.rejects(
    recoverLocalEditorialLock(workspace, "a".repeat(64)),
    /哈希已变化/,
  );
  const recovered = await recoverLocalEditorialLock(workspace, hash(raw));
  assert.equal(recovered.recovered, true);
  const next = await acquireLocalEditorialLock(workspace);
  await next.release();
  assert.deepEqual(await readdir(workspace), []);
});

test("即使知道正确哈希也不能接管仍存活的维护锁", async () => {
  const workspace = await mkdtemp(path.join(parent, "active-"));
  const lock = await acquireLocalEditorialLock(workspace);
  try {
    await assert.rejects(
      recoverLocalEditorialLock(workspace, hash(lock.raw)),
      /仍存活/,
    );
    assert.deepEqual(await readFile(lock.target), lock.raw);
  } finally {
    await lock.release();
  }
});

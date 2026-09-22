import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const localLockName = ".local-editorial.lock";
const recoveryName = ".local-editorial-recovery.lock";
const digest = (raw) => createHash("sha256").update(raw).digest("hex");

async function ordinaryDirectory(directory) {
  let current = path.parse(directory).root;
  for (const part of directory
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("维护锁目录拒绝链接");
  }
}

async function installLock(workspace, name) {
  const value = {
    schemaVersion: "idol-local-lock-v1",
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const raw = Buffer.from(`${JSON.stringify(value)}\n`);
  const temporary = path.join(workspace, `.local-lock-${value.token}.tmp`);
  const target = path.join(workspace, name);
  await writeFile(temporary, raw, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary);
  }
  return {
    target,
    raw,
    async release() {
      const state = await lstat(target);
      if (
        !state.isFile() ||
        state.isSymbolicLink() ||
        !raw.equals(await readFile(target))
      )
        throw new Error("维护锁归属已变化，停止清理");
      await unlink(target);
    },
  };
}

export async function acquireLocalEditorialLock(directory) {
  const workspace = path.resolve(directory);
  await mkdir(workspace, { recursive: true });
  await ordinaryDirectory(workspace);
  try {
    await lstat(path.join(workspace, recoveryName));
    throw new Error("维护锁正在人工恢复");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // 完整记录先写临时文件，再以原子硬链接争用锁；不会留下空锁窗口。
  return installLock(workspace, localLockName);
}

/** 显式人工恢复：原锁哈希与已退出PID同时成立才移除，不修改任何候选。 */
export async function recoverLocalEditorialLock(directory, expectedSha256) {
  const workspace = path.resolve(directory);
  await ordinaryDirectory(workspace);
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256))
    throw new Error("恢复必须指定实际锁SHA256");
  const guard = await installLock(workspace, recoveryName);
  try {
    const target = path.join(workspace, localLockName);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("锁不是普通文件");
    const raw = await readFile(target);
    if (digest(raw) !== expectedSha256) throw new Error("锁哈希已变化");
    const owner = JSON.parse(raw);
    if (
      owner.schemaVersion !== "idol-local-lock-v1" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      typeof owner.token !== "string"
    )
      throw new Error("旧锁无可信进程身份，需人工排查");
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
      else throw error;
    }
    if (alive) throw new Error("维护锁进程仍存活，禁止接管");
    if (digest(await readFile(target)) !== expectedSha256)
      throw new Error("锁恢复期间发生变化");
    await unlink(target);
    return { recovered: true, pid: owner.pid, sha256: expectedSha256 };
  } finally {
    await guard.release();
  }
}

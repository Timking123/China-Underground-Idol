import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export type StoreJson =
  null | boolean | number | string | StoreJson[] | { [key: string]: StoreJson };
export interface StoreFailpoint {
  point:
    | "immutable:after-stage"
    | "immutable:after-link"
    | "run:after-intent"
    | "run:after-file"
    | "run:before-complete"
    | "replace:after-preimage"
    | "replace:before-commit"
    | "recovery:before-unlink";
  relative?: string;
  temporary?: string;
  kind?: string;
  runId?: string;
  scope?: string;
}
export interface PipelineStoreOptions {
  maxFileBytes?: number;
  maxRunFiles?: number;
  /** 仅用于离线合成中断测试；调用方不应将其当作业务重试机制。 */
  failpoint?: (context: StoreFailpoint) => void | Promise<void>;
}
export interface ImmutableWriteResult {
  sha256: string;
  reused: boolean;
}
export interface RunFileManifest {
  path: string;
  size: number;
  sha256: string;
}
export interface RunIntent {
  schemaVersion: "pipeline-run-intent-v1";
  kind: string;
  runId: string;
  files: RunFileManifest[];
  metadata: StoreJson;
}
export interface RunFailure {
  schemaVersion: "pipeline-run-failure-v1";
  kind: string;
  runId: string;
  intentSha256: string;
  attemptedAt: string;
  nonce: string;
  code: string;
  message: string;
}
export type RunInspection =
  | {
      status: "missing" | "pending" | "failed" | "corrupt";
      kind: string;
      runId: string;
      problems: string[];
      failedAttempts: RunFailure[];
    }
  | {
      status: "complete";
      kind: string;
      runId: string;
      intentSha256: string;
      metadata: StoreJson;
      files: Record<string, Buffer>;
      failedAttempts: RunFailure[];
    };
export type RunCommitResult = Extract<RunInspection, { status: "complete" }> & {
  reused: boolean;
};
export interface RecoveryEvidence {
  status: "recovered";
  scope: string;
  expectedSha256: string;
  intentPath: string;
  completePath: string;
}
export class PipelineStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineStoreError";
    this.code = code;
  }
}

interface FileRead {
  bytes: Buffer;
  stat: BigIntStats;
}
interface LockRecord {
  schemaVersion: "pipeline-store-lock-v1";
  scope: string;
  nonce: string;
  pid: number;
  host: string;
  createdAt: string;
}
interface LockLease {
  relative: string;
  record: LockRecord;
  sha256: string;
  stat: BigIntStats;
  closed: boolean;
}
type Authority = () => Promise<void>;
const RESERVED = new Set([
  ".locks",
  ".staging",
  ".lock-recoveries",
  ".run-failures",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function fail(code: string, message: string): never {
  throw new PipelineStoreError(code, message);
}
function errorCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error
    ? String(error.code)
    : "UNKNOWN";
}
function missing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
export function sha256Bytes(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function sameInode(a: BigIntStats, b: BigIntStats): boolean {
  // 本机 Windows 的 lstat.dev 返回 0，fstat.dev 返回卷号；零值不能伪装为身份漂移。
  // 路径仍被固定真实存储根约束，双方均有卷号时继续严格比较卷号。
  const comparableDevice =
    process.platform !== "win32" || (a.dev !== 0n && b.dev !== 0n);
  return a.ino === b.ino && (!comparableDevice || a.dev === b.dev);
}
function sameObservation(a: BigIntStats, b: BigIntStats): boolean {
  return (
    sameInode(a, b) &&
    a.size === b.size &&
    a.nlink === b.nlink &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
function segments(path: string): string[] {
  if (!path || isAbsolute(path) || path.includes("\\") || path.length > 2048)
    fail("UNSAFE_PATH", "路径须为受控相对路径，并统一使用正斜线");
  const parts = path.split("/");
  for (const part of parts) {
    // 同时拒绝 Windows ADS、设备名、尾点/空格和控制字符别名。
    // eslint-disable-next-line no-control-regex -- 文件路径安全边界须拒绝控制字符。
    const invalidCharacters = /[<>:"|?*\u0000-\u001f\u007f]/u;
    if (
      !part ||
      part === "." ||
      part === ".." ||
      invalidCharacters.test(part) ||
      /[. ]$/u.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
    )
      fail("UNSAFE_PATH", "路径含越界、设备名或不安全片段");
  }
  return parts;
}
function token(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(value) || value.endsWith("."))
    fail("INVALID_ID", `${label} 必须为受控小写标识`);
  segments(value);
}
function jsonBytes(value: unknown): Buffer {
  const visiting = new Set<object>();
  const stringify = (item: unknown, depth: number): string => {
    if (depth > 32) fail("INVALID_JSON", "元数据嵌套过深");
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item))
      return JSON.stringify(item);
    if (typeof item !== "object" || item === null)
      fail("INVALID_JSON", "元数据只能含有限 JSON 值");
    if (visiting.has(item)) fail("INVALID_JSON", "元数据不能包含循环引用");
    visiting.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length)
        fail("INVALID_JSON", "元数据数组不能稀疏或含附加属性");
      result = `[${Array.from(item)
        .map((child) => stringify(child, depth + 1))
        .join(",")}]`;
    } else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        fail("INVALID_JSON", "元数据只能使用普通 JSON 对象");
      const record = item as Record<string, unknown>;
      result = `{${Object.keys(record)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${stringify(record[key], depth + 1)}`,
        )
        .join(",")}}`;
    }
    visiting.delete(item);
    return result;
  };
  return Buffer.from(`${stringify(value, 0)}\n`, "utf8");
}
function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("INVALID_JSON", "归档不是有效 UTF-8 JSON");
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === keys.sort().join(",");
}
function timestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
async function checkAbsoluteDirectories(
  directory: string,
): Promise<BigIntStats> {
  const parsed = parse(directory);
  let cursor = parsed.root;
  let stat = await lstat(cursor, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory())
    fail("UNSAFE_ROOT", "存储根的祖先必须为真实目录");
  for (const part of relative(parsed.root, directory)
    .split(sep)
    .filter(Boolean)) {
    cursor = join(cursor, part);
    stat = await lstat(cursor, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail("UNSAFE_ROOT", "存储根或祖先含符号链接或非目录");
  }
  return stat;
}

/** 文件系统保护用于协作进程与已知漂移；不宣称可阻止任意 root 权限竞态。 */
export class PipelineStore {
  readonly storeRoot: string;
  readonly maxFileBytes: number;
  readonly maxRunFiles: number;
  private readonly rootStat: BigIntStats;
  private readonly failpoint?: PipelineStoreOptions["failpoint"];
  private readonly lockContext = new AsyncLocalStorage<LockLease>();

  private constructor(
    storeRoot: string,
    stat: BigIntStats,
    options: PipelineStoreOptions,
  ) {
    this.storeRoot = storeRoot;
    this.rootStat = stat;
    this.maxFileBytes = options.maxFileBytes ?? 16 * 1024 * 1024;
    this.maxRunFiles = options.maxRunFiles ?? 128;
    this.failpoint = options.failpoint;
    if (
      !Number.isSafeInteger(this.maxFileBytes) ||
      this.maxFileBytes < 1 ||
      this.maxFileBytes > 128 * 1024 * 1024
    )
      fail("INVALID_LIMIT", "单文件大小限制无效");
    if (
      !Number.isSafeInteger(this.maxRunFiles) ||
      this.maxRunFiles < 1 ||
      this.maxRunFiles > 10000
    )
      fail("INVALID_LIMIT", "运行文件数量限制无效");
  }
  static async create(
    storeRoot: string,
    options: PipelineStoreOptions = {},
  ): Promise<PipelineStore> {
    if (!isAbsolute(storeRoot))
      fail("UNSAFE_ROOT", "storeRoot 必须为明确的绝对路径");
    const root = resolve(storeRoot);
    if (root === parse(root).root)
      fail("UNSAFE_ROOT", "不能把盘符或文件系统根作为存储根");
    await checkAbsoluteDirectories(dirname(root));
    try {
      await mkdir(root, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const stat = await checkAbsoluteDirectories(root);
    const actual = await realpath(root);
    const normalized = (path: string): string =>
      process.platform === "win32" ? path.toLowerCase() : path;
    if (normalized(actual) !== normalized(root))
      fail("UNSAFE_ROOT", "存储根解析后指向不同目录");
    return new PipelineStore(root, stat, options);
  }
  private async checkedPath(
    path: string,
    createParents = false,
  ): Promise<string> {
    const parts = segments(path);
    const root = await checkAbsoluteDirectories(this.storeRoot);
    if (!sameInode(root, this.rootStat))
      fail("ROOT_DRIFT", "存储根目录身份已经变化");
    let cursor = this.storeRoot;
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part);
      if (createParents) {
        try {
          await mkdir(cursor, { mode: 0o700 });
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
        }
      }
      const stat = await lstat(cursor, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory())
        fail("UNSAFE_PATH", "路径祖先必须为真实目录，禁止符号链接");
    }
    return join(this.storeRoot, ...parts);
  }
  private checkRegular(stat: BigIntStats, allowedLinks = 1n): void {
    if (stat.isSymbolicLink() || !stat.isFile())
      fail("NOT_REGULAR", "仅允许普通文件，禁止符号链接和特殊文件");
    if (stat.nlink !== allowedLinks)
      fail("HARD_LINK", "拒绝多硬链接或不明链接数文件");
    if (stat.size > BigInt(this.maxFileBytes))
      fail("FILE_TOO_LARGE", "文件超过允许大小");
  }
  private async readChecked(
    path: string,
    allowedLinks = 1n,
  ): Promise<FileRead> {
    const absolute = await this.checkedPath(path);
    const before = await lstat(absolute, { bigint: true });
    this.checkRegular(before, allowedLinks);
    const handle = await open(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat({ bigint: true });
      this.checkRegular(opened, allowedLinks);
      if (!sameObservation(before, opened))
        fail("FILE_DRIFT", "打开文件前后身份或内容属性变化");
      const chunks: Buffer[] = [];
      let length = 0;
      while (true) {
        const chunk = Buffer.alloc(
          Math.min(64 * 1024, this.maxFileBytes + 1 - length),
        );
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > this.maxFileBytes)
          fail("FILE_TOO_LARGE", "读取期间文件超过允许大小");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      const current = await lstat(await this.checkedPath(path), {
        bigint: true,
      });
      this.checkRegular(after, allowedLinks);
      this.checkRegular(current, allowedLinks);
      if (
        !sameObservation(opened, after) ||
        !sameObservation(after, current) ||
        BigInt(length) !== after.size
      )
        fail("FILE_DRIFT", "读取期间文件发生漂移");
      return { bytes: Buffer.concat(chunks, length), stat: after };
    } finally {
      await handle.close();
    }
  }
  async readRegular(path: string): Promise<Buffer> {
    return (await this.readChecked(path)).bytes;
  }
  private bytes(value: string | Uint8Array): Buffer {
    const bytes = Buffer.from(value);
    if (bytes.length > this.maxFileBytes)
      fail("FILE_TOO_LARGE", "写入内容超过允许大小");
    return bytes;
  }
  private publicPath(path: string, mutable = false): void {
    const first = segments(path)[0];
    if (RESERVED.has(first!) || (mutable && first === "runs"))
      fail("RESERVED_PATH", "该路径属于不可变归档或内部控制空间");
  }
  private async acquireLock(scope: string): Promise<LockLease> {
    token(scope, "锁范围");
    const path = `.locks/${scope}.lock.json`;
    const absolute = await this.checkedPath(path, true);
    const record: LockRecord = {
      schemaVersion: "pipeline-store-lock-v1",
      scope,
      nonce: randomUUID(),
      pid: process.pid,
      host: hostname(),
      createdAt: new Date().toISOString(),
    };
    const bytes = jsonBytes(record);
    let handle;
    try {
      handle = await open(absolute, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) === "EEXIST")
        fail("LOCKED", `锁 ${scope} 已存在；不会按年龄抢占`);
      throw error;
    }
    let stat: BigIntStats;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      stat = await handle.stat({ bigint: true });
      this.checkRegular(stat);
    } finally {
      await handle.close();
    }
    const lease: LockLease = {
      relative: path,
      record,
      sha256: sha256Bytes(bytes),
      stat,
      closed: false,
    };
    await this.assertOwned(lease);
    return lease;
  }
  private async assertOwned(lease: LockLease): Promise<void> {
    let current: FileRead;
    try {
      current = await this.readChecked(lease.relative);
    } catch {
      return fail("LOCK_DRIFT", "锁丢失、损坏或身份异常，拒绝继续写入/删除锁");
    }
    if (
      !sameInode(current.stat, lease.stat) ||
      sha256Bytes(current.bytes) !== lease.sha256
    )
      fail("LOCK_DRIFT", "锁已被替换或更改，拒绝删除他人锁");
  }
  private async authority(): Promise<void> {
    const lease = this.lockContext.getStore();
    if (!lease || lease.closed)
      fail(
        "LOCK_REQUIRED",
        "写入必须位于当前 store 的有效 withStoreLock 回调内",
      );
    await this.assertOwned(lease);
  }
  private async releaseLock(lease: LockLease): Promise<void> {
    lease.closed = true;
    await this.assertOwned(lease);
    await unlink(await this.checkedPath(lease.relative));
  }
  async withStoreLock<T>(
    scope: string,
    callback: () => Promise<T> | T,
  ): Promise<T> {
    if (this.lockContext.getStore())
      fail("LOCK_NESTED", "同一 store 实例不嵌套加锁");
    token(scope, "锁范围");
    try {
      await lstat(await this.checkedPath(`.locks/recovery-${scope}.lock.json`));
      fail("LOCK_RECOVERY_BUSY", "该范围正在显式恢复，拒绝开始业务");
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const lease = await this.acquireLock(scope);
    let result: T | undefined;
    let callbackError: unknown;
    let failed = false;
    try {
      result = await this.lockContext.run(lease, callback);
    } catch (error) {
      failed = true;
      callbackError = error;
    }
    try {
      await this.releaseLock(lease);
    } catch (error) {
      if (failed)
        throw new AggregateError(
          [callbackError, error],
          "业务失败且锁已漂移，原锁未被删除",
          { cause: error },
        );
      throw error;
    }
    if (failed) throw callbackError;
    return result as T;
  }
  private async stage(
    path: string,
    bytes: Buffer,
    authority: Authority,
  ): Promise<{ relative: string; stat: BigIntStats }> {
    await authority();
    const temporary = `.staging/${sha256Bytes(path)}/${sha256Bytes(bytes)}-${randomUUID()}.tmp`;
    const absolute = await this.checkedPath(temporary, true);
    await authority();
    const handle = await open(absolute, "wx", 0o600);
    let stat: BigIntStats;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      stat = await handle.stat({ bigint: true });
      this.checkRegular(stat);
    } finally {
      await handle.close();
    }
    const current = await this.readChecked(temporary);
    if (!sameInode(stat, current.stat) || !current.bytes.equals(bytes))
      fail("FILE_DRIFT", "暂存文件身份或内容漂移");
    return { relative: temporary, stat };
  }
  private async unlinkOwnedStage(
    path: string,
    stat: BigIntStats,
    bytes: Buffer,
    authority: Authority,
    links: bigint,
  ): Promise<void> {
    await authority();
    const current = await this.readChecked(path, links);
    if (!sameInode(current.stat, stat) || !current.bytes.equals(bytes))
      fail("FILE_DRIFT", "暂存文件身份变化，保留现场");
    await unlink(await this.checkedPath(path));
  }
  private async recoverStageLink(
    path: string,
    bytes: Buffer,
    authority: Authority,
  ): Promise<FileRead> {
    const target = await this.readChecked(path, 2n);
    if (!target.bytes.equals(bytes))
      fail("IMMUTABLE_CONFLICT", "已存在内容与本次原像不同，拒绝覆盖");
    const directory = `.staging/${sha256Bytes(path)}`;
    const directoryPath = dirname(await this.checkedPath(`${directory}/probe`));
    const candidates = (await readdir(directoryPath)).filter(
      (name) =>
        name.startsWith(`${sha256Bytes(bytes)}-`) &&
        name.endsWith(".tmp") &&
        UUID.test(name.slice(65, -4)),
    );
    const matches: { relative: string; stat: BigIntStats }[] = [];
    for (const name of candidates) {
      const current = await this.readChecked(`${directory}/${name}`, 2n).catch(
        (error: unknown) => {
          if (errorCode(error) === "HARD_LINK") return null;
          throw error;
        },
      );
      if (
        current &&
        sameInode(current.stat, target.stat) &&
        current.bytes.equals(bytes)
      )
        matches.push({ relative: `${directory}/${name}`, stat: current.stat });
    }
    if (matches.length !== 1)
      fail("HARD_LINK", "多硬链接并非可确认的本次暂存残留，拒绝处理");
    await this.unlinkOwnedStage(
      matches[0]!.relative,
      matches[0]!.stat,
      bytes,
      authority,
      2n,
    );
    return this.readChecked(path);
  }
  private async put(
    path: string,
    bytes: Buffer,
    authority: Authority,
    hooks = true,
  ): Promise<ImmutableWriteResult> {
    await authority();
    const digest = sha256Bytes(bytes);
    const existing = async (): Promise<FileRead | null> => {
      try {
        return await this.readChecked(path);
      } catch (error) {
        if (missing(error)) return null;
        if (errorCode(error) === "HARD_LINK")
          return this.recoverStageLink(path, bytes, authority);
        throw error;
      }
    };
    const previous = await existing();
    if (previous) {
      if (!previous.bytes.equals(bytes))
        fail("IMMUTABLE_CONFLICT", "已存在内容与本次原像不同，拒绝覆盖");
      return { sha256: digest, reused: true };
    }
    const staged = await this.stage(path, bytes, authority);
    if (hooks)
      await this.failpoint?.({
        point: "immutable:after-stage",
        relative: path,
        temporary: staged.relative,
      });
    const target = await this.checkedPath(path, true);
    const temp = await this.readChecked(staged.relative);
    if (!sameInode(temp.stat, staged.stat) || !temp.bytes.equals(bytes))
      fail("FILE_DRIFT", "发布前暂存原像漂移");
    await authority();
    try {
      await link(await this.checkedPath(staged.relative), target);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await this.unlinkOwnedStage(
        staged.relative,
        staged.stat,
        bytes,
        authority,
        1n,
      );
      const current = await existing();
      if (!current || !current.bytes.equals(bytes))
        fail("IMMUTABLE_CONFLICT", "发布时目标已存在且原像不符");
      return { sha256: digest, reused: true };
    }
    if (hooks)
      await this.failpoint?.({
        point: "immutable:after-link",
        relative: path,
        temporary: staged.relative,
      });
    const linked = await this.readChecked(path, 2n);
    if (!sameInode(linked.stat, staged.stat) || !linked.bytes.equals(bytes))
      fail("FILE_DRIFT", "已发布文件身份漂移，保留暂存现场");
    await this.unlinkOwnedStage(
      staged.relative,
      staged.stat,
      bytes,
      authority,
      2n,
    );
    const committed = await this.readChecked(path);
    if (
      !sameInode(committed.stat, staged.stat) ||
      !committed.bytes.equals(bytes)
    )
      fail("FILE_DRIFT", "完成写入时文件原像漂移");
    return { sha256: digest, reused: false };
  }
  async putImmutable(
    path: string,
    value: string | Uint8Array,
  ): Promise<ImmutableWriteResult> {
    this.publicPath(path);
    return this.put(path, this.bytes(value), () => this.authority());
  }
  async atomicReplace(
    path: string,
    value: string | Uint8Array,
    expectedSha256: string | null,
  ): Promise<{ sha256: string }> {
    this.publicPath(path, true);
    if (expectedSha256 !== null && !SHA256.test(expectedSha256))
      fail("INVALID_HASH", "原像 SHA-256 无效");
    const bytes = this.bytes(value);
    const checkPreimage = async (): Promise<FileRead | null> => {
      let current: FileRead | null;
      try {
        current = await this.readChecked(path);
      } catch (error) {
        if (!missing(error)) throw error;
        current = null;
      }
      if (
        expectedSha256 === null
          ? current !== null
          : current === null || sha256Bytes(current.bytes) !== expectedSha256
      )
        fail("PREIMAGE_DRIFT", "目标原像与 expected SHA 不符，拒绝覆盖");
      return current;
    };
    await this.authority();
    const before = await checkPreimage();
    await this.failpoint?.({ point: "replace:after-preimage", relative: path });
    const staged = await this.stage(path, bytes, () => this.authority());
    const destination = await this.checkedPath(path, true);
    await this.failpoint?.({
      point: "replace:before-commit",
      relative: path,
      temporary: staged.relative,
    });
    await this.authority();
    const current = await checkPreimage();
    if (before && current && !sameInode(before.stat, current.stat))
      fail("PREIMAGE_DRIFT", "目标 inode 已变化，拒绝覆盖");
    const temp = await this.readChecked(staged.relative);
    if (!sameInode(temp.stat, staged.stat) || !temp.bytes.equals(bytes))
      fail("FILE_DRIFT", "替换前暂存原像漂移");
    await this.authority();
    // 同一协作锁内临近提交再次复核；无法阻止任意特权进程在系统调用间竞态。
    await checkPreimage();
    if (expectedSha256 === null) {
      try {
        await link(await this.checkedPath(staged.relative), destination);
      } catch (error) {
        if (errorCode(error) === "EEXIST")
          fail("PREIMAGE_DRIFT", "首次写入目标已出现，拒绝覆盖");
        throw error;
      }
      await this.unlinkOwnedStage(
        staged.relative,
        staged.stat,
        bytes,
        () => this.authority(),
        2n,
      );
    } else {
      await rename(await this.checkedPath(staged.relative), destination);
    }
    const result = await this.readChecked(path);
    if (!sameInode(result.stat, staged.stat) || !result.bytes.equals(bytes))
      fail("FILE_DRIFT", "替换后的目标身份或内容漂移");
    return { sha256: sha256Bytes(bytes) };
  }

  private parseLock(bytes: Buffer, scope: string): LockRecord {
    const value = parseJson(bytes);
    if (
      !object(value) ||
      !exactKeys(value, [
        "schemaVersion",
        "scope",
        "nonce",
        "pid",
        "host",
        "createdAt",
      ]) ||
      value.schemaVersion !== "pipeline-store-lock-v1" ||
      value.scope !== scope ||
      typeof value.nonce !== "string" ||
      !UUID.test(value.nonce) ||
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) <= 0 ||
      typeof value.host !== "string" ||
      !timestamp(value.createdAt)
    )
      fail("LOCK_INVALID", "锁元数据无效，拒绝推断所有权或自动抢占");
    return value as unknown as LockRecord;
  }
  private pidDead(pid: number): void {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (errorCode(error) === "ESRCH") return;
      fail("PID_UNCERTAIN", "无法可靠核对原 PID 已退出，拒绝恢复");
    }
    fail("PID_ALIVE", "原 PID 仍存在，拒绝恢复");
  }
  async recoverLock(
    scope: string,
    expectedSha256: string,
  ): Promise<RecoveryEvidence> {
    token(scope, "锁范围");
    if (!SHA256.test(expectedSha256))
      fail("INVALID_HASH", "锁原像 SHA-256 无效");
    if (this.lockContext.getStore())
      fail("LOCK_NESTED", "锁恢复不能嵌套在业务锁回调内");
    const guard = await this.acquireLock(`recovery-${scope}`);
    const authority = (): Promise<void> => this.assertOwned(guard);
    try {
      const path = `.locks/${scope}.lock.json`;
      const original = await this.readChecked(path);
      if (sha256Bytes(original.bytes) !== expectedSha256)
        fail("LOCK_DRIFT", "锁 hash 与显式恢复原像不符");
      const record = this.parseLock(original.bytes, scope);
      if (record.host !== hostname())
        fail("HOST_MISMATCH", "锁来自其他主机，拒绝恢复");
      this.pidDead(record.pid);
      const recoveryId = randomUUID();
      const intentPath = `.lock-recoveries/${scope}/${recoveryId}.intent.json`;
      const completePath = `.lock-recoveries/${scope}/${recoveryId}.complete.json`;
      const intent = {
        schemaVersion: "pipeline-lock-recovery-intent-v1",
        scope,
        expectedSha256,
        originalPid: record.pid,
        originalHost: record.host,
        originalNonce: record.nonce,
        recoveryPid: process.pid,
        recoveryId,
        requestedAt: new Date().toISOString(),
      };
      const intentBytes = this.bytes(jsonBytes(intent));
      await this.put(intentPath, intentBytes, authority, false);
      await this.failpoint?.({
        point: "recovery:before-unlink",
        scope,
        relative: path,
      });
      await authority();
      const current = await this.readChecked(path);
      if (
        !sameInode(original.stat, current.stat) ||
        sha256Bytes(current.bytes) !== expectedSha256
      )
        fail("LOCK_DRIFT", "恢复临近删除时锁已漂移，保留他人锁");
      this.pidDead(record.pid);
      await unlink(await this.checkedPath(path));
      await this.put(
        completePath,
        this.bytes(
          jsonBytes({
            schemaVersion: "pipeline-lock-recovery-complete-v1",
            scope,
            expectedSha256,
            intentSha256: sha256Bytes(intentBytes),
            recoveredAt: new Date().toISOString(),
          }),
        ),
        authority,
        false,
      );
      return {
        status: "recovered",
        scope,
        expectedSha256,
        intentPath,
        completePath,
      };
    } finally {
      await this.releaseLock(guard);
    }
  }

  private runPath(kind: string, runId: string): string {
    token(kind, "运行种类");
    token(runId, "运行 ID");
    return `runs/${kind}/${runId}`;
  }
  private async inventory(
    base: string,
  ): Promise<Map<string, "file" | "directory">> {
    const result = new Map<string, "file" | "directory">();
    const walk = async (
      path: string,
      prefix: string,
      depth: number,
    ): Promise<void> => {
      if (depth > 32 || result.size > this.maxRunFiles * 33 + 4)
        fail("RUN_SET_MISMATCH", "运行目录结构超出控制范围");
      const directory = dirname(await this.checkedPath(`${path}/probe`));
      for (const name of (await readdir(directory)).sort()) {
        segments(name);
        const entry = prefix ? `${prefix}/${name}` : name;
        const stat = await lstat(await this.checkedPath(`${base}/${entry}`), {
          bigint: true,
        });
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
          fail("NOT_REGULAR", "归档目录包含链接或特殊文件");
        result.set(entry, stat.isDirectory() ? "directory" : "file");
        if (stat.isDirectory())
          await walk(`${base}/${entry}`, entry, depth + 1);
      }
    };
    await walk(base, "", 0);
    return result;
  }
  private expectedEntries(
    intent: RunIntent,
    complete: boolean,
  ): Map<string, "file" | "directory"> {
    const result = new Map<string, "file" | "directory">([
      ["intent.json", "file"],
    ]);
    if (complete) result.set("complete.json", "file");
    for (const file of intent.files) {
      const parts = ["files", ...segments(file.path)];
      for (let index = 1; index < parts.length; index += 1)
        result.set(parts.slice(0, index).join("/"), "directory");
      result.set(parts.join("/"), "file");
    }
    return result;
  }
  private checkEntries(
    actual: Map<string, "file" | "directory">,
    expected: Map<string, "file" | "directory">,
    requireAll: boolean,
  ): void {
    for (const [path, type] of actual)
      if (expected.get(path) !== type)
        fail("RUN_SET_MISMATCH", `归档出现未声明或类型不符条目：${path}`);
    if (
      requireAll &&
      (actual.size !== expected.size ||
        [...expected].some(([path, type]) => actual.get(path) !== type))
    )
      fail("RUN_SET_MISMATCH", "归档文件或目录集合与意图清单不一致");
  }
  private parseIntent(bytes: Buffer, kind: string, runId: string): RunIntent {
    const value = parseJson(bytes);
    if (
      !object(value) ||
      !exactKeys(value, [
        "schemaVersion",
        "kind",
        "runId",
        "files",
        "metadata",
      ]) ||
      value.schemaVersion !== "pipeline-run-intent-v1" ||
      value.kind !== kind ||
      value.runId !== runId ||
      !Array.isArray(value.files) ||
      value.files.length > this.maxRunFiles
    )
      fail("INVALID_RUN_INTENT", "运行意图格式或身份无效");
    const paths = new Set<string>();
    let previous = "";
    for (const file of value.files) {
      if (
        !object(file) ||
        !exactKeys(file, ["path", "size", "sha256"]) ||
        typeof file.path !== "string" ||
        !Number.isSafeInteger(file.size) ||
        Number(file.size) < 0 ||
        Number(file.size) > this.maxFileBytes ||
        typeof file.sha256 !== "string" ||
        !SHA256.test(file.sha256)
      )
        fail("INVALID_RUN_INTENT", "运行文件清单无效");
      if (
        segments(file.path).length > 24 ||
        paths.has(file.path) ||
        file.path < previous
      )
        fail("INVALID_RUN_INTENT", "文件清单重复、未排序或路径过深");
      paths.add(file.path);
      previous = file.path;
    }
    for (const path of paths)
      if (
        [...paths].some(
          (other) => other !== path && other.startsWith(`${path}/`),
        )
      )
        fail("INVALID_RUN_INTENT", "归档路径存在文件与目录冲突");
    if (!jsonBytes(value).equals(bytes))
      fail("INVALID_RUN_INTENT", "意图清单不符合固定序列化原像");
    return value as unknown as RunIntent;
  }
  private async failures(kind: string, runId: string): Promise<RunFailure[]> {
    const base = `.run-failures/${kind}/${runId}`;
    let names: string[];
    try {
      names = (
        await readdir(dirname(await this.checkedPath(`${base}/probe`)))
      ).sort();
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const results: RunFailure[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name))
        fail("INVALID_FAILURE_EVIDENCE", "失败记录出现未知文件");
      const bytes = await this.readRegular(`${base}/${name}`);
      if (sha256Bytes(bytes) !== name.slice(0, -5))
        fail("INVALID_FAILURE_EVIDENCE", "失败记录 hash 不符");
      const value = parseJson(bytes);
      if (
        !object(value) ||
        !exactKeys(value, [
          "schemaVersion",
          "kind",
          "runId",
          "intentSha256",
          "attemptedAt",
          "nonce",
          "code",
          "message",
        ]) ||
        value.schemaVersion !== "pipeline-run-failure-v1" ||
        value.kind !== kind ||
        value.runId !== runId ||
        typeof value.intentSha256 !== "string" ||
        !SHA256.test(value.intentSha256) ||
        !timestamp(value.attemptedAt) ||
        typeof value.nonce !== "string" ||
        !UUID.test(value.nonce) ||
        typeof value.code !== "string" ||
        typeof value.message !== "string"
      )
        fail("INVALID_FAILURE_EVIDENCE", "失败记录格式或身份不符");
      results.push(value as unknown as RunFailure);
    }
    return results;
  }
  private async recordFailure(
    kind: string,
    runId: string,
    intentSha256: string,
    error: unknown,
  ): Promise<void> {
    const failure: RunFailure = {
      schemaVersion: "pipeline-run-failure-v1",
      kind,
      runId,
      intentSha256,
      attemptedAt: new Date().toISOString(),
      nonce: randomUUID(),
      code: errorCode(error),
      message: (error instanceof Error ? error.message : "未知运行失败").slice(
        0,
        1200,
      ),
    };
    const bytes = this.bytes(jsonBytes(failure));
    await this.put(
      `.run-failures/${kind}/${runId}/${sha256Bytes(bytes)}.json`,
      bytes,
      () => this.authority(),
      false,
    );
  }
  async readRun(kind: string, runId: string): Promise<RunInspection> {
    const base = this.runPath(kind, runId);
    let failedAttempts: RunFailure[] = [];
    try {
      failedAttempts = await this.failures(kind, runId);
      let entries: Map<string, "file" | "directory">;
      try {
        entries = await this.inventory(base);
      } catch (error) {
        if (missing(error))
          return {
            status: failedAttempts.length ? "failed" : "missing",
            kind,
            runId,
            problems: [],
            failedAttempts,
          };
        throw error;
      }
      if (!entries.has("intent.json")) {
        if (entries.size)
          fail("INVALID_RUN_INTENT", "运行已有文件却缺少固定意图");
        return {
          status: failedAttempts.length ? "failed" : "pending",
          kind,
          runId,
          problems: ["已创建目录但尚无固定意图"],
          failedAttempts,
        };
      }
      const intentBytes = await this.readRegular(`${base}/intent.json`);
      const intent = this.parseIntent(intentBytes, kind, runId);
      const complete = entries.has("complete.json");
      this.checkEntries(
        entries,
        this.expectedEntries(intent, complete),
        complete,
      );
      const files: Record<string, Buffer> = Object.create(null) as Record<
        string,
        Buffer
      >;
      for (const file of intent.files) {
        if (!entries.has(`files/${file.path}`)) continue;
        const bytes = await this.readRegular(`${base}/files/${file.path}`);
        if (bytes.length !== file.size || sha256Bytes(bytes) !== file.sha256)
          fail("RUN_HASH_MISMATCH", `归档文件 hash 或大小不符：${file.path}`);
        files[file.path] = bytes;
      }
      if (!complete)
        return {
          status: failedAttempts.length ? "failed" : "pending",
          kind,
          runId,
          problems: ["完成标志尚未写入"],
          failedAttempts,
        };
      const marker = parseJson(await this.readRegular(`${base}/complete.json`));
      if (
        !object(marker) ||
        !exactKeys(marker, [
          "schemaVersion",
          "kind",
          "runId",
          "intentSha256",
          "completedAt",
        ]) ||
        marker.schemaVersion !== "pipeline-run-complete-v1" ||
        marker.kind !== kind ||
        marker.runId !== runId ||
        marker.intentSha256 !== sha256Bytes(intentBytes) ||
        !timestamp(marker.completedAt)
      )
        fail("INVALID_COMPLETE_MARKER", "完成标志与固定意图不符");
      // 返回前再次核对集合，避免把检查期间出现的多余文件静默视为完整。
      this.checkEntries(
        await this.inventory(base),
        this.expectedEntries(intent, true),
        true,
      );
      return {
        status: "complete",
        kind,
        runId,
        intentSha256: sha256Bytes(intentBytes),
        metadata: intent.metadata,
        files,
        failedAttempts,
      };
    } catch (error) {
      return {
        status: "corrupt",
        kind,
        runId,
        problems: [
          `${errorCode(error)}: ${error instanceof Error ? error.message : "归档检查失败"}`,
        ],
        failedAttempts,
      };
    }
  }
  async listRuns(kind: string): Promise<RunInspection[]> {
    token(kind, "运行种类");
    let names: string[];
    try {
      names = (
        await readdir(dirname(await this.checkedPath(`runs/${kind}/probe`)))
      ).sort();
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const result: RunInspection[] = [];
    for (const runId of names) {
      try {
        token(runId, "运行 ID");
      } catch (error) {
        result.push({
          status: "corrupt",
          kind,
          runId,
          problems: [error instanceof Error ? error.message : "非法运行目录"],
          failedAttempts: [],
        });
        continue;
      }
      result.push(await this.readRun(kind, runId));
    }
    return result;
  }
  async commitRun(
    kind: string,
    runId: string,
    inputFiles: Record<string, string | Uint8Array>,
    metadata: StoreJson,
  ): Promise<RunCommitResult> {
    const base = this.runPath(kind, runId);
    await this.authority();
    if (
      !object(inputFiles) ||
      Object.keys(inputFiles).length > this.maxRunFiles
    )
      fail("INVALID_RUN_FILES", "运行文件集合无效或过大");
    const contents = new Map(
      Object.keys(inputFiles)
        .sort()
        .map((path) => [path, this.bytes(inputFiles[path]!)]),
    );
    const intent: RunIntent = {
      schemaVersion: "pipeline-run-intent-v1",
      kind,
      runId,
      files: [...contents].map(([path, bytes]) => ({
        path,
        size: bytes.length,
        sha256: sha256Bytes(bytes),
      })),
      metadata,
    };
    const intentBytes = this.bytes(jsonBytes(intent));
    this.parseIntent(intentBytes, kind, runId);
    const intentSha256 = sha256Bytes(intentBytes);
    try {
      await this.put(`${base}/intent.json`, intentBytes, () =>
        this.authority(),
      );
      const entries = await this.inventory(base);
      if (entries.has("complete.json")) {
        // 崩溃可能发生在完成标志 exclusive link 后、解除自有暂存链接前。
        // 只解除可核对的同 inode 暂存残留，不重写完成标志或任何历史文件。
        try {
          await this.readRegular(`${base}/complete.json`);
        } catch (error) {
          if (errorCode(error) !== "HARD_LINK") throw error;
          const stagedMarker = await this.readChecked(
            `${base}/complete.json`,
            2n,
          );
          await this.recoverStageLink(
            `${base}/complete.json`,
            stagedMarker.bytes,
            () => this.authority(),
          );
        }
        const previous = await this.readRun(kind, runId);
        if (previous.status !== "complete")
          fail("CORRUPT_RUN", "已存在完成标志的归档未通过核验，拒绝改写历史");
        return { ...previous, reused: true };
      }
      this.checkEntries(entries, this.expectedEntries(intent, false), false);
      await this.failpoint?.({ point: "run:after-intent", kind, runId });
      for (const [path, bytes] of contents) {
        await this.put(`${base}/files/${path}`, bytes, () => this.authority());
        await this.failpoint?.({
          point: "run:after-file",
          kind,
          runId,
          relative: path,
        });
      }
      await this.failpoint?.({ point: "run:before-complete", kind, runId });
      await this.authority();
      this.checkEntries(
        await this.inventory(base),
        this.expectedEntries(intent, false),
        true,
      );
      for (const file of intent.files) {
        const bytes = await this.readRegular(`${base}/files/${file.path}`);
        if (bytes.length !== file.size || sha256Bytes(bytes) !== file.sha256)
          fail("RUN_HASH_MISMATCH", "写完成标志前文件 hash 或大小不符");
      }
      const marker = this.bytes(
        jsonBytes({
          schemaVersion: "pipeline-run-complete-v1",
          kind,
          runId,
          intentSha256,
          completedAt: new Date().toISOString(),
        }),
      );
      await this.put(`${base}/complete.json`, marker, () => this.authority());
      const result = await this.readRun(kind, runId);
      if (result.status !== "complete")
        fail("CORRUPT_RUN", "完成标志写入后归档核验失败");
      return { ...result, reused: false };
    } catch (error) {
      // 只在仍持有原锁时追加失败凭证；无法安全记账时同时保留两个错误。
      try {
        await this.recordFailure(kind, runId, intentSha256, error);
      } catch (evidenceError) {
        throw new AggregateError(
          [error, evidenceError],
          "运行失败且无法安全追加失败凭证",
          { cause: evidenceError },
        );
      }
      throw error;
    }
  }
}

export async function createPipelineStore(
  storeRoot: string,
  options: PipelineStoreOptions = {},
): Promise<PipelineStore> {
  return PipelineStore.create(storeRoot, options);
}

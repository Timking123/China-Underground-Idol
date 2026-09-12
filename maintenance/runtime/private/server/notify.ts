import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rmdir } from "node:fs/promises";
import path from "node:path";

export interface Incident {
  runId: string;
  kind: string;
  code: string;
  source?: string;
  message: string;
  action?: string;
}

interface NotifyOptions {
  stateRoot: string;
  sendKey?: string;
  fetchImpl?: typeof fetch;
  now?: number | Date | (() => number | Date);
}

export interface NotifyResult {
  status: "sent" | "suppressed" | "blocked";
  code: string;
  attemptId?: string;
}

interface Attempt {
  version: 1;
  id: string;
  fingerprint: string;
  at: number;
  day: string;
}

const DAY_MS = 86_400_000;
const TIMEOUT_MS = 10_000;
const RESPONSE_LIMIT = 16_384;
const STATE_LIMIT = 4_096;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const FAILURE_CODES = new Set([
  "TIMEOUT",
  "FETCH_FAILED",
  "HTTP_ERROR",
  "SERVICE_REJECTED",
  "RESPONSE_MALFORMED",
  "RESPONSE_TOO_LARGE",
]);
const ACTIONS: Record<string, string> = {
  accounts_skipped:
    "个别账号本轮无法读取，已保留其旧资料，其余账号继续更新。账号清单与原因见服务器本轮回执。",
  inspect_logs: "请登录服务器核查维护记录，并按失败码处理。",
  configure_credentials: "请在服务器安全配置中核查所需凭据。",
  check_source: "请核查对应来源的可用性及访问配置。",
  review_changes: "请人工审核待处理变更后再继续维护。",
  manual_review: "自动维护无法完成，请登录服务器核查并人工处理。",
};
const ACTIVITY_REVIEW_ACTIONS: Record<string, string> = {
  AGGREGATION_POSSIBLE_DUPLICATE:
    "活动信息可能重复，相关条目暂缓收录，其他条目继续处理。请登录服务器核对本轮待复核记录。",
  AGGREGATION_IDENTITY_CONFLICT:
    "活动信息标识存在冲突，相关条目暂缓收录，其他条目继续处理。请登录服务器核对本轮待复核记录。",
};

class NotifyFailure extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function fail(code: string): never {
  throw new NotifyFailure(code);
}

function isMissing(error: unknown): boolean {
  return (error as { code?: string })?.code === "ENOENT";
}

function beijingDay(at: number): string {
  return new Date(at + 8 * 3_600_000).toISOString().slice(0, 10);
}

function validIncident(incident: Incident, key: string): boolean {
  if (!incident || typeof incident !== "object") return false;
  const identifiers = [incident.runId, incident.kind, incident.code];
  if (incident.source !== undefined) identifiers.push(incident.source);
  return (
    identifiers.every(
      (value) =>
        typeof value === "string" &&
        !value.includes(key) &&
        !/SCT[a-zA-Z0-9]+/.test(value),
    ) &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(incident.runId) &&
    /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(incident.kind) &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(incident.code) &&
    (incident.source === undefined ||
      /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u.test(incident.source)) &&
    typeof incident.message === "string"
  );
}

// 每个路径分量都必须是普通目录；不跟随符号链接或目录联接。
async function directoryChain(
  directory: string,
  create = false,
): Promise<void> {
  const root = path.parse(directory).root;
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 });
        await syncDirectory(path.dirname(current));
      } catch (error) {
        if ((error as { code?: string })?.code !== "EEXIST") throw error;
      }
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("UNSAFE_STATE_PATH");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Windows 不提供与 POSIX 等价的目录 fsync；生产运行环境为 Linux。
  if (process.platform === "win32") return;
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readRecord(
  file: string,
): Promise<Record<string, unknown> | null> {
  await directoryChain(path.dirname(file));
  let before;
  try {
    before = await lstat(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail("UNSAFE_STATE_PATH");
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      // Windows 的 lstat.dev 可能为 0；仍校验文件编号和链接数。
      (before.dev !== 0 && stat.dev !== before.dev) ||
      stat.ino !== before.ino ||
      stat.nlink !== 1 ||
      stat.size > STATE_LIMIT ||
      (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
    ) {
      fail("INVALID_STATE");
    }
    let record: unknown;
    try {
      record = JSON.parse(await handle.readFile("utf8"));
    } catch {
      fail("INVALID_STATE");
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail("INVALID_STATE");
    }
    return record as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

async function writeRecord(file: string, record: object): Promise<void> {
  await directoryChain(path.dirname(file));
  const handle = await open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function recordIdsAt(directory: string): Promise<string[]> {
  await directoryChain(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 10_000) fail("STATE_CAPACITY_REACHED");
  const ids: string[] = [];
  for (const entry of entries) {
    const id = entry.name.replace(/\.json$/, "");
    if (!entry.isFile() || entry.name !== `${id}.json` || !UUID.test(id)) {
      fail("INVALID_STATE");
    }
    ids.push(id);
  }
  return ids;
}

async function attemptsAt(directory: string): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  for (const id of await recordIdsAt(directory)) {
    const record = await readRecord(path.join(directory, `${id}.json`));
    if (
      !record ||
      record.version !== 1 ||
      record.id !== id ||
      typeof record.at !== "number" ||
      !Number.isSafeInteger(record.at) ||
      record.at < 0 ||
      record.at > 8_000_000_000_000_000 ||
      typeof record.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.fingerprint) ||
      record.day !== beijingDay(record.at)
    ) {
      fail("INVALID_STATE");
    }
    attempts.push(record as unknown as Attempt);
  }
  return attempts;
}

async function knownOutcome(
  directory: string,
  attempt: Attempt,
): Promise<boolean> {
  const receipt = await readRecord(
    path.join(directory, "receipts", `${attempt.id}.json`),
  );
  const failure = await readRecord(
    path.join(directory, "failures", `${attempt.id}.json`),
  );
  if (receipt && failure) fail("INVALID_STATE");
  const record = receipt ?? failure;
  if (!record) return false;
  if (
    record.version !== 1 ||
    record.id !== attempt.id ||
    record.at !== attempt.at ||
    (receipt && receipt.status !== "sent") ||
    (failure &&
      (failure.status !== "blocked" ||
        typeof failure.code !== "string" ||
        !FAILURE_CODES.has(failure.code) ||
        failure.outcome !==
          (["HTTP_ERROR", "SERVICE_REJECTED"].includes(failure.code)
            ? "rejected"
            : "unknown")))
  ) {
    fail("INVALID_STATE");
  }
  return Boolean(receipt || failure?.outcome === "rejected");
}

async function auditLedger(directory: string): Promise<{
  attempts: Attempt[];
  known: Set<string>;
}> {
  const attempts = await attemptsAt(path.join(directory, "attempts"));
  const ids = new Set(attempts.map((attempt) => attempt.id));
  const outcomes = new Set<string>();
  for (const kind of ["receipts", "failures"]) {
    for (const id of await recordIdsAt(path.join(directory, kind))) {
      // 孤立结果或同一尝试的双重结果都不能被当作没有发送历史。
      if (!ids.has(id) || outcomes.has(id)) fail("INVALID_STATE");
      outcomes.add(id);
    }
  }
  const known = new Set<string>();
  for (const attempt of attempts) {
    if (await knownOutcome(directory, attempt)) known.add(attempt.id);
  }
  return { attempts, known };
}

async function send(
  key: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NotifyFailure("TIMEOUT"));
    }, TIMEOUT_MS);
  });
  try {
    await Promise.race([
      timeout,
      (async () => {
        const response = await fetchImpl(
          `https://sctapi.ftqq.com/${key}.send`,
          {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body,
            signal: controller.signal,
          },
        );
        if (!response || !Number.isInteger(response.status)) {
          fail("RESPONSE_MALFORMED");
        }
        if (response.status < 200 || response.status >= 300) fail("HTTP_ERROR");
        const length = response.headers.get("content-length");
        if (
          length &&
          (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)
        ) {
          fail("RESPONSE_TOO_LARGE");
        }
        if (!response.body) fail("RESPONSE_MALFORMED");
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > RESPONSE_LIMIT) fail("RESPONSE_TOO_LARGE");
          chunks.push(chunk.value);
        }
        let result: unknown;
        try {
          result = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        } catch {
          fail("RESPONSE_MALFORMED");
        }
        if (
          !result ||
          typeof result !== "object" ||
          Array.isArray(result) ||
          typeof (result as { code?: unknown }).code !== "number"
        ) {
          fail("RESPONSE_MALFORMED");
        }
        if ((result as { code: number }).code !== 0) fail("SERVICE_REJECTED");
      })(),
    ]);
    return null;
  } catch (error) {
    if (controller.signal.aborted) return "TIMEOUT";
    return error instanceof NotifyFailure ? error.code : "FETCH_FAILED";
  } finally {
    clearTimeout(timer);
    controller.abort();
    // 不等待可能不响应取消的注入实现，也不输出原始网络异常。
    void reader?.cancel().catch(() => {});
  }
}

/** 仅由确需人工处理的事件调用；原始 message 与任意 action 文本不进入通知。 */
export async function notifyIncident(
  incident: Incident,
  options: NotifyOptions,
): Promise<NotifyResult> {
  const key = options.sendKey;
  if (!key) return { status: "blocked", code: "SEND_KEY_MISSING" };
  if (typeof key !== "string" || !/^SCT[a-zA-Z0-9]{1,253}$/.test(key)) {
    return { status: "blocked", code: "SEND_KEY_INVALID" };
  }
  if (!validIncident(incident, key)) {
    return { status: "blocked", code: "INVALID_INCIDENT" };
  }
  let lock: string | undefined;
  let lockIdentity: { dev: number; ino: number } | undefined;
  let result: NotifyResult;
  try {
    const rawNow =
      typeof options.now === "function" ? options.now() : options.now;
    const at =
      rawNow instanceof Date ? rawNow.getTime() : (rawNow ?? Date.now());
    if (!Number.isSafeInteger(at) || at < 0 || at > 8_000_000_000_000_000) {
      fail("INVALID_TIME");
    }
    const root = options.stateRoot;
    if (
      typeof root !== "string" ||
      !path.isAbsolute(root) ||
      root.split(/[\\/]/).includes("..") ||
      path.resolve(root) === path.parse(root).root
    ) {
      fail("UNSAFE_STATE_PATH");
    }
    await directoryChain(root, true);
    await chmod(root, 0o700);
    const directory = path.join(root, "server-notify");
    let created = false;
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
      await syncDirectory(root);
    } catch (error) {
      if ((error as { code?: string })?.code !== "EEXIST") throw error;
    }
    await directoryChain(directory);
    await chmod(directory, 0o700);
    const lockPath = path.join(directory, "lock");
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string })?.code === "EEXIST") fail("LOCKED");
      throw error;
    }
    lock = lockPath;
    const lockStat = await lstat(lockPath);
    if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) {
      fail("UNSAFE_STATE_PATH");
    }
    lockIdentity = { dev: lockStat.dev, ino: lockStat.ino };
    await syncDirectory(directory);
    for (const name of ["attempts", "receipts", "failures"]) {
      const target = path.join(directory, name);
      try {
        // 只有本次独占创建的通知根可初始化；已有根缺账本属于状态丢失。
        await directoryChain(target, created);
      } catch (error) {
        if (isMissing(error)) fail("INVALID_STATE");
        throw error;
      }
      await chmod(target, 0o700);
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([incident.kind, incident.code, incident.source ?? ""]),
      )
      .digest("hex");
    const { attempts, known } = await auditLedger(directory);
    let suppression: string | undefined;
    for (const attempt of attempts.filter(
      (item) => item.fingerprint === fingerprint,
    )) {
      if (!known.has(attempt.id)) {
        suppression = "UNKNOWN_OUTCOME";
        break;
      }
      if (at - attempt.at < DAY_MS) {
        suppression = "DUPLICATE";
      }
    }
    if (suppression) {
      result = { status: "suppressed", code: suppression };
    } else if (
      attempts.filter((attempt) => attempt.day === beijingDay(at)).length >= 4
    ) {
      result = { status: "suppressed", code: "DAILY_LIMIT" };
    } else {
      const id = randomUUID();
      const attempt: Attempt = {
        version: 1,
        id,
        fingerprint,
        at,
        day: beijingDay(at),
      };
      // 先刷盘 attempt 再接触网络；崩溃或未知响应均不会自动重发。
      await writeRecord(
        path.join(directory, "attempts", `${id}.json`),
        attempt,
      );
      const reviewAction = Object.hasOwn(ACTIVITY_REVIEW_ACTIONS, incident.code)
        ? ACTIVITY_REVIEW_ACTIONS[incident.code]
        : undefined;
      const action =
        reviewAction ??
        (Object.hasOwn(ACTIONS, incident.action ?? "")
          ? ACTIONS[incident.action!]
          : ACTIONS.manual_review);
      const body = new URLSearchParams({
        title: reviewAction ? "活动信息待核对" : "地下偶像站点维护需要人工处理",
        desp: [
          `运行 ID：${incident.runId}`,
          `来源名：${incident.source ?? "站点维护"}`,
          `${reviewAction ? "事项码" : "失败码"}：${incident.code}`,
          `处理建议：${action}`,
        ].join("\n\n"),
        noip: "1",
      });
      if (Buffer.byteLength(body.toString(), "utf8") > STATE_LIMIT) {
        fail("REQUEST_TOO_LARGE");
      }
      const code = await send(key, body, options.fetchImpl ?? fetch);
      if (code) {
        await writeRecord(path.join(directory, "failures", `${id}.json`), {
          version: 1,
          id,
          at,
          status: "blocked",
          code,
          outcome: ["HTTP_ERROR", "SERVICE_REJECTED"].includes(code)
            ? "rejected"
            : "unknown",
        });
        result = { status: "blocked", code, attemptId: id };
      } else {
        await writeRecord(path.join(directory, "receipts", `${id}.json`), {
          version: 1,
          id,
          at,
          status: "sent",
        });
        result = { status: "sent", code: "DELIVERED", attemptId: id };
      }
    }
  } catch (error) {
    result = {
      status: "blocked",
      code: error instanceof NotifyFailure ? error.code : "STATE_IO_FAILED",
    };
  } finally {
    if (lock && lockIdentity) {
      try {
        await directoryChain(lock);
        const stat = await lstat(lock);
        if (
          stat.dev !== lockIdentity.dev ||
          (lockIdentity.ino !== 0 && stat.ino !== lockIdentity.ino)
        ) {
          fail("UNSAFE_STATE_PATH");
        }
        await rmdir(lock);
      } catch {
        result = { status: "blocked", code: "LOCK_RELEASE_FAILED" };
      }
    }
  }
  return result;
}

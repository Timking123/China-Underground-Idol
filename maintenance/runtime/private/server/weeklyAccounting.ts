import { createHash } from "node:crypto";
import { lstat, mkdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { chromium, type BrowserContext } from "playwright";

const SOURCES = Object.freeze({
  account: "https://open.weibo.com/cli/api/auth/me",
  ledger: "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
  usage: "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
  page: "https://open.weibo.com/cli/logs",
});
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const DEADLINE_MS = 90_000;
const CLOCK_TOLERANCE_MS = 1_000;
const COMMAND_PATH = "users/show_batch/other";
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

export interface WeeklyAccountingBatch {
  uids: string[];
  startedAt: string;
  observedAt: string;
  maximumCredits?: number;
}

export interface WeeklyAccountingScope {
  expectedAccountScope: string;
  batches: WeeklyAccountingBatch[];
}

class AccountingFailure extends Error {}
class RetryableAccountingFailure extends AccountingFailure {}

function requireAccounting(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) throw new AccountingFailure(code);
}

function safeError(error: unknown): Error {
  return new AccountingFailure(
    error instanceof AccountingFailure
      ? error.message
      : "weekly_accounting_unavailable",
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function accountIdentity(value: unknown): string {
  requireAccounting(
    typeof value === "string" && /^[1-9]\d{0,19}$/u.test(value),
    "weekly_accounting_account_invalid",
  );
  return value;
}

function accountScope(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/** 与核账器同用百万分之一积分精度；字符串只校验，不转换后覆盖原始表示。 */
function creditMicros(value: unknown, text = false): number | null {
  if (!text)
    return typeof value === "number" && Number.isSafeInteger(value * 1_000_000)
      ? value * 1_000_000
      : null;
  if (
    typeof value !== "string" ||
    !/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/u.test(value)
  )
    return null;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return micros <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(micros) * (value.startsWith("-") ? -1 : 1)
    : null;
}

function validateScope(scope: WeeklyAccountingScope): void {
  requireAccounting(
    object(scope) &&
      typeof scope.expectedAccountScope === "string" &&
      /^[a-f0-9]{16}$/u.test(scope.expectedAccountScope) &&
      Array.isArray(scope.batches) &&
      scope.batches.length >= 1 &&
      scope.batches.length <= 8,
    "weekly_accounting_scope_invalid",
  );
  const seen = new Set<string>();
  let previousEnd = -Infinity;
  for (const batch of scope.batches) {
    requireAccounting(
      object(batch) &&
        Array.isArray(batch.uids) &&
        batch.uids.length >= 1 &&
        batch.uids.length <= 50 &&
        batch.uids.every(
          (uid: unknown) => typeof uid === "string" && /^\d{4,20}$/u.test(uid),
        ) &&
        new Set(batch.uids).size === batch.uids.length &&
        batch.uids.every((uid: string) => !seen.has(uid)) &&
        timestamp(batch.startedAt) &&
        timestamp(batch.observedAt) &&
        (batch.maximumCredits === undefined ||
          (creditMicros(batch.maximumCredits) !== null &&
            batch.maximumCredits >= 0)) &&
        Date.parse(batch.startedAt) <= Date.parse(batch.observedAt) &&
        Date.parse(batch.startedAt) >= previousEnd,
      "weekly_accounting_scope_invalid",
    );
    batch.uids.forEach((uid) => seen.add(uid));
    previousEnd = Date.parse(batch.observedAt);
  }
}

function rows(
  response: unknown,
  kind: "ledger" | "usage",
  identity: string,
): Record<string, unknown>[] {
  requireAccounting(
    object(response) &&
      !response.error &&
      !response.error_code &&
      response.success !== false &&
      response.ok !== false &&
      response.limit === 20 &&
      (kind !== "ledger" || response.page === 1),
    "weekly_accounting_response_invalid",
  );
  const values = response[kind === "ledger" ? "records" : "logs"];
  requireAccounting(
    Array.isArray(values) && values.length <= 20 && values.every(object),
    "weekly_accounting_response_invalid",
  );
  const ids = new Set<string>();
  for (const row of values) {
    requireAccounting(
      accountIdentity(row[kind === "ledger" ? "user_id" : "userId"]) ===
        identity,
      "weekly_accounting_account_mismatch",
    );
    requireAccounting(
      typeof row.id === "string" && /^\d+$/u.test(row.id),
      "weekly_accounting_response_invalid",
    );
    requireAccounting(!ids.has(row.id), "weekly_accounting_duplicate_row");
    ids.add(row.id);
  }
  return values;
}

/** 原始响应仅做白名单投影；纯函数便于离线验证，不接受预先声明的 accountMatched。 */
export function projectWeeklyAccounting(
  options: WeeklyAccountingScope & {
    projectionAt: string;
    account: unknown;
    ledger: unknown;
    usage: unknown;
  },
): Buffer {
  try {
    validateScope(options);
    requireAccounting(
      timestamp(options.projectionAt) &&
        options.batches.every(
          (batch) =>
            Date.parse(batch.observedAt) <= Date.parse(options.projectionAt),
        ),
      "weekly_accounting_projection_time_invalid",
    );
    requireAccounting(
      object(options.account) &&
        !options.account.error &&
        !options.account.error_code &&
        options.account.success !== false &&
        options.account.ok !== false,
      "weekly_accounting_account_invalid",
    );
    // auth/me.id 是平台账户 ID，不能拿 weibo_uid 或调用方布尔值替代。
    const identity = accountIdentity(options.account.id);
    const scope = accountScope(identity);
    requireAccounting(
      scope === options.expectedAccountScope,
      "weekly_accounting_account_mismatch",
    );
    const ledgerRows = rows(options.ledger, "ledger", identity);
    const usageRows = rows(options.usage, "usage", identity);
    const ledger = [],
      usage = [];
    const usedUsage = new Set<string>(),
      usedLedger = new Set<string>();
    const usedSources = new Set<string>();
    for (const batch of options.batches) {
      const start = Date.parse(batch.startedAt),
        end = Date.parse(batch.observedAt);
      const matched = usageRows.filter((row) => {
        if (
          !object(row.requestParams) ||
          row.requestParams.uids !== batch.uids.join(",") ||
          row.commandPath !== COMMAND_PATH ||
          !timestamp(row.createdAt)
        )
          return false;
        const created = Date.parse(row.createdAt);
        // 官方记录可能按整秒记时，并有小幅钟差；容差硬封顶为一秒。
        return (
          created >= start - CLOCK_TOLERANCE_MS &&
          created <= end + CLOCK_TOLERANCE_MS &&
          created <= Date.parse(options.projectionAt)
        );
      });
      requireAccounting(
        matched.length === 1,
        "weekly_accounting_usage_nonunique",
      );
      const row = matched[0];
      const charged = creditMicros(row.creditsDeducted);
      const maximum =
        batch.maximumCredits === undefined
          ? undefined
          : creditMicros(batch.maximumCredits);
      requireAccounting(
        row.method === "GET" &&
          row.statusCode === 200 &&
          typeof row.recordCount === "number" &&
          Number.isInteger(row.recordCount) &&
          row.recordCount >= 0 &&
          row.recordCount <= batch.uids.length &&
          row.billingType === 1 &&
          typeof row.creditsDeducted === "number" &&
          charged !== null &&
          charged >= 0 &&
          (maximum === undefined || (maximum !== null && charged <= maximum)),
        "weekly_accounting_usage_invalid",
      );
      // 部分账号缺失时保留实际计数及扣费，返回资料与计费契约交由 reconciliation 校验。
      const credits = row.creditsDeducted;
      requireAccounting(
        credits > 0 || row.recordCount === 0,
        "weekly_accounting_usage_invalid",
      );
      const matches = ledgerRows.filter(
        (entry) => entry.created_at === row.createdAt,
      );
      requireAccounting(
        matches.length === 1 || (credits === 0 && matches.length === 0),
        "weekly_accounting_ledger_nonunique",
      );
      const entry = matches[0];
      requireAccounting(
        !usedUsage.has(String(row.id)),
        "weekly_accounting_row_reused",
      );
      usedUsage.add(String(row.id));
      usage.push({
        id: row.id,
        createdAt: row.createdAt,
        method: row.method,
        commandPath: row.commandPath,
        status: row.statusCode,
        recordCount: row.recordCount,
        billingType: row.billingType,
        creditsDeducted: row.creditsDeducted,
        requestParams: { uids: batch.uids.join(",") },
        accountMatched:
          row.userId === identity && scope === options.expectedAccountScope,
      });
      // 官方零条零扣费可能没有账本项，只记录实际 usage，不构造零金额 ledger。
      if (!entry) continue;
      const balance = creditMicros(entry.balance_after, true);
      const description =
        typeof entry.description === "string"
          ? /^\[users\/show_batch\/other\] per_record: (?:[0-9]|[1-4][0-9]|50) records × ((?:0|[1-9]\d{0,9})(?:\.\d{1,6})?) pts$/u.exec(
              entry.description,
            )
          : null;
      const unit = description ? creditMicros(description[1], true) : null;
      requireAccounting(
        typeof entry.source_id === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
            entry.source_id,
          ) &&
          creditMicros(entry.delta, true) === -charged &&
          balance !== null &&
          balance >= 0 &&
          description &&
          unit !== null &&
          unit >= 0 &&
          entry.type === "api_deduct" &&
          entry.source_type === "api_call",
        "weekly_accounting_ledger_invalid",
      );
      requireAccounting(
        !usedLedger.has(String(entry.id)) && !usedSources.has(entry.source_id),
        "weekly_accounting_row_reused",
      );
      usedLedger.add(String(entry.id));
      usedSources.add(entry.source_id);
      ledger.push({
        id: entry.id,
        source_id: entry.source_id,
        createdAt: entry.created_at,
        delta: entry.delta,
        balanceAfter: entry.balance_after,
        description: entry.description,
        type: entry.type,
        sourceType: entry.source_type,
        accountMatched:
          entry.user_id === identity && scope === options.expectedAccountScope,
      });
    }
    return Buffer.from(
      `${JSON.stringify(
        {
          schemaVersion: "idol-official-accounting-observation-v1",
          projectionAt: options.projectionAt,
          accountScopeHash: scope,
          sourceKind: "official_browser_response_whitelist_projection",
          sources: {
            ledger: SOURCES.ledger,
            usage: SOURCES.usage,
            page: SOURCES.page,
          },
          ledger,
          usage,
          notes: [
            "仅投影当前正常登录会话的固定官方只读接口；未保存原始账户或凭据。",
            "usage 按完整 UID、账户、命令及最多一秒钟差匹配，ledger 按创建时间唯一关联并核对实际扣费；各批 guard 及余额链由核账器复核。",
            "source_id 与 usage id 不作为直接外键；page URL 为来源归属，本次没有导航页面或执行业务请求。",
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    throw safeError(error);
  }
}

function timeout(deadline: number, maximum: number): number {
  const remaining = deadline - Date.now();
  requireAccounting(remaining > 0, "weekly_accounting_timeout");
  return Math.min(remaining, maximum);
}

async function directories(directory: string, create = false): Promise<void> {
  requireAccounting(
    typeof directory === "string" &&
      path.isAbsolute(directory) &&
      !directory.split(/[\\/]/).includes("..") &&
      path.resolve(directory) !== path.parse(directory).root,
    "weekly_accounting_unsafe_path",
  );
  let current = path.parse(directory).root;
  for (const part of path.relative(current, directory).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as { code?: string })?.code !== "EEXIST") throw error;
      }
    }
    const stat = await lstat(current);
    requireAccounting(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "weekly_accounting_unsafe_path",
    );
  }
}

function transientNetworkError(error: unknown): boolean {
  if (!object(error)) return false;
  if (
    (typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code)) ||
    error.name === "TimeoutError"
  )
    return true;
  // Playwright 的网络错误有时仅在消息内携带系统错误码；只判定，不输出原文。
  return (
    typeof error.message === "string" &&
    (/\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH)\b/u.test(
      error.message,
    ) ||
      /\bsocket hang up\b/iu.test(error.message))
  );
}

async function requestJsonOnce(
  context: BrowserContext,
  kind: "account" | "ledger" | "usage",
  deadline: number,
): Promise<Record<string, unknown>> {
  const response = await context.request.get(SOURCES[kind], {
    timeout: timeout(deadline, 15_000),
    maxRedirects: 0,
    maxRetries: 0,
    failOnStatusCode: false,
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  try {
    const status = response.status();
    requireAccounting(
      status !== 401 && status !== 403 && !(status >= 300 && status < 400),
      "weekly_accounting_login_required",
    );
    requireAccounting(
      response.url() === SOURCES[kind],
      "weekly_accounting_source_http_failure",
    );
    if (status === 429 || (status >= 500 && status <= 599))
      throw new RetryableAccountingFailure(
        "weekly_accounting_source_http_failure",
      );
    requireAccounting(status === 200, "weekly_accounting_source_http_failure");
    const headers = response.headers();
    requireAccounting(
      /^application\/json(?:;|$)/i.test(headers["content-type"] ?? ""),
      "weekly_accounting_response_invalid",
    );
    const length = headers["content-length"];
    requireAccounting(
      !length || (/^\d+$/.test(length) && Number(length) <= RESPONSE_LIMIT),
      "weekly_accounting_response_too_large",
    );
    const bytes = await response.body();
    requireAccounting(
      bytes.length <= RESPONSE_LIMIT,
      "weekly_accounting_response_too_large",
    );
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AccountingFailure("weekly_accounting_response_invalid");
    }
    requireAccounting(
      object(value) &&
        !value.error &&
        !value.error_code &&
        value.success !== false &&
        value.ok !== false,
      "weekly_accounting_response_invalid",
    );
    return value;
  } finally {
    await response.dispose();
  }
}

async function requestJson(
  context: BrowserContext,
  kind: "account" | "ledger" | "usage",
  deadline: number,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const value = await requestJsonOnce(context, kind, deadline);
      timeout(deadline, 1);
      return value;
    } catch (error) {
      if (
        attempt === 2 ||
        !(
          error instanceof RetryableAccountingFailure ||
          transientNetworkError(error)
        )
      )
        throw error;
      const delay = (attempt + 1) * 1_000;
      // 有限退避仍共用本次采集的总时限，剩余不足时不等待或再发请求。
      requireAccounting(
        timeout(deadline, delay + 1) > delay,
        "weekly_accounting_timeout",
      );
      await wait(delay);
      timeout(deadline, 1);
    }
  }
  throw new AccountingFailure("weekly_accounting_unavailable");
}

/** 固定三个 GET、正常持久会话；不读取/复制浏览器凭据，不归档原始响应。 */
export async function collectWeeklyAccounting(
  options: WeeklyAccountingScope & { stageRoot: string; profileRoot: string },
): Promise<Buffer> {
  let context: BrowserContext | undefined;
  let lock: string | undefined;
  let lockIdentity: { dev: number; ino: number } | undefined;
  let result: Buffer | undefined;
  let failure: Error | undefined;
  try {
    validateScope(options);
    await directories(options.stageRoot);
    try {
      await directories(options.profileRoot);
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT")
        throw new AccountingFailure("weekly_accounting_login_required");
      throw error;
    }
    const root = path.join(options.stageRoot, "private", "official-accounting");
    await directories(root, true);
    const lockPath = path.join(root, ".collect.lock");
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string })?.code === "EEXIST")
        throw new AccountingFailure("weekly_accounting_locked");
      throw error;
    }
    lock = lockPath;
    const stat = await lstat(lock);
    requireAccounting(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "weekly_accounting_unsafe_path",
    );
    lockIdentity = { dev: stat.dev, ino: stat.ino };
    const deadline = Date.now() + DEADLINE_MS;
    context = await chromium.launchPersistentContext(options.profileRoot, {
      headless: true,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      serviceWorkers: "block",
      acceptDownloads: false,
      timeout: timeout(deadline, 20_000),
    });
    // 本次不导航页面。APIRequestContext 独立于页面路由，只执行下方三个固定 GET。
    await context.route("**/*", async (route) => {
      await route.abort();
    });
    const account = await requestJson(context, "account", deadline);
    requireAccounting(
      accountScope(accountIdentity(account.id)) ===
        options.expectedAccountScope,
      "weekly_accounting_account_mismatch",
    );
    const ledger = await requestJson(context, "ledger", deadline);
    const usage = await requestJson(context, "usage", deadline);
    timeout(deadline, 1);
    result = projectWeeklyAccounting({
      ...options,
      account,
      ledger,
      usage,
      projectionAt: new Date().toISOString(),
    });
  } catch (error) {
    failure = safeError(error);
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        failure ??= new Error("weekly_accounting_browser_close_failed");
      }
    }
    if (lock && lockIdentity) {
      try {
        await directories(lock);
        const stat = await lstat(lock);
        requireAccounting(
          stat.dev === lockIdentity.dev && stat.ino === lockIdentity.ino,
          "weekly_accounting_unsafe_path",
        );
        await rmdir(lock);
      } catch {
        failure ??= new Error("weekly_accounting_lock_release_failed");
      }
    }
  }
  if (failure) throw failure;
  requireAccounting(result, "weekly_accounting_unavailable");
  return result;
}

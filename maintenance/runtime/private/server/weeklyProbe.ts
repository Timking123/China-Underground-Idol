import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { WeeklyProviderPrice } from "../src/weeklyContract.ts";

const ORIGIN = "https://open.weibo.com";
const SOURCES = Object.freeze({
  plan: `${ORIGIN}/cli/plan#services`,
  commands: `${ORIGIN}/cli/api/me/commands`,
  account: `${ORIGIN}/cli/api/auth/me`,
  subscription: `${ORIGIN}/cli/api/me/billing/subscription`,
});
const READ_ONLY_APIS = new Set([
  SOURCES.commands,
  SOURCES.account,
  SOURCES.subscription,
  `${ORIGIN}/cli/api/billing/products`,
  `${ORIGIN}/cli/api/billing/recharge-packages`,
]);
const TARGET_PATH = "users/show_batch/other";
const TARGET_TITLE = "批量获取其他用户的基本信息";
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const DEADLINE_MS = 90_000;

class PriceFailure extends Error {}

function requirePrice(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PriceFailure(code);
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function accountIdentity(account: Record<string, unknown>): string {
  const identity = account.idstr ?? account.id ?? account.uid;
  requirePrice(
    (typeof identity === "string" && /^\d{1,20}$/.test(identity)) ||
      (typeof identity === "number" &&
        Number.isSafeInteger(identity) &&
        identity > 0),
    "weekly_price_login_required",
  );
  return String(identity).trim();
}

function safeError(error: unknown): Error {
  return new Error(
    error instanceof PriceFailure ? error.message : "weekly_price_unavailable",
  );
}

function timeout(deadline: number, maximum: number): number {
  const remaining = deadline - Date.now();
  requirePrice(remaining > 0, "weekly_price_timeout");
  return Math.min(remaining, maximum);
}

async function syncDirectory(directory: string): Promise<void> {
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

async function directories(directory: string, create = false): Promise<void> {
  requirePrice(
    typeof directory === "string" &&
      path.isAbsolute(directory) &&
      !directory.split(/[\\/]/).includes("..") &&
      path.resolve(directory) !== path.parse(directory).root,
    "weekly_price_unsafe_path",
  );
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
    requirePrice(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "weekly_price_unsafe_path",
    );
  }
}

async function ordinaryFileOrMissing(file: string): Promise<void> {
  try {
    const stat = await lstat(file);
    requirePrice(
      stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      "weekly_price_unsafe_path",
    );
  } catch (error) {
    if ((error as { code?: string })?.code !== "ENOENT") throw error;
  }
}

async function writeNew(file: string, bytes: Buffer): Promise<void> {
  await directories(path.dirname(file));
  const handle = await open(
    file,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function requestJson(
  context: BrowserContext,
  kind: "account" | "commands" | "subscription",
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
    if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
      throw new PriceFailure("weekly_price_login_required");
    }
    requirePrice(
      status === 200 && response.url() === SOURCES[kind],
      "weekly_price_source_http_failure",
    );
    const headers = response.headers();
    requirePrice(
      /^application\/json(?:;|$)/i.test(headers["content-type"] ?? ""),
      kind === "account"
        ? "weekly_price_login_required"
        : "weekly_price_response_invalid",
    );
    const length = headers["content-length"];
    requirePrice(
      !length || (/^\d+$/.test(length) && Number(length) <= RESPONSE_LIMIT),
      "weekly_price_response_too_large",
    );
    const bytes = await response.body();
    requirePrice(
      bytes.length <= RESPONSE_LIMIT,
      "weekly_price_response_too_large",
    );
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new PriceFailure("weekly_price_response_invalid");
    }
    requirePrice(
      object(value) &&
        !value.error &&
        !value.error_code &&
        value.success !== false &&
        value.ok !== false,
      kind === "account"
        ? "weekly_price_login_required"
        : "weekly_price_response_invalid",
    );
    return value;
  } finally {
    // 原始账号、账单、CSRF 字段只驻留本次响应内存，不归档也不输出。
    await response.dispose();
  }
}

function projectObservation(
  account: Record<string, unknown>,
  commands: Record<string, unknown>,
  subscription: Record<string, unknown>,
  cells: string[],
  observedAt: string,
): WeeklyProviderPrice {
  // 网页 auth/me 返回当前账户对象；算法与 CLI user.idstr/id/uid 投影一致。
  const identity = accountIdentity(account);
  requirePrice(
    object(subscription.serviceStatus) &&
      subscription.serviceStatus.kind === "formal_active",
    "weekly_price_formal_service_required",
  );
  requirePrice(
    Array.isArray(commands.commands),
    "weekly_price_response_invalid",
  );
  const matches = commands.commands.filter(
    (entry: unknown) =>
      object(entry) &&
      (String(entry.id) === "318" ||
        entry.apiPath === TARGET_PATH ||
        entry.api_path === TARGET_PATH ||
        (entry.group === "users" && entry.action === "show_batch/other")),
  );
  requirePrice(matches.length === 1, "weekly_price_target_ambiguous");
  const target = matches[0] as Record<string, unknown>;
  const apiPath = target.apiPath ?? target.api_path;
  requirePrice(
    String(target.id) === "318" &&
      target.group === "users" &&
      target.action === "show_batch/other" &&
      apiPath === TARGET_PATH &&
      (target.apiPath === undefined || target.apiPath === TARGET_PATH) &&
      (target.api_path === undefined || target.api_path === TARGET_PATH) &&
      target.title === TARGET_TITLE &&
      target.description === TARGET_TITLE &&
      target.trialEnabled === true &&
      target.isMyself === false &&
      target.billingType === 1 &&
      target.pricePerUnit === 3 &&
      target.extraConfig === "",
    "weekly_price_billing_changed",
  );
  requirePrice(
    cells.length === 4 &&
      cells[0].toLowerCase() === "users" &&
      cells[1] === TARGET_PATH &&
      cells[2] === TARGET_TITLE &&
      cells[3] === "3C/条",
    "weekly_price_visible_price_mismatch",
  );
  return {
    schemaVersion: "idol-weekly-provider-price-v1",
    observedAt,
    accountScopeHash: createHash("sha256")
      .update(String(identity).trim())
      .digest("hex")
      .slice(0, 16),
    serviceKind: "formal_active",
    displayPrice: "3C/条",
    targetMatchCount: 1,
    // apiPath/api_path 为已观察到的同一路径的合约别名，其余仅投影实读字段。
    target: {
      id: String(target.id),
      group: target.group,
      action: target.action,
      apiPath,
      api_path: apiPath,
      title: target.title,
      description: target.description,
      trialEnabled: target.trialEnabled,
      isMyself: target.isMyself,
      billingType: target.billingType,
      pricePerUnit: target.pricePerUnit,
      extraConfig: target.extraConfig,
    },
    sources: Object.fromEntries(
      Object.entries(SOURCES).map(([key, url]) => [
        key,
        { url, status: 200 as const },
      ]),
    ),
  };
}

/** 使用服务器指定的正常持久会话，只读刷新价目；不读取浏览器存储或 CLI 凭据。 */
export async function refreshWeeklyPrice(options: {
  stageRoot: string;
  profileRoot: string;
}): Promise<{ observedAt: string; accountScopeHash: string; sha256: string }> {
  let context: BrowserContext | undefined;
  let lock: string | undefined;
  let lockIdentity: { dev: number; ino: number } | undefined;
  let temporary: string | undefined;
  let failure: Error | undefined;
  let result:
    | { observedAt: string; accountScopeHash: string; sha256: string }
    | undefined;
  try {
    await directories(options.stageRoot);
    try {
      await directories(options.profileRoot);
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") {
        throw new PriceFailure("weekly_price_login_required");
      }
      throw error;
    }
    const root = path.join(options.stageRoot, "private", "provider-price");
    await directories(root, true);
    await chmod(root, 0o700);
    const current = path.join(root, "current.json");
    await ordinaryFileOrMissing(current);
    const lockPath = path.join(root, ".refresh.lock");
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string })?.code === "EEXIST") {
        throw new PriceFailure("weekly_price_locked");
      }
      throw error;
    }
    lock = lockPath;
    const lockStat = await lstat(lockPath);
    requirePrice(
      lockStat.isDirectory() && !lockStat.isSymbolicLink(),
      "weekly_price_unsafe_path",
    );
    lockIdentity = { dev: lockStat.dev, ino: lockStat.ino };
    await syncDirectory(root);
    const deadline = Date.now() + DEADLINE_MS;
    context = await chromium.launchPersistentContext(options.profileRoot, {
      headless: true,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      serviceWorkers: "block",
      acceptDownloads: false,
      timeout: timeout(deadline, 20_000),
    });
    // 开启路由会禁用页面 HTTP 缓存；正常元数据 GET 之外的动作全部拒绝。
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const allowed =
        ["GET", "HEAD"].includes(request.method()) &&
        url.origin === ORIGIN &&
        (!url.pathname.startsWith("/cli/api/") || READ_ONLY_APIS.has(url.href));
      if (allowed) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    const plan = await page.goto(SOURCES.plan, {
      waitUntil: "domcontentloaded",
      timeout: timeout(deadline, 30_000),
    });
    requirePrice(
      page.url() === SOURCES.plan &&
        plan?.url() === SOURCES.plan.split("#")[0] &&
        !plan.request().redirectedFrom(),
      "weekly_price_login_required",
    );
    requirePrice(plan.status() === 200, "weekly_price_source_http_failure");
    // 使用同一正常浏览器会话的固定只读接口，绝不复制或自行拼装 Cookie/Bearer。
    const account = await requestJson(context, "account", deadline);
    accountIdentity(account);
    const commands = await requestJson(context, "commands", deadline);
    const subscription = await requestJson(context, "subscription", deadline);
    requirePrice(
      object(subscription.serviceStatus) &&
        subscription.serviceStatus.kind === "formal_active",
      "weekly_price_formal_service_required",
    );
    const heading = page.getByRole("heading", {
      name: "正式服务接口清单",
      exact: true,
    });
    await heading.waitFor({
      state: "visible",
      timeout: timeout(deadline, 10_000),
    });
    const rows = page.locator("table tbody tr").filter({
      has: page.getByRole("cell", { name: TARGET_PATH, exact: true }),
    });
    await rows
      .first()
      .waitFor({ state: "visible", timeout: timeout(deadline, 10_000) });
    requirePrice((await rows.count()) === 1, "weekly_price_target_ambiguous");
    const cells = (await rows.locator("td").allInnerTexts()).map((cell) =>
      cell.trim(),
    );
    timeout(deadline, 1);
    const observedAt = new Date().toISOString();
    const price = projectObservation(
      account,
      commands,
      subscription,
      cells,
      observedAt,
    );
    // 关闭成功后才发布新价目；失败时保留原 current，不能延长旧证据的新鲜期。
    try {
      await context.close();
    } catch {
      throw new PriceFailure("weekly_price_browser_close_failed");
    }
    context = undefined;
    const observations = path.join(root, "observations");
    await directories(observations, true);
    await chmod(observations, 0o700);
    const bytes = Buffer.from(`${JSON.stringify(price, null, 2)}\n`, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = randomUUID();
    await writeNew(path.join(observations, `${id}.json`), bytes);
    temporary = path.join(root, `.current-${id}.tmp`);
    await writeNew(temporary, bytes);
    await directories(root);
    await ordinaryFileOrMissing(current);
    await rename(temporary, current);
    temporary = undefined;
    await syncDirectory(root);
    result = { observedAt, accountScopeHash: price.accountScopeHash, sha256 };
  } catch (error) {
    failure = safeError(error);
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        failure ??= new Error("weekly_price_browser_close_failed");
      }
    }
    if (temporary) {
      try {
        await directories(path.dirname(temporary));
        await ordinaryFileOrMissing(temporary);
        await unlink(temporary);
      } catch {
        failure ??= new Error("weekly_price_write_failed");
      }
    }
    if (lock && lockIdentity) {
      try {
        await directories(lock);
        const stat = await lstat(lock);
        requirePrice(
          stat.dev === lockIdentity.dev && stat.ino === lockIdentity.ino,
          "weekly_price_unsafe_path",
        );
        await rmdir(lock);
      } catch {
        failure ??= new Error("weekly_price_lock_release_failed");
      }
    }
  }
  if (failure) throw failure;
  requirePrice(result, "weekly_price_unavailable");
  return result;
}

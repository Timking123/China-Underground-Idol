import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createApiResponseCache } from "./api_response_cache.mjs";
import {
  acquireControlledWriteLock,
  atomicWriteTextFile,
  readControlledFileBytes,
} from "./editorial_contract.mjs";
import { withCapabilityCacheRedactionTransaction } from "./redact_weibo_cli_capability_cache.mjs";
import { CLI_VERSION, cliRequest } from "./weibo_cli_contract.mjs";

export { CLI_VERSION, cliRequest } from "./weibo_cli_contract.mjs";

const execFileAsync = promisify(execFile);
const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(toolDirectory, "..");
const SNAPSHOT_DATE = "2026-09-03";
const cacheDirectory = path.join(
  rootDirectory,
  "sources",
  "api-cache",
  "weibo-cli",
);
const capabilityPath = path.join(
  rootDirectory,
  "sources",
  `微博官方接口状态_${SNAPSHOT_DATE}.json`,
);
const candidatePath = path.join(
  rootDirectory,
  "sources",
  `微博官方接口候选_${SNAPSHOT_DATE}.json`,
);
const failurePath = path.join(
  rootDirectory,
  "sources",
  `微博官方接口最近失败_${SNAPSHOT_DATE}.json`,
);
export const CAPABILITY_RECEIPT_DIRECTORY_RELATIVE_PATH =
  "sources/weibo-capabilities";
export const CAPABILITY_RECEIPT_PATH_PATTERN =
  /^sources\/weibo-capabilities\/([a-f0-9]{64})\.json$/u;
const BILLING_AUDIT_RELATIVE_PATH = "sources/微博CLI计费核验_2026-09-02.json";
const writeLockPath = "sources/.weibo-official-write.lock";
const toolId = "tools/collect_weibo_official.mjs";
const CLI_PRODUCT_URL = "https://open.weibo.com/cli";
const CLI_BILLING_URL = "https://open.weibo.com/cli/api/billing/products";
const MAX_CLI_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_SIZE = 50;
const TRIAL_PROFILE_CALL_CAP = 5;
const MAX_GROUPS = 2_000;
export const FORMAL_CREDIT_RESERVE = 4_000;
export const REPEATABLE_CLI_STATUSES = Object.freeze([400, 404, 409, 422]);
const CLI_ENVIRONMENT_ALLOWLIST = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PUBLIC",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TZ",
  "USERPROFILE",
  "WINDIR",
]);
const commandDetailWhitelist = new Set([
  "users\0show_batch/other",
  "statuses\0user_timeline_batch",
  "statuses\0user_timeline/other",
  "search\0statuses/limited",
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function validateCapabilityReceiptReference(reference) {
  const receiptPath = reference?.path;
  const receiptSha256 = reference?.sha256;
  const match =
    typeof receiptPath === "string"
      ? CAPABILITY_RECEIPT_PATH_PATTERN.exec(receiptPath)
      : null;
  assert(
    match &&
      typeof receiptSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(receiptSha256) &&
      match[1] === receiptSha256,
    "微博 capability 收据路径与 SHA-256 不一致",
  );
  return reference;
}

export function capabilityReceiptDescriptor(capability, expectedSha256 = null) {
  assert(
    capability && typeof capability === "object" && !Array.isArray(capability),
    "微博 capability 收据内容无效",
  );
  const content = stableJson(capability);
  assert(
    !containsCredentialMaterial(content),
    "微博 capability 不可变收据含疑似凭据，拒绝持久化",
  );
  const digest = sha256(content);
  if (expectedSha256 != null) {
    assert(
      typeof expectedSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(expectedSha256) &&
        expectedSha256 === digest,
      "微博 capability latest 字节与稳定序列化 SHA-256 不一致",
    );
  }
  const descriptor = {
    path: `${CAPABILITY_RECEIPT_DIRECTORY_RELATIVE_PATH}/${digest}.json`,
    sha256: digest,
    content,
  };
  validateCapabilityReceiptReference(descriptor);
  return descriptor;
}

async function ensureCapabilityReceiptDirectory(archiveRoot) {
  const resolvedRoot = path.resolve(archiveRoot);
  const sourcesDirectory = path.join(resolvedRoot, "sources");
  const receiptDirectory = path.join(
    resolvedRoot,
    ...CAPABILITY_RECEIPT_DIRECTORY_RELATIVE_PATH.split("/"),
  );
  const [rootStat, sourcesStat, realRoot, realSources] = await Promise.all([
    fs.lstat(resolvedRoot),
    fs.lstat(sourcesDirectory),
    fs.realpath(resolvedRoot),
    fs.realpath(sourcesDirectory),
  ]);
  assert(
    rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    "微博 capability 收据归档根目录必须是非链接真实目录",
  );
  assert(
    sourcesStat.isDirectory() && !sourcesStat.isSymbolicLink(),
    "微博 capability 收据 sources 必须是非链接真实目录",
  );
  assert.equal(
    path.relative(path.join(realRoot, "sources"), realSources),
    "",
    "微博 capability 收据 sources 解析到归档外",
  );
  try {
    await fs.mkdir(receiptDirectory, { recursive: false });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const [receiptStat, realReceiptDirectory] = await Promise.all([
    fs.lstat(receiptDirectory),
    fs.realpath(receiptDirectory),
  ]);
  assert(
    receiptStat.isDirectory() && !receiptStat.isSymbolicLink(),
    "微博 capability 收据目录必须是非链接真实目录",
  );
  assert.equal(
    path.relative(
      path.join(realSources, "weibo-capabilities"),
      realReceiptDirectory,
    ),
    "",
    "微博 capability 收据目录解析到允许范围外",
  );
  return receiptDirectory;
}

async function readCapabilityReceipt(archiveRoot, descriptor) {
  try {
    return await readControlledFileBytes(
      archiveRoot,
      descriptor.path,
      CAPABILITY_RECEIPT_PATH_PATTERN,
      "微博 capability 不可变收据",
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureCapabilityReceipt({
  rootDirectory: archiveRoot,
  capability,
  expectedSha256 = null,
  write = false,
}) {
  assert(
    capability?.schemaVersion === "weibo-official-capability-v1" &&
      capability.ready === true &&
      capability.blocker == null,
    "只有成功且 ready 的微博 capability 才能生成不可变收据",
  );
  assert(typeof write === "boolean", "微博 capability 收据写入开关无效");
  const descriptor = capabilityReceiptDescriptor(capability, expectedSha256);
  let bytes = await readCapabilityReceipt(archiveRoot, descriptor);
  if (bytes == null) {
    assert(write, "微博 capability 不可变收据不存在；只读检查不会创建收据");
    await ensureCapabilityReceiptDirectory(archiveRoot);
    await atomicWriteTextFile(
      archiveRoot,
      path.join(archiveRoot, ...descriptor.path.split("/")),
      descriptor.content,
      "微博 capability 不可变收据",
    );
    bytes = await readCapabilityReceipt(archiveRoot, descriptor);
    assert(bytes != null, "微博 capability 不可变收据写入后不可读");
    assert.equal(
      sha256(bytes),
      descriptor.sha256,
      "微博 capability 不可变收据写入后 SHA-256 不一致",
    );
    assert.equal(
      Buffer.compare(bytes, Buffer.from(descriptor.content, "utf8")),
      0,
      "微博 capability 不可变收据写入后字节不一致",
    );
    return { path: descriptor.path, sha256: descriptor.sha256, created: true };
  }
  assert.equal(
    sha256(bytes),
    descriptor.sha256,
    "微博 capability 不可变收据 SHA-256 不一致",
  );
  assert.equal(
    Buffer.compare(bytes, Buffer.from(descriptor.content, "utf8")),
    0,
    "微博 capability 不可变收据内容与 latest capability 不一致",
  );
  return { path: descriptor.path, sha256: descriptor.sha256, created: false };
}

export function parseArguments(argumentsList) {
  const options = {
    phase: "probe",
    mode: "cache-only",
    shouldWrite: false,
    limit: null,
    maxProfileBatches: null,
    includeInactive: true,
    verbose: false,
  };
  for (const argument of argumentsList) {
    if (argument === "--probe") options.phase = "probe";
    else if (argument === "--collect") options.phase = "collect";
    else if (argument === "--live") {
      if (options.mode === "refresh")
        throw new Error("--live 与 --refresh 不得同时使用");
      options.mode = "prefer-cache";
    } else if (argument === "--refresh") {
      if (options.mode === "prefer-cache")
        throw new Error("--live 与 --refresh 不得同时使用");
      options.mode = "refresh";
    } else if (argument === "--write") options.shouldWrite = true;
    else if (argument === "--active-only") options.includeInactive = false;
    else if (argument === "--verbose") options.verbose = true;
    else if (argument.startsWith("--limit=")) {
      const value = Number(argument.slice("--limit=".length));
      if (!Number.isSafeInteger(value) || value < 1 || value > MAX_GROUPS) {
        throw new Error(`--limit 必须是 1-${MAX_GROUPS} 的整数`);
      }
      options.limit = value;
    } else if (argument.startsWith("--max-profile-batches=")) {
      const rawValue = argument.slice("--max-profile-batches=".length);
      const value = Number(rawValue);
      if (
        !/^[1-9]\d*$/u.test(rawValue) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > TRIAL_PROFILE_CALL_CAP
      ) {
        throw new Error(
          `--max-profile-batches 必须是 1-${TRIAL_PROFILE_CALL_CAP} 的整数`,
        );
      }
      options.maxProfileBatches = value;
    } else throw new Error(`未知参数：${argument}`);
  }
  if (
    options.mode !== "cache-only" &&
    !options.shouldWrite
  ) {
    throw new Error(
      "联网探针或采集必须同时传入 --write，避免查询结果只进入缓存而缺少正式归档",
    );
  }
  if (
    options.shouldWrite &&
    (options.limit != null || !options.includeInactive)
  ) {
    throw new Error(
      "--write 只允许生成完整全团候选，体验期有界采集除外；--limit 与 --active-only 仅可用于只读诊断",
    );
  }
  if (
    options.maxProfileBatches != null &&
    (options.phase !== "collect" ||
      options.mode !== "prefer-cache" ||
      !options.shouldWrite)
  ) {
    throw new Error(
      "--max-profile-batches 仅允许与 --collect --live --write 同时使用",
    );
  }
  return options;
}

function stripAnsi(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .trim();
}

function containsCredentialMaterial(value) {
  const text = String(value ?? "");
  return (
    /(?:access|refresh)[_-]?token\s*["'=:\s]/iu.test(text) ||
    /authorization\s*[:=]\s*bearer/iu.test(text) ||
    /\bbearer\s+[a-z0-9._~-]{12,}/iu.test(text) ||
    /\bwb_[a-z0-9_-]{20,}\b/iu.test(text)
  );
}

function containsWbCredentialShape(value) {
  return /\bwb_[a-z0-9_-]{20,}\b/iu.test(String(value ?? ""));
}

function sameArguments(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((argument, index) => argument === expected[index])
  );
}

function parseInlineOptions(argumentsList, allowedNames) {
  const options = new Map();
  for (const argument of argumentsList) {
    const equalsIndex = argument.indexOf("=");
    if (!argument.startsWith("--") || equalsIndex < 3) return null;
    const name = argument.slice(2, equalsIndex);
    const value = argument.slice(equalsIndex + 1);
    if (
      !allowedNames.has(name) ||
      options.has(name) ||
      !value ||
      value.length > 8_000 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      return null;
    }
    options.set(name, value);
  }
  return options;
}

function integerInRange(value, minimum, maximum) {
  if (!/^\d{1,15}$/u.test(String(value ?? ""))) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

function optionalInteger(options, name, minimum, maximum) {
  return (
    !options.has(name) || integerInRange(options.get(name), minimum, maximum)
  );
}

function uidList(value, separator, maximum) {
  const values = String(value ?? "").split(separator);
  return (
    values.length > 0 &&
    values.length <= maximum &&
    values.every((uid) => /^\d{4,20}$/u.test(uid))
  );
}

function validProfileOptions(argumentsList) {
  const options = parseInlineOptions(
    argumentsList,
    new Set(["uids", "screen_name"]),
  );
  if (!options || options.size !== 1) return false;
  if (options.has("uids")) {
    return uidList(options.get("uids"), ",", MAX_BATCH_SIZE);
  }
  const names = options.get("screen_name").split(",");
  return (
    names.length > 0 &&
    names.length <= MAX_BATCH_SIZE &&
    names.every(
      (name) =>
        name === name.trim() &&
        name.length > 0 &&
        name.length <= 128 &&
        !/[=\u0000-\u001f\u007f]/u.test(name),
    )
  );
}

function validTimelineBatchOptions(argumentsList) {
  const options = parseInlineOptions(
    argumentsList,
    new Set(["flag", "page", "uids", "count", "feature", "base_app"]),
  );
  return Boolean(
    options &&
    options.has("uids") &&
    uidList(options.get("uids"), ",", 20) &&
    optionalInteger(options, "flag", 0, 2) &&
    optionalInteger(options, "page", 1, 10_000) &&
    optionalInteger(options, "count", 1, 100) &&
    optionalInteger(options, "feature", 0, 4) &&
    optionalInteger(options, "base_app", 0, 1),
  );
}

function validTimelineOptions(argumentsList) {
  const options = parseInlineOptions(
    argumentsList,
    new Set([
      "uid",
      "flag",
      "page",
      "count",
      "max_id",
      "feature",
      "base_app",
      "end_time",
      "since_id",
      "start_time",
    ]),
  );
  const decimalId = (name) =>
    !options?.has(name) || /^\d{1,20}$/u.test(options.get(name));
  return Boolean(
    options &&
    options.has("uid") &&
    /^\d{4,20}$/u.test(options.get("uid")) &&
    optionalInteger(options, "flag", 0, 2) &&
    optionalInteger(options, "page", 1, 10_000) &&
    optionalInteger(options, "count", 1, 100) &&
    decimalId("max_id") &&
    optionalInteger(options, "feature", 0, 4) &&
    optionalInteger(options, "base_app", 0, 1) &&
    decimalId("end_time") &&
    decimalId("since_id") &&
    decimalId("start_time"),
  );
}

function validSearchOptions(argumentsList) {
  const booleanNames = [
    "dup",
    "hasv",
    "hasat",
    "hasori",
    "haspic",
    "hasret",
    "haslink",
    "hastext",
    "antispam",
    "base_app",
    "hasmusic",
    "hasvideo",
    "is_batch",
  ];
  const options = parseInlineOptions(
    argumentsList,
    new Set([
      "q",
      ...booleanNames,
      "ids",
      "city",
      "page",
      "sort",
      "type",
      "count",
      "istag",
      "endtime",
      "starttime",
    ]),
  );
  if (!options || !options.has("q") || !options.has("type")) return false;
  const query = options.get("q");
  if (query.length > 256 || /[{}“”]/u.test(query)) return false;
  if (
    booleanNames.some((name) => !optionalInteger(options, name, 0, 1)) ||
    !optionalInteger(options, "city", 0, 999_999) ||
    !optionalInteger(options, "page", 1, 10_000) ||
    !optionalInteger(options, "type", 1, 3) ||
    !optionalInteger(options, "count", 10, 20) ||
    !optionalInteger(options, "istag", 0, 2)
  ) {
    return false;
  }
  if (
    options.has("sort") &&
    !new Set(["time", "hot", "fwnum", "cmtnum"]).has(options.get("sort"))
  ) {
    return false;
  }
  if (options.has("ids") && !uidList(options.get("ids"), "~", 50)) {
    return false;
  }
  return ["endtime", "starttime"].every(
    (name) => !options.has(name) || /^\d{1,15}$/u.test(options.get(name)),
  );
}

function allowedCliArguments(argumentsList) {
  if (
    !Array.isArray(argumentsList) ||
    argumentsList.length < 1 ||
    argumentsList.length > 40 ||
    argumentsList.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length > 8_000 ||
        argument === "--token" ||
        argument.startsWith("--token=") ||
        /(?:access|refresh)[_-]?token|cookie|authorization/iu.test(argument),
    ) ||
    argumentsList[0] === "auth"
  ) {
    return false;
  }
  if (
    sameArguments(argumentsList, ["doctor", "--output", "json"]) ||
    sameArguments(argumentsList, ["me", "--output", "json"]) ||
    sameArguments(argumentsList, [
      "commands",
      "list",
      "--all",
      "--output",
      "json",
    ])
  ) {
    return true;
  }
  if (
    argumentsList.length === 6 &&
    argumentsList[0] === "commands" &&
    argumentsList[1] === "show" &&
    commandDetailWhitelist.has(`${argumentsList[2]}\0${argumentsList[3]}`) &&
    argumentsList[4] === "--output" &&
    argumentsList[5] === "json"
  ) {
    return true;
  }
  if (
    argumentsList.length < 5 ||
    argumentsList.at(-2) !== "--output" ||
    argumentsList.at(-1) !== "json"
  ) {
    return false;
  }
  const command = `${argumentsList[0]}\0${argumentsList[1]}`;
  const options = argumentsList.slice(2, -2);
  if (command === "users\0show_batch/other") {
    return validProfileOptions(options);
  }
  if (command === "statuses\0user_timeline_batch") {
    return validTimelineBatchOptions(options);
  }
  if (command === "statuses\0user_timeline/other") {
    return validTimelineOptions(options);
  }
  if (command === "search\0statuses/limited") {
    return validSearchOptions(options);
  }
  return false;
}

export function classifyCliFailure(value) {
  const text = stripAnsi(value).slice(0, 16_000);
  if (/缺少登录令牌|auth login|not logged|unauthori[sz]ed/iu.test(text)) {
    return {
      status: 401,
      code: "login_required",
      message: "微博 CLI 未登录或登录已失效",
    };
  }
  if (/开发者认证|developer verification|verify developer/iu.test(text)) {
    return {
      status: 403,
      code: "developer_verification_required",
      message: "微博 CLI 开发者认证未完成",
    };
  }
  if (/开通服务|购买体验|购买.*服务|plan required|subscription/iu.test(text)) {
    return {
      status: 402,
      code: "service_required",
      message: "微博 CLI 服务未开通",
    };
  }
  if (/额度|余额不足|credit|quota|rate.?limit|频次|过于频繁|429/iu.test(text)) {
    return {
      status: 429,
      code: "quota_or_rate_limit",
      message: "微博 CLI 额度不足或请求频率受限",
    };
  }
  if (
    /"code"\s*:\s*"COUNT_EXCEEDS_MAX"/u.test(text) ||
    /unknown command|unknown flag|invalid argument|usage:/iu.test(text)
  ) {
    return {
      status: 400,
      code: "command_contract_error",
      message: "微博 CLI 命令或参数不符合固定契约",
    };
  }
  return {
    status: 502,
    code: "cli_execution_failed",
    message: "微博 CLI 执行失败",
  };
}

export function createCliEnvironment(sourceEnvironment = process.env) {
  const environment = Object.create(null);
  for (const [name, value] of Object.entries(sourceEnvironment ?? {})) {
    if (
      value != null &&
      CLI_ENVIRONMENT_ALLOWLIST.has(name.toLocaleUpperCase("en-US"))
    ) {
      environment[name] = String(value);
    }
  }
  return environment;
}

export async function resolveCliEntrypoint({
  appData = process.env.APPDATA,
} = {}) {
  const candidates = [
    appData
      ? path.join(
          appData,
          "npm",
          "node_modules",
          "@weibo-ai",
          "weibo-cli",
          "dist",
          "index.js",
        )
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      const [stat, realPath] = await Promise.all([
        fs.lstat(resolved),
        fs.realpath(resolved),
      ]);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const packageRoot = path.resolve(path.dirname(realPath), "..");
      const packageJsonPath = path.join(packageRoot, "package.json");
      const packageStat = await fs.lstat(packageJsonPath);
      if (!packageStat.isFile() || packageStat.isSymbolicLink()) continue;
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, "utf8"),
      );
      if (packageJson.name !== "@weibo-ai/weibo-cli") continue;
      if (packageJson.version !== CLI_VERSION) continue;
      if (
        path.relative(packageRoot, realPath).replaceAll("\\", "/") !==
        "dist/index.js"
      )
        continue;
      return {
        entrypoint: realPath,
        version: CLI_VERSION,
      };
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    }
  }
  throw new Error(
    `未找到受信任的 @weibo-ai/weibo-cli ${CLI_VERSION} 安装；请先按微博官方说明安装固定版本 CLI`,
  );
}

function jsonResponse(status, payload) {
  return new Response(stableJson(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bridgeErrorResponse(status, code, message, details = {}) {
  return jsonResponse(status, {
    schemaVersion: "weibo-cli-bridge-error-v1",
    code,
    message,
    ...details,
  });
}

function identityProjectionCommand(args) {
  return (
    sameArguments(args, ["doctor", "--output", "json"]) ||
    sameArguments(args, ["me", "--output", "json"])
  );
}

function cliPayloadSignalsFailure(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload.success === false ||
      payload.ok === false ||
      (payload.error != null && payload.error !== false)),
  );
}

export function createCliFetchImpl({ runner } = {}) {
  const execute =
    runner ??
    (async (args) => {
      const cli = await resolveCliEntrypoint();
      try {
        const result = await execFileAsync(
          process.execPath,
          [cli.entrypoint, ...args],
          {
            encoding: "utf8",
            windowsHide: true,
            timeout: 90_000,
            maxBuffer: MAX_CLI_OUTPUT_BYTES,
            env: createCliEnvironment(),
          },
        );
        return { ...result, exitCode: 0, cliVersion: cli.version };
      } catch (error) {
        return {
          stdout: error?.stdout ?? "",
          stderr: error?.stderr ?? error?.message ?? "",
          exitCode: Number.isInteger(error?.code) ? error.code : 1,
          cliVersion: cli.version,
        };
      }
    });

  return async (_url, init = {}) => {
    let request;
    try {
      request = JSON.parse(String(init.body ?? ""));
    } catch {
      return bridgeErrorResponse(
        400,
        "invalid_bridge_request",
        "CLI bridge 请求体不是 JSON",
      );
    }
    if (!allowedCliArguments(request?.args)) {
      return bridgeErrorResponse(
        400,
        "unsafe_bridge_request",
        "CLI 命令不在采集器白名单内或疑似包含凭据",
      );
    }
    let result;
    try {
      result = await execute(request.args);
    } catch {
      return bridgeErrorResponse(
        502,
        "cli_execution_failed",
        "微博 CLI 执行失败",
      );
    }
    const stdout = String(result?.stdout ?? "").trim();
    const stderr = String(result?.stderr ?? "").trim();
    const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
    if (
      containsWbCredentialShape(stdout) ||
      containsWbCredentialShape(stderr)
    ) {
      return bridgeErrorResponse(
        502,
        "sensitive_cli_output_refused",
        "CLI 输出疑似包含凭据，已拒绝保存正文",
        { exitCode, cliVersion: CLI_VERSION },
      );
    }
    if (result?.cliVersion !== CLI_VERSION) {
      return bridgeErrorResponse(
        502,
        "untrusted_cli_version",
        "微博 CLI 版本与采集器固定版本不一致",
        { exitCode, expectedVersion: CLI_VERSION },
      );
    }
    if (exitCode === 0) {
      let payload;
      try {
        payload = JSON.parse(stdout);
      } catch {
        if (
          containsCredentialMaterial(stdout) ||
          containsCredentialMaterial(stderr)
        ) {
          return bridgeErrorResponse(
            502,
            "sensitive_cli_output_refused",
            "CLI 输出疑似包含凭据，已拒绝保存正文",
            { exitCode, cliVersion: CLI_VERSION },
          );
        }
        return bridgeErrorResponse(
          502,
          "non_json_cli_output",
          "微博 CLI 成功退出但未返回有效 JSON",
          { exitCode, cliVersion: CLI_VERSION },
        );
      }
      if (cliPayloadSignalsFailure(payload)) {
        if (
          containsCredentialMaterial(stdout) ||
          containsCredentialMaterial(stderr)
        ) {
          return bridgeErrorResponse(
            502,
            "sensitive_cli_output_refused",
            "CLI 输出疑似包含凭据，已拒绝保存正文",
            { exitCode, cliVersion: CLI_VERSION },
          );
        }
        const failure = classifyCliFailure(`${stderr}\n${stdout}`);
        return bridgeErrorResponse(
          identityProjectionCommand(request.args) ? 502 : failure.status,
          failure.code,
          failure.message,
          { exitCode, cliVersion: CLI_VERSION },
        );
      }
      const projectedPayload = projectCliSuccessPayload(request.args, payload);
      const projectedText = stableJson(projectedPayload);
      if (
        containsCredentialMaterial(stderr) ||
        (!identityProjectionCommand(request.args) &&
          containsCredentialMaterial(stdout)) ||
        containsCredentialMaterial(projectedText)
      ) {
        return bridgeErrorResponse(
          502,
          "sensitive_cli_output_refused",
          "CLI 输出疑似包含凭据，已拒绝保存正文",
          { exitCode, cliVersion: CLI_VERSION },
        );
      }
      return new Response(projectedText, {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (
      containsCredentialMaterial(stdout) ||
      containsCredentialMaterial(stderr)
    ) {
      return bridgeErrorResponse(
        502,
        "sensitive_cli_output_refused",
        "CLI 输出疑似包含凭据，已拒绝保存正文",
        { exitCode, cliVersion: CLI_VERSION },
      );
    }
    const failure = classifyCliFailure(`${stderr}\n${stdout}`);
    return bridgeErrorResponse(
      identityProjectionCommand(request.args) ? 502 : failure.status,
      failure.code,
      failure.message,
      {
        exitCode,
        cliVersion: CLI_VERSION,
      },
    );
  };
}

async function cachedCliJson(cache, source, args, mode) {
  const request = cliRequest(source, args);
  const response = await cache.fetch(request, { mode });
  const payload = await response.json();
  return {
    request,
    response,
    payload,
    evidence: {
      cacheKey: response.key,
      recordId: response.recordId,
      responseSha256: response.sha256,
      observedAt: response.observedAt,
      cacheHit: response.cache.hit,
      command: args,
      status: response.status,
    },
  };
}

function serviceKind(payload) {
  return (
    payload?.service_status?.kind ??
    payload?.serviceStatus?.kind ??
    payload?.service?.kind ??
    null
  );
}

function recursiveObjects(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const output = [value];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    output.push(...recursiveObjects(child, seen));
  }
  return output;
}

function availableCommand(payload, group, action) {
  return recursiveObjects(payload).find(
    (value) =>
      !Array.isArray(value) &&
      value.group === group &&
      value.action === action &&
      value.access !== "locked",
  );
}

function numericCandidate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function projectedServiceStatus(payload) {
  const source =
    payload?.service_status ?? payload?.serviceStatus ?? payload?.service ?? {};
  const rawKind = serviceKind(payload);
  const kind =
    typeof rawKind === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(rawKind)
      ? rawKind
      : null;
  const balance = numericCandidate(source?.balance ?? payload?.user?.balance);
  const remainingCalls = numericCandidate(
    source?.remaining_calls ??
      source?.calls_remaining ??
      source?.remaining ??
      payload?.remaining_calls ??
      payload?.calls_remaining ??
      payload?.remaining ??
      payload?.user?.remaining_calls ??
      payload?.user?.calls_remaining ??
      payload?.user?.remaining,
  );
  return {
    kind,
    balance,
    ...(remainingCalls == null ? {} : { remaining_calls: remainingCalls }),
  };
}

export function projectCliSuccessPayload(args, payload) {
  if (!identityProjectionCommand(args)) return payload;
  const accountScopeHash = accountScopeFromRawIdentity(payload);
  if (args[0] === "doctor") {
    const steps = payload?.steps ?? {};
    return {
      schemaVersion: "weibo-cli-doctor-cache-v1",
      ready: payload?.ready === true,
      steps: {
        login: steps.login === true,
        developer_verification: steps.developer_verification === true,
        service: steps.service === true,
      },
      service_status: projectedServiceStatus(payload),
      accountScopeHash,
    };
  }
  return {
    schemaVersion: "weibo-cli-me-cache-v1",
    ready: payload?.ready === true,
    service_status: projectedServiceStatus(payload),
    accountScopeHash,
  };
}

export function summarizeDoctor(payload) {
  const steps = payload?.steps ?? {};
  return {
    ready: payload?.ready === true,
    checks: {
      login: steps.login === true,
      developerVerification: steps.developer_verification === true,
      service: steps.service === true,
    },
    service: {
      kind: serviceKind(payload),
      balance: numericCandidate(
        payload?.service_status?.balance ?? payload?.user?.balance,
      ),
    },
  };
}

function commandCost(commandDefinition) {
  for (const object of recursiveObjects(commandDefinition)) {
    if (Array.isArray(object)) continue;
    for (const [key, value] of Object.entries(object)) {
      if (/^(?:credit_cost|cost_credits|credits_per_call|cost)$/iu.test(key)) {
        const result = numericCandidate(value);
        if (result != null) return result;
      }
    }
  }
  return null;
}

async function loadBillingPricing() {
  const bytes = await readControlledFileBytes(
    rootDirectory,
    BILLING_AUDIT_RELATIVE_PATH,
    /^sources\/微博CLI计费核验_\d{4}-\d{2}-\d{2}\.json$/u,
    "微博 CLI 计费核验",
  );
  const audit = JSON.parse(bytes.toString("utf8"));
  assert.equal(
    audit?.schemaVersion,
    "weibo-cli-billing-audit-v1",
    "微博 CLI 计费核验 schema 无效",
  );
  const byPath = new Map(
    (audit.relevantCommands ?? []).map((command) => [command.apiPath, command]),
  );
  const commandUnitCosts = Object.fromEntries(
    [
      ["profiles", "users/show_batch/other"],
      ["timelineBatch", "statuses/user_timeline_batch"],
      ["timeline", "statuses/user_timeline/other"],
      ["search", "search/statuses/limited"],
    ].map(([key, apiPath]) => {
      const command = byPath.get(apiPath);
      assert.equal(
        command?.billingUnit,
        "returned_item",
        `${apiPath} 计费单位必须为 returned_item`,
      );
      const price = numericCandidate(command?.priceCredits);
      assert(price != null && price > 0, `${apiPath} 缺少正数积分单价`);
      return [key, price];
    }),
  );
  return {
    path: BILLING_AUDIT_RELATIVE_PATH,
    sha256: sha256(bytes),
    billingUnit: "returned_item",
    commandUnitCosts,
  };
}

function remainingCallQuota(payload, group, action) {
  for (const object of recursiveObjects(payload)) {
    if (Array.isArray(object)) continue;
    const sameCommand =
      (!object.group || object.group === group) &&
      (!object.action || object.action === action);
    if (!sameCommand) continue;
    for (const [key, value] of Object.entries(object)) {
      if (/^(?:remaining_calls|calls_remaining|remaining)$/iu.test(key)) {
        const result = numericCandidate(value);
        if (result != null) return result;
      }
    }
  }
  return null;
}

function accountScopeFromRawIdentity(payload) {
  const identity =
    payload?.user?.idstr ?? payload?.user?.id ?? payload?.user?.uid ?? null;
  if (identity == null || String(identity).trim() === "") return null;
  return sha256(String(identity).trim()).slice(0, 16);
}

export function accountScope(payload) {
  const projectedHash = payload?.accountScopeHash;
  if (
    typeof projectedHash === "string" &&
    /^[a-f0-9]{16}$/u.test(projectedHash)
  ) {
    return projectedHash;
  }
  return accountScopeFromRawIdentity(payload);
}

export function buildProfileBatches(groups, limit = null) {
  const selected = limit == null ? groups : groups.slice(0, limit);
  const uidOwners = new Map();
  const nameOwners = new Map();
  for (const group of selected) {
    const uid = /^\d{4,20}$/u.test(String(group.weiboUid ?? ""))
      ? String(group.weiboUid)
      : null;
    if (uid) {
      const owners = uidOwners.get(uid) ?? [];
      owners.push(group);
      uidOwners.set(uid, owners);
    } else {
      const screenName = String(
        group.handleKey ?? group.handle ?? group.name ?? "",
      )
        .replace(/^@/u, "")
        .trim();
      if (
        screenName &&
        screenName.length <= 128 &&
        !/[\u0000-\u001f\u007f,=]/u.test(screenName)
      ) {
        const owners = nameOwners.get(screenName) ?? [];
        owners.push(group);
        nameOwners.set(screenName, owners);
      }
    }
  }
  const batches = [];
  const nameEntries = [...nameOwners.entries()].sort(([left], [right]) =>
    left.localeCompare(right, "zh-CN"),
  );
  for (let index = 0; index < nameEntries.length; index += MAX_BATCH_SIZE) {
    const entries = nameEntries.slice(index, index + MAX_BATCH_SIZE);
    batches.push({
      kind: "screen_name",
      values: entries.map(([screenName]) => screenName),
      groupIds: entries.flatMap(([, owners]) =>
        owners.map((group) => group.id),
      ),
      identityConflicts: entries
        .filter(([, owners]) => owners.length > 1)
        .map(([screenName, owners]) => ({
          screenName,
          groupIds: owners.map((group) => group.id),
        })),
    });
  }
  const uidEntries = [...uidOwners.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (let index = 0; index < uidEntries.length; index += MAX_BATCH_SIZE) {
    const entries = uidEntries.slice(index, index + MAX_BATCH_SIZE);
    batches.push({
      kind: "uids",
      values: entries.map(([uid]) => uid),
      groupIds: entries.flatMap(([, owners]) =>
        owners.map((group) => group.id),
      ),
      identityConflicts: entries
        .filter(([, owners]) => owners.length > 1)
        .map(([uid, owners]) => ({
          uid,
          groupIds: owners.map((group) => group.id),
        })),
    });
  }
  return batches;
}

export function selectProfileBatches(batches, maximum = null) {
  assert(Array.isArray(batches), "微博 profile 全量批次无效");
  assert(
    maximum == null ||
      (Number.isSafeInteger(maximum) &&
        maximum >= 1 &&
        maximum <= TRIAL_PROFILE_CALL_CAP),
    "微博 profile 体验批次数无效",
  );
  return batches.slice(0, maximum ?? batches.length);
}

function userObjects(payload) {
  const candidates = [];
  for (const object of recursiveObjects(payload)) {
    if (Array.isArray(object)) continue;
    const uid = object.idstr ?? object.uid ?? object.id;
    const name = object.screen_name ?? object.name;
    if (
      (uid != null || name) &&
      ("followers_count" in object || "description" in object)
    ) {
      candidates.push(object);
    }
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.idstr ?? candidate.uid ?? candidate.id ?? ""}:${candidate.screen_name ?? candidate.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedUserCandidate(user) {
  const value = (key) => (user[key] === undefined ? null : user[key]);
  const uid = value("idstr") ?? value("uid") ?? value("id");
  return {
    uid: uid == null ? null : String(uid),
    screenName: value("screen_name") ?? value("name"),
    description: value("description"),
    followersCount: numericCandidate(value("followers_count")),
    friendsCount: numericCandidate(value("friends_count")),
    statusesCount: numericCandidate(value("statuses_count")),
    province: value("province"),
    city: value("city"),
    location: value("location"),
    verified: value("verified"),
    verifiedType: value("verified_type"),
    verifiedReason: value("verified_reason"),
    profileImageUrl: value("profile_image_url"),
    avatarLarge: value("avatar_large"),
    avatarHd: value("avatar_hd"),
    profileUrl: uid == null ? null : `https://weibo.com/u/${uid}`,
    recentStatus: value("status"),
  };
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/^@/u, "")
    .replace(/[\s_·•・\-—–:：'’"“”「」『』【】\[\]()（）.。/\\]+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function attachProfiles(groups, batchCollection = {}) {
  const batchResults = batchCollection.results ?? [];
  const queriedGroupIds = new Set(
    batchResults.flatMap((result) => result.batch?.groupIds ?? []),
  );
  const failedGroupIds = new Set(batchCollection.blocker?.groupIds ?? []);
  const ownershipConflictsByGroupId = new Map();
  for (const result of batchResults) {
    for (const conflict of result.batch?.identityConflicts ?? []) {
      for (const groupId of conflict.groupIds ?? []) {
        const conflicts = ownershipConflictsByGroupId.get(groupId) ?? [];
        conflicts.push(conflict);
        ownershipConflictsByGroupId.set(groupId, conflicts);
      }
    }
  }
  const users = batchResults.flatMap((result) => userObjects(result.payload));
  const byUid = new Map();
  const byName = new Map();
  for (const user of users) {
    const normalized = normalizedUserCandidate(user);
    if (normalized.uid) {
      const values = byUid.get(normalized.uid) ?? [];
      values.push(normalized);
      byUid.set(normalized.uid, values);
    }
    const nameKey = normalizeName(normalized.screenName);
    if (nameKey) {
      const values = byName.get(nameKey) ?? [];
      values.push(normalized);
      byName.set(nameKey, values);
    }
  }
  return groups.map((group) => {
    const uid = /^\d{4,20}$/u.test(String(group.weiboUid ?? ""))
      ? String(group.weiboUid)
      : null;
    const aliases = [
      group.handleKey,
      group.handle,
      group.name,
      group.profileDisplayName,
    ]
      .map(normalizeName)
      .filter(Boolean);
    const matches = uid
      ? (byUid.get(uid) ?? [])
      : aliases.flatMap((alias) => byName.get(alias) ?? []);
    const unique = [
      ...new Map(
        matches.map((match) => [`${match.uid}:${match.screenName}`, match]),
      ).values(),
    ];
    const identityConflicts = ownershipConflictsByGroupId.get(group.id) ?? [];
    const strictMasterRejections = (group.rejectedIdentityCandidates ?? [])
      .filter(
        (rejection) =>
          unique.length === 1 &&
          String(rejection?.uid ?? "") === String(unique[0]?.uid ?? ""),
      )
      .map((rejection) => ({
        uid: String(rejection.uid),
        rejectedAt: rejection.rejectedAt ?? null,
        reason: rejection.reason ?? null,
        evidenceUrl: rejection.evidenceUrl ?? null,
      }));
    const emptyState = failedGroupIds.has(group.id)
      ? "query_failed"
      : queriedGroupIds.has(group.id)
        ? "not_returned"
        : "not_queried";
    const state =
      identityConflicts.length > 0
        ? "conflict"
        : strictMasterRejections.length > 0
          ? "rejected_by_strict_master"
          : unique.length === 1
            ? "candidate"
            : unique.length > 1
              ? "conflict"
              : emptyState;
    return {
      id: group.id,
      name: group.name,
      handle: group.handle,
      archiveUid: uid,
      state,
      profileCandidate:
        state === "candidate" || state === "rejected_by_strict_master"
          ? unique[0]
          : null,
      conflicts: unique.length > 1 ? unique : [],
      identityConflicts,
      strictMasterRejections,
      decision:
        state === "rejected_by_strict_master"
          ? "strict_master_rejection_takes_precedence"
          : "official_api_candidate_not_applied",
    };
  });
}

function blocker(kind, message, details = {}) {
  return { kind, message, ...details };
}

export async function collectCapabilities(
  cache,
  mode,
  { afterManagementCacheWrite = null } = {},
) {
  assert(
    afterManagementCacheWrite === null ||
      typeof afterManagementCacheWrite === "function",
    "能力缓存写入回调无效",
  );
  const capabilitySource = "weibo-cli-capability:default-account:v1";
  const doctorMode = mode === "cache-only" ? "cache-only" : "refresh";
  const doctor = await cachedCliJson(
    cache,
    capabilitySource,
    ["doctor", "--output", "json"],
    doctorMode,
  );
  if (afterManagementCacheWrite && doctor.response.cache?.persisted === true) {
    await afterManagementCacheWrite({
      cacheKey: doctor.evidence.cacheKey,
      recordId: doctor.evidence.recordId,
      route: new URL(doctor.request.url).pathname,
      observedAt: doctor.evidence.observedAt,
      bodySha256: doctor.evidence.responseSha256,
    });
  }
  const evidence = [doctor.evidence];
  if (!doctor.response.ok || doctor.payload?.ready !== true) {
    return {
      ready: false,
      accountScope: null,
      doctor: doctor.payload,
      blocker: blocker(
        "account_not_ready",
        "微博 CLI 尚未满足登录、开发者认证或服务开通条件",
      ),
      evidence,
    };
  }
  const accountScopeHash = accountScope(doctor.payload);
  if (!accountScopeHash) {
    return {
      ready: false,
      accountScope: null,
      doctor: doctor.payload,
      blocker: blocker(
        "account_scope_unavailable",
        "微博 CLI 未提供可用于隔离缓存的账号身份",
      ),
      evidence,
    };
  }
  const scope = `weibo-cli-account:${accountScopeHash}:v1`;
  const meMode = mode === "cache-only" ? "cache-only" : "refresh";
  const me = await cachedCliJson(
    cache,
    scope,
    ["me", "--output", "json"],
    meMode,
  );
  if (afterManagementCacheWrite && me.response.cache?.persisted === true) {
    await afterManagementCacheWrite({
      cacheKey: me.evidence.cacheKey,
      recordId: me.evidence.recordId,
      route: new URL(me.request.url).pathname,
      observedAt: me.evidence.observedAt,
      bodySha256: me.evidence.responseSha256,
    });
  }
  const commands = await cachedCliJson(
    cache,
    scope,
    ["commands", "list", "--all", "--output", "json"],
    mode,
  );
  evidence.push(me.evidence, commands.evidence);
  const commandSpecs = {};
  for (const [key, group, action] of [
    ["profiles", "users", "show_batch/other"],
    ["timelineBatch", "statuses", "user_timeline_batch"],
    ["timeline", "statuses", "user_timeline/other"],
    ["search", "search", "statuses/limited"],
  ]) {
    if (!availableCommand(commands.payload, group, action)) {
      commandSpecs[key] = {
        available: false,
        group,
        action,
        payload: null,
        evidence: null,
      };
      continue;
    }
    const detail = await cachedCliJson(
      cache,
      scope,
      ["commands", "show", group, action, "--output", "json"],
      mode,
    );
    evidence.push(detail.evidence);
    commandSpecs[key] = {
      available: detail.response.ok,
      group,
      action,
      payload: detail.payload,
      evidence: detail.evidence,
    };
  }
  const ready = me.response.ok && commands.response.ok;
  return {
    ready,
    accountScope: accountScopeHash,
    scope,
    doctor: doctor.payload,
    me: me.payload,
    commands: commands.payload,
    commandSpecs,
    blocker: ready
      ? null
      : blocker(
          "capability_probe_failed",
          "微博 CLI 账号详情或命令目录探针失败",
          {
            meStatus: me.response.status,
            commandsStatus: commands.response.status,
          },
        ),
    evidence,
  };
}

export function assessCollectionCapacity(capabilities, batchesOrCount) {
  const batches = Array.isArray(batchesOrCount) ? batchesOrCount : null;
  const batchCount = batches?.length ?? batchesOrCount;
  assert(
    Number.isSafeInteger(batchCount) && batchCount >= 0,
    "微博 profile 批次数无效",
  );
  if (!capabilities.ready)
    return blocker("account_not_ready", "微博 CLI 账号能力未就绪");
  const profileSpec = capabilities.commandSpecs?.profiles;
  if (!profileSpec?.available) {
    return blocker(
      "profile_command_unavailable",
      "当前服务未开放 users show_batch/other",
    );
  }
  const exactRemaining = remainingCallQuota(
    [
      capabilities.doctor,
      capabilities.me,
      capabilities.commands,
      profileSpec.payload,
    ],
    "users",
    "show_batch/other",
  );
  const kind = serviceKind(capabilities.doctor) ?? serviceKind(capabilities.me);
  const effectiveRemaining =
    exactRemaining ?? (kind === "trial_active" ? TRIAL_PROFILE_CALL_CAP : null);
  const cost =
    commandCost(profileSpec.payload) ??
    capabilities.billingPricing?.commandUnitCosts?.profiles;
  const balance = numericCandidate(
    capabilities.doctor?.service_status?.balance ??
      capabilities.doctor?.serviceStatus?.balance ??
      capabilities.doctor?.service?.balance ??
      capabilities.doctor?.user?.balance ??
      capabilities.me?.service_status?.balance ??
      capabilities.me?.serviceStatus?.balance ??
      capabilities.me?.service?.balance ??
      capabilities.me?.user?.balance,
  );
  if (effectiveRemaining != null && batchCount > effectiveRemaining) {
    return blocker(
      "insufficient_call_quota",
      "完整批次超过当前可确认的接口调用额度",
      {
        batchCount,
        remainingCalls: effectiveRemaining,
      },
    );
  }
  if (kind === "formal_active") {
    if (cost == null || balance == null) {
      return blocker(
        "cost_or_balance_unknown",
        "正式服务无法确认单次成本或剩余积分，拒绝开始不完整批次",
        {
          batchCount,
          cost,
          balance,
        },
      );
    }
    const maximumReturnedItems = batches
      ? batches.reduce((total, batch) => total + batch.values.length, 0)
      : batchCount;
    const requiredCredits = maximumReturnedItems * cost;
    if (requiredCredits > balance) {
      return blocker("insufficient_credits", "完整批次预计积分超过当前余额", {
        batchCount,
        maximumReturnedItems,
        costPerCall: cost,
        billingUnit: "returned_item",
        requiredCredits,
        balance,
      });
    }
    if (balance - requiredCredits < FORMAL_CREDIT_RESERVE) {
      return blocker(
        "credit_reserve_would_be_breached",
        "完整批次会侵占预留积分，拒绝开始采集",
        {
          batchCount,
          maximumReturnedItems,
          costPerReturnedItem: cost,
          requiredCredits,
          balance,
          reserveFloor: FORMAL_CREDIT_RESERVE,
        },
      );
    }
  }
  if (effectiveRemaining == null && kind !== "formal_active") {
    return blocker(
      "quota_unknown",
      "无法确认当前服务可完成全部批次，拒绝发出第一批团体查询",
      {
        batchCount,
        serviceKind: kind,
      },
    );
  }
  return null;
}

export function validateReadCreditGuard(
  capability,
  commandKey,
  maximumReturnedItems,
) {
  assert(
    Number.isSafeInteger(maximumReturnedItems) && maximumReturnedItems >= 0,
    "微博读取接口最大返回条数无效",
  );
  const kind = capability?.serviceKind ?? capability?.doctor?.service?.kind;
  assert(
    ["trial_active", "formal_active"].includes(kind),
    "微博读取接口服务状态必须为 trial_active 或 formal_active",
  );
  if (kind === "trial_active") {
    return { serviceKind: kind, requiredCredits: 0, balanceBefore: null };
  }
  const guard = capability?.billingGuard;
  const balance = numericCandidate(guard?.balanceBefore);
  const unitCost = numericCandidate(guard?.commandUnitCosts?.[commandKey]);
  const reserveFloor = numericCandidate(guard?.reserveFloor);
  assert(
    guard?.billingUnit === "returned_item" &&
      balance != null &&
      unitCost != null &&
      reserveFloor != null,
    `微博正式服务缺少 ${commandKey} 的脱敏计费快照`,
  );
  const requiredCredits = maximumReturnedItems * unitCost;
  assert(
    balance - requiredCredits >= reserveFloor,
    `微博正式服务 ${commandKey} 理论最大消耗会侵占预留积分`,
  );
  return {
    serviceKind: kind,
    billingUnit: guard.billingUnit,
    unitCost,
    maximumReturnedItems,
    requiredCredits,
    balanceBefore: balance,
    reserveFloor,
  };
}

async function collectProfileBatches(cache, capabilities, batches, mode) {
  const results = [];
  for (const [index, batch] of batches.entries()) {
    const args = profileBatchArguments(batch);
    const result = await cachedCliJson(cache, capabilities.scope, args, mode);
    if (!result.response.ok) {
      return {
        results,
        blocker: blocker(
          "profile_batch_failed",
          `第 ${index + 1}/${batches.length} 批接口失败`,
          {
            batchIndex: index,
            groupIds: batch.groupIds,
            status: result.response.status,
            responseCode:
              typeof result.payload?.code === "string"
                ? result.payload.code.slice(0, 128)
                : null,
            evidence: result.evidence,
          },
        ),
      };
    }
    results.push({
      batch: { ...batch, command: args },
      payload: result.payload,
      evidence: result.evidence,
    });
  }
  return { results, blocker: null };
}

export function profileBatchArguments(batch) {
  assert(
    ["uids", "screen_name"].includes(batch?.kind),
    "微博 profile 批次类型无效",
  );
  assert(
    Array.isArray(batch?.values) &&
      batch.values.length > 0 &&
      batch.values.length <= MAX_BATCH_SIZE,
    "微博 profile 批次值无效",
  );
  const flag = batch.kind === "uids" ? "--uids" : "--screen_name";
  return [
    "users",
    "show_batch/other",
    `${flag}=${batch.values.join(",")}`,
    "--output",
    "json",
  ];
}

function summarizeRecords(records) {
  return records.reduce(
    (counts, record) => {
      counts[record.state] = (counts[record.state] ?? 0) + 1;
      return counts;
    },
    {
      candidate: 0,
      conflict: 0,
      rejected_by_strict_master: 0,
      not_returned: 0,
      not_queried: 0,
      query_failed: 0,
    },
  );
}

export async function writeOutputs(
  capability,
  candidate,
  {
    writeCandidate,
    archiveRoot = rootDirectory,
    latestCapabilityPath = capabilityPath,
    candidateOutputPath = candidatePath,
    failureOutputPath = failurePath,
  },
) {
  assert(typeof writeCandidate === "boolean", "微博官方输出写入范围无效");
  if (capability.blocker) {
    await atomicWriteTextFile(
      archiveRoot,
      failureOutputPath,
      stableJson({
        schemaVersion: "weibo-official-failure-v1",
        failedAt: capability.completedAt,
        capability,
        candidateSummary: {
          state: candidate.state,
          counts: candidate.counts,
        },
      }),
      "微博官方接口最近失败",
    );
    return { kind: "failure_only", capabilityReceipt: null };
  }
  const descriptor = capabilityReceiptDescriptor(capability);
  validateCapabilityReceiptReference({
    path: candidate?.source?.capabilityPath,
    sha256: candidate?.source?.capabilitySha256,
  });
  assert.equal(
    candidate.source.capabilityPath,
    descriptor.path,
    "微博官方候选引用的 capability 收据路径不一致",
  );
  assert.equal(
    candidate.source.capabilitySha256,
    descriptor.sha256,
    "微博官方候选引用的 capability 收据 SHA-256 不一致",
  );
  const capabilityReceipt = await ensureCapabilityReceipt({
    rootDirectory: archiveRoot,
    capability,
    expectedSha256: descriptor.sha256,
    write: true,
  });
  try {
    const previous = JSON.parse(
      await fs.readFile(latestCapabilityPath, "utf8"),
    );
    if (previous?.blocker) {
      await atomicWriteTextFile(
        archiveRoot,
        failureOutputPath,
        stableJson({
          schemaVersion: "weibo-official-failure-v1",
          failedAt: previous.completedAt ?? null,
          capability: previous,
          candidateSummary: null,
        }),
        "微博官方接口最近失败",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await atomicWriteTextFile(
    archiveRoot,
    latestCapabilityPath,
    stableJson(capability),
    "微博官方接口能力状态",
  );
  if (writeCandidate) {
    await atomicWriteTextFile(
      archiveRoot,
      candidateOutputPath,
      stableJson(candidate),
      "微博官方接口候选",
    );
  }
  return { kind: "success", capabilityReceipt };
}

function validateArchive(archive) {
  assert(archive && Array.isArray(archive.groups), "严格主档缺少 groups");
  assert(
    archive.groups.length > 0 && archive.groups.length <= MAX_GROUPS,
    "严格主档团体数量越界",
  );
  assert.equal(
    new Set(archive.groups.map((group) => group.id)).size,
    archive.groups.length,
    "严格主档 ID 重复",
  );
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const releaseWriteLock = options.shouldWrite
    ? await acquireControlledWriteLock(rootDirectory, writeLockPath, toolId)
    : null;
  let operationResult;
  let operationError;
  try {
    const archive = JSON.parse(
      (
        await readControlledFileBytes(
          rootDirectory,
          "data/群体分布数据.json",
          /^data\/群体分布数据\.json$/u,
          "严格主档",
        )
      ).toString("utf8"),
    );
    const billingPricing = await loadBillingPricing();
    validateArchive(archive);
    const targetGroups = archive.groups.filter(
      (group) => options.includeInactive || group.isActive,
    );
    const cache = createApiResponseCache({
      cacheDirectory,
      fetchImpl: createCliFetchImpl(),
      defaultMode: "cache-only",
      ttlMs: Infinity,
      maxResponseBytes: MAX_CLI_OUTPUT_BYTES,
      repeatableFailureStatuses: REPEATABLE_CLI_STATUSES,
    });
    const startedAt = new Date().toISOString();
    let capabilities;
    try {
      capabilities = await withCapabilityCacheRedactionTransaction({
        projectRoot: rootDirectory,
        readOnly: options.mode === "cache-only",
        operation: async ({ registerSafeCapabilityCacheReplacements }) =>
          await collectCapabilities(cache, options.mode, {
            afterManagementCacheWrite:
              options.mode === "cache-only"
                ? null
                : async (expectedEntry) => {
                    await registerSafeCapabilityCacheReplacements({
                      expectedEntries: [expectedEntry],
                    });
                  },
          }),
      });
      capabilities.billingPricing = billingPricing;
    } catch (error) {
      if (error?.code === "CACHE_MISS") {
        throw new Error(
          "微博官方接口缓存为空；完成授权或套餐变化后使用 --probe --refresh --write 保存能力探针",
          {
            cause: error,
          },
        );
      }
      throw error;
    }
    const fullBatches = buildProfileBatches(targetGroups, options.limit);
    const batches = selectProfileBatches(
      fullBatches,
      options.maxProfileBatches,
    );
    let batchCollection = { results: [], blocker: null };
    if (options.phase === "collect") {
      batchCollection.blocker = assessCollectionCapacity(capabilities, batches);
      if (!batchCollection.blocker) {
        batchCollection = await collectProfileBatches(
          cache,
          capabilities,
          batches,
          options.mode,
        );
      }
    }
    const selectedTargetCount =
      options.limit == null
        ? targetGroups.length
        : Math.min(options.limit, targetGroups.length);
    const queryableGroupIds = new Set(
      fullBatches.flatMap((batch) => batch.groupIds),
    );
    const plannedGroupIds = new Set(batches.flatMap((batch) => batch.groupIds));
    const queryIdentities = fullBatches.reduce(
      (total, batch) => total + batch.values.length,
      0,
    );
    const plannedIdentities = batches.reduce(
      (total, batch) => total + batch.values.length,
      0,
    );
    const isPartialTrialBounded =
      options.maxProfileBatches != null && batches.length < fullBatches.length;
    const records = attachProfiles(targetGroups, batchCollection);
    const completedAt = new Date().toISOString();
    const overallBlocker = capabilities.blocker ?? batchCollection.blocker;
    const capability = {
      schemaVersion: "weibo-official-capability-v1",
      startedAt,
      completedAt,
      source: {
        name: "微博官方 CLI",
        productUrl: CLI_PRODUCT_URL,
        billingUrl: CLI_BILLING_URL,
        package: "@weibo-ai/weibo-cli",
        expectedVersion: CLI_VERSION,
        browserFallbackUsed: false,
      },
      mode: options.mode,
      phase: options.phase,
      ready: capabilities.ready,
      accountScope: capabilities.accountScope ?? null,
      doctor: summarizeDoctor(capabilities.doctor),
      serviceKind:
        serviceKind(capabilities.doctor) ?? serviceKind(capabilities.me),
      availableCommands: Object.fromEntries(
        Object.entries(capabilities.commandSpecs ?? {}).map(([key, spec]) => [
          key,
          Boolean(spec.available),
        ]),
      ),
      billingGuard: {
        billingUnit: billingPricing.billingUnit,
        pricingSource: {
          path: billingPricing.path,
          sha256: billingPricing.sha256,
        },
        commandUnitCosts: Object.fromEntries(
          Object.entries(capabilities.commandSpecs ?? {}).map(([key, spec]) => [
            key,
            commandCost(spec?.payload) ??
              billingPricing.commandUnitCosts[key] ??
              null,
          ]),
        ),
        balanceBefore: numericCandidate(
          capabilities.doctor?.service_status?.balance ??
            capabilities.me?.service_status?.balance,
        ),
        maximumReturnedItems: batches.reduce(
          (total, batch) => total + batch.values.length,
          0,
        ),
        reserveFloor: FORMAL_CREDIT_RESERVE,
      },
      collectionPlan: {
        scope: "profile_first_phase",
        targetGroups: selectedTargetCount,
        queryableGroups: queryableGroupIds.size,
        unqueryableGroups: selectedTargetCount - queryableGroupIds.size,
        queryIdentities,
        batchSize: MAX_BATCH_SIZE,
        batchCount: fullBatches.length,
        executionScope:
          options.maxProfileBatches == null ? "full" : "trial_bounded",
        partial: isPartialTrialBounded,
        maxProfileBatches: options.maxProfileBatches,
        plannedGroups: plannedGroupIds.size,
        deferredGroups: queryableGroupIds.size - plannedGroupIds.size,
        plannedIdentities,
        deferredIdentities: queryIdentities - plannedIdentities,
        plannedBatchCount: batches.length,
        deferredBatchCount: fullBatches.length - batches.length,
        profileCallsCompleted: batchCollection.results.length,
        deferredUntilCommandCatalogReady: [
          "timeline_posts",
          "profile_background",
          "poster_candidates",
          "style_evidence",
        ],
      },
      blocker: overallBlocker,
      evidence: capabilities.evidence,
      cacheStats: cache.getStats(),
    };
    const capabilityReceipt = capabilityReceiptDescriptor(capability);
    const candidate = {
      schemaVersion: "weibo-official-candidates-v1",
      generatedAt: completedAt,
      source: {
        capabilityPath: capabilityReceipt.path,
        capabilitySha256: capabilityReceipt.sha256,
        rawCachePath: "sources/api-cache/weibo-cli",
        method: "official_weibo_cli_cached_candidates",
        browserFallbackUsed: false,
      },
      state: overallBlocker
        ? "blocked"
        : options.phase === "collect"
          ? isPartialTrialBounded
            ? "partial_trial_bounded"
            : "collected"
          : "probe_only",
      blocker: overallBlocker,
      counts: summarizeRecords(records),
      batches: batchCollection.results.map((result) => ({
        ...result.batch,
        evidence: result.evidence,
      })),
      records,
      policy: {
        directMasterWrite: false,
        dataScope:
          "本阶段只采集批量账号档案；博文、背景、海报和风格证据需在服务开通后按真实命令目录另行规划",
        identityRule:
          "API 返回仅作为候选；UID 唯一匹配后仍需与现有官号身份链核对",
        repeatRule:
          "体验期有界采集执行稳定全量计划的前缀；相同命令与参数在后续全量采集中复用内容寻址缓存，仅非有界 --refresh 允许重新查询",
        browserRule: "本工具不调用浏览器；接口不可用后另行进入人工回退队列",
      },
    };
    let writeResult = null;
    if (options.shouldWrite) {
      writeResult = await writeOutputs(capability, candidate, {
        writeCandidate: options.phase === "collect",
      });
    }
    console.log(
      stableJson({
        ready: capability.ready,
        phase: capability.phase,
        mode: capability.mode,
        plan: capability.collectionPlan,
        blocker: capability.blocker,
        counts: candidate.counts,
        cacheStats: capability.cacheStats,
        billingGuard: capability.billingGuard,
        wrote: options.shouldWrite,
        writeResult,
      }),
    );
    if (options.verbose) console.log(stableJson(capability));
    if (capability.blocker) process.exitCode = 2;
    operationResult = { capability, candidate, writeResult };
  } catch (error) {
    operationError = error;
  }
  let releaseError;
  try {
    await releaseWriteLock?.();
  } catch (error) {
    releaseError = error;
  }
  if (operationError && releaseError) {
    throw new AggregateError(
      [operationError, releaseError],
      "微博官方采集失败，且写锁释放也失败",
    );
  }
  if (operationError) throw operationError;
  if (releaseError) throw releaseError;
  return operationResult;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}

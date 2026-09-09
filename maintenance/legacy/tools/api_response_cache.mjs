import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const API_RESPONSE_CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_REPEATABLE_FAILURE_STATUSES = Object.freeze([
  400, 404, 405, 409, 410, 412, 413, 414, 415, 422,
]);

const REDACTED = "[REDACTED]";
const MAX_ENTRY_BYTES = 128 * 1024;
const VALID_MODES = new Set([
  "cache-only",
  "offline",
  "prefer-cache",
  "refresh",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CREDENTIAL_SHAPED_RESPONSE_PATTERNS = Object.freeze([
  /\bwb_[A-Za-z0-9_-]{20,}\b/u,
  /\bat_[A-Za-z0-9_-]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
]);
const NOFOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0;
const READ_ONLY_FLAGS = fsConstants.O_RDONLY | NOFOLLOW_FLAG;
const EXCLUSIVE_WRITE_FLAGS =
  fsConstants.O_WRONLY |
  fsConstants.O_CREAT |
  fsConstants.O_EXCL |
  NOFOLLOW_FLAG;
const exclusiveFileIdentityByHandle = new WeakMap();
const SENSITIVE_NAMES = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "key",
  "password",
  "passwd",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "session",
  "sessionid",
  "setcookie",
  "signature",
  "token",
  "xapikey",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJsonValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableJsonValue(value));
}

function sensitiveName(value) {
  const normalized = String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return (
    SENSITIVE_NAMES.has(normalized) ||
    /(?:password|passwd|secret|token|credential|authorization|sessionid|apikey|signature)$/u.test(
      normalized,
    )
  );
}

function collectSecret(secretValues, value) {
  if (value == null) return;
  if (typeof value === "object") {
    for (const nested of Object.values(value))
      collectSecret(secretValues, nested);
    return;
  }
  const text = String(value);
  if (text) secretValues.add(text);
}

function headerEntries(headers) {
  if (!headers) return [];
  try {
    return [...new Headers(headers).entries()];
  } catch (error) {
    throw new ApiResponseCacheError(
      "INVALID_HEADERS",
      "请求头无法规范化",
      undefined,
      error,
    );
  }
}

function collectHeaderSecrets(headers, secretValues) {
  for (const [name, value] of headerEntries(headers)) {
    if (!sensitiveName(name)) continue;
    collectSecret(secretValues, value);
    const authorizationMatch = value.match(/^\S+\s+(.+)$/u);
    if (authorizationMatch) collectSecret(secretValues, authorizationMatch[1]);
  }
}

function redactKnownSecrets(value, secretValues) {
  let result = String(value);
  const values = [...secretValues]
    .filter((secret) => secret.length >= 4)
    .sort((left, right) => right.length - left.length);
  for (const secret of values) {
    result = result.replaceAll(secret, REDACTED);
    try {
      result = result.replaceAll(encodeURIComponent(secret), REDACTED);
    } catch {
      // 无效 Unicode 不应阻断其他秘密值的脱敏。
    }
  }
  return result;
}

function canonicalSource(source) {
  const normalized = String(source ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, "-");
  if (
    !normalized ||
    normalized.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new ApiResponseCacheError("INVALID_SOURCE", "缓存来源标识无效");
  }
  return normalized;
}

function canonicalMethod(method) {
  const normalized = String(method ?? "GET")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/u.test(normalized)) {
    throw new ApiResponseCacheError("INVALID_METHOD", "HTTP 方法无效");
  }
  return normalized;
}

function canonicalUrlDetails(input, secretValues) {
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch (error) {
    throw new ApiResponseCacheError(
      "INVALID_URL",
      "请求 URL 无效",
      undefined,
      error,
    );
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new ApiResponseCacheError("INVALID_URL", "请求 URL 仅支持 HTTP(S)");
  }
  if (parsed.username || parsed.password) {
    throw new ApiResponseCacheError(
      "SENSITIVE_URL_CREDENTIALS",
      "请求 URL 不得内嵌凭据",
    );
  }

  parsed.hash = "";
  const parameters = [...parsed.searchParams.entries()].map(([name, value]) => {
    if (!sensitiveName(name)) return [name, value];
    collectSecret(secretValues, value);
    return [name, REDACTED];
  });
  parameters.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName
      ? leftValue.localeCompare(rightValue, "en-US")
      : leftName.localeCompare(rightName, "en-US"),
  );
  parsed.search = "";
  for (const [name, value] of parameters)
    parsed.searchParams.append(name, value);
  return redactKnownSecrets(parsed.href, secretValues);
}

export function canonicalizeUrl(input) {
  return canonicalUrlDetails(input, new Set());
}

function sanitizeJson(value, secretValues, ancestors = new Set()) {
  if (value == null || ["string", "boolean"].includes(typeof value))
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApiResponseCacheError(
        "INVALID_BODY",
        "JSON 请求体包含非有限数值",
      );
    }
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") {
    throw new ApiResponseCacheError(
      "INVALID_BODY",
      "JSON 请求体包含不支持的值",
    );
  }
  if (ancestors.has(value)) {
    throw new ApiResponseCacheError(
      "INVALID_BODY",
      "JSON 请求体不得包含循环引用",
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeJson(item, secretValues, ancestors));
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (sensitiveName(key)) {
        collectSecret(secretValues, value[key]);
        result[key] = REDACTED;
      } else {
        result[key] = sanitizeJson(value[key], secretValues, ancestors);
      }
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function contentTypeFromHeaders(headers) {
  for (const [name, value] of headerEntries(headers)) {
    if (name.toLowerCase() === "content-type") return value.toLowerCase();
  }
  return "";
}

function canonicalForm(parameters, secretValues) {
  const entries = [...parameters.entries()].map(([name, value]) => {
    if (!sensitiveName(name)) return [name, value];
    collectSecret(secretValues, value);
    return [name, REDACTED];
  });
  entries.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName
      ? leftValue.localeCompare(rightValue, "en-US")
      : leftName.localeCompare(rightName, "en-US"),
  );
  const normalized = new URLSearchParams();
  for (const [name, value] of entries) normalized.append(name, value);
  return `form:${normalized.toString()}`;
}

function canonicalBodyDetails(body, headers, secretValues) {
  if (body == null) return "none";
  if (body instanceof URLSearchParams) return canonicalForm(body, secretValues);
  if (
    Buffer.isBuffer(body) ||
    ArrayBuffer.isView(body) ||
    body instanceof ArrayBuffer
  ) {
    const bytes = Buffer.isBuffer(body)
      ? body
      : body instanceof ArrayBuffer
        ? Buffer.from(body)
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    for (const secret of secretValues) {
      if (secret.length >= 4 && bytes.includes(Buffer.from(secret, "utf8"))) {
        throw new ApiResponseCacheError(
          "SENSITIVE_REQUEST_BODY",
          "二进制请求体包含请求凭据，拒绝生成缓存键",
        );
      }
    }
    return `base64:${bytes.toString("base64")}`;
  }
  if (typeof body === "object") {
    return `json:${stableJson(sanitizeJson(body, secretValues))}`;
  }
  if (typeof body !== "string") {
    throw new ApiResponseCacheError("INVALID_BODY", "请求体类型不受支持");
  }

  const trimmed = body.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      return `json:${stableJson(sanitizeJson(parsed, secretValues))}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const contentType = contentTypeFromHeaders(headers);
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    (/^[^=&\r\n]+=[^\r\n]*(?:&[^=&\r\n]+=[^\r\n]*)*$/u.test(trimmed) &&
      trimmed.length > 0)
  ) {
    return canonicalForm(new URLSearchParams(trimmed), secretValues);
  }
  return `text:${redactKnownSecrets(body.replace(/\r\n?/gu, "\n"), secretValues)}`;
}

function canonicalRequestDetails(request) {
  if (!request || typeof request !== "object") {
    throw new ApiResponseCacheError("INVALID_REQUEST", "缓存请求必须是对象");
  }
  const secretValues = new Set();
  collectHeaderSecrets(request.headers, secretValues);
  const source = canonicalSource(request.source);
  const method = canonicalMethod(request.method);
  const url = canonicalUrlDetails(request.url, secretValues);
  const body = canonicalBodyDetails(
    request.body,
    request.headers,
    secretValues,
  );
  return { canonical: { source, method, url, body }, secretValues };
}

export function canonicalizeBody(body, options = {}) {
  const secretValues = new Set();
  collectHeaderSecrets(options.headers, secretValues);
  return canonicalBodyDetails(body, options.headers, secretValues);
}

export function canonicalizeRequest(request) {
  return canonicalRequestDetails(request).canonical;
}

export function createRequestCacheKey(request) {
  return sha256(stableJson(canonicalizeRequest(request)));
}

export const computeCacheKey = createRequestCacheKey;

export class ApiResponseCacheError extends Error {
  constructor(code, message, details, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiResponseCacheError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class CacheIntegrityError extends ApiResponseCacheError {
  constructor(message, details, cause) {
    super("CACHE_INTEGRITY_ERROR", message, details, cause);
    this.name = "CacheIntegrityError";
  }
}

export class ApiCacheResponse {
  #bodyBytes;

  constructor(metadata, bodyBytes, cache) {
    this.key = metadata.key;
    this.recordId = metadata.recordId;
    this.source = metadata.request.source;
    this.method = metadata.request.method;
    this.url = metadata.request.url;
    this.observedAt = metadata.observedAt;
    this.status = metadata.status;
    this.ok = metadata.ok;
    this.repeatableFailure = metadata.outcome === "repeatable_failure";
    this.sha256 = metadata.body.sha256;
    this.byteLength = metadata.body.byteLength;
    this.contentType = metadata.response.contentType;
    this.cache = Object.freeze({ ...cache });
    this.#bodyBytes = Buffer.from(bodyBytes);
    Object.freeze(this);
  }

  get bodyBytes() {
    return Buffer.from(this.#bodyBytes);
  }

  async arrayBuffer() {
    const bytes = Buffer.from(this.#bodyBytes);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  }

  async text() {
    return this.#bodyBytes.toString("utf8");
  }

  async json() {
    return JSON.parse(await this.text());
  }

  clone() {
    return new ApiCacheResponse(
      {
        key: this.key,
        recordId: this.recordId,
        request: { source: this.source, method: this.method, url: this.url },
        observedAt: this.observedAt,
        status: this.status,
        ok: this.ok,
        outcome: this.repeatableFailure ? "repeatable_failure" : "success",
        response: { contentType: this.contentType },
        body: { sha256: this.sha256, byteLength: this.byteLength },
      },
      this.#bodyBytes,
      this.cache,
    );
  }

  toJSON() {
    return {
      key: this.key,
      recordId: this.recordId,
      source: this.source,
      method: this.method,
      url: this.url,
      observedAt: this.observedAt,
      status: this.status,
      ok: this.ok,
      repeatableFailure: this.repeatableFailure,
      sha256: this.sha256,
      byteLength: this.byteLength,
      contentType: this.contentType,
      cache: this.cache,
      bodyEncoding: "base64",
      body: this.#bodyBytes.toString("base64"),
    };
  }
}

function pathsForKey(cacheDirectory, key) {
  const root = path.join(
    cacheDirectory,
    `v${API_RESPONSE_CACHE_SCHEMA_VERSION}`,
  );
  return {
    root,
    entry: path.join(root, "entries", key.slice(0, 2), `${key}.json`),
    bodyDirectory: path.join(root, "bodies"),
    lock: path.join(root, "locks", `${key}.lock`),
  };
}

function bodyPathFor(cacheDirectory, bodySha256) {
  return path.join(
    cacheDirectory,
    `v${API_RESPONSE_CACHE_SCHEMA_VERSION}`,
    "bodies",
    bodySha256.slice(0, 2),
    `${bodySha256}.body`,
  );
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function sameResolvedPath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function sameFileIdentity(left, right) {
  const deviceMatches =
    left.dev === right.dev || left.dev === 0 || right.dev === 0;
  if (!deviceMatches || left.ino !== right.ino) return false;
  return left.ino !== 0 || left.birthtimeMs === right.birthtimeMs;
}

async function guardedLstat(filePath, label) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new CacheIntegrityError(
      `${label}路径无法检查`,
      { path: filePath },
      error,
    );
  }
}

async function guardedRealpath(filePath, label) {
  try {
    return await fs.realpath(filePath);
  } catch (error) {
    throw new CacheIntegrityError(
      `${label}真实路径无法解析`,
      { path: filePath },
      error,
    );
  }
}

async function inspectExistingAncestors(absolutePath, label) {
  const resolved = path.resolve(absolutePath);
  const parsed = path.parse(resolved);
  const segments = path
    .relative(parsed.root, resolved)
    .split(path.sep)
    .filter(Boolean);
  let cursor = parsed.root;
  let cursorStat = await guardedLstat(cursor, label);
  if (
    !cursorStat ||
    cursorStat.isSymbolicLink() ||
    !cursorStat.isDirectory()
  ) {
    throw new CacheIntegrityError(`${label}的文件系统根目录不安全`, {
      path: cursor,
    });
  }

  for (const [index, segment] of segments.entries()) {
    const candidate = path.join(cursor, segment);
    const candidateStat = await guardedLstat(candidate, label);
    if (!candidateStat) {
      const realCursor = await guardedRealpath(cursor, label);
      if (!sameResolvedPath(realCursor, cursor)) {
        throw new CacheIntegrityError(
          `${label}的既存祖先不得是符号链接、junction 或 reparse point`,
          { path: cursor },
        );
      }
      return {
        path: resolved,
        exists: false,
        stat: null,
        nearestExistingPath: cursor,
        nearestExistingStat: cursorStat,
        realPath: realCursor,
      };
    }
    if (candidateStat.isSymbolicLink()) {
      throw new CacheIntegrityError(
        `${label}的既存祖先不得是符号链接、junction 或 reparse point`,
        { path: candidate },
      );
    }
    if (index < segments.length - 1 && !candidateStat.isDirectory()) {
      throw new CacheIntegrityError(`${label}的既存祖先必须是目录`, {
        path: candidate,
      });
    }
    cursor = candidate;
    cursorStat = candidateStat;
  }

  const realPath = await guardedRealpath(cursor, label);
  if (!sameResolvedPath(realPath, cursor)) {
    throw new CacheIntegrityError(
      `${label}不得经由符号链接、junction 或 reparse point`,
      { path: cursor },
    );
  }
  return {
    path: resolved,
    exists: true,
    stat: cursorStat,
    nearestExistingPath: cursor,
    nearestExistingStat: cursorStat,
    realPath,
  };
}

async function establishOrConfirmCacheRoot(pathGuard) {
  const inspection = await inspectExistingAncestors(
    pathGuard.cacheRoot,
    "缓存根目录",
  );
  if (!inspection.exists) {
    if (pathGuard.realCacheRoot) {
      throw new CacheIntegrityError("缓存根目录在使用期间消失");
    }
    return null;
  }
  if (!inspection.stat.isDirectory()) {
    throw new CacheIntegrityError("缓存根目录必须是非链接目录");
  }
  if (!pathGuard.realCacheRoot) {
    pathGuard.realCacheRoot = inspection.realPath;
    pathGuard.rootStat = inspection.stat;
    return inspection;
  }
  if (
    !sameResolvedPath(pathGuard.realCacheRoot, inspection.realPath) ||
    !sameFileIdentity(pathGuard.rootStat, inspection.stat)
  ) {
    throw new CacheIntegrityError("缓存根目录身份在使用期间发生变化");
  }
  return inspection;
}

async function assertSafeCachePath(pathGuard, targetPath, label) {
  const resolved = path.resolve(targetPath);
  if (!isPathWithin(pathGuard.cacheRoot, resolved)) {
    throw new CacheIntegrityError(`${label}越出真实缓存根目录`, {
      path: resolved,
    });
  }

  let rootInspection = await establishOrConfirmCacheRoot(pathGuard);
  if (!rootInspection) {
    const missingInspection = await inspectExistingAncestors(resolved, label);
    rootInspection = await establishOrConfirmCacheRoot(pathGuard);
    if (!rootInspection) return missingInspection;
  }

  const inspection = await inspectExistingAncestors(resolved, label);
  await establishOrConfirmCacheRoot(pathGuard);
  const projectedRealPath = inspection.exists
    ? inspection.realPath
    : path.resolve(
        inspection.realPath,
        path.relative(inspection.nearestExistingPath, resolved),
      );
  if (!isPathWithin(pathGuard.realCacheRoot, projectedRealPath)) {
    throw new CacheIntegrityError(`${label}真实路径越出缓存根目录`, {
      path: resolved,
    });
  }
  return inspection;
}

async function ensureCacheRoot(pathGuard) {
  if (await establishOrConfirmCacheRoot(pathGuard)) return;
  const parsed = path.parse(pathGuard.cacheRoot);
  const segments = path
    .relative(parsed.root, pathGuard.cacheRoot)
    .split(path.sep)
    .filter(Boolean);
  let cursor = parsed.root;
  for (const segment of segments) {
    const candidate = path.join(cursor, segment);
    let inspection = await inspectExistingAncestors(candidate, "缓存根目录");
    if (!inspection.exists) {
      const parentInspection = await inspectExistingAncestors(
        cursor,
        "缓存根目录父级",
      );
      if (!parentInspection.exists || !parentInspection.stat.isDirectory()) {
        throw new CacheIntegrityError("缓存根目录的最近既存祖先不安全");
      }
      try {
        await fs.mkdir(candidate, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      inspection = await inspectExistingAncestors(candidate, "缓存根目录");
    }
    if (!inspection.exists || !inspection.stat.isDirectory()) {
      throw new CacheIntegrityError("缓存根目录路径组件必须是非链接目录", {
        path: candidate,
      });
    }
    cursor = candidate;
  }
  if (!(await establishOrConfirmCacheRoot(pathGuard))) {
    throw new CacheIntegrityError("缓存根目录无法安全创建");
  }
}

async function ensureSafeDirectory(pathGuard, directoryPath, label) {
  const resolved = path.resolve(directoryPath);
  if (!isPathWithin(pathGuard.cacheRoot, resolved)) {
    throw new CacheIntegrityError(`${label}越出缓存根目录`, { path: resolved });
  }
  await ensureCacheRoot(pathGuard);
  let cursor = pathGuard.cacheRoot;
  const segments = path
    .relative(pathGuard.cacheRoot, resolved)
    .split(path.sep)
    .filter(Boolean);
  for (const segment of segments) {
    const candidate = path.join(cursor, segment);
    let inspection = await assertSafeCachePath(pathGuard, candidate, label);
    if (!inspection.exists) {
      const parentInspection = await assertSafeCachePath(
        pathGuard,
        cursor,
        `${label}父级`,
      );
      if (!parentInspection.exists || !parentInspection.stat.isDirectory()) {
        throw new CacheIntegrityError(`${label}的最近既存祖先不安全`);
      }
      try {
        await fs.mkdir(candidate, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      inspection = await assertSafeCachePath(pathGuard, candidate, label);
    }
    if (!inspection.exists || !inspection.stat.isDirectory()) {
      throw new CacheIntegrityError(`${label}路径组件必须是非链接目录`, {
        path: candidate,
      });
    }
    cursor = candidate;
  }
}

function assertRegularFileInspection(inspection, label) {
  if (
    !inspection.exists ||
    !inspection.stat.isFile() ||
    inspection.stat.isSymbolicLink()
  ) {
    throw new CacheIntegrityError(`${label}必须是非链接普通文件`);
  }
}

async function assertOpenHandleMatchesPath(
  pathGuard,
  handle,
  filePath,
  label,
) {
  const inspection = await assertSafeCachePath(pathGuard, filePath, label);
  assertRegularFileInspection(inspection, label);
  const handleStat = await handle.stat();
  if (!handleStat.isFile() || !sameFileIdentity(handleStat, inspection.stat)) {
    throw new CacheIntegrityError(`${label}在打开期间发生替换`);
  }
  return handleStat;
}

async function unlinkOwnedOpenFile(config, handle, filePath, label) {
  const createdStat = exclusiveFileIdentityByHandle.get(handle);
  if (!createdStat) {
    throw new CacheIntegrityError(`${label}缺少本次独占创建的身份凭据`);
  }
  const currentStat = await assertOpenHandleMatchesPath(
    config.pathGuard,
    handle,
    filePath,
    label,
  );
  if (!sameFileIdentity(createdStat, currentStat)) {
    throw new CacheIntegrityError(`${label}已不再是本次独占创建的文件`);
  }
  await fs.unlink(filePath);
  exclusiveFileIdentityByHandle.delete(handle);
}

async function cleanupOwnedOpenFile(config, handle, filePath, label) {
  let cleanupError = null;
  try {
    await unlinkOwnedOpenFile(config, handle, filePath, label);
  } catch (error) {
    cleanupError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    try {
      await handle.close();
    } catch {
      cleanupError ??= error;
    }
  }
  if (cleanupError) throw cleanupError;
}

async function readRegularFile(config, filePath, maximumBytes, label) {
  const inspection = await assertSafeCachePath(
    config.pathGuard,
    filePath,
    label,
  );
  if (!inspection.exists) return null;
  assertRegularFileInspection(inspection, label);
  let handle;
  try {
    try {
      handle = await fs.open(filePath, READ_ONLY_FLAGS);
    } catch (error) {
      throw new CacheIntegrityError(`${label}无法安全打开`, undefined, error);
    }
    const before = await assertOpenHandleMatchesPath(
      config.pathGuard,
      handle,
      filePath,
      label,
    );
    if (before.size > maximumBytes) {
      throw new CacheIntegrityError(`${label}超过允许的字节上限`);
    }
    const bytes = await handle.readFile();
    const after = await assertOpenHandleMatchesPath(
      config.pathGuard,
      handle,
      filePath,
      label,
    );
    if (
      !sameFileIdentity(before, after) ||
      bytes.length !== after.size ||
      bytes.length > maximumBytes
    ) {
      throw new CacheIntegrityError(`${label}在读取期间发生变化`);
    }
    return bytes;
  } finally {
    await handle?.close();
  }
}

async function openExclusiveRegularFile(config, filePath, label) {
  await assertSafeCachePath(config.pathGuard, filePath, label);
  let handle;
  try {
    handle = await fs.open(filePath, EXCLUSIVE_WRITE_FLAGS, 0o600);
    const createdStat = await handle.stat();
    if (!createdStat.isFile()) {
      throw new CacheIntegrityError(`${label}必须是非链接普通文件`);
    }
    exclusiveFileIdentityByHandle.set(handle, createdStat);
    await assertOpenHandleMatchesPath(
      config.pathGuard,
      handle,
      filePath,
      label,
    );
    return handle;
  } catch (error) {
    if (handle && !exclusiveFileIdentityByHandle.has(handle)) {
      try {
        const createdStat = await handle.stat();
        if (createdStat.isFile()) {
          exclusiveFileIdentityByHandle.set(handle, createdStat);
        }
      } catch {
        // 无法取得句柄身份时不得猜测并删除路径。
      }
    }
    if (handle && exclusiveFileIdentityByHandle.has(handle)) {
      try {
        await cleanupOwnedOpenFile(config, handle, filePath, label);
      } catch {
        // 原始失败优先；不能证明仍为本次文件时保持失败关闭且不删除。
      }
    } else {
      await handle?.close();
    }
    if (error?.code === "EEXIST" || error instanceof CacheIntegrityError) {
      throw error;
    }
    throw new CacheIntegrityError(`${label}无法安全创建`, undefined, error);
  }
}

async function writeOpenFile(config, handle, filePath, data, options, label) {
  await assertOpenHandleMatchesPath(
    config.pathGuard,
    handle,
    filePath,
    label,
  );
  await handle.writeFile(data, options);
  await handle.sync();
  await assertOpenHandleMatchesPath(
    config.pathGuard,
    handle,
    filePath,
    label,
  );
}

async function safeHardLink(config, sourcePath, targetPath, label) {
  const sourceInspection = await assertSafeCachePath(
    config.pathGuard,
    sourcePath,
    `${label}源文件`,
  );
  assertRegularFileInspection(sourceInspection, `${label}源文件`);
  const targetInspection = await assertSafeCachePath(
    config.pathGuard,
    targetPath,
    `${label}目标文件`,
  );
  if (targetInspection.exists) {
    assertRegularFileInspection(targetInspection, `${label}目标文件`);
  }
  try {
    await fs.link(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const committed = await assertSafeCachePath(
    config.pathGuard,
    targetPath,
    `${label}目标文件`,
  );
  assertRegularFileInspection(committed, `${label}目标文件`);
}

async function safeRename(config, sourcePath, targetPath, label) {
  const sourceInspection = await assertSafeCachePath(
    config.pathGuard,
    sourcePath,
    `${label}源文件`,
  );
  assertRegularFileInspection(sourceInspection, `${label}源文件`);
  const targetInspection = await assertSafeCachePath(
    config.pathGuard,
    targetPath,
    `${label}目标文件`,
  );
  if (targetInspection.exists) {
    assertRegularFileInspection(targetInspection, `${label}目标文件`);
  }
  await fs.rename(sourcePath, targetPath);
  const committed = await assertSafeCachePath(
    config.pathGuard,
    targetPath,
    `${label}目标文件`,
  );
  assertRegularFileInspection(committed, `${label}目标文件`);
}

async function safeUnlink(config, filePath, label) {
  const inspection = await assertSafeCachePath(
    config.pathGuard,
    filePath,
    label,
  );
  if (!inspection.exists) return false;
  assertRegularFileInspection(inspection, label);
  await fs.unlink(filePath);
  return true;
}

function assertMetadata(metadata, key, canonical, maxResponseBytes) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new CacheIntegrityError("缓存索引不是对象");
  }
  if (
    metadata.schemaVersion !== API_RESPONSE_CACHE_SCHEMA_VERSION ||
    metadata.keyAlgorithm !== "sha256(canonical-json)" ||
    metadata.key !== key ||
    typeof metadata.recordId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      metadata.recordId,
    )
  ) {
    throw new CacheIntegrityError("缓存索引版本或键不匹配");
  }
  const expectedBodySha256 = sha256(canonical.body);
  if (
    metadata.request?.source !== canonical.source ||
    metadata.request?.method !== canonical.method ||
    metadata.request?.url !== canonical.url ||
    metadata.request?.bodySha256 !== expectedBodySha256
  ) {
    throw new CacheIntegrityError("缓存索引的请求身份不匹配");
  }
  const observedTime = Date.parse(metadata.observedAt);
  if (!Number.isFinite(observedTime)) {
    throw new CacheIntegrityError("缓存 observedAt 无效");
  }
  if (
    !Number.isInteger(metadata.status) ||
    metadata.status < 100 ||
    metadata.status > 599 ||
    metadata.ok !== (metadata.status >= 200 && metadata.status <= 299) ||
    !["success", "repeatable_failure"].includes(metadata.outcome) ||
    (metadata.outcome === "success") !== metadata.ok
  ) {
    throw new CacheIntegrityError("缓存 HTTP 状态元数据无效");
  }
  if (
    !metadata.body ||
    !SHA256_PATTERN.test(metadata.body.sha256) ||
    !Number.isInteger(metadata.body.byteLength) ||
    metadata.body.byteLength < 0 ||
    metadata.body.byteLength > maxResponseBytes ||
    metadata.body.path !==
      `bodies/${metadata.body.sha256.slice(0, 2)}/${metadata.body.sha256}.body`
  ) {
    throw new CacheIntegrityError("缓存正文元数据无效");
  }
  if (
    metadata.response?.contentType !== null &&
    (typeof metadata.response?.contentType !== "string" ||
      metadata.response.contentType.length > 128)
  ) {
    throw new CacheIntegrityError("缓存响应类型元数据无效");
  }
  return observedTime;
}

async function readCachedEntry(config, key, canonical) {
  const locations = pathsForKey(config.cacheDirectory, key);
  const entryBytes = await readRegularFile(
    config,
    locations.entry,
    MAX_ENTRY_BYTES,
    "缓存索引",
  );
  if (!entryBytes) return null;
  let metadata;
  try {
    metadata = JSON.parse(entryBytes.toString("utf8"));
  } catch (error) {
    throw new CacheIntegrityError("缓存索引 JSON 损坏", undefined, error);
  }
  const observedTime = assertMetadata(
    metadata,
    key,
    canonical,
    config.maxResponseBytes,
  );
  const expectedBodyPath = bodyPathFor(
    config.cacheDirectory,
    metadata.body.sha256,
  );
  const bodyBytes = await readRegularFile(
    config,
    expectedBodyPath,
    config.maxResponseBytes,
    "缓存正文",
  );
  if (!bodyBytes) throw new CacheIntegrityError("缓存索引引用的正文不存在");
  if (
    bodyBytes.length !== metadata.body.byteLength ||
    sha256(bodyBytes) !== metadata.body.sha256
  ) {
    throw new CacheIntegrityError("缓存正文长度或 SHA-256 不匹配");
  }
  return { metadata, bodyBytes, observedTime };
}

function normalizePositiveInteger(value, label, allowZero = false) {
  if (
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    !Number.isSafeInteger(value)
  ) {
    throw new ApiResponseCacheError(
      "INVALID_OPTION",
      `${label} 必须是有效整数`,
    );
  }
  return value;
}

function normalizeTtl(value) {
  if (value === Infinity) return Infinity;
  return normalizePositiveInteger(value, "ttlMs", true);
}

function normalizeMode(value) {
  const mode = String(value ?? "cache-only");
  if (!VALID_MODES.has(mode)) {
    throw new ApiResponseCacheError(
      "INVALID_MODE",
      `不支持的缓存模式：${mode}`,
    );
  }
  return mode;
}

function safeContentType(response, secretValues) {
  const raw = response?.headers?.get?.("content-type") ?? "";
  const mediaType = raw.split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)) return null;
  return containsKnownSecret(Buffer.from(mediaType, "utf8"), secretValues)
    ? null
    : mediaType;
}

async function readBoundedResponseBody(response, maximumBytes) {
  const declared = response?.headers?.get?.("content-length");
  if (declared != null && declared !== "") {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      throw new ApiResponseCacheError(
        "RESPONSE_TOO_LARGE",
        "API 响应超过缓存字节上限",
      );
    }
  }
  if (!response?.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > maximumBytes) {
        try {
          await response.body.cancel?.("response too large");
        } catch {
          // 取消读取失败不改变字节上限结论。
        }
        throw new ApiResponseCacheError(
          "RESPONSE_TOO_LARGE",
          "API 响应超过缓存字节上限",
        );
      }
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof ApiResponseCacheError) throw error;
    throw new ApiResponseCacheError(
      "RESPONSE_READ_FAILED",
      "API 响应正文读取失败",
      undefined,
      error,
    );
  }
  return Buffer.concat(chunks, total);
}

function containsKnownSecret(bytes, secretValues) {
  for (const secret of secretValues) {
    if (secret && bytes.includes(Buffer.from(secret, "utf8"))) return true;
  }
  return false;
}

function containsCredentialShapedValue(bytes) {
  const text = bytes.toString("utf8");
  return CREDENTIAL_SHAPED_RESPONSE_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
}

async function ensureContentAddressedBody(config, bodyBytes, bodySha256) {
  const targetPath = bodyPathFor(config.cacheDirectory, bodySha256);
  await ensureSafeDirectory(
    config.pathGuard,
    path.dirname(targetPath),
    "缓存正文目录",
  );
  const existing = await readRegularFile(
    config,
    targetPath,
    config.maxResponseBytes,
    "内容寻址缓存正文",
  );
  if (existing) {
    if (
      sha256(existing) !== bodySha256 ||
      existing.length !== bodyBytes.length
    ) {
      throw new CacheIntegrityError("同 SHA-256 缓存正文内容不一致");
    }
    return targetPath;
  }

  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${bodySha256}.${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  let temporaryCreated = false;
  try {
    handle = await openExclusiveRegularFile(
      config,
      temporaryPath,
      "缓存正文临时文件",
    );
    temporaryCreated = true;
    await writeOpenFile(
      config,
      handle,
      temporaryPath,
      bodyBytes,
      undefined,
      "缓存正文临时文件",
    );
    await handle.close();
    handle = null;
    await safeHardLink(config, temporaryPath, targetPath, "缓存正文提交");
    const committed = await readRegularFile(
      config,
      targetPath,
      config.maxResponseBytes,
      "内容寻址缓存正文",
    );
    if (
      !committed ||
      committed.length !== bodyBytes.length ||
      sha256(committed) !== bodySha256
    ) {
      throw new CacheIntegrityError("缓存正文提交后校验失败");
    }
    return targetPath;
  } finally {
    await handle?.close();
    if (temporaryCreated) {
      await safeUnlink(config, temporaryPath, "缓存正文临时文件");
    }
  }
}

async function atomicWriteEntry(config, entryPath, metadata) {
  await ensureSafeDirectory(
    config.pathGuard,
    path.dirname(entryPath),
    "缓存索引目录",
  );
  const temporaryPath = path.join(
    path.dirname(entryPath),
    `.${path.basename(entryPath)}.${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  let temporaryCreated = false;
  try {
    handle = await openExclusiveRegularFile(
      config,
      temporaryPath,
      "缓存索引临时文件",
    );
    temporaryCreated = true;
    await writeOpenFile(
      config,
      handle,
      temporaryPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
      "缓存索引临时文件",
    );
    await handle.close();
    handle = null;
    await safeRename(config, temporaryPath, entryPath, "缓存索引提交");
  } finally {
    await handle?.close();
    if (temporaryCreated) {
      await safeUnlink(config, temporaryPath, "缓存索引临时文件");
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(config, key, stats) {
  const lockPath = pathsForKey(config.cacheDirectory, key).lock;
  await ensureSafeDirectory(
    config.pathGuard,
    path.dirname(lockPath),
    "缓存写锁目录",
  );
  const nonce = crypto.randomBytes(16).toString("hex");
  const startedAt = Date.now();
  let reportedWait = false;
  while (true) {
    let handle;
    try {
      handle = await openExclusiveRegularFile(config, lockPath, "缓存写锁");
      await writeOpenFile(
        config,
        handle,
        lockPath,
        `${JSON.stringify({ pid: process.pid, nonce, acquiredAt: new Date().toISOString() })}\n`,
        "utf8",
        "缓存写锁",
      );
      const lockHandle = handle;
      handle = null;
      return async () => {
        let releaseError = null;
        try {
          const bytes = await readRegularFile(
            config,
            lockPath,
            4096,
            "缓存写锁",
          );
          if (!bytes) throw new CacheIntegrityError("缓存写锁意外消失");
          let owner;
          try {
            owner = JSON.parse(bytes.toString("utf8"));
          } catch (error) {
            throw new CacheIntegrityError("缓存写锁内容损坏", undefined, error);
          }
          if (owner.nonce !== nonce) {
            throw new CacheIntegrityError("缓存写锁所有权已变化");
          }
          await unlinkOwnedOpenFile(
            config,
            lockHandle,
            lockPath,
            "缓存写锁",
          );
        } catch (error) {
          releaseError = error;
          try {
            await unlinkOwnedOpenFile(
              config,
              lockHandle,
              lockPath,
              "缓存写锁",
            );
          } catch {
            // 只清理由持有句柄证明仍归本次操作所有的锁。
          }
        }
        try {
          await lockHandle.close();
        } catch (error) {
          try {
            await lockHandle.close();
          } catch {
            releaseError ??= error;
          }
        }
        if (releaseError) throw releaseError;
      };
    } catch (error) {
      let cleanupError = null;
      if (handle) {
        try {
          await cleanupOwnedOpenFile(config, handle, lockPath, "缓存写锁");
        } catch (cleanupFailure) {
          cleanupError = cleanupFailure;
        }
        handle = null;
      }
      if (cleanupError) {
        throw new CacheIntegrityError(
          "缓存写锁初始化失败且无法安全清理",
          undefined,
          new AggregateError([error, cleanupError]),
        );
      }
      if (error?.code !== "EEXIST") throw error;
      if (!reportedWait) {
        stats.lockWaits += 1;
        reportedWait = true;
      }
      if (Date.now() - startedAt >= config.lockTimeoutMs) {
        throw new ApiResponseCacheError(
          "CACHE_LOCK_TIMEOUT",
          "等待缓存写锁超时；锁不会被自动删除",
        );
      }
      await delay(config.lockRetryMs);
    }
  }
}

function repeatableFailure(status, configuredStatuses) {
  return configuredStatuses.has(status);
}

function cacheInfo(mode, overrides = {}) {
  return {
    mode,
    hit: false,
    persisted: false,
    stale: false,
    ageMs: 0,
    coalesced: false,
    ...overrides,
  };
}

function responseFromEntry(entry, mode, nowMs, ttlMs, overrides = {}) {
  const ageMs = Math.max(0, nowMs - entry.observedTime);
  const stale = ttlMs !== Infinity && ageMs > ttlMs;
  return new ApiCacheResponse(
    entry.metadata,
    entry.bodyBytes,
    cacheInfo(mode, {
      hit: true,
      persisted: true,
      stale,
      ageMs,
      ...overrides,
    }),
  );
}

function networkBody(request) {
  if (
    request.body != null &&
    typeof request.body === "object" &&
    !(
      request.body instanceof URLSearchParams ||
      Buffer.isBuffer(request.body) ||
      ArrayBuffer.isView(request.body) ||
      request.body instanceof ArrayBuffer
    )
  ) {
    return JSON.stringify(request.body);
  }
  return request.body;
}

function networkHeaders(request) {
  if (
    request.body == null ||
    typeof request.body !== "object" ||
    request.body instanceof URLSearchParams ||
    Buffer.isBuffer(request.body) ||
    ArrayBuffer.isView(request.body) ||
    request.body instanceof ArrayBuffer
  ) {
    return request.headers;
  }
  const headers = new Headers(request.headers);
  if (!headers.has("content-type"))
    headers.set("content-type", "application/json");
  return headers;
}

function makeMetadata(
  key,
  canonical,
  response,
  bodyBytes,
  observedAt,
  outcome,
  secretValues,
) {
  const bodySha256 = sha256(bodyBytes);
  return {
    schemaVersion: API_RESPONSE_CACHE_SCHEMA_VERSION,
    keyAlgorithm: "sha256(canonical-json)",
    key,
    recordId: crypto.randomUUID(),
    request: {
      source: canonical.source,
      method: canonical.method,
      url: canonical.url,
      bodySha256: sha256(canonical.body),
    },
    observedAt,
    status: response.status,
    ok: response.status >= 200 && response.status <= 299,
    outcome,
    response: { contentType: safeContentType(response, secretValues) },
    body: {
      sha256: bodySha256,
      byteLength: bodyBytes.length,
      path: `bodies/${bodySha256.slice(0, 2)}/${bodySha256}.body`,
    },
  };
}

export function createApiResponseCache(options = {}) {
  if (!options.cacheDirectory) {
    throw new ApiResponseCacheError(
      "INVALID_OPTION",
      "createApiResponseCache 需要 cacheDirectory",
    );
  }
  const cacheDirectory = path.resolve(String(options.cacheDirectory));
  const config = {
    cacheDirectory,
    pathGuard: {
      cacheRoot: cacheDirectory,
      realCacheRoot: null,
      rootStat: null,
    },
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    defaultMode: normalizeMode(options.defaultMode ?? "cache-only"),
    ttlMs: normalizeTtl(options.ttlMs ?? Infinity),
    maxResponseBytes: normalizePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    ),
    lockTimeoutMs: normalizePositiveInteger(
      options.lockTimeoutMs ?? 30_000,
      "lockTimeoutMs",
    ),
    lockRetryMs: normalizePositiveInteger(
      options.lockRetryMs ?? 25,
      "lockRetryMs",
    ),
    repeatableFailureStatuses: new Set(
      options.repeatableFailureStatuses ?? DEFAULT_REPEATABLE_FAILURE_STATUSES,
    ),
    now: options.now ?? Date.now,
  };
  for (const status of config.repeatableFailureStatuses) {
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new ApiResponseCacheError(
        "INVALID_OPTION",
        "repeatableFailureStatuses 包含无效 HTTP 状态",
      );
    }
  }
  if (typeof config.now !== "function") {
    throw new ApiResponseCacheError("INVALID_OPTION", "now 必须是函数");
  }

  const stats = {
    requests: 0,
    hits: 0,
    misses: 0,
    stale: 0,
    networkRequests: 0,
    refreshes: 0,
    writes: 0,
    repeatableFailures: 0,
    corruptions: 0,
    lockWaits: 0,
  };
  const inFlight = new Map();

  function nowMs() {
    const value = config.now();
    const milliseconds =
      value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(milliseconds)) {
      throw new ApiResponseCacheError("INVALID_CLOCK", "now 返回了无效时间");
    }
    return milliseconds;
  }

  async function checkedRead(key, canonical) {
    try {
      return await readCachedEntry(config, key, canonical);
    } catch (error) {
      if (error instanceof CacheIntegrityError) stats.corruptions += 1;
      throw error;
    }
  }

  async function perform(request, policy, key, details) {
    const mode = normalizeMode(
      policy.mode ?? request.mode ?? config.defaultMode,
    );
    const ttlMs = normalizeTtl(policy.ttlMs ?? request.ttlMs ?? config.ttlMs);
    const initialEntry = await checkedRead(key, details.canonical);
    const currentTime = nowMs();
    if (initialEntry) {
      const response = responseFromEntry(
        initialEntry,
        mode,
        currentTime,
        ttlMs,
      );
      if (mode === "offline" || (mode !== "refresh" && !response.cache.stale)) {
        stats.hits += 1;
        if (response.cache.stale) stats.stale += 1;
        return response;
      }
      if (mode === "cache-only") {
        stats.stale += 1;
        throw new ApiResponseCacheError("CACHE_STALE", "缓存记录已超过 TTL");
      }
    } else {
      stats.misses += 1;
      if (mode === "cache-only" || mode === "offline") {
        throw new ApiResponseCacheError("CACHE_MISS", "未找到完整的缓存记录");
      }
    }

    if (typeof config.fetchImpl !== "function") {
      throw new ApiResponseCacheError(
        "FETCH_UNAVAILABLE",
        "当前运行时没有可用 fetch",
      );
    }
    if (mode === "refresh") stats.refreshes += 1;
    const releaseLock = await acquireLock(config, key, stats);
    try {
      const entryAfterLock = await checkedRead(key, details.canonical);
      const entryChanged =
        (!initialEntry && entryAfterLock) ||
        (initialEntry &&
          entryAfterLock &&
          initialEntry.metadata.recordId !== entryAfterLock.metadata.recordId);
      if (entryAfterLock) {
        const lockedResponse = responseFromEntry(
          entryAfterLock,
          mode,
          nowMs(),
          ttlMs,
          { coalesced: Boolean(entryChanged) },
        );
        if (
          (mode === "prefer-cache" && !lockedResponse.cache.stale) ||
          (mode === "refresh" && entryChanged)
        ) {
          stats.hits += 1;
          return lockedResponse;
        }
      }

      stats.networkRequests += 1;
      const response = await config.fetchImpl(request.url, {
        method: details.canonical.method,
        headers: networkHeaders(request),
        body: networkBody(request),
        signal: request.signal,
        redirect: request.redirect,
      });
      if (!response || !Number.isInteger(response.status)) {
        throw new ApiResponseCacheError(
          "INVALID_RESPONSE",
          "fetch 返回了无效响应",
        );
      }
      const bodyBytes = await readBoundedResponseBody(
        response,
        config.maxResponseBytes,
      );
      if (
        containsKnownSecret(bodyBytes, details.secretValues) ||
        containsCredentialShapedValue(bodyBytes)
      ) {
        throw new ApiResponseCacheError(
          "SENSITIVE_RESPONSE_BODY",
          "响应正文包含请求凭据或凭据形态值，拒绝写入缓存",
        );
      }
      const isSuccess = response.status >= 200 && response.status <= 299;
      const isRepeatableFailure = repeatableFailure(
        response.status,
        config.repeatableFailureStatuses,
      );
      const outcome = isSuccess
        ? "success"
        : isRepeatableFailure
          ? "repeatable_failure"
          : null;
      const observedAt = new Date(nowMs()).toISOString();
      const metadata = makeMetadata(
        key,
        details.canonical,
        response,
        bodyBytes,
        observedAt,
        outcome ?? "transient_failure",
        details.secretValues,
      );

      if (!outcome) {
        return new ApiCacheResponse(
          metadata,
          bodyBytes,
          cacheInfo(mode, { persisted: false }),
        );
      }
      await ensureContentAddressedBody(config, bodyBytes, metadata.body.sha256);
      await atomicWriteEntry(
        config,
        pathsForKey(config.cacheDirectory, key).entry,
        metadata,
      );
      stats.writes += 1;
      if (isRepeatableFailure) stats.repeatableFailures += 1;
      return new ApiCacheResponse(
        metadata,
        bodyBytes,
        cacheInfo(mode, { persisted: true }),
      );
    } finally {
      await releaseLock();
    }
  }

  async function fetchCached(request, policy = {}) {
    stats.requests += 1;
    const details = canonicalRequestDetails(request);
    const key = sha256(stableJson(details.canonical));
    const mode = normalizeMode(
      policy.mode ?? request.mode ?? config.defaultMode,
    );
    const operationKey = `${mode}:${key}`;
    if (inFlight.has(operationKey)) return await inFlight.get(operationKey);
    const promise = perform(request, policy, key, details);
    inFlight.set(operationKey, promise);
    try {
      return await promise;
    } finally {
      if (inFlight.get(operationKey) === promise) inFlight.delete(operationKey);
    }
  }

  async function read(request, policy = {}) {
    return await fetchCached(request, {
      ...policy,
      mode: policy.mode ?? "cache-only",
    });
  }

  return Object.freeze({
    fetch: fetchCached,
    request: fetchCached,
    read,
    keyFor: createRequestCacheKey,
    pathsFor(request) {
      return Object.freeze(
        pathsForKey(config.cacheDirectory, createRequestCacheKey(request)),
      );
    },
    getStats() {
      const lookups = stats.hits + stats.misses + stats.stale;
      return Object.freeze({
        ...stats,
        hitRate: lookups === 0 ? 0 : stats.hits / lookups,
      });
    },
  });
}

export async function fetchWithApiResponseCache(request, options = {}) {
  const cache = createApiResponseCache(options);
  return await cache.fetch(request, options);
}

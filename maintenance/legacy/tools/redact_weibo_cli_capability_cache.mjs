import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import {
  canonicalizeRequest,
  createRequestCacheKey,
} from "./api_response_cache.mjs";
import { atomicWriteTextFile } from "./editorial_contract.mjs";
import { cliRequest } from "./weibo_cli_contract.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const CACHE_RELATIVE_PARTS = ["sources", "api-cache", "weibo-cli", "v1"];
const CACHE_RELATIVE_POSIX = CACHE_RELATIVE_PARTS.join("/");
const LEDGER_FILENAME = "微博CLI能力缓存脱敏记录_2026-09-02.json";
const REPLACEMENT_LEDGER_FILENAME =
  "微博CLI能力缓存安全再生成记录_2026-09-03.json";
const WRITE_LOCK_FILENAME = ".weibo-cli-redaction-write.lock";
const LEDGER_TEMP_PREFIX = `.${LEDGER_FILENAME}.tmp-`;
const REPLACEMENT_LEDGER_TEMP_PREFIX = `.${REPLACEMENT_LEDGER_FILENAME}.`;
const LEDGER_SCHEMA = "weibo-cli-capability-cache-redaction-tombstone";
const LEDGER_SCHEMA_VERSION = 1;
const MAX_ENTRY_BYTES = 128 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_REPLACEMENT_LEDGER_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RECORD_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SHARD_PATTERN = /^[a-f0-9]{2}$/u;
const STRICT_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const TARGET_ROUTES = new Set([
  "/cli/local-command/doctor/json",
  "/cli/local-command/me/json",
]);
const REPLACEMENT_POLICY = Object.freeze({
  oldEntryBytesMayReappear: false,
  oldBodyPathsMayReappear: false,
  replacementMustMatchExactBytes: true,
  replacementMustUseStrictProjection: true,
  fullCredentialValuePersisted: false,
});
const ALLOWED_REMOVED_FIELD_NAMES = new Set([
  "token",
  "token.expires_at",
  "token.id",
  "token.is_active",
  "token.prefix",
  "user.id",
  "user.username",
]);

export class CapabilityCacheRedactionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "CapabilityCacheRedactionError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new CapabilityCacheRedactionError(code, message, cause);
}

function combineErrors(primaryError, secondaryError, message) {
  if (!primaryError) return secondaryError;
  return new AggregateError([primaryError, secondaryError], message, {
    cause: primaryError,
  });
}

function canonicalUtcTimestampValue(value) {
  if (typeof value !== "string" || !STRICT_UTC_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    return null;
  }
  return timestamp;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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

function containsCredentialMaterial(value) {
  const text = String(value ?? "");
  return (
    /(?:access|refresh)[_-]?token\s*["'=:\s]/iu.test(text) ||
    /authorization\s*[:=]\s*bearer/iu.test(text) ||
    /\bbearer\s+[a-z0-9._~-]{12,}/iu.test(text) ||
    /\bwb_[a-z0-9_-]{20,}\b/iu.test(text)
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const expected = [...expectedKeys].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonNegativeNumberOrNull(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function isProjectedServiceStatus(value) {
  if (
    !isPlainObject(value) ||
    !hasOwn(value, "kind") ||
    !hasOwn(value, "balance") ||
    Object.keys(value).some(
      (key) => !new Set(["kind", "balance", "remaining_calls"]).has(key),
    ) ||
    !(
      value.kind === null ||
      (typeof value.kind === "string" &&
        /^[a-z][a-z0-9_-]{0,63}$/u.test(value.kind))
    ) ||
    !isNonNegativeNumberOrNull(value.balance)
  ) {
    return false;
  }
  return (
    !hasOwn(value, "remaining_calls") ||
    isNonNegativeNumberOrNull(value.remaining_calls)
  );
}

function isProjectedManagementBody(value, references) {
  if (!isPlainObject(value) || references.length === 0) return false;
  const routes = new Set(references.map((entry) => entry.route));
  if (routes.size !== 1) return false;
  const accountScopeHashIsSafe =
    value.accountScopeHash === null ||
    (typeof value.accountScopeHash === "string" &&
      /^[a-f0-9]{16}$/u.test(value.accountScopeHash));
  if (
    typeof value.ready !== "boolean" ||
    !accountScopeHashIsSafe ||
    !isProjectedServiceStatus(value.service_status)
  ) {
    return false;
  }
  const [route] = routes;
  if (route === "/cli/local-command/doctor/json") {
    return (
      value.schemaVersion === "weibo-cli-doctor-cache-v1" &&
      hasExactKeys(value, [
        "accountScopeHash",
        "ready",
        "schemaVersion",
        "service_status",
        "steps",
      ]) &&
      hasExactKeys(value.steps, [
        "developer_verification",
        "login",
        "service",
      ]) &&
      Object.values(value.steps).every((step) => typeof step === "boolean")
    );
  }
  if (route === "/cli/local-command/me/json") {
    return (
      value.schemaVersion === "weibo-cli-me-cache-v1" &&
      hasExactKeys(value, [
        "accountScopeHash",
        "ready",
        "schemaVersion",
        "service_status",
      ])
    );
  }
  return false;
}

function toPortableRelative(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function lstatOrNull(filePath) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("PATH_INSPECTION_FAILED", `无法检查路径：${filePath}`, error);
  }
}

async function createPathContext(projectRootInput) {
  const projectRoot = path.resolve(String(projectRootInput));
  const projectStat = await lstatOrNull(projectRoot);
  if (!projectStat) fail("PROJECT_ROOT_MISSING", "项目根目录不存在");
  if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) {
    fail("UNSAFE_PROJECT_ROOT", "项目根目录必须是非链接目录");
  }
  let realRoot;
  try {
    realRoot = await fs.realpath(projectRoot);
  } catch (error) {
    fail("PROJECT_ROOT_REALPATH_FAILED", "项目根目录无法解析", error);
  }
  return { projectRoot, realRoot };
}

function resolveWithinProject(context, relativeParts) {
  const candidate = path.resolve(context.projectRoot, ...relativeParts);
  if (!isWithin(context.projectRoot, candidate)) {
    fail("PATH_OUTSIDE_PROJECT", "目标路径越出项目根目录");
  }
  return candidate;
}

async function assertSafeExistingPath(context, absolutePath, expectedType) {
  const resolved = path.resolve(absolutePath);
  if (!isWithin(context.projectRoot, resolved)) {
    fail("PATH_OUTSIDE_PROJECT", "目标路径越出项目根目录");
  }
  const relative = path.relative(context.projectRoot, resolved);
  let cursor = context.projectRoot;
  let finalStat = await fs.lstat(cursor);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    finalStat = await lstatOrNull(cursor);
    if (!finalStat) fail("EXPECTED_PATH_MISSING", `预期路径不存在：${cursor}`);
    if (finalStat.isSymbolicLink()) {
      fail("SYMLINK_OR_JUNCTION_REJECTED", `拒绝链接或目录联接：${cursor}`);
    }
    if (cursor !== resolved && !finalStat.isDirectory()) {
      fail("UNSAFE_PATH_COMPONENT", `路径中间层不是目录：${cursor}`);
    }
  }
  if (expectedType === "directory" && !finalStat.isDirectory()) {
    fail("EXPECTED_DIRECTORY", `预期非链接目录：${resolved}`);
  }
  if (expectedType === "file" && !finalStat.isFile()) {
    fail("EXPECTED_REGULAR_FILE", `预期非链接普通文件：${resolved}`);
  }
  let realPath;
  try {
    realPath = await fs.realpath(resolved);
  } catch (error) {
    fail("REALPATH_FAILED", `路径无法解析：${resolved}`, error);
  }
  if (!isWithin(context.realRoot, realPath)) {
    fail("REALPATH_OUTSIDE_PROJECT", `真实路径越出项目根目录：${resolved}`);
  }
  return finalStat;
}

async function assertSafeParentForMissingPath(context, absolutePath) {
  const resolved = path.resolve(absolutePath);
  if (!isWithin(context.projectRoot, resolved)) {
    fail("PATH_OUTSIDE_PROJECT", "目标路径越出项目根目录");
  }
  await assertSafeExistingPath(context, path.dirname(resolved), "directory");
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function readStableRegularFile(context, filePath, maximumBytes, label) {
  const before = await assertSafeExistingPath(context, filePath, "file");
  if (before.size > maximumBytes) {
    fail("FILE_TOO_LARGE", `${label}超过允许的字节上限`);
  }
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    fail("FILE_READ_FAILED", `${label}读取失败`, error);
  }
  const after = await assertSafeExistingPath(context, filePath, "file");
  if (
    bytes.length !== before.size ||
    bytes.length > maximumBytes ||
    !sameFileSnapshot(before, after)
  ) {
    fail("FILE_CHANGED_DURING_READ", `${label}在读取期间发生变化`);
  }
  return { bytes, stat: after, fileSha256: sha256(bytes) };
}

function parseJsonBytes(bytes, label) {
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch (error) {
    fail("INVALID_UTF8", `${label}不是有效 UTF-8`, error);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("INVALID_JSON", `${label}不是有效 JSON`, error);
  }
}

function tryParseJsonBytes(bytes) {
  try {
    return JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    return null;
  }
}

function collectRemovedFieldNames(value) {
  if (!isPlainObject(value)) return [];
  const fields = new Set();
  if (hasOwn(value, "token")) {
    fields.add("token");
    if (isPlainObject(value.token)) {
      for (const name of ["id", "expires_at", "is_active", "prefix"]) {
        if (hasOwn(value.token, name)) fields.add(`token.${name}`);
      }
    }
  }
  if (
    isPlainObject(value.user) &&
    hasOwn(value.user, "id") &&
    hasOwn(value.user, "username")
  ) {
    fields.add("user.id");
    fields.add("user.username");
  }
  return [...fields].sort((left, right) => left.localeCompare(right, "en-US"));
}

function orphanSensitiveShape(value) {
  if (!isPlainObject(value)) return null;
  const hasTopLevelToken = hasOwn(value, "token");
  const hasAccountUser =
    isPlainObject(value.user) &&
    hasOwn(value.user, "id") &&
    hasOwn(value.user, "username");
  if (!hasTopLevelToken && !hasAccountUser) return null;
  return {
    hasTopLevelToken,
    hasAccountUser,
    removedFieldNames: collectRemovedFieldNames(value),
  };
}

async function listShardedFiles(context, cacheRoot, category, suffix) {
  const categoryPath = path.join(cacheRoot, category);
  await assertSafeExistingPath(context, categoryPath, "directory");
  const shardEntries = await fs.readdir(categoryPath, { withFileTypes: true });
  const files = [];
  for (const shardEntry of shardEntries.sort((left, right) =>
    left.name.localeCompare(right.name, "en-US"),
  )) {
    const shardPath = path.join(categoryPath, shardEntry.name);
    if (
      shardEntry.isSymbolicLink() ||
      !shardEntry.isDirectory() ||
      !SHARD_PATTERN.test(shardEntry.name)
    ) {
      fail(
        "UNEXPECTED_CACHE_LAYOUT",
        `缓存 ${category} 目录含非标准分片：${shardEntry.name}`,
      );
    }
    await assertSafeExistingPath(context, shardPath, "directory");
    const fileEntries = await fs.readdir(shardPath, { withFileTypes: true });
    for (const fileEntry of fileEntries.sort((left, right) =>
      left.name.localeCompare(right.name, "en-US"),
    )) {
      const expectedPattern = new RegExp(`^[a-f0-9]{64}\\${suffix}$`, "u");
      const filePath = path.join(shardPath, fileEntry.name);
      if (
        fileEntry.isSymbolicLink() ||
        !fileEntry.isFile() ||
        !expectedPattern.test(fileEntry.name) ||
        !fileEntry.name.startsWith(shardEntry.name)
      ) {
        fail(
          "UNEXPECTED_CACHE_LAYOUT",
          `缓存 ${category} 分片含非标准文件：${fileEntry.name}`,
        );
      }
      await assertSafeExistingPath(context, filePath, "file");
      files.push(filePath);
    }
  }
  return files;
}

async function assertCacheLocksEmpty(context, cacheRoot) {
  const locksPath = path.join(cacheRoot, "locks");
  await assertSafeExistingPath(context, locksPath, "directory");
  const entries = await fs.readdir(locksPath, { withFileTypes: true });
  if (entries.length !== 0) {
    fail("CACHE_LOCK_PRESENT", "缓存锁目录非空，拒绝在并发写入期间脱敏");
  }
}

async function assertTransactionArtifacts(
  context,
  { allowWriteLock = false } = {},
) {
  const sourcesPath = resolveWithinProject(context, ["sources"]);
  await assertSafeExistingPath(context, sourcesPath, "directory");
  const entries = await fs.readdir(sourcesPath, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name.startsWith(LEDGER_TEMP_PREFIX) ||
      (entry.name.startsWith(REPLACEMENT_LEDGER_TEMP_PREFIX) &&
        entry.name.endsWith(".tmp"))
    ) {
      fail("LEDGER_TEMP_PRESENT", "检测到未清理的脱敏账本临时文件");
    }
    if (entry.name === WRITE_LOCK_FILENAME) {
      if (!allowWriteLock) {
        fail("WRITE_LOCK_PRESENT", "检测到脱敏写锁，拒绝继续");
      }
      const lockPath = path.join(sourcesPath, entry.name);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        fail("UNSAFE_WRITE_LOCK", "脱敏写锁不是非链接普通文件");
      }
      await assertSafeExistingPath(context, lockPath, "file");
    }
  }
}

function validateEntryMetadata(metadata, cacheKey) {
  if (!isPlainObject(metadata)) {
    fail("INVALID_ENTRY", `缓存 entry 不是对象：${cacheKey}`);
  }
  if (
    metadata.schemaVersion !== 1 ||
    metadata.key !== cacheKey ||
    !isPlainObject(metadata.request) ||
    typeof metadata.request.url !== "string" ||
    !isPlainObject(metadata.body) ||
    !SHA256_PATTERN.test(metadata.body.sha256)
  ) {
    fail("INVALID_ENTRY", `缓存 entry 核心字段无效：${cacheKey}`);
  }
  const expectedBodyPath = `bodies/${metadata.body.sha256.slice(0, 2)}/${metadata.body.sha256}.body`;
  if (metadata.body.path !== expectedBodyPath) {
    fail("INVALID_ENTRY_BODY_PATH", `缓存 entry 正文路径无效：${cacheKey}`);
  }
  if (canonicalUtcTimestampValue(metadata.observedAt) === null) {
    fail(
      "INVALID_ENTRY_OBSERVED_AT",
      `缓存 entry observedAt 无效：${cacheKey}`,
    );
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(metadata.request.url);
  } catch (error) {
    fail("INVALID_ENTRY_URL", `缓存 entry URL 无效：${cacheKey}`, error);
  }
  if (
    !new Set(["http:", "https:"]).has(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    fail("INVALID_ENTRY_URL", `缓存 entry URL 不安全：${cacheKey}`);
  }
  return {
    bodySha256: metadata.body.sha256,
    observedAt: metadata.observedAt,
    route: parsedUrl.pathname,
  };
}

function makeTombstone({
  kind,
  relativePath,
  cacheKey,
  bodySha256,
  route,
  observedAt,
  removedFieldNames,
  reason,
  fileSha256,
  references,
}) {
  const tombstone = {
    kind,
    relativePath,
    cacheKey,
    bodySha256,
    route,
    observedAt,
    removedFieldNames,
    reason,
    fileSha256,
    fullCredentialValuePersisted: false,
    derivedArtifactsRetained: true,
  };
  if (references) tombstone.references = references;
  return tombstone;
}

async function scanCapabilityCache(context, { allowWriteLock = false } = {}) {
  await assertTransactionArtifacts(context, { allowWriteLock });
  const cacheRoot = resolveWithinProject(context, CACHE_RELATIVE_PARTS);
  await assertSafeExistingPath(context, cacheRoot, "directory");
  await assertCacheLocksEmpty(context, cacheRoot);
  const entryPaths = await listShardedFiles(
    context,
    cacheRoot,
    "entries",
    ".json",
  );
  const bodyPaths = await listShardedFiles(
    context,
    cacheRoot,
    "bodies",
    ".body",
  );

  const entries = [];
  const referencesByBody = new Map();
  for (const entryPath of entryPaths) {
    const cacheKey = path.basename(entryPath, ".json");
    const read = await readStableRegularFile(
      context,
      entryPath,
      MAX_ENTRY_BYTES,
      "缓存 entry",
    );
    const metadata = parseJsonBytes(read.bytes, "缓存 entry");
    const identity = validateEntryMetadata(metadata, cacheKey);
    const entry = {
      absolutePath: entryPath,
      relativePath: toPortableRelative(context.projectRoot, entryPath),
      fileSha256: read.fileSha256,
      bytes: read.bytes,
      metadata,
      cacheKey,
      ...identity,
      targetRoute: TARGET_ROUTES.has(identity.route),
    };
    entries.push(entry);
    const references = referencesByBody.get(entry.bodySha256) ?? [];
    references.push(entry);
    referencesByBody.set(entry.bodySha256, references);
  }

  const bodiesBySha = new Map();
  for (const bodyPath of bodyPaths) {
    const bodySha256 = path.basename(bodyPath, ".body");
    const read = await readStableRegularFile(
      context,
      bodyPath,
      MAX_BODY_BYTES,
      "缓存 body",
    );
    if (read.fileSha256 !== bodySha256) {
      fail("BODY_HASH_MISMATCH", `缓存 body SHA-256 不匹配：${bodySha256}`);
    }
    bodiesBySha.set(bodySha256, {
      absolutePath: bodyPath,
      relativePath: toPortableRelative(context.projectRoot, bodyPath),
      fileSha256: read.fileSha256,
      bodySha256,
      bytes: read.bytes,
    });
  }
  for (const entry of entries) {
    if (!bodiesBySha.has(entry.bodySha256)) {
      fail(
        "REFERENCED_BODY_MISSING",
        `缓存 entry 引用的 body 不存在：${entry.cacheKey}`,
      );
    }
  }

  const targetEntries = [];
  const targetBodies = [];
  const retainedEntryPaths = new Set();
  const retainedBodyPaths = new Set();

  for (const body of bodiesBySha.values()) {
    const references = referencesByBody.get(body.bodySha256) ?? [];
    const managementReferences = references.filter(
      (entry) => entry.targetRoute,
    );
    const nonTargetReferences = references.filter(
      (entry) => !entry.targetRoute,
    );
    if (managementReferences.length > 0 && nonTargetReferences.length > 0) {
      fail(
        "TARGET_BODY_SHARED_WITH_DATA_ENTRY",
        `doctor/me 目标 body 同时被非目标数据 entry 引用：${body.bodySha256}`,
      );
    }

    const parsedBody = tryParseJsonBytes(body.bytes);
    const targetReferences = isProjectedManagementBody(
      parsedBody,
      managementReferences,
    )
      ? []
      : managementReferences;
    const removedFieldNames = collectRemovedFieldNames(parsedBody);
    if (targetReferences.length > 0) {
      const sortedReferences = [...targetReferences].sort((left, right) =>
        left.cacheKey.localeCompare(right.cacheKey, "en-US"),
      );
      const primary = sortedReferences[0];
      targetBodies.push({
        ...body,
        tombstone: makeTombstone({
          kind: "body",
          relativePath: body.relativePath,
          cacheKey: primary.cacheKey,
          bodySha256: body.bodySha256,
          route: primary.route,
          observedAt: primary.observedAt,
          removedFieldNames,
          reason: "body 仅被 doctor/me 管理路由引用",
          fileSha256: body.fileSha256,
          references: sortedReferences.map((entry) => ({
            cacheKey: entry.cacheKey,
            route: entry.route,
            observedAt: entry.observedAt,
          })),
        }),
      });
      for (const entry of sortedReferences) {
        targetEntries.push({
          ...entry,
          tombstone: makeTombstone({
            kind: "entry",
            relativePath: entry.relativePath,
            cacheKey: entry.cacheKey,
            bodySha256: entry.bodySha256,
            route: entry.route,
            observedAt: entry.observedAt,
            removedFieldNames: [],
            reason: "entry URL 精确匹配 doctor/me 管理路由",
            fileSha256: entry.fileSha256,
          }),
        });
      }
      continue;
    }

    if (references.length === 0) {
      const orphanShape = orphanSensitiveShape(parsedBody);
      if (orphanShape) {
        const shapeNames = [
          orphanShape.hasTopLevelToken ? "顶层 token" : null,
          orphanShape.hasAccountUser ? "account user" : null,
        ].filter(Boolean);
        targetBodies.push({
          ...body,
          tombstone: makeTombstone({
            kind: "body",
            relativePath: body.relativePath,
            cacheKey: null,
            bodySha256: body.bodySha256,
            route: null,
            observedAt: null,
            removedFieldNames: orphanShape.removedFieldNames,
            reason: `无 entry 引用且 JSON 呈现${shapeNames.join("+")}管理响应形状`,
            fileSha256: body.fileSha256,
          }),
        });
        continue;
      }
    }
    retainedBodyPaths.add(body.relativePath);
  }

  const targetEntryPaths = new Set(
    targetEntries.map((entry) => entry.relativePath),
  );
  for (const entry of entries) {
    if (!targetEntryPaths.has(entry.relativePath)) {
      retainedEntryPaths.add(entry.relativePath);
    }
  }
  const retainedCacheFiles = [...retainedEntryPaths, ...retainedBodyPaths].sort(
    (left, right) => left.localeCompare(right, "en-US"),
  );
  targetEntries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en-US"),
  );
  targetBodies.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en-US"),
  );
  return {
    cacheRoot,
    entries,
    bodiesBySha,
    targetEntries,
    targetBodies,
    retainedCacheFiles,
    entryCount: entries.length,
    bodyCount: bodiesBySha.size,
  };
}

function buildLedger(plan) {
  const tombstones = [
    ...plan.targetEntries.map((entry) => entry.tombstone),
    ...plan.targetBodies.map((body) => body.tombstone),
  ];
  const createdAt = new Date().toISOString();
  for (const tombstone of tombstones) {
    assertTombstonePrecedesLedger(
      tombstone,
      createdAt,
      "INVALID_LEDGER_TIME_ORDER",
    );
  }
  return {
    schema: LEDGER_SCHEMA,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    createdAt,
    cacheRoot: CACHE_RELATIVE_POSIX,
    executionMode: "redact-write",
    fullCredentialValuePersisted: false,
    derivedArtifactsRetained: true,
    tombstones,
    retainedCacheFiles: plan.retainedCacheFiles,
  };
}

function ledgerPathFor(context) {
  return resolveWithinProject(context, ["sources", LEDGER_FILENAME]);
}

function writeLockPathFor(context) {
  return resolveWithinProject(context, ["sources", WRITE_LOCK_FILENAME]);
}

async function writeLedgerAtomically(context, ledger) {
  const ledgerPath = ledgerPathFor(context);
  await assertSafeParentForMissingPath(context, ledgerPath);
  if (await lstatOrNull(ledgerPath)) {
    fail("LEDGER_ALREADY_EXISTS", "脱敏账本已存在，拒绝覆盖不可逆证据");
  }
  const sourcesPath = path.dirname(ledgerPath);
  const temporaryPath = path.join(
    sourcesPath,
    `${LEDGER_TEMP_PREFIX}${process.pid}-${crypto.randomUUID()}`,
  );
  let handle;
  let published = false;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.link(temporaryPath, ledgerPath);
      published = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("LEDGER_ALREADY_EXISTS", "脱敏账本已存在，拒绝覆盖不可逆证据");
      }
      fail("LEDGER_PUBLISH_FAILED", "脱敏账本原子发布失败", error);
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        fail("LEDGER_TEMP_CLEANUP_FAILED", "脱敏账本临时文件清理失败", error);
      }
    });
  }
  if (!published) fail("LEDGER_NOT_PUBLISHED", "脱敏账本未成功发布");
  await assertSafeExistingPath(context, ledgerPath, "file");
  return ledgerPath;
}

async function acquireWriteLock(context) {
  const lockPath = writeLockPathFor(context);
  await assertSafeParentForMissingPath(context, lockPath);
  if (await lstatOrNull(lockPath)) {
    fail("WRITE_LOCK_PRESENT", "脱敏写锁已存在，拒绝并发写入");
  }
  let handle;
  const lockContent = `${JSON.stringify({
    schema: "weibo-cli-capability-cache-redaction-lock",
    pid: process.pid,
    createdAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  })}\n`;
  let created = false;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
    created = true;
    await handle.writeFile(lockContent, "utf8");
    await handle.sync();
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created) {
      await fs.unlink(lockPath).catch(() => {});
    }
    if (error?.code === "EEXIST") {
      fail("WRITE_LOCK_PRESENT", "脱敏写锁已存在，拒绝并发写入");
    }
    fail("WRITE_LOCK_CREATE_FAILED", "脱敏写锁创建失败", error);
  }
  return {
    handle,
    lockPath,
    contentSha256: sha256(Buffer.from(lockContent, "utf8")),
  };
}

async function releaseWriteLock(lock) {
  await lock.handle.close();
  const current = await lstatOrNull(lock.lockPath);
  if (!current) fail("WRITE_LOCK_LOST", "脱敏写锁在释放前已消失");
  if (current.isSymbolicLink() || !current.isFile()) {
    fail("WRITE_LOCK_REPLACED", "脱敏写锁在执行期间被替换，拒绝删除");
  }
  const currentBytes = await fs.readFile(lock.lockPath);
  if (sha256(currentBytes) !== lock.contentSha256) {
    fail("WRITE_LOCK_REPLACED", "脱敏写锁在执行期间被替换，拒绝删除");
  }
  try {
    await fs.unlink(lock.lockPath);
  } catch (error) {
    fail("WRITE_LOCK_REMOVE_FAILED", "脱敏写锁清理失败", error);
  }
}

async function verifyAndUnlink(context, plannedFile) {
  const current = await readStableRegularFile(
    context,
    plannedFile.absolutePath,
    plannedFile.tombstone.kind === "entry" ? MAX_ENTRY_BYTES : MAX_BODY_BYTES,
    "待删除缓存文件",
  );
  if (current.fileSha256 !== plannedFile.fileSha256) {
    fail(
      "TARGET_CHANGED_BEFORE_DELETE",
      `待删除文件在账本落盘后发生变化：${plannedFile.relativePath}`,
    );
  }
  try {
    await fs.unlink(plannedFile.absolutePath);
  } catch (error) {
    fail(
      "TARGET_DELETE_FAILED",
      `待删除文件精确 unlink 失败：${plannedFile.relativePath}`,
      error,
    );
  }
}

function portableRelativeToAbsolute(context, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  ) {
    fail("UNSAFE_LEDGER_PATH", "账本包含不安全的相对路径");
  }
  return resolveWithinProject(context, relativePath.split("/"));
}

function validateCacheRelativePath(relativePath, kind) {
  const entryMatch = relativePath.match(
    /^sources\/api-cache\/weibo-cli\/v1\/entries\/([a-f0-9]{2})\/([a-f0-9]{64})\.json$/u,
  );
  const bodyMatch = relativePath.match(
    /^sources\/api-cache\/weibo-cli\/v1\/bodies\/([a-f0-9]{2})\/([a-f0-9]{64})\.body$/u,
  );
  const match =
    kind === "entry" ? entryMatch : kind === "body" ? bodyMatch : null;
  if (!match || match[1] !== match[2].slice(0, 2)) {
    fail("UNSAFE_LEDGER_PATH", "账本缓存路径不属于固定分片根");
  }
  return match[2];
}

function validateLedgerTombstone(tombstone) {
  if (
    !isPlainObject(tombstone) ||
    !new Set(["entry", "body"]).has(tombstone.kind)
  ) {
    fail("INVALID_LEDGER", "账本 tombstone 类型无效");
  }
  const pathIdentity = validateCacheRelativePath(
    tombstone.relativePath,
    tombstone.kind,
  );
  if (
    !SHA256_PATTERN.test(tombstone.bodySha256) ||
    !SHA256_PATTERN.test(tombstone.fileSha256) ||
    (tombstone.cacheKey !== null && !SHA256_PATTERN.test(tombstone.cacheKey)) ||
    (tombstone.route !== null && !TARGET_ROUTES.has(tombstone.route)) ||
    (tombstone.observedAt !== null &&
      canonicalUtcTimestampValue(tombstone.observedAt) === null) ||
    typeof tombstone.reason !== "string" ||
    tombstone.reason.length === 0 ||
    tombstone.reason.length > 256 ||
    tombstone.fullCredentialValuePersisted !== false ||
    tombstone.derivedArtifactsRetained !== true ||
    !Array.isArray(tombstone.removedFieldNames) ||
    tombstone.removedFieldNames.some(
      (name) => !ALLOWED_REMOVED_FIELD_NAMES.has(name),
    )
  ) {
    fail("INVALID_LEDGER", "账本 tombstone 字段无效");
  }
  if (tombstone.kind === "entry" && pathIdentity !== tombstone.cacheKey) {
    fail("INVALID_LEDGER", "账本 entry 路径与 cacheKey 不一致");
  }
  if (tombstone.kind === "body" && pathIdentity !== tombstone.bodySha256) {
    fail("INVALID_LEDGER", "账本 body 路径与 bodySha256 不一致");
  }
  if (tombstone.references !== undefined) {
    if (
      tombstone.kind !== "body" ||
      !Array.isArray(tombstone.references) ||
      tombstone.references.length === 0 ||
      tombstone.references.some(
        (reference) =>
          !isPlainObject(reference) ||
          !SHA256_PATTERN.test(reference.cacheKey) ||
          !TARGET_ROUTES.has(reference.route) ||
          canonicalUtcTimestampValue(reference.observedAt) === null,
      )
    ) {
      fail("INVALID_LEDGER", "账本 body references 字段无效");
    }
  }
}

function assertTombstonePrecedesLedger(tombstone, ledgerCreatedAt, errorCode) {
  const ledgerTimestamp = canonicalUtcTimestampValue(ledgerCreatedAt);
  const observedTimes = [
    tombstone.observedAt,
    ...(tombstone.references ?? []).map((reference) => reference.observedAt),
  ].filter((value) => value !== null);
  if (
    ledgerTimestamp === null ||
    observedTimes.some((value) => {
      const observedTimestamp = canonicalUtcTimestampValue(value);
      return observedTimestamp === null || observedTimestamp >= ledgerTimestamp;
    })
  ) {
    fail(errorCode, "墓碑观察时间必须严格早于脱敏账本创建时间");
  }
}

async function readAndValidateLedger(context) {
  const ledgerPath = ledgerPathFor(context);
  const read = await readStableRegularFile(
    context,
    ledgerPath,
    MAX_LEDGER_BYTES,
    "脱敏账本",
  );
  const ledger = parseJsonBytes(read.bytes, "脱敏账本");
  if (
    UTF8_DECODER.decode(read.bytes) !== `${JSON.stringify(ledger, null, 2)}\n`
  ) {
    fail("INVALID_LEDGER", "脱敏账本不是规范 JSON 字节");
  }
  if (
    !isPlainObject(ledger) ||
    ledger.schema !== LEDGER_SCHEMA ||
    ledger.schemaVersion !== LEDGER_SCHEMA_VERSION ||
    canonicalUtcTimestampValue(ledger.createdAt) === null ||
    ledger.cacheRoot !== CACHE_RELATIVE_POSIX ||
    ledger.executionMode !== "redact-write" ||
    ledger.fullCredentialValuePersisted !== false ||
    ledger.derivedArtifactsRetained !== true ||
    !Array.isArray(ledger.tombstones) ||
    ledger.tombstones.length === 0 ||
    !Array.isArray(ledger.retainedCacheFiles)
  ) {
    fail("INVALID_LEDGER", "脱敏账本 schema 或顶层字段无效");
  }
  const tombstonePaths = new Set();
  for (const tombstone of ledger.tombstones) {
    validateLedgerTombstone(tombstone);
    assertTombstonePrecedesLedger(
      tombstone,
      ledger.createdAt,
      "INVALID_LEDGER",
    );
    if (tombstonePaths.has(tombstone.relativePath)) {
      fail("INVALID_LEDGER", "脱敏账本含重复 tombstone 路径");
    }
    tombstonePaths.add(tombstone.relativePath);
    const absolutePath = portableRelativeToAbsolute(
      context,
      tombstone.relativePath,
    );
    await assertSafeParentForMissingPath(context, absolutePath);
  }
  const retainedPaths = new Set();
  for (const relativePath of ledger.retainedCacheFiles) {
    if (typeof relativePath !== "string") {
      fail("INVALID_LEDGER", "账本 retainedCacheFiles 类型无效");
    }
    const kind = relativePath.endsWith(".json") ? "entry" : "body";
    validateCacheRelativePath(relativePath, kind);
    portableRelativeToAbsolute(context, relativePath);
    if (tombstonePaths.has(relativePath) || retainedPaths.has(relativePath)) {
      fail("INVALID_LEDGER", "账本保留路径重复或与 tombstone 冲突");
    }
    retainedPaths.add(relativePath);
  }
  return { ledger, fileSha256: read.fileSha256 };
}

function replacementLedgerPathFor(context) {
  return resolveWithinProject(context, [
    "sources",
    REPLACEMENT_LEDGER_FILENAME,
  ]);
}

async function readAndValidateReplacementLedger(
  context,
  tombstoneLedger,
  tombstoneLedgerSha256,
) {
  const replacementLedgerPath = replacementLedgerPathFor(context);
  if (!(await lstatOrNull(replacementLedgerPath))) {
    return {
      document: null,
      replacements: [],
      byPath: new Map(),
      fileBytes: null,
    };
  }
  const read = await readStableRegularFile(
    context,
    replacementLedgerPath,
    MAX_REPLACEMENT_LEDGER_BYTES,
    "安全再生成记录",
  );
  const document = parseJsonBytes(read.bytes, "安全再生成记录");
  if (
    UTF8_DECODER.decode(read.bytes) !== `${JSON.stringify(document, null, 2)}\n`
  ) {
    fail("INVALID_REPLACEMENT_LEDGER", "安全再生成记录不是规范 JSON 字节");
  }
  if (
    !hasExactKeys(document, [
      "createdAt",
      "policy",
      "replacements",
      "schema",
      "schemaVersion",
      "tombstoneLedger",
    ]) ||
    document.schema !== "weibo-cli-capability-cache-safe-replacements" ||
    document.schemaVersion !== 1 ||
    canonicalUtcTimestampValue(document.createdAt) === null ||
    !hasExactKeys(document.tombstoneLedger, ["path", "sha256"]) ||
    document.tombstoneLedger.path !== `sources/${LEDGER_FILENAME}` ||
    document.tombstoneLedger.sha256 !== tombstoneLedgerSha256 ||
    !hasExactKeys(document.policy, Object.keys(REPLACEMENT_POLICY)) ||
    Object.entries(REPLACEMENT_POLICY).some(
      ([key, value]) => document.policy[key] !== value,
    ) ||
    !Array.isArray(document.replacements)
  ) {
    fail("INVALID_REPLACEMENT_LEDGER", "安全再生成记录顶层字段无效");
  }

  const tombstonesByPath = new Map(
    tombstoneLedger.tombstones.map((item) => [item.relativePath, item]),
  );
  const byPath = new Map();
  for (const replacement of document.replacements) {
    if (
      !hasExactKeys(replacement, [
        "bodyPath",
        "bodySha256",
        "cacheKey",
        "observedAt",
        "projectionSchemaVersion",
        "relativePath",
        "replacementFileSha256",
        "replacesFileSha256",
        "route",
      ]) ||
      !SHA256_PATTERN.test(replacement.cacheKey) ||
      !SHA256_PATTERN.test(replacement.replacesFileSha256) ||
      !SHA256_PATTERN.test(replacement.replacementFileSha256) ||
      replacement.replacesFileSha256 === replacement.replacementFileSha256 ||
      !SHA256_PATTERN.test(replacement.bodySha256) ||
      !TARGET_ROUTES.has(replacement.route) ||
      canonicalUtcTimestampValue(replacement.observedAt) === null
    ) {
      fail("INVALID_REPLACEMENT_LEDGER", "安全再生成记录条目字段无效");
    }
    const entryIdentity = validateCacheRelativePath(
      replacement.relativePath,
      "entry",
    );
    const bodyIdentity = validateCacheRelativePath(
      replacement.bodyPath,
      "body",
    );
    const expectedProjectionSchema =
      replacement.route === "/cli/local-command/doctor/json"
        ? "weibo-cli-doctor-cache-v1"
        : "weibo-cli-me-cache-v1";
    const tombstone = tombstonesByPath.get(replacement.relativePath);
    const tombstoneObservedAt = canonicalUtcTimestampValue(
      tombstone?.observedAt,
    );
    const tombstoneLedgerCreatedAt = canonicalUtcTimestampValue(
      tombstoneLedger.createdAt,
    );
    const replacementObservedAt = canonicalUtcTimestampValue(
      replacement.observedAt,
    );
    const replacementLedgerCreatedAt = canonicalUtcTimestampValue(
      document.createdAt,
    );
    if (
      entryIdentity !== replacement.cacheKey ||
      bodyIdentity !== replacement.bodySha256 ||
      replacement.projectionSchemaVersion !== expectedProjectionSchema ||
      !tombstone ||
      tombstone.kind !== "entry" ||
      tombstone.cacheKey !== replacement.cacheKey ||
      tombstone.route !== replacement.route ||
      tombstone.fileSha256 !== replacement.replacesFileSha256 ||
      tombstoneObservedAt === null ||
      tombstoneLedgerCreatedAt === null ||
      replacementObservedAt === null ||
      replacementLedgerCreatedAt === null ||
      !(
        tombstoneObservedAt < tombstoneLedgerCreatedAt &&
        tombstoneLedgerCreatedAt < replacementObservedAt &&
        replacementObservedAt <= replacementLedgerCreatedAt
      ) ||
      byPath.has(replacement.relativePath)
    ) {
      fail("INVALID_REPLACEMENT_LEDGER", "安全再生成记录未精确绑定原墓碑");
    }
    portableRelativeToAbsolute(context, replacement.relativePath);
    portableRelativeToAbsolute(context, replacement.bodyPath);
    byPath.set(replacement.relativePath, replacement);
  }
  return {
    document,
    replacements: document.replacements,
    byPath,
    fileBytes: Buffer.from(read.bytes),
  };
}

function validateStrictProjectedEntry(entry, body, parsedBody) {
  const metadata = entry.metadata;
  const rawEntryText = UTF8_DECODER.decode(entry.bytes);
  const rawBodyText = UTF8_DECODER.decode(body.bytes);
  if (
    containsCredentialMaterial(rawEntryText) ||
    containsCredentialMaterial(rawBodyText)
  ) {
    fail(
      "REGISTERED_REPLACEMENT_CREDENTIAL_SHAPE",
      `安全再生成缓存疑似含凭据材料：${entry.relativePath}`,
    );
  }
  if (
    !hasExactKeys(metadata, [
      "body",
      "key",
      "keyAlgorithm",
      "observedAt",
      "ok",
      "outcome",
      "recordId",
      "request",
      "response",
      "schemaVersion",
      "status",
    ]) ||
    !hasExactKeys(metadata.request, [
      "bodySha256",
      "method",
      "source",
      "url",
    ]) ||
    !hasExactKeys(metadata.response, ["contentType"]) ||
    !hasExactKeys(metadata.body, ["byteLength", "path", "sha256"]) ||
    metadata.schemaVersion !== 1 ||
    metadata.keyAlgorithm !== "sha256(canonical-json)" ||
    metadata.key !== entry.cacheKey ||
    typeof metadata.recordId !== "string" ||
    !RECORD_ID_PATTERN.test(metadata.recordId) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      metadata.observedAt,
    ) ||
    metadata.status !== 200 ||
    metadata.ok !== true ||
    metadata.outcome !== "success" ||
    metadata.response.contentType !== "application/json" ||
    metadata.body.sha256 !== body.bodySha256 ||
    metadata.body.byteLength !== body.bytes.length ||
    metadata.body.path !==
      `bodies/${body.bodySha256.slice(0, 2)}/${body.bodySha256}.body`
  ) {
    fail(
      "REGISTERED_REPLACEMENT_ENTRY_SHAPE",
      `安全再生成 entry 不符合完整白名单：${entry.relativePath}`,
    );
  }
  const expectedEntryText = `${JSON.stringify(metadata, null, 2)}\n`;
  const allowedBodySerializations = new Set([
    stableJson(parsedBody),
    `${JSON.stringify(parsedBody, null, 2)}\n`,
  ]);
  if (
    rawEntryText !== expectedEntryText ||
    !allowedBodySerializations.has(rawBodyText)
  ) {
    fail(
      "REGISTERED_REPLACEMENT_NON_CANONICAL_JSON",
      `安全再生成缓存不是规范 JSON 字节：${entry.relativePath}`,
    );
  }

  const args =
    entry.route === "/cli/local-command/doctor/json"
      ? ["doctor", "--output", "json"]
      : ["me", "--output", "json"];
  let expectedSource;
  if (entry.route === "/cli/local-command/doctor/json") {
    expectedSource = "weibo-cli-capability:default-account:v1";
  } else {
    const sourceMatch = String(metadata.request.source).match(
      /^weibo-cli-account:([a-f0-9]{16}):v1$/u,
    );
    if (!sourceMatch || parsedBody.accountScopeHash !== sourceMatch[1]) {
      fail(
        "REGISTERED_REPLACEMENT_ACCOUNT_SCOPE",
        `me 安全缓存未绑定同一账号域：${entry.relativePath}`,
      );
    }
    expectedSource = sourceMatch[0];
  }
  const expectedRequest = cliRequest(expectedSource, args);
  const canonical = canonicalizeRequest(expectedRequest);
  if (
    metadata.request.source !== canonical.source ||
    metadata.request.method !== canonical.method ||
    metadata.request.url !== canonical.url ||
    metadata.request.bodySha256 !== sha256(canonical.body) ||
    createRequestCacheKey(expectedRequest) !== entry.cacheKey
  ) {
    fail(
      "REGISTERED_REPLACEMENT_REQUEST_IDENTITY",
      `安全再生成 entry 的请求身份或缓存键不匹配：${entry.relativePath}`,
    );
  }
}

function verifyRegisteredReplacement(replacement, plan) {
  const entry = plan.entries.find(
    (candidate) => candidate.relativePath === replacement.relativePath,
  );
  if (!entry) {
    fail(
      "REGISTERED_REPLACEMENT_MISSING",
      `已登记的安全再生成 entry 不存在：${replacement.relativePath}`,
    );
  }
  const body = plan.bodiesBySha.get(entry.bodySha256);
  if (
    entry.fileSha256 !== replacement.replacementFileSha256 ||
    entry.cacheKey !== replacement.cacheKey ||
    entry.route !== replacement.route ||
    entry.observedAt !== replacement.observedAt ||
    entry.bodySha256 !== replacement.bodySha256 ||
    !body ||
    body.relativePath !== replacement.bodyPath ||
    body.fileSha256 !== replacement.bodySha256
  ) {
    fail(
      "REGISTERED_REPLACEMENT_DRIFT",
      `已登记的安全再生成缓存发生漂移：${replacement.relativePath}`,
    );
  }
  const parsedBody = tryParseJsonBytes(body.bytes);
  if (
    parsedBody?.schemaVersion !== replacement.projectionSchemaVersion ||
    !isProjectedManagementBody(parsedBody, [entry])
  ) {
    fail(
      "REGISTERED_REPLACEMENT_NOT_SAFE",
      `已登记的缓存不再符合严格投影：${replacement.relativePath}`,
    );
  }
  validateStrictProjectedEntry(entry, body, parsedBody);
}

async function verifyLedgerEffects(
  context,
  ledger,
  plan,
  replacementLedger = { replacements: [], byPath: new Map() },
) {
  const retainedPaths = new Set(plan.retainedCacheFiles);
  for (const replacement of replacementLedger.replacements) {
    verifyRegisteredReplacement(replacement, plan);
  }
  for (const tombstone of ledger.tombstones) {
    const absolutePath = portableRelativeToAbsolute(
      context,
      tombstone.relativePath,
    );
    await assertSafeParentForMissingPath(context, absolutePath);
    if (await lstatOrNull(absolutePath)) {
      const current = await readStableRegularFile(
        context,
        absolutePath,
        tombstone.kind === "entry" ? MAX_ENTRY_BYTES : MAX_BODY_BYTES,
        "墓碑路径上的再生成缓存",
      );
      if (current.fileSha256 === tombstone.fileSha256) {
        fail(
          "TOMBSTONED_CONTENT_REAPPEARED",
          `账本列出的旧文件内容再次出现：${tombstone.relativePath}`,
        );
      }
      const replacement = replacementLedger.byPath.get(tombstone.relativePath);
      if (
        tombstone.kind !== "entry" ||
        !replacement ||
        replacement.replacementFileSha256 !== current.fileSha256
      ) {
        fail(
          "UNREGISTERED_TOMBSTONE_PATH_REUSE",
          `墓碑路径上的新内容未精确登记：${tombstone.relativePath}`,
        );
      }
      if (!retainedPaths.has(tombstone.relativePath)) {
        fail(
          "UNSAFE_TOMBSTONE_PATH_REUSE",
          `墓碑路径只允许严格投影后的安全缓存再生成：${tombstone.relativePath}`,
        );
      }
    }
  }
  if (plan.targetEntries.length > 0 || plan.targetBodies.length > 0) {
    fail("SENSITIVE_TARGET_REMAINS", "当前缓存仍含敏感能力目标");
  }
  for (const relativePath of ledger.retainedCacheFiles) {
    const absolutePath = portableRelativeToAbsolute(context, relativePath);
    await assertSafeExistingPath(context, absolutePath, "file");
  }
  return {
    oldContentAbsentCount: ledger.tombstones.length,
    verifiedReplacementCount: replacementLedger.replacements.length,
  };
}

function buildCurrentReplacementLedger(
  tombstoneLedger,
  tombstoneLedgerSha256,
  plan,
  previousDocument,
) {
  if (plan.targetEntries.length > 0 || plan.targetBodies.length > 0) {
    fail(
      "UNSAFE_REPLACEMENT_CONTENT",
      "doctor/me 缓存尚未全部采用严格投影，拒绝登记安全替换",
    );
  }
  const entriesByPath = new Map(
    plan.entries.map((entry) => [entry.relativePath, entry]),
  );
  const previousReplacementsByPath = new Map(
    (previousDocument?.replacements ?? []).map((replacement) => [
      replacement.relativePath,
      replacement,
    ]),
  );
  const tombstoneLedgerCreatedAt = canonicalUtcTimestampValue(
    tombstoneLedger.createdAt,
  );
  const replacements = [];
  for (const tombstone of tombstoneLedger.tombstones) {
    if (tombstone.kind !== "entry") continue;
    const entry = entriesByPath.get(tombstone.relativePath);
    if (!entry) continue;
    if (
      entry.fileSha256 === tombstone.fileSha256 ||
      entry.cacheKey !== tombstone.cacheKey ||
      entry.route !== tombstone.route
    ) {
      fail(
        "UNSAFE_TOMBSTONE_PATH_REUSE",
        `墓碑 entry 路径未被新的同请求安全投影占用：${entry.relativePath}`,
      );
    }
    const body = plan.bodiesBySha.get(entry.bodySha256);
    const parsedBody = body ? tryParseJsonBytes(body.bytes) : null;
    const projectionSchemaVersion =
      entry.route === "/cli/local-command/doctor/json"
        ? "weibo-cli-doctor-cache-v1"
        : entry.route === "/cli/local-command/me/json"
          ? "weibo-cli-me-cache-v1"
          : null;
    if (
      !body ||
      !projectionSchemaVersion ||
      parsedBody?.schemaVersion !== projectionSchemaVersion ||
      !isProjectedManagementBody(parsedBody, [entry])
    ) {
      fail(
        "UNSAFE_REPLACEMENT_CONTENT",
        `墓碑 entry 路径上的新内容不符合严格投影：${entry.relativePath}`,
      );
    }
    validateStrictProjectedEntry(entry, body, parsedBody);
    const replacementObservedAt = canonicalUtcTimestampValue(entry.observedAt);
    const previousReplacement = previousReplacementsByPath.get(
      entry.relativePath,
    );
    const previousReplacementObservedAt = canonicalUtcTimestampValue(
      previousReplacement?.observedAt,
    );
    if (
      tombstoneLedgerCreatedAt === null ||
      replacementObservedAt === null ||
      tombstoneLedgerCreatedAt >= replacementObservedAt
    ) {
      fail(
        "INVALID_REPLACEMENT_TIME_ORDER",
        `安全替换观察时间未晚于墓碑账本：${entry.relativePath}`,
      );
    }
    if (
      previousReplacement &&
      (previousReplacementObservedAt === null ||
        replacementObservedAt < previousReplacementObservedAt)
    ) {
      fail(
        "REPLACEMENT_TIME_ROLLBACK",
        `同一路径的安全替换观察时间发生倒退：${entry.relativePath}`,
      );
    }
    replacements.push({
      relativePath: entry.relativePath,
      cacheKey: entry.cacheKey,
      route: entry.route,
      observedAt: entry.observedAt,
      replacesFileSha256: tombstone.fileSha256,
      replacementFileSha256: entry.fileSha256,
      bodyPath: body.relativePath,
      bodySha256: body.bodySha256,
      projectionSchemaVersion,
    });
  }
  replacements.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en-US"),
  );
  const latestObservedAt = replacements.reduce(
    (latest, replacement) =>
      Math.max(latest, canonicalUtcTimestampValue(replacement.observedAt) ?? 0),
    0,
  );
  const previousCreatedAt =
    canonicalUtcTimestampValue(previousDocument?.createdAt) ?? 0;
  const createdAt = new Date(
    Math.max(Date.now(), latestObservedAt, previousCreatedAt),
  ).toISOString();
  return {
    schema: "weibo-cli-capability-cache-safe-replacements",
    schemaVersion: 1,
    createdAt,
    tombstoneLedger: {
      path: `sources/${LEDGER_FILENAME}`,
      sha256: tombstoneLedgerSha256,
    },
    policy: { ...REPLACEMENT_POLICY },
    replacements,
  };
}

function validateExpectedReplacementEntries(plan, expectedEntries) {
  if (!Array.isArray(expectedEntries) || expectedEntries.length > 2) {
    fail(
      "INVALID_EXPECTED_REPLACEMENTS",
      "预期安全替换证据必须是最多两项的数组",
    );
  }
  const seen = new Set();
  for (const expected of expectedEntries) {
    if (
      !hasExactKeys(expected, [
        "bodySha256",
        "cacheKey",
        "observedAt",
        "recordId",
        "route",
      ]) ||
      !SHA256_PATTERN.test(expected.cacheKey) ||
      !SHA256_PATTERN.test(expected.bodySha256) ||
      !RECORD_ID_PATTERN.test(expected.recordId) ||
      !TARGET_ROUTES.has(expected.route) ||
      canonicalUtcTimestampValue(expected.observedAt) === null ||
      seen.has(expected.cacheKey)
    ) {
      fail(
        "INVALID_EXPECTED_REPLACEMENTS",
        "预期安全替换证据字段无效",
      );
    }
    seen.add(expected.cacheKey);
    const entry = plan.entries.find(
      (candidate) => candidate.cacheKey === expected.cacheKey,
    );
    if (
      !entry ||
      entry.route !== expected.route ||
      entry.observedAt !== expected.observedAt ||
      entry.bodySha256 !== expected.bodySha256 ||
      entry.metadata.recordId !== expected.recordId
    ) {
      fail(
        "EXPECTED_REPLACEMENT_MISMATCH",
        "刚写入的 doctor/me 缓存与安全登记输入不一致",
      );
    }
    const body = plan.bodiesBySha.get(entry.bodySha256);
    const parsedBody = body ? tryParseJsonBytes(body.bytes) : null;
    if (!body || !isProjectedManagementBody(parsedBody, [entry])) {
      fail(
        "EXPECTED_REPLACEMENT_NOT_SAFE",
        "刚写入的 doctor/me 缓存不符合严格投影",
      );
    }
    validateStrictProjectedEntry(entry, body, parsedBody);
  }
}

function sameReplacementState(previousDocument, nextDocument) {
  return (
    previousDocument !== null &&
    JSON.stringify(previousDocument.tombstoneLedger) ===
      JSON.stringify(nextDocument.tombstoneLedger) &&
    JSON.stringify(previousDocument.policy) === JSON.stringify(nextDocument.policy) &&
    JSON.stringify(previousDocument.replacements) ===
      JSON.stringify(nextDocument.replacements)
  );
}

async function rollbackReplacementLedger(
  context,
  previousBytes,
  publishedBytes,
) {
  const replacementLedgerPath = replacementLedgerPathFor(context);
  const current = await readStableRegularFile(
    context,
    replacementLedgerPath,
    MAX_REPLACEMENT_LEDGER_BYTES,
    "待回滚的安全再生成记录",
  );
  if (Buffer.compare(current.bytes, publishedBytes) !== 0) {
    fail(
      "REPLACEMENT_LEDGER_CHANGED_BEFORE_ROLLBACK",
      "安全再生成记录在回滚前已发生变化，拒绝覆盖未知内容",
    );
  }
  if (previousBytes === null) {
    try {
      await fs.unlink(replacementLedgerPath);
    } catch (error) {
      fail(
        "REPLACEMENT_LEDGER_ROLLBACK_DELETE_FAILED",
        "新建的安全再生成记录回滚删除失败",
        error,
      );
    }
    if (await lstatOrNull(replacementLedgerPath)) {
      fail(
        "REPLACEMENT_LEDGER_ROLLBACK_DELETE_FAILED",
        "新建的安全再生成记录回滚后仍然存在",
      );
    }
    return;
  }
  await atomicWriteTextFile(
    context.projectRoot,
    replacementLedgerPath,
    UTF8_DECODER.decode(previousBytes),
    "微博 CLI 能力缓存安全再生成记录回滚",
  );
  const restored = await readStableRegularFile(
    context,
    replacementLedgerPath,
    MAX_REPLACEMENT_LEDGER_BYTES,
    "已回滚的安全再生成记录",
  );
  if (Buffer.compare(restored.bytes, previousBytes) !== 0) {
    fail(
      "REPLACEMENT_LEDGER_ROLLBACK_MISMATCH",
      "安全再生成记录未按原字节恢复",
    );
  }
}

async function verifyCapabilityCacheStateUnderLock(context) {
  await assertTransactionArtifacts(context, { allowWriteLock: true });
  const tombstoneLedgerPath = ledgerPathFor(context);
  const replacementLedgerPath = replacementLedgerPathFor(context);
  if (!(await lstatOrNull(tombstoneLedgerPath))) {
    if (await lstatOrNull(replacementLedgerPath)) {
      fail(
        "REPLACEMENT_LEDGER_WITHOUT_TOMBSTONES",
        "安全再生成记录存在，但不可变脱敏账本缺失",
      );
    }
    const plan = await scanCapabilityCache(context, { allowWriteLock: true });
    if (plan.targetEntries.length > 0 || plan.targetBodies.length > 0) {
      fail(
        "UNREDACTED_MANAGEMENT_CACHE",
        "尚无脱敏账本但缓存仍含敏感 doctor/me 目标",
      );
    }
    return { kind: "not_required", replacementCount: 0 };
  }

  const { ledger, fileSha256 } = await readAndValidateLedger(context);
  const replacementLedger = await readAndValidateReplacementLedger(
    context,
    ledger,
    fileSha256,
  );
  const plan = await scanCapabilityCache(context, { allowWriteLock: true });
  const effects = await verifyLedgerEffects(
    context,
    ledger,
    plan,
    replacementLedger,
  );
  return {
    kind: "verified",
    replacementCount: effects.verifiedReplacementCount,
  };
}

async function registerSafeCapabilityCacheReplacementsUnderLock(
  context,
  { expectedEntries = [], hooks = {} } = {},
) {
  if (!isPlainObject(hooks)) {
    fail("INVALID_REGISTRATION_HOOKS", "安全登记 hooks 必须是对象");
  }
  if (
    hooks.afterReplacementLedgerWritten !== undefined &&
    typeof hooks.afterReplacementLedgerWritten !== "function"
  ) {
    fail(
      "INVALID_REGISTRATION_HOOKS",
      "afterReplacementLedgerWritten hook 必须是函数",
    );
  }
  await assertTransactionArtifacts(context, { allowWriteLock: true });
  const tombstoneLedgerPath = ledgerPathFor(context);
  const replacementLedgerPath = replacementLedgerPathFor(context);
  if (!(await lstatOrNull(tombstoneLedgerPath))) {
    if (await lstatOrNull(replacementLedgerPath)) {
      fail(
        "REPLACEMENT_LEDGER_WITHOUT_TOMBSTONES",
        "安全再生成记录存在，但不可变脱敏账本缺失",
      );
    }
    const plan = await scanCapabilityCache(context, { allowWriteLock: true });
    validateExpectedReplacementEntries(plan, expectedEntries);
    if (plan.targetEntries.length > 0 || plan.targetBodies.length > 0) {
      fail(
        "UNREDACTED_MANAGEMENT_CACHE",
        "尚无脱敏账本但缓存仍含敏感 doctor/me 目标",
      );
    }
    return { kind: "not_required", replacementCount: 0 };
  }

  const { ledger, fileSha256 } = await readAndValidateLedger(context);
  const previous = await readAndValidateReplacementLedger(
    context,
    ledger,
    fileSha256,
  );
  const plan = await scanCapabilityCache(context, { allowWriteLock: true });
  validateExpectedReplacementEntries(plan, expectedEntries);
  const nextDocument = buildCurrentReplacementLedger(
    ledger,
    fileSha256,
    plan,
    previous.document,
  );
  if (!previous.document && nextDocument.replacements.length === 0) {
    await verifyLedgerEffects(context, ledger, plan, previous);
    return { kind: "not_required", replacementCount: 0 };
  }
  if (sameReplacementState(previous.document, nextDocument)) {
    await verifyLedgerEffects(context, ledger, plan, previous);
    return {
      kind: "unchanged",
      replacementCount: previous.replacements.length,
    };
  }

  const publishedBytes = Buffer.from(
    `${JSON.stringify(nextDocument, null, 2)}\n`,
    "utf8",
  );
  let published = false;
  try {
    await atomicWriteTextFile(
      context.projectRoot,
      replacementLedgerPath,
      publishedBytes,
      "微博 CLI 能力缓存安全再生成记录",
    );
    published = true;
    await hooks.afterReplacementLedgerWritten?.({
      replacementLedgerPath,
      replacementCount: nextDocument.replacements.length,
    });
    const registered = await readAndValidateReplacementLedger(
      context,
      ledger,
      fileSha256,
    );
    const finalPlan = await scanCapabilityCache(context, {
      allowWriteLock: true,
    });
    const effects = await verifyLedgerEffects(
      context,
      ledger,
      finalPlan,
      registered,
    );
    return {
      kind: "updated",
      replacementCount: effects.verifiedReplacementCount,
    };
  } catch (error) {
    if (!published) {
      try {
        const current = await readStableRegularFile(
          context,
          replacementLedgerPath,
          MAX_REPLACEMENT_LEDGER_BYTES,
          "可能已发布的安全再生成记录",
        );
        published = Buffer.compare(current.bytes, publishedBytes) === 0;
      } catch (inspectionError) {
        if (inspectionError?.code !== "EXPECTED_PATH_MISSING") {
          throw combineErrors(
            error,
            inspectionError,
            "安全再生成记录写入失败且无法确认发布状态",
          );
        }
      }
    }
    if (!published) throw error;
    try {
      await rollbackReplacementLedger(
        context,
        previous.fileBytes,
        publishedBytes,
      );
    } catch (rollbackError) {
      throw combineErrors(
        error,
        rollbackError,
        "安全再生成记录 postflight 失败且回滚失败",
      );
    }
    throw error;
  }
}

async function finishLockedOperation(context, lock, operationError) {
  let finalError = operationError;
  let released = false;
  try {
    await releaseWriteLock(lock);
    released = true;
  } catch (error) {
    finalError = combineErrors(
      finalError,
      error,
      "能力缓存事务失败且脱敏写锁清理失败",
    );
  }
  if (released) {
    try {
      await assertTransactionArtifacts(context);
    } catch (error) {
      finalError = combineErrors(
        finalError,
        error,
        "能力缓存事务失败且事务产物清理校验失败",
      );
    }
  }
  if (finalError) throw finalError;
}

export async function registerSafeCapabilityCacheReplacements({
  projectRoot = DEFAULT_PROJECT_ROOT,
  expectedEntries = [],
  hooks = {},
} = {}) {
  const context = await createPathContext(projectRoot);
  await assertTransactionArtifacts(context);
  const lock = await acquireWriteLock(context);
  let operationResult;
  let operationError;
  try {
    operationResult = await registerSafeCapabilityCacheReplacementsUnderLock(
      context,
      { expectedEntries, hooks },
    );
  } catch (error) {
    operationError = error;
  }
  await finishLockedOperation(context, lock, operationError);
  return operationResult;
}

export async function withCapabilityCacheRedactionTransaction({
  projectRoot = DEFAULT_PROJECT_ROOT,
  readOnly = false,
  operation,
} = {}) {
  if (typeof readOnly !== "boolean") {
    fail("INVALID_TRANSACTION", "能力缓存事务 readOnly 必须是布尔值");
  }
  if (typeof operation !== "function") {
    fail("INVALID_TRANSACTION", "能力缓存事务必须提供 operation 函数");
  }
  const context = await createPathContext(projectRoot);
  await assertTransactionArtifacts(context);
  const lock = await acquireWriteLock(context);
  let operationResult;
  let operationError;
  let preflightPassed = false;
  try {
    if (readOnly) {
      await verifyCapabilityCacheStateUnderLock(context);
    } else {
      await registerSafeCapabilityCacheReplacementsUnderLock(context);
    }
    preflightPassed = true;
    const inTransactionRegistrar = async ({ expectedEntries = [] } = {}) => {
      if (readOnly) {
        fail(
          "READ_ONLY_TRANSACTION_WRITE",
          "只读能力缓存事务禁止登记安全替换",
        );
      }
      return await registerSafeCapabilityCacheReplacementsUnderLock(context, {
        expectedEntries,
      });
    };
    try {
      operationResult = await operation({
        registerSafeCapabilityCacheReplacements: inTransactionRegistrar,
      });
    } catch (error) {
      operationError = error;
    }
    try {
      if (readOnly) {
        await verifyCapabilityCacheStateUnderLock(context);
      } else {
        await registerSafeCapabilityCacheReplacementsUnderLock(context);
      }
    } catch (error) {
      operationError = combineErrors(
        operationError,
        error,
        "collector operation 与能力缓存 postflight 均失败",
      );
    }
  } catch (error) {
    operationError = combineErrors(
      operationError,
      error,
      preflightPassed
        ? "能力缓存事务失败"
        : "能力缓存 preflight 失败",
    );
  }
  await finishLockedOperation(context, lock, operationError);
  return operationResult;
}

export async function inspectCapabilityCache({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const context = await createPathContext(projectRoot);
  const plan = await scanCapabilityCache(context);
  return {
    projectRoot: context.projectRoot,
    entryCount: plan.entryCount,
    bodyCount: plan.bodyCount,
    targetEntryCount: plan.targetEntries.length,
    targetBodyCount: plan.targetBodies.length,
    retainedFileCount: plan.retainedCacheFiles.length,
    targetPaths: [
      ...plan.targetEntries.map((entry) => entry.relativePath),
      ...plan.targetBodies.map((body) => body.relativePath),
    ],
  };
}

export async function executeCapabilityCacheRedaction({
  projectRoot = DEFAULT_PROJECT_ROOT,
  hooks = {},
} = {}) {
  const context = await createPathContext(projectRoot);
  await assertTransactionArtifacts(context);
  const ledgerPath = ledgerPathFor(context);
  if (await lstatOrNull(ledgerPath)) {
    fail("LEDGER_ALREADY_EXISTS", "脱敏账本已存在，拒绝覆盖不可逆证据");
  }
  const lock = await acquireWriteLock(context);
  let operationResult;
  let operationError;
  try {
    const plan = await scanCapabilityCache(context, { allowWriteLock: true });
    if (plan.targetEntries.length === 0 && plan.targetBodies.length === 0) {
      fail("NO_REDACTION_TARGETS", "当前缓存没有可写入账本的脱敏目标");
    }
    const ledger = buildLedger(plan);
    await writeLedgerAtomically(context, ledger);
    if (typeof hooks.afterLedgerWritten === "function") {
      await hooks.afterLedgerWritten({
        ledgerPath,
        tombstoneCount: ledger.tombstones.length,
      });
    }
    for (const entry of plan.targetEntries) {
      await verifyAndUnlink(context, entry);
    }
    for (const body of plan.targetBodies) {
      await verifyAndUnlink(context, body);
    }
    const finalPlan = await scanCapabilityCache(context, {
      allowWriteLock: true,
    });
    await verifyLedgerEffects(context, ledger, finalPlan);
    operationResult = {
      ledgerPath,
      removedEntryCount: plan.targetEntries.length,
      removedBodyCount: plan.targetBodies.length,
      retainedFileCount: plan.retainedCacheFiles.length,
    };
  } catch (error) {
    operationError = error;
  }
  await finishLockedOperation(context, lock, operationError);
  return operationResult;
}

export async function checkCapabilityCacheRedaction({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const context = await createPathContext(projectRoot);
  await assertTransactionArtifacts(context);
  const { ledger, fileSha256 } = await readAndValidateLedger(context);
  const replacementLedger = await readAndValidateReplacementLedger(
    context,
    ledger,
    fileSha256,
  );
  const plan = await scanCapabilityCache(context);
  const effects = await verifyLedgerEffects(
    context,
    ledger,
    plan,
    replacementLedger,
  );
  await assertTransactionArtifacts(context);
  return {
    ledgerPath: ledgerPathFor(context),
    tombstoneCount: ledger.tombstones.length,
    retainedFileCount: ledger.retainedCacheFiles.length,
    ...effects,
  };
}

function usage() {
  return [
    "用法：",
    "  node tools/redact_weibo_cli_capability_cache.mjs [--project-root <绝对路径>]",
    "  node tools/redact_weibo_cli_capability_cache.mjs --redact --write [--project-root <绝对路径>]",
    "  node tools/redact_weibo_cli_capability_cache.mjs --check [--project-root <绝对路径>]",
    "",
    "默认模式为只读 dry-run；只有 --redact 与 --write 同时出现才会写账本并删除目标。",
  ].join("\n");
}

function parseArguments(argv) {
  let projectRoot = DEFAULT_PROJECT_ROOT;
  let redact = false;
  let write = false;
  let check = false;
  let dryRun = false;
  let help = false;
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project-root") {
      if (seen.has(argument))
        fail("INVALID_ARGUMENT", "--project-root 不得重复");
      seen.add(argument);
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || !path.isAbsolute(value)) {
        fail("INVALID_ARGUMENT", "--project-root 必须跟随绝对路径");
      }
      projectRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (
      !new Set(["--redact", "--write", "--check", "--dry-run", "--help"]).has(
        argument,
      )
    ) {
      fail("INVALID_ARGUMENT", `未知参数：${argument}`);
    }
    if (seen.has(argument))
      fail("INVALID_ARGUMENT", `参数不得重复：${argument}`);
    seen.add(argument);
    if (argument === "--redact") redact = true;
    if (argument === "--write") write = true;
    if (argument === "--check") check = true;
    if (argument === "--dry-run") dryRun = true;
    if (argument === "--help") help = true;
  }
  if (help) {
    if (argv.some((argument) => argument !== "--help")) {
      fail("INVALID_ARGUMENT", "--help 不得与其他参数组合");
    }
    return { mode: "help", projectRoot };
  }
  if (check && (redact || write || dryRun)) {
    fail("INVALID_ARGUMENT", "--check 不得与写入或 dry-run 参数组合");
  }
  if (dryRun && (redact || write)) {
    fail("INVALID_ARGUMENT", "--dry-run 不得与写入参数组合");
  }
  if (redact !== write) {
    fail("INVALID_ARGUMENT", "删除必须同时显式提供 --redact 与 --write");
  }
  if (redact && write) return { mode: "write", projectRoot };
  if (check) return { mode: "check", projectRoot };
  return { mode: "dry-run", projectRoot };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.mode === "dry-run") {
    const result = await inspectCapabilityCache(options);
    process.stdout.write(
      [
        "微博 CLI 能力缓存脱敏 dry-run（只读）",
        `entry 总数：${result.entryCount}`,
        `body 总数：${result.bodyCount}`,
        `目标 entry：${result.targetEntryCount}`,
        `目标 body：${result.targetBodyCount}`,
        `保留文件：${result.retainedFileCount}`,
      ].join("\n") + "\n",
    );
    return;
  }
  if (options.mode === "write") {
    const result = await executeCapabilityCacheRedaction(options);
    process.stdout.write(
      `脱敏写入 PASS：删除 entry ${result.removedEntryCount} 个、body ${result.removedBodyCount} 个；账本已先行落盘。\n`,
    );
    return;
  }
  const result = await checkCapabilityCacheRedaction(options);
  process.stdout.write(
    `脱敏复验 PASS：${result.oldContentAbsentCount} 份墓碑旧内容未复现，${result.verifiedReplacementCount} 份已登记安全替换通过，${result.retainedFileCount} 个原保留缓存文件仍存在。\n`,
  );
}

const invokedAsMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedAsMain) {
  main().catch((error) => {
    const code =
      error instanceof CapabilityCacheRedactionError
        ? error.code
        : "UNEXPECTED_ERROR";
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = code === "INVALID_ARGUMENT" ? 2 : 1;
  });
}

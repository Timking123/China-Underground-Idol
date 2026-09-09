import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertControlledHttpsUrl,
  atomicWriteTextFile,
  readControlledFileBytes,
} from "./editorial_contract.mjs";

export const WEIBO_CANDIDATE_EVIDENCE_SCHEMA_VERSION =
  "weibo-candidate-evidence-presentation-v1";
export const MAX_SUMMARIES_PER_KIND = 3;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_POSTS_PER_SOURCE_RECORD = 20;
const MAX_IMAGE_URLS_PER_POST = 20;
const MAX_SEARCH_RECORDS = 5;

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(toolDirectory, "..");
const OUTPUT_RELATIVE_PATH = "data/微博候选证据展示层.json";

const STRICT_MASTER_PATH = "data/群体分布数据.json";
const CONFLICT_LEDGER_PATH = "sources/微博官方接口候选主档冲突_2026-09-02.json";
const PROFILE_PATHS = Object.freeze([
  "sources/微博官方接口候选_2026-09-03.json",
  "sources/微博官方接口候选_2026-09-02.json",
]);
const TRIAL_TIMELINE_PATH = "sources/微博官号博文候选_2026-09-02.json";
const TIMELINE_PATHS = Object.freeze([
  "sources/微博官号博文候选_2026-09-03.json",
  "sources/微博官号博文候选_2026-09-03_wave2.json",
  "sources/微博官号博文候选_2026-09-03_wave3.json",
  TRIAL_TIMELINE_PATH,
]);
const SEARCH_PATHS = Object.freeze([
  "sources/微博关键词搜索候选_2026-09-03.json",
  "sources/微博关键词搜索候选_2026-09-02.json",
]);

const SOURCE_PATH_PATTERN =
  /^sources\/(?:微博官方接口候选_2026-09-0[23]|微博官号博文候选_(?:2026-09-02|2026-09-03(?:_wave[23])?)|微博关键词搜索候选_2026-09-0[23]|微博官方接口候选主档冲突_2026-09-02)\.json$/u;
const STRICT_MASTER_PATH_PATTERN = /^data\/群体分布数据\.json$/u;
const OUTPUT_PATH_PATTERN = /^data\/微博候选证据展示层\.json$/u;
const LEGACY_CAPABILITY_PATH = "sources/微博官方接口状态_2026-09-02.json";
const CAPABILITY_RECEIPT_PATH_PATTERN =
  /^sources\/weibo-capabilities\/([a-f0-9]{64})\.json$/u;
const CAPABILITY_READ_PATH_PATTERN =
  /^sources\/(?:微博官方接口状态_2026-09-02|weibo-capabilities\/[a-f0-9]{64})\.json$/u;
const PROFILE_STATES = new Set([
  "candidate",
  "rejected_by_strict_master",
  "conflict",
  "not_returned",
  "not_queried",
  "query_failed",
]);
const TIMELINE_STATES = new Set([
  "candidate",
  "conflict",
  "not_returned",
  "not_queried",
  "query_failed",
]);
const SEARCH_STATES = new Set([
  "candidate",
  "conflict",
  "not_returned",
  "not_queried",
  "no_usable_candidate",
  "query_failed",
]);
const PROFILE_GATE_STATES = new Set([
  "no_candidate",
  "strict_uid_match",
  "manual_required",
  "strict_uid_conflict",
  "strict_rejected",
  "source_conflict",
]);
const TIMELINE_GATE_STATES = new Set([
  "no_candidate",
  "strict_uid_match",
  "manual_required",
  "strict_uid_conflict",
  "strict_rejected",
  "source_conflict",
]);
const SEARCH_GATE_STATES = new Set(["no_candidate", "unbound_keyword_hit"]);
const PROFILE_SUMMARY_KEYS = Object.freeze([
  "displayName",
  "uid",
  "followersValue",
  "followersDisplay",
  "bio",
  "observedAt",
  "profileUrl",
  "avatarUrl",
  "sourcePath",
]);
const POST_SUMMARY_KEYS = Object.freeze([
  "text",
  "createdAt",
  "postUrl",
  "authorName",
  "authorUid",
  "imageUrls",
  "observedAt",
  "sourcePaths",
]);
const SEARCH_SUMMARY_KEYS = Object.freeze([
  "text",
  "createdAt",
  "postUrl",
  "authorName",
  "authorUid",
  "authorProfileUrl",
  "imageUrls",
  "observedAt",
  "sourcePath",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  invariant(isPlainObject(value), `${label} 必须是对象`);
}

function assertNonEmptyString(value, label) {
  invariant(
    typeof value === "string" && value.trim() === value && value.length > 0,
    `${label} 必须是无首尾空白的非空字符串`,
  );
}

function assertNullableString(value, label) {
  invariant(
    value === null || typeof value === "string",
    `${label} 必须是字符串或 null`,
  );
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} 字段必须精确为 ${expected.join(", ")}`,
  );
}

function assertSha256(value, label) {
  invariant(/^[a-f0-9]{64}$/u.test(value ?? ""), `${label} 不是 SHA-256`);
}

function assertNumericUid(value, label) {
  invariant(/^\d{4,20}$/u.test(value ?? ""), `${label} 不是合法数字 UID`);
}

function assertTimestamp(value, label) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)),
    `${label} 不是有效时间`,
  );
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function snapshotDateFromPath(relativePath) {
  const match = relativePath.match(
    /_(\d{4}-\d{2}-\d{2})(?:_wave[23])?\.json$/u,
  );
  invariant(match, `${relativePath} 缺少快照日期`);
  return match[1];
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSnapshotSources(left, right) {
  return (
    compareStrings(right.snapshotDate, left.snapshotDate) ||
    compareStrings(left.path, right.path)
  );
}

function shortenText(value, maximum = 180) {
  if (value == null) return null;
  invariant(typeof value === "string", "候选摘要文本必须是字符串或 null");
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  const characters = [...normalized];
  return characters.length > maximum
    ? `${characters.slice(0, maximum - 1).join("")}…`
    : normalized;
}

function nullableInteger(value, label) {
  if (value == null) return null;
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    `${label} 必须是非负安全整数或 null`,
  );
  return value;
}

function normalizeTimestamp(value, label, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  assertTimestamp(value, label);
  return new Date(value).toISOString();
}

function validateUrl(value, label, { nullable = false, host } = {}) {
  if (value == null && nullable) return null;
  const parsed = assertControlledHttpsUrl(value, label);
  if (host) {
    invariant(
      parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
      `${label} 必须来自 ${host}`,
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

function validateProfileUrl(value, uid, label) {
  const normalized = validateUrl(value, label, { host: "weibo.com" });
  const parsed = new URL(normalized);
  invariant(parsed.pathname === `/u/${uid}`, `${label} 与候选 UID 不一致`);
  return normalized;
}

function validateImageUrls(values, label) {
  invariant(Array.isArray(values), `${label} 必须是数组`);
  invariant(
    values.length <= MAX_IMAGE_URLS_PER_POST,
    `${label} 超过单条微博图片上限`,
  );
  return values.map((value, index) =>
    validateUrl(value, `${label}[${index}]`, { host: "sinaimg.cn" }),
  );
}

function directSourceMeta(source) {
  return {
    path: source.path,
    sha256: source.sha256,
    snapshotDate: source.snapshotDate,
    state: source.data.state ?? null,
    schemaVersion: source.data.schemaVersion,
    capability: {
      path: source.capabilityLineage.path,
      sha256: source.capabilityLineage.sha256,
      verified: source.capabilityLineage.verified,
      reason: source.capabilityLineage.reason,
    },
  };
}

function validateCandidateSourceCapability(source) {
  const reference = source.data?.source;
  assertPlainObject(reference, `${source.path}.source`);
  assertPlainObject(
    source.capabilityLineage,
    `${source.path}.capabilityLineage`,
  );
  assertNonEmptyString(
    source.capabilityLineage.path,
    `${source.path}.capabilityLineage.path`,
  );
  assertSha256(
    source.capabilityLineage.sha256,
    `${source.path}.capabilityLineage.sha256`,
  );
  invariant(
    typeof source.capabilityLineage.verified === "boolean",
    `${source.path}.capabilityLineage.verified 必须是布尔值`,
  );
  assertNullableString(
    source.capabilityLineage.reason,
    `${source.path}.capabilityLineage.reason`,
  );
  invariant(
    reference.capabilityPath === source.capabilityLineage.path &&
      reference.capabilitySha256 === source.capabilityLineage.sha256,
    `${source.path} capability 引用与读取结果不一致`,
  );
  if (source.capabilityLineage.verified) {
    invariant(
      source.capabilityLineage.reason === null,
      `${source.path} 已验证 capability 不得保留失败原因`,
    );
  } else {
    assertNonEmptyString(
      source.capabilityLineage.reason,
      `${source.path} 未验证 capability 必须保留失败原因`,
    );
  }
}

function sourceCapabilityVerified(source) {
  validateCandidateSourceCapability(source);
  return source.capabilityLineage.verified;
}

function sourceMap(inputs) {
  const sources = [
    inputs.strictMaster,
    inputs.conflictLedger,
    ...inputs.profileSources,
    ...inputs.timelineSources,
    ...inputs.searchSources,
  ].filter(Boolean);
  const map = new Map();
  for (const source of sources) {
    invariant(!map.has(source.path), `来源路径重复：${source.path}`);
    map.set(source.path, source);
  }
  return map;
}

function assertSourceBinding(
  sourcesByPath,
  expectedPath,
  expectedSha256,
  label,
) {
  const source = sourcesByPath.get(expectedPath);
  invariant(source, `${label} 引用的来源不存在：${expectedPath}`);
  assertSha256(expectedSha256, `${label} 引用 SHA-256`);
  invariant(source.sha256 === expectedSha256, `${label} 引用 SHA-256 不匹配`);
  return source;
}

function validateStrictMaster(source, expectedTotalGroups = null) {
  invariant(source.path === STRICT_MASTER_PATH, "严格主档路径无效");
  assertSha256(source.sha256, "严格主档 SHA-256");
  const archive = source.data;
  assertPlainObject(archive, "严格主档");
  invariant(archive.schemaVersion === "1.0", "严格主档 schemaVersion 无效");
  invariant(Array.isArray(archive.groups), "严格主档 groups 必须是数组");
  if (expectedTotalGroups != null) {
    invariant(
      archive.groups.length === expectedTotalGroups,
      `严格主档必须精确包含 ${expectedTotalGroups} 团`,
    );
  }
  const ids = new Set();
  for (const [index, group] of archive.groups.entries()) {
    assertPlainObject(group, `严格主档 groups[${index}]`);
    invariant(
      /^g\d{3}$/u.test(group.id ?? ""),
      `严格主档 groups[${index}].id 无效`,
    );
    invariant(!ids.has(group.id), `严格主档团体 ID 重复：${group.id}`);
    ids.add(group.id);
    assertNonEmptyString(group.name, `${group.id}.name`);
    assertNonEmptyString(group.handle, `${group.id}.handle`);
    if (group.weiboUid != null)
      assertNumericUid(group.weiboUid, `${group.id}.weiboUid`);
    const rejections = group.rejectedIdentityCandidates ?? [];
    invariant(
      Array.isArray(rejections),
      `${group.id}.rejectedIdentityCandidates 必须是数组`,
    );
    const rejectedUids = new Set();
    for (const [rejectionIndex, rejection] of rejections.entries()) {
      assertPlainObject(
        rejection,
        `${group.id}.rejectedIdentityCandidates[${rejectionIndex}]`,
      );
      assertNumericUid(rejection.uid, `${group.id} 拒绝候选 UID`);
      invariant(
        !rejectedUids.has(rejection.uid),
        `${group.id} 拒绝候选 UID 重复：${rejection.uid}`,
      );
      rejectedUids.add(rejection.uid);
      if (rejection.profileUrl != null) {
        validateProfileUrl(
          rejection.profileUrl,
          rejection.uid,
          `${group.id} 拒绝候选 profileUrl`,
        );
      }
      if (rejection.evidenceUrl != null) {
        validateUrl(rejection.evidenceUrl, `${group.id} 拒绝候选 evidenceUrl`);
      }
    }
  }
  return archive.groups;
}

function strictAcceptedUid(group) {
  const identity = group.fieldEvidence?.profileIdentity;
  const uid = String(group.weiboUid ?? "");
  return /^\d{4,20}$/u.test(uid) &&
    group.uidConfidence === "high" &&
    identity?.state === "verified" &&
    identity?.confidence === "high" &&
    String(identity?.candidateUid ?? "") === uid
    ? uid
    : null;
}

function rejectionFor(group, candidateUid, ledgerByKey) {
  const masterRejection = (group.rejectedIdentityCandidates ?? []).find(
    (rejection) => String(rejection.uid) === candidateUid,
  );
  const ledgerRejection =
    ledgerByKey.get(`${group.id}:${candidateUid}`) ?? null;
  return masterRejection || ledgerRejection
    ? { masterRejection: masterRejection ?? null, ledgerRejection }
    : null;
}

export function classifyUidGate(group, candidateUid, ledgerByKey = new Map()) {
  const uid = String(candidateUid ?? "");
  assertNumericUid(uid, `${group.id} 候选 UID`);
  if (rejectionFor(group, uid, ledgerByKey)) return "strict_rejected";
  const acceptedUid = strictAcceptedUid(group);
  if (acceptedUid === uid) return "strict_uid_match";
  if (acceptedUid) return "strict_uid_conflict";
  return "manual_required";
}

function validateProfileCandidate(candidate, record, source) {
  assertPlainObject(candidate, `${record.id} profileCandidate`);
  assertNumericUid(candidate.uid, `${record.id} profileCandidate.uid`);
  assertNullableString(
    candidate.screenName,
    `${record.id} profileCandidate.screenName`,
  );
  assertNullableString(
    candidate.description,
    `${record.id} profileCandidate.description`,
  );
  nullableInteger(
    candidate.followersCount,
    `${record.id} profileCandidate.followersCount`,
  );
  const profileUrl = validateProfileUrl(
    candidate.profileUrl,
    candidate.uid,
    `${record.id} profileCandidate.profileUrl`,
  );
  const avatarFields = ["profileImageUrl", "avatarLarge", "avatarHd"];
  for (const field of avatarFields) {
    if (candidate[field] != null) {
      validateUrl(candidate[field], `${record.id} profileCandidate.${field}`, {
        host: "sinaimg.cn",
      });
    }
  }
  invariant(
    candidate.verified == null || typeof candidate.verified === "boolean",
    `${record.id} profileCandidate.verified 必须是布尔值或 null`,
  );
  return {
    displayName: candidate.screenName ?? null,
    uid: String(candidate.uid),
    followersValue: candidate.followersCount ?? null,
    followersDisplay:
      candidate.followersCount == null
        ? null
        : String(candidate.followersCount),
    bio: shortenText(candidate.description),
    observedAt: normalizeTimestamp(
      source.data.generatedAt,
      `${source.path}.generatedAt`,
    ),
    profileUrl,
    avatarUrl:
      (candidate.avatarHd ?? candidate.avatarLarge ?? candidate.profileImageUrl)
        ? validateUrl(
            candidate.avatarHd ??
              candidate.avatarLarge ??
              candidate.profileImageUrl,
            `${record.id} profileCandidate.avatarUrl`,
            { host: "sinaimg.cn" },
          )
        : null,
    sourcePath: source.path,
  };
}

function validateProfileSource(source, groups) {
  const candidate = source.data;
  invariant(
    candidate.schemaVersion === "weibo-official-candidates-v1",
    `${source.path} profile schemaVersion 无效`,
  );
  assertTimestamp(candidate.generatedAt, `${source.path}.generatedAt`);
  invariant(
    candidate.policy?.directMasterWrite === false,
    `${source.path} 未关闭严格主档直写`,
  );
  invariant(
    Array.isArray(candidate.records),
    `${source.path}.records 必须是数组`,
  );
  invariant(
    candidate.records.length === groups.length,
    `${source.path} 必须与严格主档形成同规模 profile 记录`,
  );
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set();
  const stateCounts = {};
  for (const [index, record] of candidate.records.entries()) {
    assertPlainObject(record, `${source.path}.records[${index}]`);
    const group = groupsById.get(record.id);
    invariant(group, `${source.path} 含未知团体 ${record.id}`);
    invariant(!seen.has(record.id), `${source.path} 团体重复：${record.id}`);
    seen.add(record.id);
    invariant(
      record.name === group.name,
      `${source.path} ${record.id} name 与主档不一致`,
    );
    invariant(
      record.handle === group.handle,
      `${source.path} ${record.id} handle 与主档不一致`,
    );
    const expectedArchiveUid =
      group.weiboUid == null ? null : String(group.weiboUid);
    invariant(
      record.archiveUid == null
        ? expectedArchiveUid === null
        : String(record.archiveUid) === expectedArchiveUid,
      `${source.path} ${record.id} archiveUid 与主档不一致`,
    );
    invariant(
      PROFILE_STATES.has(record.state),
      `${source.path} ${record.id} state 无效`,
    );
    stateCounts[record.state] = (stateCounts[record.state] ?? 0) + 1;
    const hasCandidate = ["candidate", "rejected_by_strict_master"].includes(
      record.state,
    );
    invariant(
      hasCandidate === isPlainObject(record.profileCandidate),
      `${source.path} ${record.id} profileCandidate 与 state 不一致`,
    );
    if (hasCandidate)
      validateProfileCandidate(record.profileCandidate, record, source);
    invariant(
      Array.isArray(record.conflicts),
      `${source.path} ${record.id}.conflicts 必须是数组`,
    );
    invariant(
      Array.isArray(record.identityConflicts),
      `${source.path} ${record.id}.identityConflicts 必须是数组`,
    );
    if (hasCandidate) {
      invariant(
        record.conflicts.length === 0 && record.identityConflicts.length === 0,
        `${source.path} ${record.id} candidate 状态仍含未处理冲突`,
      );
    }
    if (record.state === "conflict") {
      invariant(
        record.conflicts.length > 0 || record.identityConflicts.length > 0,
        `${source.path} ${record.id} conflict 状态缺少冲突证据`,
      );
    }
    if (record.state === "rejected_by_strict_master") {
      invariant(
        Array.isArray(record.strictMasterRejections) &&
          record.strictMasterRejections.some(
            (rejection) =>
              String(rejection?.uid ?? "") ===
              String(record.profileCandidate?.uid ?? ""),
          ),
        `${source.path} ${record.id} strict rejection 未在来源内闭合`,
      );
    }
  }
  invariant(seen.size === groups.length, `${source.path} profile ID 集不闭合`);
  for (const [state, count] of Object.entries(stateCounts)) {
    invariant(
      candidate.counts?.[state] === count,
      `${source.path} counts.${state} 与记录不一致`,
    );
  }
  return new Map(candidate.records.map((record) => [record.id, record]));
}

function profileSourceUsable(source) {
  if (!sourceCapabilityVerified(source)) return false;
  if (source.snapshotDate === "2026-09-03") {
    return source.data.state === "collected";
  }
  return ["collected", "partial_trial_bounded"].includes(source.data.state);
}

export function selectProfileSource(profileSources) {
  const ordered = [...profileSources].sort(compareSnapshotSources);
  for (const source of ordered) {
    invariant(
      source.data?.schemaVersion === "weibo-official-candidates-v1",
      `${source.path} profile schemaVersion 无效`,
    );
    assertNonEmptyString(source.data.state, `${source.path}.state`);
  }
  const selected = ordered.find(profileSourceUsable);
  invariant(selected, "没有可用的微博 profile 候选快照");
  return selected;
}

function validateConflictLedger(source, groups, sourcesByPath) {
  const ledger = source.data;
  invariant(
    ledger.schemaVersion === "weibo-official-strict-master-conflicts-v1",
    "微博候选冲突账本 schemaVersion 无效",
  );
  invariant(
    ledger.policy?.mustConsultBeforePromotion === true &&
      ledger.policy?.directMasterWrite === false &&
      ledger.policy?.automaticBinding === false &&
      ledger.policy?.conflictOverridesCandidateState === true,
    "微博候选冲突账本执行策略无效",
  );
  const archiveSource = assertSourceBinding(
    sourcesByPath,
    ledger.archivePath,
    ledger.archiveSha256,
    "微博候选冲突账本严格主档",
  );
  invariant(
    archiveSource.path === STRICT_MASTER_PATH,
    "冲突账本未绑定严格主档",
  );
  const historicalCandidate = assertSourceBinding(
    sourcesByPath,
    ledger.candidatePath,
    ledger.candidateSha256,
    "微博候选冲突账本历史候选",
  );
  invariant(
    historicalCandidate.data.schemaVersion === "weibo-official-candidates-v1",
    "冲突账本历史候选 schemaVersion 无效",
  );
  invariant(Array.isArray(ledger.records), "冲突账本 records 必须是数组");
  invariant(
    ledger.counts?.strictMasterConflicts === ledger.records.length,
    "冲突账本 counts 与记录数不一致",
  );
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const historicalById = new Map(
    historicalCandidate.data.records.map((record) => [record.id, record]),
  );
  const ledgerByKey = new Map();
  for (const [index, record] of ledger.records.entries()) {
    assertPlainObject(record, `冲突账本 records[${index}]`);
    const group = groupsById.get(record.id);
    invariant(group, `冲突账本含未知团体 ${record.id}`);
    assertNumericUid(record.uid, `冲突账本 ${record.id}.uid`);
    const key = `${record.id}:${record.uid}`;
    invariant(!ledgerByKey.has(key), `冲突账本记录重复：${key}`);
    invariant(
      record.name === group.name,
      `冲突账本 ${record.id} name 与主档不一致`,
    );
    invariant(
      record.promotionAllowed === false &&
        record.avatarBindingAllowed === false &&
        record.decision === "strict_master_rejection_takes_precedence",
      `冲突账本 ${record.id} 未失败关闭`,
    );
    invariant(
      (group.rejectedIdentityCandidates ?? []).some(
        (rejection) => String(rejection.uid) === String(record.uid),
      ),
      `冲突账本 ${key} 未在严格主档拒绝候选中闭合`,
    );
    const historicalRecord = historicalById.get(record.id);
    invariant(
      ["candidate", "rejected_by_strict_master"].includes(
        historicalRecord?.state,
      ) &&
        String(historicalRecord.profileCandidate?.uid ?? "") ===
          String(record.uid),
      `冲突账本 ${key} 未在绑定历史候选中闭合`,
    );
    ledgerByKey.set(key, record);
  }
  const derivedKeys = [];
  for (const group of groups) {
    const historicalRecord = historicalById.get(group.id);
    const uid = String(historicalRecord?.profileCandidate?.uid ?? "");
    if (
      uid &&
      (group.rejectedIdentityCandidates ?? []).some(
        (rejection) => String(rejection.uid) === uid,
      )
    ) {
      derivedKeys.push(`${group.id}:${uid}`);
    }
  }
  derivedKeys.sort(compareStrings);
  const ledgerKeys = [...ledgerByKey.keys()].sort(compareStrings);
  invariant(
    JSON.stringify(derivedKeys) === JSON.stringify(ledgerKeys),
    "冲突账本没有精确覆盖绑定历史候选与严格主档的拒绝交集",
  );
  return { ledgerByKey, historicalCandidate };
}

function validateTimelinePost(post, record, source, postIndex) {
  assertPlainObject(post, `${source.path} ${record.id}.posts[${postIndex}]`);
  const label = `${source.path} ${record.id}.posts[${postIndex}]`;
  invariant(/^\d{4,30}$/u.test(post.weiboId ?? ""), `${label}.weiboId 无效`);
  assertNumericUid(post.userUid, `${label}.userUid`);
  invariant(
    String(post.userUid) === String(record.uid),
    `${label}.userUid 未绑定记录 UID`,
  );
  assertNullableString(post.text, `${label}.text`);
  const createdAt = normalizeTimestamp(post.createdAt, `${label}.createdAt`, {
    nullable: true,
  });
  const postUrl = validateUrl(post.link, `${label}.link`, {
    host: "weibo.com",
  });
  const parsedPostUrl = new URL(postUrl);
  invariant(
    parsedPostUrl.pathname === `/detail/${post.weiboId}`,
    `${label}.link 与微博 ID 不一致`,
  );
  const imageUrls = validateImageUrls(
    post.imageUrls ?? [],
    `${label}.imageUrls`,
  );
  const observedAt = normalizeTimestamp(
    post.evidence?.observedAt ?? source.data.generatedAt,
    `${label}.observedAt`,
    { nullable: true },
  );
  return {
    weiboId: String(post.weiboId),
    text: shortenText(post.text),
    createdAt,
    postUrl,
    authorName: null,
    authorUid: String(post.userUid),
    imageUrls,
    observedAt,
    sourcePaths: [source.path],
  };
}

function validateTimelineSource(source, groups, sourcesByPath) {
  const candidate = source.data;
  const isTrial =
    candidate.schemaVersion === "weibo-official-timeline-trial-candidates-v1";
  const isFormal =
    candidate.schemaVersion === "weibo-official-timeline-candidates-v1";
  invariant(isTrial || isFormal, `${source.path} timeline schemaVersion 无效`);
  assertTimestamp(candidate.generatedAt, `${source.path}.generatedAt`);
  invariant(
    candidate.policy?.directMasterWrite === false &&
      candidate.policy?.imageDownload === false &&
      (isTrial
        ? candidate.policy?.candidateReviewOnly === true
        : candidate.policy?.candidateOnly === true),
    `${source.path} timeline 候选策略无效`,
  );
  const archiveSource = assertSourceBinding(
    sourcesByPath,
    candidate.source?.archivePath,
    candidate.source?.archiveSha256,
    `${source.path} timeline 严格主档`,
  );
  invariant(
    archiveSource.path === STRICT_MASTER_PATH,
    `${source.path} 未绑定严格主档`,
  );
  if (candidate.source?.priorTimelinePath != null) {
    assertSourceBinding(
      sourcesByPath,
      candidate.source.priorTimelinePath,
      candidate.source.priorTimelineSha256,
      `${source.path} timeline 历史快照`,
    );
  }
  invariant(
    Array.isArray(candidate.records),
    `${source.path}.records 必须是数组`,
  );
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set();
  const projected = new Map();
  for (const [index, record] of candidate.records.entries()) {
    assertPlainObject(record, `${source.path}.records[${index}]`);
    const group = groupsById.get(record.id);
    invariant(group, `${source.path} 含未知团体 ${record.id}`);
    invariant(!seen.has(record.id), `${source.path} 团体重复：${record.id}`);
    seen.add(record.id);
    invariant(
      record.name === group.name,
      `${source.path} ${record.id} name 与主档不一致`,
    );
    invariant(
      record.handle === group.handle,
      `${source.path} ${record.id} handle 与主档不一致`,
    );
    assertNumericUid(record.uid, `${source.path} ${record.id}.uid`);
    invariant(
      TIMELINE_STATES.has(record.state),
      `${source.path} ${record.id} state 无效`,
    );
    invariant(
      Array.isArray(record.posts),
      `${source.path} ${record.id}.posts 必须是数组`,
    );
    invariant(
      record.posts.length <= MAX_POSTS_PER_SOURCE_RECORD,
      `${source.path} ${record.id}.posts 超过来源契约上限`,
    );
    invariant(
      record.posts.length === 0 || record.state === "candidate",
      `${source.path} ${record.id} 非 candidate 记录不得含 posts`,
    );
    projected.set(record.id, {
      record,
      posts: record.posts.map((post, postIndex) =>
        validateTimelinePost(post, record, source, postIndex),
      ),
      source,
    });
  }
  return projected;
}

function timelineCombinedState(records) {
  if (!records.length) return "not_collected";
  const states = new Set(records.map(({ record }) => record.state));
  if (states.has("conflict")) return "conflict";
  if (states.has("candidate")) return "candidate";
  if (states.has("query_failed")) return "query_failed";
  if (states.has("not_returned")) return "not_returned";
  return "not_queried";
}

function gatePrecedence(value) {
  return {
    strict_rejected: 5,
    source_conflict: 4,
    strict_uid_conflict: 3,
    manual_required: 2,
    strict_uid_match: 1,
    no_candidate: 0,
  }[value];
}

function timelineGate(group, records, ledgerByKey) {
  const candidateRecords = records.filter(({ record }) =>
    ["candidate", "conflict"].includes(record.state),
  );
  if (!candidateRecords.length) return "no_candidate";
  if (candidateRecords.some(({ record }) => record.state === "conflict")) {
    return "source_conflict";
  }
  const uids = new Set(
    candidateRecords.map(({ record }) => String(record.uid)),
  );
  if (uids.size > 1) return "strict_uid_conflict";
  return candidateRecords
    .map(({ record }) =>
      classifyUidGate(group, String(record.uid), ledgerByKey),
    )
    .sort((left, right) => gatePrecedence(right) - gatePrecedence(left))[0];
}

function postConflictKey(post) {
  return JSON.stringify({
    text: post.text,
    createdAt: post.createdAt,
    postUrl: post.postUrl,
    authorName: post.authorName,
    authorUid: post.authorUid,
    imageUrls: post.imageUrls,
  });
}

function mergeTimelinePosts(records, gateState) {
  if (gateState !== "strict_uid_match") {
    return { summaries: [], candidatePosts: 0, duplicatesRemoved: 0 };
  }
  const postsById = new Map();
  let duplicatesRemoved = 0;
  for (const { posts } of records) {
    for (const post of posts) {
      const existing = postsById.get(post.weiboId);
      if (!existing) {
        postsById.set(post.weiboId, structuredClone(post));
        continue;
      }
      invariant(
        postConflictKey(existing) === postConflictKey(post),
        `时间线微博 ${post.weiboId} 在跨快照来源中内容冲突`,
      );
      duplicatesRemoved += 1;
      existing.sourcePaths = [
        ...new Set([...existing.sourcePaths, ...post.sourcePaths]),
      ];
      if (
        post.observedAt &&
        (!existing.observedAt ||
          Date.parse(post.observedAt) > Date.parse(existing.observedAt))
      ) {
        existing.observedAt = post.observedAt;
      }
    }
  }
  const posts = [...postsById.values()].sort(
    (left, right) =>
      (Date.parse(right.createdAt ?? "") || 0) -
        (Date.parse(left.createdAt ?? "") || 0) ||
      compareStrings(right.weiboId, left.weiboId),
  );
  return {
    summaries: posts.slice(0, MAX_SUMMARIES_PER_KIND).map((post) => {
      const summary = withoutWeiboId(post);
      return {
        ...summary,
        imageUrls: summary.imageUrls.slice(0, MAX_SUMMARIES_PER_KIND),
      };
    }),
    candidatePosts: posts.length,
    duplicatesRemoved,
  };
}

function searchSourceUsable(source) {
  if (!sourceCapabilityVerified(source)) return false;
  if (source.snapshotDate === "2026-09-03") {
    return source.data.state === "collected";
  }
  return ["collected", "partial_trial_bounded"].includes(source.data.state);
}

export function selectSearchSource(searchSources) {
  const ordered = [...searchSources].sort(compareSnapshotSources);
  for (const source of ordered) {
    invariant(
      source.data?.schemaVersion === "weibo-official-search-candidates-v1",
      `${source.path} search schemaVersion 无效`,
    );
    assertNonEmptyString(source.data.state, `${source.path}.state`);
  }
  const selected = ordered.find(searchSourceUsable);
  invariant(selected, "没有可用的微博关键词搜索候选快照");
  return selected;
}

function validateSearchPost(post, record, source, postIndex) {
  assertPlainObject(post, `${source.path} ${record.id}.posts[${postIndex}]`);
  const label = `${source.path} ${record.id}.posts[${postIndex}]`;
  invariant(/^\d{4,30}$/u.test(post.weiboId ?? ""), `${label}.weiboId 无效`);
  assertNullableString(post.text, `${label}.text`);
  assertPlainObject(post.author, `${label}.author`);
  assertNumericUid(post.author.uid, `${label}.author.uid`);
  assertNullableString(post.author.name, `${label}.author.name`);
  const authorProfileUrl = validateProfileUrl(
    post.author.profileUrl,
    post.author.uid,
    `${label}.author.profileUrl`,
  );
  const postUrl = validateUrl(post.postUrl, `${label}.postUrl`, {
    host: "weibo.com",
  });
  const parsedPostUrl = new URL(postUrl);
  invariant(
    parsedPostUrl.pathname === `/detail/${post.weiboId}`,
    `${label}.postUrl 与微博 ID 不一致`,
  );
  const imageUrls = validateImageUrls(
    post.imageUrls ?? [],
    `${label}.imageUrls`,
  );
  return {
    weiboId: String(post.weiboId),
    text: shortenText(post.text),
    createdAt: normalizeTimestamp(post.createdAt, `${label}.createdAt`, {
      nullable: true,
    }),
    postUrl,
    authorName: post.author.name ?? null,
    authorUid: String(post.author.uid),
    authorProfileUrl,
    imageUrls: imageUrls.slice(0, MAX_SUMMARIES_PER_KIND),
    observedAt: normalizeTimestamp(
      post.evidence?.observedAt ?? source.data.generatedAt,
      `${label}.observedAt`,
      { nullable: true },
    ),
    sourcePath: source.path,
  };
}

function validateSearchSource(source, groups, sourcesByPath) {
  const candidate = source.data;
  invariant(
    candidate.schemaVersion === "weibo-official-search-candidates-v1",
    `${source.path} search schemaVersion 无效`,
  );
  assertTimestamp(candidate.generatedAt, `${source.path}.generatedAt`);
  invariant(
    candidate.policy?.directMasterWrite === false &&
      candidate.policy?.candidateOnly === true &&
      candidate.policy?.identityAccepted === false &&
      candidate.policy?.imageDownload === false,
    `${source.path} search 候选策略无效`,
  );
  const archiveSource = assertSourceBinding(
    sourcesByPath,
    candidate.source?.archivePath,
    candidate.source?.archiveSha256,
    `${source.path} search 严格主档`,
  );
  invariant(
    archiveSource.path === STRICT_MASTER_PATH,
    `${source.path} 未绑定严格主档`,
  );
  const boundProfile = assertSourceBinding(
    sourcesByPath,
    candidate.source?.profileCandidatePath,
    candidate.source?.profileCandidateSha256,
    `${source.path} search 历史 profile 输入`,
  );
  invariant(
    boundProfile.data.schemaVersion === "weibo-official-candidates-v1",
    `${source.path} 绑定 profile schemaVersion 无效`,
  );
  invariant(
    Array.isArray(candidate.records),
    `${source.path}.records 必须是数组`,
  );
  invariant(
    candidate.records.length <= MAX_SEARCH_RECORDS,
    `${source.path}.records 超过搜索计划上限`,
  );
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set();
  const projected = new Map();
  for (const [index, record] of candidate.records.entries()) {
    assertPlainObject(record, `${source.path}.records[${index}]`);
    const group = groupsById.get(record.id);
    invariant(group, `${source.path} 含未知团体 ${record.id}`);
    invariant(!seen.has(record.id), `${source.path} 团体重复：${record.id}`);
    seen.add(record.id);
    invariant(
      record.name === group.name,
      `${source.path} ${record.id} name 与主档不一致`,
    );
    invariant(
      record.query === group.name,
      `${source.path} ${record.id} query 与主档团名不一致`,
    );
    invariant(
      SEARCH_STATES.has(record.state),
      `${source.path} ${record.id} state 无效`,
    );
    invariant(
      Array.isArray(record.posts),
      `${source.path} ${record.id}.posts 必须是数组`,
    );
    invariant(
      record.posts.length <= MAX_POSTS_PER_SOURCE_RECORD,
      `${source.path} ${record.id}.posts 超过来源契约上限`,
    );
    invariant(
      record.posts.length === 0 || record.state === "candidate",
      `${source.path} ${record.id} 非 candidate 记录不得含 posts`,
    );
    const postIds = new Set();
    const posts = record.posts.map((post, postIndex) => {
      const projectedPost = validateSearchPost(post, record, source, postIndex);
      invariant(
        !postIds.has(projectedPost.weiboId),
        `${source.path} ${record.id} 搜索微博重复：${projectedPost.weiboId}`,
      );
      postIds.add(projectedPost.weiboId);
      return projectedPost;
    });
    projected.set(record.id, { record, posts });
  }
  return { recordsById: projected, boundProfile };
}

function comparePosts(left, right) {
  return (
    (Date.parse(right.createdAt ?? "") || 0) -
      (Date.parse(left.createdAt ?? "") || 0) ||
    compareStrings(right.weiboId, left.weiboId)
  );
}

function withoutWeiboId(post) {
  const summary = { ...post };
  delete summary.weiboId;
  return summary;
}

function profileEvidence(group, record, source, ledgerByKey) {
  if (!record) {
    return {
      sourceState: "not_collected",
      gateState: "no_candidate",
      identityAccepted: false,
      canonicalImpact: "none",
      summaries: [],
    };
  }
  if (record.state === "conflict") {
    return {
      sourceState: record.state,
      gateState: "source_conflict",
      identityAccepted: false,
      canonicalImpact: "none",
      summaries: [],
    };
  }
  if (!isPlainObject(record.profileCandidate)) {
    return {
      sourceState: record.state,
      gateState: "no_candidate",
      identityAccepted: false,
      canonicalImpact: "none",
      summaries: [],
    };
  }
  return {
    sourceState: record.state,
    gateState: classifyUidGate(
      group,
      String(record.profileCandidate.uid),
      ledgerByKey,
    ),
    identityAccepted: false,
    canonicalImpact: "none",
    summaries: [
      validateProfileCandidate(record.profileCandidate, record, source),
    ],
  };
}

function timelineEvidence(group, records, ledgerByKey) {
  const gateState = timelineGate(group, records, ledgerByKey);
  const merged = mergeTimelinePosts(records, gateState);
  return {
    evidence: {
      sourceState: timelineCombinedState(records),
      gateState,
      identityAccepted: false,
      canonicalImpact: "none",
      summaries: merged.summaries,
    },
    candidatePosts: merged.candidatePosts,
    duplicatesRemoved: merged.duplicatesRemoved,
  };
}

function searchEvidence(record) {
  const posts = record?.posts ?? [];
  return {
    sourceState: record?.record.state ?? "not_collected",
    gateState: posts.length ? "unbound_keyword_hit" : "no_candidate",
    identityAccepted: false,
    authorBindingAllowed: false,
    canonicalImpact: "none",
    summaries: [...posts]
      .sort(comparePosts)
      .slice(0, MAX_SUMMARIES_PER_KIND)
      .map(withoutWeiboId),
  };
}

function countByGate(records, kind) {
  const counts = {};
  for (const record of records) {
    const gate = record.candidateEvidence[kind].gateState;
    counts[gate] = (counts[gate] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      compareStrings(left, right),
    ),
  );
}

function sourceConsideration(source, usable, selected) {
  return {
    ...directSourceMeta(source),
    usable,
    selected,
  };
}

function latestGeneratedAt(sources) {
  const timestamps = sources.map((source) => {
    assertTimestamp(source.data.generatedAt, `${source.path}.generatedAt`);
    return new Date(source.data.generatedAt).toISOString();
  });
  return timestamps.sort(compareStrings).at(-1);
}

export function buildWeiboCandidateEvidence(inputs, options = {}) {
  const groups = validateStrictMaster(
    inputs.strictMaster,
    options.expectedTotalGroups ?? null,
  );
  const sourcesByPath = sourceMap(inputs);
  for (const source of [
    ...inputs.profileSources,
    ...inputs.timelineSources,
    ...inputs.searchSources,
  ]) {
    validateCandidateSourceCapability(source);
  }
  const { ledgerByKey, historicalCandidate } = validateConflictLedger(
    inputs.conflictLedger,
    groups,
    sourcesByPath,
  );

  const selectedProfile = selectProfileSource(inputs.profileSources);
  const profileById = validateProfileSource(selectedProfile, groups);

  const timelineSources = [...inputs.timelineSources]
    .filter(sourceCapabilityVerified)
    .sort(compareSnapshotSources);
  invariant(
    timelineSources.some((source) => source.path === TRIAL_TIMELINE_PATH),
    "缺少必需的 2026-09-02 timeline trial 快照",
  );
  const timelineMaps = timelineSources.map((source) => ({
    source,
    recordsById: validateTimelineSource(source, groups, sourcesByPath),
  }));
  const timelinePostOwners = new Map();
  for (const { source, recordsById } of timelineMaps) {
    for (const [groupId, record] of recordsById) {
      for (const post of record.posts) {
        const priorOwner = timelinePostOwners.get(post.weiboId);
        invariant(
          !priorOwner || priorOwner.groupId === groupId,
          `时间线微博 ${post.weiboId} 跨团冲突：${priorOwner?.groupId} / ${groupId}`,
        );
        if (!priorOwner) {
          timelinePostOwners.set(post.weiboId, {
            groupId,
            sourcePath: source.path,
          });
        }
      }
    }
  }

  const selectedSearch = selectSearchSource(inputs.searchSources);
  const validatedSearch = validateSearchSource(
    selectedSearch,
    groups,
    sourcesByPath,
  );

  let timelineCandidatePosts = 0;
  let timelineDuplicatesRemoved = 0;
  const records = groups.map((group) => {
    const timelineRecords = timelineMaps
      .map(({ recordsById }) => recordsById.get(group.id))
      .filter(Boolean);
    const timeline = timelineEvidence(group, timelineRecords, ledgerByKey);
    timelineCandidatePosts += timeline.candidatePosts;
    timelineDuplicatesRemoved += timeline.duplicatesRemoved;
    return {
      id: group.id,
      name: group.name,
      handle: group.handle,
      candidateEvidence: {
        profile: profileEvidence(
          group,
          profileById.get(group.id),
          selectedProfile,
          ledgerByKey,
        ),
        timeline: timeline.evidence,
        search: searchEvidence(validatedSearch.recordsById.get(group.id)),
      },
    };
  });

  const profileFallbackUsed = selectedProfile.snapshotDate !== "2026-09-03";
  const searchFallbackUsed = selectedSearch.snapshotDate !== "2026-09-03";
  const missingOptionalTimelinePaths = TIMELINE_PATHS.filter(
    (relativePath) =>
      !timelineSources.some((source) => source.path === relativePath),
  );
  const profileSummaries = records.reduce(
    (total, record) =>
      total + record.candidateEvidence.profile.summaries.length,
    0,
  );
  const timelineSummaries = records.reduce(
    (total, record) =>
      total + record.candidateEvidence.timeline.summaries.length,
    0,
  );
  const searchCandidatePosts = [...validatedSearch.recordsById.values()].reduce(
    (total, record) => total + record.posts.length,
    0,
  );
  const searchSummaries = records.reduce(
    (total, record) => total + record.candidateEvidence.search.summaries.length,
    0,
  );

  const projection = {
    schemaVersion: WEIBO_CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    generatedAt: latestGeneratedAt([
      inputs.conflictLedger,
      selectedProfile,
      ...timelineSources,
      selectedSearch,
    ]),
    sources: {
      strictMaster: {
        path: inputs.strictMaster.path,
        sha256: inputs.strictMaster.sha256,
      },
      conflictLedger: {
        path: inputs.conflictLedger.path,
        sha256: inputs.conflictLedger.sha256,
        snapshotDate: inputs.conflictLedger.snapshotDate,
        lineage: {
          archivePath: inputs.conflictLedger.data.archivePath,
          archiveSha256: inputs.conflictLedger.data.archiveSha256,
          candidatePath: historicalCandidate.path,
          candidateSha256: historicalCandidate.sha256,
        },
      },
      profile: {
        selected: directSourceMeta(selectedProfile),
        considered: [...inputs.profileSources]
          .sort(compareSnapshotSources)
          .map((source) =>
            sourceConsideration(
              source,
              profileSourceUsable(source),
              source.path === selectedProfile.path,
            ),
          ),
        lineage: {
          selectionRule:
            "2026-09-03 仅在 state=collected 时使用，否则回退 2026-09-02 可用 partial/collected 快照",
          fallbackUsed: profileFallbackUsed,
        },
      },
      timeline: {
        selected: timelineSources.map(directSourceMeta),
        considered: [...inputs.timelineSources]
          .sort(compareSnapshotSources)
          .map((source) =>
            sourceConsideration(
              source,
              sourceCapabilityVerified(source),
              timelineSources.some((selected) => selected.path === source.path),
            ),
          ),
        missingOptionalPaths: missingOptionalTimelinePaths,
        lineage: {
          mergeRule:
            "合并 2026-09-03 formal 三波（若存在）与 2026-09-02 trial",
          deduplicationKey: "weiboId",
          conflictRule: "同一 weiboId 的关键内容不一致时失败关闭",
          precedence: TIMELINE_PATHS,
        },
      },
      search: {
        selected: directSourceMeta(selectedSearch),
        considered: [...inputs.searchSources]
          .sort(compareSnapshotSources)
          .map((source) =>
            sourceConsideration(
              source,
              searchSourceUsable(source),
              source.path === selectedSearch.path,
            ),
          ),
        lineage: {
          selectionRule:
            "优先 2026-09-03 state=collected，否则回退 2026-09-02 可用 partial/collected 快照",
          fallbackUsed: searchFallbackUsed,
          boundProfilePath: validatedSearch.boundProfile.path,
          boundProfileSha256: validatedSearch.boundProfile.sha256,
        },
      },
    },
    coverage: {
      totalGroups: groups.length,
      profile: {
        sourceRecords: selectedProfile.data.records.length,
        presentedSummaries: profileSummaries,
        gateStates: countByGate(records, "profile"),
      },
      timeline: {
        sourceFiles: timelineSources.length,
        sourceRecords: timelineSources.reduce(
          (total, source) => total + source.data.records.length,
          0,
        ),
        candidatePosts: timelineCandidatePosts,
        presentedSummaries: timelineSummaries,
        duplicatesRemoved: timelineDuplicatesRemoved,
        gateStates: countByGate(records, "timeline"),
      },
      search: {
        sourceRecords: selectedSearch.data.records.length,
        candidatePosts: searchCandidatePosts,
        presentedSummaries: searchSummaries,
        gateStates: countByGate(records, "search"),
      },
    },
    policy: {
      candidateOnly: true,
      canonicalImpact: "none",
      directMasterWrite: false,
      identityAccepted: false,
      searchAuthorIdentityAccepted: false,
      maximumSummariesPerKind: MAX_SUMMARIES_PER_KIND,
      strictUidRule:
        "仅严格主档 verified/high、uidConfidence=high 且 evidence candidateUid 与 weiboUid 完全一致时标记 strict_uid_match",
      conflictRule:
        "严格主档拒绝候选与冲突账本优先于候选状态；搜索作者永不成为团体身份",
      generatedAtRule:
        "取所有实际选用来源 generatedAt 的最大值，不使用构建时钟",
    },
    records,
  };
  validateWeiboCandidateEvidence(projection, {
    expectedIds: groups.map((group) => group.id),
  });
  return projection;
}

function validateSourceMeta(value, label, allowedPaths) {
  assertExactKeys(
    value,
    ["path", "sha256", "snapshotDate", "state", "schemaVersion", "capability"],
    label,
  );
  assertNonEmptyString(value.path, `${label}.path`);
  invariant(allowedPaths.includes(value.path), `${label}.path 不在允许范围`);
  assertSha256(value.sha256, `${label}.sha256`);
  assertNonEmptyString(value.snapshotDate, `${label}.snapshotDate`);
  assertNullableString(value.state, `${label}.state`);
  assertNonEmptyString(value.schemaVersion, `${label}.schemaVersion`);
  assertExactKeys(
    value.capability,
    ["path", "sha256", "verified", "reason"],
    `${label}.capability`,
  );
  assertNonEmptyString(value.capability.path, `${label}.capability.path`);
  assertSha256(value.capability.sha256, `${label}.capability.sha256`);
  invariant(
    value.capability.verified === true && value.capability.reason === null,
    `${label}.capability 必须是已验证且无失败原因的来源`,
  );
  const receiptMatch = value.capability.path.match(
    CAPABILITY_RECEIPT_PATH_PATTERN,
  );
  invariant(
    value.capability.path === LEGACY_CAPABILITY_PATH ||
      receiptMatch?.[1] === value.capability.sha256,
    `${label}.capability 路径未绑定 SHA-256`,
  );
}

function validateCommonEvidence(value, label, gateStates) {
  assertPlainObject(value, label);
  assertNonEmptyString(value.sourceState, `${label}.sourceState`);
  invariant(gateStates.has(value.gateState), `${label}.gateState 无效`);
  invariant(
    value.identityAccepted === false,
    `${label}.identityAccepted 必须为 false`,
  );
  invariant(
    value.canonicalImpact === "none",
    `${label}.canonicalImpact 必须为 none`,
  );
  invariant(Array.isArray(value.summaries), `${label}.summaries 必须是数组`);
  invariant(
    value.summaries.length <= MAX_SUMMARIES_PER_KIND,
    `${label}.summaries 超过上限`,
  );
}

function validateNullableSummaryString(value, label) {
  invariant(
    value === null || typeof value === "string",
    `${label} 必须是字符串或 null`,
  );
}

function validateProfileSummary(summary, label) {
  assertExactKeys(summary, PROFILE_SUMMARY_KEYS, label);
  validateNullableSummaryString(summary.displayName, `${label}.displayName`);
  assertNumericUid(summary.uid, `${label}.uid`);
  nullableInteger(summary.followersValue, `${label}.followersValue`);
  validateNullableSummaryString(
    summary.followersDisplay,
    `${label}.followersDisplay`,
  );
  validateNullableSummaryString(summary.bio, `${label}.bio`);
  normalizeTimestamp(summary.observedAt, `${label}.observedAt`, {
    nullable: true,
  });
  validateProfileUrl(summary.profileUrl, summary.uid, `${label}.profileUrl`);
  if (summary.avatarUrl != null) {
    validateUrl(summary.avatarUrl, `${label}.avatarUrl`, {
      host: "sinaimg.cn",
    });
  }
  invariant(
    PROFILE_PATHS.includes(summary.sourcePath),
    `${label}.sourcePath 无效`,
  );
}

function validatePostSummary(summary, label) {
  assertExactKeys(summary, POST_SUMMARY_KEYS, label);
  validateNullableSummaryString(summary.text, `${label}.text`);
  normalizeTimestamp(summary.createdAt, `${label}.createdAt`, {
    nullable: true,
  });
  validateUrl(summary.postUrl, `${label}.postUrl`, { host: "weibo.com" });
  validateNullableSummaryString(summary.authorName, `${label}.authorName`);
  assertNumericUid(summary.authorUid, `${label}.authorUid`);
  validateImageUrls(summary.imageUrls, `${label}.imageUrls`);
  normalizeTimestamp(summary.observedAt, `${label}.observedAt`, {
    nullable: true,
  });
  invariant(
    Array.isArray(summary.sourcePaths) &&
      summary.sourcePaths.length > 0 &&
      summary.sourcePaths.every((relativePath) =>
        TIMELINE_PATHS.includes(relativePath),
      ),
    `${label}.sourcePaths 无效`,
  );
}

function validateSearchSummary(summary, label) {
  assertExactKeys(summary, SEARCH_SUMMARY_KEYS, label);
  validateNullableSummaryString(summary.text, `${label}.text`);
  normalizeTimestamp(summary.createdAt, `${label}.createdAt`, {
    nullable: true,
  });
  validateUrl(summary.postUrl, `${label}.postUrl`, { host: "weibo.com" });
  validateNullableSummaryString(summary.authorName, `${label}.authorName`);
  assertNumericUid(summary.authorUid, `${label}.authorUid`);
  validateProfileUrl(
    summary.authorProfileUrl,
    summary.authorUid,
    `${label}.authorProfileUrl`,
  );
  validateImageUrls(summary.imageUrls, `${label}.imageUrls`);
  normalizeTimestamp(summary.observedAt, `${label}.observedAt`, {
    nullable: true,
  });
  invariant(
    SEARCH_PATHS.includes(summary.sourcePath),
    `${label}.sourcePath 无效`,
  );
}

function assertNoCoordinateFields(value, label) {
  const forbidden = new Set([
    "x",
    "y",
    "coordinates",
    "position",
    "region",
    "styleScore",
    "styleBand",
    "followersDisplayCanonical",
  ]);
  const visit = (entry, currentLabel) => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${currentLabel}[${index}]`));
      return;
    }
    if (!isPlainObject(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      invariant(!forbidden.has(key), `${currentLabel} 禁止出现字段 ${key}`);
      visit(child, `${currentLabel}.${key}`);
    }
  };
  visit(value, label);
}

export function validateWeiboCandidateEvidence(value, options = {}) {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "generatedAt",
      "sources",
      "coverage",
      "policy",
      "records",
    ],
    "微博候选证据展示层",
  );
  invariant(
    value.schemaVersion === WEIBO_CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    "微博候选证据展示层 schemaVersion 无效",
  );
  assertTimestamp(value.generatedAt, "微博候选证据展示层 generatedAt");
  invariant(
    value.policy?.candidateOnly === true &&
      value.policy?.canonicalImpact === "none" &&
      value.policy?.directMasterWrite === false &&
      value.policy?.identityAccepted === false &&
      value.policy?.searchAuthorIdentityAccepted === false &&
      value.policy?.maximumSummariesPerKind === MAX_SUMMARIES_PER_KIND,
    "微博候选证据展示层 policy 未失败关闭",
  );
  assertPlainObject(value.sources, "微博候选证据展示层 sources");
  assertExactKeys(
    value.sources,
    ["strictMaster", "conflictLedger", "profile", "timeline", "search"],
    "微博候选证据展示层 sources",
  );
  assertExactKeys(
    value.sources.strictMaster,
    ["path", "sha256"],
    "sources.strictMaster",
  );
  invariant(
    value.sources.strictMaster.path === STRICT_MASTER_PATH,
    "严格主档来源路径无效",
  );
  assertSha256(value.sources.strictMaster.sha256, "严格主档来源 SHA-256");
  validateSourceMeta(
    value.sources.profile.selected,
    "sources.profile.selected",
    PROFILE_PATHS,
  );
  validateSourceMeta(
    value.sources.search.selected,
    "sources.search.selected",
    SEARCH_PATHS,
  );
  invariant(
    Array.isArray(value.sources.timeline.selected),
    "sources.timeline.selected 必须是数组",
  );
  value.sources.timeline.selected.forEach((source, index) =>
    validateSourceMeta(
      source,
      `sources.timeline.selected[${index}]`,
      TIMELINE_PATHS,
    ),
  );
  invariant(
    Array.isArray(value.records),
    "微博候选证据展示层 records 必须是数组",
  );
  invariant(
    value.coverage?.totalGroups === value.records.length,
    "coverage.totalGroups 与 records 不一致",
  );
  if (options.expectedIds) {
    invariant(
      JSON.stringify(value.records.map((record) => record.id)) ===
        JSON.stringify(options.expectedIds),
      "微博候选证据展示层记录顺序或 ID 集与严格主档不一致",
    );
  }
  const seen = new Set();
  for (const [index, record] of value.records.entries()) {
    assertExactKeys(
      record,
      ["id", "name", "handle", "candidateEvidence"],
      `records[${index}]`,
    );
    invariant(/^g\d{3}$/u.test(record.id ?? ""), `records[${index}].id 无效`);
    invariant(!seen.has(record.id), `展示层团体 ID 重复：${record.id}`);
    seen.add(record.id);
    assertNonEmptyString(record.name, `${record.id}.name`);
    assertNonEmptyString(record.handle, `${record.id}.handle`);
    assertExactKeys(
      record.candidateEvidence,
      ["profile", "timeline", "search"],
      `${record.id}.candidateEvidence`,
    );
    const { profile, timeline, search } = record.candidateEvidence;
    assertExactKeys(
      profile,
      [
        "sourceState",
        "gateState",
        "identityAccepted",
        "canonicalImpact",
        "summaries",
      ],
      `${record.id}.candidateEvidence.profile`,
    );
    validateCommonEvidence(
      profile,
      `${record.id}.candidateEvidence.profile`,
      PROFILE_GATE_STATES,
    );
    profile.summaries.forEach((summary, summaryIndex) =>
      validateProfileSummary(
        summary,
        `${record.id}.candidateEvidence.profile.summaries[${summaryIndex}]`,
      ),
    );
    assertExactKeys(
      timeline,
      [
        "sourceState",
        "gateState",
        "identityAccepted",
        "canonicalImpact",
        "summaries",
      ],
      `${record.id}.candidateEvidence.timeline`,
    );
    validateCommonEvidence(
      timeline,
      `${record.id}.candidateEvidence.timeline`,
      TIMELINE_GATE_STATES,
    );
    timeline.summaries.forEach((summary, summaryIndex) =>
      validatePostSummary(
        summary,
        `${record.id}.candidateEvidence.timeline.summaries[${summaryIndex}]`,
      ),
    );
    invariant(
      timeline.summaries.length === 0 ||
        timeline.gateState === "strict_uid_match",
      `${record.id} timeline 摘要未通过严格 UID 门`,
    );
    assertExactKeys(
      search,
      [
        "sourceState",
        "gateState",
        "identityAccepted",
        "authorBindingAllowed",
        "canonicalImpact",
        "summaries",
      ],
      `${record.id}.candidateEvidence.search`,
    );
    validateCommonEvidence(
      search,
      `${record.id}.candidateEvidence.search`,
      SEARCH_GATE_STATES,
    );
    invariant(
      search.authorBindingAllowed === false,
      `${record.id} search 作者绑定必须关闭`,
    );
    search.summaries.forEach((summary, summaryIndex) =>
      validateSearchSummary(
        summary,
        `${record.id}.candidateEvidence.search.summaries[${summaryIndex}]`,
      ),
    );
    invariant(
      search.summaries.length === 0 ||
        search.gateState === "unbound_keyword_hit",
      `${record.id} search 摘要状态无效`,
    );
  }
  assertNoCoordinateFields(value.records, "records");
  return value;
}

export function parseArguments(argumentsList) {
  invariant(Array.isArray(argumentsList), "参数必须是数组");
  const allowed = new Set(["--check"]);
  invariant(
    argumentsList.every((argument) => allowed.has(argument)),
    `未知参数：${argumentsList.find((argument) => !allowed.has(argument))}`,
  );
  invariant(
    new Set(argumentsList).size === argumentsList.length,
    "参数不得重复",
  );
  return { checkOnly: argumentsList.includes("--check") };
}

function parseSource(relativePath, bytes) {
  let data;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${relativePath} 不是有效 UTF-8 JSON：${error.message}`);
  }
  assertPlainObject(data, relativePath);
  return {
    path: relativePath,
    sha256: sha256Bytes(bytes),
    snapshotDate:
      relativePath === STRICT_MASTER_PATH
        ? null
        : snapshotDateFromPath(relativePath),
    data,
  };
}

async function readSource(
  archiveRoot,
  relativePath,
  { optional = false } = {},
) {
  const pattern =
    relativePath === STRICT_MASTER_PATH
      ? STRICT_MASTER_PATH_PATTERN
      : SOURCE_PATH_PATTERN;
  try {
    const bytes = await readControlledFileBytes(
      archiveRoot,
      relativePath,
      pattern,
      relativePath,
    );
    invariant(
      bytes.length <= MAX_SOURCE_BYTES,
      `${relativePath} 超过来源文件大小上限`,
    );
    return parseSource(relativePath, bytes);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
}

function capabilityLineage(source, verified, reason = null) {
  return {
    ...source,
    capabilityLineage: {
      path: source.data.source.capabilityPath,
      sha256: source.data.source.capabilitySha256,
      verified,
      reason,
    },
  };
}

async function attachCapabilityLineage(archiveRoot, source) {
  if (!source) return null;
  const reference = source.data?.source;
  assertPlainObject(reference, `${source.path}.source`);
  assertNonEmptyString(
    reference.capabilityPath,
    `${source.path}.source.capabilityPath`,
  );
  assertSha256(
    reference.capabilitySha256,
    `${source.path}.source.capabilitySha256`,
  );
  const receiptMatch = reference.capabilityPath.match(
    CAPABILITY_RECEIPT_PATH_PATTERN,
  );
  if (
    reference.capabilityPath !== LEGACY_CAPABILITY_PATH &&
    receiptMatch?.[1] !== reference.capabilitySha256
  ) {
    return capabilityLineage(source, false, "unsupported_or_unbound_path");
  }

  let bytes;
  try {
    bytes = await readControlledFileBytes(
      archiveRoot,
      reference.capabilityPath,
      CAPABILITY_READ_PATH_PATTERN,
      `${source.path} capability`,
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return capabilityLineage(source, false, "capability_missing");
    }
    throw error;
  }
  if (bytes.length > MAX_SOURCE_BYTES) {
    return capabilityLineage(source, false, "capability_too_large");
  }
  if (sha256Bytes(bytes) !== reference.capabilitySha256) {
    return capabilityLineage(source, false, "capability_sha_mismatch");
  }

  let capability;
  try {
    capability = JSON.parse(bytes.toString("utf8"));
  } catch {
    return capabilityLineage(source, false, "capability_invalid_json");
  }
  if (
    !isPlainObject(capability) ||
    capability.schemaVersion !== "weibo-official-capability-v1" ||
    capability.ready !== true
  ) {
    return capabilityLineage(source, false, "capability_not_ready");
  }
  return capabilityLineage(source, true);
}

export async function readProjectionInputs(archiveRoot = rootDirectory) {
  const [
    strictMaster,
    conflictLedger,
    profile20260903,
    profile20260902,
    timeline20260903,
    timeline20260903Wave2,
    timeline20260903Wave3,
    timeline20260902,
    search20260903,
    search20260902,
  ] = await Promise.all([
    readSource(archiveRoot, STRICT_MASTER_PATH),
    readSource(archiveRoot, CONFLICT_LEDGER_PATH),
    readSource(archiveRoot, PROFILE_PATHS[0], { optional: true }),
    readSource(archiveRoot, PROFILE_PATHS[1]),
    readSource(archiveRoot, TIMELINE_PATHS[0], { optional: true }),
    readSource(archiveRoot, TIMELINE_PATHS[1], { optional: true }),
    readSource(archiveRoot, TIMELINE_PATHS[2], { optional: true }),
    readSource(archiveRoot, TIMELINE_PATHS[3]),
    readSource(archiveRoot, SEARCH_PATHS[0], { optional: true }),
    readSource(archiveRoot, SEARCH_PATHS[1]),
  ]);
  const [profileSources, timelineSources, searchSources] = await Promise.all([
    Promise.all(
      [profile20260903, profile20260902]
        .filter(Boolean)
        .map((source) => attachCapabilityLineage(archiveRoot, source)),
    ),
    Promise.all(
      [
        timeline20260903,
        timeline20260903Wave2,
        timeline20260903Wave3,
        timeline20260902,
      ]
        .filter(Boolean)
        .map((source) => attachCapabilityLineage(archiveRoot, source)),
    ),
    Promise.all(
      [search20260903, search20260902]
        .filter(Boolean)
        .map((source) => attachCapabilityLineage(archiveRoot, source)),
    ),
  ]);
  return {
    strictMaster,
    conflictLedger,
    profileSources,
    timelineSources,
    searchSources,
  };
}

export async function main(
  argumentsList = process.argv.slice(2),
  dependencies = {},
) {
  const options = parseArguments(argumentsList);
  const archiveRoot = dependencies.rootDirectory ?? rootDirectory;
  const inputs =
    dependencies.inputs ?? (await readProjectionInputs(archiveRoot));
  const projection = buildWeiboCandidateEvidence(inputs, {
    expectedTotalGroups: dependencies.expectedTotalGroups ?? 399,
  });
  const text = stableJson(projection);
  const targetPath =
    dependencies.outputPath ??
    path.join(archiveRoot, ...OUTPUT_RELATIVE_PATH.split("/"));
  if (options.checkOnly) {
    const existing = await readControlledFileBytes(
      archiveRoot,
      OUTPUT_RELATIVE_PATH,
      OUTPUT_PATH_PATTERN,
      "微博候选证据展示层",
    );
    invariant(
      Buffer.from(text, "utf8").equals(existing),
      "微博候选证据展示层与当前严格来源不一致，请先运行构建器",
    );
  } else {
    await atomicWriteTextFile(
      archiveRoot,
      targetPath,
      text,
      "微博候选证据展示层",
    );
  }
  const summary = {
    checked: options.checkOnly,
    wrote: !options.checkOnly,
    records: projection.records.length,
    selectedProfile: projection.sources.profile.selected.path,
    selectedTimeline: projection.sources.timeline.selected.map(
      (source) => source.path,
    ),
    selectedSearch: projection.sources.search.selected.path,
    coverage: projection.coverage,
  };
  (dependencies.logger ?? console.log)(stableJson(summary).trimEnd());
  return { projection, text, ...summary };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main();

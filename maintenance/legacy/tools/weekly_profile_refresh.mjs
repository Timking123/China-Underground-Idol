import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  CLI_VERSION,
  classifyCliFailure,
  createCliEnvironment,
  profileBatchArguments,
  projectCliSuccessPayload,
  resolveCliEntrypoint,
} from "./collect_weibo_official.mjs";
import { classifyUidGate } from "./build_weibo_candidate_evidence.mjs";
import { validateReconciliationProof } from "./weekly_reconciliation.mjs";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const executeFile = promisify(execFile);
const MASTER = "data/群体分布数据.json";
const CONFLICTS = "sources/微博官方接口候选主档冲突_2026-09-02.json";
const STORE = "sources/weekly-profile-refresh";
const LIMITS = Object.freeze({
  batchSize: 50,
  batches: 6,
  accounts: 300,
  intervalMs: 2000,
  reserve: 4000,
});
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/u;
const uidPattern = /^\d{4,20}$/u;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireCondition(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

// 周一零点换周，计算全程使用固定 UTC+8，不受宿主时区影响。
export function utc8WeekId(value = new Date()) {
  const date = new Date(new Date(value).getTime() + 8 * 3600_000);
  requireCondition(Number.isFinite(date.getTime()), "invalid_clock");
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return `week-${date.toISOString().slice(0, 10)}`;
}

function sensitive(value) {
  const pattern =
    /\b(?:(?:access|refresh)[_-]?)?token\s*["'=:\s]|authorization\s*["':=\s]|\bbearer\s+[a-z0-9._~-]{8,}|\bwb_[a-z0-9_-]{20,}\b|\b(?:at|rt)_[a-z0-9_-]+\b|\b(?:cookie|set[-_]?cookie|password|client[_-]?secret)["']?\s*[:=]/iu;
  const pending = [value];
  const seen = new Set();
  // 序列化会转义 TAB/LF/CR。逐层解析 JSON，仅扫描解码后的键和文本，不执行业务解析。
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (seen.has(current)) continue;
      seen.add(current);
      if (pattern.test(current.replace(/\\+"/gu, '"'))) return true;
      if (!["{", "[", '"'].includes(current.trimStart()[0])) continue;
      try {
        pending.push(JSON.parse(current));
      } catch {
        // 非 JSON 自由文本已经直接检查；不猜测或改写其编码。
      }
    } else if (current && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        if (pattern.test(`${key}:`)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}

export function buildWeeklyPlan({
  groups,
  conflictRecords = [],
  sourceSha256,
  now = new Date(),
}) {
  requireCondition(
    Array.isArray(groups) && Array.isArray(conflictRecords),
    "invalid_master",
  );
  requireCondition(hashPattern.test(sourceSha256), "invalid_source_hash");
  const rejected = new Map(
    conflictRecords.map((record) => [`${record.id}:${record.uid}`, record]),
  );
  const ids = new Set();
  const byUid = new Map();
  const review = [];
  const blockers = [];
  for (const group of groups) {
    requireCondition(
      /^g\d+$/u.test(group.id) && !ids.has(group.id),
      "duplicate_or_invalid_group_id",
    );
    ids.add(group.id);
    const uid = String(group.weiboUid ?? "");
    const reason = ["g060", "g360"].includes(group.id)
      ? "project_account_manual_only"
      : !uidPattern.test(uid)
        ? "strict_uid_missing"
        : classifyUidGate(group, uid, rejected);
    if (reason !== "strict_uid_match") {
      review.push({ id: group.id, reason });
      continue;
    }
    const value = {
      id: group.id,
      uid,
      previous: {
        followersValue: group.followersValue ?? null,
        followersDisplay: group.followersDisplay ?? null,
        followersApproximate: group.followersApproximate ?? null,
        followersObservedAt:
          group.fieldEvidence?.followers?.observedAt ??
          group.profileObservedAt ??
          null,
      },
    };
    const matches = byUid.get(uid) ?? [];
    matches.push(value);
    byUid.set(uid, matches);
  }
  const selected = [];
  for (const matches of byUid.values()) {
    if (matches.length > 1) {
      blockers.push("duplicate_strict_uid");
      review.push(
        ...matches.map(({ id, uid }) => ({
          id,
          uid,
          reason: "duplicate_strict_uid",
        })),
      );
    } else selected.push(matches[0]);
  }
  selected.sort((a, b) => a.uid.localeCompare(b.uid, "en"));
  const batches = [];
  for (let offset = 0; offset < selected.length; offset += LIMITS.batchSize) {
    const records = selected.slice(offset, offset + LIMITS.batchSize);
    const values = records.map(({ uid }) => uid);
    batches.push({
      key: digest(encode(values)),
      values,
      groupIds: records.map(({ id }) => id),
    });
  }
  if (selected.length > LIMITS.accounts || batches.length > LIMITS.batches)
    blockers.push("plan_exceeds_limits");
  return {
    schemaVersion: "weekly-profile-plan-v1",
    weekId: utc8WeekId(now),
    sourceSha256,
    limits: LIMITS,
    selected,
    batches,
    review,
    blockers: [...new Set(blockers)],
    summary: {
      groups: groups.length,
      eligible: selected.length,
      uniqueUids: selected.length,
      profileBatches: batches.length,
    },
    budget: {
      enabled: false,
      requiredCredits: null,
      reason: "需要本轮能力探针核验单价与余额",
    },
  };
}

export async function readWeeklyInputs(archiveRoot = rootDirectory) {
  const [masterBytes, conflictBytes] = await Promise.all([
    fs.readFile(path.join(archiveRoot, MASTER)),
    fs.readFile(path.join(archiveRoot, CONFLICTS)),
  ]);
  const master = JSON.parse(masterBytes.toString("utf8"));
  const conflicts = JSON.parse(conflictBytes.toString("utf8"));
  requireCondition(
    conflicts.schemaVersion === "weibo-official-strict-master-conflicts-v1" &&
      Array.isArray(conflicts.records),
    "invalid_conflict_ledger",
  );
  return {
    groups: master.groups,
    conflictRecords: conflicts.records,
    sourceSha256: digest(
      Buffer.concat([masterBytes, Buffer.from("\0"), conflictBytes]),
    ),
  };
}

// 路径固定在新周更目录；拒绝链接，避免历史目录或公开目录被间接覆盖。
async function controlledDirectory(archiveRoot, relative, create = false) {
  let current = path.resolve(archiveRoot);
  requireCondition(
    (await fs.lstat(current)).isDirectory() &&
      (await fs.realpath(current)).toLowerCase() === current.toLowerCase(),
    "unsafe_archive_root",
  );
  for (const segment of relative.split("/")) {
    requireCondition(
      segment && segment !== "." && segment !== ".." && !segment.includes("\\"),
      "unsafe_path",
    );
    current = path.join(current, segment);
    if (create)
      await fs.mkdir(current).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    try {
      const stat = await fs.lstat(current);
      requireCondition(
        stat.isDirectory() && !stat.isSymbolicLink(),
        "unsafe_snapshot_directory",
      );
    } catch (error) {
      if (!create && error.code === "ENOENT") return null;
      throw error;
    }
  }
  return current;
}

async function readBytes(directory, name) {
  const target = path.join(directory, name);
  try {
    const stat = await fs.lstat(target);
    requireCondition(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 40 * 1024 * 1024,
      "unsafe_snapshot_file",
    );
    return await fs.readFile(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(directory, name) {
  const bytes = await readBytes(directory, name);
  return bytes ? JSON.parse(bytes.toString("utf8")) : null;
}

// wx 与 fsync 保证尝试先持久化。文件只新增，不覆盖、删除或清除尝试记录。
async function immutable(directory, name, value) {
  const bytes = Buffer.from(encode(value));
  requireCondition(
    !sensitive(bytes.toString("utf8")),
    "sensitive_output_refused",
  );
  const existing = await readBytes(directory, name);
  if (existing) {
    requireCondition(existing.equals(bytes), "immutable_snapshot_conflict");
    return digest(bytes);
  }
  const file = await fs.open(path.join(directory, name), "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  return digest(bytes);
}

function rawPayload(raw) {
  requireCondition(
    raw &&
      raw.cliVersion === CLI_VERSION &&
      typeof raw.stdout === "string" &&
      typeof raw.stderr === "string",
    "invalid_cli_response",
  );
  requireCondition(!raw.timedOut && !raw.signal, "request_outcome_uncertain");
  if (raw.exitCode !== 0)
    throw Object.assign(new Error("cli_failed"), {
      code: classifyCliFailure(`${raw.stderr}\n${raw.stdout}`).code,
    });
  requireCondition(raw.stderr.trim() === "", "unexpected_cli_stderr");
  let payload;
  try {
    payload = JSON.parse(raw.stdout);
  } catch {
    throw Object.assign(new Error("invalid_json_response"), {
      code: "invalid_json_response",
    });
  }
  requireCondition(
    payload &&
      payload.success !== false &&
      payload.ok !== false &&
      !payload.error &&
      !payload.error_code,
    "business_error_response",
  );
  return payload;
}

function extractProfiles(payload, expectedUids) {
  const profiles = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if ("followers_count" in value) {
      profiles.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  requireCondition(
    profiles.length === expectedUids.length,
    "missing_or_extra_profiles",
  );
  const seen = new Set();
  return profiles.map((profile) => {
    const uidValues = [profile.idstr, profile.uid, profile.id].filter(
      (value) => value != null,
    );
    requireCondition(
      uidValues.every(
        (value) => typeof value === "string" || Number.isSafeInteger(value),
      ),
      "unsafe_numeric_uid",
    );
    const uid = String(uidValues[0] ?? "");
    requireCondition(
      uidPattern.test(uid) &&
        uidValues.every((value) => String(value) === uid) &&
        expectedUids.includes(uid) &&
        !seen.has(uid),
      "profile_uid_mismatch_or_duplicate",
    );
    seen.add(uid);
    requireCondition(
      typeof profile.followers_count === "number" &&
        Number.isSafeInteger(profile.followers_count) &&
        profile.followers_count >= 0,
      "invalid_followers_field",
    );
    return { uid, followersValue: profile.followers_count };
  });
}

async function loadSuccess(directory, batch, plan) {
  const receipt = await readJson(directory, `${batch.key}.receipt.json`);
  if (!receipt) return null;
  requireCondition(
    receipt.outcome === "success",
    "previous_attempt_requires_reconciliation",
  );
  requireCondition(
    receipt.weekId === plan.weekId && receipt.requestKey === batch.key,
    "receipt_identity_mismatch",
  );
  const attemptBytes = await readBytes(directory, `${batch.key}.attempt.json`);
  const responseBytes = await readBytes(
    directory,
    `${batch.key}.response.json`,
  );
  requireCondition(
    attemptBytes &&
      digest(attemptBytes) === receipt.attemptSha256 &&
      responseBytes &&
      digest(responseBytes) === receipt.responseSha256,
    "receipt_hash_mismatch",
  );
  const attempt = JSON.parse(attemptBytes.toString("utf8"));
  requireCondition(
    attempt.planSha256 === digest(encode(plan)) &&
      encode(attempt.uids) === encode(batch.values),
    "attempt_identity_mismatch",
  );
  requireCondition(
    utc8WeekId(receipt.observedAt) === plan.weekId,
    "observation_week_mismatch",
  );
  return {
    receipt,
    profiles: extractProfiles(
      rawPayload(JSON.parse(responseBytes.toString("utf8"))),
      batch.values,
    ),
  };
}

// 人工核账只关闭旧尝试，不补造业务成功、不授予同周重试权限。
async function validateReconciliation(directory, proof, now = new Date()) {
  validateReconciliationProof(proof, path.basename(directory), new Date(now));
  requireCondition(!sensitive(encode(proof)), "sensitive_output_refused");
  const attemptBytes = await readBytes(
    directory,
    `${proof.requestKey}.attempt.json`,
  );
  const responseBytes = await readBytes(
    directory,
    `${proof.requestKey}.response.json`,
  );
  const receiptBytes = await readBytes(
    directory,
    `${proof.requestKey}.receipt.json`,
  );
  requireCondition(
    attemptBytes &&
      digest(attemptBytes) === proof.attemptSha256 &&
      (responseBytes ? digest(responseBytes) : null) === proof.responseSha256 &&
      (receiptBytes ? digest(receiptBytes) : null) === proof.receiptSha256,
    "reconciliation_hash_mismatch",
  );
  const attempt = JSON.parse(attemptBytes.toString("utf8"));
  const plan = await readJson(directory, "plan.json");
  const batch = plan?.batches?.find(({ key }) => key === proof.requestKey);
  requireCondition(
    attempt.schemaVersion === "weekly-profile-attempt-v1" &&
      attempt.weekId === proof.weekId &&
      attempt.requestKey === proof.requestKey &&
      attempt.accountScope === proof.accountScope &&
      attempt.planSha256 === digest(encode(plan)) &&
      batch &&
      encode(batch.values) === encode(attempt.uids),
    "reconciliation_attempt_mismatch",
  );
  requireCondition(
    !receiptBytes ||
      JSON.parse(receiptBytes.toString("utf8")).outcome !== "success",
    "successful_attempt_does_not_need_recovery",
  );
  requireCondition(
    Date.parse(proof.evidence.checkedAt) >= Date.parse(attempt.startedAt),
    "explicit_provider_reconciliation_required",
  );
  return proof;
}

async function loadReconciliation(directory, requestKey) {
  const proof = await readJson(directory, `${requestKey}.reconciliation.json`);
  requireCondition(
    !proof || proof.requestKey === requestKey,
    "reconciliation_request_mismatch",
  );
  return proof ? validateReconciliation(directory, proof) : null;
}

export async function appendWeeklyReconciliation({
  archiveRoot = rootDirectory,
  proof,
}) {
  requireCondition(
    /^week-\d{4}-\d{2}-\d{2}$/u.test(proof?.weekId),
    "invalid_week_id",
  );
  const directory = await controlledDirectory(
    archiveRoot,
    `${STORE}/${proof.weekId}`,
  );
  requireCondition(directory, "reconciliation_attempt_missing");
  const store = await controlledDirectory(archiveRoot, STORE);
  const lockPath = path.join(store, "maintenance.lock");
  const lock = await fs.open(lockPath, "wx", 0o600);
  try {
    await inspectLegacyLocks(archiveRoot);
    await validateReconciliation(directory, proof);
    const sha256 = await immutable(
      directory,
      `${proof.requestKey}.reconciliation.json`,
      proof,
    );
    return {
      status: "reconciled",
      weekId: proof.weekId,
      requestKey: proof.requestKey,
      sha256,
      sameWeekRetryAllowed: false,
      businessAttempts: 0,
    };
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

async function inspectPlan(directory, plan) {
  const hits = new Map();
  if (!directory) return hits;
  const savedPlan = await readJson(directory, "plan.json");
  if (savedPlan)
    requireCondition(encode(savedPlan) === encode(plan), "weekly_plan_changed");
  for (const batch of plan.batches) {
    requireCondition(
      !(await loadReconciliation(directory, batch.key)),
      "reconciled_week_closed_without_retry",
    );
    const cached = await loadSuccess(directory, batch, plan);
    if (cached) hits.set(batch.key, cached);
    else
      requireCondition(
        !(await readBytes(directory, `${batch.key}.attempt.json`)),
        "previous_attempt_requires_reconciliation",
      );
  }
  return hits;
}

// 旧入口使用周内锁；新入口必须在持有全局锁后检查全部周次，不能跨周绕过。
async function inspectLegacyLocks(archiveRoot) {
  const store = await controlledDirectory(archiveRoot, STORE);
  if (!store) return;
  for (const week of await fs.readdir(store)) {
    if (week === "maintenance.lock") continue;
    requireCondition(
      /^week-\d{4}-\d{2}-\d{2}$/u.test(week),
      "unexpected_week_directory",
    );
    const directory = await controlledDirectory(
      archiveRoot,
      `${STORE}/${week}`,
    );
    requireCondition(
      !(await readBytes(directory, "run.lock")),
      "weekly_run_locked",
    );
  }
}

async function inspectEarlierAttempts(archiveRoot, currentWeek) {
  await inspectLegacyLocks(archiveRoot);
  const store = await controlledDirectory(archiveRoot, STORE);
  if (!store) return;
  for (const week of await fs.readdir(store)) {
    if (week === "maintenance.lock") continue;
    if (week === currentWeek) continue;
    requireCondition(
      /^week-\d{4}-\d{2}-\d{2}$/u.test(week),
      "unexpected_week_directory",
    );
    const directory = await controlledDirectory(
      archiveRoot,
      `${STORE}/${week}`,
    );
    const names = await fs.readdir(directory);
    const savedPlan = await readJson(directory, "plan.json");
    requireCondition(
      !savedPlan ||
        (savedPlan.schemaVersion === "weekly-profile-plan-v1" &&
          savedPlan.weekId === week &&
          Array.isArray(savedPlan.batches)),
      "invalid_earlier_plan",
    );
    const plannedKeys = new Set(
      (savedPlan?.batches ?? []).map(({ key }) => key),
    );
    requireCondition(
      [...plannedKeys].every((key) => hashPattern.test(key)),
      "invalid_earlier_plan",
    );
    const recordKeys = new Set();
    for (const name of names) {
      if (!/\.(?:attempt|response|receipt|reconciliation)\.json$/u.test(name))
        continue;
      requireCondition(
        /^[a-f0-9]{64}\.(?:attempt|response|receipt|reconciliation)\.json$/u.test(
          name,
        ),
        "invalid_earlier_record_name",
      );
      recordKeys.add(name.slice(0, 64));
    }
    const snapshotBytes = await readBytes(directory, "snapshot.json");
    requireCondition(
      !snapshotBytes || savedPlan,
      "earlier_snapshot_plan_missing",
    );
    // 计划和全部残留产物取并集，避免 attempt 丢失时整条请求从审计中消失。
    for (const key of new Set([...plannedKeys, ...recordKeys])) {
      if (!recordKeys.has(key) && !snapshotBytes) continue;
      requireCondition(
        await readBytes(directory, `${key}.attempt.json`),
        "earlier_attempt_missing",
      );
      if (await loadReconciliation(directory, key)) continue;
      const batch = savedPlan?.batches?.find((item) => item.key === key);
      requireCondition(
        batch &&
          (await readJson(directory, `${key}.receipt.json`))?.outcome ===
            "success",
        "earlier_attempt_requires_reconciliation",
      );
      await loadSuccess(directory, batch, savedPlan);
    }
  }
}

function candidatesFrom(plan, batch, success) {
  return success.profiles.map(({ uid, followersValue }) => {
    const selected = plan.selected.find((record) => record.uid === uid);
    const previous = selected.previous.followersValue;
    // 至少 1000 且相对变化超过 50% 才进入跳变复核，零基数使用 1 作分母。
    const jump =
      Number.isSafeInteger(previous) &&
      Math.abs(followersValue - previous) >= 1000 &&
      Math.abs(followersValue - previous) / Math.max(previous, 1) > 0.5;
    return {
      id: selected.id,
      uid,
      followersValue,
      followersDisplay: String(followersValue),
      followersApproximate: false,
      followersObservedAt: success.receipt.observedAt,
      sourceUrl: `https://weibo.com/u/${uid}`,
      reviewReason: jump ? "followers_jump" : null,
      evidence: {
        requestKey: batch.key,
        responsePath: `${STORE}/${plan.weekId}/${batch.key}.response.json`,
        responseSha256: success.receipt.responseSha256,
      },
    };
  });
}

// 适配器仅调用固定版本 CLI；stdout/stderr 是 CLI 实际暴露的正文，不声称保留未暴露的上游 HTTP。
export function createWeeklyCliAdapter({ runner } = {}) {
  const execute =
    runner ??
    (async (args) => {
      const cli = await resolveCliEntrypoint();
      try {
        const result = await executeFile(
          process.execPath,
          [cli.entrypoint, ...args],
          {
            encoding: "utf8",
            windowsHide: true,
            timeout: 90_000,
            maxBuffer: 16 * 1024 * 1024,
            env: createCliEnvironment(),
          },
        );
        return {
          ...result,
          cliVersion: cli.version,
          exitCode: 0,
          timedOut: false,
          signal: null,
        };
      } catch (error) {
        return {
          stdout: String(error.stdout ?? ""),
          stderr: String(error.stderr ?? ""),
          cliVersion: cli.version,
          exitCode: Number.isInteger(error.code) ? error.code : 1,
          timedOut: Boolean(error.killed),
          signal: error.signal ?? null,
        };
      }
    });
  return {
    queryProfiles: ({ uids }) =>
      execute(profileBatchArguments({ kind: "uids", values: uids })),
    async probe({ persist, now }) {
      const read = async (key, args, identity = false) => {
        const raw = await execute(args);
        let payload;
        if (identity) {
          // 身份管理响应只保留既有白名单投影，原始身份及凭据不归档。
          try {
            payload = rawPayload(raw);
          } catch (error) {
            await persist(key, {
              outcome: "blocked",
              code: error.code ?? "management_probe_failed",
            });
            throw error;
          }
          payload = projectCliSuccessPayload(args, payload);
          await persist(key, {
            observedAt: now(),
            command: args,
            projection: payload,
          });
        } else {
          await persist(key, raw);
          payload = rawPayload(raw);
        }
        return payload;
      };
      const doctor = await read("doctor", ["doctor", "--output", "json"], true);
      requireCondition(
        doctor.ready &&
          doctor.steps.login &&
          doctor.steps.developer_verification &&
          doctor.steps.service,
        "account_not_ready",
      );
      const me = await read("me", ["me", "--output", "json"], true);
      requireCondition(
        /^[a-f0-9]{16}$/u.test(doctor.accountScopeHash) &&
          doctor.accountScopeHash === me.accountScopeHash,
        "account_scope_mismatch",
      );
      const metadata = await read("profile-command", [
        "commands",
        "show",
        "users",
        "show_batch/other",
        "--output",
        "json",
      ]);
      const command = metadata.command ?? metadata;
      requireCondition(
        command.group === "users" &&
          command.action === "show_batch/other" &&
          command.access !== "locked" &&
          command.flags?.some((flag) => flag.name === "uids"),
        "profile_command_unavailable",
      );
      // CLI 0.9.1 实际命令缓存没有计价字段；合成字段不能建立供应方合同。
      // 待供应方提供可验证的当前接口单价来源后，再实现独立合同解析。
      requireCondition(
        doctor.service_status?.kind === "formal_active" &&
          me.service_status?.kind === "formal_active",
        "formal_service_required",
      );
      requireCondition(false, "current_returned_item_price_unavailable");
    },
  };
}

export async function runWeeklyRefresh({
  archiveRoot = rootDirectory,
  groups,
  conflictRecords = [],
  sourceSha256,
  live = false,
  budgetCredits = 0,
  adapter = null,
  clock = () => new Date(),
  wait = sleep,
}) {
  const now = () => new Date(clock()).toISOString();
  const plan = buildWeeklyPlan({
    groups,
    conflictRecords,
    sourceSha256,
    now: now(),
  });
  let directory = await controlledDirectory(
    archiveRoot,
    `${STORE}/${plan.weekId}`,
  );
  let hits;
  try {
    await inspectEarlierAttempts(archiveRoot, plan.weekId);
    hits = await inspectPlan(directory, plan);
  } catch (error) {
    return {
      status: "blocked",
      blocker: error.code ?? "invalid_snapshot",
      plan,
    };
  }
  const pending = plan.batches.filter((batch) => !hits.has(batch.key));
  const summary = {
    ...plan.summary,
    cachedBatches: hits.size,
    newProfileBatches: pending.length,
    maximumNewProfiles: pending.reduce(
      (sum, batch) => sum + batch.values.length,
      0,
    ),
  };
  if (!live) return { status: "planned", plan, summary };
  if (plan.blockers.length)
    return { status: "blocked", blocker: plan.blockers[0], plan, summary };
  if (
    pending.length &&
    (!adapter ||
      !(
        budgetCredits === "auto" ||
        (typeof budgetCredits === "number" &&
          Number.isFinite(budgetCredits) &&
          budgetCredits > 0)
      ))
  ) {
    return {
      status: "blocked",
      blocker: !adapter ? "live_adapter_required" : "explicit_budget_required",
      plan,
      summary,
    };
  }
  directory = await controlledDirectory(
    archiveRoot,
    `${STORE}/${plan.weekId}`,
    true,
  );
  let lock;
  const store = await controlledDirectory(archiveRoot, STORE);
  const lockPath = path.join(store, "maintenance.lock");
  try {
    lock = await fs.open(lockPath, "wx", 0o600);
  } catch {
    return { status: "blocked", blocker: "weekly_run_locked", plan, summary };
  }
  let managementProbes = 0;
  let businessAttempts = 0;
  try {
    await lock.writeFile(encode({ startedAt: now(), pid: process.pid }));
    await lock.sync();
    await inspectEarlierAttempts(archiveRoot, plan.weekId);
    hits = await inspectPlan(directory, plan);
    await immutable(directory, "plan.json", plan);
    const completed = await readJson(directory, "snapshot.json");
    if (completed) {
      requireCondition(
        completed.sourceSha256 === plan.sourceSha256 &&
          completed.complete === true &&
          hits.size === plan.batches.length,
        "invalid_completed_snapshot",
      );
      const observations = plan.batches.flatMap((batch) =>
        candidatesFrom(plan, batch, hits.get(batch.key)),
      );
      requireCondition(
        encode(completed.candidates) ===
          encode(observations.filter((record) => !record.reviewReason)) &&
          encode(completed.review) ===
            encode([
              ...plan.review,
              ...observations.filter((record) => record.reviewReason),
            ]) &&
          encode(completed.diff) ===
            encode(
              observations.map((record) => ({
                id: record.id,
                uid: record.uid,
                previous: plan.selected.find(({ id }) => id === record.id)
                  .previous,
                next: record,
                reviewRequired: Boolean(record.reviewReason),
              })),
            ) &&
          completed.policy?.automaticIdentityBinding === false &&
          completed.policy?.automaticPublishing === false,
        "completed_snapshot_content_mismatch",
      );
      return { status: "complete", reused: true, snapshot: completed, summary };
    }
    let capability;
    let capabilityReceipt;
    let ceiling = 0;
    if (pending.length) {
      const probeStartedAt = now();
      const probeKey = `${Date.parse(probeStartedAt)}-${crypto.randomUUID()}`;
      const managementEvidence = [];
      capability = await adapter.probe({
        now,
        persist: async (key, value) => {
          requireCondition(/^[a-z-]+$/u.test(key), "invalid_probe_key");
          managementProbes += 1;
          requireCondition(managementProbes <= 3, "management_probe_limit");
          const name = `probe-${probeKey}-${key}.json`;
          const sha256 = await immutable(directory, name, value);
          managementEvidence.push({ path: name, sha256 });
          return sha256;
        },
      });
      requireCondition(
        capability.available === true &&
          capability.serviceKind === "formal_active" &&
          /^[a-f0-9]{16}$/u.test(capability.accountScope),
        "invalid_capability",
      );
      requireCondition(
        Date.parse(capability.observedAt) >= Date.parse(probeStartedAt) &&
          Date.parse(capability.observedAt) <= Date.parse(now()),
        "stale_capability",
      );
      requireCondition(
        capability.billingUnit === "returned_item" &&
          typeof capability.unitCost === "number" &&
          Number.isFinite(capability.unitCost) &&
          capability.unitCost > 0 &&
          typeof capability.balance === "number" &&
          Number.isFinite(capability.balance),
        "current_cost_or_balance_unknown",
      );
      ceiling = summary.maximumNewProfiles * capability.unitCost;
      const budget = budgetCredits === "auto" ? ceiling : budgetCredits;
      requireCondition(
        ceiling <= budget && capability.balance - ceiling >= LIMITS.reserve,
        "budget_or_reserve_exceeded",
      );
      const scope = await readJson(directory, "account.json");
      if (scope)
        requireCondition(
          scope.accountScope === capability.accountScope,
          "weekly_account_changed",
        );
      else
        await immutable(directory, "account.json", {
          accountScope: capability.accountScope,
        });
      const guardPath = `probe-${probeKey}-guard.json`;
      const guardSha256 = await immutable(directory, guardPath, {
        ...capability,
        managementEvidence,
        budgetCredits: budget,
        requiredCredits: ceiling,
        reserve: LIMITS.reserve,
      });
      capabilityReceipt = { path: guardPath, sha256: guardSha256 };
    }
    let lastRequestAt = null;
    for (const batch of pending) {
      if (lastRequestAt != null)
        await wait(
          Math.max(0, LIMITS.intervalMs - (Date.parse(now()) - lastRequestAt)),
        );
      requireCondition(
        utc8WeekId(now()) === plan.weekId,
        "week_changed_during_run",
      );
      requireCondition(
        businessAttempts < LIMITS.batches,
        "business_batch_limit",
      );
      const startedAt = now();
      const attempt = {
        schemaVersion: "weekly-profile-attempt-v1",
        weekId: plan.weekId,
        requestKey: batch.key,
        planSha256: digest(encode(plan)),
        accountScope: capability.accountScope,
        startedAt,
        uids: batch.values,
        command: profileBatchArguments({ kind: "uids", values: batch.values }),
        maximumCredits: batch.values.length * capability.unitCost,
        capabilityReceipt,
        settlement: "pending_reconciliation",
      };
      const attemptSha256 = await immutable(
        directory,
        `${batch.key}.attempt.json`,
        attempt,
      );
      businessAttempts += 1;
      lastRequestAt = Date.parse(startedAt);
      let raw;
      try {
        raw = await adapter.queryProfiles({ uids: [...batch.values] });
      } catch {
        raw = {
          cliVersion: CLI_VERSION,
          stdout: "",
          stderr: "",
          exitCode: 1,
          timedOut: true,
          signal: null,
        };
      }
      const observedAt = now();
      // 所有实际收到的非敏感完整 CLI 输出先落盘，再从落盘字节解析业务字段。
      let responseSha256 = null;
      let profiles;
      let failure = null;
      try {
        responseSha256 = await immutable(
          directory,
          `${batch.key}.response.json`,
          raw ?? null,
        );
        const bytes = await readBytes(directory, `${batch.key}.response.json`);
        requireCondition(
          digest(bytes) === responseSha256,
          "response_hash_mismatch",
        );
        profiles = extractProfiles(
          rawPayload(JSON.parse(bytes.toString("utf8"))),
          batch.values,
        );
        requireCondition(
          utc8WeekId(observedAt) === plan.weekId,
          "week_changed_during_response",
        );
      } catch (error) {
        failure = error.code ?? "response_validation_failed";
      }
      const receipt = {
        schemaVersion: "weekly-profile-receipt-v1",
        weekId: plan.weekId,
        requestKey: batch.key,
        attemptSha256,
        responseSha256,
        observedAt,
        outcome: failure ? "blocked" : "success",
        blocker: failure,
        settlement: failure
          ? "uncertain_requires_reconciliation"
          : "response_received_not_financially_reconciled",
      };
      await immutable(directory, `${batch.key}.receipt.json`, receipt);
      requireCondition(!failure, failure);
      hits.set(batch.key, { receipt, profiles });
    }
    const observations = plan.batches.flatMap((batch) =>
      candidatesFrom(plan, batch, hits.get(batch.key)),
    );
    const candidates = observations.filter((record) => !record.reviewReason);
    const review = [
      ...plan.review,
      ...observations.filter((record) => record.reviewReason),
    ];
    const diff = observations.map((record) => ({
      id: record.id,
      uid: record.uid,
      previous: plan.selected.find(({ id }) => id === record.id).previous,
      next: record,
      reviewRequired: Boolean(record.reviewReason),
    }));
    const snapshot = {
      schemaVersion: "weekly-profile-snapshot-v1",
      weekId: plan.weekId,
      sourceSha256: plan.sourceSha256,
      complete: true,
      completedAt: now(),
      candidates,
      review,
      diff,
      policy: {
        automaticIdentityBinding: false,
        automaticPublishing: false,
        allowedFields: [
          "followersValue",
          "followersDisplay",
          "followersApproximate",
          "followersObservedAt",
          "sourceUrl",
          "evidence",
        ],
      },
    };
    await immutable(directory, "snapshot.json", snapshot);
    return {
      status: "complete",
      snapshot,
      summary,
      managementProbes,
      businessAttempts,
      maximumCredits: ceiling,
    };
  } catch (error) {
    return {
      status: "blocked",
      blocker: error.code ?? "weekly_refresh_failed",
      plan,
      summary,
      managementProbes,
      businessAttempts,
    };
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0].startsWith("--reconcile=")) {
    const inputPath = path.resolve(args[0].slice("--reconcile=".length));
    const bytes = await readBytes(
      path.dirname(inputPath),
      path.basename(inputPath),
    );
    requireCondition(
      bytes && !sensitive(bytes.toString("utf8")),
      "invalid_reconciliation_input",
    );
    const result = await appendWeeklyReconciliation({
      proof: JSON.parse(bytes.toString("utf8")),
    });
    process.stdout.write(encode(result));
    return result;
  }
  let live = false;
  let budgetCredits = 0;
  const seen = new Set();
  for (const argument of args) {
    const name = argument.split("=")[0];
    assert(!seen.has(name), "参数不得重复");
    seen.add(name);
    if (argument === "--live") live = true;
    else if (/^--budget-credits=(?:auto|\d+(?:\.\d+)?)$/u.test(argument)) {
      const value = argument.slice("--budget-credits=".length);
      budgetCredits = value === "auto" ? value : Number(value);
    } else throw new Error(`未知参数：${argument}`);
  }
  const inputs = await readWeeklyInputs();
  const result = await runWeeklyRefresh({
    ...inputs,
    live,
    budgetCredits,
    adapter: live ? createWeeklyCliAdapter() : null,
  });
  process.stdout.write(encode(result));
  if (result.status === "blocked") process.exitCode = 2;
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      "周更入口失败关闭；请检查参数、主档与不可变周快照。\n",
    );
    process.exitCode = 2;
  });
}

import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readStageFile } from "./pipeline.ts";
import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import { WEEKLY_ARCHIVE } from "./weeklyScope.ts";
import {
  extractWeeklyProfiles,
  weeklyProfileArguments,
  type WeeklyRawResponse,
} from "./weeklyContract.ts";

export interface LegacyWeeklyAudit {
  schemaVersion: "idol-legacy-weekly-audit-v2";
  inspectedAt: string;
  status: "clear";
  sourceSha256: string;
  moduleHashes: { path: string; sha256: string }[];
  inventorySha256?: string;
}
type LegacyModule = {
  readWeeklyInputs: (root: string) => Promise<{
    groups: unknown[];
    conflictRecords: unknown[];
    sourceSha256: string;
  }>;
  runWeeklyRefresh: (
    options: Record<string, unknown>,
  ) => Promise<{ status: string; blocker?: string }>;
  createWeeklyCliAdapter: () => {
    queryProfiles: (request: { uids: string[] }) => Promise<WeeklyRawResponse>;
  };
};

async function legacy(): Promise<LegacyModule> {
  return (await import(
    pathToFileURL(resolve(WEEKLY_ARCHIVE, "tools/weekly_profile_refresh.mjs"))
      .href
  )) as LegacyModule;
}

/** 对全部周目录一视同仁；不让当期未列入计划的孤立产物从旧dry-run中漏过。 */
export function validateLegacyWeekInventory(
  week: string,
  plan: unknown,
  names: readonly string[],
): void {
  requireState(
    /^week-\d{4}-\d{2}-\d{2}$/u.test(week) &&
      new Set(names).size === names.length,
    "invalid_legacy_week_inventory",
  );
  requireState(!names.includes("run.lock"), "legacy_weekly_writer_locked");
  const artifacts = names.filter((name) =>
    /\.(?:attempt|response|receipt|reconciliation)\.json$/u.test(name),
  );
  if (plan === null) {
    requireState(
      artifacts.length === 0 && !names.includes("snapshot.json"),
      "legacy_orphan_artifacts_without_plan",
    );
    return;
  }
  requireState(
    object(plan) &&
      plan.schemaVersion === "weekly-profile-plan-v1" &&
      plan.weekId === week &&
      Array.isArray(plan.batches),
    "invalid_legacy_saved_plan",
  );
  const keys = plan.batches.map((batch: unknown) => {
    requireState(
      object(batch) &&
        typeof batch.key === "string" &&
        /^[a-f0-9]{64}$/u.test(batch.key),
      "invalid_legacy_batch_key",
    );
    return batch.key;
  });
  requireState(
    new Set(keys).size === keys.length,
    "duplicate_legacy_batch_key",
  );
  const recorded = new Set<string>();
  for (const name of artifacts) {
    requireState(
      /^[a-f0-9]{64}\.(?:attempt|response|receipt|reconciliation)\.json$/u.test(
        name,
      ),
      "invalid_legacy_record_name",
    );
    const key = name.slice(0, 64);
    requireState(keys.includes(key), "legacy_orphan_record_outside_plan");
    recorded.add(key);
  }
  for (const key of recorded) {
    requireState(
      names.includes(`${key}.attempt.json`),
      "legacy_attempt_missing",
    );
    requireState(
      names.includes(`${key}.reconciliation.json`) ||
        (names.includes(`${key}.response.json`) &&
          names.includes(`${key}.receipt.json`)),
      "legacy_attempt_requires_reconciliation",
    );
  }
  if (names.includes("snapshot.json"))
    requireState(
      keys.length > 0 &&
        keys.every(
          (key) =>
            names.includes(`${key}.attempt.json`) &&
            names.includes(`${key}.response.json`) &&
            names.includes(`${key}.receipt.json`) &&
            !names.includes(`${key}.reconciliation.json`),
        ),
      "legacy_snapshot_missing_or_closed_batches",
    );
}

export function validateLegacyWeekReferences(
  week: string,
  files: Record<string, Buffer>,
  now: Date,
): void {
  const read = (name: string): Record<string, unknown> => {
    requireState(files[name], "legacy_reference_missing");
    const value: unknown = JSON.parse(files[name].toString("utf8"));
    requireState(object(value), "invalid_legacy_evidence_object");
    return value;
  };
  const plan = files["plan.json"] ? read("plan.json") : null;
  validateLegacyWeekInventory(week, plan, Object.keys(files));
  if (!plan) return;
  const reference = (ref: unknown): void => {
    requireState(
      object(ref) &&
        typeof ref.path === "string" &&
        /^[a-z0-9._-]+\.json$/u.test(ref.path) &&
        typeof ref.sha256 === "string" &&
        files[ref.path] &&
        sha256(files[ref.path]) === ref.sha256,
      "legacy_reference_hash_mismatch",
    );
  };
  for (const name of Object.keys(files).filter((item) =>
    item.endsWith(".attempt.json"),
  )) {
    const key = name.slice(0, 64),
      attempt = read(name);
    const batch = (plan.batches as Record<string, unknown>[]).find(
      (item) => item.key === key,
    )!;
    requireState(
      Array.isArray(batch.values) &&
        batch.values.every((uid) => typeof uid === "string") &&
        sha256(encode(batch.values)) === key &&
        attempt.schemaVersion === "weekly-profile-attempt-v1" &&
        attempt.weekId === week &&
        attempt.requestKey === key &&
        attempt.planSha256 === sha256(files["plan.json"]) &&
        encode(attempt.uids) === encode(batch.values) &&
        encode(attempt.command) ===
          encode(weeklyProfileArguments(batch.values)) &&
        typeof attempt.accountScope === "string" &&
        /^[a-f0-9]{16}$/u.test(attempt.accountScope) &&
        isTimestamp(attempt.startedAt) &&
        Date.parse(attempt.startedAt) <= now.getTime(),
      "legacy_attempt_reference_mismatch",
    );
    reference(attempt.capabilityReceipt);
    const guardRef = attempt.capabilityReceipt as { path: string };
    const guard = read(guardRef.path);
    requireState(
      guard.accountScope === attempt.accountScope &&
        Array.isArray(guard.managementEvidence) &&
        guard.managementEvidence.length > 0,
      "legacy_guard_reference_mismatch",
    );
    guard.managementEvidence.forEach(reference);
    const responseName = `${key}.response.json`,
      receiptName = `${key}.receipt.json`;
    if (files[`${key}.reconciliation.json`]) {
      const proof = read(`${key}.reconciliation.json`);
      requireState(
        proof.schemaVersion === "weekly-profile-reconciliation-v1" &&
          proof.weekId === week &&
          proof.requestKey === key &&
          proof.accountScope === attempt.accountScope &&
          proof.attemptSha256 === sha256(files[name]) &&
          proof.responseSha256 ===
            (files[responseName] ? sha256(files[responseName]) : null) &&
          proof.receiptSha256 ===
            (files[receiptName] ? sha256(files[receiptName]) : null),
        "legacy_reconciliation_reference_mismatch",
      );
      // 供应方核账字段及close_without_retry语义仍由旧审阅过的核账验证器核对。
      continue;
    }
    const receipt = read(receiptName);
    requireState(
      receipt.schemaVersion === "weekly-profile-receipt-v1" &&
        receipt.weekId === week &&
        receipt.requestKey === key &&
        receipt.outcome === "success" &&
        receipt.attemptSha256 === sha256(files[name]) &&
        receipt.responseSha256 === sha256(files[responseName]) &&
        isTimestamp(receipt.observedAt) &&
        Date.parse(receipt.observedAt) >= Date.parse(attempt.startedAt) &&
        Date.parse(receipt.observedAt) <= now.getTime(),
      "legacy_receipt_reference_mismatch",
    );
    extractWeeklyProfiles(read(responseName), batch.values);
  }
  if (files["snapshot.json"]) {
    const snapshot = read("snapshot.json");
    requireState(
      snapshot.schemaVersion === "weekly-profile-snapshot-v1" &&
        snapshot.weekId === week &&
        snapshot.sourceSha256 === plan.sourceSha256 &&
        snapshot.complete === true,
      "legacy_snapshot_reference_mismatch",
    );
  }
}

async function readLegacyInventories(now: Date): Promise<string> {
  const relativeRoot = "sources/weekly-profile-refresh",
    folder = resolve(WEEKLY_ARCHIVE, relativeRoot);
  let weeks: string[];
  try {
    const stat = await lstat(folder);
    requireState(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "non_regular_legacy_week_root",
    );
    weeks = await readdir(folder);
  } catch (error) {
    if (object(error) && error.code === "ENOENT") return sha256(encode([]));
    throw error;
  }
  const hashes: { path: string; sha256: string }[] = [];
  for (const week of weeks.sort()) {
    requireState(
      /^week-\d{4}-\d{2}-\d{2}$/u.test(week),
      week === "maintenance.lock"
        ? "legacy_weekly_writer_locked"
        : "unexpected_legacy_week_directory",
    );
    const weekPath = `${relativeRoot}/${week}`,
      directory = resolve(WEEKLY_ARCHIVE, weekPath);
    const stat = await lstat(directory);
    requireState(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "non_regular_legacy_week_directory",
    );
    const files: Record<string, Buffer> = {};
    for (const name of (await readdir(directory)).sort()) {
      requireState(
        /^[a-z0-9._-]+\.json$/u.test(name),
        name === "run.lock"
          ? "legacy_weekly_writer_locked"
          : "unexpected_legacy_week_file",
      );
      files[name] = await readStageFile(
        WEEKLY_ARCHIVE,
        `${weekPath}/${name}`,
        16 * 1024 * 1024,
      );
      hashes.push({ path: `${weekPath}/${name}`, sha256: sha256(files[name]) });
    }
    validateLegacyWeekReferences(week, files, now);
  }
  return sha256(encode(hashes));
}

/** 复用旧入口的全周次账本核查，明确live:false且不传adapter；没有任何管理或业务请求。 */
export async function inspectLegacyWeeklyLedger(
  now: Date,
): Promise<LegacyWeeklyAudit> {
  for (const name of [
    "sources/weekly-profile-refresh/maintenance.lock",
    "sources/.weibo-official-write.lock",
  ]) {
    try {
      await lstat(resolve(WEEKLY_ARCHIVE, name));
      throw new Error("legacy_weekly_writer_locked");
    } catch (error) {
      requireState(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT",
        "legacy_weekly_writer_locked",
      );
    }
  }
  const inventorySha256 = await readLegacyInventories(now);
  const moduleNames = [
    "tools/weekly_profile_refresh.mjs",
    "tools/weekly_reconciliation.mjs",
    "tools/collect_weibo_official.mjs",
    "tools/weibo_cli_contract.mjs",
  ];
  const moduleHashes = await Promise.all(
    moduleNames.map(async (path) => ({
      path,
      sha256: sha256(await readStageFile(WEEKLY_ARCHIVE, path)),
    })),
  );
  const collector = await legacy();
  const inputs = await collector.readWeeklyInputs(WEEKLY_ARCHIVE);
  const result = await collector.runWeeklyRefresh({
    archiveRoot: WEEKLY_ARCHIVE,
    ...inputs,
    live: false,
    clock: () => new Date(now),
  });
  requireState(
    result.status === "planned",
    `legacy_weekly_ledger_blocked:${result.blocker ?? "unknown"}`,
  );
  return {
    schemaVersion: "idol-legacy-weekly-audit-v2",
    inspectedAt: now.toISOString(),
    status: "clear",
    sourceSha256: inputs.sourceSha256,
    moduleHashes,
    inventorySha256,
  };
}

/** 只有运行器已经通过真实合同与预算检查后才可调用；此函数没有管理探针或自动重试。 */
export async function queryWeeklyProfiles(
  uids: string[],
): Promise<WeeklyRawResponse> {
  const collector = await legacy();
  return await collector.createWeeklyCliAdapter().queryProfiles({ uids });
}

import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { encode, isTimestamp, sha256 } from "../src/sourceCapture.ts";
import { object, requireState } from "../src/sourceRegistry.ts";
import { parseWeeklyRuntimeInputs, weeklySlot } from "../src/weeklyScope.ts";
import { prepareWeeklyRuntimeProjection } from "../src/weeklyRuntimeApplication.ts";
import type { WeeklyRuntimeInspection } from "../src/weeklyRuntime.ts";
import { regularPath } from "./state.ts";
import {
  assertWeeklyRunRecovery,
  readWeeklyRunReceipt,
} from "./weeklyRunRecovery.ts";
import { validateScopedFollowerObservations } from "../../site/src/catalog/scopedFollowerObservations.ts";

const PLAN = "weekly-application-plans";
const RECEIPT = "weekly-applications";
const SLOT = /^(?:manual|scheduled)-\d{4}-\d{2}-\d{2}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 16 * 1024 * 1024;
const same = (a: unknown, b: unknown) => encode(a) === encode(b);
const parse = (bytes: Buffer): Record<string, unknown> => {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  requireState(object(value), "weekly_preflight_invalid_json");
  return value;
};
const exact = (value: object, keys: string[]) =>
  same(Object.keys(value).sort(), [...keys].sort());
const missing = (error: unknown) => object(error) && error.code === "ENOENT";

async function exists(target: string): Promise<boolean> {
  await regularPath(dirname(target));
  try {
    await regularPath(target);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/** 预检只打开现有普通文件；不创建目录、加锁、恢复或重写归档。 */
async function read(target: string): Promise<Buffer> {
  await regularPath(target);
  const before = await lstat(target, { bigint: true });
  requireState(
    before.isFile() && before.size <= MAX_BYTES,
    "weekly_preflight_file_invalid",
  );
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    requireState(
      opened.ino === before.ino && opened.nlink === 1n,
      "weekly_preflight_file_drift",
    );
    const bytes = await handle.readFile();
    const after = await lstat(target, { bigint: true });
    requireState(
      bytes.length <= MAX_BYTES &&
        after.isFile() &&
        !after.isSymbolicLink() &&
        after.ino === before.ino &&
        after.nlink === 1n &&
        after.size === before.size &&
        after.mtimeNs === before.mtimeNs &&
        after.ctimeNs === before.ctimeNs,
      "weekly_preflight_file_drift",
    );
    return bytes;
  } finally {
    await handle.close();
  }
}

async function names(target: string): Promise<string[]> {
  await regularPath(target);
  requireState(
    (await lstat(target)).isDirectory(),
    "weekly_preflight_directory_required",
  );
  const result = (await readdir(target)).sort();
  requireState(result.length <= 10000, "weekly_preflight_capacity");
  for (const name of result) {
    requireState(
      !/[\\/:]/u.test(name) && name !== "." && name !== "..",
      "weekly_preflight_unsafe_name",
    );
    await regularPath(resolve(target, name));
  }
  return result;
}

async function inventory(target: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (directory: string, prefix: string, depth: number) => {
    requireState(
      depth <= 24 && result.length <= 4228,
      "weekly_preflight_capacity",
    );
    for (const name of await names(directory)) {
      const relative = `${prefix}${name}`;
      const child = resolve(directory, name);
      const directoryEntry = (await lstat(child)).isDirectory();
      result.push(relative + (directoryEntry ? "/" : ""));
      if (directoryEntry) await walk(child, `${relative}/`, depth + 1);
    }
  };
  await walk(target, "", 0);
  return result.sort();
}

async function archive(root: string, kind: string, slotId: string) {
  const base = resolve(root, "runs", kind, slotId);
  const intentBytes = await read(resolve(base, "intent.json"));
  const intent = parse(intentBytes);
  requireState(
    exact(intent, ["schemaVersion", "kind", "runId", "files", "metadata"]) &&
      intent.schemaVersion === "pipeline-run-intent-v1" &&
      intent.kind === kind &&
      intent.runId === slotId &&
      object(intent.metadata) &&
      exact(intent.metadata, ["mode"]) &&
      intent.metadata.mode === "provider" &&
      Array.isArray(intent.files) &&
      intent.files.length > 0 &&
      intent.files.length <= 128,
    "weekly_preflight_invalid_intent",
  );
  const files: Record<string, Buffer> = {};
  const manifest: { path: string; sha256: string; size: number }[] = [];
  const expected = new Set(["intent.json", "complete.json", "files/"]);
  let previous = "";
  for (const file of intent.files) {
    requireState(
      object(file) &&
        exact(file, ["path", "sha256", "size"]) &&
        typeof file.path === "string" &&
        file.path > previous &&
        /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u.test(file.path) &&
        !file.path.split("/").some((part) => part === "." || part === "..") &&
        typeof file.sha256 === "string" &&
        HASH.test(file.sha256) &&
        Number.isSafeInteger(file.size) &&
        Number(file.size) >= 0 &&
        Number(file.size) <= MAX_BYTES,
      "weekly_preflight_invalid_manifest",
    );
    previous = file.path;
    manifest.push({
      path: file.path,
      sha256: file.sha256,
      size: Number(file.size),
    });
    const parts = ["files", ...file.path.split("/")];
    for (let index = 1; index < parts.length; index++)
      expected.add(parts.slice(0, index).join("/") + "/");
    expected.add(parts.join("/"));
    const bytes = await read(resolve(base, ...parts));
    requireState(
      bytes.length === file.size && sha256(bytes) === file.sha256,
      "weekly_preflight_archive_hash_mismatch",
    );
    files[file.path] = bytes;
  }
  requireState(
    intentBytes.equals(
      Buffer.from(
        JSON.stringify({
          files: manifest,
          kind,
          metadata: { mode: "provider" },
          runId: slotId,
          schemaVersion: "pipeline-run-intent-v1",
        }) + "\n",
      ),
    ),
    "weekly_preflight_noncanonical_intent",
  );
  const marker = parse(await read(resolve(base, "complete.json")));
  requireState(
    exact(marker, [
      "schemaVersion",
      "kind",
      "runId",
      "intentSha256",
      "completedAt",
    ]) &&
      marker.schemaVersion === "pipeline-run-complete-v1" &&
      marker.kind === kind &&
      marker.runId === slotId &&
      marker.intentSha256 === sha256(intentBytes) &&
      isTimestamp(marker.completedAt),
    "weekly_preflight_incomplete_archive",
  );
  requireState(
    same(await inventory(base), [...expected].sort()),
    "weekly_preflight_archive_set_mismatch",
  );
  return files;
}

function validatePlan(
  files: Record<string, Buffer>,
  slotId: string,
  now: Date,
) {
  const plan = parse(files["plan.json"]);
  requireState(
    plan.schemaVersion === "idol-weekly-application-plan-v2" &&
      plan.mode === "provider" &&
      plan.slotId === slotId &&
      isTimestamp(plan.preparedAt) &&
      Date.parse(plan.preparedAt) <= now.getTime() &&
      typeof plan.runtimeArchiveSha256 === "string" &&
      HASH.test(plan.runtimeArchiveSha256),
    "weekly_preflight_invalid_plan",
  );
  const preparedAt = new Date(plan.preparedAt);
  const runtimePlan = parse(files["runtime-plan.json"]);
  const snapshot = parse(files["snapshot.json"]);
  const inputs = parseWeeklyRuntimeInputs(
    Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name.startsWith("sources/"))
        .map(([name, bytes]) => [name.slice(8), bytes]),
    ),
  );
  const projection = prepareWeeklyRuntimeProjection({
    inspection: {
      mode: "provider",
      slotId,
      archiveSha256: plan.runtimeArchiveSha256,
      plan: runtimePlan,
      snapshot,
    } as unknown as WeeklyRuntimeInspection,
    inputs,
    legacy: parse(files["legacy-v1.json"]),
    current: parse(files["before.json"]),
    now: preparedAt,
  });
  requireState(
    projection.status === "ready",
    "weekly_preflight_projection_blocked",
  );
  const after = projection.applied.length
    ? Buffer.from(encode(projection.dataset))
    : files["before.json"];
  const rebuilt = {
    schemaVersion: "idol-weekly-application-plan-v2",
    mode: "provider",
    slotId,
    preparedAt: plan.preparedAt,
    runtimeArchiveSha256: plan.runtimeArchiveSha256,
    runtimePlanSha256: sha256(encode(runtimePlan)),
    snapshotSha256: sha256(encode(snapshot)),
    sourceSha256: projection.sourceSha256,
    legacySha256: sha256(files["legacy-v1.json"]),
    beforeSha256: sha256(files["before.json"]),
    afterSha256: sha256(after),
    applied: projection.applied,
    unchanged: projection.unchanged,
    review: projection.review,
  };
  const expectedFiles = [
    "plan.json",
    "before.json",
    "after.json",
    "legacy-v1.json",
    "snapshot.json",
    "runtime-plan.json",
    ...Object.keys(inputs.files).map((name) => `sources/${name}`),
  ].sort();
  requireState(
    same(plan, rebuilt) &&
      files["after.json"].equals(after) &&
      files["plan.json"].equals(Buffer.from(encode(rebuilt))) &&
      files["runtime-plan.json"].equals(Buffer.from(encode(runtimePlan))) &&
      files["snapshot.json"].equals(Buffer.from(encode(snapshot))) &&
      same(Object.keys(files).sort(), expectedFiles),
    "weekly_preflight_plan_content_mismatch",
  );
  return rebuilt;
}

async function auxiliaryState(root: string, planIds: string[]) {
  const staging = resolve(root, ".staging");
  if (await exists(staging))
    requireState(
      (await inventory(staging)).every((name) => name.endsWith("/")),
      "weekly_preflight_unfinished_staging",
    );
  const failures = resolve(root, ".run-failures");
  if (!(await exists(failures))) return;
  for (const kind of await names(failures)) {
    requireState(
      [PLAN, RECEIPT].includes(kind),
      "weekly_preflight_unknown_failure_kind",
    );
    for (const id of await names(resolve(failures, kind))) {
      requireState(planIds.includes(id), "weekly_preflight_orphan_failure");
      const intentHash = sha256(
        await read(resolve(root, "runs", kind, id, "intent.json")),
      );
      for (const name of await names(resolve(failures, kind, id))) {
        requireState(
          /^[a-f0-9]{64}\.json$/u.test(name),
          "weekly_preflight_invalid_failure",
        );
        const bytes = await read(resolve(failures, kind, id, name));
        const failure = parse(bytes);
        requireState(
          sha256(bytes) === name.slice(0, -5) &&
            exact(failure, [
              "schemaVersion",
              "kind",
              "runId",
              "intentSha256",
              "attemptedAt",
              "nonce",
              "code",
              "message",
            ]) &&
            failure.schemaVersion === "pipeline-run-failure-v1" &&
            failure.kind === kind &&
            failure.runId === id &&
            failure.intentSha256 === intentHash &&
            isTimestamp(failure.attemptedAt) &&
            typeof failure.nonce === "string" &&
            /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(
              failure.nonce,
            ) &&
            typeof failure.code === "string" &&
            typeof failure.message === "string",
          "weekly_preflight_invalid_failure",
        );
      }
    }
  }
}

async function emptyOutput(output: string, now: Date) {
  const current = validateScopedFollowerObservations(
    parse(await read(output)),
    now,
  );
  requireState(
    current.valid && current.data.records.length === 0,
    "weekly_preflight_application_ledger_missing",
  );
}

export interface WeeklyPreflightRecovery {
  runId: string;
  expectedReceiptSha256: string;
}

/** 只选择既存失败槽；没有旧计划时不生成往期任务，未知失败仍阻塞。 */
export async function selectWeeklyRunId(
  stateRoot: string,
  now = new Date(),
): Promise<string> {
  const current = `weekly-${weeklySlot("scheduled", now).date}`;
  const root = resolve(stateRoot, "runs");
  requireState(
    isAbsolute(stateRoot) && !stateRoot.split(/[\\/]/u).includes(".."),
    "weekly_preflight_invalid_root",
  );
  if (!(await exists(root))) return current;
  let earliest: string | undefined;
  for (const id of (await names(root)).filter((name) =>
    name.startsWith("weekly-"),
  )) {
    requireState(
      /^weekly-\d{4}-\d{2}-\d{2}$/u.test(id) &&
        id <= current &&
        `weekly-${weeklySlot("scheduled", new Date(`${id.slice(7)}T00:00:00+08:00`)).date}` ===
          id,
      "weekly_preflight_invalid_server_run",
    );
    const receipt = await readWeeklyRunReceipt(stateRoot, id, now);
    if (!receipt) {
      requireState(id === current, "prior_weekly_server_run_incomplete");
      continue;
    }
    if (receipt.status === "blocked") {
      requireState(
        receipt.code === "incomplete_weekly_response",
        "prior_weekly_server_run_failed",
      );
      earliest ??= id;
    }
  }
  return earliest ?? current;
}

async function priorRuns(
  stateRoot: string,
  now: Date,
  recovery?: WeeklyPreflightRecovery,
) {
  const root = resolve(stateRoot, "runs");
  const current = `weekly-${weeklySlot("scheduled", now).date}`;
  if (recovery) {
    requireState(
      recovery.runId <= current,
      "weekly_preflight_recovery_in_future",
    );
    await assertWeeklyRunRecovery(
      stateRoot,
      recovery.runId,
      recovery.expectedReceiptSha256,
      now,
    );
    requireState(
      recovery.runId === (await selectWeeklyRunId(stateRoot, now)),
      "prior_weekly_server_run_failed",
    );
  }
  const recoveredSlots: string[] = [];
  if (!(await exists(root))) return recoveredSlots;
  for (const id of (await names(root)).filter((name) =>
    name.startsWith("weekly-"),
  )) {
    requireState(
      /^weekly-\d{4}-\d{2}-\d{2}$/u.test(id) && id <= current,
      "weekly_preflight_invalid_server_run",
    );
    const folder = resolve(root, id);
    requireState(
      (await names(folder)).every((name) =>
        ["attempt.json", "receipt.json"].includes(name),
      ),
      "weekly_preflight_invalid_server_run",
    );
    const attempt = parse(await read(resolve(folder, "attempt.json")));
    requireState(
      attempt.schemaVersion === "idol-server-attempt-v1" &&
        attempt.runId === id &&
        attempt.kind === "weekly" &&
        isTimestamp(attempt.startedAt),
      "weekly_preflight_invalid_server_attempt",
    );
    const receiptPath = resolve(folder, "receipt.json");
    if (id === current && !(await exists(receiptPath))) continue;
    requireState(
      await exists(receiptPath),
      "prior_weekly_server_run_incomplete",
    );
    const original = parse(await read(receiptPath));
    const receipt = await readWeeklyRunReceipt(stateRoot, id, now);
    // 仅最早既存失败槽的哈希绑定恢复可越过原失败；应用账本检查仍执行。
    if (receipt?.status === "blocked" && recovery?.runId === id) continue;
    requireState(
      receipt &&
        receipt.schemaVersion === "idol-server-run-v1" &&
        receipt.runId === id &&
        receipt.status === "complete" &&
        isTimestamp(receipt.finishedAt),
      "prior_weekly_server_run_failed",
    );
    const result = receipt.result;
    const application = object(result) ? result.application : null;
    requireState(
      object(application) &&
        application.status === "complete" &&
        application.slotId === id.replace(/^weekly-/u, "scheduled-") &&
        (application.publicWrites === 0 || application.publicWrites === 1) &&
        application.changed === (application.publicWrites === 1) &&
        receipt.changed === application.changed,
      "prior_weekly_server_application_uncertain",
    );
    if (original.status === "blocked")
      recoveredSlots.push(id.replace(/^weekly-/u, "scheduled-"));
  }
  return recoveredSlots;
}

/** 调用方持有全局维护锁；必须在价目刷新及任何新业务请求之前调用。 */
export async function assertWeeklyApplicationReady(
  stageRoot: string,
  stateRoot?: string,
  now = new Date(),
  recovery?: WeeklyPreflightRecovery,
): Promise<void> {
  const safeRoot = (root: string) =>
    isAbsolute(root) &&
    !root.split(/[\\/]/u).includes("..") &&
    resolve(root) !== dirname(resolve(root));
  requireState(
    safeRoot(stageRoot) &&
      (!stateRoot || safeRoot(stateRoot)) &&
      (!recovery || Boolean(stateRoot)) &&
      Number.isFinite(now.getTime()),
    "weekly_preflight_invalid_root",
  );
  await regularPath(stageRoot);
  const recoveredSlots = stateRoot
    ? await priorRuns(stateRoot, now, recovery)
    : [];
  const publicLocks = resolve(stageRoot, ".locks");
  if (await exists(publicLocks))
    requireState(
      !(await names(publicLocks)).some((name) =>
        [
          "public-followers-v2.lock.json",
          "recovery-public-followers-v2.lock.json",
        ].includes(name),
      ),
      "weekly_preflight_public_locked",
    );
  const root = resolve(stageRoot, "private/weekly-application-v2");
  const output = resolve(stageRoot, "site/data/follower-observations.v2.json");
  if (!(await exists(root))) {
    requireState(
      recoveredSlots.length === 0,
      "weekly_preflight_recovered_application_missing",
    );
    await emptyOutput(output, now);
    return;
  }
  const allowed = new Set(["runs", ".locks", ".staging", ".run-failures"]);
  requireState(
    (await names(root)).every((name) => allowed.has(name)),
    "weekly_preflight_invalid_application_root",
  );
  const locks = resolve(root, ".locks");
  if (await exists(locks))
    requireState(
      (await names(locks)).length === 0,
      "weekly_preflight_application_locked",
    );
  const runs = resolve(root, "runs");
  if (!(await exists(runs))) {
    requireState(
      recoveredSlots.length === 0,
      "weekly_preflight_recovered_application_missing",
    );
    requireState(
      (await names(root)).length === 0,
      "weekly_preflight_application_ledger_missing",
    );
    await emptyOutput(output, now);
    return;
  }
  requireState(
    (await names(runs)).every((name) => [PLAN, RECEIPT].includes(name)),
    "weekly_preflight_unknown_application_kind",
  );
  const ids = async (kind: string) =>
    (await exists(resolve(runs, kind))) ? await names(resolve(runs, kind)) : [];
  const plans = await ids(PLAN),
    receipts = await ids(RECEIPT);
  requireState(
    plans.every((id) => SLOT.test(id)) && same(plans, receipts),
    "prior_weekly_application_incomplete",
  );
  requireState(
    recoveredSlots.every((id) => plans.includes(id)),
    "weekly_preflight_recovered_application_missing",
  );
  await auxiliaryState(root, plans);
  const completed = [];
  for (const id of plans) {
    const plan = validatePlan(await archive(root, PLAN, id), id, now);
    const receiptFiles = await archive(root, RECEIPT, id);
    const expected = {
      schemaVersion: "idol-weekly-application-receipt-v2",
      mode: plan.mode,
      slotId: id,
      planSha256: sha256(encode(plan)),
      outputSha256: plan.afterSha256,
      applied: plan.applied,
      changed: plan.beforeSha256 !== plan.afterSha256,
      appliedAt: null,
      note: "公开输出字节与不可变计划一致；不推断文件替换时刻。",
    };
    requireState(
      same(Object.keys(receiptFiles), ["receipt.json"]) &&
        receiptFiles["receipt.json"].equals(Buffer.from(encode(expected))),
      "weekly_preflight_receipt_mismatch",
    );
    completed.push(plan);
  }
  completed.sort((a, b) => a.preparedAt.localeCompare(b.preparedAt));
  for (let index = 1; index < completed.length; index++)
    requireState(
      completed[index].beforeSha256 === completed[index - 1].afterSha256,
      "weekly_preflight_public_chain_mismatch",
    );
  const current = await read(output);
  if (completed.length)
    requireState(
      sha256(current) === completed.at(-1)!.afterSha256,
      "weekly_preflight_public_output_drift",
    );
  else await emptyOutput(output, now);
}

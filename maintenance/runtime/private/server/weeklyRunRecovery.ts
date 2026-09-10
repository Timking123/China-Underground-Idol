import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { encode, isTimestamp, sha256 } from "../src/sourceCapture.ts";
import { requireState } from "../src/sourceRegistry.ts";
import { regularPath, writeOnce } from "./state.ts";

export interface WeeklyRunRecoveryRequest {
  schemaVersion: "idol-weekly-run-recovery-request-v1";
  runId: string;
  originalAttemptSha256: string;
  originalReceiptSha256: string;
  requestedAt: string;
}
interface RecordFile {
  value: Record<string, unknown>;
  sha256: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hashPattern = /^[a-f0-9]{64}$/u;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");

function paths(stateRoot: string, runId: string) {
  requireState(
    isAbsolute(stateRoot) &&
      !stateRoot.split(/[\\/]/u).includes("..") &&
      resolve(stateRoot) !== dirname(resolve(stateRoot)) &&
      /^weekly-\d{4}-\d{2}-\d{2}$/u.test(runId) &&
      isTimestamp(`${runId.slice(7)}T00:00:00Z`),
    "weekly_run_recovery_invalid_path",
  );
  return {
    attempt: resolve(stateRoot, "runs", runId, "attempt.json"),
    original: resolve(stateRoot, "runs", runId, "receipt.json"),
    request: resolve(stateRoot, "weekly-recoveries", runId, "request.json"),
    recovery: resolve(stateRoot, "weekly-recoveries", runId, "receipt.json"),
  };
}

/** 普通文件、单链接与字节哈希同时校验；读取不创建状态目录。 */
async function read(path: string): Promise<RecordFile | null> {
  await regularPath(path, true);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    requireState(
      before.isFile() && before.nlink === 1n && before.size <= 1024n * 1024n,
      "weekly_run_recovery_invalid_file",
    );
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    await regularPath(path);
    const named = await lstat(path, { bigint: true });
    requireState(
      after.nlink === 1n &&
        named.isFile() &&
        named.nlink === 1n &&
        before.dev === after.dev &&
        before.ino === after.ino &&
        // Windows 的路径 lstat 可返回 dev=0；inode 仍须精确匹配。
        (named.dev === after.dev ||
          (process.platform === "win32" && named.dev === 0n)) &&
        named.ino === after.ino &&
        named.size === after.size &&
        named.mtimeNs === after.mtimeNs &&
        named.ctimeNs === after.ctimeNs &&
        before.size === BigInt(bytes.length) &&
        after.size === before.size &&
        before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs,
      "weekly_run_recovery_file_changed",
    );
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    requireState(object(value), "weekly_run_recovery_invalid_record");
    return { value, sha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

function completed(
  value: unknown,
  runId: string,
  earliest: string,
  now: number,
): asserts value is Record<string, unknown> {
  requireState(object(value), "weekly_run_recovery_invalid_completion");
  const result = value.result;
  const application = object(result) ? result.application : null;
  const collection = object(result) ? result.collection : null;
  requireState(
    value.schemaVersion === "idol-server-run-v1" &&
      value.runId === runId &&
      value.status === "complete" &&
      value.code === undefined &&
      isTimestamp(value.finishedAt) &&
      Date.parse(value.finishedAt) >= Date.parse(earliest) &&
      Date.parse(value.finishedAt) <= now &&
      object(application) &&
      object(collection) &&
      collection.slotId === runId.replace(/^weekly-/u, "scheduled-") &&
      application.slotId === collection.slotId &&
      application.status === "complete" &&
      application.blocker === undefined &&
      (application.publicWrites === 0 || application.publicWrites === 1) &&
      application.changed === (application.publicWrites === 1) &&
      value.changed === application.changed,
    "weekly_run_recovery_invalid_completion",
  );
}

async function inspect(stateRoot: string, runId: string, at = new Date()) {
  requireState(
    Number.isFinite(at.getTime()),
    "weekly_run_recovery_invalid_time",
  );
  const files = paths(stateRoot, runId);
  const attempt = await read(files.attempt);
  const original = await read(files.original);
  const request = await read(files.request);
  const recovery = await read(files.recovery);
  const now = at.getTime();
  if (!original) {
    requireState(!request && !recovery, "weekly_run_recovery_orphaned");
    return { files, attempt, original, request, recovery, effective: null };
  }
  requireState(
    attempt &&
      attempt.value.schemaVersion === "idol-server-attempt-v1" &&
      attempt.value.runId === runId &&
      attempt.value.kind === "weekly" &&
      isTimestamp(attempt.value.startedAt) &&
      original.value.schemaVersion === "idol-server-run-v1" &&
      original.value.runId === runId &&
      isTimestamp(original.value.finishedAt) &&
      Date.parse(attempt.value.startedAt) <=
        Date.parse(original.value.finishedAt) &&
      Date.parse(original.value.finishedAt) <= now &&
      (original.value.status === "blocked" ||
        original.value.status === "complete"),
    "weekly_run_recovery_invalid_original",
  );
  if (original.value.status === "complete")
    completed(original.value, runId, attempt.value.startedAt, now);
  else
    requireState(
      typeof original.value.code === "string" &&
        /^[a-z][a-z0-9_]{0,94}$/u.test(original.value.code),
      "weekly_run_recovery_invalid_original",
    );
  if (request || recovery) {
    requireState(request, "weekly_run_recovery_orphaned");
    requireState(
      original.value.status === "blocked" &&
        original.value.code === "incomplete_weekly_response",
      "weekly_run_recovery_ineligible_original",
    );
    const value = request.value;
    requireState(
      exactKeys(value, [
        "schemaVersion",
        "runId",
        "originalAttemptSha256",
        "originalReceiptSha256",
        "requestedAt",
      ]) &&
        value.schemaVersion === "idol-weekly-run-recovery-request-v1" &&
        value.runId === runId &&
        value.originalAttemptSha256 === attempt.sha256 &&
        value.originalReceiptSha256 === original.sha256 &&
        isTimestamp(value.requestedAt) &&
        Date.parse(value.requestedAt) >=
          Date.parse(original.value.finishedAt) &&
        Date.parse(value.requestedAt) <= now,
      "weekly_run_recovery_request_mismatch",
    );
    if (recovery) {
      const receipt = recovery.value;
      requireState(
        exactKeys(receipt, [
          "schemaVersion",
          "runId",
          "requestSha256",
          "originalAttemptSha256",
          "originalReceiptSha256",
          "completedReceipt",
        ]) &&
          receipt.schemaVersion === "idol-weekly-run-recovery-receipt-v1" &&
          receipt.runId === runId &&
          receipt.requestSha256 === request.sha256 &&
          receipt.originalAttemptSha256 === attempt.sha256 &&
          receipt.originalReceiptSha256 === original.sha256,
        "weekly_run_recovery_receipt_mismatch",
      );
      completed(receipt.completedReceipt, runId, value.requestedAt, now);
      return {
        files,
        attempt,
        original,
        request,
        recovery,
        effective: receipt.completedReceipt,
      };
    }
  }
  return {
    files,
    attempt,
    original,
    request,
    recovery,
    effective: original.value,
  };
}

async function eligible(
  stateRoot: string,
  runId: string,
  expectedReceiptSha256: string,
  now = new Date(),
) {
  requireState(
    hashPattern.test(expectedReceiptSha256),
    "weekly_run_recovery_invalid_hash",
  );
  const state = await inspect(stateRoot, runId, now);
  requireState(
    state.original?.sha256 === expectedReceiptSha256,
    "weekly_run_recovery_original_hash_mismatch",
  );
  requireState(
    state.original.value.status === "blocked" &&
      state.original.value.code === "incomplete_weekly_response" &&
      state.attempt,
    "weekly_run_recovery_ineligible_original",
  );
  return { ...state, original: state.original, attempt: state.attempt };
}

/** 调用方持有维护锁且已获明确授权；只追加恢复请求，绝不改写原失败。 */
export async function requestWeeklyRunRecovery(
  stateRoot: string,
  runId: string,
  expectedReceiptSha256: string,
): Promise<WeeklyRunRecoveryRequest> {
  const state = await eligible(stateRoot, runId, expectedReceiptSha256);
  if (state.request)
    return state.request.value as unknown as WeeklyRunRecoveryRequest;
  await writeOnce(state.files.request, {
    schemaVersion: "idol-weekly-run-recovery-request-v1",
    runId,
    originalAttemptSha256: state.attempt.sha256,
    originalReceiptSha256: state.original.sha256,
    requestedAt: new Date().toISOString(),
  });
  return assertWeeklyRunRecovery(stateRoot, runId, expectedReceiptSha256);
}

export async function assertWeeklyRunRecovery(
  stateRoot: string,
  runId: string,
  expectedReceiptSha256: string,
  now = new Date(),
): Promise<WeeklyRunRecoveryRequest> {
  const state = await eligible(stateRoot, runId, expectedReceiptSha256, now);
  requireState(state.request, "weekly_run_recovery_request_missing");
  return state.request.value as unknown as WeeklyRunRecoveryRequest;
}

/** 历史读取始终绑定原 runId；跨日也不把旧恢复误记为本周完成。 */
export async function readWeeklyRunReceipt(
  stateRoot: string,
  runId: string,
  now = new Date(),
): Promise<Record<string, unknown> | null> {
  return (await inspect(stateRoot, runId, now)).effective;
}

export async function completeWeeklyRunRecovery(
  stateRoot: string,
  runId: string,
  expectedReceiptSha256: string,
  completedReceipt: unknown,
): Promise<Record<string, unknown>> {
  const state = await eligible(stateRoot, runId, expectedReceiptSha256);
  requireState(state.request, "weekly_run_recovery_request_missing");
  completed(
    completedReceipt,
    runId,
    String(state.request.value.requestedAt),
    Date.now(),
  );
  if (state.recovery) {
    requireState(
      encode(state.recovery.value.completedReceipt) ===
        encode(completedReceipt),
      "weekly_run_recovery_completion_conflict",
    );
    return state.effective!;
  }
  await writeOnce(state.files.recovery, {
    schemaVersion: "idol-weekly-run-recovery-receipt-v1",
    runId,
    requestSha256: state.request.sha256,
    originalAttemptSha256: state.attempt.sha256,
    originalReceiptSha256: state.original.sha256,
    completedReceipt,
  });
  return (await inspect(stateRoot, runId)).effective!;
}

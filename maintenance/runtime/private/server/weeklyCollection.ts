import { requireState } from "../src/sourceRegistry.ts";
import type { WeeklyRuntimeResult } from "../src/weeklyRuntime.ts";

interface Dependencies {
  run: (live: boolean) => Promise<WeeklyRuntimeResult>;
  refreshPrice: () => Promise<unknown>;
  reconcile: (
    slotId: string,
  ) => Promise<{ reused: boolean; reconciliationSha256: string }>;
}

/** 一批缺失只处置一次；收费请求始终由不可变账本决定，不按异常重发。 */
export async function collectWeeklyWithRecovery(
  slotId: string,
  deps: Dependencies,
) {
  let requests = 0;
  const reconciled = new Set<string>();
  let result = await deps.run(false);
  for (let step = 0; step <= 8; step++) {
    requireState(result.slotId === slotId, "weekly_collection_slot_mismatch");
    requests += result.requests;
    if (result.status === "complete")
      return { ...result, requests, reconciledBatches: reconciled.size };
    if (result.status === "blocked") {
      requireState(
        result.blocker === "incomplete_weekly_response" ||
          result.blocker?.startsWith(`weekly_uncertain_attempt:${slotId}-`),
        result.blocker ?? "weekly_collection_blocked",
      );
      const recovery = await deps.reconcile(slotId);
      requireState(
        !recovery.reused && !reconciled.has(recovery.reconciliationSha256),
        "weekly_recovery_no_progress",
      );
      reconciled.add(recovery.reconciliationSha256);
      result = await deps.run(false);
      requireState(result.slotId === slotId, "weekly_collection_slot_mismatch");
      requireState(
        result.status !== "blocked",
        result.blocker ?? "weekly_recovery_blocked",
      );
      if (result.status === "complete")
        return {
          ...result,
          requests: requests + result.requests,
          reconciledBatches: reconciled.size,
        };
    }
    if (result.pendingBatches === 0) {
      const completed = await deps.run(true);
      requireState(
        completed.slotId === slotId &&
          completed.status === "complete" &&
          completed.requests === 0,
        "weekly_recovery_collection_incomplete",
      );
      return { ...completed, requests, reconciledBatches: reconciled.size };
    }
    requireState(step < 8, "weekly_recovery_limit");
    await deps.refreshPrice();
    result = await deps.run(true);
  }
  throw new Error("weekly_recovery_limit");
}

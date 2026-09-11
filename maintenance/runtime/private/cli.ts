import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  archiveImport,
  applyActivityRun,
  collectPublicRun,
  readStageFile,
} from "./src/pipeline.ts";
import { createPipelineStore } from "./src/pipelineStore.ts";
import { encode, sha256 } from "./src/sourceCapture.ts";
import {
  object,
  requireState,
  validateSourceRegistry,
} from "./src/sourceRegistry.ts";
import { inspectWeeklyApplication } from "./src/weeklyApplication.ts";
import {
  runWeeklyRuntime,
  reconcileKnownWithheldWeeklyBatch,
  WEEKLY_RUNTIME_ROOT,
} from "./src/weeklyRuntime.ts";
import {
  runWeeklyRuntimeApplication,
  inspectWeeklyApplicationLock,
  recoverWeeklyApplicationLock,
} from "./src/weeklyRuntimeApplication.ts";

const stage = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const command = args.shift() ?? "help";
function option(name: string): string {
  const positions = args.flatMap((value, index) =>
    value === `--${name}` ? [index] : [],
  );
  requireState(positions.length <= 1, `duplicate_option_${name}`);
  if (!positions.length) return "";
  const value = args[positions[0] + 1];
  requireState(value && !value.startsWith("--"), `missing_option_${name}`);
  return value;
}
function only(names: string[]): void {
  for (let index = 0; index < args.length; index += 2)
    requireState(
      names.includes(args[index]?.slice(2)) &&
        args[index]?.startsWith("--") &&
        args[index + 1] &&
        !args[index + 1].startsWith("--"),
      "unknown_or_missing_cli_option",
    );
}
const print = (value: unknown): void => {
  process.stdout.write(encode(value));
};
try {
  const registry = validateSourceRegistry(
    JSON.parse(
      (await readStageFile(stage, "private/sources.v1.json")).toString("utf8"),
    ),
  );
  if (command === "help") {
    only([]);
    process.stdout.write(
      [
        "私有受控更新入口",
        "  sources",
        "  import --file private/inbox/已审输入.json --run 唯一运行ID",
        "  collect-public --source showstart-glory",
        "  review --run 运行ID",
        "  apply-events --run 运行ID [--draft private/inbox/复核稿.json]",
        "  discover-events（从当日已归档揭示板补录，不重新请求来源）",
        "  weekly-plan --trigger manual|scheduled",
        "  weekly-run --trigger manual|scheduled --budget auto|明确额度",
        "  weekly-recover-collection --slot 既有manual-日期或scheduled-日期",
        "  weekly-reconcile-known-withheld --proof-sha256 已审核官方三笔核账证据SHA",
        "  weekly-review --slot 已完成采集周期",
        "  weekly-apply --slot 已复核采集周期",
        "  weekly-recover-written --slot 已确认公开字节匹配的既有应用周期",
        "  weekly-inspect-application-lock | weekly-inspect-public-lock",
        "  weekly-recover-application-lock --sha256 已确认应用锁hash",
        "  weekly-recover-public-lock --sha256 已确认公开粉丝锁hash",
        "  weekly-recover-lock --sha256 已确认周更锁hash",
        "  weekly-inspect --week YYYY-MM-DD --archive 绝对旧归档根（旧287范围历史兼容）",
        "  inspect-store",
        "  recover-lock --scope 锁名 --sha256 已确认锁hash",
        "活动与周更由Codex自动化另行调度；未知缺项或未核账请求停止，专用核账不会重发原请求。",
        "",
      ].join("\n"),
    );
  } else if (command === "sources") {
    only([]);
    print(registry);
  } else if (command === "discover-events") {
    only([]);
    const { runDiscoveryBootstrap } =
      await import("./server/discoveryBootstrap.ts");
    print(
      await runDiscoveryBootstrap({
        stageRoot: stage,
        stateRoot: resolve(stage, "../../../state"),
      }),
    );
  } else if (command === "weekly-reconcile-known-withheld") {
    only(["proof-sha256"]);
    print(await reconcileKnownWithheldWeeklyBatch(option("proof-sha256")));
  } else if (
    ["weekly-plan", "weekly-run", "weekly-recover-collection"].includes(command)
  ) {
    only(
      command === "weekly-run"
        ? ["trigger", "budget"]
        : command === "weekly-recover-collection"
          ? ["slot"]
          : ["trigger"],
    );
    const recoverSlot =
      command === "weekly-recover-collection" ? option("slot") : undefined;
    if (command === "weekly-recover-collection")
      requireState(
        recoverSlot &&
          /^(?:manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(recoverSlot),
        "weekly_existing_slot_required",
      );
    const trigger = recoverSlot
      ? recoverSlot.startsWith("manual-")
        ? "manual"
        : "scheduled"
      : option("trigger");
    requireState(
      trigger === "manual" || trigger === "scheduled",
      "weekly_trigger_required",
    );
    const rawBudget = option("budget");
    const budgetCredits =
      rawBudget === "auto" ? "auto" : Number(rawBudget || 0);
    if (command === "weekly-run")
      requireState(
        rawBudget &&
          (budgetCredits === "auto" ||
            (Number.isFinite(budgetCredits) && budgetCredits > 0)),
        "weekly_explicit_budget_required",
      );
    const result = await runWeeklyRuntime({
      trigger,
      live: command === "weekly-run",
      budgetCredits,
      recoverCollection: command === "weekly-recover-collection",
      recoverSlot,
    });
    print({
      status: result.status,
      slotId: result.slotId,
      blocker: result.blocker ?? null,
      reused: result.reused,
      requests: result.requests,
      activeAccounts: result.plan?.scope.activeCount ?? null,
      selectedAccounts: result.plan?.maximumAccounts ?? null,
      batchSizes: result.plan?.batches.map((batch) => batch.uids.length) ?? [],
      review: result.plan?.scope.review ?? [],
      cachedBatches: result.cachedBatches,
      pendingBatches: result.pendingBatches,
      collectedCandidates: result.snapshot?.candidates.length ?? 0,
      knownWithheld: result.snapshot?.knownWithheld?.length ?? 0,
      profileObservationsComplete:
        result.snapshot?.profileObservationsComplete ??
        (result.snapshot ? true : null),
      publicApplied: false,
    });
    if (result.status === "blocked") process.exitCode = 2;
  } else if (
    ["weekly-review", "weekly-apply", "weekly-recover-written"].includes(
      command,
    )
  ) {
    only(["slot"]);
    requireState(option("slot"), "weekly_existing_slot_required");
    const result = await runWeeklyRuntimeApplication({
      slotId: option("slot"),
      apply: command !== "weekly-review",
      recoverWritten: command === "weekly-recover-written",
    });
    print({
      ...result,
      appliedCount: result.applied.length,
      unchangedCount: result.unchanged.length,
    });
    if (result.status === "blocked") process.exitCode = 2;
  } else if (
    [
      "weekly-inspect-application-lock",
      "weekly-inspect-public-lock",
      "weekly-recover-application-lock",
      "weekly-recover-public-lock",
    ].includes(command)
  ) {
    const recovering = command.startsWith("weekly-recover-");
    const target = command.includes("application-lock")
      ? "application"
      : "public";
    only(recovering ? ["sha256"] : []);
    if (recovering) {
      requireState(option("sha256"), "weekly_lock_hash_required");
      print(await recoverWeeklyApplicationLock(target, option("sha256")));
    } else print(await inspectWeeklyApplicationLock(target));
  } else if (command === "weekly-recover-lock") {
    only(["sha256"]);
    requireState(option("sha256"), "weekly_lock_hash_required");
    const weeklyStore = await createPipelineStore(WEEKLY_RUNTIME_ROOT);
    print(await weeklyStore.recoverLock("weekly", option("sha256")));
  } else {
    const store = await createPipelineStore(resolve(stage, "private/store"));
    if (command === "import") {
      only(["file", "run"]);
      requireState(option("file") && option("run"), "file_and_run_required");
      const result = await archiveImport(
        store,
        await readStageFile(stage, option("file")),
        registry,
        option("run"),
      );
      const report = result.report as {
        candidates: unknown[];
        reviews: unknown[];
        inWindowCandidateIds: string[];
        focusCandidateIds: string[];
      };
      print({
        status: result.status,
        runId: result.runId,
        reused: result.reused,
        candidates: report.candidates.length,
        inWindow: report.inWindowCandidateIds.length,
        focus: report.focusCandidateIds.length,
        reviewItems: report.reviews.length,
        publicApplied: false,
      });
    } else if (command === "collect-public") {
      only(["source"]);
      requireState(option("source"), "source_required");
      const result = await collectPublicRun(store, registry, option("source"));
      print({
        status: result.status,
        runId: result.runId,
        reused: result.reused,
        requests: result.requests,
        publicApplied: false,
      });
    } else if (command === "review") {
      only(["run"]);
      requireState(option("run"), "run_required");
      const run = await store.readRun("activities", option("run"));
      requireState(run.status === "complete", "activity_run_not_complete");
      print(JSON.parse(run.files["review.json"].toString("utf8")));
    } else if (
      command === "apply-events" ||
      command === "recover-written-events"
    ) {
      only(["run", "draft"]);
      requireState(option("run"), "run_required");
      print(
        await applyActivityRun(
          stage,
          store,
          registry,
          option("run"),
          option("draft")
            ? await readStageFile(stage, option("draft"))
            : undefined,
          { recoverWrittenOutput: command === "recover-written-events" },
        ),
      );
    } else if (command === "weekly-inspect") {
      only(["week", "archive"]);
      requireState(
        option("week") && option("archive"),
        "week_and_archive_required",
      );
      const dataText = (await readStageFile(stage, "site/data.js")).toString(
        "utf8",
      );
      const match = /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(
        dataText,
      );
      requireState(match, "invalid_display_groups");
      const result = await inspectWeeklyApplication({
        archiveRoot: option("archive"),
        weekId: option("week").startsWith("week-")
          ? option("week")
          : `week-${option("week")}`,
        displayGroups: JSON.parse(match[1]).groups,
        current: JSON.parse(
          (
            await readStageFile(
              stage,
              "site/data/follower-observations.v1.json",
            )
          ).toString("utf8"),
        ),
      });
      const bytes = encode(result),
        runId = `weekly-${option("week")}-${sha256(bytes).slice(0, 16)}`;
      await store.withStoreLock("weekly-inspection", () =>
        store.commitRun(
          "weekly-inspection",
          runId,
          { "result.json": bytes },
          { weekId: option("week"), live: false },
        ),
      );
      print({
        runId,
        status: result.status,
        appliedCandidates: result.applied.length,
        review: result.review.length,
        errors: result.errors,
        publicApplied: false,
        paidCollection: "requires_current_returned_item_contract_and_adapter",
      });
      if (result.status === "blocked") process.exitCode = 2;
    } else if (command === "inspect-store") {
      only([]);
      for (const kind of [
        "activities",
        "application-plans",
        "applications",
        "weekly-inspection",
      ])
        print({
          kind,
          runs: (await store.listRuns(kind)).map((run) => ({
            runId: run.runId,
            status: run.status,
            ...(run.status === "complete"
              ? { intentSha256: run.intentSha256 }
              : { problems: run.problems }),
          })),
        });
    } else if (command === "recover-lock") {
      only(["scope", "sha256"]);
      print(await store.recoverLock(option("scope"), option("sha256")));
    } else throw new Error("unknown_cli_command");
  }
} catch (error) {
  // 只输出受控错误，不回显响应体、URL查询、环境或栈中的会话状态。
  const code =
    object(error) && typeof error.code === "string"
      ? error.code
      : error instanceof Error && /^[a-z0-9_:.-]+$/iu.test(error.message)
        ? error.message
        : "pipeline_failed_see_local_review";
  print({ status: "blocked", code });
  process.exitCode = 1;
}

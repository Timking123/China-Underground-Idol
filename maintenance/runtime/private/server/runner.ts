import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Incident } from "./notify.ts";
import { sendMaintenanceIncident } from "./incident.ts";
import {
  listDirectories,
  privateDirectory,
  readOptional,
  safeFailure,
  writeOnce,
} from "./state.ts";
import { requireState } from "../src/sourceRegistry.ts";

const STAGE = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "/srv/china-underground-idol/maintenance";
const STATE = resolve(BASE, "state");
const REPO = resolve(BASE, "repo");
const PROFILE = resolve(STATE, "browser-profile");
const day = (now = new Date()): string =>
  new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

async function notify(incident: Omit<Incident, "message">) {
  const result = await sendMaintenanceIncident(incident, {
    stateRoot: STATE,
    sendKey: process.env.SERVERCHAN_SENDKEY,
  });
  console.log(
    JSON.stringify({ notification: result.status, code: result.code }),
  );
  return result;
}

async function health() {
  const now = new Date();
  if (await readOptional(resolve(STATE, "publish/pending.json")))
    await notify({
      runId: `health-${day()}`,
      kind: "health",
      code: "publication_unconfirmed",
      source: "publication",
      action: "inspect_logs",
    });
  for (const [kind, maximumAge] of [
    ["daily", 27 * 3600_000],
    ["weekly", 8 * 86400_000],
  ] as const) {
    if (
      kind === "weekly" &&
      now.getTime() < Date.parse("2026-09-12T00:00:00+08:00")
    )
      continue;
    const names = (await listDirectories(resolve(STATE, "runs"))).filter(
      (name) => name.startsWith(`${kind}-`),
    );
    const name = names.at(-1);
    const receipt = name
      ? await readOptional(resolve(STATE, "runs", name, "receipt.json"))
      : null;
    if (
      !receipt ||
      receipt.status !== "complete" ||
      typeof receipt.finishedAt !== "string" ||
      now.getTime() - Date.parse(receipt.finishedAt) > maximumAge
    )
      await notify({
        runId: `health-${day()}`,
        kind: "health",
        code: "scheduled_run_missing",
        source: kind,
        action: "inspect_logs",
      });
  }
  const response = await fetch("https://idol.hi-veblen.com/manifest.sha256", {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { "Cache-Control": "no-cache" },
  });
  requireState(response.ok, "public_site_unavailable");
  const manifest = await response.text();
  requireState(
    manifest.length > 1000 &&
      manifest.length < 2_000_000 &&
      /^[a-f0-9]{64} {2}/u.test(manifest),
    "public_manifest_invalid",
  );
  return { status: "complete", checkedAt: now.toISOString() };
}

async function maintenance(kind: "daily" | "weekly") {
  let slot = day();
  if (kind === "weekly") {
    const { weeklySlot } = await import("../src/weeklyScope.ts");
    slot = weeklySlot("scheduled", new Date()).date;
  }
  const runId = `${kind}-${slot}`;
  const folder = resolve(STATE, "runs", runId);
  const existing = await readOptional(resolve(folder, "receipt.json"));
  if (existing) {
    requireState(existing.status === "complete", "failed_run_requires_review");
    return { runId, reused: true, status: "complete" };
  }
  requireState(
    !(await readOptional(resolve(folder, "attempt.json"))),
    "unfinished_run_requires_review",
  );
  await writeOnce(resolve(folder, "attempt.json"), {
    schemaVersion: "idol-server-attempt-v1",
    runId,
    kind,
    startedAt: new Date().toISOString(),
  });
  try {
    let changed = false;
    let result: unknown;
    const incidents: { code: string; source?: string; action?: string }[] = [];
    if (kind === "daily") {
      const { runDaily } = await import("./daily.ts");
      const daily = await runDaily({
        stageRoot: STAGE,
        stateRoot: STATE,
        profileRoot: PROFILE,
      });
      changed = daily.changed;
      result = daily;
      incidents.push(...daily.incidents);
    } else {
      const { assertWeeklyApplicationReady } =
        await import("./weeklyPreflight.ts");
      await assertWeeklyApplicationReady(STAGE, STATE);
      const { runWeeklyRuntime } = await import("../src/weeklyRuntime.ts");
      const planned = await runWeeklyRuntime({
        trigger: "scheduled",
        live: false,
      });
      requireState(
        planned.status !== "blocked",
        planned.blocker ?? "weekly_plan_blocked",
      );
      if (planned.status !== "complete") {
        const { refreshWeeklyPrice } = await import("./weeklyProbe.ts");
        await refreshWeeklyPrice({ stageRoot: STAGE, profileRoot: PROFILE });
      }
      const collection =
        planned.status === "complete"
          ? planned
          : await runWeeklyRuntime({
              trigger: "scheduled",
              live: true,
              budgetCredits: "auto",
            });
      requireState(
        collection.status === "complete" && collection.slotId,
        collection.blocker ?? "weekly_collection_blocked",
      );
      const { runWeeklyRuntimeApplication } =
        await import("../src/weeklyRuntimeApplication.ts");
      const application = await runWeeklyRuntimeApplication({
        slotId: collection.slotId,
        apply: true,
      });
      requireState(
        application.status === "complete",
        application.blocker ?? "weekly_application_blocked",
      );
      changed = application.changed === true;
      result = {
        collection: {
          slotId: collection.slotId,
          requests: collection.requests,
          cachedBatches: collection.cachedBatches,
          reused: collection.reused,
        },
        application,
      };
      if (application.review.length)
        incidents.push({
          code: "weekly_changes_need_review",
          source: "weekly",
          action: "review_changes",
        });
    }
    let publication: unknown = { changed: false };
    {
      const { preparePublication } = await import("./publisher.ts");
      publication = await preparePublication({
        stageRoot: STAGE,
        repoRoot: REPO,
        stateRoot: STATE,
        runId,
      });
    }
    // 同类来源故障合并一次通知；具名来源与细节保留在私有回执。
    for (const incident of new Map(
      incidents.map((item) => [item.code, item]),
    ).values())
      await notify({
        runId,
        kind,
        code: incident.code,
        source: kind,
        action: incident.action ?? "inspect_logs",
      });
    const receipt = {
      schemaVersion: "idol-server-run-v1",
      runId,
      status: "complete",
      changed,
      result,
      publication,
      finishedAt: new Date().toISOString(),
    };
    await writeOnce(resolve(folder, "receipt.json"), receipt);
    return { runId, status: "complete", changed, incidents: incidents.length };
  } catch (error) {
    const code = safeFailure(error);
    await writeOnce(resolve(folder, "receipt.json"), {
      schemaVersion: "idol-server-run-v1",
      runId,
      status: "blocked",
      code,
      finishedAt: new Date().toISOString(),
    });
    await notify({
      runId,
      kind: "service",
      code: "maintenance_failed",
      source: kind,
      action: "inspect_logs",
    });
    throw new Error(code, { cause: error });
  }
}

async function main() {
  await privateDirectory(STATE);
  const command = process.argv[2];
  if (command === "publish-result") {
    const { consumePublication } = await import("./publicationReceipt.ts");
    console.log(
      JSON.stringify(
        await consumePublication(
          STATE,
          "/srv/china-underground-idol/maintenance-receipts",
        ),
      ),
    );
    return;
  }
  if (command === "service-failure") {
    if (process.env.SERVICE_RESULT && process.env.SERVICE_RESULT !== "success")
      await notify({
        runId: `service-${day()}`,
        kind: "service",
        code: "maintenance_failed",
        source: process.argv[3] ?? "maintenance",
        action: "inspect_logs",
      });
    return;
  }
  requireState(
    ["daily", "weekly", "health"].includes(command),
    "unknown_maintenance_command",
  );
  console.log(
    JSON.stringify(
      command === "health"
        ? await health()
        : await maintenance(command as "daily" | "weekly"),
    ),
  );
}

main().catch(async (error: unknown) => {
  const code = safeFailure(error);
  console.error(JSON.stringify({ status: "blocked", code }));
  process.exitCode = 1;
});

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readStageFile } from "./pipeline.ts";
import { object, requireState } from "./sourceRegistry.ts";
import { WEEKLY_ARCHIVE, WEEKLY_STAGE } from "./weeklyScope.ts";
import {
  parseWeeklyProviderPrice,
  parseWeeklyManagementEvidence,
  projectWeeklyCommand,
  resolveCurrentWeeklyCapability,
  weeklyEvidenceBytes,
  WEEKLY_MANAGEMENT_COMMANDS,
  WEEKLY_PROVIDER_FILES,
  type WeeklyCapability,
  type WeeklyManagementKind,
  type WeeklyRawResponse,
} from "./weeklyContract.ts";

type ManagementHelpers = {
  resolveCliEntrypoint: () => Promise<{ entrypoint: string; version: string }>;
  createCliEnvironment: () => NodeJS.ProcessEnv;
  projectCliSuccessPayload: (
    args: string[],
    payload: unknown,
  ) => Record<string, unknown>;
};

function managementPayload(raw: WeeklyRawResponse): Record<string, unknown> {
  requireState(
    raw.cliVersion === "0.9.1" &&
      raw.exitCode === 0 &&
      !raw.timedOut &&
      raw.signal === null &&
      raw.stderr.trim() === "",
    "weekly_management_query_failed",
  );
  let value: unknown;
  try {
    value = JSON.parse(raw.stdout);
  } catch {
    throw new Error("invalid_weekly_management_json");
  }
  requireState(object(value), "invalid_weekly_management_payload");
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!object(current)) {
      if (Array.isArray(current)) pending.push(...current);
      continue;
    }
    requireState(
      current.success !== false &&
        current.ok !== false &&
        !current.error &&
        !current.error_code,
      "weekly_management_error_payload",
    );
    pending.push(...Object.values(current));
  }
  return value;
}

function runManagement(
  cli: { entrypoint: string; version: string },
  environment: NodeJS.ProcessEnv,
  args: string[],
): Promise<WeeklyRawResponse> {
  return new Promise((done) => {
    try {
      execFile(
        process.execPath,
        [cli.entrypoint, ...args],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 90_000,
          maxBuffer: 16 * 1024 * 1024,
          env: environment,
        },
        (error, stdout, stderr) => {
          done({
            cliVersion: cli.version,
            stdout,
            stderr,
            exitCode: error
              ? typeof error.code === "number"
                ? error.code
                : 1
              : 0,
            timedOut: Boolean(error?.killed),
            signal: error?.signal ?? null,
          });
        },
      );
    } catch {
      throw new Error("weekly_management_start_failed");
    }
  });
}

/** 固定价目路径、固定三个管理查询；无调用者证据注入、业务请求或自动重试。 */
export async function collectCurrentWeeklyProviderCapability(): Promise<{
  capability: WeeklyCapability;
  files: Record<string, Buffer>;
}> {
  let priceBytes: Buffer;
  try {
    priceBytes = await readStageFile(
      WEEKLY_STAGE,
      "private/provider-price/current.json",
      1024 * 1024,
    );
  } catch (error) {
    if (object(error) && error.code === "ENOENT")
      throw new Error("current_returned_item_price_unavailable", {
        cause: error,
      });
    throw error;
  }
  const price = parseWeeklyProviderPrice(priceBytes, new Date());
  // 必须先完成价目新鲜度校验，再加载和调用管理依赖；不使用旧恒阻塞 probe。
  const helpers = (await import(
    pathToFileURL(resolve(WEEKLY_ARCHIVE, "tools/collect_weibo_official.mjs"))
      .href
  )) as ManagementHelpers;
  const cli = await helpers.resolveCliEntrypoint();
  requireState(cli.version === "0.9.1", "untrusted_weekly_cli_version");
  const environment = helpers.createCliEnvironment();
  const files: Record<string, Buffer> = {
    [WEEKLY_PROVIDER_FILES.price]: priceBytes,
  };
  for (const kind of Object.keys(
    WEEKLY_MANAGEMENT_COMMANDS,
  ) as WeeklyManagementKind[]) {
    const startedAt = new Date().toISOString();
    parseWeeklyProviderPrice(priceBytes, new Date(startedAt));
    const command = [...WEEKLY_MANAGEMENT_COMMANDS[kind]];
    const raw = await runManagement(cli, environment, command);
    const payload = managementPayload(raw);
    const projection =
      kind === "command"
        ? projectWeeklyCommand(payload)
        : helpers.projectCliSuccessPayload(command, payload);
    // doctor/me 仅保存既有身份白名单；凭据及未经投影的身份 stdout 不进入归档。
    const bytes = weeklyEvidenceBytes({
      schemaVersion: "idol-weekly-management-evidence-v1",
      command,
      startedAt,
      observedAt: new Date().toISOString(),
      cliVersion: "0.9.1",
      exitCode: 0,
      timedOut: false,
      signal: null,
      stderr: "",
      projection,
    });
    const proof = parseWeeklyManagementEvidence(bytes, kind, new Date());
    if (kind !== "command")
      requireState(
        proof.projection.accountScopeHash === price.accountScopeHash,
        "provider_account_scope_mismatch",
      );
    files[WEEKLY_PROVIDER_FILES[kind]] = bytes;
  }
  return {
    capability: resolveCurrentWeeklyCapability(files, new Date()),
    files,
  };
}

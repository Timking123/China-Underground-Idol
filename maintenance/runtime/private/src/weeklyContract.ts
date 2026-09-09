import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import { WEEKLY_LIMITS } from "./weeklyScope.ts";

export interface WeeklyCapability {
  schemaVersion: "idol-weekly-capability-v2";
  evidenceKind: "provider" | "synthetic";
  accountScope: string;
  serviceKind: "formal_active";
  commandId: 318;
  command: "users/show_batch/other";
  billingUnit: "returned_item";
  unitCost: number;
  balance: number;
  observedAt: string;
  priceObservedAt: string;
  evidence: { path: string; sha256: string }[];
}
export interface WeeklyRawResponse {
  cliVersion: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  signal: string | null;
}
export interface WeeklyProfile {
  uid: string;
  followersValue: number;
  displayName: string | null;
}

/** 原始字节只落入私有归档；凭据形态拒绝写盘，不输出被拒绝的值。 */
export function weeklyEvidenceBytes(value: unknown): Buffer {
  const text = encode(value);
  requireState(
    Buffer.byteLength(text) <= 16 * 1024 * 1024,
    "weekly_evidence_too_large",
  );
  const pending: unknown[] = [value];
  const seen = new Set<string>();
  const key =
    /^(?:(?:access|refresh|csrf)[_-]?)?token$|^(?:authorization|set[-_]?cookie|cookie|password|client[_-]?secret)$/iu;
  const secret =
    /\b(?:authorization|set[-_]?cookie|cookie|access[_-]?token|refresh[_-]?token|csrf[_-]?token|client[_-]?secret|password)\s*["']?\s*[:=]|\bbearer\s+[a-z0-9._~-]{8,}|\b(?:wb_|at_|rt_)[a-zA-Z0-9_-]{20,}/iu;
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (seen.has(current)) continue;
      seen.add(current);
      requireState(!secret.test(current), "sensitive_weekly_evidence_rejected");
      if (["{", "[", '"'].includes(current.trimStart()[0])) {
        try {
          pending.push(JSON.parse(current));
        } catch {
          /* 自由文本已核查，不改变其编码。 */
        }
      }
    } else if (current && typeof current === "object") {
      for (const [name, child] of Object.entries(current)) {
        requireState(!key.test(name), "sensitive_weekly_evidence_rejected");
        pending.push(child);
      }
    }
  }
  return Buffer.from(text, "utf8");
}

export function weeklyProfileArguments(uids: readonly string[]): string[] {
  requireState(
    uids.length > 0 &&
      uids.length <= 50 &&
      new Set(uids).size === uids.length &&
      uids.every((uid) => /^\d{4,20}$/u.test(uid)),
    "invalid_weekly_query_uids",
  );
  return [
    "users",
    "show_batch/other",
    `--uids=${uids.join(",")}`,
    "--output",
    "json",
  ];
}

/** 以完整请求 UID 集合核验响应；昵称更名不改变已核对 UID，也不改账号身份。 */
export function extractWeeklyProfiles(
  raw: unknown,
  expectedUids: readonly string[],
): WeeklyProfile[] {
  weeklyProfileArguments(expectedUids);
  weeklyEvidenceBytes(raw);
  requireState(
    object(raw) &&
      Object.keys(raw).sort().join(",") ===
        "cliVersion,exitCode,signal,stderr,stdout,timedOut" &&
      raw.cliVersion === "0.9.1" &&
      typeof raw.stdout === "string" &&
      typeof raw.stderr === "string" &&
      Number.isInteger(raw.exitCode) &&
      typeof raw.timedOut === "boolean" &&
      (raw.signal === null || typeof raw.signal === "string"),
    "invalid_weekly_cli_response",
  );
  requireState(
    !raw.timedOut && raw.signal === null,
    "weekly_request_outcome_uncertain",
  );
  requireState(raw.exitCode === 0, "weekly_cli_failed");
  requireState(raw.stderr.trim() === "", "unexpected_weekly_cli_stderr");
  const payload: unknown = JSON.parse(raw.stdout);
  requireState(
    object(payload) || Array.isArray(payload),
    "invalid_weekly_response_payload",
  );
  const found = new Map<string, WeeklyProfile>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!object(value)) return;
    requireState(
      value.success !== false &&
        value.ok !== false &&
        !value.error &&
        !value.error_code,
      "weekly_business_error_response",
    );
    if ("followers_count" in value) {
      const aliases = [value.idstr, value.uid, value.id].filter(
        (item) => item != null,
      );
      requireState(
        aliases.length > 0 &&
          aliases.every(
            (item) => typeof item === "string" || Number.isSafeInteger(item),
          ),
        "unsafe_weekly_uid",
      );
      const uid = String(aliases[0]);
      requireState(
        aliases.every((item) => String(item) === uid) &&
          expectedUids.includes(uid) &&
          !found.has(uid),
        "weekly_uid_mismatch_or_duplicate",
      );
      requireState(
        typeof value.followers_count === "number" &&
          Number.isSafeInteger(value.followers_count) &&
          value.followers_count >= 0,
        "invalid_weekly_followers_count",
      );
      requireState(
        value.screen_name == null || typeof value.screen_name === "string",
        "invalid_weekly_display_name",
      );
      found.set(uid, {
        uid,
        followersValue: value.followers_count,
        displayName:
          typeof value.screen_name === "string" ? value.screen_name : null,
      });
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  requireState(
    found.size === expectedUids.length,
    "incomplete_weekly_response",
  );
  return expectedUids.map((uid) => found.get(uid)!);
}

/** 预算只计算最大可能使用量，不能把它标记为供应方已扣费金额。 */
export function weeklyBudget(
  capability: WeeklyCapability,
  accounts: number,
  budget: number | "auto",
  now: Date,
  mode: "provider" | "synthetic",
): { maximumCredits: number; budgetCredits: number; reserveCredits: number } {
  requireState(
    capability.schemaVersion === "idol-weekly-capability-v2" &&
      capability.evidenceKind === mode &&
      capability.serviceKind === "formal_active" &&
      /^[a-f0-9]{16}$/u.test(capability.accountScope) &&
      capability.commandId === 318 &&
      capability.command === "users/show_batch/other" &&
      capability.billingUnit === "returned_item",
    "invalid_weekly_capability",
  );
  requireState(
    isTimestamp(capability.observedAt) &&
      isTimestamp(capability.priceObservedAt) &&
      Date.parse(capability.observedAt) <= now.getTime() &&
      now.getTime() - Date.parse(capability.observedAt) <= 5 * 60_000 &&
      Date.parse(capability.priceObservedAt) <= now.getTime() &&
      now.getTime() - Date.parse(capability.priceObservedAt) <= 30 * 60_000,
    "stale_weekly_capability",
  );
  requireState(
    typeof capability.unitCost === "number" &&
      capability.unitCost > 0 &&
      Number.isSafeInteger(capability.unitCost * 1_000_000) &&
      typeof capability.balance === "number" &&
      capability.balance >= 0 &&
      Number.isSafeInteger(capability.balance * 1_000_000) &&
      Number.isSafeInteger(accounts) &&
      accounts >= 0,
    "unknown_weekly_cost_or_balance",
  );
  requireState(
    capability.evidence.length > 0 &&
      capability.evidence.every(
        (item) =>
          typeof item.path === "string" && /^[a-f0-9]{64}$/u.test(item.sha256),
      ),
    "weekly_capability_evidence_missing",
  );
  const micros = accounts * Math.round(capability.unitCost * 1_000_000);
  requireState(Number.isSafeInteger(micros), "weekly_cost_overflow");
  const maximumCredits = micros / 1_000_000;
  const budgetCredits = budget === "auto" ? maximumCredits : budget;
  requireState(
    typeof budgetCredits === "number" &&
      Number.isFinite(budgetCredits) &&
      budgetCredits >= maximumCredits &&
      capability.balance - maximumCredits >= WEEKLY_LIMITS.reserveCredits,
    "weekly_budget_or_reserve_exceeded",
  );
  return {
    maximumCredits,
    budgetCredits,
    reserveCredits: WEEKLY_LIMITS.reserveCredits,
  };
}

export const WEEKLY_PROVIDER_FILES = Object.freeze({
  price: "provider-price.json",
  doctor: "doctor.json",
  me: "me.json",
  command: "profile-command.json",
});
export const WEEKLY_MANAGEMENT_COMMANDS = Object.freeze({
  doctor: ["doctor", "--output", "json"],
  me: ["me", "--output", "json"],
  command: [
    "commands",
    "show",
    "users",
    "show_batch/other",
    "--output",
    "json",
  ],
});
export type WeeklyManagementKind = keyof typeof WEEKLY_MANAGEMENT_COMMANDS;
export interface WeeklyProviderPrice {
  schemaVersion: "idol-weekly-provider-price-v1";
  observedAt: string;
  accountScopeHash: string;
  serviceKind: "formal_active";
  displayPrice: "3C/条";
  targetMatchCount: 1;
  target: Record<string, unknown>;
  sources: Record<string, { url: string; status: 200 }>;
}
export interface WeeklyManagementEvidence {
  schemaVersion: "idol-weekly-management-evidence-v1";
  command: string[];
  startedAt: string;
  observedAt: string;
  cliVersion: "0.9.1";
  exitCode: 0;
  timedOut: false;
  signal: null;
  stderr: "";
  projection: Record<string, unknown>;
}

function exactKeys(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is Record<string, unknown> {
  return (
    object(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}

function providerJson(bytes: unknown): Record<string, unknown> {
  requireState(
    Buffer.isBuffer(bytes) && bytes.length <= 16 * 1024 * 1024,
    "invalid_provider_evidence_bytes",
  );
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("invalid_provider_evidence_json");
  }
  weeklyEvidenceBytes(value);
  requireState(object(value), "invalid_provider_evidence_object");
  return value;
}

/** 浏览器白名单投影的实际观察时间不可在读取或重放时重盖。 */
export function parseWeeklyProviderPrice(
  bytes: unknown,
  now: Date,
): WeeklyProviderPrice {
  const value = providerJson(bytes);
  requireState(
    exactKeys(value, [
      "schemaVersion",
      "observedAt",
      "accountScopeHash",
      "serviceKind",
      "displayPrice",
      "targetMatchCount",
      "target",
      "sources",
    ]) &&
      value.schemaVersion === "idol-weekly-provider-price-v1" &&
      typeof value.accountScopeHash === "string" &&
      /^[a-f0-9]{16}$/u.test(value.accountScopeHash) &&
      value.serviceKind === "formal_active" &&
      value.displayPrice === "3C/条" &&
      value.targetMatchCount === 1,
    "invalid_current_provider_price",
  );
  requireState(
    isTimestamp(value.observedAt) &&
      Number.isFinite(now.getTime()) &&
      Date.parse(value.observedAt) <= now.getTime() &&
      now.getTime() - Date.parse(value.observedAt) <= 30 * 60_000,
    "stale_current_provider_price",
  );
  const target = value.target;
  requireState(
    exactKeys(target, [
      "id",
      "group",
      "action",
      "apiPath",
      "api_path",
      "title",
      "description",
      "trialEnabled",
      "isMyself",
      "billingType",
      "pricePerUnit",
      "extraConfig",
    ]) &&
      target.id === "318" &&
      target.group === "users" &&
      target.action === "show_batch/other" &&
      target.apiPath === "users/show_batch/other" &&
      target.api_path === "users/show_batch/other" &&
      target.title === "批量获取其他用户的基本信息" &&
      target.description === target.title &&
      target.trialEnabled === true &&
      target.isMyself === false &&
      target.billingType === 1 &&
      target.pricePerUnit === 3 &&
      target.extraConfig === "",
    "unsupported_current_provider_billing",
  );
  const urls: Record<string, string> = {
    plan: "https://open.weibo.com/cli/plan#services",
    commands: "https://open.weibo.com/cli/api/me/commands",
    account: "https://open.weibo.com/cli/api/auth/me",
    subscription: "https://open.weibo.com/cli/api/me/billing/subscription",
  };
  requireState(
    exactKeys(value.sources, Object.keys(urls)),
    "invalid_provider_price_sources",
  );
  for (const [key, url] of Object.entries(urls)) {
    const source = value.sources[key];
    requireState(
      exactKeys(source, ["url", "status"]) &&
        source.url === url &&
        source.status === 200,
      "invalid_provider_price_sources",
    );
  }
  return value as unknown as WeeklyProviderPrice;
}

/** CLI 命令定义只接受已实读的白名单；50来自原说明，调用端另有硬上限。 */
export function projectWeeklyCommand(
  payload: unknown,
): Record<string, unknown> {
  requireState(
    exactKeys(payload, ["command"]),
    "invalid_provider_command_envelope",
  );
  const command = payload.command;
  requireState(
    exactKeys(
      command,
      [
        "id",
        "group",
        "action",
        "name",
        "api_path",
        "invocation_path",
        "method",
        "title",
        "description",
        "required_fields",
        "input_schema",
        "flags",
        "trial_enabled",
        "status",
        "created_at",
        "updated_at",
      ],
      ["access"],
    ) &&
      command.id === "318" &&
      command.group === "users" &&
      command.action === "show_batch/other" &&
      command.name === "users show_batch/other" &&
      command.api_path === "users/show_batch/other" &&
      command.invocation_path === "/users/show_batch/other.json" &&
      command.method === "GET" &&
      command.title === "批量获取其他用户的基本信息" &&
      command.description === command.title &&
      command.status === "active" &&
      command.trial_enabled === true &&
      (command.access === undefined || command.access === "allowed") &&
      Array.isArray(command.required_fields) &&
      command.required_fields.length === 0 &&
      exactKeys(command.input_schema, ["uids", "screen_name"]) &&
      command.input_schema.uids === "string" &&
      command.input_schema.screen_name === "string" &&
      isTimestamp(command.created_at) &&
      isTimestamp(command.updated_at) &&
      Array.isArray(command.flags) &&
      command.flags.length === 2,
    "provider_profile_command_unavailable",
  );
  const seen = new Set<string>();
  for (const flag of command.flags) {
    requireState(
      exactKeys(flag, ["name", "type", "required", "description"]) &&
        (flag.name === "uids" || flag.name === "screen_name") &&
        !seen.has(flag.name) &&
        flag.type === "string" &&
        flag.required === false &&
        flag.description ===
          (flag.name === "uids"
            ? "需要查询的用户ID，用半角逗号分隔，一次最多50个。"
            : "需要查询的用户昵称，用半角逗号分隔，一次最多50个。"),
      "provider_uids_limit_unconfirmed",
    );
    seen.add(flag.name);
  }
  weeklyEvidenceBytes(payload);
  return structuredClone(payload);
}

export function parseWeeklyManagementEvidence(
  bytes: unknown,
  kind: WeeklyManagementKind,
  now: Date,
): WeeklyManagementEvidence {
  const value = providerJson(bytes);
  requireState(
    exactKeys(value, [
      "schemaVersion",
      "command",
      "startedAt",
      "observedAt",
      "cliVersion",
      "exitCode",
      "timedOut",
      "signal",
      "stderr",
      "projection",
    ]) &&
      value.schemaVersion === "idol-weekly-management-evidence-v1" &&
      encode(value.command) === encode(WEEKLY_MANAGEMENT_COMMANDS[kind]) &&
      value.cliVersion === "0.9.1" &&
      value.exitCode === 0 &&
      value.timedOut === false &&
      value.signal === null &&
      value.stderr === "" &&
      object(value.projection),
    "invalid_provider_management_evidence",
  );
  requireState(
    isTimestamp(value.startedAt) &&
      isTimestamp(value.observedAt) &&
      Date.parse(value.startedAt) <= Date.parse(value.observedAt) &&
      Date.parse(value.observedAt) <= now.getTime() &&
      now.getTime() - Date.parse(value.startedAt) <= 5 * 60_000,
    "stale_provider_management_evidence",
  );
  if (kind === "command") projectWeeklyCommand(value.projection);
  else {
    const projection = value.projection;
    requireState(
      exactKeys(
        projection,
        kind === "doctor"
          ? [
              "schemaVersion",
              "ready",
              "steps",
              "service_status",
              "accountScopeHash",
            ]
          : ["schemaVersion", "ready", "service_status", "accountScopeHash"],
      ) &&
        projection.schemaVersion === `weibo-cli-${kind}-cache-v1` &&
        typeof projection.ready === "boolean" &&
        typeof projection.accountScopeHash === "string" &&
        /^[a-f0-9]{16}$/u.test(projection.accountScopeHash),
      "invalid_provider_identity_projection",
    );
    if (kind === "doctor")
      requireState(
        projection.ready === true &&
          exactKeys(projection.steps, [
            "login",
            "developer_verification",
            "service",
          ]) &&
          Object.values(projection.steps).every((step) => step === true),
        "provider_account_not_ready",
      );
    // me 原响应不带 ready；旧白名单投影的 false 不是登录失败证据。
    const service = projection.service_status;
    requireState(
      exactKeys(service, ["kind", "balance"], ["remaining_calls"]) &&
        service.kind === "formal_active" &&
        typeof service.balance === "number" &&
        service.balance >= WEEKLY_LIMITS.reserveCredits &&
        Number.isSafeInteger(service.balance * 1_000_000) &&
        (service.remaining_calls === undefined ||
          (typeof service.remaining_calls === "number" &&
            Number.isSafeInteger(service.remaining_calls) &&
            service.remaining_calls >= 0)),
      "provider_formal_service_or_balance_unavailable",
    );
  }
  return value as unknown as WeeklyManagementEvidence;
}

/** 从价目投影与三份完整管理证据重建合同；不接受裸费用对象或仅哈希自证。 */
export function resolveCurrentWeeklyCapability(
  files: unknown,
  now: Date,
): WeeklyCapability {
  requireState(
    exactKeys(files, Object.values(WEEKLY_PROVIDER_FILES)) &&
      Object.values(files).every(Buffer.isBuffer),
    "current_returned_item_price_unavailable",
  );
  const price = parseWeeklyProviderPrice(
    files[WEEKLY_PROVIDER_FILES.price],
    now,
  );
  const evidence = (
    Object.keys(WEEKLY_MANAGEMENT_COMMANDS) as WeeklyManagementKind[]
  ).map((kind) =>
    parseWeeklyManagementEvidence(
      files[WEEKLY_PROVIDER_FILES[kind]],
      kind,
      now,
    ),
  );
  const [doctor, me, command] = evidence;
  requireState(
    doctor.projection.accountScopeHash === price.accountScopeHash &&
      me.projection.accountScopeHash === price.accountScopeHash,
    "provider_account_scope_mismatch",
  );
  requireState(
    Date.parse(doctor.startedAt) >= Date.parse(price.observedAt) &&
      Date.parse(me.startedAt) >= Date.parse(doctor.observedAt) &&
      Date.parse(command.startedAt) >= Date.parse(me.observedAt),
    "invalid_provider_management_order",
  );
  return {
    schemaVersion: "idol-weekly-capability-v2",
    evidenceKind: "provider",
    accountScope: price.accountScopeHash,
    serviceKind: "formal_active",
    commandId: 318,
    command: "users/show_batch/other",
    // 官方原文是 3C/条；returned_item 仅是完整返回条件下的本地适配语义。
    billingUnit: "returned_item",
    unitCost: 3,
    balance: Math.min(
      (doctor.projection.service_status as { balance: number }).balance,
      (me.projection.service_status as { balance: number }).balance,
    ),
    observedAt: doctor.startedAt,
    priceObservedAt: price.observedAt,
    evidence: Object.values(WEEKLY_PROVIDER_FILES).map((path) => ({
      path,
      sha256: sha256(files[path] as Buffer),
    })),
  };
}

export function weeklyObjectHash(value: unknown): string {
  return sha256(weeklyEvidenceBytes(value));
}

/** 重放按归档守卫时刻重建，而非用今天的时间使合法历史缓存过期。 */
export function validateWeeklyProviderCapability(
  capability: unknown,
  files: unknown,
  checkedAt: Date,
): void {
  requireState(
    encode(resolveCurrentWeeklyCapability(files, checkedAt)) ===
      encode(capability),
    "weekly_provider_capability_replay_mismatch",
  );
}

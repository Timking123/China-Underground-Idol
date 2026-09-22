import { normalizeRegionName, type GroupCatalog } from "../catalog/model.ts";
import { validateEventDataset, type EventRecord } from "../events/model.ts";

export interface FeedVerification {
  outcome: "unverified" | "partial" | "verified";
  fields: Record<string, "unverified" | "unannounced" | "verified">;
}
export interface FeedSnapshot {
  event: EventRecord;
  verification: FeedVerification | null;
  withdrawn: boolean;
}
export interface FeedScope {
  type: "group" | "city";
  id: string;
  label: string;
}
export interface FeedRevision {
  uid: string;
  sequence: number;
  createdAt: string;
  modifiedAt: string;
  fingerprint: string;
  snapshot: FeedSnapshot;
  scopes: FeedScope[];
}
export interface FeedState {
  schemaVersion: "idol-feed-state-v1";
  initializedAt: string;
  records: FeedRevision[];
}
export interface FeedManifestEntry extends FeedScope {
  path: string;
  eventCount: number;
}
export interface FeedManifest {
  schemaVersion: "idol-feed-manifest-v1";
  feeds: FeedManifestEntry[];
}

export const VERIFICATION_FIELDS = [
  "date",
  "status",
  "venue",
  "address",
  "opensAt",
  "startsAt",
  "endsAt",
] as const;

export function safeSourceUrl(value: string): string | null {
  if (/[\s\\]|%0[ad]/iu.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function validTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
  )
    return false;
  const time = new Date(value);
  return (
    Number.isFinite(time.getTime()) &&
    time.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

/** 规范对象键顺序，避免构建顺序改变被误报成编辑变更。 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function eventScopes(event: EventRecord): FeedScope[] {
  const groups = event.performers
    .filter((p) => p.groupId !== null)
    .map((p) => ({ type: "group" as const, id: p.groupId!, label: p.name }));
  const city = event.city ? normalizeRegionName(event.city) : "";
  return mergeScopes(
    groups,
    city ? [{ type: "city", id: city, label: city }] : [],
  );
}

export function mergeScopes(...lists: readonly FeedScope[][]): FeedScope[] {
  const map = new Map<string, FeedScope>();
  for (const scope of lists.flat()) map.set(`${scope.type}:${scope.id}`, scope);
  return [...map.values()].sort((a, b) =>
    `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`, "en"),
  );
}

export function feedPath(scope: FeedScope): string {
  if (scope.type === "group" && /^g\d{3,8}$/u.test(scope.id))
    return `feeds/v1/groups/${scope.id}.ics`;
  if (
    scope.type === "city" &&
    scope.id &&
    scope.id === normalizeRegionName(scope.id) &&
    scope.id.length <= 80 &&
    ![...scope.id].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    const hex = [...new TextEncoder().encode(scope.id)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `feeds/v1/cities/${hex}.ics`;
  }
  throw new Error("订阅范围不是合法团体或规范城市");
}

export function buildFeedManifest(
  catalog: GroupCatalog,
  state: FeedState,
): FeedManifest {
  const scopes = mergeScopes(
    catalog.groups.map((group) => ({
      type: "group",
      id: group.id,
      label: group.name,
    })),
    catalog.groups.flatMap((group) =>
      [group.activity.city, group.founding.city]
        .filter((city): city is string => Boolean(city))
        .map(normalizeRegionName)
        .filter(Boolean)
        .map((city) => ({ type: "city" as const, id: city, label: city })),
    ),
    state.records.flatMap((record) => record.scopes),
  );
  // 名称以当前主档为准；历史范围继续保留地址，防止改城或更名断订阅。
  const names = new Map(catalog.groups.map((group) => [group.id, group.name]));
  return {
    schemaVersion: "idol-feed-manifest-v1",
    feeds: scopes.map((scope) => ({
      ...scope,
      label:
        scope.type === "group"
          ? (names.get(scope.id) ?? scope.label)
          : scope.label,
      path: feedPath(scope),
      eventCount: recordsForScope(state, scope).length,
    })),
  };
}

export function recordsForScope(
  state: FeedState,
  scope: FeedScope,
): FeedRevision[] {
  return state.records.filter((record) =>
    record.scopes.some(
      (item) => item.type === scope.type && item.id === scope.id,
    ),
  );
}

/** 公开快照也必须过严格活动校验，不允许审计文件成为绕过输入校验的路径。 */
export function validateFeedState(input: unknown): FeedState {
  const state = input as FeedState;
  if (
    !state ||
    state.schemaVersion !== "idol-feed-state-v1" ||
    !validTimestamp(state.initializedAt) ||
    !Array.isArray(state.records) ||
    state.records.length > 20000
  )
    throw new Error("订阅状态版本或初始化时间无效");
  const ids = new Set<string>();
  for (const record of state.records) {
    const event = record?.snapshot?.event;
    if (
      !event ||
      ids.has(event.id) ||
      record.uid !== `${event.id}@idol-events.local` ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence < 0 ||
      !validTimestamp(record.createdAt) ||
      !validTimestamp(record.modifiedAt) ||
      Date.parse(record.modifiedAt) < Date.parse(record.createdAt) ||
      Date.parse(record.createdAt) < Date.parse(state.initializedAt) ||
      !/^[a-f0-9]{64}$/u.test(record.fingerprint) ||
      typeof record.snapshot.withdrawn !== "boolean" ||
      !Array.isArray(record.scopes)
    )
      throw new Error("订阅修订记录无效或重复");
    const result = validateEventDataset(
      {
        schemaVersion: "idol-events-v1",
        coverage: "partial",
        updatedAt: record.modifiedAt,
        events: [event],
      },
      event.performers
        .map((p) => p.groupId)
        .filter((id): id is string => id !== null),
    );
    if (!result.valid)
      throw new Error(
        `订阅快照无效：${result.errors.map((e) => e.path).join("、")}`,
      );
    for (const scope of record.scopes) {
      feedPath(scope);
      if (typeof scope.label !== "string" || !scope.label.trim())
        throw new Error("订阅标签无效");
    }
    const verification = record.snapshot.verification;
    if (
      verification !== null &&
      (!verification ||
        !["unverified", "partial", "verified"].includes(verification.outcome) ||
        !verification.fields ||
        Object.keys(verification.fields).length !==
          VERIFICATION_FIELDS.length ||
        VERIFICATION_FIELDS.some(
          (field) =>
            !["unverified", "unannounced", "verified"].includes(
              verification.fields[field],
            ),
        ))
    )
      throw new Error("订阅核验快照无效");
    ids.add(event.id);
  }
  return state;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/\r\n|\r|\n/gu, "\\n")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,");
}

/** RFC 5545 的 75 octets 限制包括续行空格，不能按 JS 字符数折行。 */
export function foldIcsLine(value: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += char;
    bytes += size;
  }
  lines.push(line);
  return lines.join("\r\n");
}

function stamp(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function buildSubscriptionIcs(
  scope: FeedScope,
  state: FeedState,
): string {
  validateFeedState(state);
  feedPath(scope);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//China Underground Idol//Subscriptions v1//ZH-CN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(`${scope.label} · 地偶演出`)}`,
  ];
  for (const record of recordsForScope(state, scope).sort((a, b) =>
    a.uid.localeCompare(b.uid, "en"),
  )) {
    const { event, withdrawn, verification } = record.snapshot;
    // 与既有手动导出的日程状态映射一致；字段核验不替代活动本身的状态。
    const status =
      event.status === "cancelled"
        ? "CANCELLED"
        : event.status === "scheduled"
          ? "CONFIRMED"
          : "TENTATIVE";
    const label = withdrawn
      ? "资料已撤下·非取消结论"
      : event.status === "cancelled"
        ? "已取消"
        : event.status === "postponed"
          ? "已延期·原日期占位"
          : event.status === "unconfirmed"
            ? "安排待确认"
            : "计划举行";
    const placeholder = event.startsAt === null || event.status === "postponed";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${record.uid}`,
      `DTSTAMP:${stamp(record.modifiedAt)}`,
      `CREATED:${stamp(record.createdAt)}`,
      `LAST-MODIFIED:${stamp(record.modifiedAt)}`,
      `SEQUENCE:${record.sequence}`,
    );
    if (placeholder) {
      lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/gu, "")}`);
    } else {
      lines.push(
        `DTSTART:${stamp(`${event.date}T${event.startsAt}:00+08:00`)}`,
      );
      if (event.endsAt !== null)
        lines.push(`DTEND:${stamp(`${event.date}T${event.endsAt}:00+08:00`)}`);
    }
    const description = [
      `状态：${label}。日期经过不等于实际举办。`,
      "中国当地时间 UTC+8；部分收录，出发前请核对官宣。",
      `字段核验：${verification?.outcome === "verified" ? "已核实" : verification?.outcome === "partial" ? "部分核实" : "尚未核实"}；不改变主档日程状态。`,
      ...(placeholder
        ? [
            event.status === "postponed"
              ? "延期记录保留原收录日期以便追踪；新安排请核对来源，不代表在该日举行。"
              : "整场开演时刻未知；日历中的日期占位不表示全天演出。",
          ]
        : []),
      ...(withdrawn
        ? ["当前资料已撤下，保留最后已知安排供追溯；来源缺席不等于取消。"]
        : []),
      ...(event.opensAt ? [`入场：${event.opensAt}`] : []),
      `收录阵容：${event.performers.map((p) => p.name).join("、") || "尚未收录"}`,
      `当前城市：${event.city ?? "尚未确认"}；订阅保留曾归属范围以传达更正。`,
      event.notes,
      ...event.sources.map(
        (source) =>
          `${source.label}（${source.publisher}；观察于 ${source.observedAt}）：${source.url}`,
      ),
      `资料修订：${record.modifiedAt}；序号 ${record.sequence}`,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      `SUMMARY:${escapeIcsText(`【${label}】${event.title}${placeholder ? "（日期占位）" : ""}`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText([event.city, event.venue, event.address].filter(Boolean).join(" · "))}`,
      `STATUS:${status}`,
      "TRANSP:TRANSPARENT",
      `URL:https://idol.hi-veblen.com/events.html?event=${encodeURIComponent(event.id)}`,
      "END:VEVENT",
    );
  }
  return `${[...lines, "END:VCALENDAR"].map(foldIcsLine).join("\r\n")}\r\n`;
}

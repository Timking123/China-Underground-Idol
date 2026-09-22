import type { EventRecord, EventSource, EventValidationError } from "./model";

export const VERIFICATION_FIELDS = [
  "date",
  "status",
  "venue",
  "address",
  "opensAt",
  "startsAt",
  "endsAt",
] as const;
export type VerificationField = (typeof VERIFICATION_FIELDS)[number];
export type VerificationState = "unverified" | "unannounced" | "verified";
const SNAPSHOT_FIELDS = [
  "title",
  "city",
  "province",
  ...VERIFICATION_FIELDS,
] as const;
export type EventVerificationSnapshot = Pick<
  EventRecord,
  (typeof SNAPSHOT_FIELDS)[number]
>;
export interface EventVerificationEvidence {
  url: string;
  publisher: string;
  role: EventSource["kind"];
  observedAt: string;
  result: "read" | "unavailable" | "insufficient";
  fields: VerificationField[];
  note: string;
}
export interface EventVerificationChange {
  field: VerificationField;
  previous: string | null;
  current: string | null;
  observedAt: string;
  sourceUrl: string;
  reason: string;
}
export interface EventVerificationRecord {
  eventId: string;
  snapshot: EventVerificationSnapshot;
  checkedAt: string;
  verifiedAt: string | null;
  outcome: "unverified" | "partial" | "verified";
  summary: string;
  fields: Record<VerificationField, VerificationState>;
  evidence: EventVerificationEvidence[];
  changes: EventVerificationChange[];
}
export interface EventVerificationDataset {
  schemaVersion: "idol-event-verifications-v1";
  updatedAt: string;
  coverage: "partial";
  records: EventVerificationRecord[];
}
export type EventVerificationResult =
  | { valid: true; data: EventVerificationDataset; errors: [] }
  | { valid: false; errors: EventValidationError[] };

export const SOURCE_ROLE_LABELS: Record<EventSource["kind"], string> = {
  official: "团体官号",
  organizer: "主办",
  venue: "场馆",
  ticketing: "票务",
  aggregator: "汇总线索",
  wiki: "百科资料",
};
export const VERIFICATION_FIELD_LABELS: Record<VerificationField, string> = {
  date: "日期",
  status: "举行安排",
  venue: "场馆",
  address: "地址",
  opensAt: "入场",
  startsAt: "开演",
  endsAt: "结束",
};
export const VERIFICATION_LABELS = {
  unverified: "尚未核实",
  partial: "部分信息已核验",
  verified: "核心安排已核验",
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown, limit = 1200): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit;
function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value,
    );
  if (
    !match ||
    match[0] !== value ||
    value.startsWith("0000") ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  if (/^[+-]14:/.test(match[2]!) && !match[2]!.endsWith(":00")) return false;
  return (
    new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) === match[1]
  );
}
function isUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^https?:\/\//i.test(value) ||
    /[\s\\]|%0[ad]/i.test(value)
  )
    return false;
  for (const char of value)
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
const isField = (value: unknown): value is VerificationField =>
  typeof value === "string" &&
  (VERIFICATION_FIELDS as readonly string[]).includes(value);

/** 快照只绑定核验范围；阵容不在本层确认范围，不做同名身份推断。 */
export function eventVerificationSnapshot(
  event: EventRecord,
): EventVerificationSnapshot {
  return {
    title: event.title,
    city: event.city,
    province: event.province,
    date: event.date,
    status: event.status,
    venue: event.venue,
    address: event.address,
    opensAt: event.opensAt,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  };
}
function matchesSnapshot(
  record: EventVerificationRecord,
  event: EventRecord,
): boolean {
  return (
    record.eventId === event.id &&
    SNAPSHOT_FIELDS.every((field) => record.snapshot[field] === event[field])
  );
}

/** 严格验证，补充层失败不能被当成“没有活动”或自动修正。 */
export function validateEventVerificationDataset(
  input: unknown,
  events: readonly EventRecord[],
): EventVerificationResult {
  const errors: EventValidationError[] = [];
  const fail = (path: string, message: string): void => {
    errors.push({ path, message });
  };
  const shape = (
    value: unknown,
    path: string,
    keys: readonly string[],
  ): value is Record<string, unknown> => {
    if (!isObject(value)) {
      fail(path, "必须为对象");
      return false;
    }
    for (const key of keys)
      if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "缺少必需字段");
    for (const key of Object.keys(value))
      if (!keys.includes(key)) fail(`${path}.${key}`, "不接受未定义字段");
    return true;
  };
  const time = (value: unknown, path: string, upper: unknown): void => {
    if (!isTimestamp(value)) fail(path, "必须是有效且包含时区的时间戳");
    else if (isTimestamp(upper) && Date.parse(value) > Date.parse(upper))
      fail(path, "时间不能晚于所属记录");
  };
  if (!shape(input, "$", ["schemaVersion", "updatedAt", "coverage", "records"]))
    return { valid: false, errors };
  if (input.schemaVersion !== "idol-event-verifications-v1")
    fail("$.schemaVersion", "不支持的数据版本");
  if (input.coverage !== "partial") fail("$.coverage", "核验仅覆盖部分资料");
  time(input.updatedAt, "$.updatedAt", null);
  if (!Array.isArray(input.records) || input.records.length > 20000) {
    fail("$.records", "必须为最多 20000 条的数组");
    return { valid: false, errors };
  }
  const ids = new Set<string>();
  const eventMap = new Map(events.map((event) => [event.id, event]));
  for (let i = 0; i < input.records.length; i++) {
    const path = `$.records[${i}]`;
    const item: unknown = input.records[i];
    if (
      !shape(item, path, [
        "eventId",
        "snapshot",
        "checkedAt",
        "verifiedAt",
        "outcome",
        "summary",
        "fields",
        "evidence",
        "changes",
      ])
    )
      continue;
    const event =
      typeof item.eventId === "string" ? eventMap.get(item.eventId) : undefined;
    if (!event) fail(`${path}.eventId`, "活动 ID 必须存在于主档");
    if (typeof item.eventId === "string") {
      if (ids.has(item.eventId)) fail(`${path}.eventId`, "活动 ID 重复");
      ids.add(item.eventId);
    }
    if (shape(item.snapshot, `${path}.snapshot`, SNAPSHOT_FIELDS) && event) {
      for (const field of SNAPSHOT_FIELDS)
        if (item.snapshot[field] !== event[field])
          fail(
            `${path}.snapshot.${field}`,
            "主档已变化，必须重新核验或明确移除失效记录",
          );
    }
    time(item.checkedAt, `${path}.checkedAt`, input.updatedAt);
    if (item.verifiedAt !== null)
      time(item.verifiedAt, `${path}.verifiedAt`, item.checkedAt);
    if (!["unverified", "partial", "verified"].includes(String(item.outcome)))
      fail(`${path}.outcome`, "未知核验结论");
    if (!isText(item.summary)) fail(`${path}.summary`, "需要简明核验结论");
    const fieldsValid = shape(
      item.fields,
      `${path}.fields`,
      VERIFICATION_FIELDS,
    );
    const fields = fieldsValid ? (item.fields as Record<string, unknown>) : {};
    const supported = new Set<string>();
    const evidenceByUrl = new Map<string, EventVerificationEvidence>();
    if (
      !Array.isArray(item.evidence) ||
      !item.evidence.length ||
      item.evidence.length > 100
    )
      fail(`${path}.evidence`, "需要 1 至 100 条核验依据");
    else
      for (let j = 0; j < item.evidence.length; j++) {
        const ep = `${path}.evidence[${j}]`;
        const evidence: unknown = item.evidence[j];
        if (
          !shape(evidence, ep, [
            "url",
            "publisher",
            "role",
            "observedAt",
            "result",
            "fields",
            "note",
          ])
        )
          continue;
        if (!isUrl(evidence.url))
          fail(`${ep}.url`, "只接受安全绝对 HTTP(S) URL");
        if (!isText(evidence.publisher, 200))
          fail(`${ep}.publisher`, "缺少发布者");
        if (
          typeof evidence.role !== "string" ||
          !Object.hasOwn(SOURCE_ROLE_LABELS, evidence.role)
        )
          fail(`${ep}.role`, "未知来源角色");
        if (
          !["read", "unavailable", "insufficient"].includes(
            String(evidence.result),
          )
        )
          fail(`${ep}.result`, "未知访问结论");
        time(evidence.observedAt, `${ep}.observedAt`, item.checkedAt);
        if (!isText(evidence.note)) fail(`${ep}.note`, "需要证据范围说明");
        if (
          !Array.isArray(evidence.fields) ||
          evidence.fields.length > VERIFICATION_FIELDS.length ||
          new Set(evidence.fields).size !== evidence.fields.length ||
          Array.from(evidence.fields).some((field) => !isField(field))
        )
          fail(`${ep}.fields`, "字段列表无效或重复");
        else if (evidence.fields.length) {
          if (
            evidence.result !== "read" ||
            !["official", "organizer", "venue", "ticketing"].includes(
              String(evidence.role),
            )
          )
            fail(ep, "确认字段需要已回读的一手来源，汇总不能代替原文");
          if (
            !event?.sources.some(
              (source) =>
                source.url === evidence.url &&
                source.publisher === evidence.publisher &&
                source.kind === evidence.role,
            )
          )
            fail(ep, "确认依据必须在主档中保留来源归属");
          for (const field of evidence.fields) supported.add(field as string);
        }
        if (typeof evidence.url === "string")
          evidenceByUrl.set(
            evidence.url,
            evidence as unknown as EventVerificationEvidence,
          );
      }
    let verifiedCount = 0;
    for (const field of VERIFICATION_FIELDS) {
      const state = fields[field];
      if (!["unverified", "unannounced", "verified"].includes(String(state)))
        fail(`${path}.fields.${field}`, "未知字段状态");
      if (state === "verified") {
        verifiedCount++;
        if (event?.[field] === null)
          fail(`${path}.fields.${field}`, "空值不能标为已核验");
      }
      if (state === "unannounced" && event?.[field] !== null)
        fail(`${path}.fields.${field}`, "已公布值不能标为尚未公布");
      if (state !== "unverified" && !supported.has(field))
        fail(`${path}.fields.${field}`, "缺少本字段原文证据");
    }
    if (
      (verifiedCount === 0) !== (item.outcome === "unverified") ||
      (verifiedCount === 0) !== (item.verifiedAt === null)
    )
      fail(path, "核验结论和成功核验时间必须与实际确认字段一致");
    if (verifiedCount > 0) {
      const proofTimes = [...evidenceByUrl.values()]
        .filter(
          (proof) =>
            proof.result === "read" &&
            isTimestamp(proof.observedAt) &&
            Array.isArray(proof.fields) &&
            proof.fields.some((field) => fields[field] === "verified"),
        )
        .map((proof) => Date.parse(proof.observedAt));
      if (
        !isTimestamp(item.verifiedAt) ||
        Date.parse(item.verifiedAt) !== Math.max(...proofTimes)
      )
        fail(
          `${path}.verifiedAt`,
          "成功核验时间必须等于最近一条已确认字段的原文观察时间",
        );
    }
    if (
      item.outcome === "verified" &&
      !["date", "status", "venue", "startsAt"].every(
        (field) => fields[field] === "verified",
      )
    )
      fail(
        `${path}.outcome`,
        "核心安排已核验需要日期、举行安排、场馆、整场开演四项依据",
      );
    if (!Array.isArray(item.changes) || item.changes.length > 100)
      fail(`${path}.changes`, "变更列表无效");
    else
      for (let j = 0; j < item.changes.length; j++) {
        const cp = `${path}.changes[${j}]`;
        const change: unknown = item.changes[j];
        if (
          !shape(change, cp, [
            "field",
            "previous",
            "current",
            "observedAt",
            "sourceUrl",
            "reason",
          ])
        )
          continue;
        if (!isField(change.field)) fail(`${cp}.field`, "未知变更字段");
        else {
          if (event && change.current !== event[change.field])
            fail(`${cp}.current`, "变更结果必须等于当前主档");
          if (fields[change.field] !== "verified")
            fail(cp, "变更必须有成功核验依据");
        }
        for (const key of ["previous", "current"] as const)
          if (change[key] !== null && !isText(change[key]))
            fail(`${cp}.${key}`, "只接受字符串或 null");
        if (change.previous === change.current) fail(cp, "相同值不是资料变更");
        time(change.observedAt, `${cp}.observedAt`, item.checkedAt);
        if (!isText(change.reason)) fail(`${cp}.reason`, "缺少变更说明");
        const proof =
          typeof change.sourceUrl === "string"
            ? evidenceByUrl.get(change.sourceUrl)
            : undefined;
        if (
          !isUrl(change.sourceUrl) ||
          proof?.result !== "read" ||
          !Array.isArray(proof.fields) ||
          !proof.fields.includes(change.field as VerificationField)
        )
          fail(`${cp}.sourceUrl`, "变更来源必须已回读且支持该字段");
        if (proof && change.observedAt !== proof.observedAt)
          fail(
            `${cp}.observedAt`,
            "变更观察时间必须与所用证据一致，不能生成虚构历史",
          );
      }
  }
  return errors.length
    ? { valid: false, errors }
    : {
        valid: true,
        data: input as unknown as EventVerificationDataset,
        errors: [],
      };
}

export function getEventVerification(
  dataset: EventVerificationDataset,
  eventId: string,
): EventVerificationRecord | undefined {
  return dataset.records.find((record) => record.eventId === eventId);
}

/** 修订后整条失效；保留历史证据的职责属于发布版本快照，不伪造新核验时间。 */
export function invalidateEventVerifications(
  dataset: EventVerificationDataset,
  previousEvents: readonly EventRecord[],
  nextEvents: readonly EventRecord[],
): EventVerificationDataset {
  const before = new Map(previousEvents.map((event) => [event.id, event]));
  const after = new Map(nextEvents.map((event) => [event.id, event]));
  return {
    ...dataset,
    records: dataset.records.filter((record) => {
      const previous = before.get(record.eventId);
      const next = after.get(record.eventId);
      return (
        !!previous &&
        !!next &&
        matchesSnapshot(record, previous) &&
        matchesSnapshot(record, next)
      );
    }),
  };
}

export function eventFieldLabel(
  event: EventRecord,
  record: EventVerificationRecord | undefined,
  field: VerificationField,
): string {
  const state =
    record && matchesSnapshot(record, event)
      ? record.fields[field]
      : "unverified";
  const value = event[field];
  if (value === null) return state === "unannounced" ? "尚未公布" : "尚未核实";
  return state === "verified" ? value : `${value}（尚未核实）`;
}

/** 地图仅使用明确核验的地址；不猜坐标，也不把场馆同名当成身份一致。 */
export function buildVenueNavigationUrl(
  event: EventRecord,
  record: EventVerificationRecord | undefined,
): string | null {
  if (
    !record ||
    !matchesSnapshot(record, event) ||
    event.status === "cancelled" ||
    event.status === "postponed" ||
    !event.city ||
    !event.venue ||
    !event.address ||
    record.fields.venue !== "verified" ||
    record.fields.address !== "verified"
  )
    return null;
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(`${event.venue} ${event.address}`)}&city=${encodeURIComponent(event.city)}&callnative=0`;
}

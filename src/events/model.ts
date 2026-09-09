export type EventStatus =
  "scheduled" | "postponed" | "cancelled" | "unconfirmed";
export type EventTemporalState = "past" | "today" | "upcoming";

export interface EventSource {
  url: string;
  label: string;
  publisher: string;
  observedAt: string;
  kind:
    "official" | "organizer" | "venue" | "wiki" | "aggregator" | "ticketing";
}

export interface EventRecord {
  id: string;
  title: string;
  date: string;
  province: string | null;
  city: string | null;
  venue: string | null;
  address: string | null;
  opensAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: EventStatus;
  performers: { groupId: string | null; name: string }[];
  sources: EventSource[];
  notes: string;
  poster: { src: string; alt: string; sourceUrl: string } | null;
}

export interface EventDataset {
  schemaVersion: "idol-events-v1";
  updatedAt: string;
  coverage: "partial";
  events: EventRecord[];
}

export interface EventFilters {
  q?: string;
  from?: string;
  to?: string;
  group?: string;
  province?: readonly string[];
  city?: readonly string[];
}

export interface EventValidationError {
  path: string;
  message: string;
}

export type EventValidationResult =
  | { valid: true; data: EventDataset; errors: [] }
  | { valid: false; errors: EventValidationError[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN = /^e-[a-z0-9-]+$/;
const UTC8_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "计划举行",
  postponed: "已延期，请核实新日期",
  cancelled: "已取消",
  unconfirmed: "安排待确认",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value,
    );
  if (!match || match[0] !== value || !isDate(match[1])) return false;
  const offset = match[5];
  if (offset && /^[+-]14:/.test(offset) && !offset.endsWith(":00"))
    return false;
  return Number.isFinite(Date.parse(value));
}

function isSafeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (
    !/^https?:\/\//i.test(value) ||
    // eslint-disable-next-line no-control-regex -- 安全边界需要明确拒绝 URL 中的控制字符。
    /[\s\\\u0000-\u001f\u007f]|%0[ad]/i.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** 本地活动海报只使用独立目录和规范小写文件名；文件实体验证由构建执行。 */
export function isLocalEventPosterPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    /^assets\/event-posters\/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)$/.test(
      value,
    )
  );
}

/** 严格检查发布契约；保留原值，错误以字段路径反馈，不静默修正。 */
export function validateEventDataset(
  input: unknown,
  knownGroupIds: Iterable<string>,
): EventValidationResult {
  const errors: EventValidationError[] = [];
  const knownIds = new Set(knownGroupIds);
  const ids = new Set<string>();
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
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(value, key))
        fail(`${path}.${key}`, "缺少必需字段");
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(`${path}.${key}`, "不接受未定义字段");
    }
    return true;
  };
  const text = (
    value: unknown,
    path: string,
    max: number,
    nullable = false,
    empty = false,
  ): void => {
    if (nullable && value === null) return;
    if (
      typeof value !== "string" ||
      (!empty && !value.trim()) ||
      (typeof value === "string" && [...value].length > max)
    ) {
      fail(
        path,
        `必须为${nullable ? " null 或" : ""}${empty ? "" : "非空"}字符串，最多 ${max} 字符`,
      );
    }
  };
  if (!shape(input, "$", ["schemaVersion", "updatedAt", "coverage", "events"]))
    return { valid: false, errors };
  if (input.schemaVersion !== "idol-events-v1")
    fail("$.schemaVersion", "不支持的数据版本");
  if (input.coverage !== "partial")
    fail("$.coverage", "必须明确为 partial，不能声称完整覆盖");
  if (!isTimestamp(input.updatedAt))
    fail("$.updatedAt", "必须为含明确时区的有效 ISO 时间");
  if (!Array.isArray(input.events) || input.events.length > 10000) {
    fail("$.events", "必须为最多 10000 条记录的数组");
    return { valid: false, errors };
  }
  Array.from(input.events).forEach((event: unknown, index: number) => {
    const p = `$.events[${index}]`;
    if (
      !shape(event, p, [
        "id",
        "title",
        "date",
        "province",
        "city",
        "venue",
        "address",
        "opensAt",
        "startsAt",
        "endsAt",
        "status",
        "performers",
        "sources",
        "notes",
        "poster",
      ])
    )
      return;
    if (
      typeof event.id !== "string" ||
      event.id.trim() !== event.id ||
      !ID_PATTERN.test(event.id) ||
      event.id.length > 100
    ) {
      fail(`${p}.id`, "活动 ID 格式无效或超过 100 字符");
    } else if (ids.has(event.id)) {
      fail(`${p}.id`, "活动 ID 重复");
    } else {
      ids.add(event.id);
    }
    text(event.title, `${p}.title`, 160);
    if (!isDate(event.date)) fail(`${p}.date`, "必须为真实日历日期 YYYY-MM-DD");
    for (const field of ["province", "city"] as const) {
      text(event[field], `${p}.${field}`, 40, true);
      if (
        typeof event[field] === "string" &&
        (event[field].trim() !== event[field] ||
          !/^[\p{Script=Han}·]+$/u.test(event[field]))
      ) {
        fail(`${p}.${field}`, "省市须使用中文名称；未知时填写 null");
      }
    }
    text(event.venue, `${p}.venue`, 240, true);
    text(event.address, `${p}.address`, 500, true);
    text(event.notes, `${p}.notes`, 4000, false, true);
    for (const field of ["opensAt", "startsAt", "endsAt"] as const) {
      if (
        event[field] !== null &&
        (typeof event[field] !== "string" ||
          event[field].trim() !== event[field] ||
          !TIME_PATTERN.test(event[field]))
      ) {
        fail(`${p}.${field}`, "必须为 HH:mm 或 null，不支持自行推断跨日时间");
      }
    }
    if (
      typeof event.opensAt === "string" &&
      typeof event.startsAt === "string" &&
      event.opensAt > event.startsAt
    ) {
      fail(`${p}.opensAt`, "入场不能晚于同日开演；跨日信息请留空并备注");
    }
    if (
      typeof event.startsAt === "string" &&
      typeof event.endsAt === "string" &&
      event.endsAt <= event.startsAt
    ) {
      fail(`${p}.endsAt`, "结束必须晚于同日开演；跨日信息请留空并备注");
    }
    if (
      typeof event.status !== "string" ||
      !Object.prototype.hasOwnProperty.call(STATUS_LABELS, event.status)
    ) {
      fail(`${p}.status`, "无效的活动状态");
    }
    if (!Array.isArray(event.performers) || event.performers.length > 200) {
      fail(`${p}.performers`, "必须为最多 200 项的数组");
    } else {
      Array.from(event.performers).forEach((performer: unknown, i: number) => {
        const pp = `${p}.performers[${i}]`;
        if (!shape(performer, pp, ["groupId", "name"])) return;
        text(performer.name, `${pp}.name`, 160);
        if (
          performer.groupId !== null &&
          (typeof performer.groupId !== "string" ||
            !knownIds.has(performer.groupId))
        ) {
          fail(
            `${pp}.groupId`,
            "团体 ID 必须来自当前完整主档；未绑定时填 null",
          );
        }
      });
    }
    if (
      !Array.isArray(event.sources) ||
      !event.sources.length ||
      event.sources.length > 30
    ) {
      fail(`${p}.sources`, "必须有 1 至 30 项可追溯来源");
    } else {
      Array.from(event.sources).forEach((source: unknown, i: number) => {
        const sp = `${p}.sources[${i}]`;
        if (
          !shape(source, sp, [
            "url",
            "label",
            "publisher",
            "observedAt",
            "kind",
          ])
        )
          return;
        if (!isSafeUrl(source.url))
          fail(`${sp}.url`, "必须为安全的绝对 HTTP(S) URL");
        text(source.label, `${sp}.label`, 240);
        text(source.publisher, `${sp}.publisher`, 160);
        if (!isTimestamp(source.observedAt))
          fail(`${sp}.observedAt`, "必须为含明确时区的有效观察时间");
        if (
          typeof source.kind !== "string" ||
          ![
            "official",
            "organizer",
            "venue",
            "wiki",
            "aggregator",
            "ticketing",
          ].includes(source.kind)
        )
          fail(`${sp}.kind`, "来源种类无效");
      });
    }
    if (
      event.poster !== null &&
      shape(event.poster, `${p}.poster`, ["src", "alt", "sourceUrl"])
    ) {
      if (
        !isSafeUrl(event.poster.src) &&
        !isLocalEventPosterPath(event.poster.src)
      )
        fail(
          `${p}.poster.src`,
          "海报必须为安全 URL 或 assets/event-posters 下的 PNG/JPEG/WebP 图片",
        );
      text(event.poster.alt, `${p}.poster.alt`, 240);
      if (!isSafeUrl(event.poster.sourceUrl))
        fail(`${p}.poster.sourceUrl`, "海报必须有安全来源 URL");
    }
  });
  if (errors.length) return { valid: false, errors };
  // 所有层级均通过运行时检查后才收窄类型；不改变编辑资料。
  return { valid: true, data: input as unknown as EventDataset, errors: [] };
}

/** 省市并集与其余条件求交；不修改原数组或自动隐藏取消记录。 */
export function filterEvents(
  events: readonly EventRecord[],
  filters: EventFilters,
): EventRecord[] {
  const { from = "", to = "", group = "", province = [], city = [] } = filters;
  if (
    (from && !isDate(from)) ||
    (to && !isDate(to)) ||
    (from && to && from > to)
  )
    return [];
  const normalize = (value: string): string =>
    value.normalize("NFKC").toLowerCase();
  const terms = normalize(filters.q ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return events.filter((event) => {
    if ((from && event.date < from) || (to && event.date > to)) return false;
    if (
      group &&
      !event.performers.some((performer) => performer.groupId === group)
    )
      return false;
    if (
      (province.length || city.length) &&
      !(event.province !== null && province.includes(event.province)) &&
      !(event.city !== null && city.includes(event.city))
    )
      return false;
    const haystack = normalize(
      [
        event.title,
        event.province,
        event.city,
        event.venue,
        event.address,
        event.notes,
        ...event.performers.map((performer) => performer.name),
      ]
        .filter((value): value is string => value !== null)
        .join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export function getEventTemporalState(
  event: Pick<EventRecord, "date">,
  now: Date,
): EventTemporalState {
  if (!isDate(event.date) || !Number.isFinite(now.getTime()))
    throw new RangeError("日期或当前时间无效");
  const local = new Date(now.getTime() + UTC8_MS);
  if (
    !Number.isFinite(local.getTime()) ||
    local.getUTCFullYear() < 1 ||
    local.getUTCFullYear() > 9999
  ) {
    throw new RangeError("当前时间超出可支持年份");
  }
  const today = local.toISOString().slice(0, 10);
  return event.date < today
    ? "past"
    : event.date > today
      ? "upcoming"
      : "today";
}

function escapeIcsText(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      // eslint-disable-next-line no-control-regex -- 日历文本只保留已转义换行和合法文本字符。
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  );
}

function foldIcsLine(value: string): string {
  const encoder = new TextEncoder();
  let line = "";
  let bytes = 0;
  const lines: string[] = [];
  // 按 Unicode 码点遍历，续行空格也占一个字节，不截断中文或 emoji。
  for (const character of value) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += character;
    bytes += length;
  }
  lines.push(line);
  return lines.join("\r\n");
}

function icsTimestamp(date: Date): string {
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new RangeError("日历时间超出可支持年份");
  }
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** 输出用于手动导入的日历；结束时间未知时不补造时长。 */
export function buildCalendarIcs(
  events: readonly EventRecord[],
  generatedAt: Date,
): string {
  const stamp = icsTimestamp(generatedAt);
  // 重验导出边界，避免调用者绕过数据加载校验后注入日历属性。
  const groupIds = new Set<string>();
  for (const event of events) {
    if (isObject(event) && Array.isArray(event.performers)) {
      for (const performer of event.performers) {
        if (isObject(performer) && typeof performer.groupId === "string")
          groupIds.add(performer.groupId);
      }
    }
  }
  const result = validateEventDataset(
    {
      schemaVersion: "idol-events-v1",
      updatedAt: generatedAt.toISOString(),
      coverage: "partial",
      events: [...events],
    },
    groupIds,
  );
  if (!result.valid)
    throw new TypeError(
      result.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("；"),
    );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//China Underground Idol//Events v1//ZH-CN",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@idol-events.local`,
      `DTSTAMP:${stamp}`,
    );
    if (event.startsAt === null) {
      const next = new Date(Date.parse(`${event.date}T00:00:00Z`) + DAY_MS);
      lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, "")}`);
      // 最后可表示日期省略 DTEND，RFC 的单日全天默认语义仍成立。
      if (next.getUTCFullYear() <= 9999)
        lines.push(
          `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
        );
    } else {
      lines.push(
        `DTSTART:${icsTimestamp(new Date(`${event.date}T${event.startsAt}:00+08:00`))}`,
      );
      if (event.endsAt !== null)
        lines.push(
          `DTEND:${icsTimestamp(new Date(`${event.date}T${event.endsAt}:00+08:00`))}`,
        );
    }
    const prefix =
      event.status === "scheduled" ? "" : `【${STATUS_LABELS[event.status]}】`;
    lines.push(`SUMMARY:${escapeIcsText(prefix + event.title)}`);
    const description = [
      `状态：${STATUS_LABELS[event.status]}；日期经过不等于已实际举办。`,
      "中国当地时间 UTC+8；资料为部分收录，请在出发前核对官宣。",
      ...(event.opensAt === null ? [] : [`入场：${event.opensAt}`]),
      ...(event.startsAt === null ? ["开演时间未确认，按全天日程导出。"] : []),
      ...(event.performers.length
        ? [
            `已收录出演：${event.performers.map((performer) => performer.name).join("、")}`,
          ]
        : []),
      event.notes,
      ...event.sources.map(
        (source) =>
          `来源：${source.label}（${source.publisher}，观察于 ${source.observedAt}） ${source.url}`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    const location = [event.province, event.city, event.venue, event.address]
      .filter(Boolean)
      .join(" ");
    if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
    const source = event.sources[0];
    if (source) lines.push(`URL:${source.url}`);
    lines.push(
      `STATUS:${event.status === "cancelled" ? "CANCELLED" : event.status === "scheduled" ? "CONFIRMED" : "TENTATIVE"}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

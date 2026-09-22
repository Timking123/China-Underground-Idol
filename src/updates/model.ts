import {
  safeSourceUrl,
  validTimestamp,
  type FeedScope,
} from "../subscriptions/model.ts";

export interface UpdateChange {
  field: string;
  before: string | null;
  after: string | null;
}
export interface UpdateEntry {
  id: string;
  eventId: string;
  title: string;
  kind: "added" | "changed" | "withdrawn" | "restored";
  recordedAt: string;
  sequence: number;
  reason: string;
  beforeHash: string | null;
  afterHash: string;
  scopes: FeedScope[];
  changes: UpdateChange[];
  sources: { label: string; url: string; observedAt: string }[];
}
export interface UpdateDataset {
  schemaVersion: "idol-updates-v1";
  initializedAt: string;
  entries: UpdateEntry[];
}
export interface FollowSelection {
  groups: readonly string[];
  cities: readonly string[];
  events: readonly string[];
}

export function matchesFollowing(
  entry: UpdateEntry,
  followed: FollowSelection,
): boolean {
  return (
    followed.events.includes(entry.eventId) ||
    entry.scopes.some((scope) =>
      scope.type === "group"
        ? followed.groups.includes(scope.id)
        : followed.cities.includes(scope.id),
    )
  );
}

export function selectUpdates(
  dataset: UpdateDataset,
  followed: FollowSelection,
  followingOnly: boolean,
): UpdateEntry[] {
  return dataset.entries
    .filter((entry) => !followingOnly || matchesFollowing(entry, followed))
    .sort(
      (a, b) =>
        b.recordedAt.localeCompare(a.recordedAt) ||
        b.sequence - a.sequence ||
        a.id.localeCompare(b.id),
    );
}

export function validateUpdates(input: unknown): UpdateDataset {
  const data = input as UpdateDataset;
  if (
    !data ||
    data.schemaVersion !== "idol-updates-v1" ||
    !validTimestamp(data.initializedAt) ||
    !Array.isArray(data.entries) ||
    data.entries.length > 100000
  )
    throw new Error("更新资料版本或初始化时间无效");
  const ids = new Set<string>();
  for (const entry of data.entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      ids.has(entry.id) ||
      !/^e-[a-z0-9-]+$/u.test(entry.eventId) ||
      !["added", "changed", "withdrawn", "restored"].includes(entry.kind) ||
      !validTimestamp(entry.recordedAt) ||
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence < 0 ||
      typeof entry.title !== "string" ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      !/^[a-f0-9]{64}$/u.test(entry.afterHash) ||
      (entry.beforeHash !== null &&
        !/^[a-f0-9]{64}$/u.test(entry.beforeHash)) ||
      !Array.isArray(entry.scopes) ||
      !Array.isArray(entry.sources) ||
      !Array.isArray(entry.changes) ||
      !entry.changes.length
    )
      throw new Error("更新记录无效、缺少差异或重复");
    for (const change of entry.changes)
      if (
        !change ||
        typeof change.field !== "string" ||
        (change.before !== null && typeof change.before !== "string") ||
        (change.after !== null && typeof change.after !== "string") ||
        change.before === change.after
      )
        throw new Error("更新字段缺少真实差异");
    for (const source of entry.sources)
      if (
        !source ||
        typeof source.label !== "string" ||
        typeof source.url !== "string" ||
        !safeSourceUrl(source.url) ||
        !Number.isFinite(Date.parse(source.observedAt))
      )
        throw new Error("更新来源无效");
    for (const scope of entry.scopes)
      if (
        !scope ||
        !["group", "city"].includes(scope.type) ||
        typeof scope.id !== "string" ||
        typeof scope.label !== "string"
      )
        throw new Error("更新范围无效");
    ids.add(entry.id);
  }
  return data;
}

const FIELD_LABELS: Record<string, string> = {
  title: "活动名称",
  date: "日期",
  city: "城市",
  province: "省份",
  venue: "场馆",
  address: "地址",
  opensAt: "入场时间",
  startsAt: "开演时间",
  endsAt: "结束时间",
  status: "活动状态",
  performers: "收录阵容",
  sources: "资料来源",
  notes: "备注",
  poster: "海报",
  verification: "字段核验",
  withdrawn: "资料撤下状态",
  record: "活动记录",
};
export function updateFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function formatUpdateValue(value: string | null, field = ""): string {
  if (value === null || value === "null") return "尚未收录";
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string")
      return (
        (
          {
            scheduled: "计划举行",
            postponed: "已延期",
            cancelled: "已取消",
            unconfirmed: "安排待确认",
          } as Record<string, string>
        )[parsed] ?? parsed
      );
    if (typeof parsed === "boolean") return parsed ? "是" : "否";
    if (parsed === null) return "尚未收录";
    if (Array.isArray(parsed)) {
      if (!parsed.length) return "尚未收录";
      return parsed
        .map((item: unknown) => {
          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            if (typeof record.name === "string") return record.name;
            if (typeof record.url === "string")
              return `${String(record.label ?? "来源")}：${record.url}${typeof record.observedAt === "string" ? `（观察于 ${record.observedAt}）` : ""}`;
          }
          return String(item);
        })
        .join("\n");
    }
    if (typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (field === "verification") {
        const labels: Record<string, string> = {
          unverified: "尚未核实",
          unannounced: "尚未公布",
          verified: "已核实",
          partial: "部分核实",
        };
        const fields =
          record.fields && typeof record.fields === "object"
            ? Object.entries(record.fields)
            : [];
        return [
          `整体：${labels[String(record.outcome)] ?? "尚未核实"}`,
          ...fields.map(
            ([name, state]) =>
              `${updateFieldLabel(name)}：${labels[String(state)] ?? "尚未核实"}`,
          ),
        ].join("\n");
      }
      if (field === "poster")
        return [record.alt, record.src, record.sourceUrl]
          .filter((item) => typeof item === "string")
          .join("\n");
      return Object.entries(record)
        .filter(([key]) => key !== "id")
        .map(
          ([key, item]) =>
            `${updateFieldLabel(key)}：${formatUpdateValue(JSON.stringify(item), key)}`,
        )
        .join("\n");
    }
  } catch {
    /* 外部文字保留原文，渲染端只使用 textContent。 */
  }
  return value;
}

import {
  defaultCatalogFilters,
  parseCatalogFilters,
  serializeCatalogFilters,
  type CatalogFilters,
  type CatalogGroup,
  type CatalogRegion,
  type GroupCatalog,
} from "../catalog/model";
import type { EventRecord } from "../events/model";

export const GROUPS_PAGE_SIZE = 24;
export type GroupListSort = "archive" | "followers";
const MAX_GROUP_LIST_SEARCH_LENGTH = 4096;

/** 与共享查询合同的每类地区64项上限一致；拒绝提交时不改动草稿。 */
export function groupFilterSelectionError(
  filters: Pick<CatalogFilters, "province" | "city">,
): string | null {
  if (filters.province.length <= 64 && filters.city.length <= 64) return null;
  return `省份和城市各最多选择 64 项（当前省份 ${filters.province.length} 项、城市 ${filters.city.length} 项）。请减少选择后再应用；已保留本次选择，原筛选结果未改变。`;
}

export function parseGroupListSearch(search: string, catalog: GroupCatalog) {
  const fullSearch = !search || search.startsWith("?") ? search : `?${search}`;
  if (fullSearch.length > MAX_GROUP_LIST_SEARCH_LENGTH)
    return {
      filters: defaultCatalogFilters(),
      sort: "archive" as GroupListSort,
      ignored: true,
    };
  // URLSearchParams 会容错解码；须在剥离 sort、重新编码之前保留原串校验。
  try {
    decodeURIComponent(fullSearch.replace(/\+/gu, " "));
  } catch {
    return {
      filters: defaultCatalogFilters(),
      sort: "archive" as GroupListSort,
      ignored: true,
    };
  }
  const params = new URLSearchParams(fullSearch);
  const values = params.getAll("sort");
  const validSort =
    values.length <= 1 &&
    (values.length === 0 ||
      values[0] === "archive" ||
      values[0] === "followers");
  const sort: GroupListSort =
    validSort && values[0] === "followers" ? "followers" : "archive";
  params.delete("sort");
  const parsed = parseCatalogFilters(params.toString(), catalog);
  return { ...parsed, sort, ignored: parsed.ignored || !validSort };
}

/** 提交与历史记录共用完整查询串；只有可恢复的候选才能成为已应用状态。 */
export function prepareGroupListSubmission(
  filters: CatalogFilters,
  sort: GroupListSort,
  catalog: GroupCatalog,
):
  | {
      valid: true;
      filters: CatalogFilters;
      sort: GroupListSort;
      search: string;
    }
  | { valid: false; message: string } {
  const selectionError = groupFilterSelectionError(filters);
  if (selectionError) return { valid: false, message: selectionError };
  const invalid = {
    valid: false as const,
    message: "筛选条件无效，请检查后再应用；已保留本次输入，原筛选结果未改变。",
  };
  const filterSearch = serializeCatalogFilters(filters);
  // 空串只可代表合法默认条件，不能把共享序列化器的失败当作重置。
  if (
    !filterSearch &&
    (filters.q.trim() ||
      filters.status !== "active" ||
      filters.regionRole !== "activity" ||
      filters.province.length ||
      filters.city.length ||
      filters.style)
  )
    return invalid;
  const params = new URLSearchParams(filterSearch);
  if (sort !== "archive") params.set("sort", sort);
  const query = params.toString();
  const search = query ? `?${query}` : "";
  if (search.length > MAX_GROUP_LIST_SEARCH_LENGTH)
    return {
      valid: false,
      message:
        "筛选条件组合过长，请缩短查询或减少地区选择后再应用；已保留本次输入，原筛选结果未改变。",
    };
  const restored = parseGroupListSearch(search, catalog);
  if (restored.ignored) return invalid;
  return {
    valid: true,
    filters: restored.filters,
    sort: restored.sort,
    search,
  };
}

/** 按已记录账号观察值排序，未知值置后；相同值保留原归档顺序。 */
export function sortGroupList(
  groups: readonly CatalogGroup[],
  sort: GroupListSort,
): CatalogGroup[] {
  if (sort === "archive") return [...groups];
  return [...groups].sort(
    (a, b) => (b.followers?.value ?? -1) - (a.followers?.value ?? -1),
  );
}

/** 每次只呈现一页；记录数扩大时不把全部图片和节点塞进首屏。 */
export function paginateGroups<T>(
  records: readonly T[],
  requestedPage: number,
): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(records.length / GROUPS_PAGE_SIZE));
  const page = Math.min(
    pages,
    Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1),
  );
  return {
    items: records.slice(
      (page - 1) * GROUPS_PAGE_SIZE,
      page * GROUPS_PAGE_SIZE,
    ),
    page,
    pages,
    total: records.length,
  };
}

export function describeRegion(region: CatalogRegion): string {
  if (!region.city) {
    return region.province ? `${region.province} · 城市待核实` : "城市待核实";
  }
  if (!region.province || region.city === region.province) return region.city;
  const province = region.province.replace(/市$/, "");
  const city = region.city.replace(/市$/, "");
  return province === city
    ? region.city
    : `${region.province} · ${region.city}`;
}

/** 只显示日期，不把编辑或浏览日期用作来源观察时间。 */
export function displayDate(value: string | null): string {
  if (!value) return "观察日期未记录";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "观察日期未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("/", "-");
}

export function describeStyle(group: CatalogGroup): string {
  return group.styleState === "uncertain"
    ? "风格待核实"
    : `编辑分类 · ${group.styleLabel || "未分类"}`;
}

/** 身份关联仅凭稳定 ID，不能用同名或尚未绑定的出演名称补造关联。 */
export function relatedEvents(
  events: readonly EventRecord[],
  groupId: string,
  today: string,
): { upcoming: EventRecord[]; past: EventRecord[] } {
  const matched = events.filter((event) =>
    event.performers.some((performer) => performer.groupId === groupId),
  );
  const ascending = (a: EventRecord, b: EventRecord): number =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  return {
    upcoming: matched.filter((event) => event.date >= today).sort(ascending),
    past: matched
      .filter((event) => event.date < today)
      .sort(ascending)
      .reverse(),
  };
}

export function todayInChina(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function eventStatusText(event: EventRecord): string {
  const labels: Record<EventRecord["status"], string> = {
    scheduled: "按官宣计划",
    postponed: "已延期，请核实新日期",
    cancelled: "已取消",
    unconfirmed: "安排待确认",
  };
  return labels[event.status];
}

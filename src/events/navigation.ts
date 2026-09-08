import { normalizeRegionName } from "../catalog/model";
import { filterEvents, type EventRecord } from "./model";

export type EventPeriod = "upcoming" | "past" | "all";

export interface PageFilters {
  q: string;
  from: string;
  to: string;
  group: string;
  province: string[];
  city: string[];
  period: EventPeriod;
}

export interface FilterOptions {
  groupIds: ReadonlySet<string>;
  provinces: ReadonlySet<string>;
  cities: ReadonlySet<string>;
}

export function emptyFilters(): PageFilters {
  return {
    q: "",
    from: "",
    to: "",
    group: "",
    province: [],
    city: [],
    period: "upcoming",
  };
}

export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function isValidPageDate(value: string): boolean {
  if (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/u.test(value)) return false;
  if (value < "1900-01-01" || value > "2100-12-31") return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function chinaToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** “本周末”固定指中国当地本周的周六、周日；周日查询也保留周六。 */
export function weekendDates(now = new Date()): { from: string; to: string } {
  const date = new Date(`${chinaToday(now)}T00:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() + 5 - mondayOffset);
  const from = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  return { from, to: date.toISOString().slice(0, 10) };
}

export function parseFilters(
  search: string,
  options: FilterOptions,
): { filters: PageFilters; ignored: boolean } {
  const filters = emptyFilters();
  if (search.length > 8192) return { filters, ignored: true };
  const params = new URLSearchParams(search);
  let ignored = false;
  const single = (key: string, valid: (value: string) => boolean): string => {
    const values = params.getAll(key);
    if (!values.length) return "";
    if (values.length !== 1 || !valid(values[0] ?? "")) {
      ignored = true;
      return "";
    }
    return (values[0] ?? "").trim();
  };
  filters.q = single(
    "q",
    (value) => value.length <= 120 && !hasControlCharacters(value),
  );
  filters.from = single(
    "from",
    (value) => value === "" || isValidPageDate(value),
  );
  filters.to = single("to", (value) => value === "" || isValidPageDate(value));
  filters.group = single(
    "group",
    (value) => value === "" || options.groupIds.has(value),
  );
  const multiple = (key: string, allowed: ReadonlySet<string>): string[] => {
    const values = params.getAll(key);
    if (values.length > 32) {
      ignored = true;
      return [];
    }
    const accepted: string[] = [];
    for (const value of values) {
      if (!value || value.length > 64 || hasControlCharacters(value)) {
        ignored = true;
        continue;
      }
      const match = [...allowed].find(
        (item) => normalizeRegionName(item) === normalizeRegionName(value),
      );
      if (match) accepted.push(match);
      else ignored = true;
    }
    return [...new Set(accepted)].sort();
  };
  filters.province = multiple("province", options.provinces);
  filters.city = multiple("city", options.cities);
  if (filters.from && filters.to && filters.from > filters.to) {
    filters.from = "";
    filters.to = "";
    ignored = true;
  }
  const period = single("period", (value) =>
    ["upcoming", "past", "all"].includes(value),
  );
  // 一期显式日期链接继续按日期查询，不能暗加“今天以后”的限制。
  filters.period = period
    ? (period as EventPeriod)
    : filters.from || filters.to
      ? "all"
      : "upcoming";
  for (const key of params.keys()) {
    if (
      !["q", "from", "to", "group", "province", "city", "period"].includes(key)
    )
      ignored = true;
  }
  return { filters, ignored };
}

export function serializeFilters(filters: PageFilters): string {
  const params = new URLSearchParams();
  for (const key of ["q", "from", "to", "group"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.period !== "upcoming" || filters.from || filters.to)
    params.set("period", filters.period);
  for (const key of ["province", "city"] as const) {
    for (const value of [...new Set(filters[key])].sort())
      params.append(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function selectPageEvents(
  events: readonly EventRecord[],
  filters: PageFilters,
  now = new Date(),
): EventRecord[] {
  const today = chinaToday(now);
  // 只为匹配扩充同名后缀，不改写活动原文，也不推断未知地区。
  const regionValues = (key: "province" | "city"): string[] => {
    const normalized = new Set(filters[key].map(normalizeRegionName));
    return [
      ...new Set(
        events.flatMap((event) => {
          const value = event[key];
          return value !== null && normalized.has(normalizeRegionName(value))
            ? [value]
            : [];
        }),
      ),
    ];
  };
  const province = regionValues("province");
  const city = regionValues("city");
  if (
    (filters.province.length || filters.city.length) &&
    !province.length &&
    !city.length
  )
    return [];
  return filterEvents(events, { ...filters, province, city })
    .filter(
      (event) =>
        filters.period === "all" ||
        (filters.period === "past" ? event.date < today : event.date >= today),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startsAt || "99:99").localeCompare(b.startsAt || "99:99") ||
        a.id.localeCompare(b.id),
    );
}

export function resolveEventLocation(
  search: string,
  hash: string,
  options: FilterOptions,
  events: readonly EventRecord[],
  now = new Date(),
): ReturnType<typeof parseFilters> & {
  anchor: EventRecord | null;
  adjusted: boolean;
  invalidAnchor: boolean;
} {
  const parsed = parseFilters(search, options);
  let id = "";
  let invalidAnchor = false;
  try {
    if (hash.length > 256) invalidAnchor = true;
    else id = decodeURIComponent(hash.replace(/^#/u, ""));
  } catch {
    invalidAnchor = true;
  }
  const anchor = /^e-[a-z0-9-]+$/u.test(id)
    ? (events.find((event) => event.id === id) ?? null)
    : null;
  if (id.startsWith("e-") && !anchor) invalidAnchor = true;
  const adjusted = Boolean(
    anchor &&
    !selectPageEvents(events, parsed.filters, now).some(
      (event) => event.id === anchor.id,
    ),
  );
  return {
    ...parsed,
    filters: adjusted ? { ...emptyFilters(), period: "all" } : parsed.filters,
    anchor,
    adjusted,
    invalidAnchor,
  };
}

import type { CatalogGroup } from "../catalog/model";
import type { EventRecord } from "../events/model";

export interface DiscoveryCity {
  name: string;
  groupCount: number;
  upcomingCount: number;
  pastCount: number;
}

/** UTC+8 日期只用于日程筛选，不改写活动状态或来源观察时间。 */
export function discoveryDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("当前日期无效");
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** 保留档案顺序，不从粉丝量、图片或缺失资料推断推荐次序。 */
export function discoveryGroups(
  groups: readonly CatalogGroup[],
  limit = 6,
): CatalogGroup[] {
  return groups.filter((group) => group.isActive).slice(0, Math.max(0, limit));
}

/** 取消、延期仍显示明确状态；日期经过不等于已经举办。 */
export function discoveryEvents(
  events: readonly EventRecord[],
  now: Date,
  limit = 3,
): EventRecord[] {
  const today = discoveryDate(now);
  return events
    .filter((event) => event.date >= today)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startsAt ?? "99:99").localeCompare(b.startsAt ?? "99:99") ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, limit));
}

/** 城市仅来自正式主要活动地或活动字段，使用共享归一化，不推断归属。 */
export function discoveryCities(
  groups: readonly CatalogGroup[],
  events: readonly EventRecord[],
  now: Date,
  normalize: (value: string) => string,
): DiscoveryCity[] {
  const cities = new Map<string, DiscoveryCity>();
  const today = discoveryDate(now);
  const getCity = (value: string | null): DiscoveryCity | null => {
    if (!value) return null;
    const name = normalize(value);
    if (!name) return null;
    let item = cities.get(name);
    if (!item) {
      item = { name, groupCount: 0, upcomingCount: 0, pastCount: 0 };
      cities.set(name, item);
    }
    return item;
  };
  for (const group of groups) {
    if (group.isActive) {
      const city = getCity(group.activity.city);
      if (city) city.groupCount += 1;
    }
  }
  for (const event of events) {
    const city = getCity(event.city);
    if (city) {
      if (event.date >= today) city.upcomingCount += 1;
      else city.pastCount += 1;
    }
  }
  return [...cities.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
}

export function groupUrl(id: string): string {
  return `group.html?${new URLSearchParams({ group: id })}`;
}

export function eventUrl(event: Pick<EventRecord, "id">): string {
  // 使用 all 保持跨日后的深链接可达，详情页负责定位与日期提示。
  return `events.html?period=all#${encodeURIComponent(event.id)}`;
}

export function cityUrl(city: DiscoveryCity): string {
  if (city.groupCount > 0) {
    return `groups.html?${new URLSearchParams({
      regionRole: "activity",
      city: city.name,
    })}`;
  }
  return `events.html?${new URLSearchParams({
    period: city.upcomingCount > 0 ? "upcoming" : "past",
    city: city.name,
  })}`;
}

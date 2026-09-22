import type { CatalogGroup } from "../catalog/model";
import type { EventRecord } from "../events/model";

export function cityPeriod(search: string): "upcoming" | "weekend" {
  const values = new URLSearchParams(search).getAll("period");
  return values.length === 1 && values[0] === "weekend"
    ? "weekend"
    : "upcoming";
}

export function citySelection(
  search: string,
  known: readonly string[],
  normalize: (value: string) => string,
): string | null {
  if (search.length > 8192) return null;
  const values = new URLSearchParams(search).getAll("city");
  if (values.length !== 1 || !values[0] || values[0].length > 64) return null;
  const city = normalize(values[0]);
  return known.includes(city) ? city : null;
}

/** 场馆依据来自带地址的官方、主办或场馆来源，历史记录不是营业保证。 */
export function cityVenues(events: readonly EventRecord[]) {
  const venues = new Map<
    string,
    { name: string; address: string; event: EventRecord }
  >();
  for (const event of [...events].sort((a, b) =>
    b.date.localeCompare(a.date),
  )) {
    if (
      !event.venue ||
      !event.address ||
      !event.sources.some((source) =>
        ["official", "organizer", "venue"].includes(source.kind),
      )
    )
      continue;
    const key = `${event.venue}\n${event.address}`;
    if (!venues.has(key))
      venues.set(key, { name: event.venue, address: event.address, event });
  }
  return [...venues.values()];
}

export function cityGroups(
  groups: readonly CatalogGroup[],
  city: string,
  normalize: (value: string) => string,
): CatalogGroup[] {
  return groups.filter(
    (group) =>
      group.isActive &&
      group.activity.city &&
      normalize(group.activity.city) === city,
  );
}

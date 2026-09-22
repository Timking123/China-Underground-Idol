import type { EventRecord } from "../events/model";
import type { Preferences } from "../preferences/model";

/** 合并团体、城市和单场关注；稳定 ID 去重，不从名称猜测出演关系。 */
export function followedEvents(
  events: readonly EventRecord[],
  preferences: Preferences,
  today: string,
  normalize: (value: string) => string,
): EventRecord[] {
  return events
    .filter(
      (event) =>
        event.date >= today &&
        (preferences.event.includes(event.id) ||
          (event.city !== null &&
            preferences.city.includes(normalize(event.city))) ||
          event.performers.some(
            (performer) =>
              performer.groupId !== null &&
              preferences.group.includes(performer.groupId),
          )),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startsAt ?? "99:99").localeCompare(b.startsAt ?? "99:99") ||
        a.id.localeCompare(b.id),
    );
}

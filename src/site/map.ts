import rawDataset from "../../data/events.v1.json";
import {
  filterEvents,
  getEventTemporalState,
  validateEventDataset,
  type EventRecord,
} from "../events/model";

export type GroupLink =
  | { state: "none" }
  | { state: "invalid" }
  | { state: "valid"; groupId: string };

/** 只接受单个已收录团体 ID，畸形链接不影响默认档案口径。 */
export function parseGroupLink(
  search: string,
  knownGroupIds: ReadonlySet<string>,
): GroupLink {
  if (search.length > 2048) return { state: "invalid" };
  const values = new URLSearchParams(search).getAll("group");
  if (values.length === 0) return { state: "none" };
  if (
    values.length !== 1 ||
    !/^g\d{3}$/.test(values[0]) ||
    !knownGroupIds.has(values[0])
  ) {
    return { state: "invalid" };
  }
  return { state: "valid", groupId: values[0] };
}

export function groupEventsHref(groupId: string): string {
  return `events.html?group=${encodeURIComponent(groupId)}`;
}

export function getGroupActivitySummary(
  events: readonly EventRecord[],
  groupId: string,
  now: Date,
): {
  total: number;
  upcomingCount: number;
  upcoming: EventRecord[];
  message: string;
} {
  const related = filterEvents(events, { group: groupId });
  const upcoming = related
    .filter((event) => getEventTemporalState(event, now) !== "past")
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startsAt || "99:99").localeCompare(b.startsAt || "99:99") ||
        a.id.localeCompare(b.id),
    );
  const message =
    related.length === 0
      ? "尚未收录相关活动，不代表该团没有活动。"
      : upcoming.length === 0
        ? `已收录 ${related.length} 条日期已过的活动资料，尚未收录近期安排；日期经过不代表实际举办。`
        : `近期收录 ${upcoming.length} 条活动资料，以下最多显示 3 条。资料为部分收录，出发前请核对官宣及变更。`;
  return {
    total: related.length,
    upcomingCount: upcoming.length,
    upcoming: upcoming.slice(0, 3),
    message,
  };
}

export function renderGroupEvents(groupId: string): void {
  const section = document.querySelector<HTMLElement>("#group-events");
  const link = document.querySelector<HTMLAnchorElement>("#group-events-link");
  const summary = document.querySelector<HTMLElement>("#group-events-summary");
  const list = document.querySelector<HTMLUListElement>("#group-events-list");
  if (!section || !link || !summary || !list) return;
  section.hidden = false;
  link.href = `${groupEventsHref(groupId)}&period=all`;
  const profile = document.querySelector<HTMLAnchorElement>(
    "#group-profile-link",
  );
  const correction = document.querySelector<HTMLAnchorElement>(
    "#group-correction-link",
  );
  if (profile) profile.href = `group.html?group=${encodeURIComponent(groupId)}`;
  if (correction)
    correction.href = `contribute.html?group=${encodeURIComponent(groupId)}&page=index&kind=error`;
  list.replaceChildren();
  list.hidden = true;
  const groups = (
    window as unknown as { IDOL_MAP_DATA?: { groups?: { id: string }[] } }
  ).IDOL_MAP_DATA?.groups;
  const validation = validateEventDataset(
    rawDataset,
    groups?.map((group) => group.id) ?? [],
  );
  if (!validation.valid) {
    summary.textContent =
      "活动资料校验失败，暂时不能显示摘要；请进入活动日历查看状态。";
    return;
  }
  const result = getGroupActivitySummary(
    validation.data.events,
    groupId,
    new Date(),
  );
  summary.textContent = result.message;
  const statuses: Record<EventRecord["status"], string> = {
    scheduled: "计划举行",
    cancelled: "已取消",
    postponed: "已延期，请核对新安排",
    unconfirmed: "待确认，请核对官宣",
  };
  for (const event of result.upcoming) {
    const item = document.createElement("li");
    const eventLink = document.createElement("a");
    eventLink.href = `${groupEventsHref(groupId)}#${encodeURIComponent(event.id)}`;
    eventLink.textContent = `${event.date} · ${event.title}`;
    const note = document.createElement("p");
    note.textContent = `${statuses[event.status]} · ${event.startsAt ? `开演 ${event.startsAt}（UTC+8）` : "开演时间未确认"}`;
    item.append(eventLink, note);
    list.append(item);
  }
  list.hidden = result.upcoming.length === 0;
}

declare global {
  interface Window {
    IDOL_SITE: {
      parseGroupLink: typeof parseGroupLink;
      groupEventsHref: typeof groupEventsHref;
      renderGroupEvents: typeof renderGroupEvents;
    };
  }
}

if (typeof window !== "undefined") {
  window.IDOL_SITE = { parseGroupLink, groupEventsHref, renderGroupEvents };
}

import type { CatalogGroup } from "../catalog/model";
import type { EventRecord } from "../events/model";
import { element, imageBlock, link } from "../groups/dom";
import { eventStatusText } from "../groups/model";
import { eventUrl, groupUrl } from "../discover/model";
import { followButton } from "../preferences/browser";
import { presentedEventField } from "./eventPresentation";

export function eventRow(event: EventRecord): HTMLElement {
  const item = element("li", "", "city-event-row");
  const date = element("time", event.date);
  date.dateTime = event.date;
  const copy = element("div");
  const title = element("h3");
  title.append(link(event.title, eventUrl(event)));
  copy.append(
    title,
    element(
      "p",
      `${eventStatusText(event)} · 开演 ${presentedEventField(event, "startsAt")}`,
    ),
    element(
      "p",
      `${event.city ?? "城市待核实"} · 场地 ${presentedEventField(event, "venue")}`,
    ),
  );
  item.append(date, copy, followButton("event", event.id, event.title));
  return item;
}

export function groupRow(group: CatalogGroup): HTMLElement {
  const item = element("li", "", "city-group-row");
  const copy = element("div");
  copy.append(
    link(group.name, groupUrl(group.id)),
    element("p", `${group.activity.city ?? "城市待核实"} · ${group.status}`),
  );
  item.append(
    imageBlock(group.avatar, group.name),
    copy,
    followButton("group", group.id, group.name),
  );
  return item;
}

export function section(title: string, id: string): HTMLElement {
  const node = element("section", "", "city-section");
  node.id = id;
  const heading = element("h2", title);
  node.append(heading);
  node.setAttribute("aria-labelledby", `${id}-title`);
  heading.id = `${id}-title`;
  return node;
}

export function appendEvents(
  root: HTMLElement,
  events: EventRecord[],
  empty: string,
): void {
  if (!events.length) {
    root.append(element("p", empty, "city-note"));
    return;
  }
  const list = element("ul", "", "city-list");
  events.forEach((event) => list.append(eventRow(event)));
  root.append(list);
}

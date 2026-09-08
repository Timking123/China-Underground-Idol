import {
  normalizeRegionName,
  type CatalogGroup,
  type CatalogImage,
} from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { validateEventDataset, type EventRecord } from "../events/model";
import eventInput from "../../data/events.v1.json";
import {
  cityUrl,
  discoveryCities,
  discoveryEvents,
  discoveryGroups,
  eventUrl,
  groupUrl,
} from "./model";

const STATUS_LABELS: Record<EventRecord["status"], string> = {
  scheduled: "按官宣计划",
  postponed: "已延期，请核实新日期",
  cancelled: "已取消",
  unconfirmed: "安排待确认",
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(
  text: string,
  href: string,
  className = "discover-link",
): HTMLAnchorElement {
  const node = element("a", className, text);
  node.href = href;
  return node;
}

function sourceLink(text: string, href: string): HTMLAnchorElement {
  const node = link(text, href, "discover-source-link");
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function imageView(
  image: CatalogImage | null,
  name: string,
  lead: boolean,
): HTMLElement {
  const frame = element("div", lead ? "discover-visual" : "discover-avatar");
  const fallback = element(
    "span",
    "discover-image-fallback",
    lead ? "暂无可用资料图" : name.slice(0, 1),
  );
  frame.append(fallback);
  if (!image) return frame;
  const img = element("img", "");
  img.alt = image.alt;
  img.width = lead ? 720 : 64;
  img.height = lead ? 480 : 64;
  img.loading = lead ? "eager" : "lazy";
  img.decoding = "async";
  fallback.hidden = true;
  img.addEventListener("error", () => {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = lead ? "资料图暂时无法显示" : name.slice(0, 1);
  });
  img.src = image.src;
  frame.append(img);
  return frame;
}

function groupRegion(group: CatalogGroup): string {
  return group.activity.city
    ? `主要活动地 · ${normalizeRegionName(group.activity.city)}`
    : "主要活动城市尚待核实";
}

function leadGroup(group: CatalogGroup): HTMLElement {
  const article = element("article", "discover-lead");
  const image = group.visual ?? group.avatar;
  const figure = element("figure", "discover-figure");
  figure.append(imageView(image, group.name, true));
  if (image) {
    const caption = element(
      "figcaption",
      "discover-image-caption",
      `${image.label} · 资料图不代表当前完整阵容。`,
    );
    if (image.sourceUrl)
      caption.append(" ", sourceLink("图像来源", image.sourceUrl));
    figure.append(caption);
  }
  const text = element("div", "discover-lead-copy");
  const heading = element("h3", "discover-group-name");
  heading.append(link(group.name, groupUrl(group.id), "discover-title-link"));
  text.append(heading, element("p", "discover-region", groupRegion(group)));
  const style =
    group.styleState === "uncertain"
      ? "风格资料尚待核实"
      : `编辑分类 · ${group.styleLabel}`;
  text.append(element("p", "discover-style", style));
  const actions = element("div", "discover-actions");
  actions.append(
    link("了解这支团", groupUrl(group.id)),
    link(
      "查看相关演出",
      `events.html?${new URLSearchParams({ group: group.id, period: "upcoming" })}`,
    ),
  );
  text.append(actions);
  article.append(figure, text);
  return article;
}

function compactGroup(group: CatalogGroup): HTMLElement {
  const item = element("li", "discover-group-item");
  const anchor = link("", groupUrl(group.id), "discover-group-link");
  const copy = element("span", "discover-group-copy");
  copy.append(
    element("span", "discover-group-small-name", group.name),
    element("span", "discover-region", groupRegion(group)),
  );
  anchor.append(imageView(group.avatar, group.name, false), copy);
  item.append(anchor);
  return item;
}

function eventCard(event: EventRecord): HTMLElement {
  const article = element("article", "discover-event");
  const dateBlock = element("div", "discover-event-date");
  const date = element("time", "", event.date.slice(5).replace("-", "."));
  date.dateTime = event.date;
  dateBlock.append(
    date,
    element("span", "discover-event-year", event.date.slice(0, 4)),
    element(
      "span",
      "discover-event-time",
      event.startsAt ? `${event.startsAt} 开演` : "开演待确认",
    ),
  );
  const body = element("div", "discover-event-body");
  const heading = element("h3", "discover-event-title");
  heading.append(link(event.title, eventUrl(event), "discover-title-link"));
  body.append(
    element(
      "p",
      `discover-event-status discover-event-status-${event.status}`,
      STATUS_LABELS[event.status],
    ),
    heading,
  );
  body.append(
    element(
      "p",
      "discover-event-place",
      `${event.city ? normalizeRegionName(event.city) : "城市待核实"} / ${event.venue ?? "场地待核实"}`,
    ),
  );
  const performers = element("p", "discover-performers", "出演：");
  if (event.performers.length === 0) performers.append("阵容尚待核实");
  event.performers.forEach((performer, index) => {
    if (index > 0) performers.append("、");
    performers.append(
      performer.groupId
        ? link(
            performer.name,
            groupUrl(performer.groupId),
            "discover-performer-link",
          )
        : performer.name,
    );
  });
  body.append(performers, link("详情与官宣", eventUrl(event)));
  article.append(dateBlock, body);
  return article;
}

function setStatus(id: string, text: string, error = false): void {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.hidden = !text;
  node.setAttribute("role", error ? "alert" : "status");
  node.classList.toggle("discover-error", error);
}

export function renderDiscovery(
  catalog: ReturnType<typeof readCatalog>,
  rawEvents: unknown,
  now: Date,
): void {
  const feature = document.getElementById("discover-feature");
  const groupsList = document.getElementById("discover-group-list");
  const agenda = document.getElementById("discover-agenda");
  const cityList = document.getElementById("discover-city-list");
  if (!feature || !groupsList || !agenda || !cityList) return;
  for (const node of [feature, groupsList, agenda, cityList])
    node.replaceChildren();
  const update = document.getElementById("discover-events-updated");
  if (update) update.textContent = "";
  if (!catalog.valid) {
    setStatus(
      "discover-group-status",
      "团体资料暂时无法读取，请稍后重试，或通过投稿纠错告知我们。",
      true,
    );
    setStatus(
      "discover-event-status",
      "演出关联资料暂时无法读取，可打开活动日历继续查阅。",
      true,
    );
    setStatus(
      "discover-city-status",
      "城市入口暂时无法读取，可前往团体列表查找。",
      true,
    );
    return;
  }
  const chosen = discoveryGroups(catalog.data.groups);
  setStatus(
    "discover-group-status",
    chosen.length
      ? "按档案顺序展示部分存续团体。"
      : "尚未收录可展示的存续团体，可在完整档案查看历史资料。",
  );
  if (chosen[0]) feature.append(leadGroup(chosen[0]));
  for (const group of chosen.slice(1)) groupsList.append(compactGroup(group));

  const checkedEvents = validateEventDataset(
    rawEvents,
    catalog.data.groups.map((group) => group.id),
  );
  const events = checkedEvents.valid ? checkedEvents.data.events : [];
  if (!checkedEvents.valid) {
    setStatus(
      "discover-event-status",
      "活动资料暂时无法读取，不能据此判断近期是否有演出。请稍后重试或补充官宣。",
      true,
    );
  } else {
    const upcoming = discoveryEvents(events, now);
    setStatus(
      "discover-event-status",
      upcoming.length
        ? "仅展示已收录资料；出发前请核对官宣。"
        : "尚未收录近期活动，可查看历史日程，或补充可靠官宣。",
    );
    for (const event of upcoming) agenda.append(eventCard(event));
    if (update) {
      update.textContent = `活动资料编辑于 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(checkedEvents.data.updatedAt))}，不代表已核对此后的变更。`;
    }
  }

  const cities = discoveryCities(
    catalog.data.groups,
    events,
    now,
    normalizeRegionName,
  );
  setStatus(
    "discover-city-status",
    cities.length
      ? "来自已知主要活动城市与活动记录，未标注地域的资料仍可在完整档案查找。"
      : "尚无可核实的城市入口，请在完整档案浏览或补充资料。",
  );
  for (const city of cities) {
    const item = element("li", "discover-city-item");
    const anchor = link("", cityUrl(city), "discover-city-link");
    anchor.append(
      element("span", "discover-city-name", city.name),
      element(
        "span",
        "discover-city-kind",
        city.groupCount > 0
          ? "查团体"
          : city.upcomingCount > 0
            ? "看近期演出"
            : "看历史活动",
      ),
    );
    item.append(anchor);
    cityList.append(item);
  }
}

if (typeof document !== "undefined") {
  renderDiscovery(readCatalog(), eventInput, new Date());
}

import {
  parseCatalogGroupLink,
  type CatalogGroup,
  type GroupCatalog,
} from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { validateEventDataset, type EventRecord } from "../events/model";
import eventData from "../../data/events.v1.json";
import { element, imageBlock, link, required, showFailure } from "./dom";
import {
  describeRegion,
  describeStyle,
  displayDate,
  eventStatusText,
  relatedEvents,
  todayInChina,
} from "./model";

function addFact(
  list: HTMLElement,
  label: string,
  text: string,
  note?: string,
): void {
  list.append(element("dt", label));
  const value = element("dd", text);
  if (note) value.append(element("small", note));
  list.append(value);
}

function eventsList(
  events: readonly EventRecord[],
  groupId: string,
  past: boolean,
): HTMLElement {
  const list = element("ul", "", "groups-event-list");
  for (const event of events) {
    const item = element("li");
    const date = element("time", event.date.slice(5).replace("-", "."));
    date.dateTime = event.date;
    date.append(element("span", event.date.slice(0, 4)));
    const body = element("div");
    body.append(
      link(
        event.title,
        `events.html?group=${encodeURIComponent(groupId)}&period=${past ? "past" : "upcoming"}#${encodeURIComponent(event.id)}`,
      ),
    );
    body.append(
      element(
        "p",
        `${eventStatusText(event)}${past ? " · 日期已过，不代表已举办" : ""}`,
      ),
    );
    body.append(
      element(
        "p",
        `${event.city || "城市待核实"} · ${event.venue || "场地待核实"}`,
      ),
    );
    body.append(
      element(
        "p",
        event.startsAt ? `开演 ${event.startsAt}（UTC+8）` : "开演时间未确认",
      ),
    );
    item.append(date, body);
    list.append(item);
  }
  return list;
}

function activitySection(
  group: CatalogGroup,
  catalog: GroupCatalog,
): HTMLElement {
  const section = element("section", "", "groups-detail-section");
  section.setAttribute("aria-label", "团体相关活动");
  section.append(element("h2", "从档案走向现场"));
  const validation = validateEventDataset(
    eventData,
    catalog.groups.map((item) => item.id),
  );
  if (!validation.valid) {
    const error = element(
      "p",
      "相关活动资料暂时无法读取，这不表示该团体没有活动。",
    );
    error.setAttribute("role", "status");
    section.append(error);
  } else {
    const related = relatedEvents(
      validation.data.events,
      group.id,
      todayInChina(),
    );
    section.append(
      element(
        "p",
        `活动资料编辑于 ${displayDate(validation.data.updatedAt)} · 仅覆盖已收录资料，出发前请核对官宣。`,
      ),
    );
    section.append(element("h3", "近期活动"));
    if (related.upcoming.length)
      section.append(eventsList(related.upcoming.slice(0, 5), group.id, false));
    else section.append(element("p", "尚未收录这支团体的近期活动。"));
    if (related.past.length) {
      const history = element("details");
      history.append(
        element("summary", `历史活动资料 · ${related.past.length} 条`),
      );
      history.append(eventsList(related.past.slice(0, 3), group.id, true));
      section.append(history);
    }
  }
  const actions = element("div", "", "groups-detail-actions");
  actions.append(
    link(
      "查看全部相关日程",
      `events.html?group=${encodeURIComponent(group.id)}&period=all`,
    ),
  );
  actions.append(link("第一次观演指南", "guide.html"));
  section.append(actions);
  return section;
}

function sourcesSection(group: CatalogGroup): HTMLElement {
  const section = element("section", "", "groups-detail-section");
  section.setAttribute("aria-label", "资料依据与身份说明");
  section.append(element("h2", "资料依据与身份说明"));
  const notes = new Set<string>();
  // 身份范围、注销和企划注释显式展示，避免把编辑判定误写为官方声明。
  for (const source of group.sources) {
    if (!source.note || notes.has(source.note)) continue;
    notes.add(source.note);
    section.append(element("p", `${source.label}：${source.note}`));
  }
  if (group.sources.length) {
    const details = element("details");
    details.append(
      element("summary", `查看 ${group.sources.length} 项来源与观察日期`),
    );
    const list = element("ul", "", "groups-source-list");
    for (const source of group.sources) {
      const item = element("li");
      item.append(link(source.label, source.url, true));
      item.append(element("p", `观察于 ${displayDate(source.observedAt)}`));
      list.append(item);
    }
    details.append(list);
    section.append(details);
  } else {
    section.append(
      element("p", "当前轻量档案未附单独来源，请查阅原分布图中的历史资料。"),
    );
  }
  section.append(
    link(
      "在风格分布图中查看",
      `index.html?group=${encodeURIComponent(group.id)}`,
    ),
  );
  section.append(
    element(
      "p",
      "宽口径风格属于编辑分类；公开账号粉丝数不等于现场人气或演出质量。",
    ),
  );
  section.append(
    link(
      "补充资料或纠错",
      `contribute.html?group=${encodeURIComponent(group.id)}&page=group&kind=error`,
    ),
  );
  return section;
}

export function mountGroupPage(): void {
  const root = required("group-main");
  const result = readCatalog();
  root.setAttribute("aria-busy", "false");
  if (!result.valid) {
    showFailure(
      root,
      "暂时无法读取团体档案",
      "资料文件缺失或未通过校验，请稍后重试；原有档案未因此被移除。",
      "h1",
    );
    return;
  }
  const parsed = parseCatalogGroupLink(
    window.location.search,
    result.data.groups,
  );
  if (parsed.state !== "valid") {
    showFailure(
      root,
      parsed.state === "none" ? "请选择要查看的团体" : "未找到对应的团体档案",
      "可以返回团体列表重新查找。未知、重复或过长的团体参数不会自动跳转到其他档案。",
      "h1",
    );
    document.title = "未选择有效团体 · 地下偶像资料档案";
    return;
  }
  const group = parsed.group;
  document.title = `${group.name} · 地下偶像资料档案`;
  root.replaceChildren();
  const header = element("header", "", "groups-detail-header");
  header.append(
    element("p", `CN-IDOL / ${group.id.toUpperCase()}`, "groups-kicker"),
  );
  header.append(element("h1", group.name));
  header.append(
    element(
      "span",
      group.status,
      group.isActive ? "groups-tag" : "groups-tag groups-tag-history",
    ),
  );
  header.append(
    element("p", `${group.handle} · 历史状态截点 ${result.data.archiveDate}`),
  );
  if (!group.isActive)
    header.append(
      element(
        "p",
        "此记录保留历史或非存续标记；具体身份与状态依据见下方资料说明。",
      ),
    );
  root.append(header);
  const hero = element("section", "", "groups-detail-hero");
  hero.setAttribute("aria-label", "团体身份与公开资料");
  const figure = element("figure");
  const visual = group.visual ?? group.avatar;
  figure.append(imageBlock(visual, group.name, true, true));
  const caption = element(
    "figcaption",
    visual
      ? `${visual.label} · 不据此确认当前完整阵容`
      : "尚未收录可用的团体资料图",
  );
  if (visual?.sourceUrl)
    caption.append(link("图像来源", visual.sourceUrl, true));
  figure.append(caption);
  hero.append(figure);
  const information = element("div");
  const facts = element("dl", "", "groups-facts");
  addFact(facts, "主要活动城市", describeRegion(group.activity));
  addFact(facts, "建团城市", describeRegion(group.founding));
  addFact(
    facts,
    "风格资料",
    describeStyle(group),
    group.styleNote || "宽口径编辑分类，不代表精确音乐测量或团体自述。",
  );
  if (group.styleState === "uncertain" && group.styleLabel)
    addFact(
      facts,
      "待核实线索",
      group.styleLabel,
      "保留原编辑线索，不作为已确认风格。",
    );
  if (group.aliases.length)
    addFact(facts, "别名 / 历史名称", group.aliases.join("、"));
  if (group.tags.length)
    addFact(
      facts,
      "资料标签",
      group.tags.join(" · "),
      "依档案中的编辑资料展示。",
    );
  if (group.followers)
    addFact(
      facts,
      "公开账号粉丝",
      group.followers.display,
      `观察于 ${displayDate(group.followers.observedAt)}；公开显示可能为近似值。`,
    );
  information.append(facts);
  const actions = element("div", "", "groups-detail-actions");
  if (group.officialUrl)
    actions.append(link("查看公开官号", group.officialUrl, true));
  if (group.wikiUrl) actions.append(link("Wiki 资料页", group.wikiUrl, true));
  information.append(actions);
  information.append(
    element(
      "p",
      "资料并非实时；身份、运营状态与活动安排以相关来源为准。",
      "groups-detail-note",
    ),
  );
  hero.append(information);
  root.append(hero);
  const sections = element("div", "", "groups-detail-sections");
  sections.append(activitySection(group, result.data), sourcesSection(group));
  root.append(sections);
}

if (typeof document !== "undefined" && document.getElementById("group-main"))
  mountGroupPage();

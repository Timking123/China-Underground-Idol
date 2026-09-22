import { normalizeRegionName } from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { validateEventDataset } from "../events/model";
import { chinaToday, weekendDates } from "../events/navigation";
import eventInput from "../../data/events.v1.json";
import { discoveryCities, discoveryEvents, eventUrl } from "../discover/model";
import { element, link, required } from "../groups/dom";
import {
  bindFollowButtons,
  followButton,
  getPreferences,
} from "../preferences/browser";
import { cityGroups, citySelection, cityVenues, cityPeriod } from "./model";
import { appendEvents, groupRow, section } from "./views";

export function mountCityPage(): void {
  const root = required("city-content");
  const catalog = readCatalog();
  root.replaceChildren();
  root.setAttribute("aria-busy", "false");
  if (!catalog.valid) {
    root.append(
      element(
        "p",
        "城市资料暂时无法读取，不能据此判断当地是否有活动。",
        "city-note",
      ),
    );
    return;
  }
  const checked = validateEventDataset(
    eventInput,
    catalog.data.groups.map((group) => group.id),
  );
  const events = checked.valid ? checked.data.events : [];
  const now = new Date();
  const cities = discoveryCities(
    catalog.data.groups,
    events,
    now,
    normalizeRegionName,
  );
  const city = citySelection(
    location.search,
    cities.map((item) => item.name),
    normalizeRegionName,
  );
  const chooser = required<HTMLFormElement>("city-picker");
  const select = required<HTMLSelectElement>("city-select");
  for (const item of cities) {
    const option = element("option", item.name);
    option.value = item.name;
    select.append(option);
  }
  if (city) select.value = city;
  chooser.addEventListener("submit", () => {
    if (select.value) getPreferences().setActiveCity(select.value);
  });
  if (!city) {
    required("city-title").textContent = "选择一座城市";
    root.append(
      element(
        "p",
        location.search
          ? "未找到地址对应的已收录城市，请重新选择。"
          : "从已收录的主要活动城市与演出记录开始。",
        "city-note",
      ),
    );
    return;
  }
  required("city-title").textContent = `${city} · 现场与团体`;
  document.title = `${city} · 城市现场 · 地下偶像资料档案`;
  required("city-actions").append(
    followButton("city", city, city),
    link("城市日历订阅", `subscriptions.html?${new URLSearchParams({ city })}`),
  );
  const localEvents = events.filter(
    (event) => event.city && normalizeRegionName(event.city) === city,
  );
  const weekendSelected = cityPeriod(location.search) === "weekend";
  const agenda = section(
    weekendSelected ? "本周末演出" : "近期演出",
    "city-upcoming",
  );
  const tabs = element("nav", "", "city-agenda-tabs");
  tabs.setAttribute("aria-label", "城市演出时间范围");
  for (const [period, title] of [
    ["upcoming", "近期"],
    ["weekend", "本周末"],
  ]) {
    const tab = link(
      title,
      `city.html?${new URLSearchParams({ city, period })}#city-upcoming`,
    );
    if (period === (weekendSelected ? "weekend" : "upcoming"))
      tab.setAttribute("aria-current", "page");
    tabs.append(tab);
  }
  agenda.append(tabs);
  const range = weekendDates(now);
  if (weekendSelected)
    agenda.append(
      element(
        "p",
        `${range.from} 至 ${range.to} · UTC+8；已过日期仅保留记录。`,
        "city-note",
      ),
    );
  if (!checked.valid)
    agenda.append(
      element(
        "p",
        "演出资料加载失败，请稍后重试。这不表示当地没有演出。",
        "city-note",
      ),
    );
  else
    appendEvents(
      agenda,
      weekendSelected
        ? localEvents
            .filter(
              (event) => event.date >= range.from && event.date <= range.to,
            )
            .sort((a, b) => a.date.localeCompare(b.date))
        : discoveryEvents(localEvents, now, 20),
      weekendSelected
        ? "尚未收录本周末活动，继续留意官方公告。"
        : "尚未收录本城近期演出；这不代表没有活动。可查看历史记录或补充官宣。",
    );
  agenda.append(
    link(
      "完整城市日程（含历史）",
      `events.html?${new URLSearchParams({ city, period: "all" })}`,
    ),
  );
  const groups = section("在这座城活动的团体", "city-groups");
  const localGroups = cityGroups(
    catalog.data.groups,
    city,
    normalizeRegionName,
  );
  const groupList = element("ul", "", "city-list");
  localGroups.forEach((group) => groupList.append(groupRow(group)));
  groups.append(
    localGroups.length
      ? groupList
      : element("p", "尚未收录主要活动地为本城的存续团体。"),
  );
  const venues = section("有来源的场馆记录", "city-venues");
  venues.append(
    element(
      "p",
      "以下地址来自已收录活动的官方、主办或场馆来源，不保证当前营业或下一场安排。",
      "city-note",
    ),
  );
  const records = cityVenues(localEvents);
  for (const venue of records) {
    const item = element("article", "", "city-venue");
    item.append(
      element("h3", venue.name),
      element("p", venue.address),
      element(
        "p",
        `活动日期 ${venue.event.date}${venue.event.date < chinaToday(now) ? " · 历史记录" : ""}`,
      ),
      link("查看活动与来源", eventUrl(venue.event)),
    );
    venues.append(item);
  }
  if (!records.length)
    venues.append(
      element(
        "p",
        checked.valid
          ? "尚未收录同时具备可靠来源和地址的场馆记录。"
          : "演出资料不可用，暂不能展示场馆依据。",
      ),
    );
  const guide = section("出发之前", "city-guide");
  guide.append(
    element(
      "p",
      "日程只覆盖已收录资料。取消、延期和待确认仍保留展示，请在出发前查看详情及官宣。",
    ),
    link("第一次观演指南", "guide.html"),
    link(
      "补充本城资料或纠错",
      `contribute.html?${new URLSearchParams({ page: "city", kind: "error", city })}`,
    ),
  );
  const main = element("div", "", "city-primary");
  main.append(agenda);
  const aside = element("div", "", "city-secondary");
  aside.append(groups, venues, guide);
  root.append(main, aside);
  bindFollowButtons();
}
if (typeof document !== "undefined" && document.getElementById("city-content"))
  mountCityPage();

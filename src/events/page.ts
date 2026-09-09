import rawDataset from "../../data/events.v1.json";
import { readCatalog } from "../catalog/runtime";
import { normalizeRegionName } from "../catalog/model";
import {
  buildCalendarIcs,
  getEventTemporalState,
  isLocalEventPosterPath,
  validateEventDataset,
  type EventDataset,
  type EventRecord,
} from "./model";
import {
  chinaToday,
  emptyFilters,
  hasControlCharacters,
  isValidPageDate,
  parseFilters,
  resolveEventLocation,
  selectPageEvents,
  serializeFilters,
  weekendDates,
  type EventPeriod,
  type FilterOptions,
} from "./navigation";

export {
  chinaToday,
  emptyFilters,
  isValidPageDate,
  parseFilters,
  resolveEventLocation,
  selectPageEvents,
  serializeFilters,
  weekendDates,
  type FilterOptions,
  type PageFilters,
} from "./navigation";

export interface GroupReference {
  id: string;
  name: string;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const STATUS_LABELS: Record<EventRecord["status"], string> = {
  scheduled: "计划举行",
  postponed: "已延期 · 新安排请核对官宣",
  cancelled: "已取消",
  unconfirmed: "待确认 · 请核对官宣",
};

export function monthDates(month: string): (string | null)[] {
  if (!isValidPageDate(`${month}-01`)) return [];
  const start = new Date(`${month}-01T00:00:00Z`);
  const offset = (start.getUTCDay() + 6) % 7;
  const count = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dates: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= count; day++)
    dates.push(`${month}-${String(day).padStart(2, "0")}`);
  while (dates.length % 7) dates.push(null);
  return dates;
}

export function shiftMonth(month: string, offset: number): string {
  if (!isValidPageDate(`${month}-01`)) return month;
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const shifted = date.toISOString().slice(0, 7);
  return isValidPageDate(`${shifted}-01`) ? shifted : month;
}

export function safeExternalUrl(value: string): string | null {
  if (
    value.length > 2048 ||
    !/^https?:\/\//iu.test(value) ||
    hasControlCharacters(value) ||
    /[\s\\]|%0[ad]/iu.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function safePosterUrl(value: string): string | null {
  if (/^https?:\/\//iu.test(value)) return safeExternalUrl(value);
  return isLocalEventPosterPath(value) ? value : null;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少页面节点：${id}`);
  return node as T;
}

function externalLink(url: string, label: string): HTMLElement {
  const safe = safeExternalUrl(url);
  if (!safe) return element("span", `${label}（来源链接不可用）`);
  const link = element("a", label);
  link.href = safe;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function uniqueRegions(values: string[]): string[] {
  const regions = new Map<string, string>();
  for (const value of values) {
    const key = normalizeRegionName(value);
    if (!regions.has(key)) regions.set(key, value);
  }
  return [...regions.values()];
}

function eventEntry(event: EventRecord, now: Date): HTMLElement {
  const article = element("article", "", "events-entry");
  article.id = event.id;
  article.tabIndex = -1;
  const date = element("time", "", "events-date");
  date.dateTime = event.date;
  date.append(
    element("strong", event.date.slice(5).replace("-", ".")),
    element("span", event.date.slice(0, 4)),
  );
  const body = element("div");
  const badges = element("div", "", "events-badges");
  const status = element("span", STATUS_LABELS[event.status], "events-badge");
  status.dataset.status = event.status;
  badges.append(status);
  const temporal = getEventTemporalState(event, now);
  if (temporal === "past")
    badges.append(element("span", "日期已过 · 不代表已举办", "events-badge"));
  else if (temporal === "today")
    badges.append(element("span", "今天", "events-badge"));
  body.append(badges, element("h3", event.title));
  body.append(
    element(
      "p",
      `${[event.province, event.city].filter(Boolean).join(" · ") || "地区待核实"} / ${event.venue || "场地待核实"}`,
    ),
  );
  body.append(
    element(
      "p",
      event.startsAt ? `开演 ${event.startsAt}（UTC+8）` : "开演时间未确认",
    ),
  );
  const performers = element("div", "", "events-performers");
  performers.append(element("span", "出演："));
  if (!event.performers.length)
    performers.append(element("span", "出演阵容待核实"));
  for (const performer of event.performers) {
    if (performer.groupId) {
      const link = element("a", performer.name);
      link.href = `group.html?group=${encodeURIComponent(performer.groupId)}`;
      performers.append(link);
    } else performers.append(element("span", performer.name));
  }
  body.append(performers);
  const details = element("details", "", "events-detail");
  details.append(element("summary", "展开详情与信息来源"));
  const detailBody = element("div", "", "events-detail-body");
  detailBody.append(
    element(
      "p",
      `入场：${event.opensAt || "待确认"} / 开演：${event.startsAt || "待确认"} / 结束：${event.endsAt || "待确认"}（UTC+8）`,
    ),
  );
  detailBody.append(
    element("p", `地址：${event.address || "待核实，请查阅官宣"}`),
  );
  if (event.notes) detailBody.append(element("p", event.notes, "events-notes"));
  if (event.status === "postponed")
    detailBody.append(
      element("p", "此处保留已收录日期；延期后的日期与安排请以最新官宣为准。"),
    );
  const sources = element("ul");
  for (const source of event.sources) {
    const item = element("li");
    item.append(
      externalLink(source.url, `${source.label} · ${source.publisher}`),
    );
    item.append(
      element("span", ` · 观察时间：${source.observedAt}`, "events-meta"),
    );
    sources.append(item);
  }
  detailBody.append(element("p", "资料来源"), sources);
  const correction = element("a", "补充或纠正这场活动");
  correction.href = `contribute.html?event=${encodeURIComponent(event.id)}&page=events&kind=event`;
  detailBody.append(correction);
  if (event.poster) {
    const src = safePosterUrl(event.poster.src);
    if (src) {
      const image = element("img", "", "events-poster");
      image.src = src;
      image.alt = event.poster.alt;
      image.loading = "lazy";
      image.width = 360;
      image.height = 480;
      image.addEventListener(
        "error",
        () =>
          image.replaceWith(element("p", "海报暂时无法显示，请查看原始来源。")),
        { once: true },
      );
      detailBody.append(
        image,
        externalLink(event.poster.sourceUrl, "海报来源"),
      );
    }
  }
  details.append(detailBody);
  body.append(details);
  article.append(date, body);
  return article;
}

export function mountEventsPage(
  dataset: EventDataset,
  groups: GroupReference[],
  now?: Date,
): void {
  const readNow = (): Date => now ?? new Date();
  let today = chinaToday(readNow());
  const form = required<HTMLFormElement>("events-filters");
  const query = required<HTMLInputElement>("events-query");
  const from = required<HTMLInputElement>("events-from");
  const to = required<HTMLInputElement>("events-to");
  const group = required<HTMLSelectElement>("events-group");
  const periodInput = required<HTMLInputElement>("events-period");
  const cityShortcut = required<HTMLSelectElement>("events-city-shortcut");
  const notice = required("events-filter-notice");
  const list = required("events-list");
  const status = required("events-result-status");
  const calendar = required("events-calendar");
  const grid = required("events-month-grid");
  const exportButton = required<HTMLButtonElement>("events-export");
  const regionRoot = required("events-region-options");
  const options: FilterOptions = {
    groupIds: new Set(groups.map((item) => item.id)),
    provinces: new Set(
      uniqueRegions(
        dataset.events.flatMap((item) =>
          item.province ? [item.province] : [],
        ),
      ),
    ),
    cities: new Set(
      uniqueRegions(
        dataset.events.flatMap((item) => (item.city ? [item.city] : [])),
      ),
    ),
  };
  for (const city of [...options.cities].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  )) {
    const option = element("option", city);
    option.value = city;
    cityShortcut.append(option);
  }
  for (const item of [...groups].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  )) {
    const option = element("option", item.name);
    option.value = item.id;
    group.append(option);
  }
  const regions = new Map<string, Set<string>>();
  for (const event of dataset.events) {
    const province =
      [...options.provinces].find(
        (value) =>
          event.province !== null &&
          normalizeRegionName(value) === normalizeRegionName(event.province),
      ) || "省份待核实";
    if (!regions.has(province)) regions.set(province, new Set());
    const city = [...options.cities].find(
      (value) =>
        event.city !== null &&
        normalizeRegionName(value) === normalizeRegionName(event.city),
    );
    if (city) regions.get(province)?.add(city);
  }
  const checkboxes: HTMLInputElement[] = [];
  const checkbox = (
    name: "province" | "city",
    value: string,
    label: string,
  ): HTMLLabelElement => {
    const wrapper = element("label");
    const input = element("input");
    input.type = "checkbox";
    input.name = name;
    input.value = value;
    checkboxes.push(input);
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  };
  for (const [province, cities] of [...regions].sort(([a], [b]) =>
    a.localeCompare(b, "zh-CN"),
  )) {
    if (!options.provinces.has(province) && !cities.size) continue;
    const fieldset = element("fieldset");
    fieldset.append(element("legend", province));
    if (options.provinces.has(province))
      fieldset.append(checkbox("province", province, `全部${province}`));
    for (const city of [...cities].sort())
      fieldset.append(checkbox("city", city, city));
    regionRoot.append(fieldset);
  }
  if (!regionRoot.childElementCount)
    regionRoot.append(
      element(
        "p",
        "暂无已核实地区，仍可按日期、团体或关键词筛选。",
        "events-help",
      ),
    );
  required("events-updated").textContent =
    `资料更新时间：${dataset.updatedAt} · 收录范围：部分活动`;
  let filters = emptyFilters();
  let matches: EventRecord[] = [];
  let view: "list" | "month" = "list";
  let month = today.slice(0, 7);
  let selectedDate = "";

  const syncForm = (): void => {
    today = chinaToday(readNow());
    query.value = filters.q;
    from.value = filters.from;
    to.value = filters.to;
    group.value = filters.group;
    periodInput.value = filters.period;
    cityShortcut.value =
      filters.province.length || filters.city.length > 1
        ? "__multiple__"
        : filters.city[0] || "";
    const customDates = Boolean(filters.from || filters.to);
    for (const button of form.querySelectorAll<HTMLButtonElement>(
      "[data-period]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(!customDates && button.dataset.period === filters.period),
      );
    to.setCustomValidity("");
    for (const input of checkboxes)
      input.checked = filters[input.name as "province" | "city"].includes(
        input.value,
      );
    const count = filters.province.length + filters.city.length;
    required("events-region-count").textContent = count
      ? `已选 ${count} 项`
      : "不限地区";
    const advancedCount =
      Number(Boolean(filters.from || filters.to)) +
      Number(Boolean(filters.group)) +
      count;
    required("events-advanced-count").textContent = advancedCount
      ? `（${advancedCount}）`
      : "";
    required("events-active-filters").textContent = [
      filters.q ? `关键词：${filters.q}` : "",
      filters.from || filters.to
        ? `${filters.from || "不限开始"} 至 ${filters.to || "不限结束"}`
        : "",
      filters.group
        ? `团体：${groups.find((item) => item.id === filters.group)?.name || filters.group}`
        : "",
      ...filters.province,
      ...filters.city,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const renderCalendar = (): void => {
    required("events-month-heading").textContent =
      `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
    required<HTMLButtonElement>("events-prev-month").disabled =
      month === "1900-01";
    required<HTMLButtonElement>("events-next-month").disabled =
      month === "2100-12";
    grid.replaceChildren();
    for (const day of WEEKDAYS)
      grid.append(element("span", day, "events-weekday"));
    const counts = new Map<string, number>();
    for (const event of matches)
      counts.set(event.date, (counts.get(event.date) || 0) + 1);
    for (const date of monthDates(month)) {
      if (!date) {
        const blank = element("span");
        blank.setAttribute("aria-hidden", "true");
        grid.append(blank);
        continue;
      }
      const count = counts.get(date) || 0;
      const button = element("button", "", "events-day");
      button.type = "button";
      button.dataset.date = date;
      button.dataset.hasEvents = String(count > 0);
      button.setAttribute("aria-label", `${date}，${count} 场已收录活动`);
      button.setAttribute("aria-pressed", String(date === selectedDate));
      if (date === today) button.setAttribute("aria-current", "date");
      button.append(
        element("strong", String(Number(date.slice(8)))),
        element("span", count ? `${count} 场` : "—"),
      );
      button.addEventListener("click", () => {
        selectedDate = date;
        render();
        grid.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
      });
      grid.append(button);
    }
    required("events-show-month").hidden = !selectedDate;
  };
  const render = (at: Date = readNow()): void => {
    today = chinaToday(at);
    required("events-today").setAttribute(
      "aria-pressed",
      String(
        filters.period === "all" &&
          filters.from === today &&
          filters.to === today,
      ),
    );
    const weekend = weekendDates(at);
    required("events-weekend").setAttribute(
      "aria-pressed",
      String(
        filters.period === "all" &&
          filters.from === weekend.from &&
          filters.to === weekend.to,
      ),
    );
    // 领域筛选是唯一事实来源；页面仅对月历当前可见日期做展示切片。
    matches = selectPageEvents(dataset.events, filters, at);
    const visible =
      view === "list"
        ? matches
        : matches.filter((event) =>
            selectedDate
              ? event.date === selectedDate
              : event.date.startsWith(month),
          );
    const rangeLabel =
      filters.from || filters.to
        ? "所选日期"
        : { upcoming: "近期", past: "历史", all: "全部日期" }[filters.period];
    status.textContent = `${rangeLabel} · 共 ${matches.length} 场已收录活动${view === "month" ? `，当前${selectedDate ? "日期" : "月份"} ${visible.length} 场` : ""}`;
    exportButton.disabled = matches.length === 0;
    exportButton.setAttribute(
      "aria-label",
      `下载当前筛选的 ${matches.length} 场活动 ICS`,
    );
    calendar.hidden = view !== "month";
    required("events-list-view").setAttribute(
      "aria-pressed",
      String(view === "list"),
    );
    required("events-month-view").setAttribute(
      "aria-pressed",
      String(view === "month"),
    );
    required("events-list-caption").textContent =
      view === "month"
        ? selectedDate || `${month} 整月`
        : "按日期排列 · 状态以已收录官宣为准";
    if (view === "month") renderCalendar();
    list.replaceChildren(...visible.map((event) => eventEntry(event, at)));
    required("events-empty").hidden = visible.length > 0;
    required("events-empty-reason").textContent =
      matches.length && view === "month"
        ? "当前日期或月份暂无结果。可切换月份、显示整月，或切回日程查看全部筛选结果。"
        : "尚未收录不代表没有活动。试试其他日期或城市，也可补充可靠官宣。";
    required("events-empty-history").hidden =
      filters.period === "past" ||
      !dataset.events.some((event) => event.date < today);
  };
  const resetMonth = (): void => {
    today = chinaToday(readNow());
    matches = selectPageEvents(dataset.events, filters, readNow());
    month = (
      filters.from ||
      matches.find((event) => event.date >= today)?.date ||
      matches[0]?.date ||
      today
    ).slice(0, 7);
    selectedDate = "";
  };
  const restore = (): void => {
    const parsed = resolveEventLocation(
      window.location.search,
      window.location.hash,
      options,
      dataset.events,
      readNow(),
    );
    filters = parsed.filters;
    notice.textContent = [
      parsed.ignored ? "链接中部分筛选参数无效，已忽略；有效条件仍保留。" : "",
      parsed.adjusted
        ? "为显示链接中的活动，已切换至全部日期并清除冲突筛选。"
        : "",
      parsed.invalidAnchor
        ? "链接中的活动标识无效或尚未收录，仍可浏览下方日程。"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (parsed.anchor) view = "list";
    syncForm();
    resetMonth();
    render();
    if (parsed.anchor) {
      const target = document.getElementById(parsed.anchor.id);
      target
        ?.querySelector<HTMLDetailsElement>("details")
        ?.setAttribute("open", "");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
    }
  };
  const save = (): void => {
    const search = serializeFilters(filters);
    if (search !== window.location.search || window.location.hash) {
      try {
        window.history.pushState(
          null,
          "",
          `${window.location.pathname}${search}`,
        );
      } catch {
        notice.textContent = "当前浏览器未允许更新地址，筛选仍可使用。";
      }
    }
    syncForm();
    resetMonth();
    render();
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    to.setCustomValidity(
      from.value && to.value && from.value > to.value
        ? "结束日期不能早于开始日期"
        : "",
    );
    if (!form.reportValidity()) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form))
      if (typeof value === "string" && value) params.append(key, value);
    const parsed = parseFilters(params.toString(), options);
    filters = parsed.filters;
    notice.textContent = parsed.ignored ? "部分筛选内容无效，已忽略。" : "";
    save();
  });
  form.addEventListener("input", () => to.setCustomValidity(""));
  form.addEventListener("change", (event) => {
    // 搜索草稿由搜索按钮或回车提交，失焦到导出按钮不能改变已应用条件。
    if (event.target === cityShortcut || event.target === query) return;
    if (event.target === from || event.target === to) periodInput.value = "all";
    form.requestSubmit();
  });
  cityShortcut.addEventListener("change", () => {
    filters.city = cityShortcut.value ? [cityShortcut.value] : [];
    filters.province = [];
    notice.textContent = "";
    save();
  });
  const choosePeriod = (period: EventPeriod): void => {
    filters.period = period;
    filters.from = "";
    filters.to = "";
    view = "list";
    notice.textContent = "";
    save();
  };
  for (const button of form.querySelectorAll<HTMLButtonElement>(
    "[data-period]",
  ))
    button.addEventListener("click", () =>
      choosePeriod(button.dataset.period as EventPeriod),
    );
  required("events-empty-history").addEventListener("click", () =>
    choosePeriod("past"),
  );
  const chooseDates = (range: { from: string; to: string }): void => {
    filters = { ...filters, ...range, period: "all" };
    view = "list";
    notice.textContent = "";
    save();
  };
  required("events-today").addEventListener("click", () => {
    const date = chinaToday(readNow());
    chooseDates({ from: date, to: date });
  });
  required("events-weekend").addEventListener("click", () =>
    chooseDates(weekendDates(readNow())),
  );
  query.addEventListener("search", () => form.requestSubmit());
  const reset = (): void => {
    filters = emptyFilters();
    view = "list";
    notice.textContent = "";
    save();
  };
  form.addEventListener("reset", (event) => {
    event.preventDefault();
    reset();
  });
  required("events-empty-reset").addEventListener("click", () => {
    reset();
    query.focus();
  });
  required("events-list-view").addEventListener("click", () => {
    view = "list";
    render();
  });
  required("events-month-view").addEventListener("click", () => {
    view = "month";
    render();
  });
  required("events-prev-month").addEventListener("click", () => {
    month = shiftMonth(month, -1);
    selectedDate = "";
    render();
  });
  required("events-next-month").addEventListener("click", () => {
    month = shiftMonth(month, 1);
    selectedDate = "";
    render();
  });
  required("events-current-month").addEventListener("click", () => {
    today = chinaToday(readNow());
    month = today.slice(0, 7);
    selectedDate = "";
    render();
  });
  required("events-show-month").addEventListener("click", () => {
    selectedDate = "";
    render();
    required("events-month-heading").focus();
  });
  window.addEventListener("popstate", restore);
  window.addEventListener("hashchange", restore);
  document.addEventListener("visibilitychange", () => {
    const at = readNow();
    if (!document.hidden && today !== chinaToday(at)) render(at);
  });
  exportButton.addEventListener("click", () => {
    // 同一次时刻用于成员、日期标签和 ICS，刷新结果不能回填未提交的表单草稿。
    const at = readNow();
    render(at);
    if (!matches.length) return;
    try {
      const content = buildCalendarIcs(matches, at);
      const url = URL.createObjectURL(
        new Blob([content], { type: "text/calendar;charset=utf-8" }),
      );
      const link = element("a");
      link.href = url;
      link.download = `idol-events-${today}.ics`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = `已生成 ${matches.length} 场活动的 ICS 文件，请手动导入日历应用。`;
    } catch {
      status.textContent = "日历文件生成失败，请重新筛选后再试。";
    }
  });
  restore();
}

function boot(): void {
  try {
    const catalog = readCatalog();
    if (!catalog.valid) throw new Error("团体索引缺失或无效");
    const validation = validateEventDataset(
      rawDataset,
      catalog.data.groups.map((item) => item.id),
    );
    if (!validation.valid) throw new Error("活动资料校验失败");
    mountEventsPage(validation.data, catalog.data.groups);
  } catch {
    required("events-result-status").textContent =
      "活动资料暂时无法读取，请重新打开完整站点文件，或稍后重试。";
    required<HTMLButtonElement>("events-export").disabled = true;
    for (const control of document.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("#events-filters input, #events-filters button, #events-filters select"))
      control.disabled = true;
  }
}

if (typeof document !== "undefined" && document.getElementById("events-app"))
  boot();

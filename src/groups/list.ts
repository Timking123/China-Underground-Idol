import {
  defaultCatalogFilters,
  filterCatalogGroups,
  normalizeRegionName,
  type CatalogFilters,
  type CatalogGroup,
  type GroupCatalog,
} from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { element, imageBlock, link, required, showFailure } from "./dom";
import {
  describeRegion,
  describeStyle,
  displayDate,
  paginateGroups,
  parseGroupListSearch,
  prepareGroupListSubmission,
  sortGroupList,
  type GroupListSort,
} from "./model";

function storedPage(value: unknown): number {
  if (!value || typeof value !== "object" || !("groupsPage" in value)) return 1;
  return typeof value.groupsPage === "number" ? value.groupsPage : 1;
}

function makeCard(
  group: CatalogGroup,
  filters: CatalogFilters,
  first: boolean,
  sort: GroupListSort,
): HTMLElement {
  const card = element("article", "", "groups-card");
  card.dataset.groupId = group.id;
  card.append(imageBlock(group.avatar, group.name, false, first));
  const content = element("div");
  const title = element("h3");
  title.append(
    link(group.name, `group.html?group=${encodeURIComponent(group.id)}`),
  );
  content.append(title);
  const region =
    filters.regionRole === "activity" ? group.activity : group.founding;
  content.append(element("p", describeRegion(region)));
  content.append(element("p", describeStyle(group), "groups-card-style"));
  content.append(
    element(
      "span",
      group.status,
      group.isActive ? "groups-tag" : "groups-tag groups-tag-history",
    ),
  );
  if (sort === "followers")
    content.append(
      element(
        "p",
        group.followers
          ? `账号粉丝 ${group.followers.display} · 观察于 ${displayDate(group.followers.observedAt)}`
          : "账号粉丝观察值待核实",
        "groups-card-style",
      ),
    );
  card.append(content);
  return card;
}

export function mountGroupsPage(): void {
  const result = readCatalog();
  const results = required("groups-results");
  const count = required("groups-count");
  results.setAttribute("aria-busy", "false");
  if (!result.valid) {
    count.textContent = "资料加载失败";
    showFailure(
      results,
      "暂时无法读取团体资料",
      "资料文件缺失或未通过校验，请稍后重试。这不表示没有收录团体。",
    );
    return;
  }
  const catalog: GroupCatalog = result.data;
  const form = required<HTMLFormElement>("groups-filters");
  const query = required<HTMLInputElement>("groups-query");
  const status = required<HTMLSelectElement>("groups-status");
  const role = required<HTMLSelectElement>("groups-region-role");
  const style = required<HTMLSelectElement>("groups-style");
  const sorting = required<HTMLSelectElement>("groups-sort");
  const regions = required("groups-region-options");
  const notice = required("groups-notice");
  const pagination = required("groups-pagination");
  const previous = required<HTMLButtonElement>("groups-prev");
  const next = required<HTMLButtonElement>("groups-next");
  let filters: CatalogFilters = defaultCatalogFilters();
  let page = 1;
  let sort: GroupListSort = "archive";
  form.hidden = false;
  required("groups-archive").textContent =
    `收录 ${catalog.groups.length} 条档案 · 历史截点 ${catalog.archiveDate} · 状态以各项来源为准`;

  for (const label of [
    ...new Set(catalog.groups.map((group) => group.styleLabel).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
    const option = element("option", label);
    option.value = label;
    style.append(option);
  }

  const setNotice = (message: string): void => {
    notice.textContent = message;
    notice.hidden = !message;
  };

  const drawRegions = (clear = false): void => {
    regions.replaceChildren();
    const items = new Map<
      string,
      { province: string | null; cities: Map<string, string> }
    >();
    for (const group of catalog.groups) {
      const region =
        role.value === "founding" ? group.founding : group.activity;
      if (!region.province && !region.city) continue;
      const key = region.province ? normalizeRegionName(region.province) : "";
      const item = items.get(key) ?? {
        province: region.province,
        cities: new Map<string, string>(),
      };
      if (region.city)
        item.cities.set(normalizeRegionName(region.city), region.city);
      items.set(key, item);
    }
    const appendChoice = (
      parent: HTMLElement,
      kind: "province" | "city",
      value: string,
    ): void => {
      const label = element("label");
      const input = element("input");
      input.type = "checkbox";
      input.name = kind;
      input.value = value;
      input.checked =
        !clear &&
        filters[kind].some(
          (item) => normalizeRegionName(item) === normalizeRegionName(value),
        );
      label.append(
        input,
        document.createTextNode(
          kind === "province" ? `全省/市 · ${value}` : value,
        ),
      );
      parent.append(label);
    };
    for (const [, item] of [...items.entries()].sort(([a], [b]) =>
      a.localeCompare(b, "zh-CN"),
    )) {
      const section = element("details");
      section.append(element("summary", item.province ?? "其他已知城市"));
      if (item.province) appendChoice(section, "province", item.province);
      for (const city of [...item.cities.values()].sort((a, b) =>
        a.localeCompare(b, "zh-CN"),
      ))
        appendChoice(section, "city", city);
      regions.append(section);
    }
    if (!items.size)
      regions.append(
        element("p", "当前资料尚无可筛选的已知地区。", "groups-help"),
      );
  };

  const syncForm = (): void => {
    query.value = filters.q;
    status.value = filters.status;
    role.value = filters.regionRole;
    style.value = filters.style;
    sorting.value = sort;
    drawRegions();
  };

  const render = (): void => {
    const matched = sortGroupList(
      filterCatalogGroups(catalog.groups, filters),
      sort,
    );
    const visible = paginateGroups(matched, page);
    page = visible.page;
    results.replaceChildren();
    count.textContent = `找到 ${visible.total} 条 · 共 ${catalog.groups.length} 条档案${sort === "followers" ? " · 按账号观察值排序，不代表现场人气" : ""}`;
    const roleText =
      filters.regionRole === "activity" ? "主要活动城市" : "建团城市";
    const regionsText = [...filters.province, ...filters.city].join("、");
    required("groups-filter-summary").textContent =
      `${filters.status === "active" ? "存续" : "含历史"} · ${roleText}${regionsText ? ` · ${regionsText}` : ""}${filters.style ? ` · ${filters.style}` : ""}`;
    if (!visible.total) {
      const empty = element("section", "", "groups-empty");
      empty.append(element("h2", "没有符合条件的已收录团体"));
      empty.append(
        element(
          "p",
          "这不代表当地没有团体。可以减少筛选条件，或补充可核实的官号资料。",
        ),
      );
      const reset = element("button", "清除筛选", "groups-primary");
      reset.type = "button";
      reset.addEventListener("click", () => {
        resetFilters();
        query.focus();
      });
      empty.append(reset, link("补充资料", "contribute.html"));
      results.append(empty);
    } else {
      visible.items.forEach((group, index) =>
        results.append(makeCard(group, filters, index < 3, sort)),
      );
    }
    pagination.hidden = visible.pages === 1;
    previous.disabled = page <= 1;
    next.disabled = page >= visible.pages;
    required("groups-page-info").textContent =
      `第 ${page} / ${visible.pages} 页`;
  };

  const remember = (push: boolean): void => {
    const prepared = prepareGroupListSubmission(filters, sort, catalog);
    if (!prepared.valid) {
      setNotice(prepared.message);
      return;
    }
    const address = `${window.location.pathname}${prepared.search}`;
    try {
      if (push) window.history.pushState({ groupsPage: page }, "", address);
      else window.history.replaceState({ groupsPage: page }, "", address);
    } catch {
      setNotice(
        "筛选已应用；当前浏览器无法保存地址，请使用支持静态页面历史记录的浏览器分享条件。",
      );
    }
  };

  const resetFilters = (): void => {
    filters = defaultCatalogFilters();
    sort = "archive";
    page = 1;
    setNotice("");
    syncForm();
    render();
    remember(true);
  };

  const applyFilters = (): void => {
    const chosen = (kind: string): string[] =>
      [
        ...regions.querySelectorAll<HTMLInputElement>(
          `input[name="${kind}"]:checked`,
        ),
      ].map((input) => input.value);
    const candidate: CatalogFilters = {
      q: query.value.trim(),
      status: status.value === "all" ? "all" : "active",
      regionRole: role.value === "founding" ? "founding" : "activity",
      province: chosen("province"),
      city: chosen("city"),
      style: style.value,
    };
    const candidateSort =
      sorting.value === "followers" ? "followers" : "archive";
    const prepared = prepareGroupListSubmission(
      candidate,
      candidateSort,
      catalog,
    );
    if (!prepared.valid) {
      setNotice(prepared.message);
      return;
    }
    filters = prepared.filters;
    sort = prepared.sort;
    page = 1;
    setNotice("");
    syncForm();
    render();
    remember(true);
  };

  const restore = (): void => {
    const parsed = parseGroupListSearch(window.location.search, catalog);
    filters = parsed.filters;
    sort = parsed.sort;
    page = storedPage(window.history.state as unknown);
    syncForm();
    setNotice(parsed.ignored ? "地址中含无效或不支持的条件，已安全忽略。" : "");
    render();
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
  });
  form.addEventListener("reset", (event) => {
    event.preventDefault();
    resetFilters();
  });
  role.addEventListener("change", () => {
    drawRegions(true);
    setNotice("已切换地域口径并清除地区选择；点击应用筛选确认。");
  });
  const movePage = (direction: number): void => {
    page += direction;
    render();
    remember(false);
    results
      .querySelector<HTMLAnchorElement>("h3 a")
      ?.focus({ preventScroll: true });
    required("groups-results-title").scrollIntoView({ block: "start" });
  };
  previous.addEventListener("click", () => movePage(-1));
  next.addEventListener("click", () => movePage(1));
  window.addEventListener("popstate", restore);
  restore();
}

if (typeof document !== "undefined" && document.getElementById("groups-app"))
  mountGroupsPage();

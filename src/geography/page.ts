import {
  defaultCatalogFilters,
  normalizeRegionName,
  parseCatalogFilters,
  serializeCatalogFilters,
  type CatalogFilters,
  type CatalogGroup,
  type GroupCatalog,
} from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { element, link, required } from "../groups/dom";
import { describeRegion } from "../groups/model";
import { buildGeographyModel, GEOGRAPHY_DATA } from "./model";
import { GeographyMap, validCamera, type MapCamera } from "./renderer";
import type { GeoCity, GeographyData } from "./types";

export interface GeographyState {
  filters: CatalogFilters;
  unknown: boolean;
  camera: MapCamera | null;
}

export function defaultGeographyState(): GeographyState {
  return { filters: defaultCatalogFilters(), unknown: false, camera: null };
}

/** 地图允许选择尚未收录团体的真实地区，因此按完整地理字典校验 URL。 */
export function parseGeographySearch(
  search: string,
  catalog: GroupCatalog,
  data: GeographyData,
): { state: GeographyState; ignored: boolean } {
  const state = defaultGeographyState();
  if (search.length > 4096) return { state, ignored: true };
  try {
    decodeURIComponent(search.replace(/\+/gu, " "));
  } catch {
    return { state, ignored: true };
  }
  const params = new URLSearchParams(search);
  let ignored = false;
  for (const key of ["province", "city"] as const) {
    const values = params.getAll(key);
    if (values.length > 64) ignored = true;
    else {
      const choices = key === "province" ? data.provinces : data.cities;
      for (const value of values) {
        const choice = choices.find((entry) =>
          [entry.name, ...entry.aliases].some(
            (name) => normalizeRegionName(name) === normalizeRegionName(value),
          ),
        );
        if (!choice) ignored = true;
        else if (!state.filters[key].includes(choice.name))
          state.filters[key].push(choice.name);
      }
    }
    params.delete(key);
  }
  const unknown = params.getAll("unknown");
  if (unknown.length === 1 && unknown[0] === "1") state.unknown = true;
  else if (unknown.length) ignored = true;
  params.delete("unknown");
  // 未定位是独立全国入口；含地区的旧链接保留地区，明确忽略未定位标志。
  if (
    state.unknown &&
    (state.filters.province.length || state.filters.city.length)
  ) {
    state.unknown = false;
    ignored = true;
  }
  const cameraKeys = ["lng", "lat", "zoom"] as const;
  if (cameraKeys.some((key) => params.has(key))) {
    const raw = cameraKeys.map((key) => params.getAll(key));
    const camera = {
      longitude: Number(raw[0][0]),
      latitude: Number(raw[1][0]),
      zoom: Number(raw[2][0]),
    };
    if (
      raw.every((values) => values.length === 1 && values[0].trim() !== "") &&
      validCamera(camera)
    )
      state.camera = camera;
    else ignored = true;
  }
  for (const key of cameraKeys) params.delete(key);
  const common = parseCatalogFilters(params.toString(), catalog);
  state.filters = {
    ...common.filters,
    province: state.filters.province,
    city: state.filters.city,
  };
  return { state, ignored: ignored || common.ignored };
}

export function serializeGeographyState(state: GeographyState): string {
  const params = new URLSearchParams(serializeCatalogFilters(state.filters));
  if (
    state.unknown &&
    !state.filters.province.length &&
    !state.filters.city.length
  )
    params.set("unknown", "1");
  if (state.camera && validCamera(state.camera)) {
    params.set("lng", state.camera.longitude.toFixed(5));
    params.set("lat", state.camera.latitude.toFixed(5));
    params.set("zoom", state.camera.zoom.toFixed(4));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function selectGeographyRegion(
  state: GeographyState,
  kind: "province" | "city" | "unknown" | "national",
  name = "",
): GeographyState {
  return {
    ...state,
    camera: null,
    unknown: kind === "unknown",
    filters: {
      ...state.filters,
      province: kind === "province" && name ? [name] : [],
      city: kind === "city" && name ? [name] : [],
    },
  };
}

function options(
  select: HTMLSelectElement,
  items: { value: string; label: string }[],
  value: string,
): void {
  select.replaceChildren(
    ...items.map((item) => {
      const option = element("option", item.label);
      option.value = item.value;
      return option;
    }),
  );
  select.value = value;
}

/** 城市入口与点击后的名单共用口径，包含缺省份或尚未定位的匹配团体。 */
export function cityResultCount(
  groups: readonly CatalogGroup[],
  filters: CatalogFilters,
  cityName: string,
  data: GeographyData,
): number {
  return buildGeographyModel(
    groups,
    { ...filters, province: [], city: [cityName] },
    data,
  ).groups.length;
}

function groupItem(
  group: CatalogGroup,
  role: CatalogFilters["regionRole"],
): HTMLElement {
  const item = element("li");
  const anchor = link(
    "",
    `group.html?${new URLSearchParams({ group: group.id })}`,
  );
  anchor.className = "geography-group-link";
  const avatar = element("span", group.name.slice(0, 1), "geography-avatar");
  avatar.setAttribute("aria-hidden", "true");
  if (group.avatar) {
    const img = element("img");
    img.alt = "";
    img.width = 52;
    img.height = 52;
    img.loading = "lazy";
    img.decoding = "async";
    img.src = group.avatar.src;
    img.addEventListener("error", () => {
      img.hidden = true;
    });
    avatar.append(img);
  }
  const copy = element("span", "", "geography-group-copy");
  copy.append(
    element("span", group.name, "geography-group-name"),
    element(
      "span",
      `${describeRegion(group[role])} · ${group.status || "状态未记录"}`,
      "geography-group-meta",
    ),
  );
  const arrow = element("span", "↗", "geography-group-arrow");
  arrow.setAttribute("aria-hidden", "true");
  anchor.append(avatar, copy, arrow);
  item.append(anchor);
  return item;
}

export function startGeography(
  catalog: GroupCatalog,
  data: GeographyData = GEOGRAPHY_DATA,
): void {
  const query = required<HTMLInputElement>("geography-query");
  const role = required<HTMLSelectElement>("geography-role");
  const status = required<HTMLSelectElement>("geography-status");
  const province = required<HTMLSelectElement>("geography-province");
  const city = required<HTMLSelectElement>("geography-city");
  const list = required("geography-group-list");
  const notice = required("geography-notice");
  const unknown = required<HTMLButtonElement>("geography-unknown");
  const more = required<HTMLButtonElement>("geography-more");
  const mapStatus = required("geography-map-status");
  let state = defaultGeographyState();
  let visibleCount = 24;
  let displayed: CatalogGroup[] = [];
  let map: GeographyMap | null = null;

  const provinceFor = (name: string) =>
    data.provinces.find(
      (item) => normalizeRegionName(item.name) === normalizeRegionName(name),
    );
  const cityFor = (name: string) =>
    data.cities.find(
      (item) => normalizeRegionName(item.name) === normalizeRegionName(name),
    );
  const selection = () => {
    const combined =
      state.filters.city.length + state.filters.province.length > 1;
    const selectedCity =
      !combined && state.filters.city.length === 1
        ? cityFor(state.filters.city[0])
        : undefined;
    const selectedProvince = selectedCity
      ? data.provinces.find((item) => item.id === selectedCity.provinceId)
      : !combined
        ? provinceFor(state.filters.province[0] ?? "")
        : undefined;
    return { combined, selectedCity, selectedProvince };
  };

  const writeUrl = (): void => {
    const search = serializeGeographyState(state);
    if (window.location.search === search) return;
    try {
      window.history.pushState(
        null,
        "",
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    } catch {
      notice.hidden = false;
      notice.textContent =
        "筛选已应用；当前浏览器无法保存地址，暂不能通过链接恢复这次操作。";
    }
  };

  const showList = (): void => {
    list.replaceChildren(
      ...displayed
        .slice(0, visibleCount)
        .map((group) => groupItem(group, state.filters.regionRole)),
    );
    more.hidden = displayed.length <= visibleCount;
    more.textContent = `显示更多团体（已显示 ${Math.min(visibleCount, displayed.length)} / ${displayed.length}）`;
    required("geography-empty").hidden = displayed.length !== 0;
  };

  const render = (fit: boolean): void => {
    const model = buildGeographyModel(catalog.groups, state.filters, data);
    const allRegions = buildGeographyModel(
      catalog.groups,
      { ...state.filters, province: [], city: [] },
      data,
    );
    const { combined, selectedCity, selectedProvince } = selection();
    query.value = state.filters.q;
    role.value = state.filters.regionRole;
    status.value = state.filters.status;
    const combinedOption = combined
      ? [{ value: "__combined", label: "组合地区（见名单说明）" }]
      : [];
    options(
      province,
      [
        { value: "", label: "全国" },
        ...combinedOption,
        ...data.provinces.map((item) => ({ value: item.id, label: item.name })),
      ],
      combined ? "__combined" : (selectedProvince?.id ?? ""),
    );
    options(
      city,
      [
        { value: "", label: "全部城市" },
        ...combinedOption,
        ...data.cities
          .filter(
            (item) =>
              !selectedProvince || item.provinceId === selectedProvince.id,
          )
          .map((item) => ({ value: item.id, label: item.name })),
      ],
      combined ? "__combined" : (selectedCity?.id ?? ""),
    );
    const regions = [...state.filters.province, ...state.filters.city];
    const regionTitle = state.unknown
      ? "地区待核实"
      : combined
        ? "组合地区"
        : (selectedCity?.name ?? selectedProvince?.name ?? "全国");
    required("geography-map-heading").textContent = regionTitle;
    const parent = required<HTMLButtonElement>("geography-parent");
    parent.hidden = !selectedCity;
    parent.textContent = `↑ ${selectedProvince?.name ?? "全国"}`;
    parent.setAttribute(
      "aria-label",
      `返回${selectedProvince?.name ?? "全国"}团体`,
    );
    required("geography-results-heading").textContent =
      `${regionTitle} · 团体名单`;
    displayed = state.unknown
      ? model.unlocatedGroups.map((item) => item.group)
      : model.groups;
    required("geography-count").textContent = `${displayed.length} 支`;
    required("geography-summary").textContent =
      `当前条件全国匹配 ${model.nationwideUniqueGroupCount} 支 · 当前地区已收录 ${displayed.length} 支。按团体去重，收录不完整。`;
    const scope = combined ? `地区：${regions.join(" 或 ")}。` : "";
    required("geography-result-summary").textContent =
      `${scope}${state.filters.regionRole === "activity" ? "主要活动城市" : "建团城市"} · ${state.filters.status === "active" ? "档案标记存续" : "全部档案状态"}${state.filters.q ? ` · 搜索“${state.filters.q}”` : ""}${state.filters.style ? ` · 风格：${state.filters.style}` : ""}。${state.unknown ? "城市缺失、无法匹配或地区信息冲突的团体保留于此。" : `${model.locatedUniqueGroupCount} 支已定位，${model.unlocatedGroups.length} 支城市位置待核实。`}`;
    unknown.hidden = allRegions.unlocatedGroups.length === 0;
    unknown.textContent = state.unknown
      ? `返回全国团体（地区待核实 ${allRegions.unlocatedGroups.length} 支）`
      : `查看地区待核实 · 全国 ${allRegions.unlocatedGroups.length} 支`;
    unknown.setAttribute("aria-pressed", String(state.unknown));
    const cityLinks = required("geography-cities");
    cityLinks.replaceChildren();
    if (!state.unknown && selectedProvince) {
      // 省内城市入口包含零记录城市，选择后明确呈现“尚未收录”。
      for (const item of data.cities.filter(
        (entry) => entry.provinceId === selectedProvince.id,
      )) {
        const count = cityResultCount(
          catalog.groups,
          state.filters,
          item.name,
          data,
        );
        const button = element("button", `${item.name} ${count}`);
        button.type = "button";
        button.setAttribute(
          "aria-pressed",
          String(item.id === selectedCity?.id),
        );
        button.addEventListener("click", () => chooseCity(item));
        cityLinks.append(button);
      }
    }
    if (!state.unknown && combined && state.filters.city.length) {
      for (const name of state.filters.city) {
        const item = cityFor(name);
        if (!item) continue;
        const count = cityResultCount(
          catalog.groups,
          state.filters,
          item.name,
          data,
        );
        const button = element("button", `${item.name} ${count} · 查看`);
        button.type = "button";
        button.addEventListener("click", () => chooseCity(item));
        cityLinks.append(button);
      }
    }
    map?.update(
      state.unknown ? [] : model.cityGroups,
      selectedProvince?.id ?? "",
      selectedCity?.id ?? "",
    );
    if (map && fit) {
      if (state.camera) map.setCamera(state.camera);
      else map.fit(selectedProvince?.id, selectedCity);
      state.camera = map.getCamera();
    }
    showList();
  };

  const apply = (next: GeographyState): void => {
    state = next;
    visibleCount = 24;
    notice.hidden = true;
    render(true);
    writeUrl();
  };
  const chooseCity = (item: GeoCity): void =>
    apply(selectGeographyRegion(state, "city", item.name));

  try {
    map = new GeographyMap(required("geography-map"), data, {
      onProvince: (id) => {
        const item = data.provinces.find((entry) => entry.id === id);
        if (item) apply(selectGeographyRegion(state, "province", item.name));
      },
      onCity: chooseCity,
      onCluster: (entries) => {
        apply({
          ...state,
          unknown: false,
          camera: map?.getCamera() ?? state.camera,
          filters: {
            ...state.filters,
            province: [],
            city: entries.map((entry) => entry.city.name),
          },
        });
        required("geography-result-summary").textContent +=
          " 已到最大缩放，请选择下方城市查看对应团体。";
        required("geography-results-heading").focus();
      },
      onCamera: (camera) => {
        state.camera = camera;
        writeUrl();
      },
    });
    mapStatus.hidden = true;
    for (const id of [
      "geography-zoom-in",
      "geography-zoom-out",
      "geography-fit",
    ])
      required<HTMLButtonElement>(id).disabled = false;
  } catch {
    required("geography-map").querySelector("svg")?.remove();
    mapStatus.textContent =
      "地理底图暂时无法显示。你仍可使用省份、城市筛选和团体名单；请刷新重试。";
    mapStatus.setAttribute("role", "alert");
  }

  const restore = (): void => {
    const parsed = parseGeographySearch(window.location.search, catalog, data);
    state = parsed.state;
    visibleCount = 24;
    notice.hidden = !parsed.ignored;
    notice.textContent =
      "链接中有无法识别或互相冲突的条件，已忽略这些条件；下方显示实际应用的筛选。";
    render(true);
  };
  window.addEventListener("popstate", restore);
  required<HTMLFormElement>("geography-filters").addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      apply({ ...state, filters: { ...state.filters, q: query.value.trim() } });
    },
  );
  role.addEventListener("change", () =>
    apply({
      ...state,
      camera: null,
      filters: {
        ...state.filters,
        regionRole: role.value === "founding" ? "founding" : "activity",
      },
    }),
  );
  status.addEventListener("change", () =>
    apply({
      ...state,
      filters: {
        ...state.filters,
        status: status.value === "all" ? "all" : "active",
      },
    }),
  );
  province.addEventListener("change", () => {
    const item = data.provinces.find((entry) => entry.id === province.value);
    apply(
      selectGeographyRegion(state, item ? "province" : "national", item?.name),
    );
  });
  city.addEventListener("change", () => {
    const item = data.cities.find((entry) => entry.id === city.value);
    if (item) chooseCity(item);
    else {
      const parent = selection().selectedProvince;
      apply(
        selectGeographyRegion(
          state,
          parent ? "province" : "national",
          parent?.name,
        ),
      );
    }
  });
  unknown.addEventListener("click", () =>
    apply(selectGeographyRegion(state, state.unknown ? "national" : "unknown")),
  );
  required("geography-reset").addEventListener("click", () =>
    apply(defaultGeographyState()),
  );
  required("geography-parent").addEventListener("click", () => {
    const parent = selection().selectedProvince;
    apply(
      selectGeographyRegion(
        state,
        parent ? "province" : "national",
        parent?.name,
      ),
    );
  });
  required("geography-zoom-in").addEventListener("click", () => map?.zoom(1.5));
  required("geography-zoom-out").addEventListener("click", () =>
    map?.zoom(1 / 1.5),
  );
  required("geography-fit").addEventListener("click", () => {
    state.camera = null;
    render(true);
    writeUrl();
  });
  more.addEventListener("click", () => {
    const previous = visibleCount;
    visibleCount += 24;
    showList();
    list.children[previous]?.querySelector("a")?.focus({ preventScroll: true });
  });
  required("geography-archive").textContent =
    `团体档案截点：${catalog.archiveDate}。存续按现有档案标记，不代表已核实此后的状态。`;
  const attribution = required("geography-attribution");
  attribution.replaceChildren(
    ...data.attribution.map((text) => element("p", text)),
  );
  attribution.append(
    link(
      "底图：Natural Earth / 公共领域",
      "https://www.naturalearthdata.com/about/terms-of-use/",
      true,
    ),
    link("城市坐标：GeoNames", "https://www.geonames.org/export/", true),
    link(
      "坐标许可：CC BY 4.0",
      "https://creativecommons.org/licenses/by/4.0/",
      true,
    ),
    element(
      "p",
      "已筛选城市记录并匹配中文名称与省份；来源按现状提供。此处城市入口不是全国全部城市名录。",
    ),
  );
  restore();
}

if (typeof document !== "undefined") {
  const catalog = readCatalog();
  if (catalog.valid) startGeography(catalog.data);
  else {
    const message =
      "团体资料暂时无法读取，不能据此判断已收录数量。请刷新重试或查看资料说明。";
    required("geography-summary").textContent = message;
    required("geography-result-summary").textContent = message;
    required("geography-map-status").textContent =
      "团体索引未加载，地图暂不可用。";
    required("geography-result-summary").setAttribute("role", "alert");
    for (const control of document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >("#geography-main input, #geography-main select, #geography-main button"))
      control.disabled = true;
  }
}

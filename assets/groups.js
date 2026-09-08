"use strict";
(() => {
  // src/catalog/model.ts
  var ID_PATTERN = /^g\d{3,8}$/u;
  function hasControl(value, multiline = false) {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code));
    });
  }
  var MAX_SEARCH_LENGTH = 4096;
  var MAX_QUERY_LENGTH = 200;
  var MAX_REGION_COUNT = 64;
  var GROUP_KEYS = [
    "id",
    "name",
    "handle",
    "aliases",
    "status",
    "isActive",
    "founding",
    "activity",
    "styleLabel",
    "styleState",
    "styleNote",
    "tags",
    "avatar",
    "visual",
    "officialUrl",
    "wikiUrl",
    "followers",
    "sources"
  ];
  function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function text(value, max, empty = false) {
    return typeof value === "string" && value.length <= max && (empty || value.trim().length > 0) && !hasControl(value);
  }
  function note(value) {
    return typeof value === "string" && value.length <= 8e3 && !hasControl(value, true);
  }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
      return false;
    const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function observedAt(value) {
    if (value === null || date(value)) return true;
    if (typeof value !== "string") return false;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
      value
    );
    return Boolean(match && date(match[1]) && Number.isFinite(Date.parse(value)));
  }
  function isSafeCatalogUrl(value) {
    if (typeof value !== "string" || value.length > 4096 || !/^https?:\/\//iu.test(value) || /\s|\\/u.test(value) || hasControl(value))
      return false;
    try {
      const decoded = decodeURIComponent(value);
      if (hasControl(decoded) || decoded.includes("\\")) return false;
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  function isLocalCatalogImagePath(value) {
    return typeof value === "string" && value.length <= 240 && /^assets\/(?:avatars|weibo-avatars|weibo-api-avatar-candidates|group-visuals|posters|profile-covers|weibo-cached-visuals)\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/u.test(
      value
    );
  }
  function validateCatalog(input) {
    const errors = [];
    const fail = (path, message) => {
      if (errors.length < 200) errors.push(`${path}: ${message}`);
    };
    const shape = (value, path, keys) => {
      if (!object(value)) {
        fail(path, "必须为对象");
        return false;
      }
      for (const key of Object.keys(value))
        if (!keys.includes(key)) fail(`${path}.${key}`, "不允许的字段");
      for (const key of keys)
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "缺少字段");
      return true;
    };
    const stringField = (value, path, max = 200, empty = false) => {
      if (!text(value, max, empty))
        fail(path, "文字为空、过长、类型错误或含控制字符");
    };
    const strings = (value, path) => {
      if (!Array.isArray(value) || value.length > 64) {
        fail(path, "必须为最多64项的文字数组");
        return;
      }
      Array.from(value).forEach(
        (item, index) => stringField(item, `${path}[${index}]`)
      );
      if (new Set(value).size !== value.length) fail(path, "数组包含重复项");
    };
    const region = (value, path) => {
      if (!shape(value, path, ["province", "city"])) return;
      for (const key of ["province", "city"])
        if (value[key] !== null) stringField(value[key], `${path}.${key}`, 80);
    };
    const url = (value, path, nullable = true) => {
      if (!(nullable && value === null) && !isSafeCatalogUrl(value))
        fail(path, "必须为安全的HTTP(S)链接");
    };
    const image = (value, path) => {
      if (value === null || !shape(value, path, ["src", "alt", "label", "sourceUrl"]))
        return;
      if (!isLocalCatalogImagePath(value.src))
        fail(`${path}.src`, "非法公开素材路径");
      stringField(value.alt, `${path}.alt`, 400);
      stringField(value.label, `${path}.label`, 400);
      url(value.sourceUrl, `${path}.sourceUrl`);
    };
    if (!shape(input, "catalog", ["schemaVersion", "archiveDate", "groups"]))
      return { valid: false, errors };
    if (input.schemaVersion !== "idol-catalog-v1")
      fail("catalog.schemaVersion", "不支持的索引版本");
    if (!date(input.archiveDate))
      fail("catalog.archiveDate", "必须为真实日历日期");
    if (!Array.isArray(input.groups) || input.groups.length > 2e4) {
      fail("catalog.groups", "必须为不超过20000项的数组");
      return { valid: false, errors };
    }
    const ids = /* @__PURE__ */ new Set();
    Array.from(input.groups).forEach((group, index) => {
      const path = `catalog.groups[${index}]`;
      if (!shape(group, path, GROUP_KEYS)) return;
      if (typeof group.id !== "string" || !ID_PATTERN.test(group.id))
        fail(`${path}.id`, "非法团体ID");
      else if (ids.has(group.id)) fail(`${path}.id`, "重复团体ID");
      else ids.add(group.id);
      for (const key of ["name", "handle", "status", "styleLabel"])
        stringField(group[key], `${path}.${key}`);
      if (typeof group.isActive !== "boolean")
        fail(`${path}.isActive`, "必须为布尔值");
      if (group.styleState !== "editorial" && group.styleState !== "uncertain")
        fail(`${path}.styleState`, "非法风格状态");
      if (!note(group.styleNote)) fail(`${path}.styleNote`, "非法说明文字");
      strings(group.aliases, `${path}.aliases`);
      strings(group.tags, `${path}.tags`);
      region(group.founding, `${path}.founding`);
      region(group.activity, `${path}.activity`);
      image(group.avatar, `${path}.avatar`);
      image(group.visual, `${path}.visual`);
      url(group.officialUrl, `${path}.officialUrl`);
      url(group.wikiUrl, `${path}.wikiUrl`);
      if (group.followers !== null && shape(group.followers, `${path}.followers`, [
        "display",
        "value",
        "observedAt"
      ])) {
        stringField(group.followers.display, `${path}.followers.display`);
        if (typeof group.followers.value !== "number" || !Number.isSafeInteger(group.followers.value) || group.followers.value < 0)
          fail(`${path}.followers.value`, "必须为非负安全整数");
        if (!observedAt(group.followers.observedAt))
          fail(`${path}.followers.observedAt`, "非法观察日期");
      }
      if (!Array.isArray(group.sources) || group.sources.length > 64)
        fail(`${path}.sources`, "必须为最多64项的来源数组");
      else
        Array.from(group.sources).forEach(
          (source, sourceIndex) => {
            const sp = `${path}.sources[${sourceIndex}]`;
            if (!shape(source, sp, ["label", "url", "observedAt", "note"]))
              return;
            stringField(source.label, `${sp}.label`, 400);
            url(source.url, `${sp}.url`, false);
            if (!observedAt(source.observedAt))
              fail(`${sp}.observedAt`, "非法观察日期");
            if (!note(source.note)) fail(`${sp}.note`, "非法来源说明");
          }
        );
    });
    return errors.length ? { valid: false, errors } : { valid: true, data: input, errors: [] };
  }
  function defaultCatalogFilters() {
    return {
      q: "",
      status: "active",
      regionRole: "activity",
      province: [],
      city: [],
      style: ""
    };
  }
  function normalizeRegionName(value) {
    const normalized = value.normalize("NFKC").trim();
    const aliases = {
      广西壮族自治区: "广西",
      宁夏回族自治区: "宁夏",
      新疆维吾尔自治区: "新疆",
      内蒙古自治区: "内蒙古",
      西藏自治区: "西藏",
      香港特别行政区: "香港",
      澳门特别行政区: "澳门"
    };
    return Object.hasOwn(aliases, normalized) ? aliases[normalized] : normalized.length > 2 ? normalized.replace(/[省市]$/u, "") : normalized;
  }
  function normalizeSearch(value) {
    return value.normalize("NFKC").toLowerCase().trim();
  }
  function validFilters(filters) {
    return Boolean(
      filters && text(filters.q, MAX_QUERY_LENGTH, true) && ["active", "all"].includes(filters.status) && ["activity", "founding"].includes(filters.regionRole) && text(filters.style, 200, true) && [filters.province, filters.city].every(
        (values) => Array.isArray(values) && values.length <= MAX_REGION_COUNT && values.every((value) => text(value, 80))
      )
    );
  }
  function filterCatalogGroups(groups, filters) {
    if (!validFilters(filters)) return [];
    const provinces = new Set(filters.province.map(normalizeRegionName));
    const cities = new Set(filters.city.map(normalizeRegionName));
    const terms = normalizeSearch(filters.q).split(/\s+/u).filter(Boolean);
    const style = normalizeSearch(filters.style);
    return groups.filter((group) => {
      if (filters.status === "active" && !group.isActive) return false;
      if (style && normalizeSearch(group.styleLabel) !== style) return false;
      const slot = group[filters.regionRole];
      if ((provinces.size || cities.size) && !(slot.province && provinces.has(normalizeRegionName(slot.province))) && !(slot.city && cities.has(normalizeRegionName(slot.city))))
        return false;
      const names = normalizeSearch(
        [group.name, group.handle, ...group.aliases].join(" ")
      );
      return terms.every((term) => names.includes(term));
    });
  }
  function parseSearch(search) {
    if (typeof search !== "string" || search.length > MAX_SEARCH_LENGTH || hasControl(search))
      return null;
    try {
      decodeURIComponent(search.replace(/\+/gu, " "));
      const params = new URLSearchParams(search);
      return [...params].length <= 160 ? params : null;
    } catch {
      return null;
    }
  }
  function parseCatalogFilters(search, catalog) {
    const filters = defaultCatalogFilters();
    const params = parseSearch(search);
    if (!params) return { filters, ignored: true };
    let ignored = false;
    for (const key of params.keys())
      if (!["q", "status", "regionRole", "province", "city", "style"].includes(key))
        ignored = true;
    const single = (key, apply) => {
      const values = params.getAll(key);
      if (!values.length) return;
      if (values.length !== 1 || !apply(values[0])) ignored = true;
    };
    single("q", (value) => {
      if (!text(value, MAX_QUERY_LENGTH, true)) return false;
      filters.q = value.trim();
      return true;
    });
    single("status", (value) => {
      if (value !== "active" && value !== "all") return false;
      filters.status = value;
      return true;
    });
    single("regionRole", (value) => {
      if (value !== "activity" && value !== "founding") return false;
      filters.regionRole = value;
      return true;
    });
    single("style", (value) => {
      if (value === "") return true;
      if (!text(value, 200)) return false;
      const style = catalog.groups.find(
        (group) => normalizeSearch(group.styleLabel) === normalizeSearch(value)
      )?.styleLabel;
      if (!style) return false;
      filters.style = style;
      return true;
    });
    for (const key of ["province", "city"]) {
      const values = params.getAll(key);
      if (values.length > MAX_REGION_COUNT) {
        ignored = true;
        continue;
      }
      const choices = /* @__PURE__ */ new Map();
      for (const group of catalog.groups) {
        const value = group[filters.regionRole][key];
        if (value) choices.set(normalizeRegionName(value), value);
      }
      for (const value of values) {
        const choice = text(value, 80) ? choices.get(normalizeRegionName(value)) : void 0;
        if (!choice) ignored = true;
        else if (!filters[key].includes(choice)) filters[key].push(choice);
      }
    }
    return { filters, ignored };
  }
  function serializeCatalogFilters(filters) {
    if (!validFilters(filters)) return "";
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.status !== "active") params.set("status", filters.status);
    if (filters.regionRole !== "activity")
      params.set("regionRole", filters.regionRole);
    for (const key of ["province", "city"]) {
      for (const value of [
        ...new Set(filters[key].map(normalizeRegionName))
      ].sort())
        params.append(key, value);
    }
    if (filters.style) params.set("style", filters.style);
    return params.toString();
  }

  // src/catalog/runtime.ts
  function readCatalog() {
    if (typeof window === "undefined" || window.IDOL_GROUPS_DATA === void 0) {
      return { valid: false, errors: ["团体索引未加载，请检查资料脚本后重试。"] };
    }
    return validateCatalog(window.IDOL_GROUPS_DATA);
  }

  // src/groups/dom.ts
  function element(tag, text2 = "", className = "") {
    const node = document.createElement(tag);
    if (text2) node.textContent = text2;
    if (className) node.className = className;
    return node;
  }
  function link(text2, href, external = false) {
    const node = element("a", text2);
    node.href = href;
    if (external) {
      node.target = "_blank";
      node.rel = "noopener noreferrer";
      node.setAttribute("aria-label", `${text2}（在新窗口打开）`);
    }
    return node;
  }
  function required(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`页面缺少必要元素：${id}`);
    return node;
  }
  function imageBlock(image, name, large = false, eager = false) {
    const frame = element("div", "", large ? "groups-visual" : "groups-avatar");
    const fallback = element(
      "span",
      image ? "图像暂不可用" : "暂无资料图",
      "groups-image-fallback"
    );
    fallback.setAttribute("role", "img");
    fallback.setAttribute("aria-label", `${name}：${fallback.textContent}`);
    frame.append(fallback);
    if (!image) return frame;
    const picture = element("img");
    picture.width = large ? 640 : 80;
    picture.height = large ? 480 : 80;
    picture.alt = image.alt || `${name}资料图`;
    picture.loading = eager ? "eager" : "lazy";
    picture.decoding = "async";
    picture.addEventListener("load", () => {
      fallback.hidden = true;
    });
    picture.addEventListener("error", () => {
      picture.hidden = true;
      fallback.hidden = false;
    });
    picture.src = image.src;
    frame.append(picture);
    return frame;
  }
  function showFailure(root, title, description, heading = "h2") {
    root.replaceChildren();
    const panel = element("section", "", "groups-empty");
    panel.setAttribute("role", "alert");
    panel.append(element(heading, title), element("p", description));
    panel.append(link("返回团体列表", "groups.html"));
    root.append(panel);
  }

  // src/groups/model.ts
  var GROUPS_PAGE_SIZE = 24;
  var MAX_GROUP_LIST_SEARCH_LENGTH = 4096;
  function groupFilterSelectionError(filters) {
    if (filters.province.length <= 64 && filters.city.length <= 64) return null;
    return `省份和城市各最多选择 64 项（当前省份 ${filters.province.length} 项、城市 ${filters.city.length} 项）。请减少选择后再应用；已保留本次选择，原筛选结果未改变。`;
  }
  function parseGroupListSearch(search, catalog) {
    const fullSearch = !search || search.startsWith("?") ? search : `?${search}`;
    if (fullSearch.length > MAX_GROUP_LIST_SEARCH_LENGTH)
      return {
        filters: defaultCatalogFilters(),
        sort: "archive",
        ignored: true
      };
    try {
      decodeURIComponent(fullSearch.replace(/\+/gu, " "));
    } catch {
      return {
        filters: defaultCatalogFilters(),
        sort: "archive",
        ignored: true
      };
    }
    const params = new URLSearchParams(fullSearch);
    const values = params.getAll("sort");
    const validSort = values.length <= 1 && (values.length === 0 || values[0] === "archive" || values[0] === "followers");
    const sort = validSort && values[0] === "followers" ? "followers" : "archive";
    params.delete("sort");
    const parsed = parseCatalogFilters(params.toString(), catalog);
    return { ...parsed, sort, ignored: parsed.ignored || !validSort };
  }
  function prepareGroupListSubmission(filters, sort, catalog) {
    const selectionError = groupFilterSelectionError(filters);
    if (selectionError) return { valid: false, message: selectionError };
    const invalid = {
      valid: false,
      message: "筛选条件无效，请检查后再应用；已保留本次输入，原筛选结果未改变。"
    };
    const filterSearch = serializeCatalogFilters(filters);
    if (!filterSearch && (filters.q.trim() || filters.status !== "active" || filters.regionRole !== "activity" || filters.province.length || filters.city.length || filters.style))
      return invalid;
    const params = new URLSearchParams(filterSearch);
    if (sort !== "archive") params.set("sort", sort);
    const query = params.toString();
    const search = query ? `?${query}` : "";
    if (search.length > MAX_GROUP_LIST_SEARCH_LENGTH)
      return {
        valid: false,
        message: "筛选条件组合过长，请缩短查询或减少地区选择后再应用；已保留本次输入，原筛选结果未改变。"
      };
    const restored = parseGroupListSearch(search, catalog);
    if (restored.ignored) return invalid;
    return {
      valid: true,
      filters: restored.filters,
      sort: restored.sort,
      search
    };
  }
  function sortGroupList(groups, sort) {
    if (sort === "archive") return [...groups];
    return [...groups].sort(
      (a, b) => (b.followers?.value ?? -1) - (a.followers?.value ?? -1)
    );
  }
  function paginateGroups(records, requestedPage) {
    const pages = Math.max(1, Math.ceil(records.length / GROUPS_PAGE_SIZE));
    const page = Math.min(
      pages,
      Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1)
    );
    return {
      items: records.slice(
        (page - 1) * GROUPS_PAGE_SIZE,
        page * GROUPS_PAGE_SIZE
      ),
      page,
      pages,
      total: records.length
    };
  }
  function describeRegion(region) {
    if (!region.city) {
      return region.province ? `${region.province} · 城市待核实` : "城市待核实";
    }
    if (!region.province || region.city === region.province) return region.city;
    const province = region.province.replace(/市$/, "");
    const city = region.city.replace(/市$/, "");
    return province === city ? region.city : `${region.province} · ${region.city}`;
  }
  function displayDate(value) {
    if (!value) return "观察日期未记录";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date2 = new Date(value);
    if (!Number.isFinite(date2.getTime())) return "观察日期未记录";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date2).replaceAll("/", "-");
  }
  function describeStyle(group) {
    return group.styleState === "uncertain" ? "风格待核实" : `编辑分类 · ${group.styleLabel || "未分类"}`;
  }

  // src/groups/list.ts
  function storedPage(value) {
    if (!value || typeof value !== "object" || !("groupsPage" in value)) return 1;
    return typeof value.groupsPage === "number" ? value.groupsPage : 1;
  }
  function makeCard(group, filters, first, sort) {
    const card = element("article", "", "groups-card");
    card.dataset.groupId = group.id;
    card.append(imageBlock(group.avatar, group.name, false, first));
    const content = element("div");
    const title = element("h3");
    title.append(
      link(group.name, `group.html?group=${encodeURIComponent(group.id)}`)
    );
    content.append(title);
    const region = filters.regionRole === "activity" ? group.activity : group.founding;
    content.append(element("p", describeRegion(region)));
    content.append(element("p", describeStyle(group), "groups-card-style"));
    content.append(
      element(
        "span",
        group.status,
        group.isActive ? "groups-tag" : "groups-tag groups-tag-history"
      )
    );
    if (sort === "followers")
      content.append(
        element(
          "p",
          group.followers ? `账号粉丝 ${group.followers.display} · 观察于 ${displayDate(group.followers.observedAt)}` : "账号粉丝观察值待核实",
          "groups-card-style"
        )
      );
    card.append(content);
    return card;
  }
  function mountGroupsPage() {
    const result = readCatalog();
    const results = required("groups-results");
    const count = required("groups-count");
    results.setAttribute("aria-busy", "false");
    if (!result.valid) {
      count.textContent = "资料加载失败";
      showFailure(
        results,
        "暂时无法读取团体资料",
        "资料文件缺失或未通过校验，请稍后重试。这不表示没有收录团体。"
      );
      return;
    }
    const catalog = result.data;
    const form = required("groups-filters");
    const query = required("groups-query");
    const status = required("groups-status");
    const role = required("groups-region-role");
    const style = required("groups-style");
    const sorting = required("groups-sort");
    const regions = required("groups-region-options");
    const notice = required("groups-notice");
    const pagination = required("groups-pagination");
    const previous = required("groups-prev");
    const next = required("groups-next");
    let filters = defaultCatalogFilters();
    let page = 1;
    let sort = "archive";
    form.hidden = false;
    required("groups-archive").textContent = `收录 ${catalog.groups.length} 条档案 · 历史截点 ${catalog.archiveDate} · 状态以各项来源为准`;
    for (const label of [
      ...new Set(catalog.groups.map((group) => group.styleLabel).filter(Boolean))
    ].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
      const option = element("option", label);
      option.value = label;
      style.append(option);
    }
    const setNotice = (message) => {
      notice.textContent = message;
      notice.hidden = !message;
    };
    const drawRegions = (clear = false) => {
      regions.replaceChildren();
      const items = /* @__PURE__ */ new Map();
      for (const group of catalog.groups) {
        const region = role.value === "founding" ? group.founding : group.activity;
        if (!region.province && !region.city) continue;
        const key = region.province ? normalizeRegionName(region.province) : "";
        const item = items.get(key) ?? {
          province: region.province,
          cities: /* @__PURE__ */ new Map()
        };
        if (region.city)
          item.cities.set(normalizeRegionName(region.city), region.city);
        items.set(key, item);
      }
      const appendChoice = (parent, kind, value) => {
        const label = element("label");
        const input = element("input");
        input.type = "checkbox";
        input.name = kind;
        input.value = value;
        input.checked = !clear && filters[kind].some(
          (item) => normalizeRegionName(item) === normalizeRegionName(value)
        );
        label.append(
          input,
          document.createTextNode(
            kind === "province" ? `全省/市 · ${value}` : value
          )
        );
        parent.append(label);
      };
      for (const [, item] of [...items.entries()].sort(
        ([a], [b]) => a.localeCompare(b, "zh-CN")
      )) {
        const section = element("details");
        section.append(element("summary", item.province ?? "其他已知城市"));
        if (item.province) appendChoice(section, "province", item.province);
        for (const city of [...item.cities.values()].sort(
          (a, b) => a.localeCompare(b, "zh-CN")
        ))
          appendChoice(section, "city", city);
        regions.append(section);
      }
      if (!items.size)
        regions.append(
          element("p", "当前资料尚无可筛选的已知地区。", "groups-help")
        );
    };
    const syncForm = () => {
      query.value = filters.q;
      status.value = filters.status;
      role.value = filters.regionRole;
      style.value = filters.style;
      sorting.value = sort;
      drawRegions();
    };
    const render = () => {
      const matched = sortGroupList(
        filterCatalogGroups(catalog.groups, filters),
        sort
      );
      const visible = paginateGroups(matched, page);
      page = visible.page;
      results.replaceChildren();
      count.textContent = `找到 ${visible.total} 条 · 共 ${catalog.groups.length} 条档案${sort === "followers" ? " · 按账号观察值排序，不代表现场人气" : ""}`;
      const roleText = filters.regionRole === "activity" ? "主要活动城市" : "建团城市";
      const regionsText = [...filters.province, ...filters.city].join("、");
      required("groups-filter-summary").textContent = `${filters.status === "active" ? "存续" : "含历史"} · ${roleText}${regionsText ? ` · ${regionsText}` : ""}${filters.style ? ` · ${filters.style}` : ""}`;
      if (!visible.total) {
        const empty = element("section", "", "groups-empty");
        empty.append(element("h2", "没有符合条件的已收录团体"));
        empty.append(
          element(
            "p",
            "这不代表当地没有团体。可以减少筛选条件，或补充可核实的官号资料。"
          )
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
        visible.items.forEach(
          (group, index) => results.append(makeCard(group, filters, index < 3, sort))
        );
      }
      pagination.hidden = visible.pages === 1;
      previous.disabled = page <= 1;
      next.disabled = page >= visible.pages;
      required("groups-page-info").textContent = `第 ${page} / ${visible.pages} 页`;
    };
    const remember = (push) => {
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
          "筛选已应用；当前浏览器无法保存地址，请使用支持静态页面历史记录的浏览器分享条件。"
        );
      }
    };
    const resetFilters = () => {
      filters = defaultCatalogFilters();
      sort = "archive";
      page = 1;
      setNotice("");
      syncForm();
      render();
      remember(true);
    };
    const applyFilters = () => {
      const chosen = (kind) => [
        ...regions.querySelectorAll(
          `input[name="${kind}"]:checked`
        )
      ].map((input) => input.value);
      const candidate = {
        q: query.value.trim(),
        status: status.value === "all" ? "all" : "active",
        regionRole: role.value === "founding" ? "founding" : "activity",
        province: chosen("province"),
        city: chosen("city"),
        style: style.value
      };
      const candidateSort = sorting.value === "followers" ? "followers" : "archive";
      const prepared = prepareGroupListSubmission(
        candidate,
        candidateSort,
        catalog
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
    const restore = () => {
      const parsed = parseGroupListSearch(window.location.search, catalog);
      filters = parsed.filters;
      sort = parsed.sort;
      page = storedPage(window.history.state);
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
    const movePage = (direction) => {
      page += direction;
      render();
      remember(false);
      results.querySelector("h3 a")?.focus({ preventScroll: true });
      required("groups-results-title").scrollIntoView({ block: "start" });
    };
    previous.addEventListener("click", () => movePage(-1));
    next.addEventListener("click", () => movePage(1));
    window.addEventListener("popstate", restore);
    restore();
  }
  if (typeof document !== "undefined" && document.getElementById("groups-app"))
    mountGroupsPage();
})();

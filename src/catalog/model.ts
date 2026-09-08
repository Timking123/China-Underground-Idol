export interface CatalogRegion {
  province: string | null;
  city: string | null;
}

export interface CatalogSource {
  label: string;
  url: string;
  observedAt: string | null;
  note: string;
}

export interface CatalogImage {
  src: string;
  alt: string;
  label: string;
  sourceUrl: string | null;
}

export interface CatalogGroup {
  id: string;
  name: string;
  handle: string;
  aliases: string[];
  status: string;
  isActive: boolean;
  founding: CatalogRegion;
  activity: CatalogRegion;
  styleLabel: string;
  styleState: "editorial" | "uncertain";
  styleNote: string;
  tags: string[];
  avatar: CatalogImage | null;
  visual: CatalogImage | null;
  officialUrl: string | null;
  wikiUrl: string | null;
  followers: {
    display: string;
    value: number;
    observedAt: string | null;
  } | null;
  sources: CatalogSource[];
}

export interface GroupCatalog {
  schemaVersion: "idol-catalog-v1";
  archiveDate: string;
  groups: CatalogGroup[];
}

export interface CatalogFilters {
  q: string;
  status: "active" | "all";
  regionRole: "activity" | "founding";
  province: string[];
  city: string[];
  style: string;
}

type CatalogValidation =
  | { valid: true; data: GroupCatalog; errors: [] }
  | { valid: false; errors: string[] };

const ID_PATTERN = /^g\d{3,8}$/u;
function hasControl(value: string, multiline = false): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code))
    );
  });
}
const MAX_SEARCH_LENGTH = 4096;
const MAX_QUERY_LENGTH = 200;
const MAX_REGION_COUNT = 64;
const GROUP_KEYS = [
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
  "sources",
] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (empty || value.trim().length > 0) &&
    !hasControl(value)
  );
}

function note(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 8000 &&
    !hasControl(value, true)
  );
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function observedAt(value: unknown): boolean {
  if (value === null || date(value)) return true;
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
      value,
    );
  return Boolean(match && date(match[1]) && Number.isFinite(Date.parse(value)));
}

/** 只验证浏览器外链，不触发网络，也不自动修正危险原文。 */
export function isSafeCatalogUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !/^https?:\/\//iu.test(value) ||
    /\s|\\/u.test(value) ||
    hasControl(value)
  )
    return false;
  try {
    const decoded = decodeURIComponent(value);
    if (hasControl(decoded) || decoded.includes("\\")) return false;
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** 图片只接受公开静态素材目录；候选目录还须在生成时核对已采用凭据。 */
export function isLocalCatalogImagePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 240 &&
    /^assets\/(?:avatars|weibo-avatars|weibo-api-avatar-candidates|group-visuals|posters|profile-covers|weibo-cached-visuals)\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/u.test(
      value,
    )
  );
}

export function validateCatalog(input: unknown): CatalogValidation {
  const errors: string[] = [];
  const fail = (path: string, message: string): void => {
    if (errors.length < 200) errors.push(`${path}: ${message}`);
  };
  const shape = (
    value: unknown,
    path: string,
    keys: readonly string[],
  ): value is Record<string, unknown> => {
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
  const stringField = (
    value: unknown,
    path: string,
    max = 200,
    empty = false,
  ): void => {
    if (!text(value, max, empty))
      fail(path, "文字为空、过长、类型错误或含控制字符");
  };
  const strings = (value: unknown, path: string): void => {
    if (!Array.isArray(value) || value.length > 64) {
      fail(path, "必须为最多64项的文字数组");
      return;
    }
    Array.from(value).forEach((item, index) =>
      stringField(item, `${path}[${index}]`),
    );
    if (new Set(value).size !== value.length) fail(path, "数组包含重复项");
  };
  const region = (value: unknown, path: string): void => {
    if (!shape(value, path, ["province", "city"])) return;
    for (const key of ["province", "city"])
      if (value[key] !== null) stringField(value[key], `${path}.${key}`, 80);
  };
  const url = (value: unknown, path: string, nullable = true): void => {
    if (!(nullable && value === null) && !isSafeCatalogUrl(value))
      fail(path, "必须为安全的HTTP(S)链接");
  };
  const image = (value: unknown, path: string): void => {
    if (
      value === null ||
      !shape(value, path, ["src", "alt", "label", "sourceUrl"])
    )
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
  if (!Array.isArray(input.groups) || input.groups.length > 20000) {
    fail("catalog.groups", "必须为不超过20000项的数组");
    return { valid: false, errors };
  }
  const ids = new Set<string>();
  Array.from(input.groups).forEach((group: unknown, index: number) => {
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
    if (
      group.followers !== null &&
      shape(group.followers, `${path}.followers`, [
        "display",
        "value",
        "observedAt",
      ])
    ) {
      stringField(group.followers.display, `${path}.followers.display`);
      if (
        typeof group.followers.value !== "number" ||
        !Number.isSafeInteger(group.followers.value) ||
        group.followers.value < 0
      )
        fail(`${path}.followers.value`, "必须为非负安全整数");
      if (!observedAt(group.followers.observedAt))
        fail(`${path}.followers.observedAt`, "非法观察日期");
    }
    if (!Array.isArray(group.sources) || group.sources.length > 64)
      fail(`${path}.sources`, "必须为最多64项的来源数组");
    else
      Array.from(group.sources).forEach(
        (source: unknown, sourceIndex: number) => {
          const sp = `${path}.sources[${sourceIndex}]`;
          if (!shape(source, sp, ["label", "url", "observedAt", "note"]))
            return;
          stringField(source.label, `${sp}.label`, 400);
          url(source.url, `${sp}.url`, false);
          if (!observedAt(source.observedAt))
            fail(`${sp}.observedAt`, "非法观察日期");
          if (!note(source.note)) fail(`${sp}.note`, "非法来源说明");
        },
      );
  });
  return errors.length
    ? { valid: false, errors }
    : { valid: true, data: input as unknown as GroupCatalog, errors: [] };
}

export function defaultCatalogFilters(): CatalogFilters {
  return {
    q: "",
    status: "active",
    regionRole: "activity",
    province: [],
    city: [],
    style: "",
  };
}

/** 只归一同名地区的后缀，不推断上级行政区，不做包含或前缀匹配。 */
export function normalizeRegionName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  const aliases: Record<string, string> = {
    广西壮族自治区: "广西",
    宁夏回族自治区: "宁夏",
    新疆维吾尔自治区: "新疆",
    内蒙古自治区: "内蒙古",
    西藏自治区: "西藏",
    香港特别行政区: "香港",
    澳门特别行政区: "澳门",
  };
  return Object.hasOwn(aliases, normalized)
    ? aliases[normalized]
    : normalized.length > 2
      ? normalized.replace(/[省市]$/u, "")
      : normalized;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

function validFilters(filters: CatalogFilters): boolean {
  return Boolean(
    filters &&
    text(filters.q, MAX_QUERY_LENGTH, true) &&
    ["active", "all"].includes(filters.status) &&
    ["activity", "founding"].includes(filters.regionRole) &&
    text(filters.style, 200, true) &&
    [filters.province, filters.city].every(
      (values) =>
        Array.isArray(values) &&
        values.length <= MAX_REGION_COUNT &&
        values.every((value) => text(value, 80)),
    ),
  );
}

export function filterCatalogGroups(
  groups: readonly CatalogGroup[],
  filters: CatalogFilters,
): CatalogGroup[] {
  if (!validFilters(filters)) return [];
  const provinces = new Set(filters.province.map(normalizeRegionName));
  const cities = new Set(filters.city.map(normalizeRegionName));
  const terms = normalizeSearch(filters.q).split(/\s+/u).filter(Boolean);
  const style = normalizeSearch(filters.style);
  return groups.filter((group) => {
    if (filters.status === "active" && !group.isActive) return false;
    if (style && normalizeSearch(group.styleLabel) !== style) return false;
    const slot = group[filters.regionRole];
    if (
      (provinces.size || cities.size) &&
      !(slot.province && provinces.has(normalizeRegionName(slot.province))) &&
      !(slot.city && cities.has(normalizeRegionName(slot.city)))
    )
      return false;
    const names = normalizeSearch(
      [group.name, group.handle, ...group.aliases].join(" "),
    );
    return terms.every((term) => names.includes(term));
  });
}

function parseSearch(search: string): URLSearchParams | null {
  if (
    typeof search !== "string" ||
    search.length > MAX_SEARCH_LENGTH ||
    hasControl(search)
  )
    return null;
  try {
    decodeURIComponent(search.replace(/\+/gu, " "));
    const params = new URLSearchParams(search);
    return [...params].length <= 160 ? params : null;
  } catch {
    return null;
  }
}

export function parseCatalogFilters(
  search: string,
  catalog: GroupCatalog,
): { filters: CatalogFilters; ignored: boolean } {
  const filters = defaultCatalogFilters();
  const params = parseSearch(search);
  if (!params) return { filters, ignored: true };
  let ignored = false;
  for (const key of params.keys())
    if (
      !["q", "status", "regionRole", "province", "city", "style"].includes(key)
    )
      ignored = true;
  const single = (key: string, apply: (value: string) => boolean): void => {
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
      (group) => normalizeSearch(group.styleLabel) === normalizeSearch(value),
    )?.styleLabel;
    if (!style) return false;
    filters.style = style;
    return true;
  });
  for (const key of ["province", "city"] as const) {
    const values = params.getAll(key);
    if (values.length > MAX_REGION_COUNT) {
      ignored = true;
      continue;
    }
    const choices = new Map<string, string>();
    for (const group of catalog.groups) {
      const value = group[filters.regionRole][key];
      if (value) choices.set(normalizeRegionName(value), value);
    }
    for (const value of values) {
      const choice = text(value, 80)
        ? choices.get(normalizeRegionName(value))
        : undefined;
      if (!choice) ignored = true;
      else if (!filters[key].includes(choice)) filters[key].push(choice);
    }
  }
  return { filters, ignored };
}

export function serializeCatalogFilters(filters: CatalogFilters): string {
  if (!validFilters(filters)) return "";
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status !== "active") params.set("status", filters.status);
  if (filters.regionRole !== "activity")
    params.set("regionRole", filters.regionRole);
  for (const key of ["province", "city"] as const) {
    for (const value of [
      ...new Set(filters[key].map(normalizeRegionName)),
    ].sort())
      params.append(key, value);
  }
  if (filters.style) params.set("style", filters.style);
  return params.toString();
}

export function parseCatalogGroupLink(
  search: string,
  groups: readonly CatalogGroup[],
):
  | { state: "none" }
  | { state: "invalid" }
  | { state: "valid"; group: CatalogGroup } {
  const params = parseSearch(search);
  if (!params) return { state: "invalid" };
  const values = params.getAll("group");
  if (!values.length) return { state: "none" };
  if (values.length !== 1 || !ID_PATTERN.test(values[0]))
    return { state: "invalid" };
  const group = groups.find((item) => item.id === values[0]);
  return group ? { state: "valid", group } : { state: "invalid" };
}

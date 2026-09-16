import {
  filterCatalogGroups,
  normalizeRegionName,
  type CatalogFilters,
  type CatalogGroup,
  type CatalogRegion,
} from "../catalog/model";
import geography from "../../data/geography/cities.v1.json";
import basemap from "../../data/geography/basemap.cn.v1.json";
import type {
  CityGroup,
  GeoCity,
  GeographyData,
  GeographyModel,
  GroupLocation,
  UnlocatedGroup,
} from "./types";

export const GEOGRAPHY_DATA: GeographyData = {
  ...geography,
  basemap,
  attribution: [
    ...geography.attribution,
    "底图：Natural Earth 5.1，公共领域（https://www.naturalearthdata.com/about/terms-of-use/）。采用中国视角，已按省级口径整理并保留补充离岛和海域表示。",
  ],
} as GeographyData;

/** 在构建或加载外部静态字典时使用；数据错误不能伪装成正常空结果。 */
export function validateGeographyData(
  input: unknown,
):
  | { valid: true; data: GeographyData; errors: [] }
  | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const text = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 200;
  const aliases = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.every(text) &&
    new Set(value).size === value.length;
  if (!object(input)) return { valid: false, errors: ["地理字典必须为对象"] };
  if (
    input.schemaVersion !== "idol-geography-v1" ||
    input.coordinateSystem !== "WGS84"
  )
    errors.push("地理字典版本或坐标系不正确");
  const provinceIds = new Set<string>();
  if (!Array.isArray(input.provinces)) errors.push("省份必须为数组");
  else
    for (const province of input.provinces) {
      if (
        !object(province) ||
        !text(province.id) ||
        !text(province.name) ||
        !aliases(province.aliases)
      ) {
        errors.push("省份字段不完整");
        continue;
      }
      if (provinceIds.has(province.id))
        errors.push(`重复省份 ID：${province.id}`);
      provinceIds.add(province.id);
    }
  const cityIds = new Set<string>();
  if (!Array.isArray(input.cities)) errors.push("城市必须为数组");
  else
    for (const city of input.cities) {
      if (
        !object(city) ||
        !text(city.id) ||
        !text(city.name) ||
        !text(city.provinceId) ||
        !aliases(city.aliases) ||
        !text(city.sourceId)
      ) {
        errors.push("城市字段不完整");
        continue;
      }
      if (cityIds.has(city.id)) errors.push(`重复城市 ID：${city.id}`);
      cityIds.add(city.id);
      if (!provinceIds.has(city.provinceId))
        errors.push(`${city.name} 缺少对应省份`);
      if (
        typeof city.longitude !== "number" ||
        typeof city.latitude !== "number" ||
        !isValidCoordinate(city.longitude, city.latitude)
      )
        errors.push(`${city.name} 坐标非法`);
    }
  if (
    !Array.isArray(input.attribution) ||
    !input.attribution.length ||
    !input.attribution.every(text)
  )
    errors.push("地理字典必须保留来源署名");
  if (
    input.basemap !== null &&
    (!object(input.basemap) ||
      input.basemap.type !== "FeatureCollection" ||
      !Array.isArray(input.basemap.features) ||
      !input.basemap.features.length)
  )
    errors.push("底图必须为非空 FeatureCollection 或明确的 null 失败状态");
  else if (object(input.basemap) && Array.isArray(input.basemap.features)) {
    const position = (value: unknown): value is [number, number] =>
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number" &&
      isValidCoordinate(value[0], value[1]);
    const line = (value: unknown): value is [number, number][] =>
      Array.isArray(value) && value.length >= 2 && value.every(position);
    const ring = (value: unknown): boolean =>
      line(value) &&
      value.length >= 4 &&
      value[0][0] === value[value.length - 1][0] &&
      value[0][1] === value[value.length - 1][1];
    const polygon = (value: unknown): boolean =>
      Array.isArray(value) && value.length > 0 && value.every(ring);
    for (const feature of input.basemap.features) {
      if (
        !object(feature) ||
        feature.type !== "Feature" ||
        !object(feature.properties) ||
        !text(feature.properties.name) ||
        (feature.properties.provinceId !== null &&
          (typeof feature.properties.provinceId !== "string" ||
            !provinceIds.has(feature.properties.provinceId))) ||
        !object(feature.geometry)
      ) {
        errors.push("底图要素字段或省份关联不正确");
        continue;
      }
      const { type, coordinates } = feature.geometry;
      const valid =
        type === "Polygon"
          ? polygon(coordinates)
          : type === "MultiPolygon"
            ? Array.isArray(coordinates) &&
              coordinates.length > 0 &&
              coordinates.every(polygon)
            : type === "LineString"
              ? line(coordinates)
              : type === "MultiLineString" &&
                Array.isArray(coordinates) &&
                coordinates.length > 0 &&
                coordinates.every(line);
      if (!valid) errors.push(`${feature.properties.name} 底图几何非法`);
    }
  }
  return errors.length
    ? { valid: false, errors }
    : { valid: true, data: input as unknown as GeographyData, errors: [] };
}

/** 接受世界经纬度范围；不把无效值裁剪成可绘制的点。 */
export function isValidCoordinate(
  longitude: number,
  latitude: number,
): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function uniqueGroups(groups: readonly CatalogGroup[]): CatalogGroup[] {
  return [...new Map(groups.map((group) => [group.id, group])).values()];
}

/** 显式名称/别名匹配；城市缺失时绝不从省份推断省会。 */
export function resolveCatalogRegion(
  region: CatalogRegion,
  data: GeographyData = GEOGRAPHY_DATA,
):
  | { city: GeoCity; reason: null }
  | { city: null; reason: UnlocatedGroup["reason"] } {
  if (!region.city?.trim()) return { city: null, reason: "missing-city" };
  const cityName = normalizeRegionName(region.city);
  const matches = data.cities.filter(
    (city) =>
      isValidCoordinate(city.longitude, city.latitude) &&
      [city.name, ...city.aliases].some(
        (name) => normalizeRegionName(name) === cityName,
      ),
  );
  if (!matches.length) return { city: null, reason: "unknown-city" };
  if (!region.province?.trim())
    return matches.length === 1
      ? { city: matches[0], reason: null }
      : { city: null, reason: "unknown-city" };
  const provinceName = normalizeRegionName(region.province);
  const provinces = new Set(
    data.provinces
      .filter((province) =>
        [province.name, ...province.aliases].some(
          (name) => normalizeRegionName(name) === provinceName,
        ),
      )
      .map((province) => province.id),
  );
  const resolved = matches.filter((city) => provinces.has(city.provinceId));
  return resolved.length === 1
    ? { city: resolved[0], reason: null }
    : { city: null, reason: "province-mismatch" };
}

/** 每个城市按团体 ID 去重；同团跨城保留多次地域出现，不复制业务档案。 */
export function aggregateCityGroups(
  locations: readonly GroupLocation[],
): CityGroup[] {
  const cities = new Map<
    string,
    { city: GeoCity; groups: Map<string, CatalogGroup> }
  >();
  for (const { group, city } of locations) {
    if (!isValidCoordinate(city.longitude, city.latitude)) continue;
    let entry = cities.get(city.id);
    if (!entry) {
      entry = { city, groups: new Map() };
      cities.set(city.id, entry);
    }
    entry.groups.set(group.id, group);
  }
  return [...cities.values()]
    .map(({ city, groups }) => ({
      city,
      groups: [...groups.values()],
      count: groups.size,
    }))
    .sort((a, b) => a.city.id.localeCompare(b.city.id));
}

/** 共用公开索引的筛选语义；不读取原始候选、IP 或成员位置。 */
export function buildGeographyModel(
  groups: readonly CatalogGroup[],
  filters: CatalogFilters,
  data: GeographyData = GEOGRAPHY_DATA,
): GeographyModel {
  const unique = uniqueGroups(groups);
  const matched = filterCatalogGroups(unique, filters);
  const nationwide = filterCatalogGroups(unique, {
    ...filters,
    province: [],
    city: [],
  });
  const locations: GroupLocation[] = [];
  const unlocatedGroups: UnlocatedGroup[] = [];
  for (const group of matched) {
    const location = resolveCatalogRegion(group[filters.regionRole], data);
    if (location.city) locations.push({ group, city: location.city });
    else unlocatedGroups.push({ group, reason: location.reason });
  }
  const cityGroups = aggregateCityGroups(locations);
  return {
    groups: matched,
    cityGroups,
    unlocatedGroups,
    nationwideUniqueGroupCount: nationwide.length,
    locatedUniqueGroupCount: new Set(locations.map(({ group }) => group.id))
      .size,
    locationOccurrenceCount: cityGroups.reduce(
      (sum, city) => sum + city.count,
      0,
    ),
    provinces: [...data.provinces],
    cities: [...data.cities],
  };
}

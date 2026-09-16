import type { CatalogGroup } from "../catalog/model";

/** 城市级示意坐标，不代表团体基地、场馆或成员所在地。 */
export interface GeoCity {
  id: string;
  name: string;
  provinceId: string;
  longitude: number;
  latitude: number;
  aliases: string[];
  sourceId: string;
}

export interface GeoProvince {
  id: string;
  name: string;
  aliases: string[];
}

export type GeoPosition = [number, number];
export type GeoGeometry =
  | { type: "Polygon"; coordinates: GeoPosition[][] }
  | { type: "MultiPolygon"; coordinates: GeoPosition[][][] }
  | { type: "LineString"; coordinates: GeoPosition[] }
  | { type: "MultiLineString"; coordinates: GeoPosition[][] };

export interface GeoFeature {
  type: "Feature";
  properties: { name: string; provinceId: string | null };
  geometry: GeoGeometry;
}

export interface GeoBasemap {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface GeographyData {
  schemaVersion: "idol-geography-v1";
  coordinateSystem: "WGS84";
  provinces: GeoProvince[];
  cities: GeoCity[];
  attribution: string[];
  basemap: GeoBasemap | null;
}

export interface GroupLocation {
  group: CatalogGroup;
  city: GeoCity;
}

export interface CityGroup {
  city: GeoCity;
  groups: CatalogGroup[];
  count: number;
}

export interface UnlocatedGroup {
  group: CatalogGroup;
  reason: "missing-city" | "unknown-city" | "province-mismatch";
}

export interface GeographyModel {
  groups: CatalogGroup[];
  cityGroups: CityGroup[];
  unlocatedGroups: UnlocatedGroup[];
  /** 保留搜索、状态与地域口径，仅去掉省市条件。 */
  nationwideUniqueGroupCount: number;
  locatedUniqueGroupCount: number;
  /** 当前筛选结果中，各城市团体去重计数之和。 */
  locationOccurrenceCount: number;
  provinces: GeoProvince[];
  cities: GeoCity[];
}

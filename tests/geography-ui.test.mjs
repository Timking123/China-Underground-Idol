import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { geoContains } from "d3-geo";

const compiled = await build({
  entryPoints: [
    new URL("../src/geography/page.ts", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/u,
      "$1",
    ),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const page = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const rendererBundle = await build({
  entryPoints: [
    new URL("../src/geography/renderer.ts", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/u,
      "$1",
    ),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const renderer = await import(
  `data:text/javascript;base64,${Buffer.from(rendererBundle.outputFiles[0].text).toString("base64")}`
);
const data = {
  schemaVersion: "idol-geography-v1",
  coordinateSystem: "WGS84",
  attribution: [],
  basemap: null,
  provinces: [
    { id: "gd", name: "广东", aliases: ["广东省"] },
    { id: "qh", name: "青海", aliases: [] },
  ],
  cities: [
    {
      id: "sz",
      name: "深圳",
      aliases: ["深圳市"],
      provinceId: "gd",
      longitude: 114.06,
      latitude: 22.55,
      sourceId: "test",
    },
    {
      id: "gz",
      name: "广州",
      aliases: [],
      provinceId: "gd",
      longitude: 113.27,
      latitude: 23.13,
      sourceId: "test",
    },
  ],
};
const catalog = {
  schemaVersion: "idol-catalog-v1",
  archiveDate: "2026-09-16",
  groups: [],
};

test("空地区按完整地理字典恢复，不能因无团体而退回全国", () => {
  const parsed = page.parseGeographySearch("?province=青海", catalog, data);
  assert.equal(parsed.ignored, false);
  assert.deepEqual(parsed.state.filters.province, ["青海"]);
  const restored = page.parseGeographySearch(
    page.serializeGeographyState(parsed.state),
    catalog,
    data,
  );
  assert.deepEqual(restored.state, parsed.state);
});

test("广东到深圳只保留城市条件，切回省份清城市，历史快照互不修改", () => {
  const initial = page.defaultGeographyState();
  const province = page.selectGeographyRegion(initial, "province", "广东");
  const provinceUrl = page.serializeGeographyState(province);
  const city = page.selectGeographyRegion(province, "city", "深圳");
  assert.deepEqual(city.filters.province, []);
  assert.deepEqual(city.filters.city, ["深圳"]);
  assert.deepEqual(province.filters.province, ["广东"]);
  assert.deepEqual(
    page.parseGeographySearch(provinceUrl, catalog, data).state.filters,
    province.filters,
  );
  const backToProvince = page.selectGeographyRegion(city, "province", "广东");
  assert.deepEqual(backToProvince.filters.city, []);
});

test("旧URL省市组合保留并集条件，不偷偷改成单城市", () => {
  const parsed = page.parseGeographySearch(
    "?province=广东&city=深圳",
    catalog,
    data,
  );
  assert.equal(parsed.ignored, false);
  assert.deepEqual(parsed.state.filters.province, ["广东"]);
  assert.deepEqual(parsed.state.filters.city, ["深圳"]);
});

test("城市入口计数与去掉父省后的名单一致，缺省份和省市冲突不显示假零", () => {
  const group = (id, province) => ({
    id,
    name: id,
    aliases: [],
    handle: "",
    isActive: true,
    activity: { province, city: "深圳" },
    founding: { province: null, city: null },
    styleLabel: "",
  });
  const groups = [group("g001", null), group("g002", "青海")];
  const provinceState = page.selectGeographyRegion(
    page.defaultGeographyState(),
    "province",
    "广东",
  );
  assert.equal(
    page.cityResultCount(groups, provinceState.filters, "深圳", data),
    2,
  );
  const cityState = page.selectGeographyRegion(provinceState, "city", "深圳");
  assert.equal(
    page.cityResultCount(groups, cityState.filters, "深圳", data),
    2,
  );
});

test("未定位入口与地区互斥，搜索和状态继续保留", () => {
  const state = page.parseGeographySearch(
    "?province=广东&q=测试&status=all",
    catalog,
    data,
  ).state;
  const unknown = page.selectGeographyRegion(state, "unknown");
  assert.equal(unknown.unknown, true);
  assert.deepEqual(unknown.filters.province, []);
  assert.deepEqual(unknown.filters.city, []);
  assert.equal(unknown.filters.q, "测试");
  assert.equal(unknown.filters.status, "all");
  const conflicting = page.parseGeographySearch(
    "?province=广东&unknown=1",
    catalog,
    data,
  );
  assert.equal(conflicting.ignored, true);
  assert.equal(conflicting.state.unknown, false);
  assert.deepEqual(conflicting.state.filters.province, ["广东"]);
});

test("URL完整保留检索、口径、状态与有效地图镜头", () => {
  const state = page.defaultGeographyState();
  state.filters.q = "<img src=x onerror=alert(1)>";
  state.filters.status = "all";
  state.filters.regionRole = "founding";
  state.camera = { longitude: 114.057, latitude: 22.543, zoom: 12.4 };
  const url = page.serializeGeographyState(state);
  assert.ok(!url.includes("<img"));
  const restored = page.parseGeographySearch(url, catalog, data);
  assert.equal(restored.ignored, false);
  assert.deepEqual(restored.state, state);
});

test("恶意或损坏镜头/重复参数不会进入投影，畸形链接明确忽略", () => {
  for (const search of [
    "?zoom=Infinity&lng=100&lat=30",
    "?zoom=2&lng=100&lat=",
    "?zoom=2&lng=100&lat=30&lat=31",
    "?q=%E0%A4%A",
    `?q=${"x".repeat(5000)}`,
    "?city=不存在的城",
  ]) {
    const parsed = page.parseGeographySearch(search, catalog, data);
    assert.equal(parsed.ignored, true, search.slice(0, 100));
    assert.equal(parsed.state.camera, null);
  }
});

const cityEntry = (id, ids) => ({
  city: { id },
  count: ids.length,
  groups: ids.map((id) => ({ id })),
});
test("邻近城市在全国聚合，跨城同团只计一次，放大后拆开", () => {
  const a = cityEntry("a", ["g001", "g002"]);
  const b = cityEntry("b", ["g001", "g003"]);
  const near = renderer.clusterScreenCities([
    { x: 100, y: 100, entry: a },
    { x: 120, y: 100, entry: b },
  ]);
  assert.equal(near.length, 1);
  assert.equal(near[0].count, 3);
  assert.equal(near[0].cities.length, 2);
  const far = renderer.clusterScreenCities([
    { x: 100, y: 100, entry: a },
    { x: 200, y: 100, entry: b },
  ]);
  assert.equal(far.length, 2);
  assert.deepEqual(
    far.map((entry) => entry.count),
    [2, 2],
  );
});

test("聚合点间距不重叠，保持单城列表，不修改输入", () => {
  const input = [0, 40, 80, 140].map((x, i) => ({
    x,
    y: 100,
    entry: cityEntry(String(i), [`g00${i}`]),
  }));
  const before = JSON.stringify(input);
  const clusters = renderer.clusterScreenCities(input);
  for (const a of clusters)
    for (const b of clusters)
      if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 56);
  assert.equal(JSON.stringify(input), before);
});

test("球面环向适配不篡改来源几何，线状边界保持不变", () => {
  const polygon = {
    type: "Feature",
    properties: { name: "测试", provinceId: null },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  };
  const basemap = { type: "FeatureCollection", features: [polygon] };
  const before = JSON.stringify(basemap);
  const oriented = renderer.orientBasemap(basemap);
  assert.equal(JSON.stringify(basemap), before);
  assert.deepEqual(oriented.features[0].geometry.coordinates[0][1], [0, 1]);
  assert.equal(geoContains(oriented, [0.5, 0.5]), true);
  assert.equal(geoContains(oriented, [114, 30]), false);
});

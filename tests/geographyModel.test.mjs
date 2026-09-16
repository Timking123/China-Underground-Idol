import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildGroupCatalog } from "../scripts/groupCatalog.mjs";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const root = new URL("../", import.meta.url);
const output = await build({
  entryPoints: [fileURLToPath(new URL("src/geography/model.ts", root))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const model = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);
const catalog = await buildGroupCatalog(fileURLToPath(root));
const clone = (value) => JSON.parse(JSON.stringify(value));
const filters = (overrides = {}) => ({
  q: "",
  status: "active",
  regionRole: "activity",
  province: [],
  city: [],
  style: "",
  ...overrides,
});
const group = (id, overrides = {}) => ({
  ...clone(catalog.groups[0]),
  id,
  ...overrides,
});
const city = (name) =>
  model.GEOGRAPHY_DATA.cities.find((item) => item.name === name);

test("真数据默认活动城市：375团中238团可定位，其余137团保留未定位", () => {
  const result = model.buildGeographyModel(catalog.groups, filters());
  assert.equal(result.groups.length, 375);
  assert.equal(result.nationwideUniqueGroupCount, 375);
  assert.equal(result.locatedUniqueGroupCount, 238);
  assert.equal(result.locationOccurrenceCount, 238);
  assert.equal(result.cityGroups.length, 28);
  assert.equal(result.unlocatedGroups.length, 137);
  assert.ok(
    result.unlocatedGroups.every((item) => item.reason === "missing-city"),
  );
  assert.equal(
    new Set([
      ...result.cityGroups.flatMap((item) => item.groups.map((g) => g.id)),
      ...result.unlocatedGroups.map(({ group: g }) => g.id),
    ]).size,
    375,
  );
});

test("全部与建团口径保持既有档案城市，不从活动城市补齐建团城市", () => {
  for (const [status, regionRole, total, located, unlocated] of [
    ["all", "activity", 399, 254, 145],
    ["active", "founding", 375, 106, 269],
    ["all", "founding", 399, 114, 285],
  ]) {
    const result = model.buildGeographyModel(
      catalog.groups,
      filters({ status, regionRole }),
    );
    assert.equal(result.groups.length, total);
    assert.equal(result.locatedUniqueGroupCount, located);
    assert.equal(result.unlocatedGroups.length, unlocated);
  }
});

test("省份、城市并集筛选与全国条件计数分开计算", () => {
  const rows = [
    group("g001", { activity: { province: "广东省", city: "深圳市" } }),
    group("g002", { activity: { province: "上海市", city: "上海市" } }),
    group("g003", { activity: { province: "四川省", city: "成都市" } }),
  ];
  const result = model.buildGeographyModel(
    rows,
    filters({ province: ["广东"], city: ["上海"] }),
  );
  assert.deepEqual(
    result.groups.map((g) => g.id),
    ["g001", "g002"],
  );
  assert.equal(result.nationwideUniqueGroupCount, 3);
  assert.equal(result.locatedUniqueGroupCount, 2);
});

test("搜索、存续状态和别名沿用公共索引，全国计数也保留这些条件", () => {
  const rows = [
    group("g001", {
      name: "ALPHA",
      aliases: ["阿尔法"],
      activity: { province: "上海市", city: "上海市" },
    }),
    group("g002", { name: "ALPHA", isActive: false }),
  ];
  assert.equal(
    model.buildGeographyModel(rows, filters({ q: "alpha", city: ["成都"] }))
      .nationwideUniqueGroupCount,
    1,
  );
  assert.equal(
    model.buildGeographyModel(rows, filters({ q: "阿尔法" })).groups.length,
    1,
  );
  assert.equal(
    model.buildGeographyModel(rows, filters({ q: "ALPHA", status: "all" }))
      .groups.length,
    2,
  );
});

test("零项、未收录省市和无匹配搜索保留全量省市选择字典", () => {
  for (const [rows, options] of [
    [[], filters()],
    [catalog.groups, filters({ province: ["西藏"] })],
    [catalog.groups, filters({ city: ["拉萨"] })],
    [catalog.groups, filters({ q: "没有此团体的查询xyz" })],
  ]) {
    const result = model.buildGeographyModel(rows, options);
    assert.equal(result.groups.length, 0);
    assert.deepEqual(result.cityGroups, []);
    assert.deepEqual(result.unlocatedGroups, []);
    assert.equal(result.provinces.length, 34);
    assert.equal(result.cities.length, 41);
  }
});

test("只以省市明确名称及后缀别名定位，拒绝省会补点与地域冲突", () => {
  for (const name of ["广州市", "广州", "  广州  "])
    assert.equal(
      model.resolveCatalogRegion({ province: "广东", city: name }).city.id,
      city("广州市").id,
    );
  assert.equal(
    model.resolveCatalogRegion({ province: "广西", city: "南宁" }).city
      .provinceId,
    "cn-guangxi",
  );
  assert.equal(
    model.resolveCatalogRegion({ province: "吉林省", city: "吉林市" }).city.id,
    "geonames-2036502",
  );
  assert.equal(
    model.resolveCatalogRegion({ province: "湖南省", city: "长沙市" }).city.id,
    "geonames-1815577",
  );
  assert.equal(
    model.resolveCatalogRegion({ province: "海南省", city: "海口市" }).city.id,
    "geonames-1809078",
  );
  assert.deepEqual(
    model.resolveCatalogRegion({ province: "广东省", city: null }),
    { city: null, reason: "missing-city" },
  );
  assert.equal(
    model.resolveCatalogRegion({ province: "河北省", city: "广州市" }).reason,
    "province-mismatch",
  );
  for (const name of ["未知", "华南", "广", "广州/深圳"])
    assert.equal(
      model.resolveCatalogRegion({ province: null, city: name }).reason,
      "unknown-city",
    );
});

test("同名城市缺省份时不猜测，给定省份后消歧", () => {
  const data = clone(model.GEOGRAPHY_DATA);
  data.cities.push({
    ...city("广州市"),
    id: "alias-fixture",
    name: "同名市",
    aliases: [],
    provinceId: "cn-guangdong",
  });
  data.cities.push({
    ...city("上海市"),
    id: "alias-fixture-2",
    name: "同名市",
    aliases: [],
    provinceId: "cn-shanghai",
  });
  assert.equal(
    model.resolveCatalogRegion({ province: null, city: "同名市" }, data).reason,
    "unknown-city",
  );
  assert.equal(
    model.resolveCatalogRegion({ province: "广东省", city: "同名市" }, data)
      .city.id,
    "alias-fixture",
  );
});

test("同团多城市的聚合出现次数与唯一团体数不同，同城重复只计一次", () => {
  const first = group("g001");
  const second = group("g002");
  const result = model.aggregateCityGroups([
    { group: first, city: city("广州市") },
    { group: first, city: city("广州市") },
    { group: second, city: city("广州市") },
    { group: first, city: city("上海市") },
  ]);
  assert.equal(result.length, 2);
  assert.equal(
    result.reduce((sum, entry) => sum + entry.count, 0),
    3,
  );
  assert.equal(
    new Set(result.flatMap((entry) => entry.groups.map((g) => g.id))).size,
    2,
  );
  assert.equal(result.find((entry) => entry.city.name === "广州市").count, 2);
  assert.equal(
    result.find((entry) => entry.city.name === "上海市").groups[0],
    first,
  );
});

test("模型按团体ID去重，输入记录及静态字典不被修改", () => {
  const input = [catalog.groups[0], catalog.groups[0]];
  const before = JSON.stringify([input, model.GEOGRAPHY_DATA]);
  const result = model.buildGeographyModel(input, filters({ status: "all" }));
  assert.equal(result.groups.length, 1);
  assert.equal(result.locatedUniqueGroupCount, 1);
  assert.equal(JSON.stringify([input, model.GEOGRAPHY_DATA]), before);
});

test("非法、非有限或颠倒越界坐标不生成聚合点", () => {
  for (const [longitude, latitude] of [
    [NaN, 30],
    [Infinity, 30],
    [190, 30],
    [120, 91],
    [30, 120],
  ]) {
    assert.equal(model.isValidCoordinate(longitude, latitude), false);
    assert.deepEqual(
      model.aggregateCityGroups([
        {
          group: catalog.groups[0],
          city: { ...city("上海市"), longitude, latitude },
        },
      ]),
      [],
    );
  }
  assert.equal(model.isValidCoordinate(0, 0), true);
});

test("离线字典通过验证，关键数据错误有明确失败结果", () => {
  assert.equal(model.validateGeographyData(model.GEOGRAPHY_DATA).valid, true);
  for (const mutate of [
    (d) => {
      d.cities[0].latitude = 130;
    },
    (d) => {
      d.cities[0].sourceId = "";
    },
    (d) => {
      d.cities[0].provinceId = "missing";
    },
    (d) => {
      d.cities.push(d.cities[0]);
    },
    (d) => {
      d.coordinateSystem = "GCJ-02";
    },
    (d) => {
      d.attribution = [];
    },
    (d) => {
      d.basemap = { type: "FeatureCollection", features: [] };
    },
  ]) {
    const data = clone(model.GEOGRAPHY_DATA);
    mutate(data);
    assert.equal(model.validateGeographyData(data).valid, false);
  }
  assert.equal(model.validateGeographyData(null).valid, false);
});

test("41座城市坐标逐项对应保存的GeoNames原始记录，当前有城市的团体全部能匹配", async () => {
  const rows = (
    await readFile(
      new URL("data/geography/geonames-selected.tsv", root),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  assert.equal(rows.length, 41);
  const byId = new Map(rows.map((row) => [row[0], row]));
  for (const point of model.GEOGRAPHY_DATA.cities) {
    const row = byId.get(point.sourceId.replace("geonames:", ""));
    assert.ok(row);
    assert.equal(point.longitude, Number(row[5]));
    assert.equal(point.latitude, Number(row[4]));
    assert.equal(point.id, `geonames-${row[0]}`);
    assert.ok(
      model.GEOGRAPHY_DATA.provinces.some((p) => p.id === point.provinceId),
    );
  }
  for (const g of catalog.groups)
    for (const role of ["activity", "founding"])
      if (g[role].city)
        assert.ok(model.resolveCatalogRegion(g[role]).city, `${g.id} ${role}`);
});

test("底图拒绝未闭合面、非法坐标和未知省份，接受规范的面与线", () => {
  const validGeometries = [
    {
      type: "Polygon",
      coordinates: [
        [
          [100, 20],
          [101, 20],
          [101, 21],
          [100, 20],
        ],
      ],
    },
    {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [100, 20],
            [101, 20],
            [101, 21],
            [100, 20],
          ],
        ],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [100, 20],
        [101, 20],
      ],
    },
    {
      type: "MultiLineString",
      coordinates: [
        [
          [100, 20],
          [101, 20],
        ],
      ],
    },
  ];
  const data = clone(model.GEOGRAPHY_DATA);
  const feature = (geometry) => ({
    type: "Feature",
    properties: { name: "测试几何", provinceId: "cn-shanghai" },
    geometry,
  });
  data.basemap = {
    type: "FeatureCollection",
    features: validGeometries.map(feature),
  };
  assert.equal(model.validateGeographyData(data).valid, true);
  for (const geometry of [
    { type: "Point", coordinates: [100, 20] },
    { type: "LineString", coordinates: [[100, 20]] },
    {
      type: "LineString",
      coordinates: [
        [100, NaN],
        [101, 20],
      ],
    },
    {
      type: "LineString",
      coordinates: [
        [100, 20, 3],
        [101, 20, 3],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [100, 20],
          [101, 20],
          [101, 21],
          [100, 21],
        ],
      ],
    },
    { type: "MultiPolygon", coordinates: [[]] },
    { type: "MultiLineString", coordinates: [] },
  ]) {
    data.basemap.features = [feature(geometry)];
    assert.equal(model.validateGeographyData(data).valid, false);
  }
  data.basemap.features = [feature(validGeometries[0])];
  data.basemap.features[0].properties.provinceId = "missing";
  assert.equal(model.validateGeographyData(data).valid, false);
  data.basemap.features = [
    {
      type: "Feature",
      properties: {
        name: "东沙岛",
        provinceId: null,
        role: "geographic-symbol",
        sourceId: "geonames:1821061",
      },
      geometry: { type: "Point", coordinates: [116.73162, 20.69992] },
    },
  ];
  assert.equal(model.validateGeographyData(data).valid, true);
  data.basemap.features[0].geometry.coordinates[1] = 120;
  assert.equal(model.validateGeographyData(data).valid, false);
});

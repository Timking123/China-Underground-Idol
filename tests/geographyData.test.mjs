import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../data/geography/", import.meta.url);
const read = async (name) =>
  (await readFile(new URL(name, root), "utf8")).replace(/\r\n/gu, "\n");
const basemapText = await read("basemap.cn.v1.json");
const basemap = JSON.parse(basemapText);
const provenance = JSON.parse(await read("basemap.provenance.json"));
const cities = JSON.parse(await read("cities.v1.json"));
const digest = (text) => createHash("sha256").update(text).digest("hex");

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function polygons(feature) {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates]
    : feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [];
}

function contains(feature, position) {
  return polygons(feature).some(
    ([outer, ...holes]) =>
      inRing(position, outer) && !holes.some((hole) => inRing(position, hole)),
  );
}

test("全国底图覆盖34个省级地区，来源哈希与实际提交字节一致", () => {
  const provinceIds = basemap.features
    .map((f) => f.properties.provinceId)
    .filter(Boolean);
  assert.deepEqual(
    [...new Set(provinceIds)].sort(),
    cities.provinces.map((p) => p.id).sort(),
  );
  assert.equal(digest(basemapText), provenance.basemapSha256);
  assert.equal(Buffer.byteLength(basemapText), provenance.basemapBytes);
  assert.equal(basemap.features.length, provenance.featureCount);
  assert.ok(Buffer.byteLength(JSON.stringify(basemap)) < 2 * 1024 * 1024);
  assert.equal(provenance.worldview, "CN");
  assert.equal(provenance.coordinateSystem, "WGS84");
  assert.equal(provenance.sources.length, 5);
  assert.ok(
    provenance.sources.every((source) => /^[a-f0-9]{64}$/u.test(source.sha256)),
  );
});

test("边缘地区及离岛真实面保留，行政归属不会回到来源默认分类", () => {
  for (const [provinceId, longitude, latitude] of [
    ["cn-xinjiang", 79, 35],
    ["cn-tibet", 94, 28],
    ["cn-taiwan", 121.52639, 25.05306],
    ["cn-taiwan", 123.526, 25.766],
    ["cn-fujian", 118.32, 24.45],
    ["cn-fujian", 119.94, 26.155],
    ["cn-hainan", 117.754, 15.152],
    ["cn-hong-kong", 114.17469, 22.27832],
    ["cn-macao", 113.54611, 22.20056],
  ]) {
    assert.ok(
      basemap.features.some(
        (feature) =>
          feature.properties.provinceId === provinceId &&
          contains(feature, [longitude, latitude]),
      ),
      provinceId,
    );
  }
  const retained = provenance.retainedMinorIslandRecords;
  assert.equal(retained.length, 248);
  for (const record of retained)
    assert.ok(
      basemap.features.some((feature) =>
        contains(feature, record.referencePoint),
      ),
      `源小岛/陆地记录 ${record.index} 未保留`,
    );
  for (const [code, count] of [
    ["B18", 9],
    ["B46", 21],
    ["B47", 18],
    ["B70", 1],
  ])
    assert.equal(
      retained.filter((record) => record.sr_brk_a3 === code).length,
      count,
    );
  const maritime = basemap.features.filter(
    (feature) => feature.geometry.type === "LineString",
  );
  assert.equal(maritime.length, 9);
  assert.ok(
    Math.min(
      ...maritime.flatMap((f) => f.geometry.coordinates.map((p) => p[1])),
    ) < 3.5,
  );
});

test("城市坐标对应各自省级面，沿海概化误差不通过挪点掩盖", () => {
  for (const city of cities.cities) {
    const province = basemap.features.find(
      (feature) => feature.properties.provinceId === city.provinceId,
    );
    const position = [city.longitude, city.latitude];
    if (city.id === "geonames-1790645") {
      // 厦门示意中心距源海岸约0.00257度；保留来源原值，验证约500米概化范围。
      assert.ok(
        [
          [-0.005, 0],
          [0.005, 0],
          [0, -0.005],
          [0, 0.005],
        ].some(([dx, dy]) =>
          contains(province, [position[0] + dx, position[1] + dy]),
        ),
      );
    } else assert.ok(contains(province, position), city.name);
  }
});

test("东沙岛与曾母暗沙取自原始WGS84 RDF，地理符号不混入城市或团体点", async () => {
  const points = basemap.features.filter(
    (feature) => feature.geometry.type === "Point",
  );
  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map((p) => p.properties.name),
    ["东沙岛", "曾母暗沙"],
  );
  for (const point of points) {
    const source = provenance.geographicSymbols.find(
      (record) => record.sourceId === point.properties.sourceId,
    );
    const rdf = await read(source.sourceFile);
    assert.equal(digest(rdf), source.sourceSha256Lf);
    assert.match(rdf, /https:\/\/creativecommons.org\/licenses\/by\/4.0\//u);
    assert.deepEqual(point.geometry.coordinates, [
      Number(rdf.match(/<wgs84_pos:long>([^<]+)</u)[1]),
      Number(rdf.match(/<wgs84_pos:lat>([^<]+)</u)[1]),
    ]);
    assert.equal(point.properties.provinceId, null);
    assert.equal(point.properties.role, "geographic-symbol");
    assert.ok(
      !cities.cities.some(
        (city) => city.sourceId === point.properties.sourceId,
      ),
    );
  }
});

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 离线再生成：node data/geography/import-geonames.mjs <cities15000.txt>。
// 城市白名单为地名字典，不含团体名单；来源字段及记录完整保存在证据摘录中。
const provinces = [
  ["beijing", "北京市", "22"],
  ["tianjin", "天津市", "28"],
  ["hebei", "河北省", "10"],
  ["shanxi", "山西省", "24"],
  ["inner-mongolia", "内蒙古自治区", "20", "内蒙古"],
  ["liaoning", "辽宁省", "19"],
  ["jilin", "吉林省", "05"],
  ["heilongjiang", "黑龙江省", "08"],
  ["shanghai", "上海市", "23"],
  ["jiangsu", "江苏省", "04"],
  ["zhejiang", "浙江省", "02"],
  ["anhui", "安徽省", "01"],
  ["fujian", "福建省", "07"],
  ["jiangxi", "江西省", "03"],
  ["shandong", "山东省", "25"],
  ["henan", "河南省", "09"],
  ["hubei", "湖北省", "12"],
  ["hunan", "湖南省", "11"],
  ["guangdong", "广东省", "30"],
  ["guangxi", "广西壮族自治区", "16", "广西"],
  ["hainan", "海南省", "31"],
  ["chongqing", "重庆市", "33"],
  ["sichuan", "四川省", "32"],
  ["guizhou", "贵州省", "18"],
  ["yunnan", "云南省", "29"],
  ["tibet", "西藏自治区", "14", "西藏"],
  ["shaanxi", "陕西省", "26"],
  ["gansu", "甘肃省", "15"],
  ["qinghai", "青海省", "06"],
  ["ningxia", "宁夏回族自治区", "21", "宁夏"],
  ["xinjiang", "新疆维吾尔自治区", "13", "新疆"],
  ["taiwan", "台湾省", null],
  ["hong-kong", "香港特别行政区", null, "香港"],
  ["macao", "澳门特别行政区", null, "澳门"],
];

const citySelections = [
  ["北京市", "1816670", "beijing"],
  ["天津市", "1792947", "tianjin"],
  ["石家庄市", "1795270", "hebei"],
  ["太原市", "1793511", "shanxi"],
  ["呼和浩特市", "2036892", "inner-mongolia"],
  ["沈阳市", "2034937", "liaoning"],
  ["大连市", "1814087", "liaoning"],
  ["吉林市", "2036502", "jilin"],
  ["长春市", "2038180", "jilin"],
  ["哈尔滨市", "2037013", "heilongjiang"],
  ["上海市", "1796236", "shanghai"],
  ["南京市", "1799962", "jiangsu"],
  ["无锡市", "1790923", "jiangsu"],
  ["苏州市", "1886760", "jiangsu"],
  ["杭州市", "1808926", "zhejiang"],
  ["合肥市", "1808722", "anhui"],
  ["福州市", "1810821", "fujian"],
  ["厦门市", "1790645", "fujian"],
  ["南昌市", "1800163", "jiangxi"],
  ["济南市", "1805753", "shandong"],
  ["郑州市", "1784658", "henan"],
  ["武汉市", "1791247", "hubei"],
  ["长沙市", "1815577", "hunan"],
  ["广州市", "1809858", "guangdong"],
  ["深圳市", "1795565", "guangdong"],
  ["东莞市", "1812545", "guangdong"],
  ["南宁市", "1799869", "guangxi"],
  ["海口市", "1809078", "hainan"],
  ["重庆市", "1814906", "chongqing"],
  ["成都市", "1815286", "sichuan"],
  ["贵阳市", "1809461", "guizhou"],
  ["昆明市", "1804651", "yunnan"],
  ["拉萨市", "1280737", "tibet"],
  ["西安市", "1790630", "shaanxi"],
  ["兰州市", "1804430", "gansu"],
  ["西宁市", "1788852", "qinghai"],
  ["银川市", "1786657", "ningxia"],
  ["乌鲁木齐市", "1529102", "xinjiang"],
  ["台北市", "1668341", "taiwan"],
  ["香港", "1819729", "hong-kong"],
  ["澳门", "1821274", "macao"],
];

const input = process.argv[2];
if (!input) throw new Error("请提供已下载的 GeoNames cities15000.txt 路径");
const records = (await readFile(input, "utf8")).trim().split(/\r?\n/u);
const byId = new Map(records.map((row) => [row.split("\t", 1)[0], row]));
const selected = [];
const cities = citySelections.map(([name, id, province]) => {
  const row = byId.get(id);
  if (!row) throw new Error(`GeoNames 缺少 ${name} (${id})`);
  const fields = row.split("\t");
  const shortName = name.replace(/市$/u, "");
  if (
    ![fields[1], ...fields[3].split(",")].some((alias) =>
      [name, shortName].includes(alias),
    )
  )
    throw new Error(`${name}: 来源中文名称不一致`);
  const expected = provinces.find(([key]) => key === province);
  if (
    expected[2] !== null &&
    (fields[8] !== "CN" || fields[10] !== expected[2])
  )
    throw new Error(`${name}: 来源省级行政归属不一致`);
  if (
    fields[6] !== "P" ||
    !["PPLC", "PPLA", "PPLA2", "PPL"].includes(fields[7])
  )
    throw new Error(`${name}: 必须为人口聚落城市记录`);
  selected.push(row);
  return {
    id: `geonames-${id}`,
    name,
    provinceId: `cn-${province}`,
    longitude: Number(fields[5]),
    latitude: Number(fields[4]),
    aliases: name === shortName ? [] : [shortName],
    sourceId: `geonames:${id}`,
  };
});
const data = {
  schemaVersion: "idol-geography-v1",
  coordinateSystem: "WGS84",
  provinces: provinces.map(([id, name, , shortName]) => ({
    id: `cn-${id}`,
    name,
    aliases: [shortName ?? name.replace(/[省市]$/u, "")],
  })),
  cities,
  attribution: [
    "城市示意坐标：GeoNames，CC BY 4.0（https://www.geonames.org/；https://creativecommons.org/licenses/by/4.0/）。已筛选、匹配中文名称和省份；坐标不是团体基地、场馆或成员精确位置。",
  ],
  basemap: null,
};
const directory = path.dirname(fileURLToPath(import.meta.url));
await writeFile(
  path.join(directory, "cities.v1.json"),
  `${JSON.stringify(data, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(directory, "geonames-selected.tsv"),
  `${selected.join("\n")}\n`,
  "utf8",
);
console.log(
  `已生成 ${data.provinces.length} 个省级地区、${cities.length} 个城市示意点；未包含团体名单。`,
);

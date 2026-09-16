"""从固定版本 Natural Earth ZIP 离线生成中国视角底图；不下载、不推测坐标。"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

import shapefile
from shapely import set_precision
from shapely.geometry import mapping, shape
from shapely.ops import unary_union


SOURCES = {
    "ne_10m_admin_0_countries_chn": "16e7589083527d01208b9f645fc8643c767170258e9d13b59d37bc5a1f6a8758",
    "ne_10m_admin_1_states_provinces": "efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05",
    "ne_10m_admin_0_disputed_areas": "a250c1cf8ab68898399928a1fa1d5c242eb4de6335cb51a7f7a7f12a9f3c8438",
    "ne_10m_admin_0_scale_rank_minor_islands": "aaf641befd3237f2fcba81d5ad2693d0bb5062b00db619b32c249f73ca25e854",
    "ne_10m_admin_0_boundary_lines_maritime_indicator_chn": "f691e61db59d71ea8cc2c0121f890215f7279ade3a85c38e8e96960713212dfa",
}
# B77 的固定源几何索引；名称与中国政府网「台湾基本情况」对照。
FUJIAN_ISLAND_PARTS = {2: "金门", 34: "烈屿", 36: "乌丘", 38: "莒光", 39: "莒光", 40: "南竿", 41: "北竿", 42: "东引"}
TIBET_PARTS = {"B00", "B01", "B02", "B03", "B04", "B75", "B76"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_directory", type=Path)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    dictionary = json.loads((directory / "cities.v1.json").read_text(encoding="utf-8"))
    by_name = {p["name"]: p["id"] for p in dictionary["provinces"]}
    provinces = {p["id"]: [] for p in dictionary["provinces"]}
    records = {key: [] for key in provinces}
    sources = []

    def read_layer(name):
        data = (args.source_directory / (name + ".zip")).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != SOURCES[name]:
            raise ValueError(f"源文件版本或哈希不一致：{name}")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            projection = archive.read(name + ".prj").decode("utf-8")
            if 'GCS_WGS_1984' not in projection:
                raise ValueError(f"来源坐标系不是 WGS84：{name}")
            sources.append({
                "name": name,
                "version": archive.read(name + ".VERSION.txt").decode("utf-8").strip(),
                "url": f"https://naciscdn.org/naturalearth/10m/cultural/{name}.zip",
                "sha256": digest,
                "bytes": len(data),
                "projection": projection,
            })
            reader = shapefile.Reader(**{
                ext: io.BytesIO(archive.read(name + "." + ext))
                for ext in ["shp", "shx", "dbf"]
            })
            return [(row.record.as_dict(), shape(row.shape.__geo_interface__)) for row in reader.iterShapeRecords()]

    def add(province_id, geometry, source_id):
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError(f"非法源几何：{source_id}")
        provinces[province_id].append(geometry)
        records[province_id].append(source_id)

    country_rows = read_layer("ne_10m_admin_0_countries_chn")
    nation = []
    for row, geometry in country_rows:
        code = row["ADM0_A3"]
        if code not in {"CHN", "HKG", "MAC"}:
            continue
        nation.append(geometry)
        if code in {"HKG", "MAC"}:
            add("cn-hong-kong" if code == "HKG" else "cn-macao", geometry, f"countries_chn:{row['NE_ID']}")
    for row, geometry in read_layer("ne_10m_admin_1_states_provinces"):
        if row["adm0_a3"] != "CHN":
            continue
        province_id = "cn-hainan" if row["adm1_code"] == "PFA+00?" else by_name.get(row["name_zh"])
        if not province_id:
            raise ValueError(f"未匹配的中国省级面：{row['adm1_code']}")
        add(province_id, geometry, f"admin1:{row['adm1_code']}")

    for row, geometry in read_layer("ne_10m_admin_0_disputed_areas"):
        code = row["BRK_A3"]
        if row["ADM0_A3_CN"] != "CHN" and code != "B70":
            continue
        nation.append(geometry)
        if code == "B77":
            if len(geometry.geoms) != 43:
                raise ValueError("台湾及福建沿海岛屿的源版本发生变化，需重核每个组成面")
            for index, part in enumerate(geometry.geoms):
                add("cn-fujian" if index in FUJIAN_ISLAND_PARTS else "cn-taiwan", part, f"disputed:{code}:part-{index}")
        elif code in TIBET_PARTS:
            add("cn-tibet", geometry, f"disputed:{code}")
        elif code == "B18":
            add("cn-taiwan", geometry, f"disputed:{code}")
        elif code in {"B46", "B47", "B70"}:
            add("cn-hainan", geometry, f"disputed:{code}")

    minor_records = []
    for index, (row, geometry) in enumerate(read_layer("ne_10m_admin_0_scale_rank_minor_islands")):
        if row["sr_adm0_a3"] not in {"CHN", "TWN", "HKG", "MAC", "SCR", "PGA"} and row["sr_brk_a3"] not in TIBET_PARTS | {"B18"}:
            continue
        nation.append(geometry)
        minor_records.append({"index": index, **row, "bounds": list(geometry.bounds)})
        if row["sr_adm0_a3"] in {"HKG", "MAC"}:
            add("cn-hong-kong" if row["sr_adm0_a3"] == "HKG" else "cn-macao", geometry, f"minor_islands:{index}")

    national = unary_union(nation)
    features = []
    province_geometries = []
    for province in dictionary["provinces"]:
        province_id = province["id"]
        if not provinces[province_id]:
            raise ValueError(f"缺少省级面：{province_id}")
        geometry = unary_union(provinces[province_id]).intersection(national)
        province_geometries.append(geometry)
        features.append(feature(province["name"], province_id, geometry))

    # 只补来源已有而省级数据没有覆盖的沿海小岛；不按距离猜其省份。
    remainder = national.difference(unary_union(province_geometries))
    if not remainder.is_empty:
        features.append(feature("沿海岛屿与全国边界补充", None, remainder))
    maritime = read_layer("ne_10m_admin_0_boundary_lines_maritime_indicator_chn")
    if len(maritime) != 9:
        raise ValueError("海域补充线版本发生变化，需重核原始要素")
    for index, (_, geometry) in enumerate(maritime):
        features.append(feature(f"南海海域表示线 {index + 1}", None, geometry))

    basemap = {"type": "FeatureCollection", "features": features}
    encoded = json.dumps(basemap, ensure_ascii=False, separators=(",", ":")) + "\n"
    output = directory / "basemap.cn.v1.json"
    output.write_text(encoded, encoding="utf-8")
    # 使用仓库已安装的格式化器，记录提交文件的实际字节校验值。
    formatter = directory.parents[1] / "node_modules/prettier/bin/prettier.cjs"
    subprocess.run(["node", str(formatter), "--write", str(output)], check=True)
    output_bytes = output.read_bytes()
    provenance = {
        "schemaVersion": "idol-basemap-provenance-v1",
        "downloadDate": "2026-09-16",
        "worldview": "CN",
        "coordinateSystem": "WGS84",
        "license": "Natural Earth public domain",
        "sources": sources,
        "provinceSourceRecords": records,
        "fujianIslandParts": FUJIAN_ISLAND_PARTS,
        "retainedMinorIslandRecords": minor_records,
        "geometryProcessing": "选择中国视角；按省聚合；保留全部选中小岛；不简化边界；经纬度精确到0.000001度",
        "basemapSha256": hashlib.sha256(output_bytes).hexdigest(),
        "basemapBytes": len(output_bytes),
        "bounds": list(national.bounds),
        "featureCount": len(features),
    }
    (directory / "basemap.provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"生成 {len(features)} 个底图要素，保留 {len(minor_records)} 个源小岛/陆地记录，{len(encoded.encode('utf-8'))} 字节")


def feature(name, province_id, geometry):
    # 固定精度消除布尔运算的浮点碎片；不以面积阈值筛掉离岛。
    geometry = set_precision(geometry, grid_size=0.000001)
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError(f"几何处理后无效：{name}")
    if geometry.geom_type not in {"Polygon", "MultiPolygon", "LineString", "MultiLineString"}:
        raise ValueError(f"非预期几何类型：{name} {geometry.geom_type}")
    return {"type": "Feature", "properties": {"name": name, "provinceId": province_id}, "geometry": mapping(geometry)}


if __name__ == "__main__":
    main()

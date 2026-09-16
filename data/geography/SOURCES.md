# 地理数据来源与口径

本目录只保存地名字典、城市示意坐标、地图来源及验证材料，不另建团体名单。团体均从 `src/catalog/model.ts` 的公开 `CatalogGroup` 索引派生。

## 城市示意坐标

采用 [GeoNames 导出数据](https://www.geonames.org/export/)的 `cities15000.zip`，下载日期为 2026-09-16。其[原始说明](https://download.geonames.org/export/dump/readme.txt)明确坐标为 WGS84 十进制度，许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，允许再分发及商业使用，需署名、链接许可并说明修改。

页面须保留“城市示意坐标：GeoNames，CC BY 4.0”，附 GeoNames 与许可链接，并说明已筛选、匹配中文名称和省份。来源按现状提供，不保证准确、及时或完整。

`cities.v1.json` 包含 34 个省级地区和 41 座城市：覆盖当前团体索引两种地域口径涉及的 33 座城市，另含 8 座参考城市，便于无收录地区仍可选择。它不是全国全部城市名录。所有城市坐标直接取自来源记录，未进行坐标系转换、偏移、随机散点或平均。

`geonames-selected.tsv` 保留所选 41 条原始记录；`geonames-admin1-cn.tsv` 保留大陆省级归属的原始对照。每个城市的 `sourceId` 形式为 `geonames:<ID>`，对应摘录首列，也可通过 `https://www.geonames.org/<ID>/` 访问来源条目。

省份中文名按本项目中国行政地域展示；GeoNames 的 country 分类不直接成为产品国家或地区分类。大陆城市同时核对中文全名/简称和省级 admin1 字段，避免把“长沙市”误匹配广东的长沙街道，或把“海口市”误匹配云南的海口镇。台北、香港、澳门分别用已核对的稳定城市记录 ID 关联台湾省、香港特别行政区、澳门特别行政区。

下载文件校验值（SHA-256）：

| 文件                 | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| cities15000.zip      | `4b958a19c7c73524f295247af201d5fe2f3e26f700ef81b04b95ffed5074ba08` |
| cities15000.txt      | `e273e41f89941eb2fecfe995ceb83877f9f7d2fdd6e26d7b1bdde4cd2a7f3329` |
| admin1CodesASCII.txt | `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a` |

维护时可执行 `node data/geography/import-geonames.mjs <下载的 cities15000.txt 路径>`，再格式化输出并运行地理测试。更新来源时必须重核中文同名、行政归属和坐标，不自动采纳新增候选；更新来源哈希与取数日期。脚本也可直接对保存的 `geonames-selected.tsv` 执行，以复现本次字典。

## 团体计数与未定位

默认使用公开索引的主要活动城市 `activity`，可切换到建团城市 `founding`。每个口径当前仅有一个 `{province, city}`，没有正式多城市列表。候选城市、矛盾城市、原文提到的演出城市、IP 和成员位置均不能补成正式团体城市。

城市为空时保留 `missing-city`；城市名称没有唯一匹配时保留 `unknown-city`；省市矛盾时保留 `province-mismatch`。省份已知不意味着省会已知；吉林省与吉林市也不能混为一谈。

模型 `groups` 是当前筛选命中的团体，按 ID 去重。`locatedUniqueGroupCount` 和 `unlocatedGroups` 针对这些结果。`nationwideUniqueGroupCount` 仅移除省市条件，仍保留搜索、状态及地域口径，应显示为“当前条件全国匹配”。`locationOccurrenceCount` 是各城市团体数之和；未来正式数据允许同团跨城时，它可以高于地图上的全国去重团体数。辅助聚合函数支持同团跨城、同城 ID 去重，不扩展当前业务数据 schema。

城市点只代表来源中的城市级示意位置，不代表团体基地、真实活动场馆或成员精确位置。地图使用小比例尺地理资料，不能用于导航。

## 底图来源与变换

底图采用 [Natural Earth 中国视角](https://www.naturalearthdata.com/about/disputed-boundaries-policy/)的 1:10m 数据，以 `ne_10m_admin_0_countries_chn` 为全国范围依据，配省级面、完整小岛层、争议区补充面及中国海域表示线。下载时间为 2026-09-16；面数据版本 5.1.1，海域线版本 5.1.0。[来源许可](https://www.naturalearthdata.com/about/terms-of-use/)明确其地图数据属于公共领域，允许修改和再分发。它是小比例尺底图，不是官方标准地图，不附审图号。

全部输入 ZIP 的下载地址、版本、SHA-256、字节数和 WGS84 投影声明保存在 `basemap.provenance.json`。`import-natural-earth.py` 只读本地 ZIP，哈希或投影不一致时停止；使用 Python、pyshp 3.1.6、shapely 2.1.2 及仓库已安装的 Node/Prettier。执行 `python data/geography/import-natural-earth.py <源 ZIP 目录>` 可重新生成，不需要密钥或在线地图服务。输出文件哈希及字节数统一按 UTF-8、LF 换行核验，避免 Windows Git 检出时换行差异被误报为内容变化。地图构建与访客浏览只使用已提交的静态 JSON，不依赖 Python。

变换为：选取中国视角的陆地及补充图层；大陆 31 省按来源中文全名匹配；港澳合为对应特别行政区；台湾及福建沿海岛屿按[中国政府网台湾基本情况](https://www.gov.cn/guoqing/2020-07/28/content_5530577.htm)分别归属台湾省、福建省；来源中西藏边缘补充面合入西藏；西沙、南沙与黄岩岛合入海南，钓鱼岛及附属岛屿合入台湾。未有可靠省级字段的沿海小岛保留在全国补充层，`provinceId` 为 `null`，不按最近省份猜测。原始 248 个相关小岛/陆地记录均进入全国范围；不以面积阈值筛掉离岛，也不简化边界。布尔运算后将经纬度固定为六位小数，以消除浮点碎片；城市坐标原值不变。

省归属补充证据：[钓鱼岛及附属岛屿](https://www.fmprc.gov.cn/diaoyudao/chn/flfg/zcfg/201510/t20151009_8560598.htm)、[黄岩岛及海南三沙归属](https://lyj.hunan.gov.cn/lyj/xxgk_71167/gzdt/gndt/202608/t20260805_34040030.html)。来源自身的默认国家/地区字段不直接决定本站行政地域展示；例如黄岩岛在来源中仍标作 `SCR`，需依据中文行政口径显式纳入。来源南沙条目的中文名称有误，本站不沿用其错误中文名称。

海域表示完整保留来源的 9 条线，不臆造第 10 条线。来源小比例尺岛面未含东沙群岛，南海南端暗沙也不能以陆地面表示；因此用 GeoNames 的原始 WGS84 记录补充东沙岛 `[116.73162, 20.69992]`、曾母暗沙 `[112.27694, 3.96889]` 两个点状地理符号。它们只说明地理位置，不表达岛屿大小或轮廓，不是团体位置，不参与团体计数或省份定位。

两份原始记录为 [GeoNames 1821061](https://sws.geonames.org/1821061/about.rdf) 与 [GeoNames 8758525](https://sws.geonames.org/8758525/about.rdf)，保存在 `geonames-1821061.rdf`、`geonames-8758525.rdf`；记录内含中文名称、WGS84 经纬度、CC BY 4.0 许可。读取时间为 2026-09-16；曾母暗沙搜索缓存的末位与实时 RDF 略有不同，实际数据严格使用 RDF 原值。转换只筛选名称和坐标，不沿用来源 country/parentADM1 字段；两个符号的 `provinceId` 都明确为 `null`，`role` 为 `geographic-symbol`。页面须保留 GeoNames 与 CC BY 4.0 署名，符号与带团体数量的城市点显著区分。

数据回归验证 34 个省级面、全部 248 个选中源记录的内部参考点、台湾与钓鱼岛、金门与马祖、黄岩岛、藏南与新疆边缘、9 条海域线，以及两个 RDF 坐标与源文件哈希。另以 Shapely 核验全部输出面有效，并在 0.000002 度数值容差内覆盖所有选中源面。41 个城市示意点中，40 个位于对应源省面；厦门点距小比例尺海岸面约 0.00257 度，属于沿海概化差异，保留城市原始坐标，不挪点掩盖误差。此资料适合全国与城市级浏览，不能替代精细海岸、岛礁、场馆或导航数据。

`cities.v1.json` 仍只保存城市字典及显式 `null` 底图字段；运行时 `GEOGRAPHY_DATA` 静态合入 `basemap.cn.v1.json` 和底图署名。城市字典重新生成不会覆盖已核验底图。

已排除以 DataV/高德镜像仓库的 MIT 标记替代原始数据授权；[阿里云说明](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)将该工具数据限定为学习交流。无投影元数据的 SVG 也不能直接按猜测的经纬度叠加城市点。

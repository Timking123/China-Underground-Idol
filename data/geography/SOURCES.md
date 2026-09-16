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

## 底图交付状态

城市与模型的首个交接版本中 `basemap` 为显式 `null`，仅供界面开发处理未加载状态。此状态不构成完整地图交付，也不能据此通过地图上线验收。完整底图将单独核验来源许可、地理范围、离岛/海域表示及投影后加入。

已排除以 DataV/高德镜像仓库的 MIT 标记替代原始数据授权；[阿里云说明](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)将该工具数据限定为学习交流。无投影元数据的 SVG 也不能直接按猜测的经纬度叠加城市点。

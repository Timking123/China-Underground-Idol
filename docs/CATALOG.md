# 轻量团体索引与共享查询

轻量索引供发现页、团体列表、独立档案和活动页使用。资料只来自 `data.js` 正式展示对象，不新增采集、不修改主档。历史团体与稳定 ID 全部保留；默认筛选仅展示 `isActive=true`，独立档案仍可访问历史条目。

## 构建与载入

集成构建从 `scripts/groupCatalog.mjs` 导入并等待 `writeGroupCatalog(root)`，得到 `assets/groups-data.js`。`buildGroupCatalog(root)` 只读并返回通过校验的对象。`root` 为包含 `data.js` 的站点目录；生成器没有自动执行的命令行副作用。

页面先载入 `assets/groups-data.js`，再载入由集成构建生成的 IIFE 页面脚本。页面通过 `src/catalog/runtime.ts` 的 `readCatalog()` 读取 `window.IDOL_GROUPS_DATA`；缺失或损坏返回 `valid:false` 与可读错误。不能把错误解释为“暂无团体”。运行入口不联网、不执行 JSON fetch，支持普通静态脚本与本地文件访问。

生成器使用已有 TypeScript 开发依赖在内存中编译实际 `model.ts` 验证器，浏览器不需要 TypeScript。没有新增依赖。固定源字节生成固定产物；不按构建日期刷新资料观察时间。输出 JSON 转义尖括号和行分隔字符。

## 数据口径

- 地区仅映射 `regionPlacement.founding/activity` 的省市，缺失为 `null`。禁止从省名、团名或其他线索猜城市。
- 风格沿用 `editorialStyle.displayLabel`。`styleState=uncertain` 表示未判定，其余 `editorial` 仍是编辑分类；猜测保留标签与说明，不能升级为官方核验结论。
- 别名只映射 `publicReview.aliases` 的明确关系。不能从括号、疑似官号或模糊名称生成别名。
- 头像优先已采用的 `weiboAvatarPath`，其次正式 `avatarPath`。候选目录必须有路径相同、明确应用头像的 `editorialProfileSupplement`，或路径相同的 `publicReview.profile`；候选原始数据不会自动入选。优先复用头像，而非拿海报当头像。
- 资料图仅取 `preferredVisual.state=selected`；保留未核验当前阵容和未取得转载授权的标签。品牌图明确不是成员海报。
- 官号遵循当前页面绑定及身份阻塞规则；Wiki 只取 `exact_page`。搜索页与未复核匹配不冒充精确 Wiki。
- 粉丝量保留公开显示文字、数值和 `profileObservedAt`。事务所记录显式标注粉丝属于事务所。缺失数字为 `null`，不能编造零。
- `sources` 保留公开主页、精确 Wiki、原清单、风格和图片参考，以及补充复核链接。日期仅在存在相应观察字段时填写。原清单证据日期可能是活动日期，不充当观察时间；编辑复核日期写进说明，不充当外部页面观察时间。
- **档案页必须显示来源的 `note`。** 其中保留 SugarHeart／neokoro 沿革、事务所粉丝范围、Lumina微光由用户确认而非官宣解散等关键语义；不能只显示来源链接。g303 与 g123 为两个不同档案。

只导出合同规定字段，禁止透传 UID 字段、坐标、候选证据、缓存、原始响应、采集收据或本机审计路径。公开账号链接可能自然包含账号数字，这不是另行导出内部 UID 字段。

## 查询接口

`model.ts` 导出合同类型与以下纯函数：

| 接口                                    | 行为                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `validateCatalog(input)`                | 验证完整字段形状、唯一 ID、日期、链接、图片路径和类型；错误时不给可用数据。合法空数组与损坏数据有区别。                 |
| `defaultCatalogFilters()`               | 存续、主要活动地区，文本／省／市／风格不限。                                                                            |
| `filterCatalogGroups(groups, filters)`  | 团名／官号／明确别名搜索，多个词取交集；省与市所有条件取并集，再与状态、文本、风格取交集。                              |
| `parseCatalogFilters(search, catalog)`  | q、status、regionRole、style 为单值；province、city 可重复。候选依所选地区角色校验，未知或超长参数返回 `ignored=true`。 |
| `serializeCatalogFilters(filters)`      | 返回无问号查询串；省市后缀归一、去重排序，默认值省略。                                                                  |
| `parseCatalogGroupLink(search, groups)` | 返回 none／invalid／valid；group 单值且必须属于索引。历史团体仍合法。                                                   |
| `normalizeRegionName(value)`            | 只归一同名省市常见后缀与自治区规范全称，禁止推断城市归属。                                                              |

文本搜索采用 NFKC 和大小写归一。原数据省市名称不会改写。省市混选以角色为准：例如“北京市省级条件或广州市城市条件”会纳入北京与广州，深圳不能因广州而混入。未知城市在不限结果中保留，具体城市筛选不匹配。

查询串最多 4096 字符，q 最多 200 字符；每类地区最多 64 项，每项最多 80 字符。非法或重复单值参数忽略并提示；不能将输入当 HTML 渲染。调用方用普通文本节点展示名字和说明，外链按页面统一的新窗口安全策略处理。

## 校验边界与维护

外链只允许 HTTP(S)，拒绝凭据、控制字符、反斜杠和无效编码。图片仅接受现有公开素材目录下的 jpg／jpeg／png／webp 普通文件；生成时检查每级路径与符号链接。验证索引形状不重新联网核验事实，也不判断版权授权。

增加团体时同步维护源清单的实际条数声明，不能通过删条目缩小索引。修改映射时新增对应反例测试，并将公共接口变更先交规划任务协调。正式生成物由集成任务唯一写入。

局部验证命令（站点目录执行）：

```powershell
node --test tests/catalog.test.mjs
node ../node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck src/catalog/model.ts src/catalog/runtime.ts
node ../node_modules/eslint/bin/eslint.js src/catalog/model.ts src/catalog/runtime.ts scripts/groupCatalog.mjs tests/catalog.test.mjs --max-warnings 0
node ../node_modules/prettier/bin/prettier.cjs src/catalog/model.ts src/catalog/runtime.ts scripts/groupCatalog.mjs tests/catalog.test.mjs docs/CATALOG.md --check
```

测试临时写入固定在阶段报告目录 `reports/w1/test-tmp`，不改正式 `site/assets`。十倍规模样本仅用于测试，不进入资料。模块测试不能代替集成构建、页面真实浏览器、静态发布包或线上业务验收。

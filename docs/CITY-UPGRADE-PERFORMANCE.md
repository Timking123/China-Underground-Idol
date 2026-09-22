# 性能与可抓取详情页

## 设计约束

1. 主题：沿用现有黑红资料档案，给从分享链接进入的观众先展示团体身份或活动安排。
2. 配色：继承 app.css 的 canvas / text / accent-hot；不引入另一套主题。
3. 字体：沿用 Bahnschrift Condensed 与中文系统字体，标题 26–42px、正文 16px、行高 1.65。
4. 组件：语义标题、定义列表、资料图、来源链接；焦点可见，来源直接可达。
5. 布局：桌面图文双栏、移动单栏；最大 1120px；空间采用 8/16/24/32px。
6. 层次：纯色深底配局部明度层次，避免无意义卡片网格。
7. 约束：不裁切海报正文、不编造阵容和开演时刻；日期已过不表示已举办；无图保留文字信息。
8. 响应式：760px 单栏，375px 无横向滚动，链接触达区域至少 40px。
9. 后续扩展：沿用现有 --radius-xs=4px、--accent-hot、--font-display；标题 tracking -0.022em，按压缩放仅沿用站点导航，减少动画时禁用。

视觉论点：黑红档案、真实资料图、醒目的身份标题。内容顺序：基本资料 → 相关活动 → 可核对来源 → 修订入口。交互只采用导航按压与焦点反馈，正文初次绘制无动画。

## C → F 接口

`scripts/prerender.mjs` 导出 `generatePrerender(root, { outputRoot = root, baseUrl = "https://idol.hi-veblen.com/" })`，返回 `{ files, counts }`。所有产物为精确相对路径；构建失败不进入发行。默认域名沿用现有文档，不代表已经部署。本轮生成 399 个团体详情、114 个活动详情、2 个静态索引，连同单页数据和 CSS 共 916 个文件。

| 路径                                       | 契约                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `groups/g[0-9]{3,8}.html`                  | 完整团体资料、原始来源、相关活动、独立元信息                                             |
| `events/e-[a-z0-9-]+.html`                 | 完整活动资料、核验层、来源、可靠导航与未知字段说明                                       |
| `groups/index.html`、`events/index.html`   | 所有详情的可抓取静态链接                                                                 |
| `assets/page-data/groups/g[0-9]{3,8}.json` | `idol-group-page-v1`，包含单团体原版 catalog 与相关原版 events dataset                   |
| `assets/page-data/catalog.json`            | `idol-catalog-v1`；保留全 ID、筛选字段及头像，列表投影省略 sources/styleNote/visual 内容 |
| `assets/prerender.css`                     | 从 `src/media/prerender.css` 复制，仅静态页使用                                          |

旧团体链接为 `group.html?group=g001`，详情页保留交互档案入口；旧页面未被此生成器覆盖。静态页保留原六项导航及城市、我的关注，更新动态和纠错在页脚。来源明细用原生 details 折叠，全文仍直接存在于 HTML。时间展示为中文 UTC+8，`time[datetime]` 保留原值。正文和图片在禁用 JavaScript 与发行目录的 file 模式仍可用。

`scripts/prerenderVerification.mjs` 直接编译 A 的 `src/events/verification.ts`；读取 `data/event-verifications.v1.json` 并严格核对主档快照，不接受失效确认或导航。缺失或非法核验数据阻断构建。未收录记录明确提示缺口。

静态页继续引用 `../assets/metrics.js`，沿用 DNT 与故障不影响阅读的行为。新路由客户端/后台计数白名单、根页面静态索引入口、公共清单与两级发布接入由 F/E 负责。

## 素材生成与校验

`node scripts/prepareMedia.mjs .` 仅用于素材更新，读取已审核 catalog 与本地活动海报，不下载素材。使用本机 Python 3.11、已有 Pillow 12.2.0；未新增依赖。WebP quality=80、method=6，EXIF 朝向归一，保留比例、不裁切、不放大，宽度上限 96/320/640。原图完整保留，详情提供“查看原图”入口。

- `assets/media-optimized/manifest.v1.json`：`idol-media-v1`，每张原图的 SHA-256、字节数、尺寸、来源 URL，以及每个变体的路径/尺寸/字节数/SHA-256。
- 变体严格路径：`assets/media-optimized/[a-f0-9]{20}-[0-9]+.webp`，命名包含原图内容哈希。
- `src/media/variants.json` 为浏览器精简映射，`responsiveImage(src, { kind: "avatar" | "card" | "detail", prefix? })` 返回 src/srcset/sizes/width/height。
- `validateMedia(root)` 返回 `{ files, manifest }`；无需 Python，校验普通路径、原图/变体哈希、声明尺寸和 WebP 容器，缺失/损坏立即失败。禁止符号链接和路径越界。

当前 661 张原图为 368,541,289 字节；去重后的 1,440 个 WebP 变体共 20,625,770 字节。后者包含多种尺寸全部之和，**不是一次页面下载体积**。完整清单另占 564,697 字节。构建不自动清理历史原图或旧变体；发布只按校验返回清单收录当前变体。

集成阶段实际遇到原 512,000,000 字节发行上限。C 与 F 协调后移除本轮新增的 341 个宽度超过 640px 的变体，共 25,359,566 字节；未放宽上限、未删除旧原图。精确清单保存在 `reports/city-upgrade-c/removed-large-variants.json`。DPR1 的两种实测视口原本均选择 640px，因此未改动其图片字节；高像素密度场景可通过原图入口读取更大素材，不声称维持所有密度下的相同清晰度。

## 按页数据

`loadCatalogPage()` 和 `loadGroupPage(groupId)` 位于 `src/media/pageData.ts`，接受可注入 fetcher 便于测试。它们校验 JSON 契约、单团体 ID 和活动关联，错误显式抛出；调用方不得把错误转为空列表。file 模式交互页面继续使用既有普通脚本降级。

在同一份数据下：旧 `groups-data.js` 为 891,753 字节 / gzip9 61,450 字节；轻量列表 JSON 为 301,622 / 32,638 字节；g001 单页 JSON 为 2,801 / 1,193 字节。它们的用途和字段集合不同，不把这些数字当成整体访问速度。

B 的交互档案仍需要全 ID 主档校验关注，因此保留原脚本路径；按页 API 已提供但不宣称全部交互页面完成拆分。新静态详情本身只请求当前页正文、CSS、当前图片和既有统计脚本。

## 同条件真实请求对比

测试命令：`PLAYWRIGHT_MODULE=<宿主已有 playwright/index.mjs> node tests/performance.browser.mjs`。脚本本地绑定 127.0.0.1 随机端口，完成即关闭，不产生持久服务。基线页面和脚本从 `817ed1c` 读取，不受当前其他任务的 UI 修改影响。对比 g001，Edge、375/1440×1000、DPR1、独立冷上下文、双方 DNT1、相同 gzip9、首屏不滚动。冻结初次加载请求后才进行全页截图与焦点检查，避免截图引发的临时布局/图片重选混入首屏统计。两种视口均请求 640px WebP，页面尺寸为 CSS 自适应，并非宣称图片始终以 640 CSS 像素显示。响应 body 不含 HTTP 头，不含外网时延，不推算并发。

| 页面（两种视口结果相同）     | 资源请求数 | 原始 body 字节 | 实际 gzip body 字节 | 离线计算 Brotli body 字节 |
| ---------------------------- | ---------: | -------------: | ------------------: | ------------------------: |
| 基线 `group.html?group=g001` |          8 |      3,708,696 |           2,692,174 |                 2,669,850 |
| 新 `groups/g001.html`        |          6 |        114,168 |              66,598 |                    63,675 |

两边均保留既有统计脚本；Brotli 仅作离线体积记录，不表示已配置服务器。F 负责发行 gzip sidecar 和构建 minify。本轮未改生产缓存、未部署 CDN 或服务器。

缓存建议仅供将来部署审阅：HTML/非哈希数据短缓存并再验证；内容哈希图片可长缓存；按 `Accept-Encoding` 协商时提供正确 `Vary`，清单与 sidecar 一起原子发布。仅路径哈希不能证明数据文件已不可变。

## 验证与证据

- `node --test tests/prerender.test.mjs`：9 项非空测试，覆盖抓取正文、独立元信息、旧链接、XSS、越界/换行路径、关联错误、损坏/缺失素材、图片比例、未知/零阵容及 UTC+8 跨日。
- 定向 ESLint、TypeScript strict、Prettier 检查通过；不替代 F 的全仓 verify/verify:console。
- 同一组定向测试在 `817ed1c` 的相关基础模块快照加 C 文件中独立执行，隔离 B/E/F 未完成代码；报告保留实际输出。
- 浏览器验证 375px/1440px 团体和活动页、可见焦点、无溢出、图片加载、减少动画、无页面异常、无 JS 正文/来源与原生 details、file 模式、未知详情 HTTP 404。
- 遍历全部静态 HTML，核对 9,958 条站内资源和导航引用，所有详情有非空标题与描述。统计脚本与查看原图链接包含在引用计数中。
- 证据目录：`reports/city-upgrade-c/`；请求逐项记录 `performance-browser.json`，隔离输出 `isolated-tests.txt`，桌面/手机截图 `prerender-*.png` 和 `event-no-js-*.png`。

C 不执行总构建、封包、提交、推送或部署；最终清单/发行包/新路由统计的端到端验证由 F 收敛。上述性能结论只对应明确记录的单个详情页与本机测试条件。

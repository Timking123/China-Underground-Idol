# 日历订阅与更新记录

本模块只从已校验公开资料构建静态文件，不采集、不推送、不部署。初次启用记录真实快照，`updates.entries=[]`；不把旧资料制造成历史动态。

## 公开接口与固定地址

- 页面：`subscriptions.html`、`updates.html`；入口 `src/subscriptions/page.ts`、`src/updates/page.ts`。
- 样式：`styles/subscriptions.css`、`styles/updates.css`，并复用 `app.css`、`styles/site.css`、B 的 `styles/preferences.css`。
- 状态源：`data/feed-state.v1.json`、`data/updates.v1.json`，首轮由 D 初始化，后续仅完整审核发行流程推进；访问请求、预览和普通 build 不修改它们。
- 静态目录：`feeds/v1/manifest.json` 显式列出每个 `path`；团体 `feeds/v1/groups/<gID>.ics`；城市 `feeds/v1/cities/<规范城市 UTF-8 小写十六进制>.ics`。目录与版本固定，名称修改不会更换团体地址。
- `generateFeeds(rootDir, { outputRoot = rootDir })` / `buildSubscriptionArtifacts({rootDir,outputRoot})` 返回 `{files,manifest}`。文件白名单只采用返回的精确路径，不能用递归通配公开目录。空范围也生成有效 VCALENDAR。
- 主域名沿用 `https://idol.hi-veblen.com/`；页面复制地址按当前 HTTP(S) 来源计算，本机预览链接保留本机端口。不以本机 HTTP 可读推断手机可订阅。

## 稳定修订与日历语义

同一事件始终为 `<event.id>@idol-events.local`，与既有手动导出兼容；跨城市和团体不另造 UID。`DTSTAMP`、`LAST-MODIFIED` 取该事件最后真实记录变化时间，`CREATED` 取首次入账时间，`SEQUENCE` 从 0 起仅在规范快照变化时加 1。重排对象键、改数据集总时间、重复构建、重复候选及失败核验尝试不推进版本。

取消/延期取正式主档：scheduled → CONFIRMED，cancelled → CANCELLED，postponed/unconfirmed → TENTATIVE。核验层合法且快照匹配才可进入构建，字段未核实仅作为说明。未知开演时刻用 DATE 值，明确「日期占位，不代表全天演出」；延期保留原收录日期为占位。未知结束不补时长，UTC+8 已知时刻转 UTC；不添加闹钟。遵循 [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) 的 CRLF、文本转义及 75 字节折行。

撤下主档记录保留 UID、最后已知安排与原状态，并明确「资料已撤下，非取消结论」；缺席不生成取消。更换城市或阵容后保留曾经归属的订阅范围，让旧订阅也能接到修订。历史记录不按构建当天滑动删除。

## 纯候选生成与完整审核接入

`scripts/generateSubscriptions.mjs` 的同步函数：

```js
const { state, history } = createFeedRevision({
  events: nextEventDataset,
  verification: nextValidatedVerificationDataset,
  previousState,
  previousUpdates,
  recordedAt: actualReviewTimeInUTC,
  reason: "依据本次已核验来源修订开演时刻",
});
validateFeedLedger(state, history);
```

调用方先通过严格活动校验及 A 的 `validateEventVerificationDataset(input, events.events)`。旧活动从 previousState 的快照取得；所有输入来自同一待审核公开版本。没有历史时 previousState/previousUpdates 均为 null，仅形成初始基线。记录 `reason` 由审核流程提供，不得把例句当作真实核验说明。

文件入口 `prepareFeedRevision({rootDir,outputRoot,recordedAt,reason,bootstrap:false})` 读取完整待审核主表、A 补充层及旧 D 基线，校验后仅向独立 outputRoot 写两份候选源与最后的 `feed-candidate.json` 完成标记；`--bootstrap` 仅用于两份旧源都不存在的初次启用。`verifyFeedCandidate({rootDir,candidateRoot})` 对照输入、旧源、输出 SHA-256，并重新运行纯生成核对候选。来源观察时间与记录时间分别保存；更新逐字段差异可逆回放到对应前后哈希。

审核/发布边界：E 的候选不直接写 D 文件；F 在同一个隔离快照依次应用主档、重验或移除失效 A 核验、调用 D 纯函数、总构建、两级白名单校验，最后用一个完整版本标识与完成回执发布。任一步失败不采用任一局部源。重放同一候选不加序号；候选基线变化必须重做。D 文件生成器不自行执行发布切换。

普通生成 `node scripts/generateSubscriptions.mjs --output reports/city-upgrade-d/generated`；若主档或核验语义与已采用 D 状态不一致则构建报错，须经上述候选步骤推进，不提供隐式刷新开关。

## 更新记录与关注筛选

当前记录范围是活动主档及有实质内容的字段核验变化，未覆盖团体其他档案修订。每条包含 eventId、前后哈希、字段前后值、实际记录时间、审核原因、公开关联来源、修订号及前后范围并集。来源链接不是所有字段的自动证据，页面保留原因与差异供核对。全新启用为空；加载失败与零记录用不同状态。

复用 B `getPreferences().read()/subscribe()`，按 group/city/event 匹配；关注只存浏览器，订阅与筛选均不上传。存储损坏/禁用提示由 B `storageMessage()` 提供。更新默认显示 20 条，逐批展开；字段和来源用 DOM textContent，外链限 HTTP(S)。

## 两页视觉约定

1. 主题：沿用近黑底、红色信号的现场资料档案；订阅是实用操作面，动态是可追溯列表。
2. 色彩：canvas/surface/text/accent 全用现有 app.css 变量；强调色只表达操作和类别，不单独传达取消。
3. 字体：沿用现有窄体标题栈与思源黑体正文；标题 30–48px，正文 14–16px，日期用等宽数字。
4. 组件：原生 CSS 唯一策略；按钮 4px 圆角、44px 高；订阅结果 8px 圆角；加载、空、错误和复制降级均可见。
5. 布局：桌面选择/结果两列，动态时间/内容两列；每个区域只有一个操作目标。
6. 层次：依靠既有表面明度差，不添加玻璃、装饰渐变或营销卡片。
7. 约束：真实空态，不造热闹；不承诺即时刷新；内容通过 textContent 显示；下载与网址订阅说明分别可见。
8. 响应式：680px 以下单列；375px 保留完整地址输入、操作与文本；减少动画时取消按压变换。
9. 组件提示：按钮使用 var(--surface-3)、var(--line-strong)、4px 圆角、16px 横向内边距；字段差异块用 var(--surface-2)、14px/600 标签和13px/1.8 正文；主标题48px、-0.022em、var(--text)。交互采用120ms按压缩放、选中反馈和原生details展开，无加载动画。

无占位演出或动态需替换。新增真实资料须先完成来源核验与完整候选流程。

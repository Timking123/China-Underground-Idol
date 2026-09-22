# 活动数据与领域接口

接口签名已于 2026-09-05 冻结，可供页面与集成任务依赖。

## 导出契约

```ts
type EventStatus = "scheduled" | "postponed" | "cancelled" | "unconfirmed";
type EventTemporalState = "past" | "today" | "upcoming";
interface EventSource {
  url: string;
  label: string;
  publisher: string;
  observedAt: string;
  kind:
    "official" | "organizer" | "venue" | "wiki" | "aggregator" | "ticketing";
}
interface EventRecord {
  id: string;
  title: string;
  date: string;
  province: string | null;
  city: string | null;
  venue: string | null;
  address: string | null;
  opensAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: EventStatus;
  performers: { groupId: string | null; name: string }[];
  sources: EventSource[];
  notes: string;
  poster: { src: string; alt: string; sourceUrl: string } | null;
}
interface EventDataset {
  schemaVersion: "idol-events-v1";
  updatedAt: string;
  coverage: "partial";
  events: EventRecord[];
}
interface EventFilters {
  q?: string;
  from?: string;
  to?: string;
  group?: string;
  province?: readonly string[];
  city?: readonly string[];
}
interface EventValidationError {
  path: string;
  message: string;
}
type EventValidationResult =
  | { valid: true; data: EventDataset; errors: [] }
  | { valid: false; errors: EventValidationError[] };

function validateEventDataset(
  input: unknown,
  knownGroupIds: Iterable<string>,
): EventValidationResult;
function filterEvents(
  events: readonly EventRecord[],
  filters: EventFilters,
): EventRecord[];
function getEventTemporalState(
  event: Pick<EventRecord, "date">,
  now: Date,
): EventTemporalState;
function buildCalendarIcs(
  events: readonly EventRecord[],
  generatedAt: Date,
): string;
```

筛选字段使用与 URL 参数相同的单数 `province`、`city`，值为数组；不使用 `provinces`、`cities` 或 `groupId` 别名。日期为含首尾的闭区间；省市混选取并集，再与其余条件取交集。返回新数组并保留输入顺序，页面可独立排序。空字符串与空数组不限制筛选。无效日期或倒置区间返回空数组；页面负责向用户解释 URL 参数问题。

`getEventTemporalState` 只比较 UTC+8 当地日期，过去日期不表示活动已实际举办。取消、延期等状态由 `event.status` 独立表达，不覆盖时间状态。无效日期或无效 `Date` 抛出 `RangeError`。

数据必须先用当前完整团体 ID 集合校验，失败时显示数据错误，不能把失败解释为零活动。校验错误包含路径，不修正或丢弃单条记录。空 `events` 是有效数据，未知字段拒绝，防止误带私有字段。`updatedAt` 与 `observedAt` 必须包含明确时区；未知的可空字段必须显式填写 `null`。

ICS 接受已校验的活动。它额外检查结构、重复 ID、URL 与日期，失败抛出 `TypeError`；无法再次核实团体主档身份，调用方仍须先运行数据校验。输出为 CRLF 文本，适合以 `text/calendar;charset=utf-8` 保存。稳定 UID 由活动 ID 构成，固定 `generatedAt` 时输出确定。无确认开演时间时使用全天事件；有时间时将 UTC+8 转为 UTC；结束时间未知时省略 `DTEND`。跨日结束不能用本契约表示，必须留空并在备注说明。取消使用 `STATUS:CANCELLED`，延期与未确认使用 `STATUS:TENTATIVE` 并在摘要、正文明确标记；手动导入不能保证覆盖既有日历条目，不是自动订阅。

文本由页面使用 `textContent` 展示；校验成功不授权 HTML 插入。来源仅允许绝对 HTTP(S) URL，拒绝凭据、空白、控制字符和反斜杠。海报只有可靠来源和使用依据时才可填写。远程 `src` 保留安全 HTTP(S) 规则；本地只接受 `assets/event-posters/` 下的小写安全文件名及 PNG/JPEG/WebP 扩展名，路径由导出的 `isLocalEventPosterPath(value)` 统一判断。构建、预览、打包还检查文件存在、普通文件、所有层级无符号链接、图片签名及基本容器，且只导出被正式活动引用的文件。校验不证明素材使用权，仍须人工核验。完整命名规则与更新步骤见 UPDATING.md。

ICS 实现依据 [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)：文本转义、UTF-8 每物理行最多 75 字节、全天事件及 UTC 时间。所有备注和来源信息均作为文本处理，不能形成额外日历属性。

## 首批来源与编辑边界

首批五条活动取自 2026-09-03 已归档的官号预告，编辑日期为 2026-09-05。各来源保留实际观察时间，不以编辑时间覆盖证据时间。未实时核验取消、延期或阵容变化；列表不是全国完整日程，也不是已举办证明。

| 日期       | 活动                                            | 已核实信息与保留缺口                                                     |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| 2026-09-05 | 偶像回响 Idol Echo Live Vol.31 · 小丸mori生诞祭 | TakeBlue 官号确认日期、场地及本团出演；整场开演时刻和省市留空            |
| 2026-09-06 | SIN RETORNO 世界树剧场演出                      | 官号确认日期、场地及本团出演；标题为编辑描述，正式活动名和整场时刻未确认 |
| 2026-09-06 | 紫禁之巅 Vol.2 —— 京门第一                      | 两个出演团体官号交叉确认日期、场地、北京地址；阵容仅部分收录             |
| 2026-09-13 | MOGUMOGU生长计划4 · RED²红色的二次方            | 绯色苏打官号确认日期、入场及开演时间；地点和 MOGUMOGU 身份绑定未核实     |
| 2026-09-15 | Meguri-Kaado Last one-man                       | 公开邀请转发给出日期、入场、开演及场地；主团未绑定，地址异写不猜填       |

首批正式记录的 `sources` 含可访问格式的原帖 URL、发布者、来源种类和观察时间。原始响应与逐字段核验收据仅留私有研究目录，不放入公开仓库。活动正文采用简要事实转述，移除了票价、销售引导、订单与客服信息；首批没有可靠使用依据的海报全部为 `null`。这些是首批快照特征，不约束后续合法活动数量、来源平台或海报采用。

部分归档正文被上游截短。只使用已出现且完整的日期、时刻、场地片段，不补全截断内容。团体出演时段不能当作全场开演/结束时间；当前两条定时活动有明确 OPEN/START 或入场/开场信息，其余三条按全天导出。

## 2026-09-08 近期活动补核

本次仍为五条部分日程，没有新增活动。前三条历史记录逐字段保留，所有旧来源及其观察时间保持不变。新增三条公开来源实际观察于 2026-09-08 08:33:36 UTC；数据编辑时间单独记录于 `updatedAt`。

- 9 月 13 日：依据[绯色苏打 8 月 12 日预告](https://www.sina.cn/news/detail/5331060167541520.html)，活动名称、组合和日期相符，补充省区“内蒙古”、城市“呼和浩特”。具体场馆、地址仍为空，MOGUMOGU 不做同名身份绑定。
- 9 月 15 日：补充 [Meguri-Kaado 原预告](https://www.sina.cn/news/detail/5338725122835985.html)，其日期、入场、开演及场馆与原转发一致。结合 [TrueWorld 另一场次的场馆资料](https://www.sina.cn/news/detail/5334341322280544.html)中的同场馆、区、院号、楼层，交叉确认城市北京；后者不是本场排期依据。街名异写未解决，完整地址保持为空，主团身份绑定保持为空。

新浪公开页保留原发布者归属，来源种类表示原发布者角色，不表示新浪是活动主办。页面“发布于”地区未作为演出城市依据。海报均为空，未增加推测阵容。补核的是历史预告，不能证明截至查询时仍照常举行，也没有证明过去活动已举办。搜索摘要与未完整打开的票务页面没有作为正式字段依据。

## 验证

在 Node.js 22.14.0 或支持类型擦除的新版本上运行：

```sh
node --experimental-strip-types --test tests/eventsModel.test.mjs
```

首批证据特征使用固定 `tests/fixtures/events-seed-20260905.json`；其他合成记录仅在内存或 `.build` 临时测试目录使用，不写入正式数据。正式门拒绝 `e-test-`、`e-fixture-`、`e-summary-` 等测试保留 ID，以及 example.com/net/org、.test、.invalid、localhost 示例来源。该检查不能替代证据复核。测试覆盖持续数据维护、主档 ID、非法/重复 ID、来源 URL、日期、稀疏数组、混合省市筛选、跨系统时区、取消延期、全天/定时导出、UTF-8 折行及 CRLF 注入。统一构建、ESLint 与 TypeScript strict 配置由站点集成维护。

## 独立活动核验层

`data/event-verifications.v1.json` 使用 `idol-event-verifications-v1`，通过稳定 `eventId` 关联。旧活动字段、稳定 ID 与 ICS 语义保持不变。完整类型和纯函数见 `src/events/verification.ts`。

根字段为 `schemaVersion / updatedAt / coverage / records`。记录固定包含 `eventId / snapshot / checkedAt / verifiedAt / outcome / summary / fields / evidence / changes`，未知字段一律拒绝。

- `checkedAt` 是实际尝试检查时间，读取失败也保留；`verifiedAt` 是最近一条成功确认字段的原文观察时间，无确认字段时为 null。不能用本次编辑时间覆盖原有来源时间。
- `outcome` 为 `unverified / partial / verified`，分别显示尚未核实、部分信息已核验、核心安排已核验。核心安排要求日期、举行安排、场馆、整场开演四项均有一手原文，不表示整场所有信息已知或实时保证。
- `fields` 固定包含 `date / status / venue / address / opensAt / startsAt / endsAt`。状态为 `unverified / unannounced / verified`。空值默认为尚未核实；原文明示还未公布才允许 unannounced，不能把无法访问或没有搜索到解释为未公布。
- `evidence` 固定包含 `url / publisher / role / observedAt / result / fields / note`。角色沿用主档来源枚举；`result` 为 `read / unavailable / insufficient`。确认字段需要已回读的主办、团体、场馆或票务原文，且主档保留同一 URL、发布者和角色。汇总与百科仅为线索。新浪页面角色归属于原发布者，页面本身不被误标为主办。
- `changes` 固定包含 `field / previous / current / observedAt / sourceUrl / reason`。只记录七项核验字段的实际值变化，当前值必须等于主档，来源必须已读取并支持该字段，观察时间须与证据一致。检索/编辑本身不是活动变化。

`snapshot` 固定保存 `title / city / province / date / status / venue / address / opensAt / startsAt / endsAt`。`validateEventVerificationDataset(input, events)` 检查当前主档快照、严格形状、时间顺序、稳定 ID、来源与变化关系；成功返回 `{ valid: true, data, errors: [] }`，失败返回带字段路径的错误。核验不是阵容身份验证，不自动绑定同名团体。

`eventVerificationSnapshot(event)` 创建快照；`getEventVerification(dataset, eventId)` 读取记录；`eventFieldLabel(event, record, field)` 生成字段缺口文案；`buildVenueNavigationUrl(event, record)` 仅在快照相符、城市/场馆/地址齐全且场馆和地址均已核验时返回地图查询 URL，不猜坐标。取消与延期记录不沿用旧导航。

`invalidateEventVerifications(dataset, previousEvents, nextEvents)` 对主档变化或移除的记录保守整条失效，其余原样保留，不伪造核验时间。旧证据由发布版本快照保存。发布候选必须联合校验主档、核验补充层与订阅/更新状态后原子交付；不能先覆盖主档再把旧确认贴到新资料。补充层校验失败应阻止新发行；浏览器降级为主档浏览，明确提示核验资料不可用，关闭确认标记与地图导航。

活动页沿用暗色日程列表，近期筛选优先显示可用性。核验口径默认折叠，检查结果、计划状态和核心时刻保持可见；细节包含来源角色、原观察时间、实际检查时间和真实变更。关注交由 `src/preferences/browser.ts` 的共享按钮接口，重新渲染前退订上一次订阅，不上传个人关注。

### 2026-09-19 补核范围

114 条基线中，9 月 19 日起共 45 条未来线索，至 9 月 25 日的未来 7 天为 27 条。全部逐条尝试来源；其中 9 条取得可补充的主办/团体原文（3 条核心安排、6 条部分信息），其余 36 条保留来源缺口。新增 3 条明确整场开演和 4 条可靠地址；未增加活动数、未自动绑定阵容。逐条结论及访问收据在 `reports/city-upgrade-a/EVENT-REVIEW.md`。

RagnaRock、她吃了那朵花·贰拾贰、真夜中 Drift 使用原文明示的整场入场/开演。光年、星遇现场、Summer Fes、暮云声彻、YUMEFES 的团体出演时段未用作整场 START。Pri-Mary 的自身出演变化不等于光年整场取消。没有可靠取消/延期新原文不表示所有活动确定照常举行。

定向验证：

```sh
node --experimental-strip-types --test tests/eventVerification.test.mjs tests/eventsModel.test.mjs tests/eventsPage.test.mjs tests/eventNavigation.test.mjs
node tests/eventVerification.browser.mjs
```

浏览器测试使用宿主已有 Playwright，可通过 `PLAYWRIGHT_MODULE` 指定已安装模块；临时编译、截图和测试回执只写 `reports/city-upgrade-a/`，仅绑定 127.0.0.1，结束关闭临时服务，不改共享 assets。总构建、发布白名单与本地发行验收由集成任务执行。

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
  kind: "official" | "organizer" | "venue" | "wiki";
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

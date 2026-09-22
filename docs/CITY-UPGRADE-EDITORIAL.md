# 投稿修订与受限候选接口

本地实施，管理服务没有 release 写权限。沿用加密 SQLite、管理员会话、Origin/CSRF、审计和维护锁；不增加采集或通知。

## 接入约定（E → F）

- 本期结构化修订限定为活动（规划已确认）：固定文件 `data/events.v1.json`，稳定 event ID；只修改 title/date/province/city/venue/address/opensAt/startsAt/endsAt/status/notes，不允许删除、新增身份、路径、阵容和任意对象。团体投稿保留原反馈审核处理，不用任意 JSON 补丁覆盖多来源派生展示层。
- `src/admin/editorial-contracts.ts` 定义候选与回执；`maintenance/console/editorial.ts` 负责校验、字段差异与状态流转，并导出无磁盘写入的 `prepareEditorialCandidate(candidate, baselineBytes, now)`，供维护适配器重复验证。
- 候选 `idol-editorial-candidate-v1`：candidateId、revisionId、revisionVersion、feedbackId、baselineSha256、target `{kind:"event",id}`、patch、evidence、rationale、reviewedBy、reviewedAt。证据含 captureId（既有维护证据编号）、url、label、publisher、kind、observedAt、excerpt、supports。候选不含投稿联系信息、IP、内部处理意见或数据库密钥。
- 后台审核只表示人工核对；F 的接入必须把 captureId 对应到维护侧真实 SourceCapture/来源注册表，调用既有 `prepareEventUpdate` 复核摘录、字段支持及来源。不能从候选中声称的摘录生成可信 capture。
- F 在维护锁内获取候选、复核当前候选未撤回及原字节 SHA、准备并应用、经原构建/两级白名单/发布回执完成本地模拟。E 提供 `POST editorial/:id/handoff` 返回候选；此动作只标为“已交付待维护”，不标为发布。
- 回执由维护侧通过受信任的本地模块 `recordEditorialReceipt(store, revisionId, receipt, actor, now)` 写入加密库（无浏览器自报成功接口）。回执 `idol-editorial-receipt-v1` 绑定 candidateId、candidateSha256、baselineSha256、resultSha256、snapshotManifestSha256、status（applied/rejected/withdrawn）、runId、publicationId、message、completedAt。成功后后台只读回显回执；applied 须有真实发布标识和完整快照 SHA，不能用按钮伪造。
- 撤回：审核/交付后均可提出撤回；未交付直接 withdrawn；已交付为 withdrawal_requested，维护侧核查后回执确认，不能宣称逆转已发布内容。已应用需要新修订。

界面优先展示来源标题、公开链接、真实观察时间、原文摘录及所支持字段。captureId 位于折叠的维护归档关联区，可留空保存待核验；缺少受信归档关联时不能审核通过。填写编号仅提供关联，维护侧仍须独立读取原文、注册来源及摘录证明。

## 维护侧签名与一致性

- `prepareEditorialCandidate(value, baselineBytes, now)` 返回 `{ candidate, candidateSha256, event, diff }`；无磁盘写入。时间参数为毫秒。维护侧另以权威团体 ID、独立 SourceCapture 和来源注册表调用 `prepareEventUpdate`，不从候选伪造归档。
- `encodeEditorialCandidate(candidate)` 定义唯一候选字节格式：2 空格缩进 JSON + 末尾 LF；哈希均对该结果计算。
- `getEditorialHandoff(store, revisionId)` 返回 `{ candidate, candidateSha256 }`；非 handed_off 状态拒绝，包括已请求撤回。维护侧在锁内取候选，并在不可逆提交点前再次核对。
- `recordEditorialReceipt` 同一回执重放幂等，不同结果拒绝覆盖。先交付后撤回的竞态不得隐藏；若维护已越过提交点，真实 applied 回执优先且保留撤回历史。没有完整成功快照时保持待维护或记录 rejected。
- 普通编辑、审核和交付历史最多 100 条；撤回有单独的一条保留名额，维护最终回执再占一条，总历史至多 102 条。重复撤回或结果重放不能增长历史，达到编辑上限不能阻止必要撤回。
- F 在隔离候选中联动活动主档、A 核验快照失效处理、D feed-state/updates 生成、公开构建和两级白名单校验，所有文件由单一完成清单绑定，回执中的 `snapshotManifestSha256` 绑定该清单。E 不分别写这些公开文件。
- 合成 fixture：`maintenance/console/tests/editorial-fixture.mjs` 的 `createEditorialFixture(directory,password)` 返回 store/key/site/feedback/input；目录必须是调用者独占临时目录。它没有生成可信 SourceCapture，维护证据验证仍由 F 提供。

## 本地公开资源边界

控制台预览消费 F 的 `scripts/publicArtifacts.mjs` 清单校验器。动态详情、缩略图、按页数据和日历须同时匹配生成路径、实际清单及文件字节 SHA/长度；不按目录通配公开。统计新增四个固定页及清单内团体/活动详情和索引；私有路径不能记录。ICS 返回 `text/calendar`。

HTTP 统一前缀 `/api/v1/admin`：`GET editorial/baseline`（当前活动、哈希、字段白名单）、`GET editorial?page=1`、`POST editorial`、`GET editorial/:id`、`PATCH editorial/:id`、`POST editorial/:id/review`、`POST editorial/:id/handoff`、`POST editorial/:id/withdraw`。写入带 requestId 和 expectedVersion；同键同载荷重放原结果，不同载荷 409；每次审核/交付重读基线，漂移 409，编辑后重新审核。

## 界面方向

视觉：沿用近黑、暖灰、红色信号的原生 CSS 工作台及 4/8/12px 圆角，差异前后对照为核心工作面。

内容：投稿详情 → 选择稳定活动 → 结构化字段与证据 → 差异预览 → 审核 → 候选交付 → 维护回执。加载、空、失败、基线变化与撤回均有明确状态。

交互：沿用按钮按压 0.96、详情轻淡入和保存后就地提示；减少动画时关闭过渡。全键盘、375px 单列差异、1440px 双列差异。

## 验证计划

合成活动、投稿、密钥与 SourceCapture；真实 HTTP 验证鉴权/CSRF、未知字段/ID、证据覆盖、幂等、版本/基线冲突、状态流转、回执绑定与加密。浏览器验证投稿到候选、错误保留输入、键盘与两种宽度。F 负责维护发布端闭环及全仓验收，E 提交精确模块接口与针对性结果。

针对性命令：`node --experimental-strip-types --test maintenance/console/tests/editorial.test.mjs`；浏览器命令：`node --experimental-strip-types maintenance/console/ui-tests/editorial.mjs`（`PLAYWRIGHT_MODULE` 指向宿主已装 Playwright）。浏览器脚本自行编译到 E reports 目录，不写全局资产。验收记录及截图位于 `reports/city-upgrade-e/`；完整维护发布结果由 F 报告，合成模块回执测试不能替代该门。

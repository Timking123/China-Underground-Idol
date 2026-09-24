# 本次服务器迁移操作说明

本目录只服务 2026-09-23 的本站迁移。B 批交付本地工具、候选准备和合成验证；下述安装、备份、传输、服务变更及 DNS 操作均须由 CTO 的 C 批具体授权执行。本批未做这些生产操作。已完成的 P 动作仅停止并禁用旧机 health timer，旧站与后台仍运行。

## C4 新机运行入口与权限边界

128 上的 `/srv/china-underground-idol/maintenance` 已由 root 持有、权限 0755。旧 `maintenance/bootstrap-server.sh` 要求这个 BASE 由 `idol-maint` 持有且为 0700，还会在 `vendor` 内运行 npm 安装和浏览器下载；它不适用于当前新机布局，不能作为重复安装入口。

新机安装应从已验包在 root 私有目录重建 `vendor`，逐成员核路径、类型、哈希及六个链接；在维护暂停、无本站服务账户进程和未决锁时保全原槽，再接入 root 持有且服务账户不可改的最终 `maintenance/vendor`。最终槽的父目录也不能由服务账户替换。维护 unit 以 `ReadOnlyPaths` 进一步限制该目录；`APPDATA` 下的 npm 查找链接与 `PLAYWRIGHT_BROWSERS_PATH` 仍须在服务身份下可读，以原离线 DOM 探针复验。依赖更新使用新的 root 私有验真代，不由旧 bootstrap 在运行槽内更新。

`maintenance/workspace` 已有空的 `private` 骨架，物化器不会覆盖非空根。先保全该骨架及权限，再核独占新代的两个来源 marker 和 `sourceSha256`，按受控换代接入固定路径。root 物化默认生成 0600 源码和 marker；应只把程序文件调整为服务可读、不可写，把确证的状态、缓存、日志和工作站点副本留给 `idol-maint` 写入。以真实服务身份测试源码和 marker 可读、许可目录可写、vendor 创建或替换失败；不得递归移交整个 BASE。旧私有数据只在最终同代恢复窗口写入确证目标，不用历史源码覆盖新 guard。

固定 `maintenance/repo` 必须是真实 Git 工作树，而非仅有相同文件的目录。维护 `publisher.ts` 要求 `main`、干净工作树、`fetch origin main` 后远端前像等于本地 HEAD，随后才会更新输入、构建、浏览器验证、提交和推送。准备真实仓库时先测标准 Git bundle 或受权 clone 的实际字节与来源，复用已验站点资产；远端推送由本批唯一 Git 集成者在差异审查后执行。维护 worker 需写 repo 的 Git 对象、构建输出和受控输入，也需写 `maintenance/state` 与工作区运行数据；root `publish.py` 需写 `releases`、`maintenance-receipts`、`deployments` 及站点根的原子 `current` 切换。因此 unit 保留这些现有写入挂载，只针对 vendor 加只读保护；文件系统上的程序树归属仍是独立安全门。C4 的暂停入口核验不等于启用维护或正式发布。

## 先确认的条件

- 旧机可用空间约 548 MB，不能在旧机生成全部历史归档。最终快照工具会估算固定数据库/账本集合，并保留至少 128 MiB 余量；空间不足会在创建包前停止。不要通过删除 verification、vendor 或备份来腾空间。
- 新机 Ubuntu 26.04、4 CPU、约 64 GB 可用磁盘；尚未安装 Node/Nginx。固定锁文件不变，Node 必须满足仓库要求并验证原生依赖兼容；旧机实载 22.23.2，B 的 Windows 测试为 22.14.0，隔离 Linux 启动测试为 22.23.1，不能把这些测试写成新机已验。
- DNS 权威 A 仍指向旧机、TTL 600，没有 AAAA/CNAME。DNS 账户控制权、执行者、云防火墙 80/443 和外部访问仍须 C 核对。所有后台继续只绑定回环，禁止公网开放 8788。
- 当前后台密钥和数据库必须配套。任何阶段都不得运行 `init`、生成替代 master.key、刷新账户或把数据库转为业务明文 JSON。后台原到期时间和限流时间随数据库原样保留；应用启动后依法定保留策略清理自然到期记录是另一件事，不能通过迁移延寿。

## 固定迁移集合

字节数来自阶段 A 元数据采样，属于旧机当前集合而非精简后的传输包。未知子集要在 C 的只读现场补证后封口，不按目录名判为可删除。表中所有私有数据都留在非公开路径。

| 类别 | 旧路径与已知字节 | 目标/权限 | 脱敏核验 |
| --- | --- | --- | --- |
| 运行必需 | `/var/lib/idol-console/console.sqlite` 61,440 B；WAL 采样 0、SHM 32,768 B | 同路径；目录 0700、文件 0600，目标 `idol-console` 实际 UID/GID | SQLite backup、完整性、原 key-check/账户、所有加密 bucket/visit 可解密；不输出载荷 |
| 运行必需，独立通道 | `/etc/idol-console/master.key` 32 B | 同路径；目录 0700、文件 0600，仅 `idol-console`/root | 密钥永不放入快照或公共包；单独受限 SSH 通道传送，以数据库解密成功确认配对，不打印内容 |
| 运行必需 | console 程序/geo 合计 49,229,824 B | 完整新 console 发行目录及 `/srv/china-underground-idol/console/geo`；程序 root 持有，目录 0755/文件 0644；geo 仅服务所需读权限 | 现有 console manifest/verify-release.py；地区库及许可单列，子集大小 C 补证 |
| 运行必需 | `maintenance/state` 36,589,568 B | 同路径；目录 0700、文件 0600，目标 `idol-maint` | 与最终 DB 同代，含通知去重、运行回执、浏览器状态；固定集合哈希 |
| 运行必需 | workspace 内 `private/store`、`private/weekly-runtime`、`private/weekly-application-v2`；可缺的 `private/provider-price` | 原相对路径，0700/0600，目标 `idol-maint` | 本次真实消费者已核对；准确大小/是否缺失 C 补证。前三者缺失即停止，price 缺失必须在同代包明确记录 |
| 运行必需 | `/etc/china-underground-idol/maintenance.env`、运行账户必要配置、证书 live/archive/renewal | 原私有目标；不和公共源码混包 | 仅受限通道与权限/配置引用核验；不打印环境变量、私钥或 cookie |
| 运行必需 | 本站 Nginx server/snippet、默认拒绝/隐私配置、tmpfiles、systemd unit、root 发布助手/supervisor | 本站精确目标；root 管理；新暂停文件 root:root 0644，父目录 root 管理且业务账户不可写 | `nginx -t`、systemd 配置、固定路径/只读守卫；不替换 hi-veblen.com/lingxi 其他站点 |
| 可回退版本 | 旧 public current=`releases/console-20260918-817ed1c210c8`，旧 manifest=`9cd4ed5c…`；releases 全集合 7,492,370,432 B | 保留选定旧发行版与新完整候选；current 只切一次完整 release | 旧/新完整清单和现有 TS/Python 双验；其余历史不自动传送或删除 |
| 可回退版本 | 旧 console current=`releases/console-20260918-718627e8f5b6`、原 service/Nginx 配置及 DB 最终包 | 私有回退保全目录，目标账户映射另验 | 回退包明确同代；新机接受写入后不能直接恢复旧 DB |
| 单独保全历史证据 | maintenance 总 17,697,349,632 B；verification 10,940,620,800，backups 1,854,136,320，verification-c 1,197,555,712，vendor 711,086,080，source-verify-c 475,852,800；repo 1,479,864,320，workspace 762,519,552 | C 另选有容量的私有保全位置，不覆盖运行集合 | 顶层元数据已采样；未知内容/子集/大小保持待补证，不把未知当缓存。repo 代码与私有账本分别恢复 |

完整数值与证据索引见 C 工作窗口 `outputs/迁移阶段A预检-20260923.md`。geo、账号依赖和未知工作区文件不由快照包装猜测迁移，C 必须按上述三类完成实际清单并保全，不能据本工具的固定账本集合删除其余文件。

## 安装核验工具与持久暂停

1. 本地经本批验收后运行 `node scripts/packageMigration.mjs`，得到 `.build/migration` 中 `verify-store.mjs`、`snapshot.py`、`verify-release.py` 和 SHA manifest。程序是静态打包的新只读核验器，不依赖旧机 817 后台不存在的子命令，也不需替换旧在线 current。
2. C 将此精确包安装到**此前不存在**的 `/root/idol-migration-tools-20260923`，root:root、目录 0700、文件 0600；从规划冻结记录独立比对所有 SHA 后才执行。不得覆盖已有未知事务。工具每次核验数据库前复核包内哈希；CLI 只接受该固定安装路径。
3. 原 master.key 保留在独立私有目录，由原服务账户持有，核验器以 root 只读读取；新机的 key 走另一受限通道，禁止混入数据库包、命令行参数值、日志或 Git。
4. 安装 `maintenance-control.json` 到 `/etc/china-underground-idol/maintenance-control.json`。必须是 root 的普通独占文件、不可被业务账户替换；父目录 root 管理且非组/其他可写，文件可读不含秘密。本批值始终 `paused`。现有 `maintenance.env` 仍维持私有权限。
5. 同次维护工具安装必须包含更新后的 runner/control/CLI/publisher/receipt、supervisor 和 root publish.py。缺失/损坏暂停文件默认拒绝写入；health、service-failure 只报告暂停状态，不创建状态目录、不联网、不通知。日/周/health timer 保持 disabled；不因本批具备候选准备而启用周期四源自动更新。

以下是 C 允许后执行的固定入口，`<包名>` 只取审核后的唯一新目录名；`<代号>` 必须取对应 snapshot.json 的 generation，不得跨包拼接：

```sh
python3 -I /root/idol-migration-tools-20260923/snapshot.py snapshot \
  --phase initial --origin old --package /var/lib/idol-migration/<初始包名>
```

父目录 `/var/lib/idol-migration` 需先以 root:root 0700 建立。初始包通过 SQLite backup 包含已提交 WAL，适合提前传输和演练，明确 `restorable=false`，不能用于正式切换。

## 隔离恢复预演与归属交接

1. C 将通过验收的新 console **完整固定发行包**安装到 `/var/lib/idol-migration/console-candidate`，root 持有、目录 0755、文件 0644；父迁移目录仍 0700。创建 `/var/lib/idol-migration-rehearsals` 为 root:root 0711。演练结果子目录使用唯一 generation，存在即停止。
2. 读取本批 console manifest 的精确 SHA，执行：

```sh
python3 -I /root/idol-migration-tools-20260923/snapshot.py rehearse \
  --package /var/lib/idol-migration/<初始包名> --generation <代号> \
  --console-manifest-sha256 <已验console清单SHA>
```

3. 外层用 `unshare --mount --net --propagation private` 同时创建私有挂载与无外部网卡的网络命名空间，只在该挂载命名空间内重挂 sysfs、启用 lo；这使 Ubuntu 26.04 上的 `/sys/class/net` 反映隔离后的网卡集合，不改变宿主挂载或网络。启动命令和内部 worker 均要求只见 lo，拒绝直接在普通宿主网络运行。`18788` 仅存在于该隔离命名空间，不配置 Nginx、DNS 或公网路由。任一命名空间、重挂或仅 lo 检查失败即停止并保全现场，不能降级成公开监听。
4. 演练先复核原包与发行包，复制 DB 到严格隔离目标，只移交这份新树给实际 `idol-console` UID/GID；以该身份启动真实新服务，读取管理页 200 与未登录边界 401，正常关闭，确认监听消失且原包哈希不变。受控测试使用说明文档地址作为代理头，不产生真实访客数据。不会读取或记录业务列表、不会重置密码、不会续期已有会话。
5. 结果为 `rehearsed-offline`，范围明确 `database-only-rehearsal`；它不是正式恢复或发布回执。副本启动可执行正常到期清理，原快照和生产 DB 不变。失败保留专属目录，不自动覆盖重演；对残留专属子进程先核 PID 和进程归属，绝不停止生产后台。
6. 正式 restore 同样只处理本次新建且已校验的树。数据库映射 `idol-console`，各账本映射 `idol-maint`，按**账户名解析目标实际 UID/GID**，不照抄旧机数字。先移交清单文件、最后移交目录，并再次验证字节；随后真的以服务身份打开现存文件并检查目录可写。未知树、现存目的地或映射失败均停止，不能对整台服务器递归 chown。

## 四源准备与完整候选

仅接收已授权取得的**同代生产公开数据快照**；B 的输入为已有公开基线及合成增量。使用固定 817 events SHA `c47faeda…`、城市冻结 events SHA `86093d19…` 与核验层 SHA `b9006527…`。CLI 拒绝不同的基线/候选字节。

```sh
node maintenance/migration/prepare.mjs <本批已冻结源码根> <817基线文件> <生产公开数据快照根> <源码根/reports/migration-implementation/唯一候选名>
```

- 三方逐条核对：生产对应字段仍等于 817 则承接已审修订，生产独立字段/新增活动保留；真正冲突冻结该条并给出字段及三方哈希证据，其他条目的准备结果保留。冲突时仍写出完整四源候选，冲突条目保留生产版本，收据标记 `prepared-with-conflicts`、列出未决条目；CLI 退出非零，须人工复核解决后才可进入发布，不整表覆盖生产。
- 复用 `invalidateEventVerifications`，过时核验失效；只承接与最终活动仍匹配的冻结证据，不刷新 observedAt/checkedAt。核验层原本缺失时从空层起步并承接适用的已审证据，不给未知活动编造验证。
- 复用 `createFeedRevision`。生产 feed-state/updates 双无才以实际调用 UTC 初始化；单缺直接拒绝。双有保留 UID、SEQUENCE、初始化时间和更新历史，只为真实变化形成修订。
- 四源只写入一个独占的**完整源码候选**，无冲突封口记录为 `prepared`/`published=false`；有冲突记录 `prepared-with-conflicts`/`reviewRequired=true`/`published=false`。不会对四个生产源分别 rename，不写假 published，也不触碰在线 current。
- 完整候选仍须由本批唯一集成负责人执行 `package:site`（含 verify），并复用现有 `inspectPublicationCandidate`、`maintenance.publish.verify_site` 和最终发布锁。console 封包门按规划安排，不能把 `prepared` 当这些门已通过。

## 最终停写、同代恢复与单写切换

1. C 先确认独审、组合门、运行清单、目标容量/证书/DNS/云防火墙、回退窗口和实际操作者已就绪。安装后的守卫保持 paused，检查所有在途维护/手动入口、两把锁与未决标记；不得杀在途采集或覆盖未闭合账本。
2. 旧机在本站 HTTPS server 内用 `old-dynamic-503.nginx.conf` **替换**原后台 include，不能同时 include 两份 location。它仅把 `/admin`、`/admin/`、`/api/v1/` 置为 503，静态站保持可读，不新增代理信任。保留原配置，`nginx -t` 成功后按已批事务 reload；验证静态 200、动态 503。
3. 正常停止旧 console 并确认退出，三类 timer disabled/inactive、维护 service inactive；固定工具在 maintenance/release 两把既有锁下复读这些条件，拒绝 pending/preparing/.prepare.lock。随后生成最终包：

```sh
python3 -I /root/idol-migration-tools-20260923/snapshot.py snapshot \
  --phase final --origin old --package /var/lib/idol-migration/<最终包名>
```

4. 最终 DB、state、活动/周更/应用账本以及可选价格缓存封入同一 generation；复制前后核对账本哈希与静默状态。失败只保留未封口目录；没有 snapshot.json 的完整最终包绝不能恢复。
5. 安全传送精确最终包；key 单独传送。新机安装已验程序/服务/发行物、私有配置和证书，但先不启动 console 或维护；部署锁文件须预先按固定目标创建，root:root 0600。程序与账本分开安装，禁止用旧 private 源码覆盖新守卫。
6. 正式恢复目的地必须不存在。若先前演练或安装产生了同名目录，先由已批准的停写事务逐项保全并核对归属，工具本身不覆盖、不删除、不接管。运行：

```sh
python3 -I /root/idol-migration-tools-20260923/snapshot.py restore \
  --direction forward --package /var/lib/idol-migration/<最终包名> --generation <代号>
```

7. 仅在 `verified-offline`、全范围哈希、原 key-check、真实账户权限检查成功后，才可按 C 已批步骤启动**新机唯一** console。先用固定解析核验 HTTPS、静态/后台版本、鉴权和私有文件不可达，旧机动态继续 503；之后由已确认的 DNS 执行者切 A，观察传播。禁止双机同时接受动态写入。

## 暂停状态下的一次性静态发布

不临时把 maintenance-control 改为 enabled。既有 `publish.py` 的默认入口始终受暂停限制；只有 root 显式传入下列固定批准文件及其独立审核 SHA 才能走迁移模式：

```sh
python3 -I /usr/local/libexec/idol-maintenance-publish.py \
  --migration-approval /root/idol-migration-tools-20260923/publication-approval.json \
  --approval-sha256 <CTO批准文件的精确SHA>
```

批准文件必须为 root 独占普通文件、0600；父目录 root:root 0700，所有祖先不可由业务账户写入、无链接。字段为：固定 schema `idol-migration-publication-approval-v1`、`status=approved`、`transactionId=migration-20260923-…`、UTC `issuedAt/expiresAt`（最长 15 分钟）、完整 pending 的 requestSha256，以及 `previous/previousManifestSha256/source/manifestSha256/newSha/release`。source 仍必须是既有固定 repo/.build/site，不能借授权扩张任意路径。

root 必须从真实组合验证和 Git 交付结果生成既有 pending/verified 记录；`gitPushVerified`、`browserVerified` 必须有对应真实证据，不能为了通过助手填 true。批准文件签发和发布执行均留 C 另行批准，B 未生成真实批准文件。

原发布器先完成请求、前像、完整旧/新清单与验证记录核对，进入原发布锁后才写 root 私有事务意图、复制和切换。已开始但未闭合的事务先读意图/current 再停止；不得换名字重跑。同一已完成请求只读返回 already_published。令牌在切换前过期就停止；切换后因 HTTPS 失败需要恢复旧版时，安全回退不再受令牌到期影响。该模式不调用 Provider、runner、通知或 publish-result，不改变后台单写状态。

迁移模式的发布后回读固定连接新机 `127.0.0.1:443`，HTTP Host、TLS SNI 及系统 CA 校验证书名仍为 `idol.hi-veblen.com`；这避免 DNS 切换前误读旧机。普通发布入口仍按原域名解析。DNS 切换后的外部公网验证须由 C 单独执行，回环校验不能替代。

## 回退和中断

- 新机尚未接受写入：保持两边动态停写，验证旧 public/console/配置及最终包，按 C 明确回退事务恢复原唯一写入机，再恢复 DNS/旧动态入口。不要因 DNS 尚未切完而同时启动两机后台。
- 新机已经接受写入：先在新机执行同样停写/两锁/未决检查，生成 `--phase final --origin new` 的完整反向包，保全新 DB、通知去重、运行/应用账本与同代证据；旧机用 `restore --direction reverse` 核验并恢复它。工具拒绝以 origin=old 包进行反向恢复。只回滚程序或 DNS 而丢弃新写入不属于有效回退。
- 文件存在、SHA 漂移、缺 key、缺账本、锁被占、服务未停、权限映射失败、空间不足、半恢复、孤儿演练进程或一次性发布结果未知：停止受影响动作并保全意图/回执/当前态，不自动删除、覆盖或重试副作用。尚未封口或权限未验的恢复树始终不开放服务。
- 任何回退都保留原 master.key、同代数据和调查证据；node_modules 是否重建只按锁文件/可获取性验证决定，历史证据不按名称清理。

# 服务器自动更新与维护

网站服务器通过 systemd 独立运行，无需 Codex 在线。源码、运行状态和公开 release 分开保存，站点打包白名单不会包含本目录。

## 运行安排

| 任务     | 上海时间     | 工作与边界                                                                                                     |
| -------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| 活动日更 | 每日 00:00   | 免费读取已注册来源；既有活动的确定时间修订可自动应用；新增活动、身份、日期、阵容、取消或延期等保留待审         |
| 资料周更 | 每周五 00:00 | 每轮重算有效账号范围；最多 8 批、每批 50，间隔至少 2 秒，保留 4,000 Credit；当次价格、账号和余额有效才允许收费 |
| 健康检查 | 每小时 30 分 | 检查日更和周更漏跑、失败回执及 HTTPS 公开清单                                                                  |

三个任务共用整段执行锁，采集、应用、构建、Git 推送和发布串行完成。重复成功周期复用回执；有未闭合账本或失败状态时不自动重发收费请求。外部源变化或登录失效可能需要人工处理。

## 目录与权限

- `/srv/china-underground-idol/maintenance/repo`：维护用户的 Git 主分支检出；普通推送，不强制覆盖远端。
- `/srv/china-underground-idol/maintenance/workspace`：物化后的兼容工作目录，含私有证据及费用账本。
- `/srv/china-underground-idol/maintenance/state`：调度回执、浏览器正常登录配置、通知去重状态与发布计划。
- `/srv/china-underground-idol/maintenance/seed`：首次迁移的封存私有种子。
- `/etc/china-underground-idol/maintenance.env`：root 持有的 `0600` 配置，保存 Server 酱 SendKey；不要提交或输出文件内容。
- `/usr/local/libexec/idol-maintenance-*`：root 持有的已审核 supervisor 和固定静态发布助手。
- `/srv/china-underground-idol/maintenance-receipts`：root 写入的发布回执；运行用户只读。

业务 Node、浏览器、npm 和 Git 始终以 `idol-maint` 运行。root 发布助手仅校验并复制固定站点的静态白名单、原子切换 release、核验 HTTPS；不执行仓库命令。

## 首次安装与升级

首次按 `bootstrap-server.sh` 建立专用用户和固定依赖；`configure-git.sh` 生成专用部署公钥并固定 GitHub 主机密钥。部署公钥必须由仓库管理员正常授权。官方 CLI 与价格页面分别走正常登录流程，禁止复制旧时间戳冒充新凭据或价格证据。

从已审核提交检出源后，以维护用户执行 `materialize.mjs`，再用 `install-seed.py` 核验种子 tar 的 SHA 与每个文件。种子必须在旧写入者停止、没有未决锁和计费请求时生成；历史账本不可用空目录替代。安装脚本拒绝覆盖不同的既有字节。

`install-service.py` 只从 root 持有的审核快照安装固定文件，并验证传入的 SHA 清单。安装完成不会自动启用 timer；先运行本机确定性测试、服务器免费采集、管理查询、通知和发布验证，再启用三个 timer。

升级代码须先停止三个 timer、等待当前服务退出并保留运行态，审核新提交及其变更；根目录安装器发现已有文件不同会停止，需单独进行版本化替换和回滚准备。不要通过重跑首次安装覆盖工作目录或清空账本。

## 日常查看

```bash
systemctl list-timers 'idol-maintenance-*' --all
systemctl status idol-maintenance@daily.service idol-maintenance@weekly.service
journalctl -u idol-maintenance@daily.service --since '1 day ago' --no-pager
journalctl -u idol-maintenance@weekly.service --since '8 days ago' --no-pager
```

人工执行 `systemctl start idol-maintenance@daily.service` 同样经过锁与周期幂等检查。周更只能在已授权排期和费用门内执行。不要删除 attempt、收费账本、应用计划或通知回执来“重试”；先核对外部账单、公开文件前像及已有回执。

## 告警与人工处理

自动处理不了的错误、来源访问问题和待审变更通过 Server 酱通知。通知仅传递固定分类、运行编号和处理提示；详情留在私有回执，不能包含原始正文、个人资料或凭据。同类故障在 24 小时内去重，每个上海自然日最多 4 次发送尝试；请求结果未知时不立即重发。通知渠道自身失败写入私有账本并令服务失败，需要从 journal 排查。

活动待审及未完成应用 intent 位于 `workspace/work/phase3-20260909/private/store`；周期结果位于 `state/runs`。缺席不当作取消；未完整读取的来源不刷新观察日期。新增官方来源或页面模板需更新注册与测试后发布代码，不自动放宽策略。

发布验证失败会保留冻结计划；已切换时尝试回到上一个 release，并保留 root 回执。构建通过、Git 已推送与 HTTPS 已发布是不同状态，应以对应回执确认。

停止自动维护：

```bash
systemctl disable --now idol-maintenance-daily.timer idol-maintenance-weekly.timer idol-maintenance-health.timer
```

该操作保留站点、历史 release 和全部账本。旧 Codex 定时任务已经退出本套调度，不作为服务器故障的自动替代写入者。

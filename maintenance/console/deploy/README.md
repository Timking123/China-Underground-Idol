# 管理服务部署候选

本目录提供 systemd/Nginx 配置、只读发行包核验器和人工安装回滚步骤。当前没有执行生产安装；没有自动部署脚本。下面的 shell 段须由维护者在已授权的目标服务器逐段执行，任一步失败都停止。数据库、主密钥、后台发行物不进入静态发布包。

## 路径、账户和发行包

| 用途     | 固定路径                                                      | 归属与权限                                       |
| -------- | ------------------------------------------------------------- | ------------------------------------------------ |
| 程序版本 | `/srv/china-underground-idol/console/releases/console-<版本>` | root:root，目录 0755、文件 0644，运行用户不可写  |
| 当前程序 | `/srv/china-underground-idol/console/current`                 | root 创建的相对链接，只指向已验收版本            |
| 审核快照 | `/srv/china-underground-idol/console/staging/console-<版本>`  | root:root，不可由其他账户写入                    |
| 加密数据 | `/var/lib/idol-console`                                       | idol-console:idol-console，0700，SQLite/WAL 0600 |
| 主密钥   | `/etc/idol-console/master.key`                                | 父目录 idol-console:idol-console 0700，文件 0600 |
| 地区库   | `/srv/china-underground-idol/console/geo`                     | root:root，目录 0755，文件 0644                  |
| 公开资料 | `/srv/china-underground-idol/current`                         | 沿用静态发布路径，后台只读                       |

沿用服务器 `/usr/bin/node` 22.14.0、Nginx、systemd，管理进程单独使用无登录权限的 `idol-console`，不复用维护采集账户。后端只监听 127.0.0.1:8788。

协调构建的六个发行文件必须完整：`server.mjs`、`public/index.html`、`public/admin.js`、`public/admin.css`、`IP2REGION-LICENSE.txt`、`THIRD-PARTY-NOTICES.txt`，另有覆盖六文件的 `manifest.sha256`。由协调入口 `scripts/packageConsole.mjs` 生成。审核时单独记录清单 SHA-256；不能只信任待安装目录自己声称的哈希。

先将本目录核验器和配置安装到 root 审核目录 `/srv/china-underground-idol/console/deploy`，不可从运行用户可写目录执行核验器。以下步骤不读取已有私人文件正文。

## 首次准备与安装

在 root 的 Bash 中准备，已有账户或目录不做递归 chown/chmod：

```bash
set -euo pipefail
umask 077
test "$(/usr/bin/node --version)" = v22.14.0
getent passwd idol-console >/dev/null || useradd --system --user-group --no-create-home --home-dir /var/lib/idol-console --shell /usr/sbin/nologin idol-console
# 核对账户非 root，home 和 shell 必须符合上行；既有不符时停止。
test "$(id -u idol-console)" -gt 0
test "$(getent passwd idol-console | cut -d: -f6-7)" = '/var/lib/idol-console:/usr/sbin/nologin'
for folder in /srv/china-underground-idol/console /srv/china-underground-idol/console/releases /srv/china-underground-idol/console/staging /srv/china-underground-idol/console/geo /srv/china-underground-idol/console/deploy; do
  if test ! -e "$folder" && test ! -L "$folder"; then install -d -o root -g root -m 0755 "$folder"; fi
  test -d "$folder" && test ! -L "$folder"
  test "$(stat -c '%U:%G:%a' "$folder")" = root:root:755
done
for folder in /var/lib/idol-console /etc/idol-console; do
  if test ! -e "$folder" && test ! -L "$folder"; then install -d -o idol-console -g idol-console -m 0700 "$folder"; fi
  test -d "$folder" && test ! -L "$folder"
  test "$(stat -c '%U:%G:%a' "$folder")" = idol-console:idol-console:700
done
```

父目录 `/`、`/srv`、`/srv/china-underground-idol`、`/etc`、`/var`、`/var/lib` 须为 root 持有的普通目录且其他账户不可写。部署之前先核对此条件，再执行创建；发现链接或不同权限停止，不能用递归改权限掩盖差异。

将已审核七文件上传至独占 staging 版本目录，采用审核记录中的版本和哈希：

```bash
read -r -p '审核版本名（console-...）：' release
read -r -p '审核清单 SHA-256：' manifest_sha
[[ $release =~ ^console-[a-z0-9][a-z0-9-]{1,90}$ ]]
[[ $manifest_sha =~ ^[a-f0-9]{64}$ ]]
base=/srv/china-underground-idol/console
source_dir=$base/staging/$release
target_dir=$base/releases/$release
python3 "$base/deploy/verify-release.py" "$source_dir" --manifest-sha256 "$manifest_sha"
test ! -e "$target_dir" && test ! -L "$target_dir"
install -d -o root -g root -m 0755 "$target_dir" "$target_dir/public"
for file in server.mjs IP2REGION-LICENSE.txt THIRD-PARTY-NOTICES.txt manifest.sha256; do
  install -o root -g root -m 0644 "$source_dir/$file" "$target_dir/$file"
done
for file in index.html admin.js admin.css; do
  install -o root -g root -m 0644 "$source_dir/public/$file" "$target_dir/public/$file"
done
python3 "$base/deploy/verify-release.py" "$target_dir" --manifest-sha256 "$manifest_sha"
```

安装失败时保留候选目录供查验，不继续切换。重新安装采用新的版本目录，不删除或覆盖已有目录。核验器拒绝未知文件、额外目录、符号/硬链接、可写父目录、清单重复及哈希不符，不执行包内代码。

## 离线地区库

固定来源是 [ip2region 提交 e373f923](https://github.com/lionsoul2014/ip2region/tree/e373f923129518e56184fd746ba53cf82add402b)。仅下载以下公开文件，不发送访客 IP：

- [IPv4 xdb](https://raw.githubusercontent.com/lionsoul2014/ip2region/e373f923129518e56184fd746ba53cf82add402b/data/ip2region_v4.xdb)，SHA-256 `e54c4c952df0341d2e1d46427ba292e6e1ff0aca99d2c4d3bec753df6f9a995a`
- [IPv6 xdb](https://raw.githubusercontent.com/lionsoul2014/ip2region/e373f923129518e56184fd746ba53cf82add402b/data/ip2region_v6.xdb)，SHA-256 `98e8af04c288b16a6a70ca4d0047b54d1e7d51d99f625593f8a843ed6bad331f`

在审核工作区下载并校验后，由 root 按上表安装到 geo 目录；不要写入静态包。数据库未就绪虽可显示未知，但不算地域统计上线验收通过。官方库启动时会再次验证 xdb 格式。

## 初始化、服务与 Nginx

首次初始化使用已验收版本绝对路径，并明确以服务用户执行。终端会隐藏密码输入；不要将密码作为命令参数或保存到脚本：

```bash
runuser -u idol-console -- /usr/bin/node "$target_dir/server.mjs" init \
  --data-dir /var/lib/idol-console --key-file /etc/idol-console/master.key \
  --admin-dir "$target_dir/public" --site-dir /srv/china-underground-idol/current
```

初始化重入不会覆盖账号或已有密钥；有数据库而无原密钥必须停止。升级不执行 init。服务设置 `--site-dir` 供内容巡检读取公开档案，主密钥和数据库必须远离所有源码仓库、静态目录和后台资产目录。

将审核后的 `idol-console.service` 安装到 `/etc/systemd/system/idol-console.service`（root:root 0644），执行 `systemd-analyze verify /etc/systemd/system/idol-console.service` 后 `systemctl daemon-reload`。此前不启动或 enable 服务。

Nginx 片段放到 `/etc/nginx/snippets/idol-console.conf`，在既有 HTTPS server 块中 include。沿用现有证书、静态 root 和域名，不以模板重写整个虚拟主机。须同时完成下列配置后才允许接入流量：

- 所有本站 HTTPS/HTTP/default_server 的 `access_log off;`、`error_log /dev/null emerg;`，包括已有静态 location 的独立日志；不得保留额外日志输出。此要求覆盖九个公开页与后台/API。
- Nginx **main** 层 `error_log /dev/null emerg;`，**http** 层 `access_log off;`，与本站监听端口相关的 default_server 同样关闭错误日志，避免 URI 匹配之前的 TLS/超长请求头错误记录 IP。共享 Nginx 的其他站点受影响时，先评审或使用独立监听实例，不能仅配置 API location 后声称日志安全。
- 禁止 `debug_connection`、请求镜像、WAF 请求正文审计和自定义 `$request_body` 日志；如已有任一功能，接入前停止并明确其范围。受信地址头必须由直接接收连接的固定 Nginx 覆盖；不要启用信任任意来源的 real_ip 配置。
- 片段关闭请求/响应落盘缓存、禁用上游重试并把合法请求体限制为 24000 字节；HTTP/1.1 下关闭 request buffering。Nginx 的专用 `client_body_temp_path` 必须位于运行用户私有的 tmpfs（0700），防止请求缓冲行为或未知模块意外把私人正文写入磁盘。Nginx 未验证此项时停止接入。
- 分别以正常请求、超大请求、错误方法、损坏 JSON、无效 Host、TLS/请求头错误和后端不可用情况测试；不得在日志或临时目录中发现合成标记。关闭日志后，通过服务健康响应、通用错误计数与 systemd 状态排障，不以重新开启请求日志替代。

代理设置参考 [Nginx 官方代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering)。`nginx -t` 成功才可 reload。回滚配置同样保留日志隐私设置，不能恢复明文访问日志。

## 切换与回滚

静态版本、两个发布器和服务分别交付。在维护窗口暂停原定时器并等待已有维护任务结束，由原发布流程的操作者持有维护锁完成静态发布器升级；不要绕过锁或接管正在执行的任务。两个安装位置分别是：

- `/srv/china-underground-idol/maintenance/workspace/work/phase3-20260909/private/server/publisher.ts`
- `/usr/local/libexec/idol-maintenance-publish.py`

新静态候选必须含 `assets/metrics.js`；前版可为完整地图版或完整无地图版，半套地图拒绝。先更新两级发布器并离线验证，再通过既有静态发布流程发布候选；失败按既有回执回滚旧静态版本。禁止用宽泛的 `assets/*.js` 替代精确白名单。

服务切换由 root 操作者串行执行，先记录前像和已验收回滚版本清单 SHA；重用上面已校验的 `target_dir` 与 `manifest_sha`。首次安装没有前像，失败时撤去代理路由并停止服务，保留 current 供定位。

```bash
python3 "$base/deploy/verify-release.py" "$target_dir" --manifest-sha256 "$manifest_sha"
previous=''
if test -e "$base/current" || test -L "$base/current"; then
  test -L "$base/current"
  previous=$(readlink "$base/current")
  [[ $previous =~ ^releases/console-[a-z0-9][a-z0-9-]{1,90}$ ]]
fi
# 在 root 独占目录内创建临时链接并原子替换；若已有临时文件则停止。
test ! -e "$base/.current-next" && test ! -L "$base/.current-next"
ln -s "releases/$release" "$base/.current-next"
mv -Tf "$base/.current-next" "$base/current"
systemctl restart idol-console.service
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 \
  -H 'X-Console-Client-IP: 127.0.0.1' http://127.0.0.1:8788/api/v1/public-config
```

验证响应 code 为 0，随后验证 HTTPS 登录、匿名请求不可读私人数据、七类提交、完整 IP/地区统计、退出失效与 90 天清理。全部通过才 `systemctl enable idol-console.service`。本机 public-config 成功仅代表进程可响应，不能代替完整验收。

任一步失败停止后续命令，人工用记录的前像回滚。已有旧版时先输入其审核清单 SHA，再执行：

```bash
test -n "$previous"
read -r -p '回滚版本审核清单 SHA-256：' previous_manifest_sha
python3 "$base/deploy/verify-release.py" "$base/$previous" --manifest-sha256 "$previous_manifest_sha"
test ! -e "$base/.current-rollback" && test ! -L "$base/.current-rollback"
ln -s "$previous" "$base/.current-rollback"
mv -Tf "$base/.current-rollback" "$base/current"
systemctl restart idol-console.service
```

恢复后重新检查本机和 HTTPS；不通过则撤去 API/admin 代理路由、`nginx -t` 后 reload，并停止服务，静态浏览与邮件入口保持可用。数据库、密钥与各 release 全部保留，不对私人数据执行删除或旧备份覆盖。未来若服务格式有迁移，升级前单独验证双向兼容，不能直接套用此回滚。

静态发布或静态回滚不要求重启管理服务。上线前必须验证：服务保留公开 `current` 入口，每次读取时解析到固定发布根内的具体 release，重新执行私有路径隔离校验，并从这次解析出的具体目录读取。后台程序升级仍按上面的步骤重启服务。

服务模板通过 `ReadOnlyPaths=/srv/china-underground-idol` 约束稳定父目录，不单独绑定会切换的 `current` 入口。生产验收须在真实 systemd 挂载命名空间中只读检查 `current` 的解析结果（可用 `nsenter -t <已核对的服务PID> -m -- readlink -f /srv/china-underground-idol/current`），并通过同一运行进程分别验证静态切换和回滚后的内容巡检；仅在宿主上观察链接变化不算通过。两次内容读取之间核对 PID 与启动时间未变，不能以人工重启掩盖链接不可见问题。发布根和 release 须由 root 持有，服务只读。

数据库备份与密钥分开保存。明细的 90 天上限按原始采集时间计算，不能按快照生成时间重新计时；即使快照仅保留 90 天，其中旧明细仍可能超期。上线前核验现有备份是否包含私人目录及到期后不可恢复的保证，不盲建备份任务，不上传密钥或数据库。

## 验收与停止边界

独立准备完成不代表已部署。目标服务器仍须核验 root 目录及服务账户、Node/SQLite、系统服务沙箱、xdb、TLS/Origin、Nginx 有效配置、缓存日志隐私与数据库/密钥权限。任何条件不满足或回滚验证失败时停止接入；不自动删除运行态、重置管理员、推送代码、收费采集或发送通知。

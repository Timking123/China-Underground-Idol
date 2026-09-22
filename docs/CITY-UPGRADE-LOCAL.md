# 城市升级的本地运行与维护

本次只在本机运行，不部署服务器，也不连接生产数据库或通知服务。需要 Node.js 22.14.0 及受支持更新版本；完整本地维护校验还需要 Python 3。

## 启动

首次准备依赖和产物，在本次工作树运行：

```powershell
Set-Location -LiteralPath 'C:/Users/12432/Documents/ChatGPT/idol/work/city-upgrade-20260919'
npm ci
npm run verify
npm run verify:console
node scripts/packageSite.mjs
```

本次已准备好后的重启无需重复安装或全量验收。两个终端分别切到上述工作树并运行：

```powershell
npm run preview -- 4186
```

公开预览为 `http://127.0.0.1:4186/`，从 `discover.html` 进入。另一个终端运行：

```powershell
npm run preview:console -- 8796
```

后台为 `http://127.0.0.1:8796/admin/`。启动程序只绑定 127.0.0.1，每次创建新的合成私人库，公开页面读取独立 `.build/site` 发行目录；旧合成库不覆盖。账号信息保存在 `reports/city-upgrade-f/local-console/current.json` 指向的 `accessFile`，用本地编辑器读取即可。密码和合成密钥不写入报告、公开候选或仓库提交。

前台与后台终端均可按 Ctrl+C 停止。桌面任务启动的后台进程号另记于 F 的运行报告，停止时先核对进程命令行与本工作树一致。

## 从投稿到本地发行候选

1. 在合成后台处理投稿，选择稳定活动 ID，填写允许修改的标量字段、来源和原文摘录；普通页面不提供任意对象补丁。
2. 完成证据归档关联并审核，交付候选。后台此时显示待维护，不宣称发布成功。候选必须绑定当前活动原始字节的 SHA256。
3. 维护者准备独立的受信来源归档 JSON，含 `registry` 与 `captures`。`captureId` 必须指向既有维护模块可校验的 SourceCapture；不能把后台自报摘录重新包装成受信抓取。
4. 运行本地维护命令，参数使用当前合成库和合成密钥：

```powershell
npm run maintain:local -- --state <合成库目录> --key <合成密钥文件> --revision <修订ID> --evidence <来源归档JSON> --workspace <本工作树reports内的候选目录>
```

命令只生成隔离的本地发行候选。主工作树四层资料和生产目录均不改写；后台的成功回执明确说明尚未部署。团体投稿仍使用已有审核流程，本轮不提供任意团体主档编辑。

## 四层快照与恢复边界

适配器复用 `prepareEditorialCandidate` 与既有 `prepareEventUpdate`：验证证据后生成活动主档，移除快照失配的核验记录，再用 `createFeedRevision` 和 `validateFeedLedger` 联合生成日历状态与更新历史。旧核验不能因普通补丁校验通过而升级为确认。

源码、原图和预制变体复制到独立 `source` 目录，四层输入的原始 SHA 与新源码清单共同封口。构建只读取此目录；构建前后、提交前均核验其字节，输出再经过 TypeScript 与 Python 两级发布校验。唯一完成标识 `completed.json` 在 SQLite 写事务内复查交付状态和四层原始基线后独占创建，回执绑定 `snapshot.json` 的 SHA256。

- 提交点前撤回或基线变化：停止，不生成完成标识或成功回执。
- 提交点后撤回：保留撤回历史，回读真实完成结果，不声称逆转已完成候选。
- 相同候选重放：核验既有源码快照、公开清单及所有哈希，复用原回执，不再推进 ICS 序号。
- 中断发生在完成标识之前：保留未完成目录；确认状态后选择新的 reports 输出目录重试，不清理或接管旧证据。
- 中断发生在完成标识之后：恢复退出进程锁后重放同命令，核验快照并补回执。

锁由完整 PID、随机归属标记及创建时间构成。实际进程退出会保留锁，不能自动删除。先读取 `.local-editorial.lock` 并计算 SHA256，再显式恢复：

```powershell
(Get-FileHash -LiteralPath <候选目录>/.local-editorial.lock -Algorithm SHA256).Hash.ToLowerInvariant()
npm run maintain:local -- --recover-lock <候选目录> --expected-lock-sha256 <小写SHA256>
```

恢复命令只接受当前仓库 reports 内的目录。锁哈希改变、PID仍存活、路径为链接或旧锁没有可信进程身份时均停止；不接管活跃任务，不删候选。恢复过程本身被强制终止而留下恢复锁时须人工排查其归属，不能连锁自动清锁。

## 公开清单、压缩与维护边界

`assets/public-artifacts.v1.json` 逐项登记生成的 HTML、JSON、ICS、CSS 和 WebP，含 SHA256 与字节数；构建器、预览、管理服务与两级发布器使用相同的受限路径定义。清单外路径、链接、未知文件和已变化的内容拒绝公开。gzip 文件必须与已登记原文件解压后完全相同，总候选仍受原有 512,000,000 字节上限约束。

预览按 Accept-Encoding 协商 gzip，HTML/JS/CSS/JSON/ICS 类型明确；生产缓存头、CDN、Nginx 配置未在本轮修改。日历由发布时生成，客户端决定刷新时机；没有邮件、系统推送或即时提醒。

静态候选位于 `.build/site`，后台独立候选位于 `.build/console`，各有 `manifest.sha256`。后台包不含数据库、密钥、地区库或合成资料。物化器携带新的构建输入、生成器及公开资产；本地后台命令与测试不混入独立静态 site。

生产 `applyActivityRun` 的定时采集与四层原子发布未在此轮启用或部署。当前可复用入口为 `maintenance/localEditorial.mjs`；以后接入生产前仍须审核安装、权限、备份、发布锁及服务器环境，不能把本地回执当作线上发布。

## 可复跑验收

```powershell
npm run verify
npm run verify:console
npm run package:site
npm run package:console
node --test tests/localEditorial.test.mjs tests/localEditorialLock.test.mjs
node --experimental-strip-types --test maintenance/runtime/private/tests/serverPublisher.test.mjs
```

Python 发布器的完整锁、切换与回滚测试要求 Linux；Windows 本轮通过已有 WSL Ubuntu 执行 `python3 -m unittest maintenance.test_publish`。直接 Windows 运行会在创建符号链接时受权限限制，不能把这种失败或跳过算通过。

最终命令退出码、包哈希、精确字节数、服务 PID、截图及性能原始/传输口径见 `reports/city-upgrade-f/REPORT.md`。性能样本不可外推全站或并发容量。

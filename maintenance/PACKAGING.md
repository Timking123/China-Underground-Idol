# 服务器源码包与物化约定

`maintenance/runtime` 保存受控更新程序的维护源码，`maintenance/legacy/tools` 保存旧采集工具的静态依赖闭包。它们不是网站发布内容，也不包含旧原始证据、身份补充、账本、会话或凭据。站点公开维护源仍在仓库根目录。

原始快照来自工作区的 `work/phase3-20260909` 和 `outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01/tools`。来源清单为 `materialize.mjs` 导出的 `SOURCE_PROVENANCE`：每个文件同时记录原始 SHA-256、包内 SHA-256 和原始字节数。核心模块、CLI 和旧工具保持原字节；包内配置与管线集成测试的适配保留原始 SHA。

## 安装与升级

需要 Node.js 22.14.0 或以上。显式提供三个绝对路径：`repoRoot` 是当前代码仓库，`workspaceRoot` 是待创建或空的独立运行工作区，`privateSeedRoot` 是已存在的私有种子目录。三者必须互不包含，任何父路径和目标文件均不得为符号链接；普通文件还需只有一个硬链接。

先检查清单，确认来源和目标后执行物化：

```sh
node maintenance/materialize.mjs \
  --repo-root /opt/idol/repo \
  --workspace-root /opt/idol/workspace-v1 \
  --private-seed-root /opt/idol/private-seed \
  --plan

node maintenance/materialize.mjs \
  --repo-root /opt/idol/repo \
  --workspace-root /opt/idol/workspace-v1 \
  --private-seed-root /opt/idol/private-seed
```

`--plan` 只读取源码与目录身份，不创建工作区。命令成功时输出包含 `mode`、`sourceSha256` 和逐文件来源/目标/SHA 的清单，失败时向 stderr 输出停止原因并返回退出码 1。JS 调用方可导入 `materialize({ repoRoot, workspaceRoot, privateSeedRoot, planOnly })`，返回相同清单对象。

生成布局：

```text
workspaceRoot/
  work/phase3-20260909/
    package.json
    package-lock.json
    eslint.config.mjs
    .materialized-source.v1.json
    private/{src,server,tests,cli.ts,tsconfig.json,sources.v1.json}
    site/                       # 普通文件副本，可独立维护与构建
  outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/
    中国地下偶像分布图_2026-09-01/tools/
      .materialized-source.v1.json
      *.mjs
```

`WEEKLY_STAGE`、`WEEKLY_ARCHIVE` 和旧工具相对路径保持原样。源码包位置不是运行位置：类型检查、原有测试和 CLI 都应在物化后的 `work/phase3-20260909` 执行。依赖安装、Playwright 浏览器安装和私有 seed 搬运由上层安装流程单独执行。物化器只验证 seed 根目录，不遍历或复制其中内容；应先完成源码物化，再搬运明确授权的私有数据。

重复物化只接受完全相同的源码清单和受管文件 SHA，返回 `mode: verified`，不写入文件或更改 mtime。源码目录中出现未登记文件、已有内容变化、缺少身份标记或半安装目录均停止。额外的账本、锁、运行记录等私有运行态不会被删除或覆盖。

升级使用新的空工作区。物化器没有覆盖、重置、清理或接管旧目录的选项；中途失败会留下未完成目录供检查，重试不会自动补齐。安装期间应保持源仓库与目标目录静止，只有一个写入者；本实现逐层检查路径并独占创建文件，不提供针对其他进程恶意并发替换路径的操作系统级沙箱。

## 白名单与来源边界

- 原包固定 43 个文件：15 个核心 TS、CLI、14 个原测试/夹具、来源配置、3 个包/检查配置、TS 配置和 8 个旧工具。
- 增量服务器模块只接受 `private/server/**/*.ts`；增量测试只接受 `private/tests/server*.mjs`。它们的当前 SHA 纳入物化清单，来源不冒充旧快照。
- `site` 只接受显式根文件和 `assets`、`data`、`docs`、`scripts`、`src`、`styles`、`tests`。`data` 使用精确公开文件名白名单，图片/源码扩展名受限，未知文件和疑似私有文件名停止。
- `maintenance`、`.git`、`node_modules`、`.build`、私有目录、旧输出与报告目录不会进入 `site`。排除目录不会被遍历。
- 包内 `package.json` 去除未打包的 `tools` 检查路径，加入服务器格式检查及固定运行依赖 `playwright@1.63.0`；锁文件同步；`private/tsconfig.json` 加入 `server/**/*.ts`。原始 SHA 保留在来源表中。
- ESLint 增补服务器浏览器回调中的类型名称与标准全局；`pipeline.test.mjs` 使用自包含合成证据，保留 hash、前像、归档与应用幂等检查，不依赖开发者私有 inbox。
- 锁文件由 Linux npm 从固定直接依赖重新生成，包含全部 26 个 esbuild 平台包及完整性信息；传递依赖 `ignore` 从 7.0.8 更新为 7.0.9。锁测试通过保留旧 inode 制造真实替换，不再假定删除重建必然分配新 inode；生产锁实现保持原字节。

旧工具闭包以 `weekly_profile_refresh.mjs`、`weekly_reconciliation.mjs`、`collect_weibo_official.mjs`、`weibo_cli_contract.mjs` 为入口，使用 TypeScript AST 只读扫描 import、export-from 和字符串字面量 import/require 得到 8 个 `.mjs` 文件。扫描中没有计算式 import/require，也没有非 Node 内置包依赖。静态闭包不覆盖工具运行时读取的数据、CLI 子进程、网络服务或付费能力；这些继续受上层运行门约束。微博 CLI 定位器保持不变，Linux 安装流程须把固定 `@weibo-ai/weibo-cli@0.9.1` 放在专有 `APPDATA` 下的 `npm/node_modules`。

## 离线验证

```sh
node --test maintenance/materialize.test.mjs
npm --prefix maintenance/runtime ci --ignore-scripts --offline --no-audit --no-fund --dry-run
```

物化测试创建临时合成小仓库与 seed，验证清单模式、普通文件布局、来源 SHA、重复调用、维护文件冲突、半安装、私有文件混入、路径逃逸、父目录链接和 CLI 退出码。测试不会运行采集器，不访问旧档案，不执行付费动作。锁文件离线 dry-run 仅证明依赖计划一致，不代表服务器安装、浏览器可用或真实业务验收。

## 原始源码 SHA-256

| 包内路径                                                | 原始 SHA-256                                                       | 包内 SHA-256                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| runtime/eslint.config.mjs                               | `40f5f4f62f09cd3a673171d001b21555beefcfc18cf9cde6e71dc342d3c1d267` | 同原始                                                             |
| runtime/package-lock.json                               | `a7d6c3957d4c5c2b7b31e2b8bc2752690f7cc6838e289f871054420ce3c478a8` | `b6d3b2b384b881c29e4cc6660f6574b0f09d6a4955c479b5037877d926ec3bf1` |
| runtime/package.json                                    | `e9e6a94f6c171f110f5fcc78f5e48287918056c39d02d2b062d59c7bb47f0232` | `4f98b8b6ea5548d342b35bcf4e594c85284a0be8cf74ab3c794a9dd450f29f39` |
| runtime/private/cli.ts                                  | `dc5253d077e998b2c8a1448d68f886d92c447986c0d953e44c1f64a0f46d2e14` | 同原始                                                             |
| runtime/private/sources.v1.json                         | `3813cbb452f709f048f2b0b8ab7e3adc99630d0e64c780a1653f4d9be8c0d4ff` | 同原始                                                             |
| runtime/private/src/eventApplication.ts                 | `e3ba7fe9042e307a3ac69e5037df2d23a06e8c3c375138503aa3ab3b7959c68d` | 同原始                                                             |
| runtime/private/src/eventCandidates.ts                  | `41c3e4599111c441dacf455b22f5bb2a12f56d39fdef5600e440fc5988f43063` | 同原始                                                             |
| runtime/private/src/pipeline.ts                         | `f06df34c3a4c428351bc1a7b6da7382f2908b77418c91625efdbdabf8106c887` | 同原始                                                             |
| runtime/private/src/pipelineStore.ts                    | `6a034553b079964fa9b8243107d3c173d0500e5be8edcce5ea2e3a773acd56b8` | 同原始                                                             |
| runtime/private/src/showstart.ts                        | `d49122e21fa1e682a23691d83389fd0d5ab9fdfd6917665d468c30c5e7e491bc` | 同原始                                                             |
| runtime/private/src/sourceCapture.ts                    | `85ef3436140700d3d7b2a028753f62dd5a1f8948fb2fae3c54e6a5419d07f9fc` | 同原始                                                             |
| runtime/private/src/sourceRegistry.ts                   | `3f52e9e00a647df8394c3396af89062be639373e67391e0402b72568c05e0cd9` | 同原始                                                             |
| runtime/private/src/weeklyApplication.ts                | `cf1a44cf38b3ec95a7ebdc0c5dbed6252d83603f948e70c820d01696cb1fdd46` | 同原始                                                             |
| runtime/private/src/weeklyContract.ts                   | `8e1a7446bd00a275e3b70f80a69b7800dec94da7095a5f7db86444c593b39da7` | 同原始                                                             |
| runtime/private/src/weeklyProviderCapability.ts         | `3a2989f5d91dff0834e94a03bc6a315d67edb22fa81ede6fb3948fb2af55be2b` | 同原始                                                             |
| runtime/private/src/weeklyReconciliation.ts             | `cfd43e64b6c9d07ff69a5125bb868f76ce67a52b0bdcbaca55e346963b6e04b8` | 同原始                                                             |
| runtime/private/src/weeklyRuntime.ts                    | `866310f5a85c16031381af635a766f5530e87dfd851732657d470b5aa541ea4e` | 同原始                                                             |
| runtime/private/src/weeklyRuntimeAdapter.ts             | `b4139f27101d68f3f27bd803cb2064778ab78edca2ebcbf0ad4b2b5cdfa1b869` | 同原始                                                             |
| runtime/private/src/weeklyRuntimeApplication.ts         | `8d4ca1f58963c6ed1b31b30761381cd320afe8be19a4c9158d228d663e600608` | 同原始                                                             |
| runtime/private/src/weeklyScope.ts                      | `e60c51e6a067d68b360e104a923724309ebc9a97923844b8121243c6411344ae` | 同原始                                                             |
| runtime/private/tests/eventCandidates.test.mjs          | `322cf30d3ffd8762c0fb6a3ccf8f2bced87c981835426821c4975954ea640f9a` | 同原始                                                             |
| runtime/private/tests/pipeline.test.mjs                 | `74ce8ef70fe821782cc16d5355008649cb1b6a47fa8a0c225ee2d72cbcd89001` | 同原始                                                             |
| runtime/private/tests/pipelineStore.test.mjs            | `26ad1e8366d23526c5069bcc0ae0075bdc95637f349ee426a84177cc4b9214fd` | 同原始                                                             |
| runtime/private/tests/showstart.test.mjs                | `560795da94355836f7249772db41ff66f4d728cadb6137f4c814ed76d4926f49` | 同原始                                                             |
| runtime/private/tests/sourceCapture.test.mjs            | `e6e978af67a9fc8e0e12ce5ccdff3b22f03062199ea4a097b2af01d1979488a4` | 同原始                                                             |
| runtime/private/tests/weeklyApplication.test.mjs        | `835de779670993aef5ff89038523903f9ddb5b04fa23d8ad229548b68a31429d` | 同原始                                                             |
| runtime/private/tests/weeklyContract.test.mjs           | `466d857b076c6b1ef7f982629e376c86d331491a2478853f58b3cd3c6222beb7` | 同原始                                                             |
| runtime/private/tests/weeklyFixtures.mjs                | `928dd0bbc8420204540e5aef5892f68ff614d159644635065ed4245274bb36f2` | 同原始                                                             |
| runtime/private/tests/weeklyProviderCapability.test.mjs | `0cc65a8c91b192e817f2a9f8be1c88048e9104d64fdfe96173c9fec108f0d709` | 同原始                                                             |
| runtime/private/tests/weeklyReconciliation.test.mjs     | `41c52edfa75bf66bee2f4e14ca9bbf65e57b8d3a63a4738fc3fd28ed4cf45b03` | 同原始                                                             |
| runtime/private/tests/weeklyRuntime.test.mjs            | `b905b6caf9eef2c798a02039171dcd5b8a9762fc67ae4f897cc34b71ae70d34d` | 同原始                                                             |
| runtime/private/tests/weeklyRuntimeAdapter.test.mjs     | `e38b032447ce01d915ba1010bfdcc29a9f6080e36efbc3a50dad03b29cbe447c` | 同原始                                                             |
| runtime/private/tests/weeklyRuntimeApplication.test.mjs | `3e17e9c67981fdec0943b7fcded630127223bbd1a87c29d4e0db4d05cade1302` | 同原始                                                             |
| runtime/private/tests/weeklyScope.test.mjs              | `d9336cae15d2f1a1e846864cad4dba9c2ed760ccf6688511c985816328a90590` | 同原始                                                             |
| runtime/private/tsconfig.json                           | `7a0dc3d7ba6e84f0e8bc275b263a34640dc8f34c966673fa5799d15aad82ddb2` | `2f81607385afcfa68751a3f7668f08321cee0087f8756359566230b97918f74e` |
| legacy/tools/api_response_cache.mjs                     | `e585157da8356cc307b6e1d40eeea262249b6293666dd394821865bd4518345e` | 同原始                                                             |
| legacy/tools/build_weibo_candidate_evidence.mjs         | `224e36fb1ff10071f7629cb78f63551afee0233623f47c09d7c73737d72ad054` | 同原始                                                             |
| legacy/tools/collect_weibo_official.mjs                 | `79543385b276bf8a087a0f27c7b1eab58fa227d02aeb1f0e13d8100a3bded5f4` | 同原始                                                             |
| legacy/tools/editorial_contract.mjs                     | `7236e89f154c4b92e05f22cac35bdd74fb7396a3667e51d45ba6a38d0a98f560` | 同原始                                                             |
| legacy/tools/redact_weibo_cli_capability_cache.mjs      | `1cebc925bbf6c0f4fec0c0fcc39dbe5b2f98cb78bafa23ae1f08e8c471019e9a` | 同原始                                                             |
| legacy/tools/weekly_profile_refresh.mjs                 | `983f40c6c947c613771ecd9df420f00f59ce3dbba508edb325e5fba56899db56` | 同原始                                                             |
| legacy/tools/weekly_reconciliation.mjs                  | `671aad870034499bc6354be1693f588c3378dfe2c5aa59d9f47792f1a067f4f6` | 同原始                                                             |
| legacy/tools/weibo_cli_contract.mjs                     | `6f0c3a19c9b0d16e109917f566ce7a1480dd7ff3125d419cdd6e669f1682254e` | 同原始                                                             |

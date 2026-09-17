import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// 保留旧测试原入口；新模块测试按固定文件名发现，不执行私有目录。
const files = (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();
for (const name of files) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      fileURLToPath(new URL(`../tests/${name}`, import.meta.url)),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 公共站点物化目录不携带管理服务；原始源码仓库必须执行后台验收。
if (existsSync(new URL("../maintenance/console/", import.meta.url))) {
  for (const name of ["checkConsole.mjs", "testConsole.mjs"]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(name, import.meta.url))],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

// 源码仓库验证维护契约；物化后的独立 site 不携带维护源码，由原仓库完成此门。
if (existsSync(new URL("../maintenance/", import.meta.url))) {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      fileURLToPath(
        new URL("../maintenance/geographyManifest.test.mjs", import.meta.url),
      ),
      fileURLToPath(
        new URL("../maintenance/materialize.test.mjs", import.meta.url),
      ),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

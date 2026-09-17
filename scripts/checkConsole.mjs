import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
if (!existsSync("maintenance/console")) throw new Error("后台源码目录缺失");
const files = readdirSync("maintenance/console")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `maintenance/console/${name}`);
const executable = fileURLToPath(
  new URL("../node_modules/eslint/bin/eslint.js", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    executable,
    "--no-config-lookup",
    "--config",
    "maintenance/console/eslint.config.mjs",
    "--max-warnings",
    "0",
    ...files,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

// 根格式配置为兼容旧维护代码忽略 maintenance；新后台显式执行格式门。
const prettier = fileURLToPath(
  new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url),
);
const format = spawnSync(
  process.execPath,
  [
    prettier,
    "--ignore-path",
    ".gitignore",
    "--check",
    ...files,
    "maintenance/console/tests/*.mjs",
    "maintenance/console/public/*",
    "maintenance/console/ui-tests/*",
  ],
  { stdio: "inherit" },
);
if (format.status !== 0) process.exit(format.status ?? 1);

import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

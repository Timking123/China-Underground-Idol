import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = new URL("../maintenance/console/tests/", import.meta.url);
if (!existsSync(directory))
  throw new Error("后台测试目录缺失，不能视为验收通过");
const names = (await readdir(directory))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();
if (!names.length) throw new Error("尚无后台验收测试");
const files = names.map((name) => fileURLToPath(new URL(name, directory)));
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...files],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

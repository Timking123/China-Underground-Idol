import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const compiler = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
const projects = ["tsconfig.json"];
if (existsSync("maintenance/console/tsconfig.json"))
  projects.push("maintenance/console/tsconfig.json");
for (const project of projects) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(compiler), "--noEmit", "--project", project],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

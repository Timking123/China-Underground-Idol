import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inspectConsoleOutput } from "./packageConsole.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = await inspectConsoleOutput(root);
await mkdir(path.join(out, "public"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["maintenance/console/main.ts"],
  outfile: path.join(out, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.14",
  charset: "utf8",
});
await build({
  absWorkingDir: root,
  entryPoints: ["src/admin/page.ts"],
  outfile: path.join(out, "public/admin.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  charset: "utf8",
});
for (const name of ["index.html", "admin.css"])
  await copyFile(
    path.join(root, "maintenance/console/public", name),
    path.join(out, "public", name),
  );
await copyFile(
  path.join(root, "maintenance/console/IP2REGION-LICENSE.txt"),
  path.join(out, "IP2REGION-LICENSE.txt"),
);
const notices = [
  "管理界面第三方软件许可；ip2region 许可见 IP2REGION-LICENSE.txt。",
];
for (const name of ["d3-geo", "d3-array", "internmap"]) {
  const directory = path.join(root, "node_modules", name);
  const info = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  notices.push(
    `${name} ${info.version}\n${await readFile(path.join(directory, "LICENSE"), "utf8")}`,
  );
}
await writeFile(
  path.join(out, "THIRD-PARTY-NOTICES.txt"),
  `${notices.join("\n\n")}\n`,
  "utf8",
);
console.log("管理服务与管理界面已单独构建；私人运行数据不进入发行包。");

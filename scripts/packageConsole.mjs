import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const consoleFiles = [
  "IP2REGION-LICENSE.txt",
  "THIRD-PARTY-NOTICES.txt",
  "public/admin.css",
  "public/admin.js",
  "public/index.html",
  "server.mjs",
];

// 构建与封包共用边界；已有未知文件即停止，不清空或接管该目录。
export async function inspectConsoleOutput(root, complete = false) {
  const output = path.join(root, ".build/console");
  for (const directory of [root, path.join(root, ".build"), output]) {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("管理发行目录必须是普通目录");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const found = new Set();
  const allowed = new Set([...consoleFiles, "manifest.sha256"]);
  async function visit(directory, relative = "") {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error("管理发行包拒绝符号链接");
      if (stat.isDirectory() && name === "public") await visit(target, name);
      else {
        if (!stat.isFile() || stat.nlink !== 1 || !allowed.has(name))
          throw new Error("管理发行包出现非白名单文件或硬链接");
        found.add(name);
      }
    }
  }
  await visit(output);
  if (complete && consoleFiles.some((name) => !found.has(name)))
    throw new Error("管理发行包缺少必要文件");
  return output;
}

export async function packageConsole(
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  const output = await inspectConsoleOutput(root, true);
  const manifest = [];
  for (const name of consoleFiles) {
    const bytes = await readFile(path.join(output, name));
    manifest.push(
      `${createHash("sha256").update(bytes).digest("hex")}  ${name}`,
    );
  }
  await writeFile(
    path.join(output, "manifest.sha256"),
    `${manifest.join("\n")}\n`,
    "utf8",
  );
  console.log(
    `管理发行候选已封装：.build/console，${consoleFiles.length} 个固定文件；不含数据库、密钥、地区库或测试数据。`,
  );
  return consoleFiles;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await packageConsole();

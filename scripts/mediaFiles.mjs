import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 所有层级均拒绝符号链接，生成器只接收规范相对路径。 */
export async function safePath(root, relative, { write = false } = {}) {
  if (
    !relative ||
    /[^a-zA-Z0-9_./-]/.test(relative) ||
    relative
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    path.isAbsolute(relative)
  )
    throw new Error(`非法生成路径：${relative}`);
  let current = path.resolve(root);
  if ((await lstat(current)).isSymbolicLink())
    throw new Error("根目录不能为符号链接");
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const directory = index < parts.length - 1;
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT" || !write) throw error;
      if (directory) await mkdir(current);
      else return current;
      stat = await lstat(current);
    }
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile())
    )
      throw new Error(`必须是普通${directory ? "目录" : "文件"}：${relative}`);
  }
  return current;
}

export async function readJson(root, relative) {
  return JSON.parse(await readFile(await safePath(root, relative), "utf8"));
}

export async function writePublicFile(root, relative, contents) {
  await writeFile(
    await safePath(root, relative, { write: true }),
    contents,
    "utf8",
  );
}

import { build } from "esbuild";
import { mkdir, readFile, writeFile, lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function packageMigration(
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  const output = path.join(root, ".build/migration");
  for (const directory of [root, path.join(root, ".build"), output]) {
    try {
      const s = await lstat(directory);
      if (!s.isDirectory() || s.isSymbolicLink())
        throw new Error("迁移工具输出必须是普通目录");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await mkdir(output, { recursive: true });
  const names = [
    "verify-store.mjs",
    "snapshot.py",
    "verify-release.py",
    "manifest.json",
  ];
  for (const name of await readdir(output)) {
    const info = await lstat(path.join(output, name));
    if (
      !names.includes(name) ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1
    )
      throw new Error("迁移工具输出存在未知文件");
  }
  const compiled = await build({
    absWorkingDir: root,
    entryPoints: ["maintenance/migration/verify-store.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22.14",
    write: false,
    charset: "utf8",
  });
  const files = {
    "verify-store.mjs": compiled.outputFiles[0].contents,
    "snapshot.py": await readFile(
      path.join(root, "maintenance/migration/snapshot.py"),
    ),
    "verify-release.py": await readFile(
      path.join(root, "maintenance/console/deploy/verify-release.py"),
    ),
  };
  const hashes = {};
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(path.join(output, name), bytes);
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(
    path.join(output, "manifest.json"),
    `${JSON.stringify({ schemaVersion: "idol-migration-tools-v1", files: hashes }, null, 2)}\n`,
  );
  return { output, files: hashes };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  console.log(JSON.stringify(await packageMigration()));

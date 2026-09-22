import { readdir, mkdir, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readEventAssets, readLocalEventPoster } from "./eventAssets.mjs";
import { publicFiles, imageFolders, isPublicImage } from "./siteManifest.mjs";
import {
  readPublicArtifactManifest,
  readOrdinaryPublicFile,
} from "./publicArtifacts.mjs";
import { gzipSync } from "node:zlib";

export async function packageSite(
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  const { localPosters } = await readEventAssets(root);
  const output = path.join(root, ".build", "site");
  const artifacts = await readPublicArtifactManifest(root);
  const files = [...publicFiles, ...artifacts.files.map((item) => item.path)];
  for (const folder of imageFolders) {
    for (const entry of await readdir(path.join(root, "assets", folder), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !isPublicImage(`assets/${folder}/${entry.name}`))
        throw new Error(`非白名单素材：${folder}/${entry.name}`);
      files.push(`assets/${folder}/${entry.name}`);
    }
  }
  files.push(...localPosters);
  files.sort();

  async function existingFiles(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const found = [];
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("发布目录不能包含符号链接");
      if (entry.isDirectory()) found.push(...(await existingFiles(target)));
      else found.push(path.relative(output, target).split(path.sep).join("/"));
    }
    return found;
  }

  // 重建仅覆盖白名单文件；发现其他文件即停止，不自动清空目录。
  for (const directory of [path.join(root, ".build"), output]) {
    try {
      if ((await lstat(directory)).isSymbolicLink())
        throw new Error("发布目录不能是符号链接");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const compressible = files.filter((file) =>
    /\.(?:html|css|js|json|ics|svg)$/u.test(file),
  );
  const allowed = new Set([
    ...files,
    ...compressible.map((file) => `${file}.gz`),
    "manifest.sha256",
  ]);
  for (const file of await existingFiles(output)) {
    if (!allowed.has(file))
      throw new Error(`发布目录存在非白名单文件：${file}`);
  }
  const manifest = [];
  // 先确认所有源文件齐全，再写候选；缺模块时不留下看似可发布的半套页面。
  for (const directory of [
    "assets",
    "styles",
    ...imageFolders.map((folder) => `assets/${folder}`),
  ]) {
    if ((await lstat(path.join(root, directory))).isSymbolicLink())
      throw new Error(`公开素材目录不能是符号链接：${directory}`);
  }
  for (const file of files) {
    await readOrdinaryPublicFile(root, file);
  }
  for (const file of files) {
    const bytes = localPosters.includes(file)
      ? await readLocalEventPoster(root, file)
      : await readOrdinaryPublicFile(root, file);
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    manifest.push(
      `${createHash("sha256").update(bytes).digest("hex")}  ${file}`,
    );
    if (compressible.includes(file)) {
      const compressed = gzipSync(bytes, { level: 9 });
      await writeFile(`${target}.gz`, compressed);
      manifest.push(
        `${createHash("sha256").update(compressed).digest("hex")}  ${file}.gz`,
      );
    }
  }
  await writeFile(
    path.join(output, "manifest.sha256"),
    `${manifest.sort((a, b) => a.slice(66).localeCompare(b.slice(66), "en")).join("\n")}\n`,
    "utf8",
  );
  console.log(
    `本地发布候选：.build/site，共 ${manifest.length} 个白名单文件（含 gzip）；未推送、未部署。`,
  );
  return [...files, ...compressible.map((file) => `${file}.gz`)].sort();
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await packageSite();

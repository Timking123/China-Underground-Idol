import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const artifactManifestPath = "assets/public-artifacts.v1.json";
export const artifactSchema = "idol-public-artifacts-v1";

// 动态资源只从已审查生成器登记；命名规则本身不授予公开权限。
export function isGeneratedPublicPath(name) {
  return (
    typeof name === "string" &&
    !name.split("/").some((part) => !part || part === "." || part === "..") &&
    [
      /^groups\/g\d{3,8}\.html$/u,
      /^(?:groups|events)\/index\.html$/u,
      /^events\/e-[a-z0-9][a-z0-9_-]{0,95}\.html$/u,
      /^assets\/page-data\/groups\/g\d{3,8}\.json$/u,
      /^assets\/page-data\/catalog\.json$/u,
      /^assets\/prerender\.css$/u,
      /^assets\/media-optimized\/manifest\.v1\.json$/u,
      /^assets\/media-optimized\/[a-f0-9]{20}-\d+\.webp$/u,
      /^feeds\/v1\/manifest\.json$/u,
      /^feeds\/v1\/groups\/g\d{3,8}\.ics$/u,
      /^feeds\/v1\/cities\/[0-9a-f]{2,192}\.ics$/u,
    ].some((pattern) => pattern.test(name))
  );
}

export async function readOrdinaryPublicFile(root, name) {
  if (
    typeof name !== "string" ||
    !/^[A-Za-z0-9_./-]+$/u.test(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`公开资源路径无效：${name}`);
  let target = path.resolve(root);
  const rootState = await lstat(target);
  if (!rootState.isDirectory() || rootState.isSymbolicLink())
    throw new Error("公开资源根目录不能是链接");
  const parts = name.split("/");
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    const stat = await lstat(target);
    if (
      stat.isSymbolicLink() ||
      (index === parts.length - 1
        ? !stat.isFile() || stat.nlink !== 1 || stat.size > 20_000_000
        : !stat.isDirectory())
    )
      throw new Error(`公开资源不是受限普通文件：${name}`);
  }
  return readFile(target);
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateArtifactManifest(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).sort().join(",") !== "files,schemaVersion" ||
    input.schemaVersion !== artifactSchema ||
    !Array.isArray(input.files) ||
    input.files.length > 9000
  )
    throw new Error("生成资源清单无效");
  const seen = new Set();
  for (const item of input.files) {
    if (
      !item ||
      typeof item !== "object" ||
      Object.keys(item).sort().join(",") !== "bytes,path,sha256" ||
      !isGeneratedPublicPath(item.path) ||
      !/^[a-f0-9]{64}$/u.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > 20_000_000 ||
      seen.has(item.path.toLowerCase())
    )
      throw new Error("生成资源条目无效或重复");
    seen.add(item.path.toLowerCase());
  }
  return input;
}

export async function writePublicArtifactManifest(root, files) {
  if (new Set(files).size !== files.length)
    throw new Error("生成器返回重复的公开文件");
  const records = [];
  for (const name of [...files].sort()) {
    if (!isGeneratedPublicPath(name))
      throw new Error(`生成器返回非白名单路径：${name}`);
    const bytes = await readOrdinaryPublicFile(root, name);
    records.push({ path: name, sha256: digest(bytes), bytes: bytes.length });
  }
  const value = validateArtifactManifest({
    schemaVersion: artifactSchema,
    files: records,
  });
  await mkdir(path.join(root, "assets"), { recursive: true });
  const directory = await lstat(path.join(root, "assets"));
  if (directory.isSymbolicLink() || !directory.isDirectory())
    throw new Error("清单目录不能是链接");
  const target = path.join(root, artifactManifestPath);
  try {
    await readOrdinaryPublicFile(root, artifactManifestPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
}

export async function readPublicArtifactManifest(root) {
  const manifest = validateArtifactManifest(
    JSON.parse(await readOrdinaryPublicFile(root, artifactManifestPath)),
  );
  for (const item of manifest.files) {
    const bytes = await readOrdinaryPublicFile(root, item.path);
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256)
      throw new Error(`生成资源已变化，请重新构建：${item.path}`);
  }
  return manifest;
}

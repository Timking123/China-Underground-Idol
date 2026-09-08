import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readEventAssets } from "./eventAssets.mjs";
import { writeGroupCatalog } from "./groupCatalog.mjs";
import { entryPoints as candidates, publicFiles } from "./siteManifest.mjs";

export async function buildSite(
  root = fileURLToPath(new URL("../", import.meta.url)),
  { partial = false } = {},
) {
  const missing = [
    ...Object.values(candidates),
    ...publicFiles.filter((file) => !file.startsWith("assets/")),
  ].filter((file) => !existsSync(path.join(root, file)));
  if (missing.length && !partial) {
    throw new Error(
      `站点模块尚未齐全：${missing.join("、")}。仅开发中可显式使用 --partial；发布验证不能跳过模块。`,
    );
  }
  const entryPoints = Object.fromEntries(
    Object.entries(candidates).filter(([, file]) =>
      existsSync(path.join(root, file)),
    ),
  );
  await readEventAssets(root);
  await writeGroupCatalog(root);
  await build({
    absWorkingDir: root,
    entryPoints,
    outdir: "assets",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    sourcemap: false,
    logLevel: "info",
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await buildSite(undefined, { partial: process.argv.includes("--partial") });

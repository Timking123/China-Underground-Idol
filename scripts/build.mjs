import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readEventAssets } from "./eventAssets.mjs";
import { writeGroupCatalog } from "./groupCatalog.mjs";
import { entryPoints as candidates, publicFiles } from "./siteManifest.mjs";
import { writePublicArtifactManifest } from "./publicArtifacts.mjs";

export async function buildSite(
  root = fileURLToPath(new URL("../", import.meta.url)),
  { partial = false } = {},
) {
  const missing = [
    ...Object.values(candidates),
    ...publicFiles.filter((file) => !file.startsWith("assets/")),
    "data/follower-observations.v1.json",
    "data/follower-observations.v2.json",
  ].filter((file) => !existsSync(path.join(root, file)));
  const missingScopedFollowers = missing.includes(
    "data/follower-observations.v2.json",
  );
  if (missing.length && (!partial || missingScopedFollowers)) {
    throw new Error(
      `站点模块尚未齐全：${missing.join("、")}。${missingScopedFollowers ? "粉丝 v2 观察层不可通过 --partial 跳过。" : "仅开发中可显式使用 --partial；发布验证不能跳过模块。"}`,
    );
  }
  const entryPoints = Object.fromEntries(
    Object.entries(candidates).filter(([, file]) =>
      existsSync(path.join(root, file)),
    ),
  );
  await readEventAssets(root);
  await writeGroupCatalog(root);
  // 生成器不访问网络、不推进业务修订；缺失生成器不能生成半套发布包。
  const { generatePrerender } = await import("./prerender.mjs");
  const { validateMedia } = await import("./validateMedia.mjs");
  const { generateFeeds } = await import("./generateSubscriptions.mjs");
  const media = await validateMedia(root);
  const pages = await generatePrerender(root, { outputRoot: root });
  const feeds = await generateFeeds(root, { outputRoot: root });
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
    minify: true,
    define: {
      __PUBLIC_METRICS_PAGES__: JSON.stringify(
        pages.files
          .filter((name) => name.endsWith(".html"))
          .map((name) => `/${name}`),
      ),
    },
    logLevel: "info",
  });
  await writePublicArtifactManifest(root, [
    ...media.files,
    ...pages.files,
    ...feeds.files,
  ]);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await buildSite(undefined, { partial: process.argv.includes("--partial") });

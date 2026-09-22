import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildGroupCatalog } from "./groupCatalog.mjs";
import { readEventAssets } from "./eventAssets.mjs";

/** 仅素材维护时调用；正式构建可直接校验已生成清单，无须 Python。 */
export async function prepareMedia(
  root,
  {
    python = "python",
    outputRoot = root,
    reportRoot = path.join(root, "reports/city-upgrade-c"),
  } = {},
) {
  const catalog = await buildGroupCatalog(root);
  const { dataset } = await readEventAssets(root);
  const images = new Map();
  for (const image of [
    ...catalog.groups.flatMap((group) => [group.avatar, group.visual]),
    ...dataset.events.map((event) => event.poster),
  ].filter(Boolean)) {
    if (!image.src.startsWith("assets/")) continue;
    const record = images.get(image.src) ?? { src: image.src, sources: [] };
    if (image.sourceUrl && !record.sources.includes(image.sourceUrl))
      record.sources.push(image.sourceUrl);
    images.set(image.src, record);
  }
  await mkdir(reportRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const input = path.join(reportRoot, "media-input.json");
  await writeFile(
    input,
    JSON.stringify({
      images: [...images.values()].sort((a, b) => a.src.localeCompare(b.src)),
    }),
    "utf8",
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [
        fileURLToPath(new URL("./optimizeMedia.py", import.meta.url)),
        "--root",
        root,
        "--output-root",
        outputRoot,
        "--input",
        input,
      ],
      { stdio: "inherit", windowsHide: true },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`图片生成失败：${code}`)),
    );
  });
  const variants = path.join(outputRoot, "src/media/variants.json");
  await writeFile(
    variants,
    await format(await readFile(variants, "utf8"), { parser: "json" }),
    "utf8",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await prepareMedia(path.resolve(process.argv[2] ?? "."));

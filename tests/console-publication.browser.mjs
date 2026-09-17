import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  copyFile,
  mkdtemp,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  entryPoints,
  publicFiles,
  imageFolders,
  isPublicImage,
} from "../scripts/siteManifest.mjs";
import { readEventAssets } from "../scripts/eventAssets.mjs";

// 独立构建公开候选，调用生产发布浏览器校验；不写共享 .build，不执行发布或推送。
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = path.join(root, "reports/console-integration");
await mkdir(evidence, { recursive: true });
const source = await mkdtemp(path.join(evidence, "publication-"));
const files = [...publicFiles];
for (const folder of imageFolders) {
  for (const item of await readdir(path.join(root, "assets", folder))) {
    const name = `assets/${folder}/${item}`;
    if (isPublicImage(name)) files.push(name);
  }
}
files.push(...(await readEventAssets(root)).localPosters);
const output = await build({
  absWorkingDir: root,
  entryPoints,
  outdir: "assets",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  charset: "utf8",
  write: false,
});
const bundles = new Map(
  output.outputFiles.map((file) => [
    path.relative(root, file.path).replaceAll("\\", "/"),
    file.contents,
  ]),
);
for (const name of files) {
  const target = path.join(source, name);
  await mkdir(path.dirname(target), { recursive: true });
  if (bundles.has(name)) await writeFile(target, bundles.get(name));
  else await copyFile(path.join(root, name), target);
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lines = [];
for (const name of files.sort())
  lines.push(`${hash(await readFile(path.join(source, name)))}  ${name}`);
await writeFile(path.join(source, "manifest.sha256"), lines.join("\n") + "\n");
const compiled = await build({
  entryPoints: [
    path.join(root, "maintenance/runtime/private/server/publisher.ts"),
  ],
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  write: false,
  plugins: [
    {
      name: "host-playwright",
      setup(builder) {
        builder.onResolve({ filter: /^playwright$/ }, () =>
          process.env.PLAYWRIGHT_MODULE
            ? {
                path: pathToFileURL(process.env.PLAYWRIGHT_MODULE).href,
                external: true,
              }
            : undefined,
        );
      },
    },
  ],
});
const publisherFile = path.join(evidence, "publisher-browser.mjs");
await writeFile(publisherFile, compiled.outputFiles[0].contents);
const publisher = await import(pathToFileURL(publisherFile).href);
assert.equal(
  (await publisher.inspectPublicationCandidate(source)).publicFileCount,
  files.length,
);
await publisher.validatePublicationCandidate(source);
await writeFile(
  path.join(evidence, "publication-browser.json"),
  JSON.stringify(
    {
      passed: true,
      publicFiles: files.length,
      manifestSha256: hash(
        await readFile(path.join(source, "manifest.sha256")),
      ),
      paths: ["index.html", "events.html", "groups.html"],
      analytics: "本地200，recorded:false，不保存或转发",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "生产发布浏览器校验通过：三个实际页面、统计不落盘、文件清单前后哈希一致。",
);

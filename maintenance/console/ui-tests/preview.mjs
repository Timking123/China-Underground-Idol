import { build } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = path.join(root, "reports/console-ui");
await mkdir(path.join(out, "public"), { recursive: true });
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
await copyFile(
  path.join(root, "maintenance/console/public/admin.css"),
  path.join(out, "public/admin.css"),
);
const html = await readFile(
  path.join(root, "maintenance/console/public/index.html"),
  "utf8",
);
await writeFile(
  path.join(out, "public/index.html"),
  html.replace(
    "<body>",
    '<body><p class="fixture-banner">本机界面验收 · 所有访问量、投稿与账号均为合成样本</p>',
  ),
  "utf8",
);
await build({
  absWorkingDir: root,
  entryPoints: ["maintenance/console/ui-tests/fixture.ts"],
  outfile: path.join(out, "fixture.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.14",
  charset: "utf8",
});
if (!process.argv.includes("--build-only"))
  await import(
    new URL("../../../reports/console-ui/fixture.mjs", import.meta.url)
  );

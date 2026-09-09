import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSite } from "../scripts/build.mjs";
import { entryPoints, publicFiles } from "../scripts/siteManifest.mjs";

test("完整发布输入必须显式携带粉丝观察层，不能静默遗漏", async () => {
  const evidence = fileURLToPath(
    new URL("../.build/input-tests/", import.meta.url),
  );
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, "missing-followers-"));
  for (const name of [
    ...Object.values(entryPoints),
    ...publicFiles.filter((file) => !file.startsWith("assets/")),
  ]) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), "");
  }
  await assert.rejects(
    buildSite(root),
    /模块尚未齐全：data\/follower-observations.v1.json/,
  );
});

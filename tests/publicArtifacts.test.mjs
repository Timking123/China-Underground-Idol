import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  artifactManifestPath,
  isGeneratedPublicPath,
  readPublicArtifactManifest,
  validateArtifactManifest,
  writePublicArtifactManifest,
} from "../scripts/publicArtifacts.mjs";

const reportRoot = fileURLToPath(
  new URL("../reports/city-upgrade-f/", import.meta.url),
);
await mkdir(reportRoot, { recursive: true });

async function fixture() {
  const root = await mkdtemp(path.join(reportRoot, "artifact-test-"));
  await mkdir(path.join(root, "feeds/v1"), { recursive: true });
  await writeFile(
    path.join(root, "feeds/v1/manifest.json"),
    '{"synthetic":true}\n',
  );
  return root;
}

test("动态资源按精确清单及哈希回读，未知文件不会因目录白名单公开", async () => {
  const root = await fixture();
  const manifest = await writePublicArtifactManifest(root, [
    "feeds/v1/manifest.json",
  ]);
  assert.equal(manifest.files.length, 1);
  assert.deepEqual(await readPublicArtifactManifest(root), manifest);
  await writeFile(path.join(root, "feeds/v1/private.json"), "不得公开");
  assert.deepEqual(await readPublicArtifactManifest(root), manifest);
  await writeFile(path.join(root, "feeds/v1/manifest.json"), "已变化");
  await assert.rejects(readPublicArtifactManifest(root), /已变化/);
});

test("清单拒绝穿越、未知目录、重复路径、额外字段与非普通文件", async () => {
  for (const name of [
    "../private.json",
    "feeds/v1/../x.ics",
    "assets/admin.js",
    "data/events.v1.json",
    "groups/g001.html/evil",
    "assets/page-data/private.json",
    "feeds/v1/cities/zz.ics",
  ])
    assert.equal(isGeneratedPublicPath(name), false, name);
  const root = await fixture();
  const manifest = await writePublicArtifactManifest(root, [
    "feeds/v1/manifest.json",
  ]);
  assert.throws(() =>
    validateArtifactManifest({ ...manifest, secret: "不允许" }),
  );
  assert.throws(() =>
    validateArtifactManifest({
      ...manifest,
      files: [...manifest.files, ...manifest.files],
    }),
  );
  await assert.rejects(
    writePublicArtifactManifest(root, [
      "feeds/v1/manifest.json",
      "feeds/v1/manifest.json",
    ]),
    /重复/,
  );
  await assert.rejects(
    writePublicArtifactManifest(root, ["assets/admin.js"]),
    /非白名单/,
  );
  const linked = await fixture();
  await symlink(
    path.join(root, "assets"),
    path.join(linked, "assets"),
    "junction",
  );
  await assert.rejects(readPublicArtifactManifest(linked), /普通文件/);
  assert.ok((await readFile(path.join(root, artifactManifestPath))).length > 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  link,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  consoleFiles,
  packageConsole,
} from "../../../scripts/packageConsole.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "idol-console-package-"));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("idol-console-package-"));
    await rm(root, { recursive: true, force: true });
  });
  const output = path.join(root, ".build/console");
  await mkdir(path.join(output, "public"), { recursive: true });
  for (const name of consoleFiles)
    await writeFile(path.join(output, name), `synthetic:${name}\n`);
  return { root, output };
}

test("管理包只含固定文件且清单绑定每个字节", async (t) => {
  const { root, output } = await fixture(t);
  await packageConsole(root);
  const lines = (await readFile(path.join(output, "manifest.sha256"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(lines.length, consoleFiles.length);
  for (const line of lines) {
    const [hash, name] = line.split("  ");
    assert.ok(consoleFiles.includes(name));
    assert.equal(
      hash,
      createHash("sha256")
        .update(await readFile(path.join(output, name)))
        .digest("hex"),
    );
  }
});

test("管理包拒绝意外私人文件、缺失文件和硬链接", async (t) => {
  for (const fault of ["private", "missing", "hardlink"])
    await t.test(fault, async (subtest) => {
      const { root, output } = await fixture(subtest);
      if (fault === "private")
        await writeFile(path.join(output, "console.sqlite"), "合成私人哨兵");
      else if (fault === "missing") await rm(path.join(output, "server.mjs"));
      else
        await link(
          path.join(output, "server.mjs"),
          path.join(root, "linked-server.mjs"),
        );
      await assert.rejects(packageConsole(root), /管理发行包/u);
      await assert.rejects(readFile(path.join(output, "manifest.sha256")), {
        code: "ENOENT",
      });
    });
});

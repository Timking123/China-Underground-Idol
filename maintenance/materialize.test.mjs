import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { SOURCE_PROVENANCE, STAGE, ARCHIVE } from "./materialize.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const productionCode = await readFile(
  new URL("./materialize.mjs", import.meta.url),
  "utf8",
);
const originals = {
  "maintenance/runtime/private/src/core.ts": "export const synthetic = true;\n",
  "maintenance/legacy/tools/weekly_profile_refresh.mjs":
    "export const synthetic = true;\n",
};
const fakeProvenance = Object.entries(originals).map(([name, bytes]) => ({
  path: name,
  source: name,
  origin: "synthetic",
  sha256: hash(bytes),
  packagedSha256: hash(bytes),
  bytes: Buffer.byteLength(bytes),
}));
async function put(root, name, value = "合成文件\n") {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
  return target;
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "idol-materialize-"));
  // 删除范围固定为本测试创建的临时根；不访问实际工作区或旧档案。
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("idol-materialize-"));
    await rm(root, { recursive: true, force: true });
  });
  const options = {
    repoRoot: path.join(root, "repo"),
    workspaceRoot: path.join(root, "workspace"),
    privateSeedRoot: path.join(root, "seed"),
  };
  await mkdir(options.privateSeedRoot);
  for (const [name, bytes] of Object.entries(originals))
    await put(options.repoRoot, name, bytes);
  await put(
    options.repoRoot,
    "index.html",
    "<!doctype html><title>合成站点</title>\n",
  );
  await put(options.repoRoot, "package.json", '{"private":true}\n');
  await put(options.repoRoot, "data/events.v1.json", '{"events":[]}\n');
  await put(options.repoRoot, "src/site.ts", "export {};\n");
  await put(
    options.repoRoot,
    "maintenance/runtime/private/server/runner.ts",
    "export {};\n",
  );
  await put(
    options.repoRoot,
    "maintenance/runtime/private/tests/serverRunner.test.mjs",
    "export {};\n",
  );
  await put(options.repoRoot, ".git/config", "不应复制\n");
  await put(options.repoRoot, "node_modules/private.txt", "不应复制\n");
  await put(options.repoRoot, ".build/private.txt", "不应复制\n");
  await put(options.repoRoot, "maintenance/README.md", "不应复制为 site\n");
  await put(
    options.privateSeedRoot,
    "ledger/private.json",
    '{"secret":"测试专用，不应读取或复制"}\n',
  );
  // 只在临时模块中替换固定来源表，生产 API 不提供绕过来源 SHA 的入口。
  const fakeCode = productionCode.replace(
    /export const SOURCE_PROVENANCE = Object\.freeze\(\[[\s\S]*?\]\);/u,
    `export const SOURCE_PROVENANCE = Object.freeze(${JSON.stringify(fakeProvenance)});`,
  );
  assert.notEqual(fakeCode, productionCode);
  const modulePath = await put(root, `fixture-${randomUUID()}.mjs`, fakeCode);
  const { materialize } = await import(pathToFileURL(modulePath).href);
  return { root, options, materialize, modulePath };
}

test("来源清单覆盖43个原文件，核心与旧工具 SHA 不变", () => {
  assert.equal(SOURCE_PROVENANCE.length, 43);
  assert.equal(
    SOURCE_PROVENANCE.filter((entry) =>
      entry.path.startsWith("maintenance/legacy/"),
    ).length,
    8,
  );
  for (const entry of SOURCE_PROVENANCE) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
    assert.match(entry.packagedSha256, /^[a-f0-9]{64}$/u);
    if (entry.path === "maintenance/runtime/private/tests/pipeline.test.mjs") {
      assert.equal(
        entry.sha256,
        "74ce8ef70fe821782cc16d5355008649cb1b6a47fa8a0c225ee2d72cbcd89001",
      );
      assert.notEqual(entry.sha256, entry.packagedSha256);
    } else if (
      entry.path === "maintenance/runtime/private/tests/pipelineStore.test.mjs"
    ) {
      assert.equal(
        entry.sha256,
        "26ad1e8366d23526c5069bcc0ae0075bdc95637f349ee426a84177cc4b9214fd",
      );
      assert.notEqual(entry.sha256, entry.packagedSha256);
    } else if (/\/(?:src|tests|tools)\/|\/cli\.ts$/u.test(entry.path))
      assert.equal(entry.sha256, entry.packagedSha256);
  }
});

test("清单模式无写入，首次复制为普通文件且只保留白名单", async (t) => {
  const { options, materialize } = await fixture(t);
  const plan = await materialize({ ...options, planOnly: true });
  assert.equal(plan.mode, "plan");
  await assert.rejects(lstat(options.workspaceRoot), { code: "ENOENT" });
  assert.equal(plan.files.length, 8);
  assert.ok(
    plan.files.every(
      (entry) =>
        !/node_modules|\.git|\.build|ledger|private\.txt/u.test(entry.source),
    ),
  );
  const result = await materialize(options);
  assert.equal(result.mode, "created");
  assert.equal(result.sourceSha256, plan.sourceSha256);
  for (const entry of result.files) {
    const target = path.join(options.workspaceRoot, entry.destination);
    assert.equal((await lstat(target)).isSymbolicLink(), false);
    assert.equal(hash(await readFile(target)), entry.sha256);
  }
  assert.equal(
    (
      await lstat(path.join(options.workspaceRoot, STAGE, "site"))
    ).isSymbolicLink(),
    false,
  );
  assert.equal(
    await readFile(
      path.join(options.privateSeedRoot, "ledger/private.json"),
      "utf8",
    ),
    '{"secret":"测试专用，不应读取或复制"}\n',
  );
  await assert.rejects(
    lstat(path.join(options.workspaceRoot, STAGE, "site/maintenance")),
    { code: "ENOENT" },
  );
});

test("重复物化只核验身份，不覆盖额外运行态或改变源码 mtime", async (t) => {
  const { options, materialize } = await fixture(t);
  const first = await materialize(options);
  const target = path.join(options.workspaceRoot, STAGE, "private/src/core.ts");
  const before = await lstat(target);
  const ledger = await put(
    options.workspaceRoot,
    `${STAGE}/private/weekly-runtime/ledger.json`,
    "仅运行态\n",
  );
  const repeated = await materialize(options);
  assert.equal(repeated.mode, "verified");
  assert.equal(repeated.sourceSha256, first.sourceSha256);
  assert.equal((await lstat(target)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(ledger, "utf8"), "仅运行态\n");
});

test("原始来源 SHA 漂移先停止，工作区尚未产生", async (t) => {
  const { options, materialize } = await fixture(t);
  await put(
    options.repoRoot,
    "maintenance/runtime/private/src/core.ts",
    "篡改\n",
  );
  await assert.rejects(materialize(options), /source_hash_mismatch/u);
  await assert.rejects(lstat(options.workspaceRoot), { code: "ENOENT" });
});

test("已标记工作区夹带未知源码时停止，私有运行态仍可保留", async (t) => {
  const { options, materialize } = await fixture(t);
  await materialize(options);
  await put(
    options.workspaceRoot,
    `${STAGE}/private/src/unknown.ts`,
    "export {};\n",
  );
  await assert.rejects(materialize(options), /existing_unmanaged_source/u);
});

test("已有源码与来源清单冲突均不覆盖", async (t) => {
  const { options, materialize } = await fixture(t);
  await materialize(options);
  const target = await put(
    options.workspaceRoot,
    `${STAGE}/site/index.html`,
    "已有维护内容\n",
  );
  await assert.rejects(materialize(options), /existing_source_conflict/u);
  assert.equal(await readFile(target, "utf8"), "已有维护内容\n");
  await put(options.repoRoot, "index.html", "新仓库版本\n");
  await assert.rejects(
    materialize(options),
    /existing_source_identity_conflict/u,
  );
});

test("未标记旧工作区和半安装目录停止，保留原内容", async (t) => {
  const { options, materialize } = await fixture(t);
  const sentinel = await put(
    options.workspaceRoot,
    "unrelated.txt",
    "旧内容\n",
  );
  await assert.rejects(
    materialize(options),
    /existing_workspace_without_source_identity/u,
  );
  assert.deepEqual(await readdir(options.workspaceRoot), ["unrelated.txt"]);
  assert.equal(await readFile(sentinel, "utf8"), "旧内容\n");
  const another = {
    ...options,
    workspaceRoot: path.join(
      path.dirname(options.workspaceRoot),
      "second-workspace",
    ),
  };
  await materialize(another);
  await rename(
    path.join(another.workspaceRoot, ARCHIVE, "tools"),
    path.join(another.workspaceRoot, ARCHIVE, "tools-held"),
  );
  await assert.rejects(
    materialize({ ...another, planOnly: true }),
    /partial_existing_installation/u,
  );
  await assert.rejects(
    lstat(path.join(another.workspaceRoot, ARCHIVE, "tools")),
    { code: "ENOENT" },
  );
});

for (const file of [
  "maintenance/runtime/private/ledger.json",
  "maintenance/legacy/tools/private.json",
  "data/raw-evidence.json",
  "src/session.json",
  ".env",
]) {
  test(`私有或未知文件混入停止：${file}`, async (t) => {
    const { options, materialize } = await fixture(t);
    await put(options.repoRoot, file, "合成敏感哨兵\n");
    await assert.rejects(
      materialize(options),
      /not_allowed|private_file_forbidden/u,
    );
    await assert.rejects(lstat(options.workspaceRoot), { code: "ENOENT" });
  });
}

test("根参数必须绝对、互不重叠且不含路径逃逸", async (t) => {
  const { options, materialize } = await fixture(t);
  await assert.rejects(
    materialize({ ...options, workspaceRoot: "relative" }),
    /absolute_workspaceRoot_required/u,
  );
  await assert.rejects(
    materialize({
      ...options,
      workspaceRoot: path.join(options.repoRoot, "nested"),
    }),
    /overlapping_roots/u,
  );
  await assert.rejects(
    materialize({
      ...options,
      workspaceRoot: `${options.workspaceRoot}${path.sep}..${path.sep}escape`,
    }),
    /path_escape/u,
  );
  await assert.rejects(
    materialize({
      ...options,
      workspaceRoot: path.parse(options.workspaceRoot).root,
    }),
    /filesystem_root_forbidden/u,
  );
});

test("目录链接与父路径链接在复制前停止", async (t) => {
  const { root, options, materialize } = await fixture(t);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    path.join(options.repoRoot, "assets"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(materialize(options), /symbolic_link/u);
  const linked = path.join(root, "linked-parent");
  await symlink(
    outside,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    materialize({ ...options, workspaceRoot: path.join(linked, "workspace") }),
    /symbolic_link/u,
  );
  assert.deepEqual(await readdir(outside), []);
});

test("已有运行源码父目录被替换为链接后停止", async (t) => {
  const { root, options, materialize } = await fixture(t);
  await materialize(options);
  const site = path.join(options.workspaceRoot, STAGE, "site");
  const moved = path.join(root, "moved-site");
  await rename(site, moved);
  await symlink(moved, site, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(materialize(options), /symbolic_link/u);
});

test("CLI 清单入口可运行，缺参和重复参数以非零退出", async (t) => {
  const { options, modulePath } = await fixture(t);
  const argumentsList = [
    modulePath,
    "--repo-root",
    options.repoRoot,
    "--workspace-root",
    options.workspaceRoot,
    "--private-seed-root",
    options.privateSeedRoot,
    "--plan",
  ];
  const result = spawnSync(process.execPath, argumentsList, {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, "plan");
  const missing = spawnSync(process.execPath, [modulePath, "--plan"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /absolute_repoRoot_required/u);
  const repeated = spawnSync(process.execPath, [...argumentsList, "--plan"], {
    encoding: "utf8",
  });
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /duplicate_argument/u);
});

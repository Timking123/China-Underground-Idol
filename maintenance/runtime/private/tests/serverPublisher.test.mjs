import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPublicationPreparer,
  inspectPublicationCandidate,
  PUBLIC_FILES,
} from "../server/publisher.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const INPUT = "data/events.v1.json";
const FOLLOWERS = "data/follower-observations.v2.json";
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
async function put(root, name, value) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}
async function candidate(root) {
  const entries = [];
  for (const name of [...PUBLIC_FILES].sort()) {
    const value = `synthetic:${name}\n`;
    await put(root, name, value);
    entries.push(`${hash(value)}  ${name}`);
  }
  await put(root, "manifest.sha256", `${entries.join("\n")}\n`);
}
async function fixture(t, overrides = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "idol-publisher-"));
  t.after(async () => {
    assert.equal(path.dirname(base), os.tmpdir());
    assert.ok(path.basename(base).startsWith("idol-publisher-"));
    await rm(base, { recursive: true, force: true });
  });
  const repoRoot = path.join(base, "maintenance/repo");
  const stateRoot = path.join(base, "maintenance/state");
  const stageRoot = path.join(
    base,
    "maintenance/workspace/work/phase3-20260909",
  );
  await mkdir(stateRoot, { recursive: true });
  const tracked = [INPUT, FOLLOWERS, "index.html", "assets/events.js"];
  for (const name of tracked) {
    await put(repoRoot, name, "original\n");
    await put(
      path.join(stageRoot, "site"),
      name,
      name === INPUT ? "updated\n" : "original\n",
    );
  }
  const source = path.join(repoRoot, ".build/site");
  const calls = [];
  let committed = false;
  const changed = [INPUT, "assets/events.js"];
  const deps = {
    base,
    now: () => new Date("2026-09-09T18:00:00Z"),
    baseline: async () => ({
      previous: "releases/old-release",
      previousManifestSha256: "c".repeat(64),
      configSha256: "d".repeat(64),
    }),
    browser: async (target) => {
      calls.push(["browser", target]);
      assert.equal(target, source);
    },
    command: async (file, rawArgs, cwd) => {
      assert.equal(cwd, repoRoot);
      const args = file === "git" ? rawArgs.slice(2) : rawArgs;
      calls.push([file, ...args]);
      if (overrides.command) {
        const value = await overrides.command(file, args, {
          repoRoot,
          source,
          committed,
          calls,
        });
        if (value !== undefined) return value;
      }
      if (file === "npm") {
        await candidate(source);
        await put(repoRoot, "assets/events.js", "generated\n");
        return "built";
      }
      if (args[0] === "branch") return "main\n";
      if (args[0] === "status") return "";
      if (args[0] === "fetch") return "";
      if (args[0] === "rev-parse") return `${committed ? NEW : OLD}\n`;
      if (args[0] === "ls-files")
        return args.includes("--others") ? "" : `${tracked.join("\0")}\0`;
      if (args[0] === "diff")
        return args.includes("--cached") && !args.includes("-z")
          ? ""
          : `${changed.join("\0")}\0`;
      if (args[0] === "commit") {
        committed = true;
        return "committed";
      }
      if (args[0] === "ls-remote") return `${NEW}\trefs/heads/main\n`;
      if (args[0] === "add" || args[0] === "push") return "";
      throw new Error(`unexpected fake command: ${args[0]}`);
    },
  };
  if (overrides.browser) deps.browser = overrides.browser;
  const options = {
    repoRoot,
    stateRoot,
    stageRoot,
    runId: "synthetic-20260910",
  };
  return {
    base,
    deps,
    options,
    source,
    calls,
    prepare: createPublicationPreparer(deps),
  };
}

test("准备顺序绑定真实候选清单、提交推送及上海日期请求", async (t) => {
  const { prepare, options, calls, source } = await fixture(t);
  const result = await prepare(options);
  assert.equal(result.changed, true);
  const request = JSON.parse(await readFile(result.requestPath, "utf8"));
  assert.equal(request.schemaVersion, "idol-publish-request-v1");
  assert.equal(request.source, source);
  assert.equal(request.baseSha, OLD);
  assert.equal(request.newSha, NEW);
  assert.equal(request.release, `auto-2026-09-10-${NEW.slice(0, 12)}`);
  assert.equal(request.publicFileCount, PUBLIC_FILES.size);
  const verified = await readFile(
    path.join(options.stateRoot, "publish/verified", `${options.runId}.json`),
  );
  assert.equal(hash(verified), request.verificationSha256);
  const browserIndex = calls.findIndex((call) => call[0] === "browser");
  const commitIndex = calls.findIndex((call) => call[1] === "commit");
  const pushIndex = calls.findIndex((call) => call[1] === "push");
  assert.ok(
    browserIndex >= 0 && commitIndex > browserIndex && pushIndex > commitIndex,
  );
  assert.deepEqual(calls[pushIndex], ["git", "push", "origin", "HEAD:main"]);
  await assert.rejects(
    lstat(path.join(options.stateRoot, "publish/.prepare.lock")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    lstat(path.join(options.stateRoot, "publish/preparing.json")),
    { code: "ENOENT" },
  );
});

test("提交推送后请求落盘前失败：未闭合准备标记阻止次日无变化成功", async (t) => {
  const f = await fixture(t);
  const baseline = f.deps.baseline;
  let calls = 0;
  f.deps.baseline = async () => {
    if (++calls === 3)
      throw new Error("synthetic_post_push_baseline_unavailable");
    return baseline();
  };
  await assert.rejects(
    f.prepare(f.options),
    /synthetic_post_push_baseline_unavailable/u,
  );
  assert.equal(f.calls.filter((call) => call[1] === "commit").length, 1);
  assert.equal(f.calls.filter((call) => call[1] === "push").length, 1);
  const file = path.join(f.options.stateRoot, "publish/preparing.json");
  const guard = await readFile(file);
  const value = JSON.parse(guard);
  assert.equal(value.runId, f.options.runId);
  assert.equal(value.baseSha, OLD);
  assert.deepEqual(value.inputs, [
    {
      path: INPUT,
      beforeSha256: hash("original\n"),
      afterSha256: hash("updated\n"),
    },
  ]);
  await assert.rejects(
    lstat(path.join(f.options.stateRoot, "publish/pending.json")),
    { code: "ENOENT" },
  );
  assert.deepEqual(
    await readFile(path.join(f.options.repoRoot, INPUT)),
    await readFile(path.join(f.options.stageRoot, "site", INPUT)),
  );
  const beforeRetry = f.calls.length;
  await assert.rejects(
    f.prepare({ ...f.options, runId: "synthetic-20260911" }),
    /publication_preparing_requires_review/u,
  );
  assert.equal(f.calls.length, beforeRetry);
  assert.deepEqual(await readFile(file), guard);
});

test("准备写入前失败不制造标记，次日仍按实际源diff准备", async (t) => {
  const f = await fixture(t);
  const baseline = f.deps.baseline;
  let calls = 0;
  f.deps.baseline = async () => {
    if (++calls === 1)
      throw new Error("synthetic_initial_baseline_unavailable");
    return baseline();
  };
  await assert.rejects(
    f.prepare(f.options),
    /synthetic_initial_baseline_unavailable/u,
  );
  assert.equal(
    await readFile(path.join(f.options.repoRoot, INPUT), "utf8"),
    "original\n",
  );
  await assert.rejects(
    lstat(path.join(f.options.stateRoot, "publish/preparing.json")),
    { code: "ENOENT" },
  );
  const next = await f.prepare({ ...f.options, runId: "synthetic-20260911" });
  assert.equal(next.changed, true);
  assert.equal(
    JSON.parse(await readFile(next.requestPath)).runId,
    "synthetic-20260911",
  );
});

test("commit、push及pending写入失败均保留准备标记，重入不重推", async (t) => {
  for (const point of ["commit", "push", "pending"]) {
    await t.test(point, async (subtest) => {
      const f = await fixture(subtest, {
        command: async (_file, args) => {
          if (args[0] === point) throw new Error(`synthetic_${point}_failure`);
        },
      });
      if (point === "pending") {
        const baseline = f.deps.baseline;
        let calls = 0;
        f.deps.baseline = async () => {
          if (++calls === 3)
            await put(
              f.options.stateRoot,
              "publish/pending.json",
              "其他请求前像\n",
            );
          return baseline();
        };
      }
      await assert.rejects(
        f.prepare(f.options),
        point === "pending"
          ? /EEXIST/u
          : new RegExp(`synthetic_${point}_failure`, "u"),
      );
      const file = path.join(f.options.stateRoot, "publish/preparing.json");
      const guard = await readFile(file);
      const callCount = f.calls.length;
      await assert.rejects(
        f.prepare({ ...f.options, runId: "synthetic-20260911" }),
        /publication_preparing_requires_review/u,
      );
      assert.equal(f.calls.length, callCount);
      assert.deepEqual(await readFile(file), guard);
      if (point === "pending")
        assert.equal(
          await readFile(
            path.join(f.options.stateRoot, "publish/pending.json"),
            "utf8",
          ),
          "其他请求前像\n",
        );
    });
  }
});

test("无数据变化不构建、不打开浏览器、不提交", async (t) => {
  const { prepare, options, calls } = await fixture(t);
  await put(path.join(options.stageRoot, "site"), INPUT, "original\n");
  // 物化区旧构建产物不会阻断下一轮，维护源仍严格比对。
  await put(
    path.join(options.stageRoot, "site"),
    "assets/events.js",
    "old generated\n",
  );
  assert.deepEqual(await prepare(options), { changed: false });
  assert.ok(
    calls.every(
      (call) =>
        call[0] !== "npm" && call[0] !== "browser" && call[1] !== "commit",
    ),
  );
});

test("已有pending停止且不覆盖", async (t) => {
  const { prepare, options, calls } = await fixture(t);
  await put(options.stateRoot, "publish/pending.json", "pending sentinel");
  await assert.rejects(prepare(options), /publication_pending_exists/u);
  assert.equal(
    await readFile(
      path.join(options.stateRoot, "publish/pending.json"),
      "utf8",
    ),
    "pending sentinel",
  );
  assert.equal(calls.length, 0);
});

for (const [name, override, expected] of [
  [
    "工作树脏",
    async (_file, args) => (args[0] === "status" ? " M index.html" : undefined),
    /publication_repo_dirty/u,
  ],
  [
    "origin漂移",
    async (_file, args) =>
      args[0] === "rev-parse" && args[1] === "refs/remotes/origin/main"
        ? "c".repeat(40)
        : undefined,
    /publication_origin_drift/u,
  ],
  [
    "构建修改越界",
    async (_file, args) =>
      args[0] === "diff" && !args.includes("--cached")
        ? "index.html\0"
        : undefined,
    /publication_unexpected_build_change/u,
  ],
]) {
  test(`${name}不会提交或推送`, async (t) => {
    const { prepare, options, calls } = await fixture(t, { command: override });
    await assert.rejects(prepare(options), expected);
    assert.ok(
      calls.every((call) => call[1] !== "commit" && call[1] !== "push"),
    );
  });
}

test("非授权维护源变化先停止且仓库数据不变", async (t) => {
  const { prepare, options } = await fixture(t);
  await put(
    path.join(options.stageRoot, "site"),
    "index.html",
    "unrelated edit",
  );
  await assert.rejects(
    prepare(options),
    /publication_unexpected_maintenance_change/u,
  );
  assert.equal(
    await readFile(path.join(options.repoRoot, INPUT), "utf8"),
    "original\n",
  );
});

test("浏览器失败不会提交、推送或生成pending", async (t) => {
  const { prepare, options, calls } = await fixture(t, {
    browser: async () => {
      throw new Error("synthetic_browser_failure");
    },
  });
  await assert.rejects(prepare(options), /synthetic_browser_failure/u);
  assert.ok(calls.every((call) => call[1] !== "commit" && call[1] !== "push"));
  await assert.rejects(
    lstat(path.join(options.stateRoot, "publish/pending.json")),
    { code: "ENOENT" },
  );
});

test("候选拒绝清单篡改、未知文件和符号链接", async (t) => {
  const { source, base } = await fixture(t);
  await candidate(source);
  const expected = await inspectPublicationCandidate(source);
  assert.equal(expected.publicFileCount, PUBLIC_FILES.size);
  await put(source, "assets/events.js", "tampered");
  await assert.rejects(
    inspectPublicationCandidate(source),
    /publication_candidate_hash/u,
  );
  await candidate(source);
  await put(source, "private.json", "private sentinel");
  await assert.rejects(
    inspectPublicationCandidate(source),
    /publication_candidate_file_set/u,
  );
  const alternate = path.join(base, "alternative");
  await mkdir(alternate);
  await symlink(
    alternate,
    path.join(source, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    inspectPublicationCandidate(source),
    /publication_candidate_link/u,
  );
});

test("浏览器后来源修改被冻结hash拦截", async (t) => {
  const state = await fixture(t);
  const prepare = createPublicationPreparer({
    ...state.deps,
    browser: async () => {
      await put(state.options.repoRoot, INPUT, "racing writer\n");
    },
  });
  await assert.rejects(
    prepare(state.options),
    /publication_changed_file_drift/u,
  );
  assert.ok(
    state.calls.every((call) => call[1] !== "commit" && call[1] !== "push"),
  );
});

test("固定路径与runId验证阻止任意目标", async (t) => {
  const { prepare, options } = await fixture(t);
  await assert.rejects(
    prepare({ ...options, runId: "../escape" }),
    /publication_run_id/u,
  );
  await assert.rejects(
    prepare({ ...options, repoRoot: path.dirname(options.repoRoot) }),
    /publication_fixed_paths/u,
  );
});

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireLocalEditorialLock,
  recoverLocalEditorialLock,
} from "./localEditorialLock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const INPUTS = [
  "data/events.v1.json",
  "data/event-verifications.v1.json",
  "data/feed-state.v1.json",
  "data/updates.v1.json",
];

/** 编译既有领域实现；维护模块的 site 引用指向当前明确选择的源码根。 */
export async function loadLocalEditorialRuntime(
  root = ROOT,
  { outputRoot = path.join(root, "reports/city-upgrade-f/runtime") } = {},
) {
  const result = await build({
    stdin: {
      contents: [
        'export { ConsoleStore } from "./maintenance/console/store.ts";',
        'export { hashPassword } from "./maintenance/console/crypto.ts";',
        'export { createConsoleServer } from "./maintenance/console/server.ts";',
        'export { getEditorialHandoff, getEditorialRevision, prepareEditorialCandidate, recordEditorialReceipt, mutateEditorial } from "./maintenance/console/editorial.ts";',
        'export { captureBrowserProof } from "./maintenance/runtime/private/src/sourceCapture.ts";',
        'export { prepareEventUpdate } from "./maintenance/runtime/private/src/eventApplication.ts";',
        'export { validateSourceRegistry } from "./maintenance/runtime/private/src/sourceRegistry.ts";',
        'export { invalidateEventVerifications, validateEventVerificationDataset } from "./src/events/verification.ts";',
        'export { inspectPublicationCandidate } from "./maintenance/runtime/private/server/publisher.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    plugins: [
      {
        name: "维护站点路径",
        setup(builder) {
          builder.onResolve({ filter: /site\/src\// }, (args) => ({
            path: path.join(root, "src", args.path.split("site/src/")[1]),
          }));
        },
      },
    ],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
  });
  const moduleDirectory = path.resolve(outputRoot);
  await mkdir(moduleDirectory, { recursive: true });
  const target = path.join(
    moduleDirectory,
    `${hash(result.outputFiles[0].text)}.mjs`,
  );
  try {
    await writeFile(target, result.outputFiles[0].text, {
      flag: "wx",
      encoding: "utf8",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return import(pathToFileURL(target).href);
}

export async function ordinary(root, name) {
  if (
    path.isAbsolute(name) ||
    name.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")
  )
    throw new Error("本地维护路径无效");
  let target = root;
  for (const part of name.split("/")) {
    target = path.join(target, part);
    if ((await lstat(target)).isSymbolicLink())
      throw new Error("本地维护拒绝链接");
  }
  if (!(await lstat(target)).isFile())
    throw new Error("本地维护只读取普通文件");
  return readFile(target);
}

export async function writeNew(root, name, value) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value, { encoding: "utf8", flag: "wx" });
}

export async function sourceFiles(root) {
  const files = [];
  const { publicFiles, isPublicImage } = await import(
    pathToFileURL(path.join(root, "scripts/siteManifest.mjs")).href
  );
  files.push(...publicFiles.filter((name) => !name.startsWith("assets/")));
  files.push(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "eslint.config.mjs",
    ".prettierrc.json",
    ".prettierignore",
  );
  const visit = async (directory) => {
    for (const entry of await readdir(path.join(root, directory), {
      withFileTypes: true,
    })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`源码快照拒绝链接：${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        if (directory.startsWith("assets")) {
          if (
            isPublicImage(name) ||
            /^assets\/event-posters\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/u.test(
              name,
            ) ||
            /^assets\/media-optimized\/(?:manifest\.v1\.json|[a-f0-9]{20}-\d+\.webp)$/u.test(
              name,
            )
          )
            files.push(name);
        } else files.push(name);
      } else throw new Error(`源码快照拒绝特殊文件：${name}`);
    }
  };
  for (const directory of ["src", "scripts", "data", "styles", "assets"])
    await visit(directory);
  return [...new Set(files)].sort();
}

async function run(file, args, cwd, log) {
  const chunks = [];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (value) => chunks.push(value));
    child.stderr.on("data", (value) => chunks.push(value));
    child.once("error", reject);
    child.once("exit", resolve);
  });
  await writeFile(log, Buffer.concat(chunks));
  if (code !== 0)
    throw new Error(`本地维护验证失败：${path.basename(log)}（${code}）`);
}

export async function verifySources(source, entries) {
  for (const item of entries)
    if (hash(await ordinary(source, item.path)) !== item.sha256)
      throw new Error(`封口快照已变化：${item.path}`);
}

/** 独立候选快照只生成本地发行物；绝不写生产目录或当前资料源。 */
export async function applyLocalEditorial({
  root = ROOT,
  workspace,
  store,
  revisionId,
  evidence,
  now = new Date(),
  runtime,
  beforeCommit,
  afterCommit,
}) {
  runtime ??= await loadLocalEditorialRuntime(root);
  root = path.resolve(root);
  workspace = path.resolve(workspace);
  if (!workspace.startsWith(`${path.join(root, "reports")}${path.sep}`))
    throw new Error("本地候选目录必须位于当前仓库 reports 内");
  await mkdir(workspace, { recursive: true });
  if ((await lstat(workspace)).isSymbolicLink())
    throw new Error("候选根不能是链接");
  const lock = await acquireLocalEditorialLock(workspace);
  try {
    const revision = runtime.getEditorialRevision(store, revisionId);
    const candidate = revision.candidate;
    if (!candidate) throw new Error("修订没有已交付候选");
    const output = path.join(workspace, candidate.candidateId);
    const completion = path.join(output, "completed.json");
    try {
      const saved = JSON.parse(await readFile(completion, "utf8"));
      if (saved.candidateSha256 !== revision.candidateSha256)
        throw new Error("重复应用候选不一致");
      const snapshotRaw = await ordinary(output, "snapshot.json");
      if (hash(snapshotRaw) !== saved.receipt.snapshotManifestSha256)
        throw new Error("重复应用快照变化");
      const snapshot = JSON.parse(snapshotRaw);
      const sourceManifest = JSON.parse(
        await ordinary(output, "source-manifest.json"),
      );
      if (hash(encode(sourceManifest)) !== snapshot.sourceManifestSha256)
        throw new Error("源码清单变化");
      await verifySources(path.join(output, "source"), sourceManifest.files);
      const publication = await runtime.inspectPublicationCandidate(
        path.join(output, "source/.build/site"),
      );
      if (publication.manifestSha256 !== snapshot.publicManifestSha256)
        throw new Error("重复应用发行物变化");
      runtime.recordEditorialReceipt(
        store,
        revisionId,
        saved.receipt,
        "本地维护",
        Date.now(),
      );
      return { ...saved, output, replayed: true };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const handoff = runtime.getEditorialHandoff(store, revisionId);
    const baseline = Object.fromEntries(
      await Promise.all(
        INPUTS.map(async (name) => [name, await ordinary(root, name)]),
      ),
    );
    const prepared = runtime.prepareEditorialCandidate(
      handoff.candidate,
      baseline[INPUTS[0]],
      now.getTime(),
    );
    if (prepared.candidateSha256 !== handoff.candidateSha256)
      throw new Error("候选哈希不一致");
    const registry = runtime.validateSourceRegistry(evidence.registry);
    const displayText = (await ordinary(root, "data.js")).toString("utf8");
    const display = JSON.parse(
      /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(
        displayText,
      )?.[1] ?? "null",
    );
    const update = runtime.prepareEventUpdate(
      baseline[INPUTS[0]],
      {
        schemaVersion: "idol-reviewed-event-update-v1",
        baselineSha256: prepared.candidate.baselineSha256,
        reviewedAt: prepared.candidate.reviewedAt,
        reviewedBy: prepared.candidate.reviewedBy,
        changes: [
          {
            action: "update",
            event: prepared.event,
            evidence: prepared.candidate.evidence.map(
              ({ captureId, excerpt, supports }) => ({
                captureId,
                excerpt,
                supports,
              }),
            ),
            rationale: prepared.candidate.rationale,
          },
        ],
      },
      evidence.captures,
      registry,
      display.groups.map((group) => group.id),
      now,
    );
    const oldEvents = JSON.parse(baseline[INPUTS[0]]);
    const oldVerification = JSON.parse(baseline[INPUTS[1]]);
    if (
      !runtime.validateEventVerificationDataset(
        oldVerification,
        oldEvents.events,
      ).valid
    )
      throw new Error("旧核验层无效");
    const verification = runtime.invalidateEventVerifications(
      oldVerification,
      oldEvents.events,
      update.dataset.events,
    );
    if (
      !runtime.validateEventVerificationDataset(
        verification,
        update.dataset.events,
      ).valid
    )
      throw new Error("候选核验层无效");
    const { createFeedRevision, validateFeedLedger } = await import(
      pathToFileURL(path.join(root, "scripts/generateSubscriptions.mjs")).href
    );
    const feed = createFeedRevision({
      events: update.dataset,
      verification,
      previousState: JSON.parse(baseline[INPUTS[2]]),
      previousUpdates: JSON.parse(baseline[INPUTS[3]]),
      recordedAt: now.toISOString(),
      reason: prepared.candidate.rationale,
    });
    validateFeedLedger(feed.state, feed.history);
    const next = {
      [INPUTS[0]]: update.bytes,
      [INPUTS[1]]: encode(verification),
      [INPUTS[2]]: encode(feed.state),
      [INPUTS[3]]: encode(feed.history),
    };
    // 已有未完成目录不接管；失败证据保留，维护者可以另选新的本地候选根。
    await mkdir(output);
    const source = path.join(output, "source");
    const records = [];
    for (const name of await sourceFiles(root)) {
      const value = Object.hasOwn(next, name)
        ? Buffer.from(next[name])
        : await ordinary(root, name);
      await writeNew(source, name, value);
      records.push({ path: name, sha256: hash(value), bytes: value.length });
    }
    const sourceManifest = {
      schemaVersion: "idol-local-source-snapshot-v1",
      files: records,
    };
    await writeNew(output, "source-manifest.json", encode(sourceManifest));
    await verifySources(source, records);
    await run(
      process.execPath,
      [path.join(source, "scripts/build.mjs")],
      source,
      path.join(output, "build.log"),
    );
    await run(
      process.execPath,
      [path.join(source, "scripts/packageSite.mjs")],
      source,
      path.join(output, "package.log"),
    );
    await verifySources(source, records);
    const publication = await runtime.inspectPublicationCandidate(
      path.join(source, ".build/site"),
    );
    // 第二级只调用纯校验函数，不创建生产发布器，不连接服务器。
    await run(
      "python",
      [
        "-c",
        "import sys; from pathlib import Path; from maintenance.publish import verify_site,digest; p=Path(sys.argv[1]); raw=(p/'manifest.sha256').read_bytes(); verify_site(p,digest(raw)); print('Python candidate verification: PASS')",
        path.join(source, ".build/site"),
      ],
      root,
      path.join(output, "publisher-python.log"),
    );
    const snapshot = {
      schemaVersion: "idol-local-editorial-snapshot-v1",
      candidateId: candidate.candidateId,
      candidateSha256: handoff.candidateSha256,
      baseFiles: INPUTS.map((name) => ({
        path: name,
        sha256: hash(baseline[name]),
      })),
      sourceManifestSha256: hash(encode(sourceManifest)),
      publicManifestSha256: publication.manifestSha256,
      resultSha256: hash(update.bytes),
      completedAt: new Date().toISOString(),
    };
    const snapshotManifestSha256 = hash(encode(snapshot));
    await writeNew(output, "snapshot.json", encode(snapshot));
    const receipt = {
      schemaVersion: "idol-editorial-receipt-v1",
      candidateId: candidate.candidateId,
      candidateSha256: handoff.candidateSha256,
      baselineSha256: candidate.baselineSha256,
      resultSha256: hash(update.bytes),
      status: "applied",
      runId: `local-${candidate.candidateId}`,
      publicationId: `local-snapshot-${snapshotManifestSha256}`,
      snapshotManifestSha256,
      message: "本地发行候选已完整生成并校验；未部署服务器。",
      completedAt: snapshot.completedAt,
    };
    if (beforeCommit) await beforeCommit({ output, source, snapshot });
    await verifySources(source, records);
    if (
      (
        await runtime.inspectPublicationCandidate(
          path.join(source, ".build/site"),
        )
      ).manifestSha256 !== publication.manifestSha256
    )
      throw new Error("提交前发行候选已变化");
    const completed = { candidateSha256: handoff.candidateSha256, receipt };
    // SQLite 写事务阻止撤回与提交点交错；完成标识是唯一不可撤回点。
    store.transaction(() => {
      const current = runtime.getEditorialHandoff(store, revisionId);
      if (current.candidateSha256 !== handoff.candidateSha256)
        throw new Error("提交前候选已变化");
      for (const name of INPUTS)
        if (hash(readFileSync(path.join(root, name))) !== hash(baseline[name]))
          throw new Error("提交前公开基线已变化");
      writeFileSync(completion, encode(completed), {
        encoding: "utf8",
        flag: "wx",
      });
    });
    // 仅模块集成测试使用：模拟完成标识落盘后进程中断，CLI不开放故障参数。
    if (afterCommit) await afterCommit({ output, source, snapshot });
    runtime.recordEditorialReceipt(
      store,
      revisionId,
      receipt,
      "本地维护",
      Date.now(),
    );
    return { ...completed, output, replayed: false };
  } finally {
    await lock.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  if (
    args[0] === "--recover-lock" &&
    args.length === 4 &&
    args[2] === "--expected-lock-sha256"
  ) {
    const directory = path.resolve(args[1]);
    if (!directory.startsWith(`${path.join(ROOT, "reports")}${path.sep}`))
      throw new Error("只能恢复当前仓库reports内的本地锁");
    const result = await recoverLocalEditorialLock(directory, args[3]);
    console.log(`已恢复退出进程 ${result.pid} 的本地锁；候选和回执未改变。`);
  } else if (args.includes("--help"))
    console.log(
      "本地维护：node maintenance/localEditorial.mjs --state <合成库目录> --key <合成密钥文件> --revision <修订ID> --evidence <受信来源归档JSON> [--workspace <reports内输出目录>]",
    );
  else {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      if (
        ![
          "--state",
          "--key",
          "--revision",
          "--evidence",
          "--workspace",
        ].includes(key) ||
        !args[index + 1] ||
        options[key]
      )
        throw new Error("本地维护参数无效");
      options[key] = args[index + 1];
    }
    if (
      !["--state", "--key", "--revision", "--evidence"].every(
        (key) => options[key],
      )
    )
      throw new Error("缺少必需参数；使用 --help 查看");
    const runtime = await loadLocalEditorialRuntime();
    const store = new runtime.ConsoleStore(
      path.resolve(options["--state"]),
      await readFile(path.resolve(options["--key"])),
    );
    try {
      const result = await applyLocalEditorial({
        store,
        runtime,
        revisionId: options["--revision"],
        evidence: JSON.parse(await readFile(options["--evidence"], "utf8")),
        workspace:
          options["--workspace"] ??
          path.join(ROOT, "reports/city-upgrade-f/local-maintenance"),
      });
      console.log(
        `本地候选${result.replayed ? "回读" : "完成"}：${result.output}；未部署。`,
      );
    } finally {
      store.close();
    }
  }
}

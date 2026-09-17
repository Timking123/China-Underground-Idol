import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const testDirectory = fileURLToPath(new URL("./", import.meta.url));
const identifier = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const evidence = path.join(root, "reports/console-security", identifier);
const snapshot = path.join(
  root,
  "reports/console-security/work",
  identifier,
  "source",
);
const files = readdirSync(path.join(root, "maintenance/console"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `maintenance/console/${name}`)
  .concat("src/admin/contracts.ts")
  .sort();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const entries = [];
mkdirSync(evidence, { recursive: true });
for (const name of files) {
  const bytes = readFileSync(path.join(root, name));
  const destination = path.join(snapshot, name);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  entries.push({ path: name, sha256: digest(bytes), bytes: bytes.length });
}
const driftBefore = entries
  .filter(
    (entry) =>
      digest(readFileSync(path.join(root, entry.path))) !== entry.sha256,
  )
  .map((entry) => entry.path);
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
if (head.status !== 0) throw new Error("无法记录测试基线");
if (driftBefore.length)
  throw new Error(`读取期间源码变化，尚未执行：${driftBefore.join(", ")}`);
const names = readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();
if (!names.length) throw new Error("没有独立安全用例，不能报通过");
const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "--test-concurrency=1",
    "--test-reporter=tap",
    ...names.map((name) => path.join(testDirectory, name)),
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CONSOLE_SECURITY_SOURCE_ROOT: snapshot },
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  },
);
const driftAfter = entries
  .filter(
    (entry) =>
      digest(readFileSync(path.join(root, entry.path))) !== entry.sha256,
  )
  .map((entry) => entry.path);
const manifest = {
  capturedAt: identifier,
  head: head.stdout.trim(),
  snapshot,
  sourceFiles: entries,
  sourceDigest: digest(JSON.stringify(entries)),
  tests: names,
  node: process.version,
  exitStatus: result.status,
  signal: result.signal,
  executionError: result.error?.message ?? null,
  changedDuringTest: driftAfter,
  scope: "独立合成数据初审；不是冻结候选或生产部署验收",
};
writeFileSync(
  path.join(evidence, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  path.join(evidence, "result.tap"),
  (result.stdout ?? "") + (result.stderr ?? ""),
  "utf8",
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
console.log(`证据目录：${path.relative(root, evidence)}`);
console.log(`源码摘要：${manifest.sourceDigest}`);
if (driftAfter.length)
  console.log(`执行期间变化：${driftAfter.join("、")}；结果仅适用于快照。`);
process.exitCode = result.status ?? 1;

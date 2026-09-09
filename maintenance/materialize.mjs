import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAGE = "work/phase3-20260909";
export const ARCHIVE =
  "outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01";
const MARKER = ".materialized-source.v1.json";
const SCHEMA = "idol-server-source-v1";
// 来源 SHA 锁定首次迁移快照；配置调整同时保留原始与打包后的 SHA。
export const SOURCE_PROVENANCE = Object.freeze([
  {
    path: "maintenance/runtime/eslint.config.mjs",
    origin: "phase3-20260909",
    source: "eslint.config.mjs",
    sha256: "40f5f4f62f09cd3a673171d001b21555beefcfc18cf9cde6e71dc342d3c1d267",
    packagedSha256:
      "4f7afb84cbb68262c4474b28a44d988c78d01401ee66fef97796e1ce12a28fff",
    bytes: 997,
  },
  {
    path: "maintenance/runtime/package-lock.json",
    origin: "phase3-20260909",
    source: "package-lock.json",
    sha256: "a7d6c3957d4c5c2b7b31e2b8bc2752690f7cc6838e289f871054420ce3c478a8",
    packagedSha256:
      "04e96ef6aefc3d9aa61035a4abbc10202b90cc519963c1b58d4208b5eb3cf86f",
    bytes: 30204,
  },
  {
    path: "maintenance/runtime/package.json",
    origin: "phase3-20260909",
    source: "package.json",
    sha256: "e9e6a94f6c171f110f5fcc78f5e48287918056c39d02d2b062d59c7bb47f0232",
    packagedSha256:
      "4f98b8b6ea5548d342b35bcf4e594c85284a0be8cf74ab3c794a9dd450f29f39",
    bytes: 1019,
  },
  {
    path: "maintenance/runtime/private/cli.ts",
    origin: "phase3-20260909",
    source: "private/cli.ts",
    sha256: "dc5253d077e998b2c8a1448d68f886d92c447986c0d953e44c1f64a0f46d2e14",
    packagedSha256:
      "dc5253d077e998b2c8a1448d68f886d92c447986c0d953e44c1f64a0f46d2e14",
    bytes: 12309,
  },
  {
    path: "maintenance/runtime/private/sources.v1.json",
    origin: "phase3-20260909",
    source: "private/sources.v1.json",
    sha256: "3813cbb452f709f048f2b0b8ab7e3adc99630d0e64c780a1653f4d9be8c0d4ff",
    packagedSha256:
      "3813cbb452f709f048f2b0b8ab7e3adc99630d0e64c780a1653f4d9be8c0d4ff",
    bytes: 5127,
  },
  {
    path: "maintenance/runtime/private/src/eventApplication.ts",
    origin: "phase3-20260909",
    source: "private/src/eventApplication.ts",
    sha256: "e3ba7fe9042e307a3ac69e5037df2d23a06e8c3c375138503aa3ab3b7959c68d",
    packagedSha256:
      "e3ba7fe9042e307a3ac69e5037df2d23a06e8c3c375138503aa3ab3b7959c68d",
    bytes: 7310,
  },
  {
    path: "maintenance/runtime/private/src/eventCandidates.ts",
    origin: "phase3-20260909",
    source: "private/src/eventCandidates.ts",
    sha256: "41c3e4599111c441dacf455b22f5bb2a12f56d39fdef5600e440fc5988f43063",
    packagedSha256:
      "41c3e4599111c441dacf455b22f5bb2a12f56d39fdef5600e440fc5988f43063",
    bytes: 30871,
  },
  {
    path: "maintenance/runtime/private/src/pipeline.ts",
    origin: "phase3-20260909",
    source: "private/src/pipeline.ts",
    sha256: "f06df34c3a4c428351bc1a7b6da7382f2908b77418c91625efdbdabf8106c887",
    packagedSha256:
      "f06df34c3a4c428351bc1a7b6da7382f2908b77418c91625efdbdabf8106c887",
    bytes: 14775,
  },
  {
    path: "maintenance/runtime/private/src/pipelineStore.ts",
    origin: "phase3-20260909",
    source: "private/src/pipelineStore.ts",
    sha256: "6a034553b079964fa9b8243107d3c173d0500e5be8edcce5ea2e3a773acd56b8",
    packagedSha256:
      "6a034553b079964fa9b8243107d3c173d0500e5be8edcce5ea2e3a773acd56b8",
    bytes: 43422,
  },
  {
    path: "maintenance/runtime/private/src/showstart.ts",
    origin: "phase3-20260909",
    source: "private/src/showstart.ts",
    sha256: "d49122e21fa1e682a23691d83389fd0d5ab9fdfd6917665d468c30c5e7e491bc",
    packagedSha256:
      "d49122e21fa1e682a23691d83389fd0d5ab9fdfd6917665d468c30c5e7e491bc",
    bytes: 10025,
  },
  {
    path: "maintenance/runtime/private/src/sourceCapture.ts",
    origin: "phase3-20260909",
    source: "private/src/sourceCapture.ts",
    sha256: "85ef3436140700d3d7b2a028753f62dd5a1f8948fb2fae3c54e6a5419d07f9fc",
    packagedSha256:
      "85ef3436140700d3d7b2a028753f62dd5a1f8948fb2fae3c54e6a5419d07f9fc",
    bytes: 12616,
  },
  {
    path: "maintenance/runtime/private/src/sourceRegistry.ts",
    origin: "phase3-20260909",
    source: "private/src/sourceRegistry.ts",
    sha256: "3f52e9e00a647df8394c3396af89062be639373e67391e0402b72568c05e0cd9",
    packagedSha256:
      "3f52e9e00a647df8394c3396af89062be639373e67391e0402b72568c05e0cd9",
    bytes: 6321,
  },
  {
    path: "maintenance/runtime/private/src/weeklyApplication.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyApplication.ts",
    sha256: "cf1a44cf38b3ec95a7ebdc0c5dbed6252d83603f948e70c820d01696cb1fdd46",
    packagedSha256:
      "cf1a44cf38b3ec95a7ebdc0c5dbed6252d83603f948e70c820d01696cb1fdd46",
    bytes: 22714,
  },
  {
    path: "maintenance/runtime/private/src/weeklyContract.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyContract.ts",
    sha256: "8e1a7446bd00a275e3b70f80a69b7800dec94da7095a5f7db86444c593b39da7",
    packagedSha256:
      "8e1a7446bd00a275e3b70f80a69b7800dec94da7095a5f7db86444c593b39da7",
    bytes: 20465,
  },
  {
    path: "maintenance/runtime/private/src/weeklyProviderCapability.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyProviderCapability.ts",
    sha256: "3a2989f5d91dff0834e94a03bc6a315d67edb22fa81ede6fb3948fb2af55be2b",
    packagedSha256:
      "3a2989f5d91dff0834e94a03bc6a315d67edb22fa81ede6fb3948fb2af55be2b",
    bytes: 5306,
  },
  {
    path: "maintenance/runtime/private/src/weeklyReconciliation.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyReconciliation.ts",
    sha256: "cfd43e64b6c9d07ff69a5125bb868f76ce67a52b0bdcbaca55e346963b6e04b8",
    packagedSha256:
      "cfd43e64b6c9d07ff69a5125bb868f76ce67a52b0bdcbaca55e346963b6e04b8",
    bytes: 12244,
  },
  {
    path: "maintenance/runtime/private/src/weeklyRuntime.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyRuntime.ts",
    sha256: "866310f5a85c16031381af635a766f5530e87dfd851732657d470b5aa541ea4e",
    packagedSha256:
      "866310f5a85c16031381af635a766f5530e87dfd851732657d470b5aa541ea4e",
    bytes: 47360,
  },
  {
    path: "maintenance/runtime/private/src/weeklyRuntimeAdapter.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyRuntimeAdapter.ts",
    sha256: "b4139f27101d68f3f27bd803cb2064778ab78edca2ebcbf0ad4b2b5cdfa1b869",
    packagedSha256:
      "b4139f27101d68f3f27bd803cb2064778ab78edca2ebcbf0ad4b2b5cdfa1b869",
    bytes: 11598,
  },
  {
    path: "maintenance/runtime/private/src/weeklyRuntimeApplication.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyRuntimeApplication.ts",
    sha256: "8d4ca1f58963c6ed1b31b30761381cd320afe8be19a4c9158d228d663e600608",
    packagedSha256:
      "8d4ca1f58963c6ed1b31b30761381cd320afe8be19a4c9158d228d663e600608",
    bytes: 37615,
  },
  {
    path: "maintenance/runtime/private/src/weeklyScope.ts",
    origin: "phase3-20260909",
    source: "private/src/weeklyScope.ts",
    sha256: "e60c51e6a067d68b360e104a923724309ebc9a97923844b8121243c6411344ae",
    packagedSha256:
      "e60c51e6a067d68b360e104a923724309ebc9a97923844b8121243c6411344ae",
    bytes: 16773,
  },
  {
    path: "maintenance/runtime/private/tests/eventCandidates.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/eventCandidates.test.mjs",
    sha256: "322cf30d3ffd8762c0fb6a3ccf8f2bced87c981835426821c4975954ea640f9a",
    packagedSha256:
      "322cf30d3ffd8762c0fb6a3ccf8f2bced87c981835426821c4975954ea640f9a",
    bytes: 25489,
  },
  {
    path: "maintenance/runtime/private/tests/pipeline.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/pipeline.test.mjs",
    sha256: "74ce8ef70fe821782cc16d5355008649cb1b6a47fa8a0c225ee2d72cbcd89001",
    packagedSha256:
      "a198b18fc18bd4249da7b75830cd47d9051332e116f5683d0d6b34d0fba765ef",
    bytes: 6743,
  },
  {
    path: "maintenance/runtime/private/tests/pipelineStore.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/pipelineStore.test.mjs",
    sha256: "26ad1e8366d23526c5069bcc0ae0075bdc95637f349ee426a84177cc4b9214fd",
    packagedSha256:
      "ac176b0209469264d5dfee8af03db7760568cbb518d24f5b08758d65be18407e",
    bytes: 28447,
  },
  {
    path: "maintenance/runtime/private/tests/showstart.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/showstart.test.mjs",
    sha256: "560795da94355836f7249772db41ff66f4d728cadb6137f4c814ed76d4926f49",
    packagedSha256:
      "560795da94355836f7249772db41ff66f4d728cadb6137f4c814ed76d4926f49",
    bytes: 3688,
  },
  {
    path: "maintenance/runtime/private/tests/sourceCapture.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/sourceCapture.test.mjs",
    sha256: "e6e978af67a9fc8e0e12ce5ccdff3b22f03062199ea4a097b2af01d1979488a4",
    packagedSha256:
      "e6e978af67a9fc8e0e12ce5ccdff3b22f03062199ea4a097b2af01d1979488a4",
    bytes: 3874,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyApplication.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyApplication.test.mjs",
    sha256: "835de779670993aef5ff89038523903f9ddb5b04fa23d8ad229548b68a31429d",
    packagedSha256:
      "835de779670993aef5ff89038523903f9ddb5b04fa23d8ad229548b68a31429d",
    bytes: 19936,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyContract.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyContract.test.mjs",
    sha256: "466d857b076c6b1ef7f982629e376c86d331491a2478853f58b3cd3c6222beb7",
    packagedSha256:
      "466d857b076c6b1ef7f982629e376c86d331491a2478853f58b3cd3c6222beb7",
    bytes: 4393,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyFixtures.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyFixtures.mjs",
    sha256: "928dd0bbc8420204540e5aef5892f68ff614d159644635065ed4245274bb36f2",
    packagedSha256:
      "928dd0bbc8420204540e5aef5892f68ff614d159644635065ed4245274bb36f2",
    bytes: 4921,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyProviderCapability.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyProviderCapability.test.mjs",
    sha256: "0cc65a8c91b192e817f2a9f8be1c88048e9104d64fdfe96173c9fec108f0d709",
    packagedSha256:
      "0cc65a8c91b192e817f2a9f8be1c88048e9104d64fdfe96173c9fec108f0d709",
    bytes: 16018,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyReconciliation.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyReconciliation.test.mjs",
    sha256: "41c52edfa75bf66bee2f4e14ca9bbf65e57b8d3a63a4738fc3fd28ed4cf45b03",
    packagedSha256:
      "41c52edfa75bf66bee2f4e14ca9bbf65e57b8d3a63a4738fc3fd28ed4cf45b03",
    bytes: 6283,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyRuntime.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyRuntime.test.mjs",
    sha256: "b905b6caf9eef2c798a02039171dcd5b8a9762fc67ae4f897cc34b71ae70d34d",
    packagedSha256:
      "b905b6caf9eef2c798a02039171dcd5b8a9762fc67ae4f897cc34b71ae70d34d",
    bytes: 22565,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyRuntimeAdapter.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyRuntimeAdapter.test.mjs",
    sha256: "e38b032447ce01d915ba1010bfdcc29a9f6080e36efbc3a50dad03b29cbe447c",
    packagedSha256:
      "e38b032447ce01d915ba1010bfdcc29a9f6080e36efbc3a50dad03b29cbe447c",
    bytes: 6215,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyRuntimeApplication.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyRuntimeApplication.test.mjs",
    sha256: "3e17e9c67981fdec0943b7fcded630127223bbd1a87c29d4e0db4d05cade1302",
    packagedSha256:
      "3e17e9c67981fdec0943b7fcded630127223bbd1a87c29d4e0db4d05cade1302",
    bytes: 29285,
  },
  {
    path: "maintenance/runtime/private/tests/weeklyScope.test.mjs",
    origin: "phase3-20260909",
    source: "private/tests/weeklyScope.test.mjs",
    sha256: "d9336cae15d2f1a1e846864cad4dba9c2ed760ccf6688511c985816328a90590",
    packagedSha256:
      "d9336cae15d2f1a1e846864cad4dba9c2ed760ccf6688511c985816328a90590",
    bytes: 8006,
  },
  {
    path: "maintenance/runtime/private/tsconfig.json",
    origin: "phase3-20260909",
    source: "private/tsconfig.json",
    sha256: "7a0dc3d7ba6e84f0e8bc275b263a34640dc8f34c966673fa5799d15aad82ddb2",
    packagedSha256:
      "2f81607385afcfa68751a3f7668f08321cee0087f8756359566230b97918f74e",
    bytes: 434,
  },
  {
    path: "maintenance/legacy/tools/api_response_cache.mjs",
    origin: "archive-2026-09-01",
    source: "tools/api_response_cache.mjs",
    sha256: "e585157da8356cc307b6e1d40eeea262249b6293666dd394821865bd4518345e",
    packagedSha256:
      "e585157da8356cc307b6e1d40eeea262249b6293666dd394821865bd4518345e",
    bytes: 50291,
  },
  {
    path: "maintenance/legacy/tools/build_weibo_candidate_evidence.mjs",
    origin: "archive-2026-09-01",
    source: "tools/build_weibo_candidate_evidence.mjs",
    sha256: "224e36fb1ff10071f7629cb78f63551afee0233623f47c09d7c73737d72ad054",
    packagedSha256:
      "224e36fb1ff10071f7629cb78f63551afee0233623f47c09d7c73737d72ad054",
    bytes: 65282,
  },
  {
    path: "maintenance/legacy/tools/collect_weibo_official.mjs",
    origin: "archive-2026-09-01",
    source: "tools/collect_weibo_official.mjs",
    sha256: "79543385b276bf8a087a0f27c7b1eab58fa227d02aeb1f0e13d8100a3bded5f4",
    packagedSha256:
      "79543385b276bf8a087a0f27c7b1eab58fa227d02aeb1f0e13d8100a3bded5f4",
    bytes: 63744,
  },
  {
    path: "maintenance/legacy/tools/editorial_contract.mjs",
    origin: "archive-2026-09-01",
    source: "tools/editorial_contract.mjs",
    sha256: "7236e89f154c4b92e05f22cac35bdd74fb7396a3667e51d45ba6a38d0a98f560",
    packagedSha256:
      "7236e89f154c4b92e05f22cac35bdd74fb7396a3667e51d45ba6a38d0a98f560",
    bytes: 101949,
  },
  {
    path: "maintenance/legacy/tools/redact_weibo_cli_capability_cache.mjs",
    origin: "archive-2026-09-01",
    source: "tools/redact_weibo_cli_capability_cache.mjs",
    sha256: "1cebc925bbf6c0f4fec0c0fcc39dbe5b2f98cb78bafa23ae1f08e8c471019e9a",
    packagedSha256:
      "1cebc925bbf6c0f4fec0c0fcc39dbe5b2f98cb78bafa23ae1f08e8c471019e9a",
    bytes: 69800,
  },
  {
    path: "maintenance/legacy/tools/weekly_profile_refresh.mjs",
    origin: "archive-2026-09-01",
    source: "tools/weekly_profile_refresh.mjs",
    sha256: "983f40c6c947c613771ecd9df420f00f59ce3dbba508edb325e5fba56899db56",
    packagedSha256:
      "983f40c6c947c613771ecd9df420f00f59ce3dbba508edb325e5fba56899db56",
    bytes: 36585,
  },
  {
    path: "maintenance/legacy/tools/weekly_reconciliation.mjs",
    origin: "archive-2026-09-01",
    source: "tools/weekly_reconciliation.mjs",
    sha256: "671aad870034499bc6354be1693f588c3378dfe2c5aa59d9f47792f1a067f4f6",
    packagedSha256:
      "671aad870034499bc6354be1693f588c3378dfe2c5aa59d9f47792f1a067f4f6",
    bytes: 2801,
  },
  {
    path: "maintenance/legacy/tools/weibo_cli_contract.mjs",
    origin: "archive-2026-09-01",
    source: "tools/weibo_cli_contract.mjs",
    sha256: "6f0c3a19c9b0d16e109917f566ce7a1480dd7ff3125d419cdd6e669f1682254e",
    packagedSha256:
      "6f0c3a19c9b0d16e109917f566ce7a1480dd7ff3125d419cdd6e669f1682254e",
    bytes: 646,
  },
]);
const PUBLIC_ROOT_FILES = new Set([
  ".gitignore",
  ".nojekyll",
  ".prettierignore",
  ".prettierrc.json",
  "index.html",
  "about.html",
  "contribute.html",
  "discover.html",
  "events.html",
  "group.html",
  "groups.html",
  "guide.html",
  "app.css",
  "app.js",
  "data.js",
  "DESIGN.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.mjs",
]);
const PUBLIC_DIRS = new Set([
  "assets",
  "data",
  "docs",
  "scripts",
  "src",
  "styles",
  "tests",
]);
const PUBLIC_DATA_FILES = new Set([
  "群体分布数据.json",
  "编辑展示覆盖数据.json",
  "微博候选证据展示层.json",
  "公开补充复核.json",
  "follower-observations.v1.json",
  "follower-observations.v2.json",
  "events.v1.json",
]);
const EXCLUDED = new Set([
  ".git",
  "node_modules",
  ".build",
  "maintenance",
  "private",
  "outputs",
  "work",
  "reports",
  ".locks",
  ".staging",
  "dist",
  "coverage",
]);
const PRIVATE_NAME =
  /(?:^|[._-])(?:env|secret|secrets|credential|credentials|cookie|cookies|session|sessions|ledger|ledgers|token|tokens|identity-acceptance|identity-supplement)(?:$|[._-])/iu;
const PUBLIC_EXTENSION =
  /\.(?:html|css|js|mjs|ts|json|md|png|jpe?g|webp|svg|ico|txt)$/iu;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
function requireState(condition, message) {
  if (!condition) throw new Error(message);
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function portableRelative(value) {
  requireState(
    typeof value === "string" && value.length > 0,
    "invalid_relative_path",
  );
  requireState(
    !value.includes("\\") && !value.includes(":") && !value.includes("\0"),
    "invalid_relative_path",
  );
  requireState(
    !path.posix.isAbsolute(value) &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
    "path_escape",
  );
  return value;
}
function resolveChild(root, relative) {
  const result = path.resolve(root, portableRelative(relative));
  requireState(inside(root, result) && result !== root, "path_escape");
  return result;
}
async function optionalStat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
// 对每一层 lstat；不能仅检查最终文件，否则父目录链接会绕过边界。
async function inspectPath(target, { allowMissing = false } = {}) {
  const parsed = path.parse(target);
  let current = parsed.root;
  const components = target
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  for (let index = 0; index < components.length; index++) {
    current = path.join(current, components[index]);
    const stat = await optionalStat(current);
    if (!stat) {
      requireState(allowMissing, `missing_path:${current}`);
      return null;
    }
    requireState(!stat.isSymbolicLink(), `symbolic_link:${current}`);
    requireState(
      index === components.length - 1 || stat.isDirectory(),
      `parent_not_directory:${current}`,
    );
  }
  return lstat(target);
}
async function regularBytes(target) {
  const stat = await inspectPath(target);
  requireState(
    stat.isFile() && stat.nlink === 1,
    `not_single_regular_file:${target}`,
  );
  return readFile(target);
}
function absoluteRoot(value, label) {
  requireState(
    typeof value === "string" && path.isAbsolute(value),
    `absolute_${label}_required`,
  );
  requireState(!value.split(/[\\/]/u).includes(".."), `path_escape:${label}`);
  const result = path.resolve(value);
  requireState(
    result !== path.parse(result).root,
    `filesystem_root_forbidden:${label}`,
  );
  return result;
}
async function rootsFor(options) {
  const roots = Object.fromEntries(
    ["repoRoot", "workspaceRoot", "privateSeedRoot"].map((name) => [
      name,
      absoluteRoot(options[name], name),
    ]),
  );
  const values = Object.values(roots);
  for (let index = 0; index < values.length; index++) {
    for (let other = index + 1; other < values.length; other++) {
      requireState(
        !inside(values[index], values[other]) &&
          !inside(values[other], values[index]),
        "overlapping_roots",
      );
    }
  }
  for (const [name, value] of Object.entries(roots)) {
    const stat = await inspectPath(value, {
      allowMissing: name === "workspaceRoot",
    });
    requireState(!stat || stat.isDirectory(), `root_not_directory:${name}`);
  }
  return roots;
}
async function sourceEntries(repoRoot) {
  const files = [];
  const add = async (relative, destination, original) => {
    const bytes = await regularBytes(resolveChild(repoRoot, relative));
    const hash = sha256(bytes);
    if (original)
      requireState(
        hash === original.packagedSha256,
        `source_hash_mismatch:${relative}`,
      );
    files.push({
      source: relative,
      destination: portableRelative(destination),
      sha256: hash,
      bytes: bytes.length,
      ...(original ? { originalSha256: original.sha256 } : {}),
    });
  };
  const originals = new Map(
    SOURCE_PROVENANCE.map((entry) => [entry.path, entry]),
  );
  requireState(
    originals.size === SOURCE_PROVENANCE.length && originals.size > 0,
    "invalid_source_manifest",
  );
  for (const entry of SOURCE_PROVENANCE) {
    portableRelative(entry.path);
    const runtime = entry.path.startsWith("maintenance/runtime/");
    requireState(
      runtime || /^maintenance\/legacy\/tools\/[a-z_]+\.mjs$/u.test(entry.path),
      "invalid_source_manifest_path",
    );
    await add(
      entry.path,
      runtime
        ? `${STAGE}/${entry.path.slice("maintenance/runtime/".length)}`
        : `${ARCHIVE}/${entry.path.slice("maintenance/legacy/".length)}`,
      entry,
    );
  }
  // runtime 与 legacy 区域严格白名单，夹带数据时直接停止。
  const visitPackage = async (relative) => {
    const directory = resolveChild(repoRoot, relative);
    requireState(
      (await inspectPath(directory)).isDirectory(),
      "package_not_directory",
    );
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      // 审查证据保留原位；它不是运行代码，也不进入服务器源码包。
      if (relative === "maintenance/runtime" && entry.name === "reports")
        continue;
      requireState(!entry.isSymbolicLink(), `symbolic_link:${child}`);
      if (entry.isDirectory()) {
        requireState(
          [
            "maintenance/runtime/private",
            "maintenance/runtime/private/src",
            "maintenance/runtime/private/tests",
            "maintenance/runtime/private/server",
            "maintenance/legacy/tools",
          ].includes(child) ||
            child.startsWith("maintenance/runtime/private/server/"),
          `package_directory_not_allowed:${child}`,
        );
        requireState(
          !PRIVATE_NAME.test(entry.name),
          `private_file_forbidden:${child}`,
        );
        await visitPackage(child);
      } else if (!originals.has(child)) {
        requireState(
          !PRIVATE_NAME.test(entry.name),
          `private_file_forbidden:${child}`,
        );
        requireState(
          /^maintenance\/runtime\/private\/server\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.ts$/u.test(
            child,
          ) ||
            /^maintenance\/runtime\/private\/tests\/server[a-zA-Z0-9_.-]*\.mjs$/u.test(
              child,
            ),
          `package_file_not_allowed:${child}`,
        );
        await add(
          child,
          `${STAGE}/${child.slice("maintenance/runtime/".length)}`,
        );
      }
    }
  };
  await visitPackage("maintenance/runtime");
  await visitPackage("maintenance/legacy");
  const visitSite = async (relative = "") => {
    const directory = relative ? resolveChild(repoRoot, relative) : repoRoot;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (EXCLUDED.has(entry.name)) continue;
      requireState(
        !PRIVATE_NAME.test(entry.name),
        `private_file_forbidden:${child}`,
      );
      requireState(!entry.isSymbolicLink(), `symbolic_link:${child}`);
      if (entry.isDirectory()) {
        requireState(
          relative || PUBLIC_DIRS.has(entry.name),
          `site_directory_not_allowed:${child}`,
        );
        await visitSite(child);
      } else {
        requireState(
          relative
            ? PUBLIC_EXTENSION.test(entry.name)
            : PUBLIC_ROOT_FILES.has(entry.name),
          `site_file_not_allowed:${child}`,
        );
        requireState(
          !child.startsWith("data/") ||
            (relative === "data" && PUBLIC_DATA_FILES.has(entry.name)),
          `site_data_not_allowed:${child}`,
        );
        requireState(
          !child.startsWith("assets/") ||
            /\.(?:js|png|jpe?g|webp|svg|ico)$/iu.test(entry.name),
          `site_asset_not_allowed:${child}`,
        );
        await add(child, `${STAGE}/site/${child}`);
      }
    }
  };
  await visitSite();
  files.sort((left, right) =>
    left.destination < right.destination
      ? -1
      : left.destination > right.destination
        ? 1
        : 0,
  );
  requireState(
    new Set(files.map((entry) => entry.destination.toLowerCase())).size ===
      files.length,
    "duplicate_destination",
  );
  return files;
}
async function verifyTarget(workspaceRoot, relative, identity, files) {
  const target = resolveChild(workspaceRoot, relative);
  const stat = await inspectPath(target, { allowMissing: true });
  if (!stat) return false;
  requireState(stat.isDirectory(), `target_not_directory:${relative}`);
  const marker = await regularBytes(path.join(target, MARKER));
  requireState(
    marker.equals(Buffer.from(encode(identity))),
    `existing_source_identity_conflict:${relative}`,
  );
  for (const entry of files) {
    if (!entry.destination.startsWith(`${relative}/`)) continue;
    const bytes = await regularBytes(
      resolveChild(workspaceRoot, entry.destination),
    );
    requireState(
      bytes.length === entry.bytes && sha256(bytes) === entry.sha256,
      `existing_source_conflict:${entry.destination}`,
    );
  }
  const allowed = new Set(files.map((entry) => entry.destination));
  const inspectManagedTree = async (directory) => {
    if (!(await optionalStat(resolveChild(workspaceRoot, directory)))) return;
    for (const entry of await readdir(resolveChild(workspaceRoot, directory), {
      withFileTypes: true,
    })) {
      const child = `${directory}/${entry.name}`;
      if (directory.startsWith(`${STAGE}/site`) && EXCLUDED.has(entry.name))
        continue;
      requireState(!entry.isSymbolicLink(), `symbolic_link:${child}`);
      if (entry.isDirectory()) await inspectManagedTree(child);
      else
        requireState(
          allowed.has(child) || child === `${relative}/${MARKER}`,
          `existing_unmanaged_source:${child}`,
        );
    }
  };
  const managedDirectories =
    relative === STAGE
      ? [
          `${STAGE}/site`,
          `${STAGE}/private/src`,
          `${STAGE}/private/server`,
          `${STAGE}/private/tests`,
        ]
      : [relative];
  for (const directory of managedDirectories)
    await inspectManagedTree(directory);
  return true;
}
async function writeNew(target, bytes) {
  await inspectPath(target, { allowMissing: true });
  await mkdir(path.dirname(target), { recursive: true });
  await inspectPath(path.dirname(target));
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function materialize(options) {
  const roots = await rootsFor(options);
  const files = await sourceEntries(roots.repoRoot);
  const identity = {
    schemaVersion: SCHEMA,
    sourceSha256: sha256(encode(files)),
    files,
  };
  const targets = [STAGE, `${ARCHIVE}/tools`];
  // 所有已有目标先完成只读验证；任何冲突都早于第一笔写入。
  const existing = [];
  for (const target of targets)
    existing.push(
      await verifyTarget(roots.workspaceRoot, target, identity, files),
    );
  requireState(
    existing.every(Boolean) || existing.every((value) => !value),
    "partial_existing_installation",
  );
  if (
    existing.every((value) => !value) &&
    (await optionalStat(roots.workspaceRoot))
  ) {
    requireState(
      (await readdir(roots.workspaceRoot)).length === 0,
      "existing_workspace_without_source_identity",
    );
  }
  const result = {
    ...roots,
    ...identity,
    mode: options.planOnly
      ? "plan"
      : existing.every(Boolean)
        ? "verified"
        : "created",
  };
  if (options.planOnly || existing.every(Boolean)) return result;
  // 不补齐半安装目录，防止在中断/并发后误接管已存在工作区。
  requireState(
    existing.every((value) => !value),
    "partial_existing_installation",
  );
  for (const target of targets) {
    const absolute = resolveChild(roots.workspaceRoot, target);
    await inspectPath(absolute, { allowMissing: true });
    await mkdir(path.dirname(absolute), { recursive: true });
    await inspectPath(path.dirname(absolute));
    await mkdir(absolute);
  }
  for (const entry of files) {
    const bytes = await regularBytes(
      resolveChild(roots.repoRoot, entry.source),
    );
    requireState(
      bytes.length === entry.bytes && sha256(bytes) === entry.sha256,
      `source_changed_during_copy:${entry.source}`,
    );
    await writeNew(resolveChild(roots.workspaceRoot, entry.destination), bytes);
  }
  for (const target of targets)
    await writeNew(
      path.join(resolveChild(roots.workspaceRoot, target), MARKER),
      Buffer.from(encode(identity)),
    );
  return result;
}
function parseArguments(args) {
  const options = {};
  const names = {
    "--repo-root": "repoRoot",
    "--workspace-root": "workspaceRoot",
    "--private-seed-root": "privateSeedRoot",
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--plan") {
      requireState(!options.planOnly, "duplicate_argument:--plan");
      options.planOnly = true;
    } else {
      const name = names[argument];
      requireState(
        name &&
          !options[name] &&
          args[index + 1] &&
          !args[index + 1].startsWith("--"),
        `invalid_argument:${argument}`,
      );
      options[name] = args[++index];
    }
  }
  return options;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      encode(
        await materialize(parseArguments(process.argv.slice(2))),
      ).trimEnd(),
    );
  } catch (error) {
    console.error(`源码物化停止：${error.message}`);
    process.exitCode = 1;
  }
}

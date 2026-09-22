import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  createFeedRevision,
  validateFeedLedger,
} from "../../scripts/generateSubscriptions.mjs";
import { validatePublishedEvents } from "../../scripts/eventAssets.mjs";
import { buildGroupCatalog } from "../../scripts/groupCatalog.mjs";
import {
  ordinary,
  sourceFiles,
  writeNew,
  verifySources,
} from "../localEditorial.mjs";
/* global structuredClone */

export const FOUR_SOURCES = [
  "data/events.v1.json",
  "data/event-verifications.v1.json",
  "data/feed-state.v1.json",
  "data/updates.v1.json",
];
export const BASELINE_EVENTS_SHA256 =
  "c47faeda0c62b15ee02b5ebe288d689f99412ca53e9bc83203e7a3043b39f9f8";
const FROZEN_EVENTS_SHA256 =
  "86093d19efa7f5b96049d02e284ce96eb1e01c9534a8c3bb3d95ac43a8dfa783";
const FROZEN_VERIFICATION_SHA256 =
  "b90065271cc1e4fde2dd02c6922803424157aee0267c3027c457e4d4e2d048f8";
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 本批已审活动字段修订；保留生产增量，冲突只冻结该条，绝不整表覆盖。 */
export function reconcileEvents(baseline, production, candidate) {
  const index = (dataset) => {
    if (
      dataset?.schemaVersion !== "idol-events-v1" ||
      !Array.isArray(dataset.events)
    )
      throw new Error("活动输入无效");
    const rows = new Map(dataset.events.map((event) => [event.id, event]));
    if (rows.size !== dataset.events.length) throw new Error("活动 ID 重复");
    return rows;
  };
  const base = index(baseline),
    live = index(production),
    frozen = index(candidate);
  if (!same([...base.keys()].sort(), [...frozen.keys()].sort()))
    throw new Error("本批候选不得增删基线活动");
  const result = structuredClone(production);
  const conflicts = [],
    applied = [];
  for (const [id, original] of base) {
    const next = frozen.get(id);
    const fields = [
      ...new Set([...Object.keys(original), ...Object.keys(next)]),
    ].filter((field) => !same(original[field], next[field]));
    if (!fields.length) continue;
    const current = live.get(id);
    const clashes = !current
      ? ["event-withdrawn-in-production"]
      : fields.filter(
          (field) =>
            !same(current[field], original[field]) &&
            !same(current[field], next[field]),
        );
    if (clashes.length) {
      conflicts.push({
        eventId: id,
        fields: clashes,
        baselineSha256: hash(encode(original)),
        productionSha256: current ? hash(encode(current)) : null,
        candidateSha256: hash(encode(next)),
      });
      continue;
    }
    const row = result.events.find((event) => event.id === id);
    for (const field of fields) {
      if (Object.hasOwn(next, field)) row[field] = structuredClone(next[field]);
      else delete row[field];
    }
    applied.push({ eventId: id, fields });
  }
  // 时间沿用真实输入，只在已审修订应用后选取较新的源时间，不伪造核验时间。
  if (
    applied.length &&
    Date.parse(candidate.updatedAt) > Date.parse(result.updatedAt)
  )
    result.updatedAt = candidate.updatedAt;
  return { events: result, conflicts, applied };
}

async function verificationModel(root) {
  const result = await build({
    entryPoints: [path.join(root, "src/events/verification.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

export async function prepareFourSources({
  root,
  baselineBytes,
  production,
  candidate,
  now = new Date(),
}) {
  const baseline = JSON.parse(baselineBytes);
  const live = JSON.parse(production[FOUR_SOURCES[0]]);
  const reviewed = JSON.parse(candidate[FOUR_SOURCES[0]]);
  const result = reconcileEvents(baseline, live, reviewed);
  const catalog = await buildGroupCatalog(root);
  validatePublishedEvents(
    result.events,
    catalog.groups.map((group) => group.id),
  );
  const model = await verificationModel(root);
  const previous =
    production[FOUR_SOURCES[1]] == null
      ? {
          schemaVersion: "idol-event-verifications-v1",
          updatedAt: live.updatedAt,
          coverage: "partial",
          records: [],
        }
      : JSON.parse(production[FOUR_SOURCES[1]]);
  if (!model.validateEventVerificationDataset(previous, live.events).valid)
    throw new Error("生产核验层无效");
  let verification = model.invalidateEventVerifications(
    previous,
    live.events,
    result.events.events,
  );
  const reviewedVerification = JSON.parse(candidate[FOUR_SOURCES[1]]);
  if (
    !model.validateEventVerificationDataset(
      reviewedVerification,
      reviewed.events,
    ).valid
  )
    throw new Error("冻结候选核验层无效");
  // 只承接仍匹配最终活动的已审证据；同条生产已存在核验记录时保留生产来源。
  const reviewedValid = model.invalidateEventVerifications(
    reviewedVerification,
    reviewed.events,
    result.events.events,
  );
  const productionIds = new Set(
    previous.records.map((record) => record.eventId),
  );
  const blocked = new Set(result.conflicts.map((item) => item.eventId));
  verification = {
    ...verification,
    records: [
      ...verification.records,
      ...reviewedValid.records.filter(
        (record) =>
          !productionIds.has(record.eventId) && !blocked.has(record.eventId),
      ),
    ],
  };
  if (
    Date.parse(reviewedVerification.updatedAt) >
    Date.parse(verification.updatedAt)
  )
    verification.updatedAt = reviewedVerification.updatedAt;
  if (
    !model.validateEventVerificationDataset(verification, result.events.events)
      .valid
  )
    throw new Error("准备后的核验层无效");
  const stateBytes = production[FOUR_SOURCES[2]],
    updatesBytes = production[FOUR_SOURCES[3]];
  if ((stateBytes == null) !== (updatesBytes == null))
    throw new Error("生产 feed 双源单缺，须恢复同代旧基线");
  const feed = createFeedRevision({
    events: result.events,
    verification,
    previousState: stateBytes == null ? null : JSON.parse(stateBytes),
    previousUpdates: updatesBytes == null ? null : JSON.parse(updatesBytes),
    recordedAt: now.toISOString(),
    reason: "服务器迁移：承接已审城市修订并保留生产增量",
  });
  validateFeedLedger(feed.state, feed.history);
  return {
    files: {
      [FOUR_SOURCES[0]]: encode(result.events),
      [FOUR_SOURCES[1]]: encode(verification),
      [FOUR_SOURCES[2]]: encode(feed.state),
      [FOUR_SOURCES[3]]: encode(feed.history),
    },
    conflicts: result.conflicts,
    applied: result.applied,
    feedInitialized: stateBytes == null,
    baselineSha256: hash(baselineBytes),
    productionEqualsBaseline:
      hash(production[FOUR_SOURCES[0]]) === hash(baselineBytes),
  };
}

/** 四源只进入同一完整源码候选；既有源和 current 均不变，封包/双验由既有门执行。 */
export async function writePreparedCandidate({ root, output, prepared }) {
  root = path.resolve(root);
  output = path.resolve(output);
  if (
    !output.startsWith(
      `${path.join(root, "reports/migration-implementation")}${path.sep}`,
    )
  )
    throw new Error("候选必须在独占实现报告目录下");
  await mkdir(path.dirname(output), { recursive: true });
  let parent = path.dirname(output);
  while (parent !== root) {
    if ((await lstat(parent)).isSymbolicLink())
      throw new Error("候选祖先禁止链接");
    parent = path.dirname(parent);
  }
  await mkdir(output);
  await writeFile(
    path.join(output, "reconciliation.json"),
    encode({
      conflicts: prepared.conflicts,
      applied: prepared.applied,
      baselineSha256: prepared.baselineSha256,
      productionEqualsBaseline: prepared.productionEqualsBaseline,
      feedInitialized: prepared.feedInitialized,
    }),
    { flag: "wx" },
  );
  const source = path.join(output, "source"),
    records = [];
  for (const name of await sourceFiles(root)) {
    const raw = prepared.files[name] ?? (await ordinary(root, name));
    await writeNew(source, name, raw);
    records.push({ path: name, sha256: hash(raw), bytes: raw.length });
  }
  await verifySources(source, records);
  const receipt = {
    schemaVersion: "idol-migration-candidate-v1",
    status: prepared.conflicts.length ? "prepared-with-conflicts" : "prepared",
    published: false,
    reviewRequired: prepared.conflicts.length > 0,
    unresolvedConflicts: prepared.conflicts,
    applied: prepared.applied,
    source,
    files: records,
    requiredGates: [
      "package:site",
      "inspectPublicationCandidate",
      "verify_site",
      "deployment_lock",
    ],
  };
  await writeFile(path.join(output, "prepared.json"), encode(receipt), {
    flag: "wx",
  });
  return receipt;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const [rootArg, baselineFile, productionRoot, output] = process.argv.slice(2);
  if (
    !rootArg ||
    !baselineFile ||
    !productionRoot ||
    !output ||
    process.argv.length !== 6
  )
    throw new Error("参数：源码根 817基线文件 生产快照根 独占输出目录");
  const root = path.resolve(rootArg),
    production = {},
    candidate = {};
  for (const name of FOUR_SOURCES) {
    candidate[name] = await ordinary(root, name);
    try {
      production[name] = await ordinary(path.resolve(productionRoot), name);
    } catch (error) {
      if (error.code !== "ENOENT" || name === FOUR_SOURCES[0]) throw error;
      production[name] = null;
    }
  }
  const baselineBytes = await readFile(baselineFile);
  if (
    hash(baselineBytes) !== BASELINE_EVENTS_SHA256 ||
    hash(candidate[FOUR_SOURCES[0]]) !== FROZEN_EVENTS_SHA256 ||
    hash(candidate[FOUR_SOURCES[1]]) !== FROZEN_VERIFICATION_SHA256
  )
    throw new Error("817 基线或已审城市冻结字节不匹配");
  const prepared = await prepareFourSources({
    root,
    baselineBytes,
    production,
    candidate,
  });
  const receipt = await writePreparedCandidate({ root, output, prepared });
  console.log(
    JSON.stringify({
      status: receipt.status,
      published: false,
      unresolvedConflicts: receipt.unresolvedConflicts.length,
      applied: receipt.applied.length,
    }),
  );
  if (receipt.reviewRequired) process.exitCode = 1;
}

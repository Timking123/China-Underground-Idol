import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildGroupCatalog } from "./groupCatalog.mjs";
import { validatePublishedEvents } from "./eventAssets.mjs";
/* global structuredClone */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const FEED_SOURCE_FILES = [
  "data/feed-state.v1.json",
  "data/updates.v1.json",
];
export const FEED_INPUT_FILES = [
  "data/events.v1.json",
  "data/event-verifications.v1.json",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function loadModel(relative) {
  const result = await build({
    entryPoints: [path.join(ROOT, relative)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const [feeds, updates] = await Promise.all([
  loadModel("src/subscriptions/model.ts"),
  loadModel("src/updates/model.ts"),
]);

async function readOrdinary(root, relative) {
  let target = await realpath(root);
  for (const [index, part] of relative.split("/").entries()) {
    target = path.join(target, part);
    const stat = await lstat(target);
    if (
      stat.isSymbolicLink() ||
      (index === relative.split("/").length - 1
        ? !stat.isFile()
        : !stat.isDirectory())
    )
      throw new Error(`订阅输入禁止非普通文件：${relative}`);
  }
  return readFile(target, "utf8");
}

/** 只写显式清单内文件；拒绝目录或目标符号链接，不清理他人产物。 */
async function writeOrdinary(root, relative, content) {
  const parts = relative.split("/");
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    path.isAbsolute(relative)
  )
    throw new Error("订阅输出路径越界");
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("订阅输出根目录禁止符号链接");
  let current = await realpath(root);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("订阅输出目录必须为普通目录");
  }
  const target = path.join(current, parts.at(-1));
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("订阅输出必须为普通文件");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(target, content, "utf8");
}

function snapshotOf(event, verification) {
  const record = verification?.records.find(
    (item) => item.eventId === event.id,
  );
  const meaningful =
    record &&
    (record.outcome !== "unverified" ||
      Object.values(record.fields).some((value) => value !== "unverified"));
  return {
    event: structuredClone(event),
    verification: meaningful
      ? { outcome: record.outcome, fields: structuredClone(record.fields) }
      : null,
    withdrawn: false,
  };
}

export function validateFeedLedger(state, history) {
  feeds.validateFeedState(state);
  updates.validateUpdates(history);
  if (state.initializedAt !== history.initializedAt)
    throw new Error("订阅与更新记录初始化基线不一致");
  for (const record of state.records) {
    if (sha256(feeds.canonical(record.snapshot)) !== record.fingerprint)
      throw new Error(`订阅快照哈希不符：${record.uid}`);
    const revisions = history.entries
      .filter((entry) => entry.eventId === record.snapshot.event.id)
      .sort((a, b) => a.sequence - b.sequence);
    for (const [index, entry] of revisions.entries()) {
      const prior = revisions[index - 1];
      if (
        index === 0 &&
        (entry.sequence !==
          (record.createdAt === state.initializedAt ? 1 : 0) ||
          (entry.kind === "added") !==
            (record.createdAt !== state.initializedAt))
      )
        throw new Error("更新修订链缺少起始记录");
      if (
        prior &&
        (entry.sequence !== prior.sequence + 1 ||
          entry.beforeHash !== prior.afterHash ||
          Date.parse(entry.recordedAt) <= Date.parse(prior.recordedAt))
      )
        throw new Error("更新修订链不连续");
    }
    const last = revisions.at(-1);
    if (
      last
        ? last.sequence !== record.sequence ||
          last.afterHash !== record.fingerprint ||
          last.recordedAt !== record.modifiedAt
        : record.sequence !== 0 || record.createdAt !== state.initializedAt
    )
      throw new Error("订阅状态与更新末次修订不一致");
    let cursor = structuredClone(record.snapshot);
    for (const entry of [...revisions].reverse()) {
      if (
        sha256(feeds.canonical(cursor)) !== entry.afterHash ||
        entry.title !== cursor.event.title
      )
        throw new Error("更新记录无法回溯到当前快照");
      const wasWithdrawn = cursor.withdrawn;
      const fields = new Set();
      if (entry.kind === "added") {
        if (
          entry.beforeHash !== null ||
          entry.sequence !== 0 ||
          entry.changes.length !== 1 ||
          entry.changes[0].field !== "record" ||
          entry.changes[0].before !== null ||
          entry.changes[0].after !== feeds.canonical(cursor.event)
        )
          throw new Error("新增记录差异不匹配");
        continue;
      }
      for (const change of entry.changes) {
        if (fields.has(change.field)) throw new Error("更新字段重复");
        fields.add(change.field);
        const isMeta = ["verification", "withdrawn"].includes(change.field);
        const target = isMeta ? cursor : cursor.event;
        if (
          change.field === "id" ||
          !Object.hasOwn(target, change.field) ||
          feeds.canonical(target[change.field]) !== change.after ||
          change.before === null
        )
          throw new Error("更新差异与真实快照不符");
        target[change.field] = JSON.parse(change.before);
      }
      if (sha256(feeds.canonical(cursor)) !== entry.beforeHash)
        throw new Error("更新差异不能恢复修订前哈希");
      if (
        entry.kind !==
        (wasWithdrawn ? "withdrawn" : cursor.withdrawn ? "restored" : "changed")
      )
        throw new Error("更新类别与记录状态不一致");
    }
  }
  if (
    history.entries.some(
      (entry) =>
        !state.records.some(
          (record) => record.snapshot.event.id === entry.eventId,
        ),
    )
  )
    throw new Error("更新记录没有对应订阅状态");
  return { state, history };
}

function differences(before, after) {
  if (!before)
    return [
      { field: "record", before: null, after: feeds.canonical(after.event) },
    ];
  const changes = Object.keys(after.event)
    .filter((key) => key !== "id")
    .flatMap((field) => {
      const oldValue = feeds.canonical(before.event[field]);
      const newValue = feeds.canonical(after.event[field]);
      return oldValue === newValue
        ? []
        : [{ field, before: oldValue, after: newValue }];
    });
  for (const field of ["verification", "withdrawn"]) {
    const oldValue = feeds.canonical(before[field]);
    const newValue = feeds.canonical(after[field]);
    if (oldValue !== newValue)
      changes.push({ field, before: oldValue, after: newValue });
  }
  return changes;
}

/** 纯候选生成；recordedAt 是编辑记录时间，调用者必须提供且审核，不读取系统时钟。 */
export function createFeedRevision({
  events,
  verification,
  previousState = null,
  previousUpdates = null,
  recordedAt,
  reason,
}) {
  if (
    !feeds.validTimestamp(recordedAt) ||
    typeof reason !== "string" ||
    !reason.trim()
  )
    throw new Error("候选必须指定真实 UTC 记录时间与修订原因");
  if (Boolean(previousState) !== Boolean(previousUpdates))
    throw new Error("订阅和更新旧基线必须同时存在");
  if (previousState) validateFeedLedger(previousState, previousUpdates);
  if (
    !events ||
    !Array.isArray(events.events) ||
    new Set(events.events.map((event) => event.id)).size !==
      events.events.length
  )
    throw new Error("活动输入缺失或重复 ID");
  const initializedAt = previousState?.initializedAt ?? recordedAt;
  const state = {
    schemaVersion: "idol-feed-state-v1",
    initializedAt,
    records: [],
  };
  const history = structuredClone(
    previousUpdates ?? {
      schemaVersion: "idol-updates-v1",
      initializedAt,
      entries: [],
    },
  );
  const current = new Map(
    events.events.map((event) => [event.id, snapshotOf(event, verification)]),
  );
  const previous = new Map(
    (previousState?.records ?? []).map((record) => [
      record.snapshot.event.id,
      record,
    ]),
  );
  for (const id of [
    ...new Set([...previous.keys(), ...current.keys()]),
  ].sort()) {
    const old = previous.get(id);
    const snapshot = current.get(id) ?? { ...old.snapshot, withdrawn: true };
    const fingerprint = sha256(feeds.canonical(snapshot));
    if (old?.fingerprint === fingerprint) {
      state.records.push(structuredClone(old));
      continue;
    }
    if (old && Date.parse(recordedAt) <= Date.parse(old.modifiedAt))
      throw new Error(`修订时间必须晚于旧版本：${id}`);
    if (
      previousState &&
      Date.parse(recordedAt) <= Date.parse(previousState.initializedAt)
    )
      throw new Error("修订时间必须晚于初始化基线");
    const scopes = feeds.mergeScopes(
      old?.scopes ?? [],
      feeds.eventScopes(snapshot.event),
    );
    const record = {
      uid: `${id}@idol-events.local`,
      sequence: old ? old.sequence + 1 : 0,
      createdAt: old?.createdAt ?? recordedAt,
      modifiedAt: recordedAt,
      fingerprint,
      snapshot,
      scopes,
    };
    state.records.push(record);
    // 第一次启用只记录真实快照，不把已存在活动伪装为刚刚新增。
    if (previousState)
      history.entries.push({
        id: `${id}:${record.sequence}:${fingerprint.slice(0, 12)}`,
        eventId: id,
        title: snapshot.event.title,
        kind: !old
          ? "added"
          : snapshot.withdrawn
            ? "withdrawn"
            : old.snapshot.withdrawn
              ? "restored"
              : "changed",
        recordedAt,
        sequence: record.sequence,
        reason,
        beforeHash: old?.fingerprint ?? null,
        afterHash: fingerprint,
        scopes,
        changes: differences(old?.snapshot, snapshot),
        sources: [
          ...snapshot.event.sources.map((source) => ({
            label: source.label,
            url: source.url,
            observedAt: source.observedAt,
          })),
          ...(
            verification?.records.find((item) => item.eventId === id)
              ?.evidence ?? []
          )
            .filter((item) => item.result === "read")
            .map((item) => ({
              label: item.publisher,
              url: item.url,
              observedAt: item.observedAt,
            })),
        ],
      });
  }
  validateFeedLedger(state, history);
  return { state, history };
}

async function readInputs(rootDir) {
  const inputText = Object.fromEntries(
    await Promise.all(
      FEED_INPUT_FILES.map(async (file) => [
        file,
        await readOrdinary(rootDir, file),
      ]),
    ),
  );
  const catalog = await buildGroupCatalog(rootDir);
  const events = validatePublishedEvents(
    JSON.parse(inputText[FEED_INPUT_FILES[0]]),
    catalog.groups.map((group) => group.id),
  );
  const verificationModel = await loadModel("src/events/verification.ts");
  const result = verificationModel.validateEventVerificationDataset(
    JSON.parse(inputText[FEED_INPUT_FILES[1]]),
    events.events,
  );
  if (!result.valid)
    throw new Error(`活动核验校验失败：${JSON.stringify(result.errors)}`);
  return {
    events,
    verification: result.data,
    catalog,
    inputHashes: Object.fromEntries(
      Object.entries(inputText).map(([file, text]) => [file, sha256(text)]),
    ),
  };
}

async function readLedger(rootDir, bootstrap = false) {
  const texts = [];
  for (const file of FEED_SOURCE_FILES) {
    try {
      texts.push(await readOrdinary(rootDir, file));
    } catch (error) {
      if (!bootstrap || error.code !== "ENOENT") throw error;
      texts.push(null);
    }
  }
  if (texts.filter(Boolean).length === 1)
    throw new Error("订阅和更新源不完整，不能重新初始化");
  return {
    state: texts[0] ? JSON.parse(texts[0]) : null,
    history: texts[1] ? JSON.parse(texts[1]) : null,
    baseHashes: Object.fromEntries(
      FEED_SOURCE_FILES.map((file, index) => [
        file,
        texts[index] === null ? null : sha256(texts[index]),
      ]),
    ),
  };
}

/** 在完整候选工作区校验 events + verification，再把 D 候选写入隔离输出；不写正式源。 */
export async function prepareFeedRevision({
  rootDir = ROOT,
  outputRoot,
  recordedAt,
  reason,
  bootstrap = false,
}) {
  if (!outputRoot || path.resolve(outputRoot) === path.resolve(rootDir))
    throw new Error("修订候选必须写入独立目录，不能覆盖正式源");
  const input = await readInputs(rootDir);
  const prior = await readLedger(rootDir, bootstrap);
  const result = createFeedRevision({
    ...input,
    previousState: prior.state,
    previousUpdates: prior.history,
    recordedAt,
    reason,
  });
  const payloads = [jsonText(result.state), jsonText(result.history)];
  const receipt = {
    schemaVersion: "idol-feed-candidate-v1",
    recordedAt,
    reason,
    inputHashes: input.inputHashes,
    baseHashes: prior.baseHashes,
    outputHashes: Object.fromEntries(
      FEED_SOURCE_FILES.map((file, i) => [file, sha256(payloads[i])]),
    ),
    changesAdded:
      result.history.entries.length - (prior.history?.entries.length ?? 0),
  };
  for (const [index, file] of FEED_SOURCE_FILES.entries())
    await writeOrdinary(outputRoot, file, payloads[index]);
  // 完成标记最后写入；采用端先核对所有哈希，再交给完整发行的原子切换。
  await writeOrdinary(outputRoot, "feed-candidate.json", jsonText(receipt));
  return { ...receipt, files: [...FEED_SOURCE_FILES, "feed-candidate.json"] };
}

/** 采用前核对候选、旧基线、活动输入三者；发布器负责整体版本的原子应用。 */
export async function verifyFeedCandidate({ rootDir = ROOT, candidateRoot }) {
  const receipt = JSON.parse(
    await readOrdinary(candidateRoot, "feed-candidate.json"),
  );
  if (receipt.schemaVersion !== "idol-feed-candidate-v1")
    throw new Error("订阅候选版本无效");
  const input = await readInputs(rootDir);
  const prior = await readLedger(rootDir, true);
  const candidate = await readLedger(candidateRoot);
  if (
    feeds.canonical(input.inputHashes) !==
      feeds.canonical(receipt.inputHashes) ||
    feeds.canonical(prior.baseHashes) !== feeds.canonical(receipt.baseHashes) ||
    feeds.canonical(candidate.baseHashes) !==
      feeds.canonical(receipt.outputHashes)
  )
    throw new Error("订阅候选基线、输入或内容哈希已变化");
  const expected = createFeedRevision({
    ...input,
    previousState: prior.state,
    previousUpdates: prior.history,
    recordedAt: receipt.recordedAt,
    reason: receipt.reason,
  });
  if (
    feeds.canonical(expected.state) !== feeds.canonical(candidate.state) ||
    feeds.canonical(expected.history) !== feeds.canonical(candidate.history)
  )
    throw new Error("订阅候选不是由当前真实变更产生");
  return { files: FEED_SOURCE_FILES, receipt };
}

export async function generateFeeds(
  rootDir = ROOT,
  { outputRoot = rootDir } = {},
) {
  const { events, verification, catalog } = await readInputs(rootDir);
  const { state, history } = await readLedger(rootDir);
  validateFeedLedger(state, history);
  const stored = new Map(
    state.records.map((record) => [record.snapshot.event.id, record]),
  );
  for (const event of events.events)
    if (
      stored.get(event.id)?.fingerprint !==
      sha256(feeds.canonical(snapshotOf(event, verification)))
    )
      throw new Error(`活动 ${event.id} 尚未生成并采用订阅修订候选`);
  for (const record of state.records)
    if (
      !record.snapshot.withdrawn &&
      !events.events.some((event) => event.id === record.snapshot.event.id)
    )
      throw new Error(`活动 ${record.snapshot.event.id} 撤下尚未对账`);
  const manifest = feeds.buildFeedManifest(catalog, state);
  const artifacts = manifest.feeds.map((feed) => ({
    path: feed.path,
    text: feeds.buildSubscriptionIcs(feed, state),
  }));
  for (const artifact of artifacts)
    await writeOrdinary(outputRoot, artifact.path, artifact.text);
  await writeOrdinary(outputRoot, "feeds/v1/manifest.json", jsonText(manifest));
  return {
    files: [
      "feeds/v1/manifest.json",
      ...artifacts.map((item) => item.path),
    ].sort(),
    manifest,
  };
}

export async function buildSubscriptionArtifacts({
  rootDir = ROOT,
  outputRoot = rootDir,
} = {}) {
  return generateFeeds(rootDir, { outputRoot });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const rootDir = option("--root") ?? ROOT;
  const outputRoot = option("--output");
  const result = args.includes("--prepare")
    ? await prepareFeedRevision({
        rootDir,
        outputRoot,
        recordedAt: option("--recorded-at"),
        reason: option("--reason"),
        bootstrap: args.includes("--bootstrap"),
      })
    : await generateFeeds(rootDir, { outputRoot: outputRoot ?? rootDir });
  process.stdout.write(
    `${JSON.stringify({ files: result.files, changesAdded: result.changesAdded })}\n`,
  );
}

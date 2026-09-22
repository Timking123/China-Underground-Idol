import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEditorialRuntime } from "../maintenance/localEditorial.mjs";

const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const root = fileURLToPath(new URL("../", import.meta.url));

/** 合成的维护证据与私人库；真实公开基线只读，候选永不覆盖主工作树。 */
export async function localEditorialFixture({
  reportDirectory = path.join(
    root,
    "reports/city-upgrade-f/local-editorial-tests",
  ),
} = {}) {
  const runtime = await loadLocalEditorialRuntime(root, {
    outputRoot: path.join(reportDirectory, "runtime"),
  });
  const parent = reportDirectory;
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "case-"));
  const key = randomBytes(32);
  const store = new runtime.ConsoleStore(path.join(directory, "private"), key);
  const baseline = await readFile(path.join(root, "data/events.v1.json"));
  const event = JSON.parse(baseline).events[0];
  const now = new Date();
  const source = {
    id: "synthetic-local-editorial",
    label: "合成本地维护证据",
    publisher: "合成验收主办方",
    kind: "organizer",
    state: "pilot",
    collector: "manual-browser",
    pinnedUrls: ["https://fixture.idol.test.cn/editorial"],
    allowedUrlPrefixes: [],
    note: "仅为本地合成测试，不访问网络或当作真实公开证据。",
  };
  const registry = runtime.validateSourceRegistry({
    schemaVersion: "idol-update-sources-v1",
    timezone: "Asia/Shanghai",
    activities: {
      state: "PAUSED",
      localTime: "08:00",
      firstWindowDays: 30,
      focusDays: 7,
    },
    profiles: {
      state: "PAUSED",
      weekday: "SU",
      localTime: "10:00",
      paidBudgetCredits: 0,
    },
    sources: [source],
  });
  const excerpt = "合成本地验收专用，本场场馆为合成星光现场。";
  const body = `正文开始\n${excerpt}\n正文结束`;
  const proof = {
    schemaVersion: "public-browser-source-v1",
    sourceUrl: source.pinnedUrls[0],
    capturedAt: now.toISOString(),
    captureMethod: "public-browser-visible-article",
    text: body,
    textSha256: hash(body),
    links: [],
  };
  const capture = runtime.captureBrowserProof(
    proof,
    Buffer.from(encode(proof)),
    source,
    { start: "正文开始", end: "正文结束", complete: true },
    now,
  );
  const feedback = store.createFeedback(
    {
      kind: "event",
      target: event.id,
      source: source.pinnedUrls[0],
      details: "合成本地发布闭环测试，补充场馆，仅存在于测试候选。",
      contact: "",
      consent: true,
      website: "",
      requestId: randomUUID(),
    },
    "192.0.2.80",
    now.getTime(),
  );
  const input = {
    feedbackId: feedback.id,
    baselineSha256: hash(baseline),
    target: { kind: "event", id: event.id },
    patch: { venue: "合成星光现场" },
    evidence: [
      {
        captureId: capture.captureId,
        url: capture.source.sourceUrl,
        label: capture.source.label,
        publisher: capture.source.publisher,
        kind: capture.source.kind,
        observedAt: capture.source.observedAt,
        excerpt,
        supports: ["venue"],
      },
    ],
    rationale: "本地合成维护验收，验证来源归档、核验失效与日历修订的完整闭环。",
  };
  let revision = runtime.mutateEditorial(
    store,
    "create",
    null,
    { requestId: randomUUID(), expectedVersion: 0, input },
    baseline,
    "合成验收管理员",
    now.getTime(),
    () => {},
  );
  revision = runtime.mutateEditorial(
    store,
    "review",
    revision.id,
    {
      requestId: randomUUID(),
      expectedVersion: revision.version,
      decision: "approve",
      note: "已核对合成原文，限本地验收。",
    },
    baseline,
    "合成验收管理员",
    now.getTime(),
    () => {},
  );
  revision = runtime.mutateEditorial(
    store,
    "handoff",
    revision.id,
    { requestId: randomUUID(), expectedVersion: revision.version },
    baseline,
    "合成验收管理员",
    now.getTime(),
    () => {},
  );
  return {
    runtime,
    store,
    key,
    directory,
    baseline,
    revision,
    now,
    proof,
    evidence: { registry, captures: [capture] },
    options: {
      root,
      workspace: path.join(directory, "snapshots"),
      store,
      runtime,
      revisionId: revision.id,
      now,
      evidence: { registry, captures: [capture] },
    },
  };
}

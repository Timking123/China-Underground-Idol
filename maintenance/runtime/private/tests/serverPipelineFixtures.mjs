import { captureBrowserProof, encode, sha256 } from "../src/sourceCapture.ts";
import { validateSourceRegistry } from "../src/sourceRegistry.ts";

// 完全离线的合成资料：八份原文证明、三场旧活动、六场已复核新增和两场待审候选。
// URL 仅作为身份字符串，不采集真实账号，也不读取历史私有 inbox 或正式站点数据。
export const observedAt = "2026-09-09T08:00:00.000Z";
export const now = new Date("2026-09-09T09:00:00.000Z");
export const groups = ["g-synthetic"];
export const display = Buffer.from(
  `window.IDOL_MAP_DATA = ${encode({ groups: [{ id: groups[0], name: "合成团体" }] }).trim()};\n`,
);
export const registry = validateSourceRegistry({
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
  sources: Array.from({ length: 8 }, (_, index) => ({
    id: `synthetic-source-${index}`,
    label: `合成来源 ${index}`,
    publisher: `合成发布者 ${index}`,
    kind: index < 6 ? "official" : "aggregator",
    state: "pilot",
    collector: "manual-browser",
    pinnedUrls: [`https://example.com/synthetic/event-${index}`],
    allowedUrlPrefixes: [],
    note: "仅供离线自动测试，不得作为真实业务资料使用。",
  })),
});

function event(id, source, index) {
  return {
    id,
    title: `合成活动 ${index}`,
    date: `2026-09-${String(10 + index).padStart(2, "0")}`,
    province: "上海市",
    city: "上海市",
    venue: `合成场地 ${index}`,
    address: `合成路 ${index + 1} 号`,
    opensAt: "18:00",
    startsAt: "18:30",
    endsAt: "20:00",
    status: "scheduled",
    performers: [{ groupId: groups[0], name: "合成团体" }],
    sources: [source],
    notes: "仅供离线回归测试。",
    poster: null,
  };
}

export const original = Buffer.from(
  encode({
    schemaVersion: "idol-events-v1",
    coverage: "partial",
    updatedAt: "2026-09-08T08:00:00.000Z",
    events: Array.from({ length: 3 }, (_, index) =>
      event(
        `e-existing-${index}`,
        {
          url: `https://example.com/synthetic/existing-${index}`,
          label: "合成历史来源",
          publisher: "合成历史发布者",
          kind: "official",
          observedAt: "2026-09-08T08:00:00.000Z",
        },
        index,
      ),
    ),
  }),
);

const records = registry.sources.map((source, index) => {
  const record = event(
    `e-created-${index}`,
    {
      url: source.pinnedUrls[0],
      label: source.label,
      publisher: source.publisher,
      kind: source.kind,
      observedAt,
    },
    index + 3,
  );
  const body = [
    `正文开始 ${index}`,
    `${record.title} ${record.date}`,
    `${record.province} ${record.city} ${record.venue} ${record.address}`,
    `进场 ${record.opensAt} 开演 ${record.startsAt} 结束 ${record.endsAt}`,
    "活动状态 scheduled，演出团体 合成团体。",
    `正文结束 ${index}`,
  ].join("\n");
  const proof = {
    schemaVersion: "public-browser-source-v1",
    sourceUrl: source.pinnedUrls[0],
    capturedAt: observedAt,
    captureMethod: "public-browser-visible-article",
    text: `${source.publisher}\n${body}`,
    textSha256: sha256(`${source.publisher}\n${body}`),
    links: [],
  };
  const bytes = Buffer.from(encode(proof));
  const capture = captureBrowserProof(
    proof,
    bytes,
    source,
    {
      start: `正文开始 ${index}`,
      end: `正文结束 ${index}`,
      complete: true,
    },
    now,
  );
  const fields = Object.fromEntries(
    Object.entries(record).filter(([key]) => !["id", "sources"].includes(key)),
  );
  return {
    capture,
    proof: {
      captureId: capture.captureId,
      sha256: sha256(bytes),
      bytesBase64: bytes.toString("base64"),
    },
    snapshot: {
      source: capture.source,
      items: [
        {
          candidateId: `candidate-${index}`,
          sourceItemKey: `saved-item-${index}`,
          originalEventUrl: source.pinnedUrls[0],
          originalUrlIsUnique: true,
          fields,
          fieldExcerpts: Object.fromEntries(
            Object.keys(fields).map((field) => [field, body]),
          ),
        },
      ],
    },
    change: {
      event: record,
      action: "create",
      evidence: [
        {
          captureId: capture.captureId,
          excerpt: body,
          supports: Object.keys(fields),
        },
      ],
      rationale:
        "仅在合成测试中确认完整来源正文、全部必需字段与明确的新建身份。",
    },
  };
});

// 与真实 JSON 导入一致，序列化边界拆开 capture/source/snapshot 的对象别名。
export const fixture = JSON.parse(
  encode({
    schemaVersion: "idol-capture-import-v1",
    captures: records.map((record) => record.capture),
    proofs: records.map((record) => record.proof),
    snapshots: records.map((record) => record.snapshot),
    mappings: records.slice(0, 6).map((record) => ({
      eventId: record.change.event.id,
      sourceId: record.capture.source.sourceId,
      sourceItemKey: record.snapshot.items[0].sourceItemKey,
    })),
    draft: {
      schemaVersion: "idol-reviewed-event-update-v1",
      baselineSha256: sha256(original),
      reviewedAt: now.toISOString(),
      reviewedBy: "离线合成测试",
      changes: records.slice(0, 6).map((record) => record.change),
    },
  }),
);
export const fixtureBytes = Buffer.from(encode(fixture));

import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConsoleStore } from "../store.ts";
import { hashPassword } from "../crypto.ts";
import { editorialSha256 } from "../editorial.ts";

export const editorialTime = Date.parse("2026-09-19T04:00:00.000Z");
export const editorialDataset = {
  schemaVersion: "idol-events-v1",
  updatedAt: "2026-09-18T01:00:00.000Z",
  coverage: "partial",
  events: [
    {
      id: "e-editorial-synthetic-20260920",
      title: "合成验收演出",
      date: "2026-09-20",
      province: "广东",
      city: "深圳",
      venue: null,
      address: null,
      opensAt: null,
      startsAt: null,
      endsAt: null,
      status: "unconfirmed",
      performers: [],
      sources: [
        {
          url: "https://example.org/editorial-proof",
          label: "合成主办方公告",
          publisher: "合成主办方",
          kind: "organizer",
          observedAt: "2026-09-18T01:00:00.000Z",
        },
      ],
      notes: "",
      poster: null,
    },
  ],
};
export const editorialBytes = Buffer.from(
  JSON.stringify(editorialDataset, null, 2) + "\n",
);
/** 全部为合成资料；调用者负责关闭 store 与删除其独占临时目录。 */
export async function createEditorialFixture(directory, password) {
  const key = randomBytes(32);
  const store = new ConsoleStore(path.join(directory, "private-data"), key);
  store.put(
    "account",
    "admin",
    { username: "editorial-admin", passwordHash: await hashPassword(password) },
    editorialTime,
  );
  const feedback = store.createFeedback(
    {
      kind: "event",
      target: editorialDataset.events[0].id,
      source: "https://example.org/editorial-proof",
      details: "合成投稿：主办方现已公布演出场馆。",
      contact: "synthetic-private@example.invalid",
      consent: true,
      website: "",
      requestId: randomUUID(),
    },
    "192.0.2.215",
    editorialTime,
  );
  const site = path.join(directory, "site");
  mkdirSync(path.join(site, "data"), { recursive: true });
  mkdirSync(path.join(directory, "admin"), { recursive: true });
  writeFileSync(path.join(site, "data/events.v1.json"), editorialBytes);
  writeFileSync(path.join(directory, "admin/index.html"), "合成管理页");
  const input = {
    feedbackId: feedback.id,
    baselineSha256: editorialSha256(editorialBytes),
    target: { kind: "event", id: editorialDataset.events[0].id },
    patch: { venue: "合成星光现场" },
    evidence: [
      {
        captureId: "synthetic-editorial-capture",
        url: "https://example.org/editorial-proof",
        label: "合成主办方公告",
        publisher: "合成主办方",
        kind: "organizer",
        observedAt: "2026-09-19T01:00:00.000Z",
        excerpt: "合成验收演出将于合成星光现场举办。",
        supports: ["venue"],
      },
    ],
    rationale: "已逐字段核对合成主办方原文，本次补充已公布场馆。",
  };
  return { store, key, site, feedback, input };
}

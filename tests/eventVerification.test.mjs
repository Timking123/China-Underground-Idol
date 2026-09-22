import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildVenueNavigationUrl,
  eventFieldLabel,
  eventVerificationSnapshot,
  getEventVerification,
  invalidateEventVerifications,
  validateEventVerificationDataset,
  VERIFICATION_FIELDS,
} from "../src/events/verification.ts";

const stamp = "2026-09-18T12:00:00Z";
const event = {
  id: "e-test-verification",
  title: "测试场次",
  date: "2026-09-19",
  province: "广东",
  city: "深圳",
  venue: "测试场馆",
  address: "测试街1号",
  opensAt: null,
  startsAt: "12:00",
  endsAt: null,
  status: "scheduled",
  performers: [],
  notes: "",
  poster: null,
  sources: [
    {
      url: "https://venue.example.org/event",
      publisher: "测试主办",
      kind: "organizer",
      label: "测试预告",
      observedAt: stamp,
    },
  ],
};
const fixture = () => ({
  schemaVersion: "idol-event-verifications-v1",
  updatedAt: stamp,
  coverage: "partial",
  records: [
    {
      eventId: event.id,
      snapshot: eventVerificationSnapshot(event),
      checkedAt: stamp,
      verifiedAt: stamp,
      outcome: "verified",
      summary: "主办原文支持核心安排，未核验字段继续留空。",
      fields: Object.fromEntries(
        VERIFICATION_FIELDS.map((field) => [
          field,
          ["opensAt", "endsAt"].includes(field) ? "unverified" : "verified",
        ]),
      ),
      evidence: [
        {
          url: event.sources[0].url,
          publisher: "测试主办",
          role: "organizer",
          observedAt: stamp,
          result: "read",
          fields: ["date", "status", "venue", "address", "startsAt"],
          note: "原文明示整场 START 与场馆地址。",
        },
      ],
      changes: [
        {
          field: "venue",
          previous: null,
          current: event.venue,
          observedAt: stamp,
          sourceUrl: event.sources[0].url,
          reason: "补充主办原文明示场馆。",
        },
      ],
    },
  ],
});
const checked = (data) => validateEventVerificationDataset(data, [event]);

test("正式补充层与当前主档逐字段相符，存在真实成功和保留缺口", async () => {
  const main = JSON.parse(
    await readFile(new URL("../data/events.v1.json", import.meta.url), "utf8"),
  );
  const data = JSON.parse(
    await readFile(
      new URL("../data/event-verifications.v1.json", import.meta.url),
      "utf8",
    ),
  );
  const result = validateEventVerificationDataset(data, main.events);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.ok(data.records.some((record) => record.outcome === "verified"));
  assert.ok(data.records.some((record) => record.outcome === "unverified"));
  assert.ok(data.records.some((record) => record.changes.length));
});

test("有效和空数据可校验，读取不修改输入", () => {
  const data = fixture();
  const before = globalThis.structuredClone(data);
  assert.equal(checked(data).valid, true);
  assert.deepEqual(data, before);
  assert.equal(checked({ ...data, records: [] }).valid, true);
  assert.equal(getEventVerification(data, "unknown"), undefined);
  assert.equal(getEventVerification(data, event.id), data.records[0]);
});

test("拒绝未知键、未知/重复 ID、缺字段与稀疏数组", () => {
  const mutations = [
    (data) => {
      data.privateNote = "禁止混入";
    },
    (data) => {
      data.records[0].privateNote = "禁止混入";
    },
    (data) => {
      data.records[0].eventId = "unknown";
    },
    (data) => {
      data.records.push(globalThis.structuredClone(data.records[0]));
    },
    (data) => {
      delete data.records[0].snapshot.city;
    },
    (data) => {
      data.records[0].fields.extra = "verified";
    },
    (data) => {
      data.records[0].evidence[0].fields = Array(1);
    },
    (data) => {
      data.records = Array(1);
    },
    (data) => {
      data.records[0].evidence = Array(1);
    },
    (data) => {
      data.records[0].changes = Array(1);
    },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    assert.equal(checked(data).valid, false);
  }
});

test("格式、真实日期及核验时序不接受自动溢出和未来证据", () => {
  for (const value of [
    "2026-02-30T12:00:00Z",
    "2026-09-18",
    "2026-09-18T12:00:00",
    "2026-09-18T12:00:00+14:59",
    stamp + "\n",
    "2026-09-19T12:00:00Z",
  ]) {
    const data = fixture();
    data.records[0].checkedAt = value;
    assert.equal(checked(data).valid, false, value);
  }
  const data = fixture();
  data.records[0].evidence[0].observedAt = "2026-09-19T12:00:00Z";
  assert.equal(checked(data).valid, false);
});

test("核验资料不能附着到修改后的日期、地址、标题或城市", () => {
  for (const [field, value] of [
    ["date", "2026-09-20"],
    ["address", "另一地址"],
    ["title", "同名活动第二场"],
    ["city", "广州"],
    ["status", "cancelled"],
  ]) {
    assert.equal(
      validateEventVerificationDataset(fixture(), [
        { ...event, [field]: value },
      ]).valid,
      false,
      field,
    );
  }
});

test("原文未读、仅有汇总、身份归属不匹配都不能宣称已确认", () => {
  const mutations = [
    (data) => {
      data.records[0].evidence[0].result = "unavailable";
    },
    (data) => {
      data.records[0].evidence[0].role = "aggregator";
    },
    (data) => {
      data.records[0].evidence[0].fields = [];
    },
    (data) => {
      data.records[0].evidence[0].publisher = "其他人";
    },
    (data) => {
      data.records[0].fields.opensAt = "verified";
    },
    (data) => {
      data.records[0].verifiedAt = null;
    },
    (data) => {
      data.records[0].verifiedAt = "2026-09-17T00:00:00Z";
    },
    (data) => {
      data.records[0].outcome = "unverified";
    },
    (data) => {
      data.records[0].fields.startsAt = "unverified";
    },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    assert.equal(checked(data).valid, false);
  }
});

test("尚未公布须有明示证据，空值默认尚未核实", () => {
  const data = fixture();
  const record = data.records[0];
  assert.equal(eventFieldLabel(event, record, "opensAt"), "尚未核实");
  record.fields.opensAt = "unannounced";
  assert.equal(checked(data).valid, false);
  record.evidence[0].fields.push("opensAt");
  assert.equal(checked(data).valid, true);
  assert.equal(eventFieldLabel(event, record, "opensAt"), "尚未公布");
  record.fields.venue = "unannounced";
  assert.equal(checked(data).valid, false);
});

test("恶意 URL、安全字段和畸形证据不能绕过或令校验抛出", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:secret@example.org",
    "https://example.org/%0aX",
    "https://example.org\\x",
    "https://exa\nmple.org",
  ]) {
    const data = fixture();
    data.records[0].evidence[0].url = url;
    assert.equal(checked(data).valid, false);
  }
  for (const fields of [null, 0, {}, "venue", [null]]) {
    const data = fixture();
    data.records[0].evidence[0].fields = fields;
    assert.doesNotThrow(() => checked(data));
    assert.equal(checked(data).valid, false);
  }
});

test("变更不能伪造当前值、无变化、无依据或早于实际观察的历史", () => {
  for (const patch of [
    { current: "不存在场馆" },
    { previous: event.venue },
    { field: "notes" },
    { sourceUrl: "https://elsewhere.example.org" },
    { observedAt: "2025-01-01T00:00:00Z" },
  ]) {
    const data = fixture();
    Object.assign(data.records[0].changes[0], patch);
    assert.equal(checked(data).valid, false);
  }
});

test("导航仅对当前快照可靠场馆地址开放，取消延期不沿用旧导航", () => {
  const record = fixture().records[0];
  const url = new URL(buildVenueNavigationUrl(event, record));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "uri.amap.com");
  assert.equal(url.searchParams.get("keyword"), "测试场馆 测试街1号");
  for (const input of [
    { ...event, address: null },
    { ...event, address: "同名另一馆" },
    { ...event, status: "cancelled" },
    { ...event, status: "postponed" },
  ])
    assert.equal(buildVenueNavigationUrl(input, record), null);
  record.fields.address = "unverified";
  assert.equal(buildVenueNavigationUrl(event, record), null);
  assert.equal(buildVenueNavigationUrl(event, undefined), null);
});

test("发布修订使关联核验整条失效，未改记录保留原时间且不修改输入", () => {
  const data = fixture();
  const before = globalThis.structuredClone(data);
  const next = invalidateEventVerifications(
    data,
    [event],
    [{ ...event, address: "新地址" }],
  );
  assert.deepEqual(next.records, []);
  assert.equal(next.updatedAt, stamp);
  assert.deepEqual(data, before);
  assert.deepEqual(invalidateEventVerifications(data, [event], [event]), data);
  assert.deepEqual(invalidateEventVerifications(data, [event], []).records, []);
  assert.equal(
    eventFieldLabel(
      { ...event, address: "新地址" },
      data.records[0],
      "address",
    ),
    "新地址（尚未核实）",
  );
});

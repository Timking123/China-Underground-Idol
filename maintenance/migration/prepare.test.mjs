import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  FOUR_SOURCES,
  prepareFourSources,
  reconcileEvents,
  writePreparedCandidate,
} from "./prepare.mjs";
/* global structuredClone */
const root = fileURLToPath(new URL("../../", import.meta.url));
const baselineBytes = execFileSync(
  "git",
  ["show", "817ed1c210c8f59a47d171cec18b6730b5aa8220:data/events.v1.json"],
  { cwd: root },
);
const baseline = JSON.parse(baselineBytes);
const candidate = Object.fromEntries(
  await Promise.all(
    FOUR_SOURCES.map(async (name) => [
      name,
      await readFile(path.join(root, name)),
    ]),
  ),
);
const reviewed = JSON.parse(candidate[FOUR_SOURCES[0]]);
const time = new Date("2026-09-23T00:00:00.000Z");
const raw = (value) => Buffer.from(JSON.stringify(value));

test("真实817/9条已审城市修订+合成生产新增：保留增量，双无feed只在真实调用时间初始化", async () => {
  const live = structuredClone(baseline);
  live.events.push({
    ...structuredClone(live.events[0]),
    id: "e-migration-synthetic-added",
  });
  const production = { [FOUR_SOURCES[0]]: raw(live) };
  const prepared = await prepareFourSources({
    root,
    baselineBytes,
    production,
    candidate,
    now: time,
  });
  assert.equal(prepared.applied.length, 9);
  assert.deepEqual(prepared.conflicts, []);
  assert.equal(prepared.feedInitialized, true);
  const events = JSON.parse(prepared.files[FOUR_SOURCES[0]]);
  assert.equal(events.events.length, 115);
  for (const item of prepared.applied)
    assert.deepEqual(
      events.events.find((event) => event.id === item.eventId),
      reviewed.events.find((event) => event.id === item.eventId),
    );
  assert.equal(
    JSON.parse(prepared.files[FOUR_SOURCES[2]]).initializedAt,
    time.toISOString(),
  );
  assert.equal(JSON.parse(prepared.files[FOUR_SOURCES[3]]).entries.length, 0);
  const replay = await prepareFourSources({
    root,
    baselineBytes,
    production: prepared.files,
    candidate,
    now: new Date(time.getTime() + 1000),
  });
  assert.deepEqual(
    JSON.parse(replay.files[FOUR_SOURCES[2]]),
    JSON.parse(prepared.files[FOUR_SOURCES[2]]),
  );
  assert.deepEqual(
    JSON.parse(replay.files[FOUR_SOURCES[3]]),
    JSON.parse(prepared.files[FOUR_SOURCES[3]]),
  );
  await assert.rejects(
    prepareFourSources({
      root,
      baselineBytes,
      production: {
        ...production,
        [FOUR_SOURCES[2]]: prepared.files[FOUR_SOURCES[2]],
      },
      candidate,
      now: time,
    }),
    /双源单缺/,
  );
});

test("三方真正冲突只冻结该条，生产其他字段/其他活动与已审其余条目仍保留", () => {
  const changes = reconcileEvents(baseline, baseline, reviewed).applied;
  const target = changes[0];
  const live = structuredClone(baseline);
  const record = live.events.find((event) => event.id === target.eventId);
  record[target.fields[0]] = "合成生产独立变更";
  const output = reconcileEvents(baseline, live, reviewed);
  assert.equal(output.conflicts.length, 1);
  assert.equal(output.applied.length, 8);
  assert.deepEqual(
    output.events.events.find((event) => event.id === record.id),
    record,
  );
  assert.equal(output.conflicts[0].eventId, record.id);
});

test("生产冲突仍写出可复核的完整四源候选并阻止自动发布", async (t) => {
  const changes = reconcileEvents(baseline, baseline, reviewed).applied;
  const target = changes.find((item) => item.fields.includes("notes"));
  assert.ok(target);
  const live = structuredClone(baseline);
  const record = live.events.find((event) => event.id === target.eventId);
  record.notes = "合成生产独立备注";
  const prepared = await prepareFourSources({
    root,
    baselineBytes,
    production: { [FOUR_SOURCES[0]]: raw(live) },
    candidate,
    now: time,
  });
  assert.equal(prepared.conflicts.length, 1);
  assert.equal(prepared.applied.length, changes.length - 1);
  const output = path.join(
    root,
    "reports/migration-implementation",
    `test-conflict-${randomUUID()}`,
  );
  assert.equal(
    path.dirname(output),
    path.join(root, "reports/migration-implementation"),
  );
  t.after(() => rm(output, { recursive: true, force: true }));
  const receipt = await writePreparedCandidate({ root, output, prepared });
  assert.equal(receipt.status, "prepared-with-conflicts");
  assert.equal(receipt.reviewRequired, true);
  assert.equal(receipt.published, false);
  assert.deepEqual(receipt.unresolvedConflicts, prepared.conflicts);
  assert.equal(receipt.applied.length, changes.length - 1);
  const sealed = JSON.parse(await readFile(path.join(output, "prepared.json")));
  assert.deepEqual(sealed, receipt);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(output, "reconciliation.json"))).conflicts,
    prepared.conflicts,
  );
  for (const name of FOUR_SOURCES)
    assert.deepEqual(
      await readFile(path.join(output, "source", name)),
      prepared.files[name],
    );
  const events = JSON.parse(
    await readFile(path.join(output, "source", FOUR_SOURCES[0])),
  );
  assert.deepEqual(
    events.events.find((event) => event.id === record.id),
    record,
  );
  const unaffected = changes.find((item) => item.eventId !== record.id);
  assert.deepEqual(
    events.events.find((event) => event.id === unaffected.eventId),
    reviewed.events.find((event) => event.id === unaffected.eventId),
  );
});

test("已有feed的UID、序号、历史及核验观察时间不随迁移刷新", async () => {
  const previous = JSON.parse(candidate[FOUR_SOURCES[2]]);
  const history = JSON.parse(candidate[FOUR_SOURCES[3]]);
  const prepared = await prepareFourSources({
    root,
    baselineBytes,
    production: candidate,
    candidate,
    now: time,
  });
  assert.deepEqual(JSON.parse(prepared.files[FOUR_SOURCES[2]]), previous);
  assert.deepEqual(JSON.parse(prepared.files[FOUR_SOURCES[3]]), history);
  assert.deepEqual(
    JSON.parse(prepared.files[FOUR_SOURCES[1]]),
    JSON.parse(candidate[FOUR_SOURCES[1]]),
  );
});

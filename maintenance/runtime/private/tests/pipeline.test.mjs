import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import {
  archiveImport,
  applyActivityRun,
  readStageFile,
  validateCaptureImport,
} from "../src/pipeline.ts";
import { createPipelineStore } from "../src/pipelineStore.ts";
import {
  prepareEventUpdate,
  assignStableItemKeys,
} from "../src/eventApplication.ts";
import { encode, sha256 } from "../src/sourceCapture.ts";
import {
  display,
  fixture,
  fixtureBytes,
  groups,
  now,
  original,
  registry,
} from "./serverPipelineFixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidenceRoot = join(root, "reports/pipeline-integration");
await mkdir(evidenceRoot, { recursive: true });
async function setup() {
  const stage = await mkdtemp(join(evidenceRoot, "case-"));
  await mkdir(join(stage, "site/data"), { recursive: true });
  await writeFile(join(stage, "site/data/events.v1.json"), original);
  await writeFile(join(stage, "site/data.js"), display);
  return { stage, store: await createPipelineStore(join(stage, "store")) };
}
test("导入原始证据hash不符或候选没有对应capture时拒绝", () => {
  const good = validateCaptureImport(fixture, registry, now);
  assert.equal(good.captures.length, 8);
  const bad = structuredClone(fixture);
  bad.proofs[0].bytesBase64 = Buffer.from("{}").toString("base64");
  assert.throws(() => validateCaptureImport(bad, registry, now), /proof_hash/);
  const forged = structuredClone(fixture);
  forged.snapshots[0].source.bodySha256 = "a".repeat(64);
  assert.throws(
    () => validateCaptureImport(forged, registry, now),
    /snapshot_without/,
  );
});
test("复核稿必须绑定公开基线、字段原文及身份操作", () => {
  assert.equal(
    prepareEventUpdate(
      original,
      fixture.draft,
      fixture.captures,
      registry,
      groups,
    ).dataset.events.length,
    9,
  );
  assert.throws(
    () =>
      prepareEventUpdate(
        Buffer.from("{}"),
        fixture.draft,
        fixture.captures,
        registry,
        groups,
      ),
    /baseline_drift/,
  );
  const noEvidence = structuredClone(fixture.draft);
  noEvidence.changes[0].evidence[0].excerpt = "原文没有这句";
  assert.throws(
    () =>
      prepareEventUpdate(
        original,
        noEvidence,
        fixture.captures,
        registry,
        groups,
      ),
    /excerpt_not/,
  );
  const wrongAction = structuredClone(fixture.draft);
  wrongAction.changes[0].action = "update";
  assert.throws(
    () =>
      prepareEventUpdate(
        original,
        wrongAction,
        fixture.captures,
        registry,
        groups,
      ),
    /identity_action/,
  );
  const unsupported = structuredClone(fixture.draft);
  unsupported.changes[0].evidence[0].supports = [];
  assert.throws(
    () =>
      prepareEventUpdate(
        original,
        unsupported,
        fixture.captures,
        registry,
        groups,
      ),
    /missing_field_evidence/,
  );
});
test("合成证据走原导入→应用→幂等重放，旧三场及两场待审候选保持边界", async () => {
  const { stage, store } = await setup();
  const first = await archiveImport(
    store,
    fixtureBytes,
    registry,
    "first",
    now,
  );
  assert.equal(first.reused, false);
  const repeated = await archiveImport(
    store,
    fixtureBytes,
    registry,
    "first",
    now,
  );
  assert.equal(repeated.reused, true);
  assert.equal(sha256(encode(repeated.report)), sha256(encode(first.report)));
  const changed = structuredClone(fixture);
  changed.draft.reviewedBy += "（不同输入）";
  await assert.rejects(
    archiveImport(store, Buffer.from(encode(changed)), registry, "first", now),
    /run_input_changed/,
  );
  const applied = await applyActivityRun(stage, store, registry, "first");
  assert.equal(applied.changed, true);
  const after = JSON.parse(
    await readStageFile(stage, "site/data/events.v1.json"),
  );
  assert.deepEqual(
    after.events.slice(0, 3),
    JSON.parse(original).events.slice(0, 3),
  );
  assert.equal(after.events.length, 9);
  assert.ok(
    !after.events.some((event) =>
      ["e-created-6", "e-created-7"].includes(event.id),
    ),
  );
  const again = await applyActivityRun(stage, store, registry, "first");
  assert.equal(again.reused, true);
  assert.equal(again.outputSha256, applied.outputSha256);
});
test("已替换但未写回执的中断须显式恢复，未知替换时间保留null", async () => {
  const { stage, store } = await setup();
  await archiveImport(store, fixtureBytes, registry, "interrupt");
  await assert.rejects(
    applyActivityRun(stage, store, registry, "interrupt", undefined, {
      afterReplace: () => {
        throw new Error("synthetic_interruption");
      },
    }),
    /synthetic_interruption/,
  );
  const written = sha256(
    await readStageFile(stage, "site/data/events.v1.json"),
  );
  await assert.rejects(
    applyActivityRun(stage, store, registry, "interrupt"),
    /explicit_recovery/,
  );
  const recovered = await applyActivityRun(
    stage,
    store,
    registry,
    "interrupt",
    undefined,
    { recoverWrittenOutput: true },
  );
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.outputSha256, written);
  const receipt = await store.readRun("applications", recovered.applicationId);
  assert.equal(receipt.status, "complete");
  assert.equal(JSON.parse(receipt.files["receipt.json"]).appliedAt, null);
});
test("乱序快照不能覆盖较新观察，未变化分段延续键", () => {
  const old = fixture.snapshots[0];
  const current = structuredClone(old);
  current.source.observedAt = "2026-09-10T00:00:00Z";
  current.items[0].candidateId = "changed-candidate";
  delete current.items[0].sourceItemKey;
  assert.equal(
    assignStableItemKeys(current, old).items[0].sourceItemKey,
    old.items[0].sourceItemKey,
  );
  current.source.observedAt = "2026-09-08T00:00:00Z";
  assert.throws(
    () => assignStableItemKeys(current, old),
    /observation_regression/,
  );
});

import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  buildCandidateReview,
  type CandidateSnapshot,
  type EventIdentityMapping,
} from "./eventCandidates.ts";
import {
  assignStableItemKeys,
  prepareEventUpdate,
} from "./eventApplication.ts";
import {
  captureBrowserProof,
  encode,
  sha256,
  verifyCapture,
  type SourceCapture,
} from "./sourceCapture.ts";
import { captureHttp, collectShowstart, type HttpProof } from "./showstart.ts";
import {
  object,
  registrySource,
  requireState,
  type SourceRegistry,
} from "./sourceRegistry.ts";
import { createPipelineStore, type PipelineStore } from "./pipelineStore.ts";

export interface CaptureImport {
  schemaVersion: "idol-capture-import-v1";
  captures: SourceCapture[];
  proofs: { captureId: string; sha256: string; bytesBase64: string }[];
  snapshots: CandidateSnapshot[];
  mappings: EventIdentityMapping[];
  draft?: unknown;
}
const json = (bytes: Uint8Array): unknown =>
  JSON.parse(Buffer.from(bytes).toString("utf8"));

/** 入口只读普通文件，拒绝链接目录/文件、Windows ADS及越界。 */
export async function readStageFile(
  stageRoot: string,
  path: string,
  max = 12 * 1024 * 1024,
): Promise<Buffer> {
  requireState(
    !isAbsolute(path) &&
      !path.includes(":") &&
      !path
        .split(/[\\/]/u)
        .some((part) => !part || part === "." || part === ".."),
    "unsafe_stage_input_path",
  );
  const root = resolve(stageRoot),
    target = resolve(root, path);
  requireState(
    !relative(root, target).startsWith(`..${sep}`) && target !== root,
    "stage_input_escape",
  );
  let current = target;
  while (true) {
    const stat = await lstat(current);
    requireState(
      !stat.isSymbolicLink() &&
        (current === target
          ? stat.isFile() && stat.nlink === 1 && stat.size <= max
          : stat.isDirectory()),
      "non_regular_stage_input",
    );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const bytes = await readFile(target);
  requireState(bytes.length <= max, "stage_input_too_large");
  return bytes;
}

export function validateCaptureImport(
  input: unknown,
  registry: SourceRegistry,
  now: Date,
): CaptureImport {
  requireState(
    object(input) &&
      input.schemaVersion === "idol-capture-import-v1" &&
      Array.isArray(input.captures) &&
      input.captures.length > 0 &&
      input.captures.length <= 50 &&
      Array.isArray(input.proofs) &&
      input.proofs.length === input.captures.length &&
      Array.isArray(input.snapshots) &&
      input.snapshots.length <= 50 &&
      Array.isArray(input.mappings),
    "invalid_capture_import",
  );
  const ids = new Set<string>();
  for (const capture of input.captures) {
    requireState(
      object(capture) && typeof capture.registryId === "string",
      "invalid_capture_import_source",
    );
    const source = registrySource(registry, capture.registryId);
    verifyCapture(capture, source, now);
    requireState(!ids.has(capture.captureId), "duplicate_capture");
    ids.add(capture.captureId);
    const matches = input.proofs.filter(
      (proof) => object(proof) && proof.captureId === capture.captureId,
    );
    requireState(matches.length === 1, "capture_proof_missing_or_ambiguous");
    const proof = matches[0];
    requireState(
      object(proof) &&
        typeof proof.bytesBase64 === "string" &&
        proof.bytesBase64.length <= 6 * 1024 * 1024,
      "invalid_proof_bytes",
    );
    const bytes = Buffer.from(proof.bytesBase64, "base64");
    requireState(
      bytes.toString("base64") === proof.bytesBase64 &&
        sha256(bytes) === proof.sha256 &&
        proof.sha256 === capture.evidenceSha256,
      "capture_proof_hash_mismatch",
    );
    const original = json(bytes);
    const rebuilt =
      capture.method === "public-browser" && capture.selection
        ? captureBrowserProof(original, bytes, source, capture.selection, now)
        : captureHttp(original as HttpProof, source);
    requireState(
      encode(rebuilt) === encode(capture),
      "capture_does_not_match_proof",
    );
  }
  for (const snapshot of input.snapshots) {
    requireState(
      object(snapshot) &&
        object(snapshot.source) &&
        Array.isArray(snapshot.items) &&
        snapshot.items.length <= 1000 &&
        input.captures.some(
          (capture) => encode(capture.source) === encode(snapshot.source),
        ),
      "snapshot_without_verified_capture",
    );
    for (const item of snapshot.items)
      requireState(
        object(item) &&
          typeof item.candidateId === "string" &&
          object(item.fields),
        "invalid_candidate_input",
      );
  }
  return input as unknown as CaptureImport;
}

async function previousContext(store: PipelineStore): Promise<{
  snapshots: CandidateSnapshot[];
  mappings: EventIdentityMapping[];
}> {
  const latest = new Map<string, CandidateSnapshot>();
  const mappings = new Map<string, EventIdentityMapping>();
  for (const run of await store.listRuns("activities")) {
    requireState(
      run.status === "complete",
      `unfinished_or_corrupt_activity_run:${run.runId}`,
    );
    const snapshots = json(run.files["snapshots.json"]) as CandidateSnapshot[];
    for (const mapping of json(
      run.files["mappings.json"],
    ) as EventIdentityMapping[])
      mappings.set(encode(mapping), mapping);
    for (const snapshot of snapshots) {
      const before = latest.get(snapshot.source.sourceId);
      if (
        !before ||
        Date.parse(snapshot.source.observedAt) >
          Date.parse(before.source.observedAt)
      )
        latest.set(snapshot.source.sourceId, snapshot);
      else if (snapshot.source.observedAt === before.source.observedAt)
        requireState(
          snapshot.source.bodySha256 === before.source.bodySha256,
          "conflicting_equal_time_source",
        );
    }
  }
  return { snapshots: [...latest.values()], mappings: [...mappings.values()] };
}

export async function archiveImport(
  store: PipelineStore,
  inputBytes: Uint8Array,
  registry: SourceRegistry,
  runId: string,
  now = new Date(),
) {
  const input = validateCaptureImport(json(inputBytes), registry, now);
  const inputSha256 = sha256(inputBytes),
    registrySha256 = sha256(encode(registry));
  return store.withStoreLock("activities", async () => {
    const existing = await store.readRun("activities", runId);
    if (existing.status === "complete") {
      requireState(
        object(existing.metadata) &&
          existing.metadata.inputSha256 === inputSha256 &&
          existing.metadata.registrySha256 === registrySha256,
        "run_input_changed",
      );
      return {
        runId,
        reused: true,
        status: "complete",
        report: json(existing.files["review.json"]),
      };
    }
    requireState(
      existing.status === "missing",
      `run_requires_explicit_recovery:${existing.status}`,
    );
    const previous = await previousContext(store);
    const snapshots = input.snapshots.map((snapshot) =>
      assignStableItemKeys(
        snapshot,
        previous.snapshots.find(
          (old) => old.source.sourceId === snapshot.source.sourceId,
        ),
      ),
    );
    const mappings = [
      ...new Map(
        [...previous.mappings, ...input.mappings].map((mapping) => [
          encode(mapping),
          mapping,
        ]),
      ).values(),
    ];
    const report = buildCandidateReview({
      snapshots,
      previousSnapshots: previous.snapshots,
      mappings,
      now,
    });
    const files: Record<string, string | Uint8Array> = {
      "captures.json": encode(input.captures),
      "snapshots.json": encode(snapshots),
      "mappings.json": encode(mappings),
      "review.json": encode(report),
    };
    for (const proof of input.proofs)
      files[`proofs/${proof.captureId}.json`] = Buffer.from(
        proof.bytesBase64,
        "base64",
      );
    if (input.draft) files["draft.json"] = encode(input.draft);
    await store.commitRun("activities", runId, files, {
      inputSha256,
      registrySha256,
    });
    return {
      runId,
      reused: false,
      status: "complete",
      report: json(Buffer.from(encode(report))),
    };
  });
}

export async function collectPublicRun(
  store: PipelineStore,
  registry: SourceRegistry,
  sourceId: string,
  now = new Date(),
) {
  const source = registrySource(registry, sourceId);
  const day = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const runId = `public-${sourceId}-${day}`;
  // 同一天同入口只做一次真实采集；缓存不刷新原观察时间。
  const cached = await store.readRun("activities", runId);
  if (cached.status === "complete")
    return {
      runId,
      status: "complete",
      reused: true,
      requests: 0,
      report: json(cached.files["review.json"]),
    };
  requireState(
    cached.status === "missing",
    "public_run_incomplete_requires_review",
  );
  return store.withStoreLock("public-collection", async () => {
    const again = await store.readRun("activities", runId);
    if (again.status === "complete")
      return {
        runId,
        status: "complete",
        reused: true,
        requests: 0,
        report: json(again.files["review.json"]),
      };
    const result = await collectShowstart(source, now);
    const input: CaptureImport = {
      schemaVersion: "idol-capture-import-v1",
      captures: result.captures,
      proofs: result.captures.map((capture) => {
        const proof = result.proofs.find(
          (item) => item.sourceUrl === capture.source.sourceUrl,
        );
        requireState(proof, "missing_http_proof");
        const bytes = Buffer.from(encode(proof));
        return {
          captureId: capture.captureId,
          sha256: sha256(bytes),
          bytesBase64: bytes.toString("base64"),
        };
      }),
      snapshots: [result.snapshot],
      mappings: [],
    };
    // 不同实例的不同锁负责采集与归档；归档仍使用 activities 全局单写锁。
    const activityStore = await createPipelineStore(store.storeRoot);
    return {
      ...(await archiveImport(
        activityStore,
        Buffer.from(encode(input)),
        registry,
        runId,
        new Date(),
      )),
      requests: result.proofs.length,
    };
  });
}

export async function applyActivityRun(
  stageRoot: string,
  store: PipelineStore,
  registry: SourceRegistry,
  runId: string,
  draftBytes?: Uint8Array,
  options: { recoverWrittenOutput?: boolean; afterReplace?: () => void } = {},
) {
  return store.withStoreLock("activity-application", async () => {
    const run = await store.readRun("activities", runId);
    requireState(run.status === "complete", "activity_run_not_complete");
    const captures = json(run.files["captures.json"]) as SourceCapture[];
    const draft = draftBytes ? json(draftBytes) : json(run.files["draft.json"]);
    const draftHash = sha256(encode(draft));
    const applicationId = `${runId.slice(0, 60)}-${draftHash.slice(0, 20)}`;
    const eventsPath = "site/data/events.v1.json";
    const baseline = await readStageFile(stageRoot, eventsPath);
    const previous = await store.readRun("applications", applicationId);
    if (previous.status === "complete") {
      requireState(
        object(previous.metadata) &&
          previous.metadata.outputSha256 === sha256(baseline),
        "applied_site_drift",
      );
      return {
        applicationId,
        reused: true,
        changed: false,
        outputSha256: sha256(baseline),
      };
    }
    requireState(
      previous.status === "missing",
      "application_incomplete_requires_review",
    );
    const savedPlan = await store.readRun("application-plans", applicationId);
    if (
      savedPlan.status === "complete" &&
      object(savedPlan.metadata) &&
      savedPlan.metadata.outputSha256 === sha256(baseline)
    ) {
      requireState(
        options.recoverWrittenOutput === true &&
          sha256(savedPlan.files["reviewed-draft.json"]) === draftHash,
        "written_output_requires_explicit_recovery",
      );
      const outputSha256 = sha256(baseline);
      await store.commitRun(
        "applications",
        applicationId,
        {
          "receipt.json": encode({
            applicationId,
            runId,
            draftHash,
            outputSha256,
            appliedAt: null,
            recoveredAt: new Date().toISOString(),
            note: "确认站点字节与已归档应用计划输出一致；实际替换时间未知。",
          }),
        },
        { outputSha256 },
      );
      return {
        applicationId,
        reused: true,
        changed: false,
        recovered: true,
        outputSha256,
      };
    }
    const groupBytes = await readStageFile(stageRoot, "site/data.js");
    const match = /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(
      groupBytes.toString("utf8"),
    );
    requireState(match, "invalid_display_groups");
    const groups = JSON.parse(match[1]) as { groups: { id: string }[] };
    const prepared = prepareEventUpdate(
      baseline,
      draft,
      captures,
      registry,
      groups.groups.map((group) => group.id),
    );
    const outputSha256 = sha256(prepared.bytes);
    // 先完成计划归档再改公开维护源；中断后发现预像/输出不符均停止。
    await store.commitRun(
      "application-plans",
      applicationId,
      {
        "before.events.json": baseline,
        "after.events.json": prepared.bytes,
        "reviewed-draft.json": encode(draft),
      },
      {
        runId,
        outputSha256,
        baselineSha256: sha256(baseline),
        groupSha256: sha256(groupBytes),
      },
    );
    requireState(
      sha256(await readStageFile(stageRoot, "site/data.js")) ===
        sha256(groupBytes),
      "display_groups_drift",
    );
    const stageStore = await createPipelineStore(stageRoot);
    await stageStore.withStoreLock("public-events", () =>
      stageStore.atomicReplace(eventsPath, prepared.bytes, sha256(baseline)),
    );
    options.afterReplace?.();
    await store.commitRun(
      "applications",
      applicationId,
      {
        "receipt.json": encode({
          applicationId,
          runId,
          draftHash,
          outputSha256,
          changedIds: prepared.changedIds,
          appliedAt: new Date().toISOString(),
        }),
      },
      { outputSha256 },
    );
    return {
      applicationId,
      reused: false,
      changed: true,
      outputSha256,
      changedIds: prepared.changedIds,
    };
  });
}

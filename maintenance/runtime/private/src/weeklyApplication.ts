import { createHash } from "node:crypto";
import { readFile, lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  emptyFollowerObservations,
  followerObservationConflict,
  latestFollowerBaseline,
  object,
  observationTime,
  observationWeek,
  overlayFollowerObservations,
  strictFollowerIdentity,
  validateFollowerObservations,
  type FollowerObservation,
  type FollowerObservations,
} from "../../site/src/catalog/followerObservations.ts";

type Group = { id: string; [key: string]: unknown };
type Previous = {
  followersValue: number | null;
  followersDisplay: string | null;
  followersApproximate: boolean | null;
  followersObservedAt: string | null;
};
type Selected = { id: string; uid: string; previous: Previous };
type Batch = { key: string; values: string[]; groupIds: string[] };
type Plan = {
  schemaVersion: string;
  weekId: string;
  sourceSha256: string;
  selected: Selected[];
  batches: Batch[];
  blockers: string[];
  review: Review[];
};
type Inputs = {
  groups: Group[];
  conflictRecords: Record<string, unknown>[];
  sourceSha256: string;
};
type Collector = {
  readWeeklyInputs: (root: string) => Promise<Inputs>;
  buildWeeklyPlan: (input: Inputs & { now: Date }) => Plan;
  runWeeklyRefresh: (
    input: Inputs & { archiveRoot: string; live: false; clock: () => Date },
  ) => Promise<{
    status: string;
    blocker?: string;
    plan: Plan;
    summary?: { cachedBatches: number };
  }>;
};
export type Review = {
  id: string;
  uid?: string;
  reason: string;
  fields?: string[];
};
export type WeeklyCandidate = {
  id: string;
  uid: string;
  followersValue: number;
  followersDisplay: string;
  followersApproximate: false;
  followersObservedAt: string;
  sourceUrl: string;
  reviewReason: "followers_jump" | null;
  evidence: {
    requestKey: string;
    responsePath: string;
    responseSha256: string;
  };
};
export interface WeeklyApplicationResult {
  status: "ready" | "blocked";
  dataset: FollowerObservations;
  applied: string[];
  unchanged: string[];
  review: Review[];
  errors: string[];
  verifiedInputHashes: { relativePath: string; sha256: string }[];
}

const STORE = "sources/weekly-profile-refresh";
const defaultCollector = fileURLToPath(
  new URL(
    "../../../../outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01/tools/weekly_profile_refresh.mjs",
    import.meta.url,
  ),
);
const hash = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;
function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
function jump(previous: unknown, next: number): boolean {
  return (
    typeof previous === "number" &&
    Number.isSafeInteger(previous) &&
    Math.abs(next - previous) >= 1000 &&
    Math.abs(next - previous) / Math.max(previous, 1) > 0.5
  );
}

/** 纯应用门；生产入口必须先由 inspectWeeklyApplication 验证归档响应闭合。 */
export function applyWeeklyCandidates({
  candidates,
  masterGroups,
  displayGroups,
  selected,
  current,
  now = new Date(),
}: {
  candidates: WeeklyCandidate[];
  masterGroups: Group[];
  displayGroups: Group[];
  selected: Selected[];
  current: unknown;
  now?: Date;
}): WeeklyApplicationResult {
  const result: WeeklyApplicationResult = {
    status: "blocked",
    dataset: emptyFollowerObservations(),
    applied: [],
    unchanged: [],
    review: [],
    errors: [],
    verifiedInputHashes: [],
  };
  try {
    const validation = validateFollowerObservations(current, now);
    requireCondition(validation.valid, "invalid_current_follower_layer");
    result.dataset = validation.data;
    const master = new Map(masterGroups.map((group) => [group.id, group]));
    const display = new Map(displayGroups.map((group) => [group.id, group]));
    requireCondition(
      master.size === masterGroups.length &&
        display.size === displayGroups.length,
      "duplicate_group_id",
    );
    const eligible = new Map(selected.map((record) => [record.id, record.uid]));
    const identityValid = (id: string, uid: string): boolean =>
      eligible.get(id) === uid &&
      strictFollowerIdentity(master.get(id), uid) &&
      strictFollowerIdentity(display.get(id), uid) &&
      masterGroups.filter((group) => String(group.weiboUid ?? "") === uid)
        .length === 1 &&
      displayGroups.filter((group) => String(group.weiboUid ?? "") === uid)
        .length === 1;
    for (const record of validation.data.records)
      requireCondition(
        identityValid(record.groupId, record.uid),
        `current_identity_mismatch:${record.groupId}`,
      );
    const proposed = new Map(
      validation.data.records.map((record) => [record.groupId, record]),
    );
    const ids = new Set<string>();
    const uids = new Set<string>();
    for (const candidate of candidates) {
      requireCondition(
        !ids.has(candidate.id) && !uids.has(candidate.uid),
        "duplicate_candidate_identity",
      );
      ids.add(candidate.id);
      uids.add(candidate.uid);
      requireCondition(
        object(candidate.evidence) &&
          equal(
            Object.keys(candidate).sort(),
            [
              "id",
              "uid",
              "followersValue",
              "followersDisplay",
              "followersApproximate",
              "followersObservedAt",
              "sourceUrl",
              "reviewReason",
              "evidence",
            ].sort(),
          ) &&
          equal(
            Object.keys(candidate.evidence).sort(),
            ["requestKey", "responsePath", "responseSha256"].sort(),
          ) &&
          /^[a-f0-9]{64}$/u.test(candidate.evidence.requestKey) &&
          candidate.evidence.responsePath ===
            `${STORE}/${observationWeek(candidate.followersObservedAt)}/${candidate.evidence.requestKey}.response.json` &&
          candidate.followersApproximate === false &&
          (candidate.reviewReason === null ||
            candidate.reviewReason === "followers_jump"),
        "invalid_candidate_shape",
      );
      const record: FollowerObservation = {
        groupId: candidate.id,
        uid: candidate.uid,
        followersValue: candidate.followersValue,
        followersDisplay: candidate.followersDisplay,
        followersApproximate: candidate.followersApproximate,
        followersObservedAt: candidate.followersObservedAt,
        sourceUrl: candidate.sourceUrl,
        weekId: observationWeek(candidate.followersObservedAt),
        identityGate: "strict_uid_match",
        responseSha256: candidate.evidence.responseSha256,
      };
      requireCondition(
        validateFollowerObservations(
          {
            schemaVersion: "idol-follower-observations-v1",
            updatedAt: record.followersObservedAt,
            records: [record],
          },
          now,
        ).valid,
        `invalid_candidate_observation:${candidate.id}`,
      );
      if (!identityValid(candidate.id, candidate.uid)) {
        result.review.push({
          id: candidate.id,
          uid: candidate.uid,
          reason: "cross_master_display_identity_mismatch",
        });
        continue;
      }
      const previous = proposed.get(candidate.id);
      const baseline = latestFollowerBaseline(
        [master.get(candidate.id), display.get(candidate.id), previous],
        now,
      );
      const conflict = followerObservationConflict(record, baseline);
      if (conflict) {
        result.review.push({
          id: candidate.id,
          uid: candidate.uid,
          reason: conflict,
        });
        continue;
      }
      if (previous) {
        if (equal(previous, record)) {
          result.unchanged.push(candidate.id);
          continue;
        }
        if (
          Date.parse(record.followersObservedAt) <=
          Date.parse(previous.followersObservedAt)
        ) {
          result.review.push({
            id: candidate.id,
            uid: candidate.uid,
            reason:
              Date.parse(record.followersObservedAt) <
              Date.parse(previous.followersObservedAt)
                ? "older_observation"
                : "same_time_conflict",
          });
          continue;
        }
        if (previous.weekId === record.weekId) {
          result.review.push({
            id: candidate.id,
            uid: candidate.uid,
            reason: "same_week_observation_conflict",
          });
          continue;
        }
      }
      // 上游跳变按冻结主档计算；已有更晚可信观察时应以最新值重算。
      if (
        baseline
          ? jump(baseline.value, record.followersValue)
          : candidate.reviewReason
      ) {
        result.review.push({
          id: candidate.id,
          uid: candidate.uid,
          reason: "followers_jump",
        });
        continue;
      }
      proposed.set(candidate.id, record);
      result.applied.push(candidate.id);
    }
    const records = [...proposed.values()].sort((a, b) =>
      a.groupId.localeCompare(b.groupId, "en"),
    );
    result.dataset = {
      schemaVersion: "idol-follower-observations-v1",
      updatedAt: records.reduce<string | null>(
        (latest, record) =>
          latest === null ||
          Date.parse(record.followersObservedAt) > Date.parse(latest)
            ? record.followersObservedAt
            : latest,
        null,
      ),
      records,
    };
    requireCondition(
      validateFollowerObservations(result.dataset, now).valid,
      "invalid_output_follower_layer",
    );
    for (const record of records) {
      const conflict = followerObservationConflict(
        record,
        latestFollowerBaseline(
          [master.get(record.groupId), display.get(record.groupId)],
          now,
        ),
      );
      requireCondition(
        !conflict,
        `current_follower_${conflict}:${record.groupId}`,
      );
    }
    overlayFollowerObservations(displayGroups, result.dataset, now);
    result.status = "ready";
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : "weekly_application_failed",
    );
    result.applied = [];
    result.unchanged = [];
  }
  return result;
}

/** 所有 IO 均只读：固定归档文件逐段拒绝链接，并记录复读指纹。 */
export async function inspectWeeklyApplication({
  archiveRoot,
  weekId,
  displayGroups,
  current,
  now = new Date(),
  collectorModulePath = defaultCollector,
}: {
  archiveRoot: string;
  weekId: string;
  displayGroups: Group[];
  current: unknown;
  now?: Date;
  collectorModulePath?: string;
}): Promise<WeeklyApplicationResult> {
  const fingerprints = new Map<string, string>();
  const failure: WeeklyApplicationResult = {
    status: "blocked",
    dataset: emptyFollowerObservations(),
    applied: [],
    unchanged: [],
    review: [],
    errors: [],
    verifiedInputHashes: [],
  };
  try {
    const base = path.resolve(archiveRoot);
    requireCondition(
      (await lstat(base)).isDirectory() &&
        !(await lstat(base)).isSymbolicLink() &&
        path.resolve(await realpath(base)).toLowerCase() === base.toLowerCase(),
      "unsafe_archive_root",
    );
    const read = async (relative: string): Promise<Buffer> => {
      requireCondition(
        !path.isAbsolute(relative) &&
          relative
            .split("/")
            .every((part) => part && part !== "." && part !== ".."),
        "unsafe_archive_path",
      );
      let target = base;
      const parts = relative.split("/");
      for (const [index, part] of parts.entries()) {
        target = path.join(target, part);
        const stat = await lstat(target);
        requireCondition(
          !stat.isSymbolicLink() &&
            (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()),
          "unsafe_archive_file",
        );
      }
      const bytes = await readFile(target);
      const digest = hash(bytes);
      requireCondition(
        !fingerprints.has(relative) || fingerprints.get(relative) === digest,
        "archive_changed_during_validation",
      );
      fingerprints.set(relative, digest);
      return bytes;
    };
    const requireUnlocked = async (): Promise<void> => {
      try {
        await lstat(path.join(base, STORE, "maintenance.lock"));
      } catch (error) {
        if (object(error) && error.code === "ENOENT") return;
        throw error;
      }
      throw new Error("weekly_maintenance_locked");
    };
    requireCondition(
      /^week-\d{4}-\d{2}-\d{2}$/u.test(weekId),
      "invalid_week_id",
    );
    const weekClock = new Date(`${weekId.slice(5)}T00:00:00+08:00`);
    requireCondition(
      observationTime(weekClock.toISOString(), now) !== null &&
        observationWeek(weekClock.toISOString()) === weekId,
      "invalid_or_future_week",
    );
    await read("data/群体分布数据.json");
    await read("sources/微博官方接口候选主档冲突_2026-09-02.json");
    const collector = (await import(
      pathToFileURL(collectorModulePath).href
    )) as Collector;
    const inputs = await collector.readWeeklyInputs(base);
    const plan = collector.buildWeeklyPlan({ ...inputs, now: weekClock });
    requireCondition(
      plan.blockers.length === 0,
      plan.blockers[0] ?? "blocked_weekly_plan",
    );
    const dry = await collector.runWeeklyRefresh({
      ...inputs,
      archiveRoot: base,
      live: false,
      clock: () => weekClock,
    });
    await requireUnlocked();
    requireCondition(
      dry.status === "planned",
      `collector_blocked:${dry.blocker ?? "unknown"}`,
    );
    requireCondition(
      equal(dry.plan, plan) &&
        dry.summary?.cachedBatches === plan.batches.length,
      "incomplete_archived_batches",
    );
    const prefix = `${STORE}/${weekId}`;
    const savedPlan = JSON.parse(
      (await read(`${prefix}/plan.json`)).toString("utf8"),
    ) as unknown;
    requireCondition(equal(savedPlan, plan), "archived_plan_mismatch");
    const snapshot = JSON.parse(
      (await read(`${prefix}/snapshot.json`)).toString("utf8"),
    ) as unknown;
    requireCondition(
      object(snapshot) &&
        equal(
          Object.keys(snapshot).sort(),
          [
            "schemaVersion",
            "weekId",
            "sourceSha256",
            "complete",
            "completedAt",
            "candidates",
            "review",
            "diff",
            "policy",
          ].sort(),
        ) &&
        snapshot.schemaVersion === "weekly-profile-snapshot-v1" &&
        snapshot.weekId === weekId &&
        snapshot.sourceSha256 === inputs.sourceSha256 &&
        snapshot.complete === true &&
        observationTime(snapshot.completedAt, now) !== null,
      "invalid_completed_snapshot",
    );
    const observations: WeeklyCandidate[] = [];
    const manual: Review[] = [];
    const expectedFiles = new Set(["plan.json", "snapshot.json"]);
    for (const batch of plan.batches) {
      for (const suffix of ["attempt", "response", "receipt"])
        expectedFiles.add(`${batch.key}.${suffix}.json`);
      const attemptBytes = await read(`${prefix}/${batch.key}.attempt.json`);
      const responseBytes = await read(`${prefix}/${batch.key}.response.json`);
      const receiptBytes = await read(`${prefix}/${batch.key}.receipt.json`);
      const attempt = JSON.parse(attemptBytes.toString("utf8")) as unknown;
      const receipt = JSON.parse(receiptBytes.toString("utf8")) as unknown;
      requireCondition(
        object(attempt) &&
          object(receipt) &&
          attempt.schemaVersion === "weekly-profile-attempt-v1" &&
          receipt.schemaVersion === "weekly-profile-receipt-v1" &&
          attempt.weekId === weekId &&
          attempt.requestKey === batch.key &&
          receipt.outcome === "success" &&
          receipt.weekId === weekId &&
          receipt.requestKey === batch.key &&
          receipt.attemptSha256 === hash(attemptBytes) &&
          receipt.responseSha256 === hash(responseBytes) &&
          attempt.planSha256 === hash(encode(plan)) &&
          equal(attempt.uids, batch.values),
        "receipt_attempt_response_mismatch",
      );
      requireCondition(
        observationTime(receipt.observedAt, now) !== null &&
          observationWeek(receipt.observedAt as string) === weekId &&
          Date.parse(receipt.observedAt as string) <=
            Date.parse(snapshot.completedAt as string),
        "invalid_receipt_observed_at",
      );
      requireCondition(
        observationTime(attempt.startedAt, now) !== null &&
          observationWeek(attempt.startedAt as string) === weekId &&
          Date.parse(attempt.startedAt as string) <=
            Date.parse(receipt.observedAt as string),
        "invalid_attempt_started_at",
      );
      const response = JSON.parse(responseBytes.toString("utf8")) as unknown;
      requireCondition(
        object(response) &&
          typeof response.stdout === "string" &&
          response.exitCode === 0 &&
          response.stderr === "" &&
          !response.signal &&
          !response.timedOut,
        "invalid_archived_response",
      );
      const payload = JSON.parse(response.stdout) as unknown;
      const profiles: Record<string, unknown>[] = [];
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!object(value)) return;
        if (Object.hasOwn(value, "followers_count")) {
          profiles.push(value);
          return;
        }
        Object.values(value).forEach(visit);
      };
      visit(payload);
      requireCondition(
        profiles.length === batch.values.length,
        "missing_or_extra_profiles",
      );
      const seen = new Set<string>();
      for (const profile of profiles) {
        const uidValues = [profile.idstr, profile.uid, profile.id].filter(
          (value) => value !== null && value !== undefined,
        );
        const uid = String(uidValues[0] ?? "");
        requireCondition(
          /^\d{4,20}$/u.test(uid) &&
            uidValues.every(
              (value) =>
                (typeof value === "string" ||
                  (typeof value === "number" && Number.isSafeInteger(value))) &&
                String(value) === uid,
            ) &&
            batch.values.includes(uid) &&
            !seen.has(uid),
          "profile_uid_mismatch_or_duplicate",
        );
        seen.add(uid);
        const followersValue = profile.followers_count;
        requireCondition(
          typeof followersValue === "number" &&
            Number.isSafeInteger(followersValue) &&
            followersValue >= 0,
          "invalid_followers_field",
        );
        const selected = plan.selected.find((record) => record.uid === uid);
        requireCondition(selected, "profile_outside_plan");
        observations.push({
          id: selected.id,
          uid,
          followersValue,
          followersDisplay: String(followersValue),
          followersApproximate: false,
          followersObservedAt: receipt.observedAt as string,
          sourceUrl: `https://weibo.com/u/${uid}`,
          reviewReason: jump(selected.previous.followersValue, followersValue)
            ? "followers_jump"
            : null,
          evidence: {
            requestKey: batch.key,
            responsePath: `${prefix}/${batch.key}.response.json`,
            responseSha256: hash(responseBytes),
          },
        });
        const fields = Object.keys(profile)
          .filter(
            (key) => !["idstr", "uid", "id", "followers_count"].includes(key),
          )
          .sort();
        if (fields.length)
          manual.push({
            id: selected.id,
            uid,
            reason: "non_follower_fields_manual_only",
            fields,
          });
      }
    }
    const names = await readdir(path.join(base, prefix));
    requireCondition(
      [...expectedFiles].every((name) => names.includes(name)) &&
        names.every(
          (name) =>
            expectedFiles.has(name) ||
            name === "account.json" ||
            /^probe-\d+-[a-f0-9-]{36}-[a-z-]+\.json$/u.test(name),
        ),
      "unexpected_or_partial_weekly_files",
    );
    for (const name of names)
      if (!expectedFiles.has(name)) await read(`${prefix}/${name}`);
    requireCondition(
      equal(
        snapshot.candidates,
        observations.filter((record) => !record.reviewReason),
      ) &&
        equal(snapshot.review, [
          ...plan.review,
          ...observations.filter((record) => record.reviewReason),
        ]) &&
        equal(
          snapshot.diff,
          observations.map((record) => ({
            id: record.id,
            uid: record.uid,
            previous: plan.selected.find(
              (selected) => selected.id === record.id,
            )?.previous,
            next: record,
            reviewRequired: Boolean(record.reviewReason),
          })),
        ) &&
        equal(snapshot.policy, {
          automaticIdentityBinding: false,
          automaticPublishing: false,
          allowedFields: [
            "followersValue",
            "followersDisplay",
            "followersApproximate",
            "followersObservedAt",
            "sourceUrl",
            "evidence",
          ],
        }),
      "completed_snapshot_content_mismatch",
    );
    const result = applyWeeklyCandidates({
      candidates: observations,
      masterGroups: inputs.groups,
      displayGroups,
      selected: plan.selected,
      current,
      now,
    });
    result.review.push(...plan.review, ...manual);
    for (const relative of fingerprints.keys()) await read(relative);
    await requireUnlocked();
    result.verifiedInputHashes = [...fingerprints].map(
      ([relativePath, sha256]) => ({ relativePath, sha256 }),
    );
    return result;
  } catch (error) {
    failure.errors.push(
      error instanceof Error
        ? error.message
        : "weekly_archive_validation_failed",
    );
    return failure;
  }
}

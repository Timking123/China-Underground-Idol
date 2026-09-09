import { fileURLToPath } from "node:url";
import { readStageFile } from "./pipeline.ts";
import { encode, isTimestamp, sha256 } from "./sourceCapture.ts";
import { object, requireState } from "./sourceRegistry.ts";
import {
  latestFollowerBaseline,
  strictFollowerIdentity,
  type FollowerBaseline,
} from "../../site/src/catalog/followerObservations.ts";

export const WEEKLY_STAGE = fileURLToPath(new URL("../../", import.meta.url));
export const WEEKLY_ARCHIVE = fileURLToPath(
  new URL(
    "../../../../outputs/01a05afc-207e-7482-bbb6-c1df12c8da84/中国地下偶像分布图_2026-09-01/",
    import.meta.url,
  ),
);
export const WEEKLY_LIMITS = Object.freeze({
  batchSize: 50,
  maximumBatches: 8,
  intervalMs: 2000,
  reserveCredits: 4000,
});
const UID = /^\d{4,20}$/u;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MANUAL_DATE = "2026-09-09";
const FIRST_SCHEDULED_DATE = "2026-09-11";
// 这两项是已明确复核的账号范围例外，不扩展为任意被拒绝身份的通行证。
const REVIEWED_ACCOUNT_SCOPES: Readonly<Record<string, string>> = Object.freeze(
  {
    g060: "2030310713",
    g360: "8257746955",
  },
);

export interface WeeklySlot {
  id: string;
  trigger: "manual" | "scheduled";
  date: string;
  startsAt: string;
  closesAt: string;
  timezone: "Asia/Shanghai";
}
export interface WeeklyTarget {
  id: string;
  uid: string;
  name: string;
  handle: string | null;
  identityGate:
    "strict_uid_match" | "accepted_candidate" | "reviewed_account_scope";
  entityKind: string;
  scopeNote: string | null;
  uidSource: string;
  uidConfidence: "high";
  identityAcceptedByThisRun: false;
  canonicalImpact: "none";
  identitySource: string;
  identityEvidence: string | null;
  identityBasis: string | null;
  previous: FollowerBaseline | null;
}
export interface WeeklyReview {
  id: string;
  uid: string | null;
  reason: string;
}
export interface WeeklyScope {
  schemaVersion: "idol-weekly-scope-v2";
  frozenAt: string;
  sourceSha256: string;
  sourceFiles: { path: string; sha256: string; bytes: number }[];
  targets: WeeklyTarget[];
  excluded: { id: string; name: string; status: string }[];
  review: WeeklyReview[];
  activeCount: number;
}
export interface WeeklyPlan {
  schemaVersion: "idol-weekly-plan-v2";
  slot: WeeklySlot;
  scope: WeeklyScope;
  batches: { key: string; uids: string[]; groupIds: string[] }[];
  limits: typeof WEEKLY_LIMITS;
  maximumAccounts: number;
  maximumBatches: number;
  blockers: string[];
}
export interface WeeklyInputs {
  files: Record<string, Buffer>;
  displayGroups: Record<string, unknown>[];
  masterGroups: Record<string, unknown>[];
  conflicts: Record<string, unknown>[];
  editorialRecords: Record<string, unknown>[];
  publicRecords: Record<string, unknown>[];
  acceptanceRecords: Record<string, unknown>[];
  supplementalRecords: Record<string, unknown>[];
  edgeRecords: Record<string, unknown>[];
}
const same = (a: unknown, b: unknown): boolean => encode(a) === encode(b);
function records(value: unknown, field: string): Record<string, unknown>[] {
  requireState(
    object(value) && Array.isArray(value[field]),
    "invalid_weekly_source",
  );
  const rows = value[field];
  requireState(rows.every(object), "invalid_weekly_source_record");
  return rows;
}
function indexed(
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    requireState(
      typeof row.id === "string" &&
        /^g\d+$/u.test(row.id) &&
        !result.has(row.id),
      "duplicate_or_invalid_weekly_id",
    );
    result.set(row.id, row);
  }
  return result;
}

/** 固定入口只读当前受审展示与其来源；旧档案永不作为写入根。 */
export async function readWeeklyRuntimeInputs(): Promise<WeeklyInputs> {
  const specs = [
    ["display.js", WEEKLY_STAGE, "site/data.js"],
    ["master.json", WEEKLY_STAGE, "site/data/群体分布数据.json"],
    ["editorial.json", WEEKLY_STAGE, "site/data/编辑展示覆盖数据.json"],
    ["public-review.json", WEEKLY_STAGE, "site/data/公开补充复核.json"],
    [
      "conflicts.json",
      WEEKLY_ARCHIVE,
      "sources/微博官方接口候选主档冲突_2026-09-02.json",
    ],
    [
      "identity-acceptance.json",
      WEEKLY_ARCHIVE,
      "sources/微博编辑身份接受批次_2026-09-04.json",
    ],
    [
      "identity-supplement.json",
      WEEKLY_ARCHIVE,
      "sources/微博编辑身份补充复核批次_2026-09-04.json",
    ],
    [
      "edge-review.json",
      WEEKLY_ARCHIVE,
      "sources/Edge微博人工复核补充_2026-09-04.json",
    ],
  ];
  const files = Object.fromEntries(
    await Promise.all(
      specs.map(async ([name, root, relative]) => [
        name,
        await readStageFile(root, relative),
      ]),
    ),
  );
  return parseWeeklyRuntimeInputs(files);
}

export function parseWeeklyRuntimeInputs(
  files: Record<string, Buffer>,
): WeeklyInputs {
  const expected = [
    "display.js",
    "master.json",
    "editorial.json",
    "public-review.json",
    "conflicts.json",
    "identity-acceptance.json",
    "identity-supplement.json",
    "edge-review.json",
  ];
  requireState(
    same(Object.keys(files).sort(), expected.sort()),
    "incomplete_weekly_source_files",
  );
  const match = /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(
    files["display.js"].toString("utf8"),
  );
  requireState(match, "invalid_weekly_display_data");
  const json = (name: string): unknown =>
    JSON.parse(files[name].toString("utf8"));
  const conflicts = json("conflicts.json"),
    editorial = json("editorial.json"),
    publicReview = json("public-review.json");
  requireState(
    object(conflicts) &&
      conflicts.schemaVersion === "weibo-official-strict-master-conflicts-v1",
    "invalid_weekly_conflict_source",
  );
  requireState(
    object(editorial) && editorial.schemaVersion === "1.0",
    "invalid_weekly_editorial_source",
  );
  requireState(
    object(publicReview) &&
      publicReview.schemaVersion === "public-reviewed-supplement-v1",
    "invalid_weekly_public_review_source",
  );
  return {
    files,
    displayGroups: records(JSON.parse(match[1]), "groups"),
    masterGroups: records(json("master.json"), "groups"),
    conflicts: records(conflicts, "records"),
    editorialRecords: records(editorial, "records"),
    publicRecords: records(publicReview, "records"),
    acceptanceRecords: records(json("identity-acceptance.json"), "records"),
    supplementalRecords: records(json("identity-supplement.json"), "records"),
    edgeRecords: records(json("edge-review.json"), "records"),
  };
}

/** 手动授权仅对应本次请求；定时槽每周五零点换新，不与周一编号的旧缓存混用。 */
export function weeklySlot(
  trigger: "manual" | "scheduled",
  now: Date,
): WeeklySlot {
  requireState(Number.isFinite(now.getTime()), "invalid_weekly_clock");
  let date: string;
  let closesAt: string;
  if (trigger === "manual") {
    date = MANUAL_DATE;
    closesAt = new Date(`${FIRST_SCHEDULED_DATE}T00:00:00+08:00`).toISOString();
  } else {
    requireState(trigger === "scheduled", "invalid_weekly_trigger");
    const local = new Date(now.getTime() + 8 * HOUR);
    local.setUTCHours(0, 0, 0, 0);
    local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 2) % 7));
    date = local.toISOString().slice(0, 10);
    requireState(date >= FIRST_SCHEDULED_DATE, "weekly_schedule_not_started");
    closesAt = new Date(local.getTime() - 8 * HOUR + 7 * DAY).toISOString();
  }
  const startsAt = new Date(`${date}T00:00:00+08:00`).toISOString();
  requireState(
    now.getTime() >= Date.parse(startsAt) &&
      now.getTime() < Date.parse(closesAt),
    "weekly_slot_closed",
  );
  return {
    id: `${trigger}-${date}`,
    trigger,
    date,
    startsAt,
    closesAt,
    timezone: "Asia/Shanghai",
  };
}

export function buildWeeklyScope(inputs: WeeklyInputs, now: Date): WeeklyScope {
  requireState(Number.isFinite(now.getTime()), "invalid_weekly_clock");
  // 只从冻结原始字节重建，调用方更改解析对象不能脱离来源 hash 改目标名单。
  inputs = parseWeeklyRuntimeInputs(inputs.files);
  const display = indexed(inputs.displayGroups),
    master = indexed(inputs.masterGroups);
  const editorial = indexed(inputs.editorialRecords),
    reviews = indexed(inputs.publicRecords);
  const acceptance = indexed(inputs.acceptanceRecords),
    supplementalReviews = indexed(inputs.supplementalRecords),
    edge = indexed(inputs.edgeRecords);
  const targets: WeeklyTarget[] = [],
    excluded: WeeklyScope["excluded"] = [],
    review: WeeklyReview[] = [];
  let activeCount = 0;
  const uidCounts = new Map<string, number>();
  for (const row of display.values()) {
    const uid = String(row.weiboUid ?? "");
    if (UID.test(uid)) uidCounts.set(uid, (uidCounts.get(uid) ?? 0) + 1);
  }
  for (const [id, group] of display) {
    requireState(
      typeof group.name === "string" &&
        typeof group.status === "string" &&
        typeof group.isActive === "boolean",
      "invalid_weekly_status",
    );
    if (!group.isActive || group.status !== "确认存续") {
      excluded.push({ id, name: group.name, status: group.status });
      if (group.isActive || group.status === "确认存续")
        review.push({ id, uid: null, reason: "active_status_conflict" });
      continue;
    }
    activeCount += 1;
    const uid = String(group.weiboUid ?? "");
    let identityGate: WeeklyTarget["identityGate"] | null = null;
    let entityKind = "团体账号",
      scopeNote: string | null = null,
      identitySource = "";
    let identityEvidence: string | null = null,
      identityBasis: string | null = null;
    const publicRecord = reviews.get(id),
      overlayRecord = editorial.get(id);
    const profile = object(publicRecord?.profile) ? publicRecord.profile : null;
    const supplemental = object(overlayRecord?.profileSupplement)
      ? overlayRecord.profileSupplement
      : null;
    const acceptedBase = acceptance.get(id),
      supplemented = supplementalReviews.get(id),
      edgeRecord = edge.get(id);
    let acceptedEvidence: Record<string, unknown> | null = null;
    if (
      supplemental?.sourceFile ===
        "sources/微博编辑身份接受批次_2026-09-04.json" &&
      acceptedBase?.status === "accepted" &&
      String(acceptedBase.uid) === uid
    )
      acceptedEvidence = acceptedBase;
    if (
      supplemental?.sourceFile ===
        "sources/微博编辑身份补充复核批次_2026-09-04.json" &&
      acceptedBase?.status === "pending_timeline" &&
      String(acceptedBase.uid) === uid &&
      supplemented?.priorStatus === acceptedBase.status &&
      supplemented.decisionStatus === "accepted"
    )
      acceptedEvidence = supplemented;
    if (
      supplemental?.sourceFile ===
        "sources/Edge微博人工复核补充_2026-09-04.json" &&
      edgeRecord?.status === "accepted" &&
      String(edgeRecord.uid) === uid
    )
      acceptedEvidence = edgeRecord;
    const rejected =
      inputs.conflicts.some(
        (item) => item.id === id && String(item.uid ?? "") === uid,
      ) ||
      [master.get(id), group].some(
        (row) =>
          Array.isArray(row?.rejectedIdentityCandidates) &&
          row.rejectedIdentityCandidates.some(
            (item: unknown) => object(item) && String(item.uid ?? "") === uid,
          ),
      );
    const knownUid =
      UID.test(uid) &&
      group.uidConfidence === "high" &&
      uidCounts.get(uid) === 1;
    if (
      knownUid &&
      REVIEWED_ACCOUNT_SCOPES[id] === uid &&
      group.uidSource === "public_reviewed_account_scope" &&
      profile &&
      String(profile.uid) === uid &&
      object(group.publicReview) &&
      same(group.publicReview, publicRecord) &&
      typeof publicRecord?.entityKind === "string" &&
      typeof publicRecord.summary === "string" &&
      publicRecord.summary.length > 0 &&
      typeof profile.sourceUrl === "string" &&
      profile.sourceUrl === `https://weibo.com/u/${uid}`
    ) {
      // 旧严格拒绝针对单团绑定；只有同一已审账号范围才接受为企划或事务所候选。
      identityGate = "reviewed_account_scope";
      entityKind = publicRecord.entityKind;
      scopeNote = publicRecord.summary;
      identitySource = "public-review.json";
      identityEvidence = scopeNote;
      identityBasis = "public_reviewed_account_scope";
    } else if (
      knownUid &&
      !rejected &&
      strictFollowerIdentity(group, uid) &&
      strictFollowerIdentity(master.get(id), uid)
    ) {
      identityGate = "strict_uid_match";
      identitySource = "master.json";
      const fields = object(group.fieldEvidence) ? group.fieldEvidence : null;
      const evidence = object(fields?.profileIdentity)
        ? fields.profileIdentity
        : null;
      identityEvidence =
        typeof evidence?.rationale === "string" ? evidence.rationale : null;
      identityBasis =
        typeof evidence?.method === "string" ? evidence.method : null;
    } else if (
      knownUid &&
      !rejected &&
      group.uidSource === "editorial_profile_supplement" &&
      supplemental?.state === "accepted_candidate" &&
      supplemental.uid === uid &&
      object(group.editorialProfileSupplement) &&
      group.editorialProfileSupplement.state === "accepted_candidate" &&
      group.editorialProfileSupplement.uid === uid &&
      supplemental.identityReason ===
        group.editorialProfileSupplement.identityReason &&
      typeof supplemental.sourceFile === "string" &&
      acceptedEvidence &&
      acceptedEvidence.identityEvidenceSummary === supplemental.identityReason
    ) {
      identityGate = "accepted_candidate";
      identitySource = supplemental.sourceFile;
      identityEvidence = String(acceptedEvidence.identityEvidenceSummary);
      identityBasis =
        typeof acceptedEvidence.reviewBasis === "string"
          ? acceptedEvidence.reviewBasis
          : null;
    }
    if (!identityGate) {
      review.push({
        id,
        uid: UID.test(uid) ? uid : null,
        reason: !knownUid
          ? "missing_or_duplicate_uid"
          : rejected
            ? "unresolved_identity_rejection"
            : "unverified_display_identity",
      });
      continue;
    }
    targets.push({
      id,
      uid,
      name: group.name,
      handle: typeof group.handle === "string" ? group.handle : null,
      identityGate,
      entityKind,
      scopeNote,
      uidSource: String(group.uidSource),
      uidConfidence: "high",
      identityAcceptedByThisRun: false,
      canonicalImpact: "none",
      identitySource,
      identityEvidence,
      identityBasis,
      previous: latestFollowerBaseline([master.get(id), group], now),
    });
  }
  targets.sort((a, b) => a.uid.localeCompare(b.uid, "en"));
  excluded.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const sourceFiles = Object.keys(inputs.files)
    .sort()
    .map((name) => ({
      path: name,
      sha256: sha256(inputs.files[name]),
      bytes: inputs.files[name].length,
    }));
  return {
    schemaVersion: "idol-weekly-scope-v2",
    frozenAt: now.toISOString(),
    sourceSha256: sha256(encode(sourceFiles)),
    sourceFiles,
    targets,
    excluded,
    review,
    activeCount,
  };
}

export function buildWeeklyRuntimePlan(
  inputs: WeeklyInputs,
  slot: WeeklySlot,
  frozenAt: string,
): WeeklyPlan {
  requireState(
    isTimestamp(frozenAt) &&
      same(weeklySlot(slot.trigger, new Date(frozenAt)), slot),
    "invalid_weekly_plan_slot",
  );
  const scope = buildWeeklyScope(inputs, new Date(frozenAt));
  const batches: WeeklyPlan["batches"] = [];
  for (
    let offset = 0;
    offset < scope.targets.length;
    offset += WEEKLY_LIMITS.batchSize
  ) {
    const rows = scope.targets.slice(offset, offset + WEEKLY_LIMITS.batchSize);
    const uids = rows.map((row) => row.uid),
      groupIds = rows.map((row) => row.id);
    const key = sha256(
      encode({
        slot: slot.id,
        sourceSha256: scope.sourceSha256,
        uids,
        groupIds,
      }),
    );
    batches.push({ key, uids, groupIds });
  }
  const blockers = [];
  if (
    !scope.activeCount ||
    scope.targets.length !== scope.activeCount ||
    scope.review.length
  )
    blockers.push("weekly_scope_requires_review");
  if (batches.length > WEEKLY_LIMITS.maximumBatches)
    blockers.push("weekly_scope_exceeds_authorized_batches");
  return {
    schemaVersion: "idol-weekly-plan-v2",
    slot,
    scope,
    batches,
    limits: WEEKLY_LIMITS,
    maximumAccounts: scope.targets.length,
    maximumBatches: batches.length,
    blockers,
  };
}

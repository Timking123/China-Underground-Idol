import {
  emptyFollowerObservations,
  latestFollowerBaseline,
  object,
  observationTime,
  strictFollowerIdentity,
  validateFollowerObservations,
  type FollowerObservation,
} from "./followerObservations.ts";

/** 公开粉丝观察保留原身份范围，不包含私有响应、计费范围或身份改绑。 */
export interface ScopedFollowerObservation {
  groupId: string;
  uid: string;
  followersValue: number;
  followersDisplay: string;
  followersApproximate: boolean;
  followersObservedAt: string;
  sourceUrl: string;
  slotId: string;
  identityGate:
    "strict_uid_match" | "accepted_candidate" | "reviewed_account_scope";
  entityKind: string;
  scopeNote: string | null;
  responseSha256: string;
}

export interface ScopedFollowerObservations {
  schemaVersion: "idol-follower-observations-v2";
  updatedAt: string | null;
  records: ScopedFollowerObservation[];
}

export function emptyScopedFollowerObservations(): ScopedFollowerObservations {
  return {
    schemaVersion: "idol-follower-observations-v2",
    updatedAt: null,
    records: [],
  };
}

const REVIEWED_SCOPES: Readonly<Record<string, string>> = Object.freeze({
  g060: "2030310713",
  g360: "8257746955",
});
const RECORD_KEYS = [
  "groupId",
  "uid",
  "followersValue",
  "followersDisplay",
  "followersApproximate",
  "followersObservedAt",
  "sourceUrl",
  "slotId",
  "identityGate",
  "entityKind",
  "scopeNote",
  "responseSha256",
];

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function publicText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit &&
    !/[<>]/u.test(value) &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
  );
}

/** 首次手动槽截至 UTC+8 首个周五零点；之后只接受周五起算的七日定时槽。 */
function observationSlotMatches(observedAt: string, slotId: string): boolean {
  const time = Date.parse(observedAt);
  const firstScheduledTime = Date.parse("2026-09-11T00:00:00+08:00");
  if (slotId.startsWith("manual-"))
    return (
      slotId === "manual-2026-09-09" &&
      time >= Date.parse("2026-09-09T00:00:00+08:00") &&
      time < firstScheduledTime
    );
  const date = new Date(time + 8 * 3_600_000);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 2) % 7));
  return (
    time >= firstScheduledTime &&
    slotId === `scheduled-${date.toISOString().slice(0, 10)}`
  );
}

export function validateScopedFollowerObservations(
  input: unknown,
  now = new Date(),
):
  | { valid: true; data: ScopedFollowerObservations; errors: [] }
  | { valid: false; errors: string[] } {
  if (
    !object(input) ||
    !exactKeys(input, ["schemaVersion", "updatedAt", "records"]) ||
    input.schemaVersion !== "idol-follower-observations-v2" ||
    !Array.isArray(input.records)
  )
    return { valid: false, errors: ["invalid_scoped_follower_dataset"] };
  const errors: string[] = [];
  const ids = new Set<string>();
  const uids = new Set<string>();
  let latest: string | null = null;
  for (const [index, record] of input.records.entries()) {
    if (
      !object(record) ||
      !exactKeys(record, RECORD_KEYS) ||
      typeof record.groupId !== "string" ||
      !/^g\d{3,8}$/u.test(record.groupId) ||
      typeof record.uid !== "string" ||
      !/^\d{4,20}$/u.test(record.uid) ||
      typeof record.followersValue !== "number" ||
      !Number.isSafeInteger(record.followersValue) ||
      record.followersValue < 0 ||
      typeof record.followersApproximate !== "boolean" ||
      record.followersDisplay !==
        `${record.followersApproximate ? "约" : ""}${record.followersValue}` ||
      observationTime(record.followersObservedAt, now) === null ||
      record.sourceUrl !== `https://weibo.com/u/${record.uid}` ||
      typeof record.slotId !== "string" ||
      !/^(manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(record.slotId) ||
      typeof record.identityGate !== "string" ||
      ![
        "strict_uid_match",
        "accepted_candidate",
        "reviewed_account_scope",
      ].includes(record.identityGate) ||
      (record.identityGate === "reviewed_account_scope"
        ? REVIEWED_SCOPES[record.groupId] !== record.uid ||
          !publicText(record.entityKind, 100) ||
          !publicText(record.scopeNote, 2000)
        : record.entityKind !== "团体账号" || record.scopeNote !== null) ||
      typeof record.responseSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(record.responseSha256)
    ) {
      errors.push(`invalid_scoped_follower_record:${index}`);
      continue;
    }
    const observed = record.followersObservedAt as string;
    if (!observationSlotMatches(observed, record.slotId))
      errors.push(`observation_slot_mismatch:${index}`);
    if (ids.has(record.groupId) || uids.has(record.uid))
      errors.push(`duplicate_follower_identity:${index}`);
    ids.add(record.groupId);
    uids.add(record.uid);
    if (latest === null || Date.parse(observed) > Date.parse(latest))
      latest = observed;
  }
  if (input.updatedAt !== latest) errors.push("invalid_follower_updated_at");
  return errors.length
    ? { valid: false, errors }
    : {
        valid: true,
        data: structuredClone(input) as unknown as ScopedFollowerObservations,
        errors: [],
      };
}

/** 只沿用当前公开来源及其接受元数据；企划例外不解除旧单团身份拒绝。 */
export function scopedFollowerIdentity(
  group: unknown,
  record: ScopedFollowerObservation,
): boolean {
  if (
    !object(group) ||
    group.id !== record.groupId ||
    String(group.weiboUid ?? "") !== record.uid ||
    group.uidConfidence !== "high" ||
    group.profileUrl !== record.sourceUrl
  )
    return false;
  const supplement = group.editorialProfileSupplement;
  if (record.identityGate === "reviewed_account_scope") {
    const review = group.publicReview;
    return (
      REVIEWED_SCOPES[record.groupId] === record.uid &&
      group.uidSource === "public_reviewed_account_scope" &&
      object(review) &&
      review.id === group.id &&
      review.expectedHandle === group.handle &&
      review.entityKind === record.entityKind &&
      review.summary === record.scopeNote &&
      object(review.profile) &&
      String(review.profile.uid ?? "") === record.uid &&
      review.profile.sourceUrl === record.sourceUrl
    );
  }
  if (
    record.entityKind !== "团体账号" ||
    record.scopeNote !== null ||
    group.uidSource === "public_reviewed_account_scope" ||
    (Array.isArray(group.rejectedIdentityCandidates) &&
      group.rejectedIdentityCandidates.some(
        (candidate: unknown) =>
          object(candidate) && String(candidate.uid) === record.uid,
      ))
  )
    return false;
  if (record.identityGate === "accepted_candidate")
    return (
      group.uidSource === "editorial_profile_supplement" &&
      object(supplement) &&
      supplement.state === "accepted_candidate" &&
      String(supplement.uid ?? "") === record.uid &&
      supplement.profileUrl === record.sourceUrl &&
      Array.isArray(supplement.appliedFields) &&
      supplement.appliedFields.includes("identity")
    );
  return (
    record.identityGate === "strict_uid_match" &&
    group.uidSource !== "editorial_profile_supplement" &&
    !(object(supplement) && supplement.state === "accepted_candidate") &&
    strictFollowerIdentity(group, record.uid)
  );
}

type Observation = FollowerObservation | ScopedFollowerObservation;

function sameFollowerValue(left: Observation, right: Observation): boolean {
  return (
    left.followersValue === right.followersValue &&
    left.followersApproximate === right.followersApproximate
  );
}

/** 返回独立克隆的已采用粉丝来源，供公开覆盖与私有应用共用同一基线。 */
export function scopedFollowerBaselineSources(group: unknown): unknown[] {
  if (!object(group)) return [];
  const sources: unknown[] = [group];
  const uid = String(group.weiboUid ?? group.uid ?? "");
  if (!/^\d{4,20}$/u.test(uid)) return structuredClone(sources);
  const review = group.publicReview;
  const snapshot = group.strictSnapshot;
  const profile = object(snapshot) ? snapshot.profile : null;
  const matches = (source: unknown): source is Record<string, unknown> =>
    object(source) && String(source.weiboUid ?? source.uid ?? "") === uid;
  for (const source of [
    group.followerObservation,
    object(review) ? review.profile : null,
    profile,
  ])
    if (matches(source))
      sources.push({
        ...source,
        followersObservedAt:
          source.followersObservedAt ??
          source.profileObservedAt ??
          source.observedAt,
      });
  const supplement = group.editorialProfileSupplement;
  if (
    matches(supplement) &&
    supplement.state === "accepted_candidate" &&
    Array.isArray(supplement.appliedFields) &&
    supplement.appliedFields.includes("followers")
  )
    sources.push({ ...supplement, followersObservedAt: supplement.observedAt });
  const evidence = object(profile) ? profile.followerEvidence : null;
  if (
    matches(profile) &&
    object(evidence) &&
    evidence.state === "verified" &&
    String(evidence.boundUid ?? "") === uid
  )
    sources.push({
      uid,
      fieldEvidence: {
        followers: {
          ...evidence,
          followersApproximate:
            evidence.followersApproximate ??
            evidence.approximate ??
            (evidence.numericValue === profile.followersValue
              ? profile.followersApproximate
              : null),
        },
      },
    });
  return structuredClone(sources);
}

function futureBaseline(source: unknown, now: Date): boolean {
  if (!object(source)) return false;
  const count = (value: unknown): boolean =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const future = (value: unknown): boolean =>
    typeof value === "string" && Date.parse(value) > now.getTime();
  if (
    source.followersKnown !== false &&
    count(source.followersValue) &&
    future(source.followersObservedAt ?? source.profileObservedAt)
  )
    return true;
  const fields = source.fieldEvidence;
  const evidence = object(fields) ? fields.followers : null;
  return (
    object(evidence) &&
    evidence.state === "verified" &&
    (evidence.boundUid == null ||
      String(evidence.boundUid) ===
        String(source.weiboUid ?? source.uid ?? "")) &&
    count(evidence.numericValue) &&
    future(evidence.observedAt)
  );
}

/** 两版本先按账号归并，再一次性比较原始基线，避免串行覆盖造成假冲突。 */
export function overlayCombinedFollowerObservations<T extends { id: string }>(
  groups: readonly T[],
  legacyInput: unknown = emptyFollowerObservations(),
  scopedInput: unknown = emptyScopedFollowerObservations(),
  now = new Date(),
  mode: "current" | "archive" = "current",
): T[] {
  const legacy = validateFollowerObservations(legacyInput, now);
  if (!legacy.valid) throw new Error(legacy.errors.join(","));
  const scoped = validateScopedFollowerObservations(scopedInput, now);
  if (!scoped.valid) throw new Error(scoped.errors.join(","));
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  if (byGroup.size !== groups.length)
    throw new Error("duplicate_display_group_id");
  const latest = new Map<string, Observation>();
  for (const record of [...legacy.data.records, ...scoped.data.records]) {
    const group = byGroup.get(record.groupId);
    if (
      !group ||
      !("slotId" in record
        ? scopedFollowerIdentity(group, record)
        : strictFollowerIdentity(group, record.uid)) ||
      groups.filter(
        (candidate) =>
          object(candidate) &&
          String((candidate as Record<string, unknown>).weiboUid ?? "") ===
            record.uid,
      ).length !== 1
    )
      throw new Error(`display_identity_mismatch:${record.groupId}`);
    const previous = latest.get(record.groupId);
    if (previous) {
      if (previous.uid !== record.uid)
        throw new Error(`display_identity_mismatch:${record.groupId}`);
      const difference =
        Date.parse(record.followersObservedAt) -
        Date.parse(previous.followersObservedAt);
      if (difference === 0 && !sameFollowerValue(previous, record))
        throw new Error(`follower_same_time_conflict:${record.groupId}`);
      if (difference < 0) continue;
    }
    latest.set(record.groupId, record);
  }
  for (const [id, record] of latest) {
    const sources = scopedFollowerBaselineSources(byGroup.get(id));
    if (sources.some((source) => futureBaseline(source, now)))
      throw new Error(`follower_future_baseline:${id}`);
    const baseline = latestFollowerBaseline(sources, now);
    if (!baseline) continue;
    if (baseline.conflict)
      throw new Error(`follower_baseline_observation_conflict:${id}`);
    const time = Date.parse(record.followersObservedAt);
    if (time < baseline.time)
      throw new Error(`follower_older_observation:${id}`);
    if (
      time === baseline.time &&
      (record.followersValue !== baseline.value ||
        record.followersApproximate !== baseline.approximate)
    )
      throw new Error(`follower_same_time_conflict:${id}`);
  }
  return groups.map((group) => {
    const copy = structuredClone(group);
    const record = latest.get(group.id);
    if (!record) return copy;
    if (mode === "archive")
      return Object.assign(copy, {
        followerObservation: structuredClone(record),
      });
    return Object.assign(copy, {
      followersValue: record.followersValue,
      followersDisplay: record.followersDisplay,
      followersApproximate: record.followersApproximate,
      followersObservedAt: record.followersObservedAt,
      followersKnown: true,
      followersText: record.followersDisplay,
      followerObservation: structuredClone(record),
    });
  });
}

/** 粉丝独立观察层：不包含私有响应、账户范围或身份改绑。 */
export interface FollowerObservation {
  groupId: string;
  uid: string;
  followersValue: number;
  followersDisplay: string;
  followersApproximate: boolean;
  followersObservedAt: string;
  sourceUrl: string;
  weekId: string;
  identityGate: "strict_uid_match";
  responseSha256: string;
}

export interface FollowerObservations {
  schemaVersion: "idol-follower-observations-v1";
  updatedAt: string | null;
  records: FollowerObservation[];
}

export function emptyFollowerObservations(): FollowerObservations {
  return {
    schemaVersion: "idol-follower-observations-v1",
    updatedAt: null,
    records: [],
  };
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 严格带时区时间；拒绝日期归一化和未来观察。 */
export function observationTime(value: unknown, now: Date): number | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
      value,
    );
  const time = Date.parse(value);
  const day = match ? new Date(`${match[1]}T00:00:00Z`) : null;
  return match &&
    day &&
    Number.isFinite(day.getTime()) &&
    day.toISOString().slice(0, 10) === match[1] &&
    Number.isFinite(time) &&
    Number.isFinite(now.getTime()) &&
    time <= now.getTime()
    ? time
    : null;
}

export function observationWeek(value: string): string {
  const date = new Date(Date.parse(value) + 8 * 3600_000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return `week-${date.toISOString().slice(0, 10)}`;
}

export function strictFollowerIdentity(group: unknown, uid: string): boolean {
  if (!object(group) || !/^\d{4,20}$/u.test(uid)) return false;
  const fields = group.fieldEvidence;
  const identity = object(fields) ? fields.profileIdentity : null;
  return (
    String(group.weiboUid ?? "") === uid &&
    group.uidConfidence === "high" &&
    object(identity) &&
    identity.state === "verified" &&
    identity.confidence === "high" &&
    String(identity.candidateUid ?? "") === uid &&
    !(
      Array.isArray(group.rejectedIdentityCandidates) &&
      group.rejectedIdentityCandidates.some(
        (item: unknown) => object(item) && String(item.uid) === uid,
      )
    )
  );
}

export interface FollowerBaseline {
  value: number;
  approximate: boolean | null;
  observedAt: string;
  time: number;
  conflict: boolean;
}

/** 聚合独立、主档与已复核展示中的真实粉丝观察；同一时刻的冲突不择一放行。 */
export function latestFollowerBaseline(
  sources: readonly unknown[],
  now: Date,
): FollowerBaseline | null {
  const points: Omit<FollowerBaseline, "conflict">[] = [];
  const count = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const add = (
    value: unknown,
    approximate: unknown,
    observedAt: unknown,
  ): void => {
    const time = observationTime(observedAt, now);
    if (!count(value) || time === null || typeof observedAt !== "string")
      return;
    points.push({
      value,
      approximate: typeof approximate === "boolean" ? approximate : null,
      observedAt,
      time,
    });
  };
  for (const source of sources) {
    if (!object(source)) continue;
    const fields = source.fieldEvidence;
    const evidence =
      object(fields) && object(fields.followers) ? fields.followers : null;
    const uid = String(source.weiboUid ?? source.uid ?? "");
    const evidenceMatches =
      evidence &&
      !["blocked", "conflict", "not_found"].includes(String(evidence.state)) &&
      (evidence.boundUid == null || String(evidence.boundUid) === uid);
    if (source.followersKnown !== false && count(source.followersValue)) {
      // 显式粉丝时间优先；旧档案从对应字段证据和主页观察中取最新有效时间。
      const times = [source.followersObservedAt];
      if (observationTime(source.followersObservedAt, now) === null) {
        times.push(source.profileObservedAt);
        if (
          evidenceMatches &&
          (evidence.numericValue == null ||
            evidence.numericValue === source.followersValue)
        )
          times.push(evidence.observedAt);
      }
      for (const time of times)
        add(source.followersValue, source.followersApproximate, time);
    }
    if (evidenceMatches && evidence.state === "verified") {
      add(
        evidence.numericValue,
        evidence.followersApproximate ??
          (evidence.numericValue === source.followersValue
            ? source.followersApproximate
            : null),
        evidence.observedAt,
      );
    }
    const review = source.publicReview;
    const profile = object(review) ? review.profile : null;
    // 已采用的粉丝人工复核可成为比较基线，但不得据此更换团体身份。
    if (
      object(profile) &&
      String(profile.uid ?? "") === uid &&
      profile.followersValue === source.followersValue
    )
      add(
        profile.followersValue,
        profile.followersApproximate,
        profile.observedAt,
      );
  }
  points.sort((a, b) => b.time - a.time);
  const latest = points[0];
  return latest
    ? {
        ...latest,
        conflict: points.some(
          (point) =>
            point.time === latest.time &&
            (point.value !== latest.value ||
              point.approximate !== latest.approximate),
        ),
      }
    : null;
}

export function followerObservationConflict(
  record: FollowerObservation,
  baseline: FollowerBaseline | null,
):
  | "older_observation"
  | "same_time_conflict"
  | "baseline_observation_conflict"
  | null {
  if (!baseline) return null;
  if (baseline.conflict) return "baseline_observation_conflict";
  const time = Date.parse(record.followersObservedAt);
  if (time < baseline.time) return "older_observation";
  if (
    time === baseline.time &&
    (record.followersValue !== baseline.value ||
      record.followersApproximate !== baseline.approximate)
  )
    return "same_time_conflict";
  return null;
}

const keys = [
  "groupId",
  "uid",
  "followersValue",
  "followersDisplay",
  "followersApproximate",
  "followersObservedAt",
  "sourceUrl",
  "weekId",
  "identityGate",
  "responseSha256",
];
function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return (
    Object.keys(value).length === allowed.length &&
    allowed.every((key) => Object.hasOwn(value, key))
  );
}

export function validateFollowerObservations(
  input: unknown,
  now = new Date(),
):
  | { valid: true; data: FollowerObservations; errors: [] }
  | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (
    !object(input) ||
    !exactKeys(input, ["schemaVersion", "updatedAt", "records"]) ||
    input.schemaVersion !== "idol-follower-observations-v1" ||
    !Array.isArray(input.records)
  )
    return { valid: false, errors: ["invalid_follower_dataset"] };
  const ids = new Set<string>();
  const uids = new Set<string>();
  let latest: string | null = null;
  for (const [index, record] of input.records.entries()) {
    if (
      !object(record) ||
      !exactKeys(record, keys) ||
      typeof record.groupId !== "string" ||
      !/^g\d{3,8}$/u.test(record.groupId) ||
      typeof record.uid !== "string" ||
      !/^\d{4,20}$/u.test(record.uid) ||
      typeof record.followersValue !== "number" ||
      !Number.isSafeInteger(record.followersValue) ||
      record.followersValue < 0 ||
      typeof record.followersApproximate !== "boolean" ||
      typeof record.followersDisplay !== "string" ||
      record.followersDisplay !==
        `${record.followersApproximate ? "约" : ""}${record.followersValue}` ||
      observationTime(record.followersObservedAt, now) === null ||
      record.sourceUrl !== `https://weibo.com/u/${record.uid}` ||
      record.identityGate !== "strict_uid_match" ||
      typeof record.responseSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(record.responseSha256)
    ) {
      errors.push(`invalid_follower_record:${index}`);
      continue;
    }
    const observed = record.followersObservedAt as string;
    if (record.weekId !== observationWeek(observed))
      errors.push(`observation_week_mismatch:${index}`);
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
        data: structuredClone(input) as unknown as FollowerObservations,
        errors: [],
      };
}

/** 仅在内存克隆后覆盖粉丝字段；历史资料及嵌套证据不被修改。 */
export function overlayFollowerObservations<T extends { id: string }>(
  groups: readonly T[],
  input: unknown,
  now = new Date(),
  mode: "current" | "archive" = "current",
): T[] {
  const validation = validateFollowerObservations(input, now);
  if (!validation.valid) throw new Error(validation.errors.join(","));
  const ids = new Set(groups.map((group) => group.id));
  if (ids.size !== groups.length) throw new Error("duplicate_display_group_id");
  for (const record of validation.data.records) {
    const group = groups.find((candidate) => candidate.id === record.groupId);
    if (
      !group ||
      !strictFollowerIdentity(group, record.uid) ||
      groups.filter(
        (candidate) =>
          object(candidate) &&
          String((candidate as Record<string, unknown>).weiboUid ?? "") ===
            record.uid,
      ).length !== 1
    )
      throw new Error(`display_identity_mismatch:${record.groupId}`);
    const conflict = followerObservationConflict(
      record,
      latestFollowerBaseline([group], now),
    );
    if (conflict) throw new Error(`follower_${conflict}:${record.groupId}`);
  }
  const byId = new Map(
    validation.data.records.map((record) => [record.groupId, record]),
  );
  return groups.map((group) => {
    const copy = structuredClone(group);
    const record = byId.get(group.id);
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

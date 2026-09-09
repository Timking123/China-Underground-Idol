/** 私有候选纯函数：不访问文件、网络，不发布，也不从缺席推断取消。 */
export type CandidateSourceKind =
  "aggregator" | "official" | "organizer" | "venue" | "wiki" | "ticketing";
export type CandidateEventStatus =
  "scheduled" | "postponed" | "cancelled" | "unconfirmed";

export interface CandidateSource {
  sourceId: string;
  sourceUrl: string;
  label: string;
  publisher: string;
  kind: CandidateSourceKind;
  observedAt: string;
  /** 由存储层验证的完整正文 SHA；本模块只比较，不验证可信度。 */
  bodySha256: string;
  completeness: "complete" | "partial";
}

export interface EventCandidateFields {
  title: string | null;
  date: string | null;
  province: string | null;
  city: string | null;
  venue: string | null;
  address: string | null;
  opensAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: CandidateEventStatus | null;
  performers: { groupId: string | null; name: string }[] | null;
  notes: string | null;
  poster: { src: string; alt: string; sourceUrl: string } | null;
  /** 午场、晚场等；只作为冲突证据，不能单独生成长期身份。 */
  session: string | null;
}
export type CandidateField = keyof EventCandidateFields;

export interface EventCandidateInput {
  /** 调用方提供的候选键，不是公开活动 ID，也不是行号身份。 */
  candidateId: string;
  /** 维护者保存的源内分段键；移动行号、改标题和延期不应改变此键。 */
  sourceItemKey?: string;
  originalEventUrl?: string;
  /** 只有原始 URL 明确唯一指向一场活动时才设 true。 */
  originalUrlIsUnique?: boolean;
  fields: Partial<EventCandidateFields>;
  fieldExcerpts?: Partial<Record<CandidateField, string>>;
}
export interface CandidateSnapshot {
  source: CandidateSource;
  items: EventCandidateInput[];
}
export interface CandidateIssue {
  code:
    "missing_field" | "invalid_field" | "invalid_identity" | "partial_source";
  field?: CandidateField;
  message: string;
}
export interface EventCandidate {
  candidateId: string;
  sourceItemKey: string | null;
  originalEventUrl: string | null;
  originalUrlIsUnique: boolean;
  source: CandidateSource;
  fields: EventCandidateFields;
  rawFields: Partial<EventCandidateFields>;
  fieldExcerpts: Partial<Record<CandidateField, string>>;
  issues: CandidateIssue[];
  blockedForPublication: boolean;
}

/** 每个映射只能使用一种明确选择器；运行时也拒绝多选择器对象。 */
export type EventIdentityMapping =
  | { eventId: string; candidateId: string }
  | { eventId: string; sourceId: string; sourceItemKey: string }
  | { eventId: string; originalEventUrl: string };

export type CandidateReviewKind =
  | "candidate_blocked"
  | "identity_unassigned"
  | "ambiguous_identity"
  | "possible_duplicate"
  | "field_conflict"
  | "duplicate_import"
  | "source_edited"
  | "source_observation_regressed"
  | "source_partial"
  | "source_item_added"
  | "source_item_missing"
  | "source_item_changed"
  | "source_item_unmatched";
export interface CandidateReviewItem {
  kind: CandidateReviewKind;
  candidateIds: string[];
  eventIds: string[];
  sourceId?: string;
  field?: CandidateField;
  blocking: boolean;
  message: string;
}
export interface CandidateFieldEvidence {
  candidateId: string;
  sourceId: string;
  sourceUrl: string;
  sourceItemKey: string | null;
  bodySha256: string;
  observedAt: string;
  value: EventCandidateFields[CandidateField];
  rawValue: EventCandidateFields[CandidateField] | undefined;
  excerpt: string | null;
}
export interface CandidateFieldResolution {
  /** 仅所有非空有效证据一致时给出建议值；冲突时为 null。 */
  value: EventCandidateFields[CandidateField];
  evidence: CandidateFieldEvidence[];
  conflict: boolean;
}
export interface CandidateGroup {
  groupKey: string;
  eventId: string | null;
  candidateIds: string[];
  sources: CandidateSource[];
  fields: Record<CandidateField, CandidateFieldResolution>;
  blockedForPublication: boolean;
  /** 即使无阻塞，也必须经过独立维护者复核及公开数据验证。 */
  reviewRequired: true;
}
export interface DeduplicationResult {
  candidates: EventCandidate[];
  groups: CandidateGroup[];
  reviews: CandidateReviewItem[];
}
export interface SourceFieldChange {
  field: CandidateField;
  before: EventCandidateFields[CandidateField];
  after: EventCandidateFields[CandidateField];
}
export interface SourceItemChange {
  sourceItemKey: string;
  previousCandidateId: string;
  currentCandidateId: string;
  changes: SourceFieldChange[];
}
export interface SourceDiff {
  sourceId: string;
  contentChanged: boolean;
  comparableForMissing: boolean;
  added: string[];
  missing: string[];
  changed: SourceItemChange[];
  reviews: CandidateReviewItem[];
}
export interface CollectionWindow {
  timezone: "UTC+08:00";
  fromInclusive: string;
  focusToExclusive: string;
  toExclusive: string;
}
export interface CandidateReviewResult extends DeduplicationResult {
  sourceDiffs: SourceDiff[];
  window: CollectionWindow;
  inWindowCandidateIds: string[];
  focusCandidateIds: string[];
}

const FIELDS: CandidateField[] = [
  "title",
  "date",
  "province",
  "city",
  "venue",
  "address",
  "opensAt",
  "startsAt",
  "endsAt",
  "status",
  "performers",
  "notes",
  "poster",
  "session",
];
const STATUSES = new Set([
  "scheduled",
  "postponed",
  "cancelled",
  "unconfirmed",
]);
const DAY_MS = 86_400_000;
const UTC8_MS = 8 * 3_600_000;

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-"))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function safeUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value) || /[\s\\]|%0[ad]/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password) return null;
    // 不删查询参数和片段，避免把不同场次 URL 折叠到同一地址。
    return url.href;
  } catch {
    return null;
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
function equivalent(value: unknown): string {
  return typeof value === "string"
    ? normalizedText(value).toLowerCase()
    : canonical(value);
}
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** 缺失/无效字段仍保留原值与条目，不为缺失状态补造 scheduled。 */
export function normalizeCandidate(
  input: EventCandidateInput,
  source: CandidateSource,
): EventCandidate {
  const issues: CandidateIssue[] = [];
  const fields = Object.fromEntries(
    FIELDS.map((field) => [field, null]),
  ) as unknown as EventCandidateFields;
  const invalid = (field: CandidateField, message: string): void => {
    issues.push({ code: "invalid_field", field, message });
  };
  for (const field of FIELDS) {
    const raw = input.fields[field];
    if (raw === undefined || raw === null) continue;
    if (field === "performers") {
      if (
        !Array.isArray(raw) ||
        !raw.every(
          (value) =>
            value !== null &&
            typeof value === "object" &&
            "name" in value &&
            typeof value.name === "string" &&
            Boolean(value.name.trim()) &&
            "groupId" in value &&
            (value.groupId === null || typeof value.groupId === "string"),
        )
      ) {
        invalid(field, "出演者必须含 name 和 groupId；未知绑定使用 null");
      } else {
        fields.performers = (
          raw as NonNullable<EventCandidateFields["performers"]>
        ).map((value) => ({ ...value, name: normalizedText(value.name) }));
      }
    } else if (field === "poster") {
      if (
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !("src" in raw) ||
        !("alt" in raw) ||
        !("sourceUrl" in raw) ||
        typeof raw.src !== "string" ||
        typeof raw.alt !== "string" ||
        typeof raw.sourceUrl !== "string" ||
        !safeUrl(raw.sourceUrl) ||
        !(
          safeUrl(raw.src) ||
          /^assets\/event-posters\/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)$/.test(
            raw.src,
          )
        )
      ) {
        invalid(field, "海报信息或来源 URL 无效");
      } else {
        fields.poster = {
          src: raw.src,
          alt: raw.alt,
          sourceUrl: raw.sourceUrl,
        };
      }
    } else if (typeof raw !== "string") {
      invalid(field, "字段必须为文本或 null");
    } else {
      const value = normalizedText(raw);
      if (!value) continue;
      if (field === "date" && !isDate(value))
        invalid(field, "日期必须为真实 YYYY-MM-DD");
      else if (
        ["opensAt", "startsAt", "endsAt"].includes(field) &&
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      )
        invalid(field, "时间必须为 HH:mm，不推断跨日");
      else if (field === "status" && !STATUSES.has(value))
        invalid(field, "活动状态无效");
      else Object.assign(fields, { [field]: value });
    }
  }
  for (const field of ["title", "date", "status"] as const) {
    if (fields[field] === null)
      issues.push({
        code: "missing_field",
        field,
        message: `缺少 ${field}，只能保存为私有候选`,
      });
  }
  if (fields.opensAt && fields.startsAt && fields.opensAt > fields.startsAt)
    invalid("opensAt", "同日入场晚于开演，须人工核对");
  if (fields.startsAt && fields.endsAt && fields.endsAt <= fields.startsAt)
    invalid("endsAt", "结束未晚于同日开演，须人工核对跨日");
  if (
    !input.candidateId.trim() ||
    !source.sourceId.trim() ||
    !safeUrl(source.sourceUrl)
  )
    issues.push({
      code: "invalid_identity",
      message: "候选键、来源键或来源 URL 无效",
    });
  // 身份键与展示文本分开：拒绝首尾空白，绝不替调用方更改保存的键。
  const sourceItemKey = input.sourceItemKey ?? null;
  if (
    sourceItemKey !== null &&
    (!sourceItemKey || sourceItemKey.trim() !== sourceItemKey)
  )
    issues.push({
      code: "invalid_identity",
      message: "sourceItemKey 不能为空或含首尾空白",
    });
  const originalEventUrl = input.originalEventUrl
    ? safeUrl(input.originalEventUrl)
    : null;
  if (input.originalEventUrl && !originalEventUrl)
    issues.push({ code: "invalid_identity", message: "原始活动 URL 无效" });
  if (source.completeness === "partial")
    issues.push({
      code: "partial_source",
      message: "来源或分段不完整，须补核",
    });
  // 聚合帖本身不能充当其中所有活动的唯一 URL。
  const originalUrlIsUnique = Boolean(
    input.originalUrlIsUnique &&
    originalEventUrl &&
    !(
      originalEventUrl === safeUrl(source.sourceUrl) &&
      ["aggregator", "wiki"].includes(source.kind)
    ),
  );
  if (input.originalUrlIsUnique && !originalUrlIsUnique)
    issues.push({
      code: "invalid_identity",
      message: "不能把聚合来源帖或无效 URL 声称为唯一活动地址",
    });
  return {
    candidateId: input.candidateId,
    sourceItemKey,
    originalEventUrl,
    originalUrlIsUnique,
    source: structuredClone(source),
    fields,
    rawFields: structuredClone(input.fields),
    fieldExcerpts: structuredClone(input.fieldExcerpts ?? {}),
    issues,
    blockedForPublication: issues.length > 0,
  };
}

function review(
  kind: CandidateReviewKind,
  candidates: readonly EventCandidate[],
  message: string,
  blocking = true,
): CandidateReviewItem {
  return {
    kind,
    candidateIds: unique(candidates.map((item) => item.candidateId)),
    eventIds: [],
    blocking,
    message,
  };
}
function originalUrl(candidate: EventCandidate): string | null {
  return candidate.originalUrlIsUnique ? candidate.originalEventUrl : null;
}
function mappingMatches(
  mapping: EventIdentityMapping,
  candidate: EventCandidate,
): boolean {
  if ("candidateId" in mapping)
    return mapping.candidateId === candidate.candidateId;
  if ("sourceId" in mapping)
    return (
      mapping.sourceId === candidate.source.sourceId &&
      mapping.sourceItemKey === candidate.sourceItemKey
    );
  return Boolean(
    originalUrl(candidate) &&
    safeUrl(mapping.originalEventUrl) === originalUrl(candidate),
  );
}
function validMapping(mapping: EventIdentityMapping): boolean {
  const object = mapping as unknown as Record<string, unknown>;
  const keys = Object.keys(object).sort().join(",");
  if (!/^e-[a-z0-9-]+$/.test(mapping.eventId)) return false;
  if (keys === "candidateId,eventId")
    return (
      typeof object.candidateId === "string" &&
      Boolean(object.candidateId.trim())
    );
  if (keys === "eventId,sourceId,sourceItemKey")
    return (
      typeof object.sourceId === "string" &&
      Boolean(object.sourceId.trim()) &&
      typeof object.sourceItemKey === "string" &&
      Boolean(object.sourceItemKey.trim())
    );
  if (keys === "eventId,originalEventUrl")
    return (
      typeof object.originalEventUrl === "string" &&
      Boolean(safeUrl(object.originalEventUrl))
    );
  return false;
}
function identityConflict(a: EventCandidate, b: EventCandidate): boolean {
  // 相同源内的不同提取条目须明确映射；即使未分配分段键也不能假定重复。
  if (a.source.sourceId === b.source.sourceId) return true;
  return FIELDS.some(
    (field) =>
      a.fields[field] !== null &&
      b.fields[field] !== null &&
      equivalent(a.fields[field]) !== equivalent(b.fields[field]),
  );
}
function possibleDuplicate(a: EventCandidate, b: EventCandidate): boolean {
  const same = (field: CandidateField): boolean =>
    a.fields[field] !== null &&
    b.fields[field] !== null &&
    equivalent(a.fields[field]) === equivalent(b.fields[field]);
  return (
    (same("title") && (same("date") || same("city"))) ||
    (same("date") && same("city") && same("venue"))
  );
}

/** 仅明确映射或无冲突唯一原始 URL 可关联；字段相似只能生成复核项。 */
export function deduplicateCandidates(
  input: readonly EventCandidate[],
  mappings: readonly EventIdentityMapping[] = [],
): DeduplicationResult {
  const candidates: EventCandidate[] = [];
  const reviews: CandidateReviewItem[] = [];
  const imported = new Set<string>();
  for (const item of input) {
    const signature = canonical(item);
    if (imported.has(signature)) {
      reviews.push(
        review(
          "duplicate_import",
          [item],
          "相同候选观察重复导入，仅保留一次",
          false,
        ),
      );
    } else {
      imported.add(signature);
      candidates.push(structuredClone(item));
    }
  }
  const rejected = new Set<number>();
  const invalidMappings = mappings.filter((mapping) => !validMapping(mapping));
  if (invalidMappings.length) {
    // 无法可靠判断畸形选择器指向谁时，拒绝本次所有身份关联。
    candidates.forEach((_, index) => rejected.add(index));
    reviews.push(
      review(
        "ambiguous_identity",
        candidates,
        "映射含无效 ID 或多种选择器，拒绝本次身份关联",
      ),
    );
  }
  const ids = candidates.map((candidate, index) => {
    const matches = unique(
      mappings
        .filter(validMapping)
        .filter((mapping) => mappingMatches(mapping, candidate))
        .map((mapping) => mapping.eventId),
    );
    if (matches.length > 1) {
      rejected.add(index);
      const item = review(
        "ambiguous_identity",
        [candidate],
        "同一候选匹配多个稳定活动 ID，保留候选并拒绝关联",
      );
      item.eventIds = matches;
      reviews.push(item);
    }
    return matches.length === 1 ? matches[0]! : null;
  });
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const sameCandidate = a.candidateId === b.candidateId;
      const sameItem =
        a.source.sourceId === b.source.sourceId &&
        a.sourceItemKey !== null &&
        a.sourceItemKey === b.sourceItemKey;
      if (sameCandidate || sameItem) {
        rejected.add(i);
        rejected.add(j);
        reviews.push(
          review(
            "ambiguous_identity",
            [a, b],
            "同一候选键或源内分段键对应多个不同观察，须先消除含糊关联",
          ),
        );
      }
    }
  }
  const groups: number[][] = [];
  const assigned = new Map<string, number[]>();
  candidates.forEach((_, index) => {
    const id = rejected.has(index) ? null : ids[index];
    if (id) {
      const members = assigned.get(id) ?? [];
      members.push(index);
      assigned.set(id, members);
    }
  });
  groups.push(...assigned.values());
  const grouped = new Set(groups.flat());
  const urlBuckets = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const url = originalUrl(candidate);
    if (url && !rejected.has(index)) {
      const bucket = urlBuckets.get(url) ?? [];
      bucket.push(index);
      urlBuckets.set(url, bucket);
    }
  });
  for (const bucket of urlBuckets.values()) {
    if (bucket.length < 2) continue;
    const mappedIds = unique(
      bucket
        .map((index) => ids[index])
        .filter((id): id is string => Boolean(id)),
    );
    const existing = mappedIds[0] ? assigned.get(mappedIds[0])! : [];
    const checked = unique([...bucket, ...existing]);
    const conflicting =
      mappedIds.length > 1 ||
      checked.some((index, position) =>
        checked
          .slice(position + 1)
          .some((other) =>
            identityConflict(candidates[index]!, candidates[other]!),
          ),
      );
    if (conflicting) {
      reviews.push(
        review(
          "ambiguous_identity",
          checked.map((index) => candidates[index]!),
          "同一原始 URL 或已有映射组存在场次、字段或稳定 ID 冲突；不按 URL 自动合并",
        ),
      );
      continue;
    }
    const ungrouped = bucket.filter((index) => !grouped.has(index));
    const target = mappedIds[0] ? assigned.get(mappedIds[0])! : [];
    target.push(...ungrouped);
    if (!mappedIds.length && target.length) groups.push(target);
    ungrouped.forEach((index) => grouped.add(index));
  }
  candidates.forEach((_, index) => {
    if (!grouped.has(index)) groups.push([index]);
  });
  const candidateGroup = new Map<number, number>();
  groups.forEach((members, groupIndex) =>
    members.forEach((index) => candidateGroup.set(index, groupIndex)),
  );
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (
        candidateGroup.get(i) !== candidateGroup.get(j) &&
        possibleDuplicate(candidates[i]!, candidates[j]!)
      )
        reviews.push(
          review(
            "possible_duplicate",
            [candidates[i]!, candidates[j]!],
            "标题、日期、城市或场地相似，仅建议复核，未自动合并",
          ),
        );
    }
  }
  const resolvedGroups = groups.map((members): CandidateGroup => {
    const records = members.map((index) => candidates[index]!);
    const eventId =
      members
        .map((index) => (rejected.has(index) ? null : ids[index]))
        .find((id) => id) ?? null;
    const resolutions = {} as Record<CandidateField, CandidateFieldResolution>;
    for (const field of FIELDS) {
      const values = records
        .map((candidate) => candidate.fields[field])
        .filter((value) => value !== null);
      const conflict = unique(values.map(equivalent)).length > 1;
      resolutions[field] = {
        value: conflict ? null : structuredClone(values[0] ?? null),
        conflict,
        evidence: records.map((candidate) => ({
          candidateId: candidate.candidateId,
          sourceId: candidate.source.sourceId,
          sourceUrl: candidate.source.sourceUrl,
          sourceItemKey: candidate.sourceItemKey,
          bodySha256: candidate.source.bodySha256,
          observedAt: candidate.source.observedAt,
          value: structuredClone(candidate.fields[field]),
          rawValue: structuredClone(candidate.rawFields[field]),
          excerpt: candidate.fieldExcerpts[field] ?? null,
        })),
      };
      if (conflict) {
        const item = review(
          "field_conflict",
          records,
          `${field} 存在分歧，保留全部证据且不选择后来源`,
        );
        item.field = field;
        item.eventIds = eventId ? [eventId] : [];
        reviews.push(item);
      }
    }
    if (!eventId)
      reviews.push(
        review(
          "identity_unassigned",
          records,
          "尚无已保存的稳定活动 ID；由维护者分配或明确关联",
        ),
      );
    for (const candidate of records)
      if (candidate.blockedForPublication)
        reviews.push(
          review(
            "candidate_blocked",
            [candidate],
            candidate.issues.map((issue) => issue.message).join("；"),
          ),
        );
    const blockedForPublication =
      !eventId ||
      records.some((candidate) => candidate.blockedForPublication) ||
      reviews.some(
        (item) =>
          item.blocking &&
          item.candidateIds.some((id) =>
            records.some((candidate) => candidate.candidateId === id),
          ),
      );
    return {
      groupKey: eventId
        ? `event:${eventId}`
        : `candidate:${canonical(records.map((candidate) => [candidate.source.sourceId, candidate.candidateId]).sort())}`,
      eventId,
      candidateIds: records.map((candidate) => candidate.candidateId),
      sources: [
        ...new Map(
          records.map((candidate) => [
            canonical(candidate.source),
            structuredClone(candidate.source),
          ]),
        ).values(),
      ],
      fields: resolutions,
      blockedForPublication,
      reviewRequired: true,
    };
  });
  return { candidates, groups: resolvedGroups, reviews };
}

/** 同源全文 SHA 检测编辑；只有完整快照之间才列出缺失分段。 */
export function diffSourceSnapshots(
  previous: CandidateSnapshot,
  current: CandidateSnapshot,
): SourceDiff {
  if (
    previous.source.sourceId !== current.source.sourceId ||
    safeUrl(previous.source.sourceUrl) !== safeUrl(current.source.sourceUrl)
  )
    throw new TypeError("只允许比较同一 sourceId 和来源 URL 的快照");
  const before = previous.items.map((item) =>
    normalizeCandidate(item, previous.source),
  );
  const after = current.items.map((item) =>
    normalizeCandidate(item, current.source),
  );
  const reviews: CandidateReviewItem[] = [];
  const previousObservedAt = Date.parse(previous.source.observedAt);
  const currentObservedAt = Date.parse(current.source.observedAt);
  if (
    !Number.isFinite(previousObservedAt) ||
    !Number.isFinite(currentObservedAt)
  )
    throw new TypeError("来源观察时间无效，无法确认快照顺序");
  const observationRegressed = currentObservedAt < previousObservedAt;
  const contentChanged =
    previous.source.bodySha256 !== current.source.bodySha256;
  const completeSources =
    previous.source.completeness === "complete" &&
    current.source.completeness === "complete";
  const comparableForMissing = completeSources && !observationRegressed;
  const result: SourceDiff = {
    sourceId: current.source.sourceId,
    contentChanged,
    comparableForMissing,
    added: [],
    missing: [],
    changed: [],
    reviews,
  };
  if (contentChanged)
    reviews.push(
      review(
        "source_edited",
        [...before, ...after],
        "来源正文 SHA 已变化，需复核编辑和保留历史版本",
      ),
    );
  if (observationRegressed)
    reviews.push(
      review(
        "source_observation_regressed",
        [...before, ...after],
        "当前快照观察时间早于前版，不能作为更新证据或据此判断分段消失",
      ),
    );
  if (!completeSources)
    reviews.push(
      review(
        "source_partial",
        [...before, ...after],
        "至少一份来源不完整，不判断活动分段消失",
      ),
    );
  const keyed = (records: EventCandidate[]): Map<string, EventCandidate[]> => {
    const map = new Map<string, EventCandidate[]>();
    for (const candidate of records) {
      if (!candidate.sourceItemKey) {
        reviews.push(
          review(
            "source_item_unmatched",
            [candidate],
            "缺少保存的 sourceItemKey，不按行号、标题或候选数组位置关联旧条目",
          ),
        );
        continue;
      }
      const values = map.get(candidate.sourceItemKey) ?? [];
      values.push(candidate);
      map.set(candidate.sourceItemKey, values);
    }
    return map;
  };
  const oldItems = keyed(before);
  const newItems = keyed(after);
  for (const key of unique([...oldItems.keys(), ...newItems.keys()])) {
    const oldMatches = oldItems.get(key) ?? [];
    const newMatches = newItems.get(key) ?? [];
    if (oldMatches.length > 1 || newMatches.length > 1) {
      reviews.push(
        review(
          "ambiguous_identity",
          [...oldMatches, ...newMatches],
          "同一 sourceItemKey 对应多个段落，拒绝自动比较",
        ),
      );
      continue;
    }
    const oldItem = oldMatches[0];
    const newItem = newMatches[0];
    if (oldItem && newItem) {
      if (
        oldItem.originalEventUrl !== newItem.originalEventUrl ||
        oldItem.originalUrlIsUnique !== newItem.originalUrlIsUnique
      )
        reviews.push(
          review(
            "ambiguous_identity",
            [oldItem, newItem],
            "已保存分段的原始活动链接或唯一性声明变化，须重新确认身份后才能使用旧活动映射",
          ),
        );
      const changes = FIELDS.filter(
        (field) =>
          canonical(oldItem.fields[field]) !== canonical(newItem.fields[field]),
      ).map((field) => ({
        field,
        before: oldItem.fields[field],
        after: newItem.fields[field],
      }));
      if (changes.length) {
        result.changed.push({
          sourceItemKey: key,
          previousCandidateId: oldItem.candidateId,
          currentCandidateId: newItem.candidateId,
          changes,
        });
        reviews.push(
          review(
            "source_item_changed",
            [oldItem, newItem],
            "已保存分段的字段变化，包含更名、延期或删除字段，须复核",
          ),
        );
      }
    } else if (newItem) {
      result.added.push(newItem.candidateId);
      reviews.push(
        review("source_item_added", [newItem], "新增分段候选，须确认稳定身份"),
      );
    } else if (oldItem && comparableForMissing) {
      result.missing.push(oldItem.candidateId);
      reviews.push(
        review(
          "source_item_missing",
          [oldItem],
          "完整来源中未再出现该分段；可能为编辑或删除，绝不据此取消活动",
        ),
      );
    }
  }
  reviews.forEach((item) => {
    item.sourceId = current.source.sourceId;
  });
  return result;
}

/** UTC+8 日历窗口：[今天，今天+30日)，重点 [今天，今天+7日)。 */
export function getCollectionWindow(now: Date): CollectionWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError("当前时间无效");
  const local = new Date(now.getTime() + UTC8_MS);
  const end = new Date(local.getTime() + 30 * DAY_MS);
  if (
    !Number.isFinite(end.getTime()) ||
    local.getUTCFullYear() < 1 ||
    end.getUTCFullYear() > 9999
  )
    throw new RangeError("当前时间超出支持范围");
  return {
    timezone: "UTC+08:00",
    fromInclusive: local.toISOString().slice(0, 10),
    focusToExclusive: new Date(local.getTime() + 7 * DAY_MS)
      .toISOString()
      .slice(0, 10),
    toExclusive: end.toISOString().slice(0, 10),
  };
}

export function buildCandidateReview(input: {
  snapshots: readonly CandidateSnapshot[];
  previousSnapshots?: readonly CandidateSnapshot[];
  mappings?: readonly EventIdentityMapping[];
  now: Date;
}): CandidateReviewResult {
  const result = deduplicateCandidates(
    input.snapshots.flatMap((snapshot) =>
      snapshot.items.map((item) => normalizeCandidate(item, snapshot.source)),
    ),
    input.mappings,
  );
  const sourceDiffs: SourceDiff[] = [];
  for (const snapshot of input.snapshots) {
    const previous = (input.previousSnapshots ?? []).filter(
      (item) => item.source.sourceId === snapshot.source.sourceId,
    );
    const current = input.snapshots.filter(
      (item) => item.source.sourceId === snapshot.source.sourceId,
    );
    if (previous.length > 1 || current.length > 1) {
      result.reviews.push({
        kind: "ambiguous_identity",
        candidateIds: snapshot.items.map((item) => item.candidateId),
        eventIds: [],
        sourceId: snapshot.source.sourceId,
        blocking: true,
        message: "同源存在多个快照，调用方须明确要比较的前后版本",
      });
    } else if (previous[0])
      sourceDiffs.push(diffSourceSnapshots(previous[0], snapshot));
  }
  result.reviews.push(...sourceDiffs.flatMap((diff) => diff.reviews));
  // 比较产生的新阻塞同样反映到组上；候选永远不因窗口外或缺席被删除。
  for (const group of result.groups)
    if (
      result.reviews.some(
        (item) =>
          item.blocking &&
          item.candidateIds.some((id) => group.candidateIds.includes(id)),
      )
    )
      group.blockedForPublication = true;
  const window = getCollectionWindow(input.now);
  const selected = (end: string): string[] =>
    result.candidates
      .filter(
        (candidate) =>
          candidate.fields.date !== null &&
          candidate.fields.date >= window.fromInclusive &&
          candidate.fields.date < end,
      )
      .map((candidate) => candidate.candidateId);
  return {
    ...result,
    sourceDiffs,
    window,
    inWindowCandidateIds: selected(window.toExclusive),
    focusCandidateIds: selected(window.focusToExclusive),
  };
}

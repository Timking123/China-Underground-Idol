import { createHash } from "node:crypto";
import type { SourceCapture } from "../src/sourceCapture.ts";

/** 纯策略：调用方负责采集、注册表校验和最终 prepareEventUpdate；本模块没有 IO。 */
export interface PolicyEventFields {
  title: string;
  date: string;
  province: string | null;
  city: string | null;
  venue: string | null;
  address: string | null;
  opensAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: "scheduled" | "postponed" | "cancelled" | "unconfirmed";
  performers: { groupId: string | null; name: string }[];
}
export interface PolicyEvent extends PolicyEventFields {
  id: string;
  sources: {
    url: string;
    label: string;
    publisher: string;
    kind: string;
    observedAt: string;
  }[];
}
export interface ReviewedEventBinding {
  eventId: string;
  registryId: string;
  sourceUrl: string;
  sourceItemKey: string;
  previousCaptureId: string;
  previousFields: PolicyEventFields;
}
export interface CaptureReference {
  captureId: string;
  bodySha256: string;
  evidenceSha256: string;
  observedAt: string;
}
export type PolicyStatus = "unchanged" | "ready" | "review";
export interface EventTimeChange {
  eventId: string;
  registryId: string;
  sourceUrl: string;
  sourceItemKey: string;
  field: "opensAt" | "startsAt";
  before: string;
  after: string;
  previousExcerpt: string;
  currentExcerpt: string;
  previous: CaptureReference;
  current: CaptureReference;
}
export interface CaptureDecision {
  registryId: string;
  sourceUrl: string;
  status: PolicyStatus;
  reasons: string[];
  previous: CaptureReference | null;
  current: CaptureReference | null;
  changes: EventTimeChange[];
}
export interface EventPolicyInput {
  previousCaptures: readonly SourceCapture[];
  currentCaptures: readonly SourceCapture[];
  /** 只列本轮真实采集成功的 ID；不得把缓存重放或修改时间戳伪装为新采集。 */
  freshCaptureIds: readonly string[];
  bindings: readonly ReviewedEventBinding[];
  events: readonly PolicyEvent[];
  now: string;
}
export interface EventPolicyResult {
  status: PolicyStatus;
  reasons: string[];
  /** 仅返回没有关联待审来源或字段冲突的活动变化；总体 review 可包含独立安全变化。 */
  changes: EventTimeChange[];
  captures: CaptureDecision[];
}

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const encode = (value: unknown): string =>
  JSON.stringify(value, null, 2) + "\n";
const keyOf = (capture: SourceCapture): string =>
  JSON.stringify([capture.registryId, capture.source.sourceUrl]);
const reference = (capture: SourceCapture): CaptureReference => ({
  captureId: capture.captureId,
  bodySha256: capture.source.bodySha256,
  evidenceSha256: capture.evidenceSha256,
  observedAt: capture.source.observedAt,
});
const FIELDS = [
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
] as const;
const TEMPLATE_URLS: Record<string, string> = {
  "weibo-freya": "https://weibo.com/4028711630/Rh1KjF7tZ",
  "weibo-season": "https://weibo.com/7931467523/RgPxIvAGu",
  "weibo-jadx": "https://weibo.com/8013127107/RgnpRiZ0w",
  "weibo-mogu": "https://weibo.com/6579150992/RgdcNn1Bz",
  "weibo-meguri": "https://weibo.com/8000320501/RgfpSbTLH",
};

function validTimestamp(value: string): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.test(
      value,
    ) &&
    !/[+-]14:(?!00$)/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) ===
      value.slice(0, 10)
  );
}
function integrityReason(capture: SourceCapture, now: string): string | null {
  if (
    capture.schemaVersion !== "idol-source-capture-v1" ||
    typeof capture.bodyText !== "string" ||
    !capture.bodyText.trim() ||
    Buffer.byteLength(capture.bodyText) > 4 * 1024 * 1024 ||
    hash(capture.bodyText) !== capture.source.bodySha256
  )
    return "capture_body_hash_mismatch";
  if (
    !validTimestamp(capture.source.observedAt) ||
    capture.fetchedAt !== capture.source.observedAt ||
    Date.parse(capture.fetchedAt) > Date.parse(now)
  )
    return "invalid_observation_time";
  if (
    !["public-browser", "public-http"].includes(capture.method) ||
    !/^[a-f0-9]{64}$/u.test(capture.evidenceSha256) ||
    !/^[a-f0-9]{64}$/u.test(capture.articleSha256) ||
    !["complete", "partial"].includes(capture.source.completeness) ||
    !Array.isArray(capture.links) ||
    capture.links.some(
      (link) =>
        !link || typeof link.href !== "string" || typeof link.text !== "string",
    )
  )
    return "invalid_capture_evidence";
  const identity = {
    registryId: capture.registryId,
    sourceUrl: capture.source.sourceUrl,
    observedAt: capture.source.observedAt,
    bodySha256: capture.source.bodySha256,
    evidenceSha256: capture.evidenceSha256,
    completeness: capture.source.completeness,
  };
  if (
    capture.captureId !== hash(encode(identity)) ||
    capture.source.sourceId !==
      `${capture.registryId}-${hash(capture.source.sourceUrl).slice(0, 16)}`
  )
    return "capture_identity_mismatch";
  return null;
}

interface TimeToken {
  value: string;
  start: number;
  end: number;
  excerpt: string;
}
interface ParsedTimes {
  date: string;
  opensAt: TimeToken;
  startsAt: TimeToken;
  masked: string;
}

/** NFKC 仅用于行解析；原文、哈希、切片和非白名单区域比较始终保留原字节。 */
function parseTimes(capture: SourceCapture, year: string): ParsedTimes | null {
  if (TEMPLATE_URLS[capture.registryId] !== capture.source.sourceUrl)
    return null;
  const lines: { raw: string; text: string; offset: number }[] = [];
  let offset = 0;
  for (const raw of capture.bodyText.split("\n")) {
    lines.push({ raw, text: raw.normalize("NFKC"), offset });
    offset += raw.length + 1;
  }
  const tokens: TimeToken[] = [];
  let date = "";
  let dateCount = 0;
  for (const line of lines) {
    let day: string[] | null = null;
    let times: string[] | null = null;
    let timeGroups: number[] = [];
    switch (capture.registryId) {
      case "weibo-freya":
        day =
          /^(\d{4})\.(\d{2})\.(\d{2})\(周[一二三四五六日天]\)\|Open (\d{1,2}:\d{2}) & Start (\d{1,2}:\d{2})$/iu.exec(
            line.text,
          );
        times = day;
        timeGroups = [4, 5];
        break;
      case "weibo-season":
        day = /^时间: (\d{1,2})月(\d{1,2})日\([一二三四五六日天]\)$/u.exec(
          line.text,
        );
        if (day) day = [day[0], year, day[1], day[2]];
        times = /^进场\/开演: (\d{1,2}:\d{2})\/(\d{1,2}:\d{2})$/u.exec(
          line.text,
        );
        timeGroups = [1, 2];
        break;
      case "weibo-jadx":
        day = /^(\d{4})年(\d{1,2})月(\d{1,2})日\(周[一二三四五六日天]\)$/u.exec(
          line.text,
        );
        times = /^(?:OPEN|START):[ \t]*(\d{1,2}:\d{2})$/iu.exec(line.text);
        timeGroups = [1];
        break;
      case "weibo-mogu":
        day = /^🗓️(\d{4})\.(\d{1,2})\.(\d{1,2})$/u.exec(line.text);
        times = /^(?:⏰OPEN|🕢START)[ \t]+(\d{1,2}:\d{2})$/iu.exec(line.text);
        timeGroups = [1];
        break;
      case "weibo-meguri":
        day =
          /^🗓️时间 \| (\d{4})年(\d{1,2})月(\d{1,2})日\(周[一二三四五六日天]\)$/u.exec(
            line.text,
          );
        times = /^⏰入场 \| (\d{1,2}:\d{2}) {2}开场 \| (\d{1,2}:\d{2})$/u.exec(
          line.text,
        );
        timeGroups = [1, 2];
        break;
    }
    if (day) {
      dateCount++;
      date = `${day[1]}-${day[2].padStart(2, "0")}-${day[3].padStart(2, "0")}`;
    }
    if (!times) continue;
    const rawTimes = [
      ...line.raw.matchAll(/[0-9０-９]{1,2}[:：][0-9０-９]{2}/gu),
    ];
    if (rawTimes.length !== timeGroups.length) return null;
    for (const [index, group] of timeGroups.entries()) {
      const value = times[group].padStart(5, "0");
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return null;
      const raw = rawTimes[index];
      if (raw[0].normalize("NFKC").padStart(5, "0") !== value) return null;
      // 两行模板必须依次出现 OPEN、START；同标签重复不能冒充一对。
      if (
        timeGroups.length === 1 &&
        (tokens.length === 0
          ? !/OPEN/iu.test(line.text)
          : !/START/iu.test(line.text))
      )
        return null;
      tokens.push({
        value,
        start: line.offset + raw.index,
        end: line.offset + raw.index + raw[0].length,
        excerpt: line.raw,
      });
    }
  }
  if (
    dateCount !== 1 ||
    tokens.length !== 2 ||
    tokens[0].value > tokens[1].value ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    return null;
  let masked = capture.bodyText;
  for (const [index, token] of [...tokens.entries()].reverse())
    masked =
      masked.slice(0, token.start) +
      `<EVENT_TIME_${index}>` +
      masked.slice(token.end);
  return { date, opensAt: tokens[0], startsAt: tokens[1], masked };
}

function inspectPair(
  previous: SourceCapture,
  current: SourceCapture,
  input: EventPolicyInput,
): { reasons: string[]; changes: EventTimeChange[] } {
  const reject = (reason: string) => ({ reasons: [reason], changes: [] });
  for (const capture of [previous, current]) {
    const reason = integrityReason(capture, input.now);
    if (reason) return reject(reason);
  }
  if (
    Date.parse(current.source.observedAt) <
    Date.parse(previous.source.observedAt)
  )
    return reject("source_observation_regressed");
  if (
    !input.freshCaptureIds.includes(current.captureId) ||
    current.captureId === previous.captureId ||
    current.evidenceSha256 === previous.evidenceSha256
  )
    return reject("fresh_capture_required");
  if (
    ["sourceId", "sourceUrl", "label", "publisher", "kind"].some(
      (field) =>
        previous.source[field as keyof SourceCapture["source"]] !==
        current.source[field as keyof SourceCapture["source"]],
    )
  )
    return reject("source_identity_changed");
  if (previous.method !== current.method)
    return reject("source_capture_method_changed");
  const hrefs = (capture: SourceCapture) =>
    capture.links.filter((link) => link.href.trim()).map((link) => link.href);
  if (JSON.stringify(hrefs(previous)) !== JSON.stringify(hrefs(current)))
    return reject("source_links_changed");
  if (previous.bodyText === current.bodyText)
    return { reasons: [], changes: [] };
  if (
    Date.parse(current.source.observedAt) <=
    Date.parse(previous.source.observedAt)
  )
    return reject("changed_capture_requires_later_observation");
  if (
    [previous, current].some(
      (capture) =>
        capture.source.completeness !== "complete" ||
        (capture.method === "public-browser" &&
          capture.selection?.complete !== true),
    )
  )
    return reject("complete_capture_required");
  if (current.source.sourceUrl.startsWith("https://www.showstart.com/event/"))
    return reject("showstart_detail_body_changed_requires_review");
  if (
    /取消|延期|推迟|延后|改期|中止|停演|待定|cancel(?:led|ed|lation)?|postpon/iu.test(
      current.bodyText.normalize("NFKC"),
    )
  )
    return reject("cancellation_or_postponement_requires_review");
  const bindings = input.bindings.filter(
    (binding) =>
      binding.registryId === current.registryId &&
      binding.sourceUrl === current.source.sourceUrl,
  );
  if (bindings.length !== 1)
    return reject(
      bindings.length
        ? "ambiguous_source_binding"
        : "new_or_unbound_source_candidate_only",
    );
  const binding = bindings[0];
  if (
    !binding.sourceItemKey?.trim() ||
    binding.previousCaptureId !== previous.captureId ||
    input.bindings.some(
      (other) =>
        other !== binding &&
        other.eventId === binding.eventId &&
        other.registryId === binding.registryId &&
        other.sourceItemKey === binding.sourceItemKey,
    )
  )
    return reject("source_item_or_capture_binding_mismatch");
  const events = input.events.filter((event) => event.id === binding.eventId);
  if (events.length !== 1)
    return reject(
      events.length ? "ambiguous_event_identity" : "new_event_candidate_only",
    );
  const event = events[0];
  const sourceOwners = input.events.filter((item) =>
    item.sources.some((source) => source.url === binding.sourceUrl),
  );
  const formalSources = event.sources.filter(
    (source) => source.url === binding.sourceUrl,
  );
  if (
    sourceOwners.length !== 1 ||
    formalSources.length !== 1 ||
    ["label", "publisher", "kind"].some(
      (field) =>
        formalSources[0][field as keyof (typeof formalSources)[0]] !==
        current.source[field as keyof SourceCapture["source"]],
    )
  )
    return reject("formal_source_identity_mismatch");
  if (
    !validTimestamp(formalSources[0].observedAt) ||
    Date.parse(previous.source.observedAt) <
      Date.parse(formalSources[0].observedAt)
  )
    return reject("preimage_older_than_formal_source");
  if (
    !binding.previousFields ||
    FIELDS.some(
      (field) =>
        binding.previousFields[field] === undefined ||
        JSON.stringify(binding.previousFields[field]) !==
          JSON.stringify(event[field]),
    )
  )
    return reject("formal_event_preimage_mismatch");
  if (event.status !== "scheduled")
    return reject("event_status_requires_review");
  const before = parseTimes(previous, event.date.slice(0, 4));
  const after = parseTimes(current, event.date.slice(0, 4));
  if (!before || !after) return reject("unknown_or_ambiguous_time_template");
  if (before.date !== after.date || before.date !== event.date)
    return reject("event_date_changed_or_mismatched");
  if (before.masked !== after.masked) return reject("non_time_body_changed");
  if (
    before.opensAt.value !== event.opensAt ||
    before.startsAt.value !== event.startsAt
  )
    return reject("parsed_time_preimage_mismatch");
  if (event.endsAt !== null && after.startsAt.value > event.endsAt)
    return reject("time_order_requires_review");
  const changes: EventTimeChange[] = [];
  for (const field of ["opensAt", "startsAt"] as const) {
    if (before[field].value === after[field].value) continue;
    changes.push({
      eventId: event.id,
      registryId: binding.registryId,
      sourceUrl: binding.sourceUrl,
      sourceItemKey: binding.sourceItemKey,
      field,
      before: before[field].value,
      after: after[field].value,
      previousExcerpt: before[field].excerpt,
      currentExcerpt: after[field].excerpt,
      previous: reference(previous),
      current: reference(current),
    });
  }
  return changes.length
    ? { reasons: [], changes }
    : reject("body_changed_without_time_value_change");
}

/** 遍历所有 capture 的 registryId+URL 并集，包含列表以外的秀动详情；缺席永不推断取消。 */
export function evaluateEventPolicy(
  input: EventPolicyInput,
): EventPolicyResult {
  if (!validTimestamp(input.now))
    return {
      status: "review",
      reasons: ["invalid_policy_time"],
      changes: [],
      captures: [],
    };
  const keys = new Set(
    [...input.previousCaptures, ...input.currentCaptures].map(keyOf),
  );
  if (!keys.size)
    return {
      status: "review",
      reasons: ["no_captures_available"],
      changes: [],
      captures: [],
    };
  const captures: CaptureDecision[] = [];
  for (const key of keys) {
    const old = input.previousCaptures.filter(
      (capture) => keyOf(capture) === key,
    );
    const next = input.currentCaptures.filter(
      (capture) => keyOf(capture) === key,
    );
    const sample = next[0] ?? old[0];
    let inspected: { reasons: string[]; changes: EventTimeChange[] };
    if (old.length > 1 || next.length > 1)
      inspected = { reasons: ["ambiguous_capture_identity"], changes: [] };
    else if (!old.length)
      inspected = { reasons: ["new_source_candidate_only"], changes: [] };
    else if (!next.length)
      inspected = { reasons: ["source_missing_no_cancellation"], changes: [] };
    else inspected = inspectPair(old[0], next[0], input);
    captures.push({
      registryId: sample.registryId,
      sourceUrl: sample.source.sourceUrl,
      previous: old[0] ? reference(old[0]) : null,
      current: next[0] ? reference(next[0]) : null,
      status: inspected.reasons.length
        ? "review"
        : inspected.changes.length
          ? "ready"
          : "unchanged",
      ...inspected,
    });
  }
  const changes = captures.flatMap((capture) => capture.changes);
  const blockedEvents = new Map<string, string>();
  // 以既有映射和正式 URL 归属隔离复核；未知聚合候选不能阻断独立活动。
  for (const capture of captures.filter((item) => item.status === "review")) {
    for (const binding of input.bindings)
      if (
        binding.registryId === capture.registryId &&
        binding.sourceUrl === capture.sourceUrl
      )
        blockedEvents.set(binding.eventId, "event_has_source_under_review");
    for (const event of input.events)
      if (event.sources.some((source) => source.url === capture.sourceUrl))
        blockedEvents.set(event.id, "event_has_source_under_review");
  }
  // 同一正式字段若被多个来源提议修改，交回人工，避免交叉证据冲突。
  const duplicateFields = changes.filter(
    (change, index) =>
      changes.findIndex(
        (other) =>
          other.eventId === change.eventId && other.field === change.field,
      ) !== index,
  );
  for (const change of duplicateFields)
    blockedEvents.set(change.eventId, "multiple_sources_change_same_field");
  for (const capture of captures) {
    const blocked = capture.changes.filter((change) =>
      blockedEvents.has(change.eventId),
    );
    if (!blocked.length) continue;
    capture.status = "review";
    capture.reasons = [
      ...new Set([
        ...capture.reasons,
        ...blocked.map((change) => blockedEvents.get(change.eventId)!),
      ]),
    ];
    capture.changes = capture.changes.filter(
      (change) => !blockedEvents.has(change.eventId),
    );
  }
  const ready = changes.filter((change) => !blockedEvents.has(change.eventId));
  const reasons = [...new Set(captures.flatMap((capture) => capture.reasons))];
  return {
    status: reasons.length ? "review" : ready.length ? "ready" : "unchanged",
    reasons,
    changes: ready,
    captures,
  };
}

import {
  validateEventDataset,
  type EventDataset,
  type EventRecord,
} from "../../site/src/events/model.ts";
import type { CandidateSnapshot } from "./eventCandidates.ts";
import { isMinimalAggregationCreate } from "./eventDiscovery.ts";
import {
  encode,
  isTimestamp,
  sha256,
  verifyCapture,
  type SourceCapture,
} from "./sourceCapture.ts";
import {
  object,
  registrySource,
  requireState,
  type SourceRegistry,
} from "./sourceRegistry.ts";

export interface ReviewedEventChange {
  event: EventRecord;
  action: "create" | "update";
  evidence: { captureId: string; excerpt: string; supports: string[] }[];
  rationale: string;
}
export interface EventUpdateDraft {
  schemaVersion: "idol-reviewed-event-update-v1";
  baselineSha256: string;
  reviewedAt: string;
  reviewedBy: string;
  changes: ReviewedEventChange[];
}

/** 明确复核稿只应用指定记录；hash锁定基线，拒绝删除、重复身份或缺少原文证据。 */
export function prepareEventUpdate(
  baselineBytes: Uint8Array,
  input: unknown,
  captures: SourceCapture[],
  registry: SourceRegistry,
  groupIds: string[],
  now = new Date(),
): { dataset: EventDataset; bytes: string; changedIds: string[] } {
  requireState(
    object(input) &&
      input.schemaVersion === "idol-reviewed-event-update-v1" &&
      input.baselineSha256 === sha256(baselineBytes),
    "event_baseline_drift",
  );
  requireState(
    isTimestamp(input.reviewedAt) &&
      Date.parse(input.reviewedAt) <= now.getTime() &&
      typeof input.reviewedBy === "string" &&
      input.reviewedBy.trim().length > 0 &&
      Array.isArray(input.changes) &&
      input.changes.length > 0 &&
      input.changes.length <= 100,
    "invalid_review_metadata",
  );
  const current = validateEventDataset(
    JSON.parse(Buffer.from(baselineBytes).toString("utf8")),
    groupIds,
  );
  requireState(current.valid, "invalid_event_baseline");
  requireState(
    Date.parse(input.reviewedAt) >= Date.parse(current.data.updatedAt),
    "review_time_regression",
  );
  const byId = new Map<string, SourceCapture>();
  for (const capture of captures) {
    verifyCapture(capture, registrySource(registry, capture.registryId), now);
    requireState(!byId.has(capture.captureId), "duplicate_capture");
    byId.set(capture.captureId, capture);
  }
  const draft = input as unknown as EventUpdateDraft;
  const next = structuredClone(current.data);
  const changedIds: string[] = [];
  for (const change of draft.changes) {
    requireState(
      object(change) &&
        object(change.event) &&
        Array.isArray(change.evidence) &&
        change.evidence.length > 0 &&
        typeof change.rationale === "string" &&
        change.rationale.trim().length > 10,
      "invalid_reviewed_change",
    );
    const id = change.event.id;
    requireState(
      typeof id === "string" && !changedIds.includes(id),
      "duplicate_reviewed_event",
    );
    const old = current.data.events.find((event) => event.id === id);
    requireState(
      (change.action === "create" && !old) ||
        (change.action === "update" && old),
      "event_identity_action_conflict",
    );
    const cited: SourceCapture[] = [];
    const supported = new Set<string>();
    for (const evidence of change.evidence) {
      requireState(
        object(evidence) &&
          typeof evidence.captureId === "string" &&
          typeof evidence.excerpt === "string" &&
          evidence.excerpt.trim().length > 0 &&
          Array.isArray(evidence.supports) &&
          evidence.supports.every((field) => typeof field === "string"),
        "invalid_review_evidence",
      );
      const capture = byId.get(evidence.captureId);
      requireState(
        capture && capture.bodyText.includes(evidence.excerpt),
        "review_excerpt_not_in_capture",
      );
      cited.push(capture);
      for (const field of evidence.supports) supported.add(field);
    }
    const aggregationCreate = isMinimalAggregationCreate(
      change,
      cited,
      now,
      current.data.events,
    );
    requireState(
      cited.some(
        (capture) =>
          capture.source.completeness === "complete" &&
          ["official", "organizer", "venue", "ticketing"].includes(
            capture.source.kind,
          ),
      ) || aggregationCreate,
      "complete_primary_evidence_required",
    );
    for (const field of [
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
    ] as const) {
      const value = change.event[field];
      if (
        value !== null &&
        !(Array.isArray(value) && value.length === 0) &&
        (!old || JSON.stringify(value) !== JSON.stringify(old[field]))
      )
        requireState(supported.has(field), `missing_field_evidence_${field}`);
    }
    requireState(
      Array.isArray(change.event.sources),
      "missing_reviewed_sources",
    );
    for (const source of change.event.sources) {
      if (
        old?.sources.some(
          (existing) => JSON.stringify(source) === JSON.stringify(existing),
        )
      )
        continue;
      requireState(
        aggregationCreate ||
          cited.some(
            (capture) =>
              source.url === capture.source.sourceUrl &&
              source.label === capture.source.label &&
              source.publisher === capture.source.publisher &&
              source.kind === capture.source.kind &&
              source.observedAt === capture.source.observedAt,
          ),
        "public_source_provenance_mismatch",
      );
    }
    requireState(
      change.event.sources.some((source) =>
        cited.some((capture) => source.url === capture.source.sourceUrl),
      ),
      "reviewed_evidence_not_cited",
    );
    if (old)
      next.events[next.events.findIndex((event) => event.id === id)] =
        change.event;
    else next.events.push(change.event);
    changedIds.push(id);
  }
  next.updatedAt = draft.reviewedAt;
  const validated = validateEventDataset(next, groupIds);
  requireState(
    validated.valid,
    `invalid_reviewed_dataset:${validated.valid ? "" : JSON.stringify(validated.errors)}`,
  );
  return { dataset: validated.data, bytes: encode(validated.data), changedIds };
}

/** 正文未改的分段可延续保存键；改日期或改链接须在复核时显式对应，绝不猜测同场。 */
export function assignStableItemKeys(
  current: CandidateSnapshot,
  previous?: CandidateSnapshot,
): CandidateSnapshot {
  if (previous)
    requireState(
      previous.source.sourceId === current.source.sourceId &&
        Date.parse(current.source.observedAt) >=
          Date.parse(previous.source.observedAt),
      "source_observation_regression",
    );
  const fingerprint = (item: CandidateSnapshot["items"][number]): string =>
    sha256(
      encode({
        fields: item.fields,
        originalEventUrl: item.originalEventUrl ?? null,
        originalUrlIsUnique: item.originalUrlIsUnique ?? false,
      }),
    );
  return {
    source: current.source,
    items: current.items.map((item) => {
      if (item.sourceItemKey) return item;
      const matches =
        previous?.items.filter(
          (old) => fingerprint(old) === fingerprint(item),
        ) ?? [];
      requireState(matches.length <= 1, "ambiguous_saved_source_item");
      return {
        ...item,
        sourceItemKey:
          matches[0]?.sourceItemKey ?? `item-${fingerprint(item).slice(0, 24)}`,
      };
    }),
  };
}

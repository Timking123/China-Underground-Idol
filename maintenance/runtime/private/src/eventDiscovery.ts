import { isDeepStrictEqual } from "node:util";
import {
  validateEventDataset,
  type EventRecord,
} from "../../site/src/events/model.ts";
import type { ReviewedEventChange } from "./eventApplication.ts";
import { getCollectionWindow } from "./eventCandidates.ts";
import {
  encode,
  extractAggregation,
  sha256,
  verifyCapture,
  type AggregationExtraction,
  type SourceCapture,
} from "./sourceCapture.ts";
import {
  object,
  requireState,
  type RegisteredSource,
} from "./sourceRegistry.ts";

export interface AggregationDiscoveryBinding {
  detailUrl: string;
  eventId: string;
  date: string;
  city: string;
}
export interface AggregationDiscoveryReview {
  registryId: string;
  captureId: string;
  line: number | null;
  code: string;
  message: string;
  eventIds: string[];
}
export interface AggregationDiscoveryInput {
  captures: readonly SourceCapture[];
  freshCaptureIds: readonly string[];
  events: readonly EventRecord[];
  now: Date;
  bindings?: readonly AggregationDiscoveryBinding[];
}
export interface AggregationDiscoveryResult {
  changes: ReviewedEventChange[];
  summary: {
    discovered: number;
    created: number;
    existing: number;
    conflicts: number;
    past: number;
    overflow: number;
  };
  reviews: AggregationDiscoveryReview[];
  bindings: AggregationDiscoveryBinding[];
}

const BOARD: RegisteredSource = {
  id: "weibo-board",
  label: "地下偶像相关揭示板活动汇总",
  publisher: "地下偶像相关揭示板",
  kind: "aggregator",
  state: "pilot",
  collector: "manual-browser",
  pinnedUrls: ["https://weibo.com/7716940453/R3Ka7g7s0"],
  allowedUrlPrefixes: [],
  note: "只有已审核主帖模板允许自动收录最少字段。",
};
const NOTES =
  "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。";
type Row = AggregationExtraction["rows"][number] & { yearText: string };
const normalize = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");
const errorCode = (error: unknown): string =>
  error instanceof Error ? error.message : "aggregation_parse_failed";

function review(
  capture: SourceCapture,
  line: number | null,
  code: string,
  eventIds: string[] = [],
): AggregationDiscoveryReview {
  return {
    registryId: capture.registryId,
    captureId: capture.captureId,
    line,
    code,
    message: "此来源或条目需要复核，未自动新增或修改活动。",
    eventIds,
  };
}

/** 仅固定揭示板主帖进入此门；最终应用仍再次验证注册表与原始捕获。 */
function verifyBoard(capture: SourceCapture, now: Date): void {
  verifyCapture(capture, BOARD, now);
  requireState(
    capture.source.kind === "aggregator" &&
      capture.source.completeness === "complete" &&
      BOARD.pinnedUrls.includes(capture.source.sourceUrl),
    "complete_registered_board_required",
  );
}

/** 先校验全页链接数量，再固定行与锚点位置；坏行不能挪用后一条链接。 */
function boardRows(
  capture: SourceCapture,
  now: Date,
): { rows: Row[]; reviews: AggregationDiscoveryReview[] } {
  const rows: Row[] = [];
  const reviews: AggregationDiscoveryReview[] = [];
  try {
    verifyBoard(capture, now);
    const lines = capture.bodyText.split(/\r?\n/u);
    const dateLines = lines.filter((line) => /^\d{1,2}\//u.test(line.trim()));
    const links = capture.links.filter(
      (link) => link.text.trim() === "微博正文",
    );
    requireState(
      dateLines.length > 0 &&
        dateLines.filter((line) => /\s微博正文$/u.test(line.trim())).length ===
          links.length,
      "aggregation_link_count_mismatch",
    );
    let yearText = "";
    let canonicalYear = "";
    let linkIndex = 0;
    for (const [index, raw] of lines.entries()) {
      const line = raw.trim();
      if (/^\d{4}\s*年/u.test(line)) {
        const year = /^(20\d{2})\s*年$/u.exec(line);
        // 保留真实年份原文作证据；未知年份标题清除状态，不能沿用上年。
        yearText = year ? raw : "";
        canonicalYear = year ? `${year[1]}年` : "";
        continue;
      }
      if (!/^\d{1,2}\//u.test(line)) continue;
      const rowLinks = /\s微博正文$/u.test(line) ? [links[linkIndex++]] : [];
      try {
        const extracted = extractAggregation(
          { ...capture, bodyText: `${canonicalYear}\n${raw}`, links: rowLinks },
          now,
        ).rows[0];
        const row: Row = {
          ...extracted,
          line: index + 1,
          title: normalize(extracted.title),
          city: normalize(extracted.city),
          yearText,
        };
        const valid = validateEventDataset(
          {
            schemaVersion: "idol-events-v1",
            updatedAt: now.toISOString(),
            coverage: "partial",
            events: [eventFor(capture, row)],
          },
          [],
        );
        requireState(valid.valid, "invalid_aggregation_record");
        rows.push(row);
      } catch (error) {
        reviews.push(review(capture, index + 1, errorCode(error)));
      }
    }
  } catch (error) {
    reviews.push(review(capture, null, errorCode(error)));
  }
  return { rows, reviews };
}

/** 有详情时身份含日期与城市，保留同帖多日；无详情时使用逐条规范化字段。 */
function eventFor(capture: SourceCapture, row: Row): EventRecord {
  const id = `e-board-${sha256(
    encode({
      registryId: capture.registryId,
      sourceUrl: capture.source.sourceUrl,
      date: row.date,
      city: row.city,
      detailUrl: row.detailUrl,
      title: row.detailUrl === null ? row.title : null,
    }),
  ).slice(0, 32)}`;
  return {
    id,
    title: row.title,
    date: row.date,
    province: null,
    city: row.city,
    venue: null,
    address: null,
    opensAt: null,
    startsAt: null,
    endsAt: null,
    status: "unconfirmed",
    performers: [],
    sources: [
      {
        url: capture.source.sourceUrl,
        label: capture.source.label,
        publisher: capture.source.publisher,
        observedAt: capture.source.observedAt,
        kind: capture.source.kind,
      },
      ...(row.detailUrl
        ? [
            {
              url: row.detailUrl,
              label: "揭示板所附详情（正文未核验）",
              publisher: capture.source.publisher,
              observedAt: capture.source.observedAt,
              kind: capture.source.kind,
            },
          ]
        : []),
    ],
    notes: NOTES,
    poster: null,
  };
}
function changeFor(capture: SourceCapture, row: Row): ReviewedEventChange {
  return {
    event: eventFor(capture, row),
    action: "create",
    evidence: [
      {
        captureId: capture.captureId,
        excerpt: row.text,
        supports: ["title", "date", "city", "status"],
      },
      {
        captureId: capture.captureId,
        excerpt: row.yearText,
        supports: ["date"],
      },
    ],
    rationale:
      "按完整揭示板已捕获日期行收录待确认活动；只保留可证明的标题、日期、城市及来源，其余资料留空。",
  };
}

/** 应用门重新解析捕获，逐字段比较规范记录与原文证据，不信任提案自称的策略。 */
export function isMinimalAggregationCreate(
  change: ReviewedEventChange,
  captures: readonly SourceCapture[],
  now: Date,
  events: readonly EventRecord[] = [],
): boolean {
  if (
    change.action !== "create" ||
    Object.keys(change).sort().join(",") !== "action,event,evidence,rationale"
  )
    return false;
  const expected = collectAggregationDiscoveries(
    {
      captures,
      freshCaptureIds: captures.map((capture) => capture.captureId),
      events,
      now,
    },
    Number.POSITIVE_INFINITY,
  );
  return expected.changes.some(
    (candidate) =>
      isDeepStrictEqual(change.event, candidate.event) &&
      isDeepStrictEqual(change.evidence, candidate.evidence),
  );
}

function validBinding(binding: AggregationDiscoveryBinding): boolean {
  return (
    object(binding) &&
    Object.keys(binding).sort().join(",") === "city,date,detailUrl,eventId" &&
    typeof binding.detailUrl === "string" &&
    /^https:\/\/weibo\.com\/7716940453\/[a-zA-Z0-9]+$/u.test(
      binding.detailUrl,
    ) &&
    typeof binding.eventId === "string" &&
    /^e-[a-z0-9-]+$/u.test(binding.eventId) &&
    typeof binding.date === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/u.test(binding.date) &&
    typeof binding.city === "string" &&
    /^[\p{Script=Han}·]+$/u.test(binding.city)
  );
}

/** 只生成可追溯的新增；已存活动不覆盖，显式绑定必须再次核对日期与城市。 */
export function buildAggregationDiscoveries(
  input: AggregationDiscoveryInput,
): AggregationDiscoveryResult {
  return collectAggregationDiscoveries(input, 100);
}

function collectAggregationDiscoveries(
  {
    captures,
    freshCaptureIds,
    events,
    now,
    bindings = [],
  }: AggregationDiscoveryInput,
  maxChanges: number,
): AggregationDiscoveryResult {
  const result: AggregationDiscoveryResult = {
    changes: [],
    summary: {
      discovered: 0,
      created: 0,
      existing: 0,
      conflicts: 0,
      past: 0,
      overflow: 0,
    },
    reviews: [],
    bindings: structuredClone([...bindings]),
  };
  const today = getCollectionWindow(now).fromInclusive;
  const fresh = new Set(freshCaptureIds);
  const eligible = [
    ...new Map(
      captures
        .filter(
          (capture) =>
            capture.registryId === BOARD.id && fresh.has(capture.captureId),
        )
        .map((capture) => [capture.captureId, capture]),
    ).values(),
  ];
  const entries = eligible.flatMap((capture) => {
    const parsed = boardRows(capture, now);
    result.reviews.push(...parsed.reviews);
    result.summary.conflicts += parsed.reviews.length;
    return parsed.rows.map((row) => ({
      capture,
      row,
      event: eventFor(capture, row),
    }));
  });
  const seen = new Set<string>();
  for (const { capture, row, event } of entries) {
    const signature = encode({ id: event.id, title: row.title });
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.summary.discovered += 1;
    if (row.date < today) {
      result.summary.past += 1;
      continue;
    }
    const conflict = (code: string, ids: string[] = []): void => {
      result.summary.conflicts += 1;
      result.reviews.push(review(capture, row.line, code, ids));
    };
    if (
      entries.some(
        (entry) =>
          entry.event.id !== event.id &&
          entry.row.date === row.date &&
          entry.row.city === row.city &&
          entry.row.title === row.title,
      )
    ) {
      conflict("aggregation_possible_duplicate");
      continue;
    }
    if (
      entries.some(
        (entry) => entry.event.id === event.id && entry.row.title !== row.title,
      )
    ) {
      conflict("aggregation_identity_conflict");
      continue;
    }
    // 畸形绑定只隔离对应详情；不能因单个绑定错误阻止其他活动。
    const related = bindings.filter(
      (binding) => object(binding) && binding.detailUrl === row.detailUrl,
    );
    if (related.some((binding) => !validBinding(binding))) {
      conflict("invalid_aggregation_binding");
      continue;
    }
    const matches = related.filter(
      (binding) => binding.date === row.date && binding.city === row.city,
    );
    const explicitIds = [...new Set(matches.map((binding) => binding.eventId))];
    if (explicitIds.length > 1) {
      conflict("ambiguous_aggregation_binding", explicitIds);
      continue;
    }
    const targets = explicitIds.length
      ? events.filter((existing) => existing.id === explicitIds[0])
      : events.filter(
          (existing) =>
            existing.id === event.id ||
            (row.detailUrl !== null &&
              existing.date === row.date &&
              existing.city === row.city &&
              existing.sources.some((source) => source.url === row.detailUrl)),
        );
    if (
      explicitIds.length &&
      (targets.length !== 1 ||
        targets[0].date !== row.date ||
        targets[0].city !== row.city)
    ) {
      conflict("aggregation_binding_fields_conflict", explicitIds);
      continue;
    }
    if (targets.length > 1) {
      conflict(
        "ambiguous_existing_aggregation",
        targets.map((target) => target.id),
      );
      continue;
    }
    if (targets.length === 1) {
      const target = targets[0];
      if (
        target.date !== row.date ||
        target.city !== row.city ||
        ((!explicitIds.length || target.id === event.id) &&
          normalize(target.title) !== row.title)
      ) {
        conflict("aggregation_existing_fields_conflict", [target.id]);
        continue;
      }
      result.summary.existing += 1;
      if (row.detailUrl)
        addBinding(result.bindings, {
          detailUrl: row.detailUrl,
          eventId: target.id,
          date: row.date,
          city: row.city,
        });
      continue;
    }
    // 相同日期、城市与完整标题仅提示疑似重复，不据此绑定或覆盖旧记录。
    const exact = events.filter(
      (existing) =>
        existing.date === row.date &&
        existing.city === row.city &&
        normalize(existing.title) === row.title,
    );
    if (exact.length) {
      conflict(
        "aggregation_possible_duplicate",
        exact.map((target) => target.id),
      );
      continue;
    }
    if (result.changes.length >= maxChanges) {
      result.summary.overflow += 1;
      result.reviews.push(
        review(capture, row.line, "aggregation_change_limit"),
      );
      continue;
    }
    result.changes.push(changeFor(capture, row));
    result.summary.created += 1;
    if (row.detailUrl)
      addBinding(result.bindings, {
        detailUrl: row.detailUrl,
        eventId: event.id,
        date: row.date,
        city: row.city,
      });
  }
  return result;
}

function addBinding(
  bindings: AggregationDiscoveryBinding[],
  binding: AggregationDiscoveryBinding,
): void {
  if (!bindings.some((existing) => isDeepStrictEqual(existing, binding)))
    bindings.push(binding);
}

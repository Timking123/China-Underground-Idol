import { createHash } from "node:crypto";
import type {
  CandidateSnapshot,
  CandidateSource,
  EventCandidateInput,
} from "./eventCandidates.ts";
import { getCollectionWindow } from "./eventCandidates.ts";
import {
  object,
  requireRegisteredUrl,
  requireState,
  safePublicUrl,
  type RegisteredSource,
} from "./sourceRegistry.ts";

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const encode = (value: unknown): string =>
  JSON.stringify(value, null, 2) + "\n";

export interface SourceLink {
  text: string;
  href: string;
}
export interface BrowserSourceProof {
  schemaVersion: "public-browser-source-v1";
  sourceUrl: string;
  capturedAt: string;
  captureMethod: "public-browser-visible-article";
  text: string;
  textSha256: string;
  links: SourceLink[];
}
export interface BodySelection {
  start: string;
  end: string;
  complete: boolean;
}
export interface SourceCapture {
  schemaVersion: "idol-source-capture-v1";
  captureId: string;
  registryId: string;
  source: CandidateSource;
  fetchedAt: string;
  publishedAt: string | null;
  publishedText: string | null;
  method: "public-browser" | "public-http";
  bodyText: string;
  links: SourceLink[];
  evidenceSha256: string;
  articleSha256: string;
  selection: BodySelection | null;
}

export function isTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.test(
      value,
    )
  )
    return false;
  if (/[+-]14:(?!00$)/u.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** 只拒绝凭据形态；团体名Token等普通公开词不会被当作密钥。 */
export function assertNoSecrets(value: string): void {
  requireState(
    !/\b(?:authorization|set-cookie|cookie|access_token|refresh_token|client_secret|password)\s*["']?\s*[:=]|\bbearer\s+[a-z0-9._~-]{12,}|\b(?:wb_|at_|rt_)[a-zA-Z0-9_-]{20,}/iu.test(
      value,
    ),
    "sensitive_source_rejected",
  );
}

function oneOccurrence(text: string, marker: string): number {
  requireState(
    marker.length > 0 && marker.length <= 1000,
    "invalid_body_marker",
  );
  const first = text.indexOf(marker);
  requireState(
    first >= 0 && text.indexOf(marker, first + 1) < 0,
    "missing_or_ambiguous_body_marker",
  );
  return first;
}

/** 使用审阅后的首尾锚点；不删除正文里的数字、关注、票价或抽奖句。 */
export function selectBody(article: string, selection: BodySelection): string {
  requireState(
    object(selection) &&
      typeof selection.start === "string" &&
      typeof selection.end === "string" &&
      typeof selection.complete === "boolean" &&
      Object.keys(selection).length === 3,
    "invalid_body_selection",
  );
  const from = oneOccurrence(article, selection.start);
  const to = oneOccurrence(article, selection.end) + selection.end.length;
  requireState(to > from, "reversed_body_selection");
  const result = article.slice(from, to);
  requireState(
    Buffer.byteLength(result, "utf8") <= MAX_SOURCE_BYTES &&
      result.trim().length > 0,
    "invalid_body_size",
  );
  return result;
}

export function validateBrowserProof(
  input: unknown,
  source: RegisteredSource,
  now: Date,
): BrowserSourceProof {
  requireState(
    object(input) &&
      input.schemaVersion === "public-browser-source-v1" &&
      input.captureMethod === "public-browser-visible-article",
    "invalid_browser_proof",
  );
  requireRegisteredUrl(source, input.sourceUrl);
  requireState(
    isTimestamp(input.capturedAt) &&
      Date.parse(input.capturedAt) <= now.getTime() &&
      Number.isFinite(now.getTime()),
    "invalid_source_observation_time",
  );
  requireState(
    typeof input.text === "string" &&
      input.text.length > 0 &&
      Buffer.byteLength(input.text) <= MAX_SOURCE_BYTES,
    "invalid_source_text",
  );
  requireState(
    typeof input.textSha256 === "string" &&
      sha256(input.text) === input.textSha256,
    "source_text_hash_mismatch",
  );
  assertNoSecrets(encode(input));
  requireState(
    Array.isArray(input.links) && input.links.length <= 3000,
    "invalid_source_links",
  );
  for (const link of input.links)
    requireState(
      object(link) &&
        typeof link.text === "string" &&
        link.text.length <= 4000 &&
        typeof link.href === "string" &&
        link.href.length <= 2048,
      "invalid_source_link",
    );
  return input as unknown as BrowserSourceProof;
}

export function captureBrowserProof(
  input: unknown,
  proofBytes: Uint8Array,
  source: RegisteredSource,
  selection: BodySelection,
  now: Date,
): SourceCapture {
  const proof = validateBrowserProof(input, source, now);
  requireState(
    JSON.stringify(JSON.parse(Buffer.from(proofBytes).toString("utf8"))) ===
      JSON.stringify(input),
    "proof_bytes_do_not_match_input",
  );
  const bodyText = selectBody(proof.text, selection);
  const evidenceSha256 = sha256(proofBytes);
  const bodySha256 = sha256(bodyText);
  const sourceId = `${source.id}-${sha256(proof.sourceUrl).slice(0, 16)}`;
  const identity = {
    registryId: source.id,
    sourceUrl: proof.sourceUrl,
    observedAt: proof.capturedAt,
    bodySha256,
    evidenceSha256,
    completeness: selection.complete ? "complete" : "partial",
  };
  return {
    schemaVersion: "idol-source-capture-v1",
    captureId: sha256(encode(identity)),
    registryId: source.id,
    source: {
      sourceId,
      sourceUrl: proof.sourceUrl,
      label: source.label,
      publisher: source.publisher,
      kind: source.kind,
      observedAt: proof.capturedAt,
      bodySha256,
      completeness: selection.complete ? "complete" : "partial",
    },
    fetchedAt: proof.capturedAt,
    publishedAt: null,
    publishedText:
      proof.text
        .split(/\r?\n/u)
        .find((line) => /^\d{2}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/u.test(line)) ??
      null,
    method: "public-browser",
    bodyText,
    links: proof.links,
    evidenceSha256,
    articleSha256: proof.textSha256,
    selection,
  };
}

export function verifyCapture(
  capture: unknown,
  source: RegisteredSource,
  now: Date,
): asserts capture is SourceCapture {
  requireState(
    object(capture) &&
      capture.schemaVersion === "idol-source-capture-v1" &&
      capture.registryId === source.id &&
      object(capture.source),
    "invalid_capture",
  );
  requireRegisteredUrl(source, capture.source.sourceUrl);
  requireState(
    capture.source.kind === source.kind &&
      capture.source.publisher === source.publisher &&
      capture.source.label === source.label,
    "capture_registry_mismatch",
  );
  requireState(
    typeof capture.bodyText === "string" &&
      sha256(capture.bodyText) === capture.source.bodySha256 &&
      Buffer.byteLength(capture.bodyText) <= MAX_SOURCE_BYTES,
    "capture_body_hash_mismatch",
  );
  requireState(
    isTimestamp(capture.source.observedAt) &&
      capture.source.observedAt === capture.fetchedAt &&
      Date.parse(capture.source.observedAt) <= now.getTime(),
    "invalid_capture_observation_time",
  );
  requireState(
    ["complete", "partial"].includes(String(capture.source.completeness)) &&
      typeof capture.evidenceSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(capture.evidenceSha256),
    "invalid_capture_evidence",
  );
  const identity = {
    registryId: source.id,
    sourceUrl: capture.source.sourceUrl,
    observedAt: capture.source.observedAt,
    bodySha256: capture.source.bodySha256,
    evidenceSha256: capture.evidenceSha256,
    completeness: capture.source.completeness,
  };
  requireState(
    capture.captureId === sha256(encode(identity)) &&
      capture.source.sourceId ===
        `${source.id}-${sha256(capture.source.sourceUrl).slice(0, 16)}`,
    "capture_identity_mismatch",
  );
  assertNoSecrets(encode(capture));
}

export interface AggregationExtraction {
  snapshot: CandidateSnapshot;
  rows: {
    line: number;
    text: string;
    date: string;
    city: string;
    title: string;
    detailUrl: string | null;
    candidateId: string;
    duplicateOfLine: number | null;
    inWindow: boolean;
    focus: boolean;
  }[];
  summary: {
    dateRows: number;
    matchedLinks: number;
    uniqueCandidates: number;
    inWindow: number;
    focus: number;
    duplicates: number;
    missingDetailUrlsInWindow: number;
  };
}

/** 先把全部日期行与DOM锚点配对，再去推荐重复；不会把共用详情的多日活动合并。 */
export function extractAggregation(
  capture: SourceCapture,
  now: Date,
): AggregationExtraction {
  requireState(
    capture.source.kind === "aggregator",
    "aggregation_source_required",
  );
  const links = capture.links.filter((link) => link.text.trim() === "微博正文");
  const window = getCollectionWindow(now);
  let year: string | null = null;
  let linkIndex = 0;
  const rows: AggregationExtraction["rows"] = [];
  const items: EventCandidateInput[] = [];
  const seen = new Map<string, number>();
  for (const [index, raw] of capture.bodyText.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    const yearMatch = /^(20\d{2})年$/u.exec(line);
    if (yearMatch) {
      year = yearMatch[1];
      continue;
    }
    if (!/^\d{1,2}\//u.test(line)) continue;
    const match = /^(\d{1,2})\/(\d{1,2})\s+([\p{Script=Han}·]+)\s+(.+)$/u.exec(
      line,
    );
    requireState(match && year, "unparsed_or_yearless_date_row");
    const date = `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    requireState(
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
      "invalid_aggregation_date",
    );
    const hasLink = /\s微博正文$/u.test(match[4]);
    const detailUrl = hasLink ? links[linkIndex++]?.href : null;
    requireState(
      !hasLink ||
        (safePublicUrl(detailUrl) &&
          /^https:\/\/weibo\.com\/\d{4,20}\/[a-zA-Z0-9]+$/u.test(detailUrl) &&
          new URL(detailUrl).pathname.split("/")[1] ===
            new URL(capture.source.sourceUrl).pathname.split("/")[1]),
      "aggregation_detail_link_mismatch",
    );
    const title = match[4]
      .replace(/\s微博正文$/u, "")
      .replace(/^[🎂🆓🎸\s]+/u, "")
      .trim();
    requireState(
      title.length > 0 && title.length <= 160,
      "invalid_aggregation_title",
    );
    const key = encode({ date, city: match[3], title, detailUrl });
    const candidateId = `c-${sha256(capture.source.sourceId + capture.source.bodySha256 + key).slice(0, 32)}`;
    const duplicateOfLine = seen.get(key) ?? null;
    const inWindow = date >= window.fromInclusive && date < window.toExclusive;
    const focus =
      date >= window.fromInclusive && date < window.focusToExclusive;
    rows.push({
      line: index + 1,
      text: raw,
      date,
      city: match[3],
      title,
      detailUrl: detailUrl ?? null,
      candidateId,
      duplicateOfLine,
      inWindow,
      focus,
    });
    if (duplicateOfLine !== null) continue;
    seen.set(key, index + 1);
    items.push({
      candidateId,
      ...(detailUrl
        ? { originalEventUrl: detailUrl, originalUrlIsUnique: false }
        : {}),
      fields: {
        title,
        date,
        city: match[3],
        status: "unconfirmed",
        notes:
          "投稿聚合线索，尚未完成原发布者及临期变更复核；未知场地、时刻、阵容保持为空。",
      },
      fieldExcerpts: {
        title: raw,
        date: `${year}年\n${raw}`,
        city: raw,
        status: "聚合源角色与候选策略，不是官宣状态结论。",
      },
    });
  }
  requireState(
    rows.length > 0 && linkIndex === links.length,
    "aggregation_link_count_mismatch",
  );
  const uniqueRows = rows.filter((row) => row.duplicateOfLine === null);
  return {
    snapshot: { source: capture.source, items },
    rows,
    summary: {
      dateRows: rows.length,
      matchedLinks: linkIndex,
      uniqueCandidates: items.length,
      inWindow: uniqueRows.filter((row) => row.inWindow).length,
      focus: uniqueRows.filter((row) => row.focus).length,
      duplicates: rows.length - uniqueRows.length,
      missingDetailUrlsInWindow: uniqueRows.filter(
        (row) => row.inWindow && row.detailUrl === null,
      ).length,
    },
  };
}

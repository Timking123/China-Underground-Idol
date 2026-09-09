import type { CandidateSnapshot } from "./eventCandidates.ts";
import { getCollectionWindow } from "./eventCandidates.ts";
import {
  encode,
  isTimestamp,
  MAX_SOURCE_BYTES,
  sha256,
  type SourceCapture,
  type SourceLink,
} from "./sourceCapture.ts";
import {
  requireRegisteredUrl,
  requireState,
  type RegisteredSource,
} from "./sourceRegistry.ts";

/** 仅处理当前已核实SSR结构；结构变化报错，不读取脚本状态或登录信息。 */
export function visibleHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<[^>]*>/gu, "\n")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
export function sanitizePublicHtml(html: string): string {
  const sanitized = html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
    "",
  );
  requireState(
    !/<(?:script|style)\b/iu.test(sanitized),
    "incomplete_runtime_element",
  );
  return sanitized;
}
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`,
    "iu",
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}
export interface HttpProof {
  schemaVersion: "public-http-source-v1";
  sourceUrl: string;
  capturedAt: string;
  status: 200;
  contentType: string;
  sanitized: "script-and-style-elements-removed";
  rawResponseSha256: string;
  html: string;
  htmlSha256: string;
}
export function captureHttp(
  proof: HttpProof,
  source: RegisteredSource,
): SourceCapture {
  requireRegisteredUrl(source, proof.sourceUrl);
  requireState(
    proof.schemaVersion === "public-http-source-v1" &&
      proof.status === 200 &&
      proof.sanitized === "script-and-style-elements-removed" &&
      /^[a-f0-9]{64}$/u.test(proof.rawResponseSha256) &&
      sanitizePublicHtml(proof.html) === proof.html &&
      isTimestamp(proof.capturedAt) &&
      sha256(proof.html) === proof.htmlSha256 &&
      Buffer.byteLength(proof.html) <= MAX_SOURCE_BYTES,
    "invalid_http_proof",
  );
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(proof.html)?.[1];
  requireState(
    main && /data-server-rendered="true"/u.test(proof.html),
    "missing_public_ssr_main",
  );
  const bodyText = visibleHtml(main);
  requireState(
    bodyText.length > 30 && !/安全验证|访问异常|验证后继续访问/u.test(bodyText),
    "public_source_challenge",
  );
  const links: SourceLink[] = [
    ...main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu),
  ].flatMap((match) => {
    const href = attribute(match[1], "href");
    return href
      ? [
          {
            href: new URL(href, proof.sourceUrl).href,
            text: visibleHtml(match[2]),
          },
        ]
      : [];
  });
  const completeness = /\/host\//u.test(proof.sourceUrl)
    ? "partial"
    : "complete";
  const evidenceSha256 = sha256(encode(proof));
  const bodySha256 = sha256(bodyText);
  const identity = {
    registryId: source.id,
    sourceUrl: proof.sourceUrl,
    observedAt: proof.capturedAt,
    bodySha256,
    evidenceSha256,
    completeness,
  };
  return {
    schemaVersion: "idol-source-capture-v1",
    captureId: sha256(encode(identity)),
    registryId: source.id,
    source: {
      sourceId: `${source.id}-${sha256(proof.sourceUrl).slice(0, 16)}`,
      sourceUrl: proof.sourceUrl,
      label: source.label,
      publisher: source.publisher,
      kind: source.kind,
      observedAt: proof.capturedAt,
      bodySha256,
      completeness,
    },
    fetchedAt: proof.capturedAt,
    publishedAt: null,
    publishedText: null,
    method: "public-http",
    bodyText,
    links,
    evidenceSha256,
    articleSha256: proof.htmlSha256,
    selection: null,
  };
}

export function extractShowstartHost(
  proof: HttpProof,
  capture: SourceCapture,
  now: Date,
): CandidateSnapshot {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(proof.html)?.[1];
  requireState(main, "missing_public_ssr_main");
  const items: CandidateSnapshot["items"] = [];
  const ids = new Set<string>();
  const window = getCollectionWindow(now);
  const eventUrl = (href: string | undefined): string | null => {
    if (!href) return null;
    const url = new URL(href, proof.sourceUrl);
    if (!/^\/event\/\d+/u.test(url.pathname)) return null;
    requireState(
      url.origin === "https://www.showstart.com" &&
        /^\/event\/\d+$/u.test(url.pathname) &&
        !url.search &&
        !url.hash,
      "unrecognized_host_event_link",
    );
    return url.href;
  };
  // 独立枚举开标签，确保已发现活动卡没有因引号或结构变化被静默丢弃。
  const discovered = [...main.matchAll(/<a\b[^>]*>/giu)]
    .map((match) => eventUrl(attribute(match[0], "href")))
    .filter((url) => url !== null);
  for (const match of main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const originalEventUrl = eventUrl(attribute(match[1], "href"));
    if (!originalEventUrl) continue;
    const id = new URL(originalEventUrl).pathname.split("/")[2];
    const fields: Record<string, string> = {};
    for (const field of match[2].matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/giu)) {
      const name = attribute(field[1], "class");
      if (name && ["name", "time", "addr", "performerName"].includes(name))
        fields[name] = visibleHtml(field[2]);
    }
    requireState(
      fields.name && fields.time && !ids.has(id),
      "invalid_or_duplicate_host_event",
    );
    ids.add(id);
    const when =
      /^(20\d{2})\/(\d{2})\/(\d{2})\s+((?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(
        fields.time,
      );
    requireState(when, "invalid_host_event_date");
    const date = `${when[1]}-${when[2]}-${when[3]}`;
    requireState(
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
      "invalid_host_event_date",
    );
    if (date < window.fromInclusive || date >= window.toExclusive) continue;
    items.push({
      candidateId: `c-${sha256(capture.source.bodySha256 + originalEventUrl).slice(0, 32)}`,
      sourceItemKey: `showstart-${id}`,
      originalEventUrl,
      originalUrlIsUnique: true,
      fields: {
        title: fields.name,
        date,
        venue: fields.addr || null,
        startsAt: when[4],
        status: "unconfirmed",
        notes:
          "秀动厂牌首页线索，待详情、场次及临期变更复核；列表不完整，票种名称不能当作阵容。",
      },
      fieldExcerpts: {
        title: fields.name,
        date: fields.time,
        startsAt: fields.time,
        venue: fields.addr,
      },
    });
  }
  requireState(
    ids.size > 0 && ids.size === discovered.length,
    "public_host_event_coverage_mismatch",
  );
  return { source: capture.source, items };
}

/** 单一公开域名、无凭据、禁止跳转、限制字节与请求数；失败不自动重试。 */
export async function collectShowstart(
  source: RegisteredSource,
  now = new Date(),
  request: typeof fetch = fetch,
): Promise<{
  proofs: HttpProof[];
  captures: SourceCapture[];
  snapshot: CandidateSnapshot;
}> {
  requireState(
    source.state === "pilot" && source.collector === "showstart-public-http",
    "source_not_enabled_for_public_collection",
  );
  const proofs: HttpProof[] = [];
  async function get(url: string): Promise<HttpProof> {
    requireRegisteredUrl(source, url);
    requireState(
      new URL(url).hostname === "www.showstart.com" && proofs.length < 10,
      "public_request_limit",
    );
    const response = await request(url, {
      redirect: "error",
      credentials: "omit",
      headers: {
        accept: "text/html",
        "user-agent": "IdolPublicSourceReview/1.0",
      },
      signal: AbortSignal.timeout(25_000),
    });
    requireState(
      response.status === 200 &&
        /text\/html/iu.test(response.headers.get("content-type") ?? ""),
      `public_http_status_${response.status}`,
    );
    requireState(
      Number(response.headers.get("content-length") ?? 0) <= MAX_SOURCE_BYTES,
      "public_source_too_large",
    );
    const chunks: Uint8Array[] = [];
    let size = 0;
    requireState(response.body, "public_source_empty");
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        requireState(size <= MAX_SOURCE_BYTES, "public_source_too_large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const raw = Buffer.concat(chunks);
    const html = sanitizePublicHtml(raw.toString("utf8"));
    const proof: HttpProof = {
      schemaVersion: "public-http-source-v1",
      sourceUrl: url,
      capturedAt: new Date().toISOString(),
      status: 200,
      contentType: response.headers.get("content-type") ?? "",
      sanitized: "script-and-style-elements-removed",
      rawResponseSha256: sha256(raw),
      html,
      htmlSha256: sha256(html),
    };
    proofs.push(proof);
    return proof;
  }
  const hostProof = await get(source.pinnedUrls[0]);
  const host = captureHttp(hostProof, source);
  const snapshot = extractShowstartHost(hostProof, host, now);
  requireState(
    snapshot.items.length <= 9,
    "public_window_exceeds_request_budget",
  );
  const captures = [host];
  for (const item of snapshot.items) {
    requireState(item.originalEventUrl, "missing_detail_url");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const detail = captureHttp(await get(item.originalEventUrl), source);
    requireState(
      detail.links.some((link) => link.href === source.pinnedUrls[0]),
      "detail_host_identity_mismatch",
    );
    captures.push(detail);
  }
  return { proofs, captures, snapshot };
}

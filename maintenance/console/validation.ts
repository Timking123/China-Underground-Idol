import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import {
  feedbackKinds,
  type FeedbackInput,
} from "../../src/admin/contracts.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "请求格式不正确");
  return value as Record<string, unknown>;
}
export function textField(
  value: unknown,
  maximum: number,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    throw new HttpError(400, "输入格式或长度不正确");
  const text = value.trim();
  if (required && !text) throw new HttpError(400, "请填写必填项");
  return text;
}
export function feedbackInput(value: unknown): FeedbackInput {
  const input = object(value);
  if (!feedbackKinds.includes(input.kind as FeedbackInput["kind"]))
    throw new HttpError(400, "请选择有效的反馈类型");
  const source = textField(input.source, 800);
  if (source) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new HttpError(400, "来源链接不正确");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new HttpError(400, "来源须为公开 HTTP 或 HTTPS 链接");
  }
  const requestId = textField(input.requestId, 36, true);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      requestId,
    )
  )
    throw new HttpError(400, "提交编号不正确，请刷新页面");
  if (input.consent !== true) throw new HttpError(400, "请先确认投稿隐私说明");
  return {
    kind: input.kind as FeedbackInput["kind"],
    target: textField(input.target, 160, true),
    source,
    details: textField(input.details, 3000, true),
    contact: textField(input.contact, 160),
    website: textField(input.website, 160),
    consent: true,
    requestId,
  };
}
export function canonicalIp(raw: string): string {
  const value =
    raw.toLowerCase().startsWith("::ffff:") && isIP(raw.slice(7)) === 4
      ? raw.slice(7)
      : raw;
  const version = isIP(value);
  if (!version || value.includes("%"))
    throw new HttpError(400, "访客地址格式无效");
  if (version !== 6) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/u.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}
/** 生产只信任本机 Nginx 覆盖的专用头；不接收任意 X-Forwarded-For。 */
export function requestIp(
  request: IncomingMessage,
  trustedProxy: boolean,
): string {
  const remote = canonicalIp(request.socket.remoteAddress ?? "");
  if (!trustedProxy) return remote;
  if (!["127.0.0.1", "::1"].includes(remote))
    throw new HttpError(403, "仅接受固定代理请求");
  const forwarded = request.headers["x-console-client-ip"];
  if (typeof forwarded !== "string") throw new HttpError(400, "代理地址缺失");
  if (
    request.rawHeaders.filter(
      (_, index) =>
        index % 2 === 0 &&
        request.rawHeaders[index].toLowerCase() === "x-console-client-ip",
    ).length !== 1
  )
    throw new HttpError(400, "代理地址重复");
  return canonicalIp(forwarded);
}
export function positivePage(value: string | null): number {
  if (value === null) return 1;
  if (!/^[1-9]\d{0,4}$/u.test(value)) throw new HttpError(400, "页码不正确");
  return Number(value);
}
export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/iu.test(
      String(request.headers["content-type"] ?? ""),
    )
  )
    throw new HttpError(415, "请使用 JSON 提交");
  const declared = request.headers["content-length"];
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > 24000))
    throw new HttpError(413, "提交内容过大");
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const done = (error?: Error): void => {
      clearTimeout(timer);
      request.off("data", data);
      request.off("end", end);
      request.off("error", failure);
      request.off("aborted", aborted);
      if (error) {
        request.resume();
        reject(error);
      }
    };
    const failure = (): void => done(new HttpError(400, "请求未完整发送"));
    const aborted = (): void => failure();
    const data = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > 24000) done(new HttpError(413, "提交内容过大"));
      else chunks.push(chunk);
    };
    const end = (): void => {
      done();
      try {
        resolve(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ) as unknown,
        );
      } catch {
        reject(new HttpError(400, "请求不是有效 JSON"));
      }
    };
    const timer = setTimeout(
      () => done(new HttpError(408, "请求发送超时")),
      10000,
    );
    timer.unref();
    request.on("data", data);
    request.once("end", end);
    request.once("error", failure);
    request.once("aborted", aborted);
  });
}

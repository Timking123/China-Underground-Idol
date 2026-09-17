import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  ConsoleStore,
  RETENTION_DAYS,
  type Account,
  type Session,
} from "./store.ts";
import { hashPassword, verifyPassword } from "./crypto.ts";
import { createSiteFileResolver } from "./security.ts";
import {
  feedbackInput,
  HttpError,
  object,
  positivePage,
  readJson,
  requestIp,
  textField,
} from "./validation.ts";
import type { GeoLocator } from "./geo.ts";
import {
  feedbackStatuses,
  type ConsoleSettings,
  type FeedbackStatus,
  type Visit,
} from "../../src/admin/contracts.ts";

export interface ServerOptions {
  store: ConsoleStore;
  origin: string;
  trustedProxy: boolean;
  adminDirectory: string;
  siteDirectory?: string;
  keyFile?: string;
  devStatic?: boolean;
  geo: GeoLocator;
  now?: () => number;
}
const PUBLIC_PAGES = new Set([
  "/",
  "/index.html",
  "/discover.html",
  "/groups.html",
  "/group.html",
  "/events.html",
  "/geography.html",
  "/guide.html",
  "/contribute.html",
  "/about.html",
]);
const COOKIE = "idol_admin";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
function headers(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=()",
  );
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
}
function reply(
  response: ServerResponse,
  status: number,
  data: unknown = null,
  message = "成功",
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(
    JSON.stringify({ code: status >= 400 ? status : 0, data, message }),
  );
}
function constantMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function browserInfo(agent: string): { browser: string; device: string } {
  return {
    browser: /Edg\//u.test(agent)
      ? "Edge"
      : /Firefox\//u.test(agent)
        ? "Firefox"
        : /Chrome\//u.test(agent)
          ? "Chrome"
          : /Safari\//u.test(agent)
            ? "Safari"
            : "其他",
    device: /iPad|Tablet/iu.test(agent)
      ? "平板"
      : /Mobile|Android|iPhone/iu.test(agent)
        ? "手机"
        : "电脑",
  };
}

export function createConsoleServer(options: ServerOptions) {
  const resolveSiteFile = options.siteDirectory
    ? createSiteFileResolver(options.siteDirectory, [
        path.dirname(options.store.filename),
        options.adminDirectory,
        ...(options.keyFile ? [path.dirname(options.keyFile)] : []),
      ])
    : undefined;
  const publicFile = async (relativeFile: string): Promise<string> => {
    try {
      if (!resolveSiteFile) throw new Error("未配置公开目录");
      return await resolveSiteFile(relativeFile);
    } catch {
      throw new HttpError(503, "公开资料目录不可用");
    }
  };
  const { store, geo } = options;
  const now = options.now ?? Date.now;
  const publicOrigin = new URL(options.origin);
  if (
    publicOrigin.origin !== options.origin ||
    (publicOrigin.protocol !== "https:" &&
      !(
        options.devStatic &&
        ["127.0.0.1", "localhost"].includes(publicOrigin.hostname)
      ))
  )
    throw new Error("生产管理入口必须为 HTTPS Origin");
  if (options.devStatic && options.trustedProxy)
    throw new Error("本地预览不接受代理身份");
  const account = (): Account => {
    const current = store.get<Account>("account", "admin");
    if (!current) throw new Error("请先初始化管理员");
    return current;
  };
  const accountVersion = (value: Account): string =>
    value.version ?? store.vault.tag("account-version", value.passwordHash);
  const sessionResponse = (
    session: Pick<Session, "username" | "csrf" | "createdAt">,
    time: number,
  ): { username: string; csrf: string; absoluteRemainingMs: number } => ({
    username: session.username,
    csrf: session.csrf,
    absoluteRemainingMs: Math.max(0, 8 * 3600000 - (time - session.createdAt)),
  });
  account();
  const bootTime = performance.now();
  let loginBusy = 0;
  let inflight = 0;
  const sessionFor = (
    request: IncomingMessage,
  ): { id: string; value: Session } => {
    const cookies = String(request.headers.cookie ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.startsWith(`${COOKIE}=`));
    if (cookies.length !== 1) throw new HttpError(401, "请先登录管理后台");
    const token = cookies[0].slice(COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token))
      throw new HttpError(401, "请重新登录");
    const id = store.vault.tag("session", token);
    const value = store.get<Session>("sessions", id);
    const time = now();
    if (
      !value ||
      value.accountVersion !== accountVersion(account()) ||
      time < value.createdAt ||
      time < value.touchedAt ||
      time - value.createdAt >= 8 * 3600000 ||
      time - value.touchedAt >= 30 * 60000
    ) {
      store.remove("sessions", id);
      throw new HttpError(401, "登录已过期，请重新登录");
    }
    if (time > value.touchedAt)
      store.put("sessions", id, { ...value, touchedAt: time }, time);
    return { id, value };
  };
  const sameOrigin = (request: IncomingMessage): void => {
    if (
      request.headers.origin !== options.origin ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      throw new HttpError(403, "请从本站页面提交");
  };
  const setCookie = (
    response: ServerResponse,
    token: string,
    seconds: number,
  ): void => {
    response.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Max-Age=${seconds}${publicOrigin.protocol === "https:" ? "; Secure" : ""}`,
    );
  };
  const sendFile = async (
    response: ServerResponse,
    filename: string,
  ): Promise<void> => {
    const data = await readFile(filename);
    response.writeHead(200, {
      "Content-Type":
        MIME[path.extname(filename)] ?? "application/octet-stream",
    });
    response.end(data);
  };
  const server = createServer((request, response) => {
    headers(response);
    if (++inflight > 32) {
      inflight--;
      reply(response, 503, null, "服务繁忙，请稍后重试");
      return;
    }
    void (async () => {
      let route: URL;
      try {
        route = new URL(request.url ?? "/", options.origin);
      } catch {
        throw new HttpError(400, "请求路径不正确");
      }
      const method = request.method ?? "GET";
      if (method === "GET" && ["/admin", "/admin/"].includes(route.pathname))
        return sendFile(
          response,
          path.join(options.adminDirectory, "index.html"),
        );
      if (
        method === "GET" &&
        ["/admin/admin.js", "/admin/admin.css"].includes(route.pathname)
      )
        return sendFile(
          response,
          path.join(options.adminDirectory, path.basename(route.pathname)),
        );
      if (options.devStatic && method === "GET" && options.siteDirectory) {
        let name = route.pathname === "/" ? "/index.html" : route.pathname;
        try {
          name = decodeURIComponent(name);
        } catch {
          throw new HttpError(400, "页面路径不正确");
        }
        // 本地预览也只服务发行包中的明确文件，绝不暴露源码或状态目录。
        if (
          PUBLIC_PAGES.has(name) ||
          /^\/(?:app\.(?:css|js)|data\.js|styles\/[a-z-]+\.css|assets\/[a-z-]+\.js|assets\/(?:avatars|posters|group-visuals|profile-covers|weibo-api-avatar-candidates|weibo-avatars|weibo-cached-visuals|event-posters)\/[a-zA-Z0-9.-]+\.(?:png|jpe?g|webp|svg))$/u.test(
            name,
          )
        )
          return sendFile(response, await publicFile(name.slice(1)));
      }
      if (!route.pathname.startsWith("/api/v1/"))
        throw new HttpError(404, "页面不存在");
      const ip = requestIp(request, options.trustedProxy);
      if (
        !store.allow("api-global", "all", 1200, 60000, now()) ||
        !store.allow("api-ip", ip, 180, 60000, now())
      )
        throw new HttpError(429, "请求过于频繁，请稍后再试");
      if (method === "GET" && route.pathname === "/api/v1/public-config") {
        const settings = store.settings();
        return reply(response, 200, {
          ...settings,
          retentionDays: RETENTION_DAYS,
        });
      }
      if (method === "POST" && route.pathname === "/api/v1/feedback") {
        sameOrigin(request);
        if (!store.settings().acceptFeedback)
          throw new HttpError(503, "暂时暂停接收投稿，请使用邮件联系");
        const input = feedbackInput(await readJson(request));
        if (input.website) throw new HttpError(400, "提交未通过校验");
        if (!store.allow("feedback", ip, 6, 3600000, now()))
          throw new HttpError(429, "本小时提交较多，请稍后再试");
        const saved = store.createFeedback(input, ip, now());
        return reply(
          response,
          201,
          { id: saved.id, createdAt: saved.createdAt },
          "已收到，内容仅供管理员核查",
        );
      }
      if (method === "POST" && route.pathname === "/api/v1/pageviews") {
        sameOrigin(request);
        const userAgent = String(request.headers["user-agent"] ?? "").slice(
          0,
          500,
        );
        if (
          request.headers.dnt === "1" ||
          /bot|spider|crawl|headless|monitor|uptime/iu.test(userAgent) ||
          !store.settings().analyticsEnabled
        )
          return reply(response, 200, { recorded: false });
        if (!store.allow("pageviews", ip, 60, 60000, now()))
          throw new HttpError(429, "访问记录过于频繁");
        const data = object(await readJson(request));
        const rawPath = textField(data.path, 200, true);
        const parsedPath = new URL(rawPath, options.origin);
        const pathname = parsedPath.pathname;
        if (
          !rawPath.startsWith("/") ||
          rawPath.startsWith("//") ||
          rawPath.includes("\\") ||
          /[\r\n\t]/u.test(rawPath) ||
          parsedPath.origin !== options.origin ||
          !PUBLIC_PAGES.has(pathname)
        )
          throw new HttpError(400, "访问页面不在统计范围内");
        const eventId = textField(data.id, 36, true);
        if (
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
            eventId,
          )
        )
          throw new HttpError(400, "访问编号不正确");
        let referrer = "直接访问";
        if (
          typeof data.referrer === "string" &&
          data.referrer.length <= 2000 &&
          data.referrer
        ) {
          try {
            const from = new URL(data.referrer);
            if (["https:", "http:"].includes(from.protocol))
              referrer = from.hostname;
          } catch {
            /* 不保存无效来源。 */
          }
        }
        const info = browserInfo(userAgent);
        const visit: Visit = {
          id: store.vault.tag("event", `${ip}/${eventId}`),
          createdAt: now(),
          ip,
          path: pathname,
          referrer,
          ...info,
          ...(await geo.locate(ip)),
        };
        store.addVisit(visit, `${info.browser}/${info.device}`);
        return reply(response, 200, { recorded: true });
      }
      if (method === "POST" && route.pathname === "/api/v1/admin/login") {
        sameOrigin(request);
        if (
          !store.allow("login-ip", ip, 8, 15 * 60000, now()) ||
          !store.allow("login-global", "admin", 30, 15 * 60000, now())
        )
          throw new HttpError(429, "登录尝试过多，请 15 分钟后再试");
        if (loginBusy >= 2)
          throw new HttpError(503, "登录服务繁忙，请稍后重试");
        // 在读取请求体之前占用槽位，慢请求也不能绕过并发密码计算上限。
        loginBusy++;
        try {
          const data = object(await readJson(request));
          const username = textField(data.username, 64, true);
          const password =
            typeof data.password === "string" && data.password.length <= 256
              ? data.password
              : "";
          const current = account();
          const valid = await verifyPassword(password, current.passwordHash);
          if (!valid || !constantMatch(username, current.username)) {
            store.audit("登录失败", "", "未登录", now());
            throw new HttpError(401, "账号或密码不正确");
          }
          const token = randomBytes(32).toString("base64url");
          const csrf = randomBytes(24).toString("base64url");
          const time = now();
          store.transaction(() => {
            if (accountVersion(current) !== accountVersion(account()))
              throw new HttpError(401, "身份状态已变更，请重新登录");
            store.put(
              "sessions",
              store.vault.tag("session", token),
              {
                username,
                csrf,
                createdAt: time,
                touchedAt: time,
                accountVersion: accountVersion(current),
              } satisfies Session,
              time,
            );
            store.audit("管理员登录", "", username, time);
          });
          setCookie(response, token, 8 * 3600);
          return reply(
            response,
            200,
            sessionResponse({ username, csrf, createdAt: time }, now()),
          );
        } finally {
          loginBusy--;
        }
      }
      if (!route.pathname.startsWith("/api/v1/admin/"))
        throw new HttpError(404, "接口不存在");
      const session = sessionFor(request);
      const stillAuthorized = (): void => {
        sessionFor(request);
      };
      const readAdminJson = async (): Promise<Record<string, unknown>> => {
        const data = object(await readJson(request));
        stillAuthorized();
        return data;
      };
      if (!["GET", "HEAD"].includes(method)) {
        sameOrigin(request);
        const csrf = request.headers["x-csrf-token"];
        if (
          typeof csrf !== "string" ||
          !constantMatch(csrf, session.value.csrf)
        )
          throw new HttpError(403, "操作校验失败，请刷新后重试");
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/session")
        return reply(response, 200, sessionResponse(session.value, now()));
      if (method === "POST" && route.pathname === "/api/v1/admin/logout") {
        store.remove("sessions", session.id);
        setCookie(response, "", 0);
        return reply(response, 200);
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/dashboard") {
        const days = Number(route.searchParams.get("days") ?? 30);
        if (![7, 30, 90].includes(days))
          throw new HttpError(400, "请选择 7、30 或 90 天");
        return reply(response, 200, store.dashboard(days, now()));
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/feedback") {
        const status = route.searchParams.get("status") ?? "";
        if (status && !feedbackStatuses.includes(status as FeedbackStatus))
          throw new HttpError(400, "处理状态不正确");
        return reply(
          response,
          200,
          store.feedbackPage(
            positivePage(route.searchParams.get("page")),
            status,
          ),
        );
      }
      const reviewId = /^\/api\/v1\/admin\/feedback\/([a-f0-9]{24})$/u.exec(
        route.pathname,
      )?.[1];
      if (method === "PATCH" && reviewId) {
        const data = await readAdminJson();
        if (!feedbackStatuses.includes(data.status as FeedbackStatus))
          throw new HttpError(400, "处理状态不正确");
        const saved = store.reviewFeedback(
          reviewId,
          data.status as FeedbackStatus,
          textField(data.note, 2000),
          session.value.username,
          now(),
          stillAuthorized,
        );
        if (!saved) throw new HttpError(404, "反馈不存在");
        return reply(response, 200, saved);
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/visits")
        return reply(
          response,
          200,
          store.visitsPage(positivePage(route.searchParams.get("page")), now()),
        );
      if (method === "GET" && route.pathname === "/api/v1/admin/audit") {
        const page = positivePage(route.searchParams.get("page"));
        return reply(response, 200, store.recordPage("audit", page, 50));
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/settings")
        return reply(response, 200, store.settings());
      if (method === "PATCH" && route.pathname === "/api/v1/admin/settings") {
        const data = await readAdminJson();
        if (
          typeof data.acceptFeedback !== "boolean" ||
          typeof data.analyticsEnabled !== "boolean"
        )
          throw new HttpError(400, "设置格式不正确");
        const settings: ConsoleSettings = {
          acceptFeedback: data.acceptFeedback,
          analyticsEnabled: data.analyticsEnabled,
          feedbackNotice: textField(data.feedbackNotice, 300),
        };
        store.transaction(() => {
          stillAuthorized();
          store.put("settings", "main", settings, now());
          store.audit("更新接收与统计设置", "", session.value.username, now());
        });
        return reply(response, 200, settings);
      }
      if (method === "POST" && route.pathname === "/api/v1/admin/password") {
        const data = await readAdminJson();
        if (!store.allow("password", session.id, 3, 15 * 60000, now()))
          throw new HttpError(429, "操作过于频繁");
        if (loginBusy >= 2)
          throw new HttpError(503, "登录服务繁忙，请稍后重试");
        loginBusy++;
        try {
          const current = account();
          if (
            typeof data.currentPassword !== "string" ||
            !(await verifyPassword(data.currentPassword, current.passwordHash))
          )
            throw new HttpError(400, "当前密码不正确");
          const newPassword =
            typeof data.newPassword === "string" ? data.newPassword : "";
          if (newPassword.length < 14 || newPassword.length > 256)
            throw new HttpError(400, "新密码须为 14 至 256 个字符");
          stillAuthorized();
          const passwordHash = await hashPassword(newPassword);
          store.transaction(() => {
            stillAuthorized();
            if (accountVersion(current) !== accountVersion(account()))
              throw new HttpError(401, "身份状态已变更，请重新登录");
            store.put(
              "account",
              "admin",
              { ...current, passwordHash, version: randomUUID() },
              now(),
            );
            store.db
              .prepare("DELETE FROM records WHERE bucket='sessions'")
              .run();
            store.audit("修改密码并退出全部会话", "", current.username, now());
          });
          setCookie(response, "", 0);
          return reply(response, 200);
        } finally {
          loginBusy--;
        }
      }
      if (method === "POST" && route.pathname === "/api/v1/admin/logout-all") {
        store.transaction(() => {
          store.put(
            "account",
            "admin",
            { ...account(), version: randomUUID() },
            now(),
          );
          store.db.prepare("DELETE FROM records WHERE bucket='sessions'").run();
          store.audit("退出全部会话", "", session.value.username, now());
        });
        setCookie(response, "", 0);
        return reply(response, 200);
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/system") {
        const database = await stat(store.filename);
        let siteAvailable = false;
        if (options.siteDirectory) {
          try {
            siteAvailable = (
              await stat(await publicFile("index.html"))
            ).isFile();
          } catch {
            /* 公开档案不可读时明确显示。 */
          }
        }
        stillAuthorized();
        return reply(response, 200, {
          version: "1.0.0",
          uptimeSeconds: Math.floor((performance.now() - bootTime) / 1000),
          encryption: "AES-256-GCM",
          retentionDays: RETENTION_DAYS,
          geoReady: geo.ready,
          databaseBytes: database.size,
          siteAvailable,
          lastCleanup: store.get<number>("meta", "last-cleanup") ?? 0,
          username: account().username,
        });
      }
      if (method === "GET" && route.pathname === "/api/v1/admin/catalog") {
        if (!options.siteDirectory)
          throw new HttpError(503, "公开资料目录不可用");
        const source = await readFile(
          await publicFile("assets/groups-data.js"),
          "utf8",
        );
        const match = /^\s*window\.([A-Z_]+)\s*=\s*([\s\S]+?);?\s*$/u.exec(
          source,
        );
        if (!match) throw new HttpError(503, "公开资料格式暂不支持");
        let catalog: unknown;
        try {
          catalog = JSON.parse(match[2].replace(/;\s*$/u, ""));
        } catch {
          throw new HttpError(503, "公开资料暂不可读");
        }
        stillAuthorized();
        return reply(response, 200, catalog);
      }
      throw new HttpError(404, "接口不存在");
    })()
      .catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        if (error instanceof HttpError) {
          if (error.status === 429) response.setHeader("Retry-After", "60");
          if ([408, 413, 415].includes(error.status))
            response.setHeader("Connection", "close");
          reply(response, error.status, null, error.message);
        } else {
          const incident = randomUUID().slice(0, 8);
          console.error(`管理服务请求失败，编号 ${incident}`);
          reply(response, 500, null, `暂时无法完成，请稍后重试（${incident}）`);
        }
      })
      .finally(() => {
        inflight--;
      });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  return server;
}

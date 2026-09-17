import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const evidenceRoot = path.join(repository, "reports/console-security");
const sourceRoot = process.env.CONSOLE_SECURITY_SOURCE_ROOT;
if (!sourceRoot)
  throw new Error(
    "请通过 security-tests/run.mjs 执行，确保源码摘要与独立快照一致",
  );
export const modules = await Promise.all(
  ["store", "crypto", "server", "validation", "security"].map(
    (name) =>
      import(
        pathToFileURL(path.join(sourceRoot, `maintenance/console/${name}.ts`))
          .href
      ),
  ),
);
export const [storage, crypto, serverModule, validation, security] = modules;
export const ORIGIN = "https://console-security.invalid";
export const PASSWORD = "仅用于合成安全测试的长密码-20260917";
export const NEW_PASSWORD = "仅用于合成安全测试的新密码-20260917";
export const NOW = Date.UTC(2026, 8, 17, 8);
const passwordHash = crypto.hashPassword(PASSWORD);

export function removeFixture(directory) {
  const absolute = path.resolve(directory);
  const allowed = path.resolve(evidenceRoot, "work");
  const relative = path.relative(allowed, absolute);
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    "只能删除本验收创建的临时目录",
  );
  rmSync(absolute, { recursive: true, force: true });
}

export async function fixture(t, options = {}) {
  const base = path.join(evidenceRoot, "work", "fixtures");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, "synthetic-"));
  const dataDirectory = path.join(directory, "private");
  const key = randomBytes(32);
  const store = new storage.ConsoleStore(dataDirectory, key);
  let clock = options.now ?? NOW;
  const account = {
    username: "security_test_admin",
    passwordHash: await passwordHash,
    version: randomUUID(),
  };
  store.put("account", "admin", account, clock);
  const prepared = options.prepare?.({ directory, dataDirectory, key }) ?? {};
  const app = serverModule.createConsoleServer({
    store,
    origin: ORIGIN,
    trustedProxy: options.trustedProxy ?? true,
    adminDirectory: path.join(directory, "public"),
    geo: {
      ready: false,
      locate: async () => ({
        country: "测试国家",
        province: "测试省",
        city: "测试市",
      }),
      close() {},
    },
    now: () => clock,
    ...(prepared.serverOptions ?? {}),
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const port = app.address().port;
  t.after(async () => {
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
    store.close();
    removeFixture(directory);
  });
  const api = (pathname, options = {}) => request(port, pathname, options);
  return {
    directory,
    dataDirectory,
    key,
    store,
    app,
    port,
    account,
    prepared,
    api,
    setTime(value) {
      clock = value;
    },
  };
}

export function request(port, pathname, options = {}) {
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers = {
    Origin: ORIGIN,
    "X-Console-Client-IP": "192.0.2.231",
    "Content-Type": "application/json",
    "User-Agent": "Security-acceptance/1 Chrome/120",
    ...(body === undefined
      ? {}
      : { "Content-Length": Buffer.byteLength(body) }),
    ...options.headers,
  };
  for (const name of Object.keys(headers))
    if (headers[name] === null) delete headers[name];
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: options.method ?? "GET",
        headers,
        agent: false,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload;
          try {
            payload = JSON.parse(text);
          } catch {
            payload = null;
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            payload,
          });
        });
      },
    );
    outgoing.setTimeout(12000, () =>
      outgoing.destroy(new Error("合成请求超时")),
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

export async function login(f, ip = "192.0.2.231") {
  const result = await f.api("/api/v1/admin/login", {
    method: "POST",
    headers: { "X-Console-Client-IP": ip },
    body: { username: f.account.username, password: PASSWORD },
  });
  assert.equal(result.status, 200, "合成管理员应可登录");
  const cookie = result.headers["set-cookie"][0].split(";")[0];
  return {
    cookie,
    csrf: result.payload.data.csrf,
    headers: { Cookie: cookie, "X-CSRF-Token": result.payload.data.csrf },
    result,
  };
}

export function feedback(overrides = {}) {
  return {
    kind: "feedback",
    target: "安全验收-合成私人目标",
    source: "https://example.invalid/public",
    details: "安全验收-合成私人正文-SECURITY-SENTINEL",
    contact: "security-sentinel@example.invalid",
    consent: true,
    website: "",
    requestId: randomUUID(),
    ...overrides,
  };
}

/** 先让真实服务器读到部分正文，再由测试决定补齐时机。 */
export function delayedBody(f, pathname, body, headers, method = "PATCH") {
  const serialized = JSON.stringify(body);
  let outgoing;
  let observed;
  const received = new Promise((resolve) => {
    observed = (incoming) => {
      if (
        incoming.url === pathname &&
        incoming.headers["x-security-case"] === "delayed-body"
      ) {
        f.app.off("request", observed);
        // 服务端主监听器已经同步运行至 readJson 的 await。
        resolve();
      }
    };
    f.app.on("request", observed);
  });
  const completed = new Promise((resolve, reject) => {
    outgoing = httpRequest(
      {
        hostname: "127.0.0.1",
        port: f.port,
        path: pathname,
        method,
        agent: false,
        headers: {
          Origin: ORIGIN,
          "X-Console-Client-IP": "192.0.2.231",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized),
          "X-Security-Case": "delayed-body",
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.setTimeout(12000, () =>
      outgoing.destroy(new Error("分段请求超时")),
    );
    outgoing.write(serialized.slice(0, 1));
  });
  return {
    received,
    completed,
    finish() {
      outgoing.end(serialized.slice(1));
    },
    abort() {
      f.app.off("request", observed);
      outgoing.destroy();
    },
  };
}

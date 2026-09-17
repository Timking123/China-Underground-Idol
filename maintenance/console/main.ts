import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { ConsoleStore, type Account } from "./store.ts";
import { hashPassword } from "./crypto.ts";
import { createConsoleServer } from "./server.ts";
import { createGeoLocator } from "./geo.ts";
import {
  assertStorageIsolation,
  privateDirectory,
  privateFile,
} from "./security.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "data-dir": { type: "string" },
    "key-file": { type: "string" },
    "site-dir": { type: "string" },
    "admin-dir": { type: "string", default: ".build/console/public" },
    "geo-dir": { type: "string" },
    origin: { type: "string" },
    port: { type: "string", default: "8788" },
    username: { type: "string", default: "admin" },
    dev: { type: "boolean", default: false },
  },
});
function absolute(name: "data-dir" | "key-file"): string {
  const value = values[name];
  if (!value) throw new Error(`缺少 --${name}`);
  return path.resolve(value);
}
async function password(): Promise<string> {
  const fromEnvironment = process.env.IDOL_ADMIN_PASSWORD;
  delete process.env.IDOL_ADMIN_PASSWORD;
  if (fromEnvironment) return fromEnvironment;
  if (!process.stdin.isTTY)
    throw new Error("请在终端交互初始化管理员，或从受保护环境注入初始化密码");
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  try {
    process.stdout.write("管理员密码（至少 14 字符，输入隐藏）：");
    const first = await terminal.question("");
    process.stdout.write("\n再次输入：");
    const second = await terminal.question("");
    process.stdout.write("\n");
    if (first !== second) throw new Error("两次密码不一致");
    return first;
  } finally {
    terminal.close();
  }
}
async function main(): Promise<void> {
  process.umask(0o077);
  if (positionals.length !== 1 || !["init", "serve"].includes(positionals[0]))
    throw new Error("请使用 init 或 serve");
  const dataDirectory = absolute("data-dir");
  const keyFile = absolute("key-file");
  const adminDirectory = path.resolve(values["admin-dir"]!);
  const siteDirectory = values["site-dir"]
    ? path.resolve(values["site-dir"])
    : undefined;
  assertStorageIsolation(dataDirectory, keyFile, [
    adminDirectory,
    ...(siteDirectory ? [siteDirectory] : []),
  ]);
  privateDirectory(dataDirectory);
  privateDirectory(path.dirname(keyFile));
  if (positionals[0] === "init") {
    const username = values.username!;
    if (!/^[a-zA-Z0-9_.-]{3,64}$/u.test(username))
      throw new Error(
        "管理员账号须为 3 至 64 位字母、数字、点、下划线或连字符",
      );
    const passwordHash = await hashPassword(await password());
    // 保留失败时已创建的密钥，重试用原密钥恢复；有数据而无密钥时绝不生成替代品。
    if (!existsSync(keyFile)) {
      const database = path.join(dataDirectory, "console.sqlite");
      if (existsSync(database) && statSync(database).size > 0)
        throw new Error("已有数据库缺少原始密钥");
      writeFileSync(keyFile, randomBytes(32), { flag: "wx", mode: 0o600 });
    }
    privateFile(keyFile);
    const store = new ConsoleStore(dataDirectory, readFileSync(keyFile));
    try {
      store.transaction(() => {
        if (store.get("account", "admin")) throw new Error("管理员已初始化");
        store.put(
          "account",
          "admin",
          { username, passwordHash } satisfies Account,
          Date.now(),
        );
        store.audit("初始化管理员", "", username, Date.now());
      });
      console.log("管理员已建立；密钥与数据库独立保存。");
    } finally {
      store.close();
    }
    return;
  }
  if (positionals[0] !== "serve") throw new Error("请使用 init 或 serve");
  privateFile(keyFile);
  if (!values.origin) throw new Error("缺少 --origin");
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("端口须在 1024 至 65535 之间");
  const store = new ConsoleStore(dataDirectory, readFileSync(keyFile));
  let geo: ReturnType<typeof createGeoLocator> | undefined;
  try {
    geo = createGeoLocator(values["geo-dir"]);
    store.cleanup(Date.now());
    const server = createConsoleServer({
      store,
      geo,
      origin: values.origin,
      trustedProxy: !values.dev,
      devStatic: values.dev,
      adminDirectory,
      siteDirectory,
      keyFile,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const cleanup = setInterval(() => {
      try {
        store.cleanup(Date.now());
      } catch {
        console.error("管理数据定期清理失败，请检查存储状态");
      }
    }, 3600000);
    cleanup.unref();
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      clearInterval(cleanup);
      const force = setTimeout(() => server.closeAllConnections(), 10000);
      force.unref();
      server.close(() => {
        clearTimeout(force);
        geo?.close();
        store.close();
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(
      `管理服务已监听本机端口 ${port}；IP 地区库${geo.ready ? "可用" : "未配置"}。`,
    );
  } catch (error) {
    geo?.close();
    store.close();
    throw error;
  }
}
main().catch(() => {
  console.error(
    "管理服务未能启动：请核对参数、管理员初始化、独立密钥及目录权限。为避免泄露，不输出请求或凭据内容。",
  );
  process.exitCode = 1;
});

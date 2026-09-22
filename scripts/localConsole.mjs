import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEditorialRuntime } from "../maintenance/localEditorial.mjs";

// 每次创建新的合成私人库；仅使用真实公开文件，不读取生产私有状态。
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.argv[2] ?? 8796);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("本地端口无效");
const parent = path.join(root, "reports/city-upgrade-f/local-console");
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "session-"));
const runtime = await loadLocalEditorialRuntime(root);
const key = randomBytes(32);
const password = randomBytes(24).toString("base64url");
const username = "local-review-admin";
const store = new runtime.ConsoleStore(path.join(directory, "state"), key);
store.put(
  "account",
  "admin",
  { username, passwordHash: await runtime.hashPassword(password) },
  Date.now(),
);
await writeFile(path.join(directory, "synthetic.key"), key, {
  mode: 0o600,
  flag: "wx",
});
await writeFile(
  path.join(directory, "access.json"),
  `${JSON.stringify({ synthetic: true, username, password, state: path.join(directory, "state"), key: path.join(directory, "synthetic.key"), url: `http://127.0.0.1:${port}/admin/` }, null, 2)}\n`,
  { mode: 0o600, flag: "wx" },
);
const server = runtime.createConsoleServer({
  store,
  origin: `http://127.0.0.1:${port}`,
  trustedProxy: false,
  devStatic: true,
  adminDirectory: path.join(root, ".build/console/public"),
  siteDirectory: path.join(root, ".build/site"),
  geo: {
    ready: false,
    async locate() {
      return { country: "未知", province: "未知", city: "未知" };
    },
    close() {},
  },
});
server.listen(port, "127.0.0.1", async () => {
  await writeFile(
    path.join(parent, "current.json"),
    `${JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${port}/admin/`, directory, accessFile: path.join(directory, "access.json") }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `本机合成后台：http://127.0.0.1:${port}/admin/；仅本地凭据见 ${path.join(directory, "access.json")}`,
  );
});
process.once("SIGINT", () => server.close(() => store.close()));
process.once("SIGTERM", () => server.close(() => store.close()));

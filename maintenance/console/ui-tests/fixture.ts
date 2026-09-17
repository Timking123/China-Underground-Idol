import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConsoleStore } from "../store.ts";
import { hashPassword } from "../crypto.ts";
import { createConsoleServer } from "../server.ts";

// 仅本地验收入口：不打包进发行物，不读取生产状态或凭据。
const directory = path.resolve("reports/console-ui");
const state = await mkdtemp(path.join(directory, "state-"));
const key = randomBytes(32);
const store = new ConsoleStore(state, key);
const username = "ui-fixture-admin";
const password = process.env.IDOL_UI_FIXTURE_PASSWORD;
if (!password)
  throw new Error("请通过 IDOL_UI_FIXTURE_PASSWORD 注入一次性合成测试密码");
await mkdir(path.join(directory, "keys"), { recursive: true });
await writeFile(
  path.join(directory, "keys", `${path.basename(state)}.key`),
  key,
  { mode: 0o600 },
);
const now = Date.now();
store.put(
  "account",
  "admin",
  { username, passwordHash: await hashPassword(password) },
  now,
);
for (let index = 0; index < 31; index++) {
  const entry = store.createFeedback(
    {
      kind: index % 2 ? "submission" : "feedback",
      target: `合成档案 ${String(index + 1).padStart(2, "0")}`,
      source: "https://example.com/source",
      details:
        "合成验收资料：演出信息需要核对。<img src=x onerror=alert(1)> 这段标签必须按普通文字显示。",
      contact: "fixture@example.invalid",
      consent: true,
      website: "",
      requestId: randomUUID(),
    },
    "192.0.2.10",
    now - index * 60000,
  );
  if (index > 26)
    store.reviewFeedback(entry.id, "resolved", "合成核查结果", username, now);
}
const provinces = ["广东省", "上海市", "浙江省", "北京市", "四川省", "未知"];
for (let day = 29; day >= 0; day--)
  for (let i = 0; i < 5 + ((day * 11) % 31); i++) {
    store.addVisit(
      {
        id: randomUUID(),
        createdAt: now - day * 86400000 - i * 1000,
        ip: i % 4 ? `192.0.2.${i + 1}` : "2001:db8::10",
        path: i % 2 ? "/groups.html" : "/discover.html",
        referrer: "example.invalid",
        browser: "Chrome",
        device: "电脑",
        country: i % 11 ? "中国" : "海外",
        province: provinces[i % provinces.length],
        city: "未知",
      },
      "Chrome/电脑",
    );
  }
store.cleanup(now);
const site = path.join(directory, "site");
await mkdir(path.join(site, "assets"), { recursive: true });
await writeFile(
  path.join(site, "index.html"),
  "<!doctype html><html lang=zh-CN><title>合成公开网站</title><p>本机验收合成页面</p></html>",
  "utf8",
);
const groups = Array.from({ length: 58 }, (_, index) => ({
  id: `g${String(index + 1).padStart(3, "0")}`,
  name: `合成团体 ${String(index + 1).padStart(2, "0")}`,
  status: "活动中",
  activity: { province: "广东省", city: "广州" },
  styleLabel: "合成",
}));
await writeFile(
  path.join(site, "assets/groups-data.js"),
  `window.GROUPS_DATA = ${JSON.stringify({ groups })};`,
  "utf8",
);
const server = createConsoleServer({
  store,
  origin: "http://127.0.0.1:8791",
  trustedProxy: false,
  devStatic: true,
  adminDirectory: path.join(directory, "public"),
  siteDirectory: site,
  geo: {
    ready: false,
    async locate() {
      return { country: "未知", province: "未知", city: "未知" };
    },
    close() {},
  },
});
server.listen(8791, "127.0.0.1", () =>
  console.log(
    "合成验收服务已启动 http://127.0.0.1:8791/admin/（不含生产资料）",
  ),
);
process.once("SIGINT", () => server.close(() => store.close()));
process.once("SIGTERM", () => server.close(() => store.close()));

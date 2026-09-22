import { mkdirSync, writeFileSync, chownSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ConsoleStore } from "../console/store.ts";

// 仅容器合成夹具。不得在真实服务器调用此文件。
if (process.env.IDOL_SYNTHETIC_CONTAINER !== "migration-20260923") throw new Error("synthetic_container_required");
process.umask(0o077);
mkdirSync("/etc/idol-console", { recursive: true, mode: 0o700 });
const key = randomBytes(32);
writeFileSync("/etc/idol-console/master.key", key, { flag: "wx", mode: 0o600 });
const store = new ConsoleStore("/var/lib/idol-console", key);
store.put("account", "admin", { username: "synthetic", passwordHash: "synthetic" }, Date.now());
store.put("editorial-revisions", "synthetic-revision", { status: "draft" }, Date.now());
store.close();
chownSync("/etc/idol-console", 993, 993);
chownSync("/etc/idol-console/master.key", 993, 993);

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConsoleStore } from "../console/store.ts";
import {
  assertStorageIsolation,
  privateReadFile,
} from "../console/security.ts";

/** 独立离线核验入口，不加载 HTTP 服务、不创建 key/账户、不修改原始时间。 */
function main(): void {
  process.umask(0o077);
  const { values } = parseArgs({
    options: { "data-dir": { type: "string" }, "key-file": { type: "string" } },
  });
  if (!values["data-dir"] || !values["key-file"])
    throw new Error("missing_paths");
  const directory = path.resolve(values["data-dir"]),
    key = path.resolve(values["key-file"]);
  assertStorageIsolation(directory, key, []);
  privateReadFile(key);
  const store = new ConsoleStore(directory, readFileSync(key), {
    readOnly: true,
  });
  try {
    const rows = store.db.prepare("PRAGMA integrity_check").all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok")
      throw new Error("integrity_failed");
    let records = 0,
      visits = 0;
    for (const row of store.db
      .prepare("SELECT bucket,id,payload FROM records")
      .iterate()) {
      store.vault.open(
        `${String(row.bucket)}/${String(row.id)}`,
        String(row.payload),
      );
      records++;
    }
    for (const row of store.db
      .prepare("SELECT id,payload FROM visits")
      .iterate()) {
      store.vault.open(`visits/${String(row.id)}`, String(row.payload));
      visits++;
    }
    console.log(
      JSON.stringify({
        status: "verified",
        records,
        visits,
        initialized: false,
      }),
    );
  } finally {
    store.close();
  }
}

try {
  main();
} catch {
  console.error("database_or_original_key_invalid");
  process.exitCode = 1;
}

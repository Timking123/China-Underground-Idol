import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOptional, safeFailure, writeOnce } from "../server/state.ts";

test("运行意图落盘后拒绝覆盖，读回保留原始状态", async () => {
  const root = await mkdtemp(join(tmpdir(), "idol-state-"));
  const file = join(root, "run", "attempt.json");
  assert.equal(await readOptional(file), null);
  await writeOnce(file, { runId: "daily-2026-09-10", status: "started" });
  await assert.rejects(writeOnce(file, { status: "complete" }), /EEXIST/);
  assert.equal((await readOptional(file)).status, "started");
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).runId,
    "daily-2026-09-10",
  );
});
test("异常凭据形态不进入错误码", () => {
  assert.equal(
    safeFailure(new Error("authorization: Bearer PRIVATE")),
    "maintenance_failure",
  );
  assert.equal(
    safeFailure(new Error("weekly_price_login_required")),
    "weekly_price_login_required",
  );
});
test(
  "运行记录拒绝软链接跳转",
  {
    skip:
      process.platform === "win32"
        ? "Windows创建软链接需要独立权限；在服务器Linux验证"
        : false,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "idol-state-link-"));
    await writeOnce(join(root, "target.json"), { x: 1 });
    await symlink(join(root, "target.json"), join(root, "link.json"));
    await assert.rejects(
      readOptional(join(root, "link.json")),
      /symbolic_link/,
    );
  },
);

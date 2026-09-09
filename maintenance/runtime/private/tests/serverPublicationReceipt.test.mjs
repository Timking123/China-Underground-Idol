import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { consumePublication } from "../server/publicationReceipt.ts";
import { writeOnce, readOptional } from "../server/state.ts";
import { sha256 } from "../src/sourceCapture.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "idol-consume-"));
  const state = join(root, "state"),
    receipts = join(root, "receipts");
  const pending = {
    release: "auto-2026-09-10-abcdef123456",
    runId: "daily-2026-09-10",
    newSha: "a".repeat(40),
    manifestSha256: "b".repeat(64),
  };
  const file = join(state, "publish/pending.json");
  await writeOnce(file, pending);
  const receipt = {
    schemaVersion: "idol-publication-receipt-v1",
    status: "published",
    ...pending,
    requestSha256: sha256(await readFile(file)),
  };
  return { state, receipts, file, pending, receipt };
}
test("仅成功且hash匹配的root回执可以消费pending", async () => {
  const f = await fixture();
  await writeOnce(join(f.receipts, `${f.pending.release}.json`), f.receipt);
  assert.equal(
    (await consumePublication(f.state, f.receipts)).status,
    "published",
  );
  assert.equal(await readOptional(f.file), null);
  assert.equal((await consumePublication(f.state, f.receipts)).status, "noop");
});
test("回滚或别的请求hash都不删除pending", async () => {
  for (const change of [
    { status: "rolled_back" },
    { requestSha256: "0".repeat(64) },
  ]) {
    const f = await fixture();
    await writeOnce(join(f.receipts, `${f.pending.release}.json`), {
      ...f.receipt,
      ...change,
    });
    await assert.rejects(
      consumePublication(f.state, f.receipts),
      /not_confirmed/,
    );
    assert.ok(await readOptional(f.file));
  }
});

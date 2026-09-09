import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "../src/sourceCapture.ts";
import { requireState } from "../src/sourceRegistry.ts";
import { readOptional, regularPath, writeOnce } from "./state.ts";

/** 仅消费与root发布回执逐字节绑定的pending；失败或未知结果保留供人工处理。 */
export async function consumePublication(
  stateRoot: string,
  receiptRoot: string,
) {
  const pendingPath = resolve(stateRoot, "publish/pending.json");
  const pending = await readOptional(pendingPath);
  if (!pending) return { status: "noop" };
  requireState(
    typeof pending.release === "string" &&
      /^auto-[a-z0-9-]{1,90}$/u.test(pending.release),
    "publication_release_invalid",
  );
  await regularPath(pendingPath);
  const bytes = await readFile(pendingPath);
  const requestSha256 = sha256(bytes);
  const receipt = await readOptional(
    resolve(receiptRoot, `${pending.release}.json`),
  );
  requireState(
    receipt?.schemaVersion === "idol-publication-receipt-v1" &&
      receipt.status === "published" &&
      receipt.requestSha256 === requestSha256 &&
      receipt.newSha === pending.newSha &&
      receipt.manifestSha256 === pending.manifestSha256 &&
      receipt.runId === pending.runId,
    "publication_not_confirmed",
  );
  const consumedPath = resolve(
    stateRoot,
    "publish/consumed",
    `${pending.release}.json`,
  );
  const previous = await readOptional(consumedPath);
  if (previous)
    requireState(
      previous.requestSha256 === requestSha256 &&
        previous.newSha === pending.newSha,
      "publication_consumed_drift",
    );
  else
    await writeOnce(consumedPath, {
      schemaVersion: "idol-publication-consumed-v1",
      requestSha256,
      newSha: pending.newSha,
      runId: pending.runId,
      release: pending.release,
      receipt,
    });
  requireState(
    sha256(await readFile(pendingPath)) === requestSha256,
    "publication_pending_drift",
  );
  await regularPath(pendingPath);
  await unlink(pendingPath);
  return {
    status: "published",
    release: pending.release,
    newSha: pending.newSha,
  };
}

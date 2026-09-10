import assert from "node:assert/strict";
import {
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { encode, sha256 } from "../src/sourceCapture.ts";
import { writeOnce } from "../server/state.ts";
import {
  assertWeeklyRunRecovery,
  completeWeeklyRunRecovery,
  readWeeklyRunReceipt,
  requestWeeklyRunRecovery,
} from "../server/weeklyRunRecovery.ts";

const RUN = "weekly-2020-01-03";
const SLOT = "scheduled-2020-01-03";
async function fixture(t, original = {}) {
  const root = await mkdtemp(join(tmpdir(), "idol-weekly-run-recovery-"));
  assert.equal(dirname(root), resolve(tmpdir()));
  t.after(() => rm(root, { recursive: true, force: true }));
  const attempt = join(root, "runs", RUN, "attempt.json");
  const receipt = join(root, "runs", RUN, "receipt.json");
  const request = join(root, "weekly-recoveries", RUN, "request.json");
  const recovery = join(root, "weekly-recoveries", RUN, "receipt.json");
  await writeOnce(attempt, {
    schemaVersion: "idol-server-attempt-v1",
    runId: RUN,
    kind: "weekly",
    startedAt: "2020-01-03T00:00:00Z",
  });
  await writeOnce(receipt, {
    schemaVersion: "idol-server-run-v1",
    runId: RUN,
    status: "blocked",
    code: "incomplete_weekly_response",
    finishedAt: "2020-01-03T00:01:00Z",
    ...original,
  });
  return {
    root,
    attempt,
    receipt,
    request,
    recovery,
    hash: sha256(await readFile(receipt)),
  };
}
function completion(publicWrites = 0) {
  return {
    schemaVersion: "idol-server-run-v1",
    runId: RUN,
    status: "complete",
    changed: publicWrites === 1,
    result: {
      collection: { slotId: SLOT, requests: 0, cachedBatches: 1, reused: true },
      application: {
        status: "complete",
        slotId: SLOT,
        changed: publicWrites === 1,
        publicWrites,
      },
    },
    publication: { changed: false },
    finishedAt: new Date().toISOString(),
  };
}
async function mutate(path, change) {
  const value = JSON.parse(await readFile(path, "utf8"));
  change(value);
  await writeFile(path, encode(value), "utf8");
}

test("恢复请求与完成均幂等，原失败字节保留，跨日只读取原周期", async (t) => {
  const f = await fixture(t);
  const oldAttempt = await readFile(f.attempt);
  const oldReceipt = await readFile(f.receipt);
  const requested = await requestWeeklyRunRecovery(f.root, RUN, f.hash);
  assert.equal(requested.originalAttemptSha256, sha256(oldAttempt));
  assert.equal(requested.originalReceiptSha256, sha256(oldReceipt));
  assert.deepEqual(
    await requestWeeklyRunRecovery(f.root, RUN, f.hash),
    requested,
  );
  assert.deepEqual(
    await assertWeeklyRunRecovery(f.root, RUN, f.hash),
    requested,
  );
  assert.equal((await readWeeklyRunReceipt(f.root, RUN)).status, "blocked");
  const effective = completion(1);
  assert.deepEqual(
    await completeWeeklyRunRecovery(f.root, RUN, f.hash, effective),
    effective,
  );
  const recoveryBytes = await readFile(f.recovery);
  assert.deepEqual(
    await completeWeeklyRunRecovery(f.root, RUN, f.hash, effective),
    effective,
  );
  assert.deepEqual(await readWeeklyRunReceipt(f.root, RUN), effective);
  assert.equal(await readWeeklyRunReceipt(f.root, "weekly-2020-01-10"), null);
  assert.deepEqual(await readFile(f.attempt), oldAttempt);
  assert.deepEqual(await readFile(f.receipt), oldReceipt);
  assert.deepEqual(await readFile(f.recovery), recoveryBytes);
  const envelope = JSON.parse(recoveryBytes);
  assert.equal(envelope.requestSha256, sha256(await readFile(f.request)));
  assert.equal(envelope.originalReceiptSha256, f.hash);
  await assert.rejects(
    completeWeeklyRunRecovery(f.root, RUN, f.hash, completion(0)),
    /completion_conflict/,
  );
});

test("缺少请求不能完成；历史无恢复时仍返回原始失败", async (t) => {
  const f = await fixture(t, { code: "weekly_price_unavailable" });
  assert.equal(
    (await readWeeklyRunReceipt(f.root, RUN)).code,
    "weekly_price_unavailable",
  );
  await assert.rejects(
    requestWeeklyRunRecovery(f.root, RUN, f.hash),
    /ineligible_original/,
  );
  const fresh = await fixture(t);
  await assert.rejects(
    assertWeeklyRunRecovery(fresh.root, RUN, fresh.hash),
    /request_missing/,
  );
  await assert.rejects(
    completeWeeklyRunRecovery(fresh.root, RUN, fresh.hash, completion()),
    /request_missing/,
  );
});

test("既有成功回执可读但不能申请失败恢复，假成功仍被拒绝", async (t) => {
  const value = completion();
  const f = await fixture(t, { ...value, code: undefined });
  assert.deepEqual(await readWeeklyRunReceipt(f.root, RUN), value);
  await assert.rejects(
    requestWeeklyRunRecovery(f.root, RUN, f.hash),
    /ineligible_original/,
  );
  await mutate(f.receipt, (v) => {
    v.result.application.publicWrites = null;
  });
  await assert.rejects(readWeeklyRunReceipt(f.root, RUN), /invalid_completion/);
});

test("路径、日历日期和 SHA 必须合法且准确", async (t) => {
  const f = await fixture(t);
  for (const id of [
    "../weekly-2020-01-03",
    "daily-2020-01-03",
    "weekly-2020-02-30",
    "weekly-2020-01-03/extra",
  ]) {
    await assert.rejects(readWeeklyRunReceipt(f.root, id), /invalid_path/);
  }
  await assert.rejects(readWeeklyRunReceipt("relative", RUN), /invalid_path/);
  await assert.rejects(
    requestWeeklyRunRecovery(f.root, RUN, "wrong"),
    /invalid_hash/,
  );
  await assert.rejects(
    requestWeeklyRunRecovery(f.root, RUN, "0".repeat(64)),
    /original_hash_mismatch/,
  );
  await writeFile(f.receipt, `${await readFile(f.receipt, "utf8")} `, "utf8");
  await assert.rejects(
    requestWeeklyRunRecovery(f.root, RUN, f.hash),
    /original_hash_mismatch/,
  );
});

for (const [name, change] of [
  [
    "原回执字节",
    async (f) =>
      writeFile(f.receipt, `${await readFile(f.receipt, "utf8")} `, "utf8"),
  ],
  [
    "原意图字节",
    async (f) =>
      writeFile(f.attempt, `${await readFile(f.attempt, "utf8")} `, "utf8"),
  ],
  [
    "请求绑定",
    async (f) =>
      mutate(f.request, (v) => {
        v.originalReceiptSha256 = "0".repeat(64);
      }),
  ],
  [
    "请求跨周期",
    async (f) =>
      mutate(f.request, (v) => {
        v.runId = "weekly-2020-01-10";
      }),
  ],
]) {
  test(`恢复请求拒绝篡改：${name}`, async (t) => {
    const f = await fixture(t);
    await requestWeeklyRunRecovery(f.root, RUN, f.hash);
    await change(f);
    await assert.rejects(readWeeklyRunReceipt(f.root, RUN), /request_mismatch/);
    await assert.rejects(
      completeWeeklyRunRecovery(f.root, RUN, f.hash, completion()),
      /request_mismatch/,
    );
  });
}

test("孤立恢复文件与原回执缺失均拒绝读成成功", async (t) => {
  const f = await fixture(t);
  await writeOnce(f.recovery, { completedReceipt: completion() });
  await assert.rejects(readWeeklyRunReceipt(f.root, RUN), /orphaned/);
  const orphan = await fixture(t);
  await requestWeeklyRunRecovery(orphan.root, RUN, orphan.hash);
  await rm(orphan.receipt);
  await assert.rejects(readWeeklyRunReceipt(orphan.root, RUN), /orphaned/);
});

test("原失败必须关联同一 weekly attempt 且时间有序", async (t) => {
  for (const change of [
    (v) => {
      v.runId = "weekly-2020-01-10";
    },
    (v) => {
      v.kind = "daily";
    },
    (v) => {
      v.startedAt = "2020-01-03T00:02:00Z";
    },
  ]) {
    const f = await fixture(t);
    await mutate(f.attempt, change);
    await assert.rejects(
      requestWeeklyRunRecovery(f.root, RUN, f.hash),
      /invalid_original/,
    );
  }
  const missing = await fixture(t);
  await rm(missing.attempt);
  await assert.rejects(
    readWeeklyRunReceipt(missing.root, RUN),
    /invalid_original/,
  );
});

const invalidCompletions = [
  [
    "假 schema",
    (v) => {
      v.schemaVersion = "fake";
    },
  ],
  [
    "假 complete",
    (v) => {
      v.status = "blocked";
    },
  ],
  [
    "错误 runId",
    (v) => {
      v.runId = "weekly-2020-01-10";
    },
  ],
  [
    "应用未完成",
    (v) => {
      v.result.application.status = "ready";
    },
  ],
  [
    "应用错 slot",
    (v) => {
      v.result.application.slotId = "scheduled-2020-01-10";
    },
  ],
  [
    "采集错 slot",
    (v) => {
      v.result.collection.slotId = "scheduled-2020-01-10";
    },
  ],
  [
    "写入未知",
    (v) => {
      v.result.application.publicWrites = null;
    },
  ],
  [
    "写入越界",
    (v) => {
      v.result.application.publicWrites = 2;
    },
  ],
  [
    "应用 changed 矛盾",
    (v) => {
      v.result.application.changed = true;
    },
  ],
  [
    "外层 changed 矛盾",
    (v) => {
      v.changed = true;
    },
  ],
  [
    "完成早于恢复",
    (v) => {
      v.finishedAt = "2020-01-04T00:00:00Z";
    },
  ],
  [
    "未来时间",
    (v) => {
      v.finishedAt = new Date(Date.now() + 86400_000).toISOString();
    },
  ],
  [
    "无效时间",
    (v) => {
      v.finishedAt = "yesterday";
    },
  ],
  [
    "遗留失败码",
    (v) => {
      v.code = "incomplete_weekly_response";
    },
  ],
];
for (const [name, change] of invalidCompletions) {
  test(`恢复完成拒绝矛盾语义：${name}`, async (t) => {
    const f = await fixture(t);
    await requestWeeklyRunRecovery(f.root, RUN, f.hash);
    const value = completion();
    change(value);
    await assert.rejects(
      completeWeeklyRunRecovery(f.root, RUN, f.hash, value),
      /invalid_completion/,
    );
    await assert.rejects(readFile(f.recovery), /ENOENT/);
  });
}

test("完成后请求字节篡改或恢复内层假 complete 均不能读回成功", async (t) => {
  const f = await fixture(t);
  await requestWeeklyRunRecovery(f.root, RUN, f.hash);
  await completeWeeklyRunRecovery(f.root, RUN, f.hash, completion());
  await writeFile(f.request, `${await readFile(f.request, "utf8")} `, "utf8");
  await assert.rejects(readWeeklyRunReceipt(f.root, RUN), /receipt_mismatch/);
  const invalid = await fixture(t);
  await requestWeeklyRunRecovery(invalid.root, RUN, invalid.hash);
  await completeWeeklyRunRecovery(
    invalid.root,
    RUN,
    invalid.hash,
    completion(),
  );
  await mutate(invalid.recovery, (v) => {
    v.completedReceipt.result.application.slotId = "scheduled-2020-01-10";
  });
  await assert.rejects(
    readWeeklyRunReceipt(invalid.root, RUN),
    /invalid_completion/,
  );
});

test("恢复请求时间不能早于失败或位于未来", async (t) => {
  for (const requestedAt of [
    "2020-01-02T00:00:00Z",
    new Date(Date.now() + 86400_000).toISOString(),
  ]) {
    const f = await fixture(t);
    await requestWeeklyRunRecovery(f.root, RUN, f.hash);
    await mutate(f.request, (v) => {
      v.requestedAt = requestedAt;
    });
    await assert.rejects(
      assertWeeklyRunRecovery(f.root, RUN, f.hash),
      /request_mismatch/,
    );
  }
});

test("恢复回执不能指向另一原始失败哈希", async (t) => {
  const f = await fixture(t);
  await requestWeeklyRunRecovery(f.root, RUN, f.hash);
  await completeWeeklyRunRecovery(f.root, RUN, f.hash, completion());
  await mutate(f.recovery, (v) => {
    v.originalReceiptSha256 = "0".repeat(64);
  });
  await assert.rejects(readWeeklyRunReceipt(f.root, RUN), /receipt_mismatch/);
});

test("硬链接状态被拒绝", async (t) => {
  const f = await fixture(t);
  await link(f.receipt, join(f.root, "second-link.json"));
  await assert.rejects(
    readWeeklyRunReceipt(f.root, RUN),
    /nonregular_path|invalid_file/,
  );
});

test("目录链接不能绕过状态根，读取空状态不创建目录", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "alias");
  await symlink(
    join(f.root, "runs"),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(readWeeklyRunReceipt(alias, RUN), /symbolic_link/);
  const absent = join(f.root, "absent");
  assert.equal(await readWeeklyRunReceipt(absent, RUN), null);
  assert.equal((await readdir(f.root)).includes("absent"), false);
});

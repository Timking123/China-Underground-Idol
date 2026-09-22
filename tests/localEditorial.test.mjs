import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { applyLocalEditorial } from "../maintenance/localEditorial.mjs";
import { localEditorialFixture, root } from "./localEditorialFixtures.mjs";
import {
  recoverLocalEditorialLock,
  localLockName,
} from "../maintenance/localEditorialLock.mjs";

test("本地维护拒绝未归档证据和提交前撤回，不改主档或伪造应用回执", async () => {
  const f = await localEditorialFixture();
  try {
    await assert.rejects(
      applyLocalEditorial({
        ...f.options,
        evidence: { ...f.evidence, captures: [] },
      }),
      /review_excerpt_not_in_capture/,
    );
    assert.equal(
      f.runtime.getEditorialRevision(f.store, f.revision.id).status,
      "handed_off",
    );
    assert.deepEqual(
      await readFile(path.join(root, "data/events.v1.json")),
      f.baseline,
    );
    f.runtime.mutateEditorial(
      f.store,
      "withdraw",
      f.revision.id,
      {
        requestId: randomUUID(),
        expectedVersion: f.revision.version,
        note: "本地合成撤回",
      },
      f.baseline,
      "合成管理员",
      f.now.getTime(),
      () => {},
    );
    await assert.rejects(applyLocalEditorial(f.options), /交付|撤回|维护/);
    assert.equal(
      f.runtime.getEditorialRevision(f.store, f.revision.id).receipt,
      null,
    );
    assert.deepEqual(await readdir(f.options.workspace), []);
  } finally {
    f.store.close();
  }
});

test("四层资料在封口快照构建并通过两级发布校验，重复应用回读同一快照", async () => {
  const f = await localEditorialFixture();
  try {
    await writeFile(path.join(f.directory, "synthetic.key"), f.key, {
      mode: 0o600,
    });
    await writeFile(
      path.join(f.directory, "evidence.json"),
      JSON.stringify(f.evidence, null, 2),
    );
    const config = path.join(f.directory, "crash-config.json");
    await writeFile(
      config,
      JSON.stringify(
        {
          root,
          directory: f.directory,
          workspace: f.options.workspace,
          revisionId: f.revision.id,
          now: f.now.toISOString(),
        },
        null,
        2,
      ),
    );
    const chunks = [];
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(root, "tests/localEditorialCrashChild.mjs"), config],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (value) => chunks.push(value));
      child.stderr.on("data", (value) => chunks.push(value));
      child.once("error", reject);
      child.once("exit", resolve);
    });
    await writeFile(
      path.join(f.directory, "crash-child.log"),
      Buffer.concat(chunks),
    );
    assert.equal(exitCode, 77, Buffer.concat(chunks).toString("utf8"));
    await assert.rejects(applyLocalEditorial(f.options), { code: "EEXIST" });
    const lock = await readFile(path.join(f.options.workspace, localLockName));
    await recoverLocalEditorialLock(
      f.options.workspace,
      createHash("sha256").update(lock).digest("hex"),
    );
    assert.equal(
      f.runtime.getEditorialRevision(f.store, f.revision.id).status,
      "withdrawal_requested",
    );
    assert.equal(
      f.runtime.getEditorialRevision(f.store, f.revision.id).receipt,
      null,
    );
    const result = await applyLocalEditorial(f.options);
    assert.equal(result.replayed, true);
    assert.equal(result.receipt.status, "applied");
    assert.match(result.receipt.snapshotManifestSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      await readFile(path.join(root, "data/events.v1.json")),
      f.baseline,
    );
    const source = path.join(result.output, "source");
    const events = JSON.parse(
      await readFile(path.join(source, "data/events.v1.json")),
    );
    assert.equal(events.events[0].venue, "合成星光现场");
    const verification = JSON.parse(
      await readFile(path.join(source, "data/event-verifications.v1.json")),
    );
    assert.equal(
      verification.records.some((item) => item.eventId === events.events[0].id),
      false,
    );
    const updates = JSON.parse(
      await readFile(path.join(source, "data/updates.v1.json")),
    );
    assert.ok(updates.entries.length > 0);
    const release = path.join(source, ".build/site");
    const publishedBytes = await readFile(
      path.join(release, "data/events.v1.json"),
    );
    assert.deepEqual(
      publishedBytes,
      await readFile(path.join(source, "data/events.v1.json")),
    );
    const password = randomUUID();
    f.store.put(
      "account",
      "admin",
      {
        username: "release-reader",
        passwordHash: await f.runtime.hashPassword(password),
      },
      Date.now(),
    );
    const origin = "https://local-editorial.test.cn";
    const server = f.runtime.createConsoleServer({
      store: f.store,
      origin,
      trustedProxy: false,
      adminDirectory: path.join(root, ".build/console/public"),
      siteDirectory: release,
      geo: {
        ready: false,
        async locate() {
          return { country: "未知", province: "未知", city: "未知" };
        },
        close() {},
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const login = await globalThis.fetch(`${base}/api/v1/admin/login`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ username: "release-reader", password }),
      });
      assert.equal(login.status, 200);
      await login.json();
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const baselineResponse = await globalThis.fetch(
        `${base}/api/v1/admin/editorial/baseline`,
        { headers: { cookie } },
      );
      assert.equal(
        baselineResponse.status,
        200,
        "后台必须能读取实际发行目录的原始活动基线",
      );
      const baselineBody = await baselineResponse.json();
      assert.equal(
        baselineBody.data.baselineSha256,
        result.receipt.resultSha256,
      );
      const detailResponse = await globalThis.fetch(
        `${base}/api/v1/admin/editorial/${f.revision.id}`,
        { headers: { cookie } },
      );
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(
        detail.data.revision.receipt.snapshotManifestSha256,
        result.receipt.snapshotManifestSha256,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    const replay = await applyLocalEditorial(f.options);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, result.receipt);
    const original = await readFile(path.join(source, "data/events.v1.json"));
    try {
      await writeFile(path.join(source, "data/events.v1.json"), "{}");
      await assert.rejects(applyLocalEditorial(f.options), /快照已变化/);
    } finally {
      await writeFile(path.join(source, "data/events.v1.json"), original);
    }
    await writeFile(
      path.join(f.directory, "evidence.json"),
      JSON.stringify(f.evidence, null, 2),
    );
    await writeFile(
      path.join(f.directory, "proof.json"),
      JSON.stringify(f.proof, null, 2),
    );
    await writeFile(path.join(f.directory, "synthetic.key"), f.key, {
      mode: 0o600,
    });
    await writeFile(
      path.join(root, "reports/city-upgrade-f/local-editorial-success.json"),
      JSON.stringify(
        {
          directory: f.directory,
          output: result.output,
          revisionId: f.revision.id,
          snapshotManifestSha256: result.receipt.snapshotManifestSha256,
        },
        null,
        2,
      ),
    );
  } finally {
    f.store.close();
  }
});

test("完整候选构建后提交点前撤回不落完成标识，失败目录不接管", async () => {
  const f = await localEditorialFixture();
  let output;
  try {
    await assert.rejects(
      applyLocalEditorial({
        ...f.options,
        beforeCommit: (context) => {
          output = context.output;
          f.runtime.mutateEditorial(
            f.store,
            "withdraw",
            f.revision.id,
            {
              requestId: randomUUID(),
              expectedVersion: f.revision.version,
              note: "合成提交前撤回",
            },
            f.baseline,
            "合成管理员",
            Date.now(),
            () => {},
          );
        },
      }),
      /交付|撤回|维护/,
    );
    assert.ok(output);
    await assert.rejects(readFile(path.join(output, "completed.json")), {
      code: "ENOENT",
    });
    assert.equal(
      f.runtime.getEditorialRevision(f.store, f.revision.id).receipt,
      null,
    );
    assert.deepEqual(
      await readFile(path.join(root, "data/events.v1.json")),
      f.baseline,
    );
  } finally {
    f.store.close();
  }
});

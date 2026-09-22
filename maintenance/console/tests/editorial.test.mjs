import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ConsoleStore } from "../store.ts";
import { createConsoleServer } from "../server.ts";
import {
  editorialSha256,
  encodeEditorialCandidate,
  getEditorialHandoff,
  prepareEditorialCandidate,
  mutateEditorial,
  recordEditorialReceipt,
} from "../editorial.ts";
import {
  createEditorialFixture,
  editorialBytes,
  editorialDataset,
  editorialTime,
} from "./editorial-fixture.mjs";

const scratch = path.resolve("reports/city-upgrade-e/http-tmp");
mkdirSync(scratch, { recursive: true });
const ORIGIN = "https://editorial.example.invalid";
async function fixture(t, extra = {}) {
  const directory = mkdtempSync(path.join(scratch, "run-"));
  const password = randomBytes(24).toString("base64url");
  const f = await createEditorialFixture(directory, password);
  let time = editorialTime;
  const server = createConsoleServer({
    store: f.store,
    origin: ORIGIN,
    trustedProxy: false,
    adminDirectory: path.join(directory, "admin"),
    siteDirectory: f.site,
    geo: {
      ready: false,
      locate: async () => ({ country: "未知", province: "未知", city: "未知" }),
      close() {},
    },
    now: () => time,
    ...extra,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let auth = {};
  async function request(route, method = "GET", body, overrides = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        origin: extra.origin ?? ORIGIN,
        "content-type": "application/json",
        ...auth,
        ...overrides,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    return { status: response.status, ...result, headers: response.headers };
  }
  const login = await request("/api/v1/admin/login", "POST", {
    username: "editorial-admin",
    password,
  });
  assert.equal(login.status, 200);
  auth = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": login.data.csrf,
  };
  const api = (suffix, method = "GET", body, overrides) =>
    request(`/api/v1/admin/editorial${suffix}`, method, body, overrides);
  const create = (input = f.input, requestId = randomUUID()) =>
    api("", "POST", { requestId, expectedVersion: 0, input });
  const action = (revision, operation, body = {}) =>
    api(`/${revision.id}/${operation}`, "POST", {
      requestId: randomUUID(),
      expectedVersion: revision.version,
      ...body,
    });
  const approved = async () => {
    const created = await create();
    assert.equal(created.status, 201, created.message);
    const result = await action(created.data, "review", {
      decision: "approve",
      note: "已核实受信维护归档及字段证据",
    });
    assert.equal(result.status, 200, result.message);
    return result.data;
  };
  const handedOff = async () => {
    const result = await action(await approved(), "handoff");
    assert.equal(result.status, 200, result.message);
    return result.data;
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    f.store.close();
    // 仅删除本测试刚创建、位于独占 scratch 内的目录。
    assert.ok(directory.startsWith(scratch + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    ...f,
    directory,
    base,
    api,
    request,
    create,
    action,
    approved,
    handedOff,
    advance: (milliseconds) => {
      time += milliseconds;
    },
  };
}
function receipt(revision, status = "applied") {
  return {
    schemaVersion: "idol-editorial-receipt-v1",
    candidateId: revision.candidate.candidateId,
    candidateSha256: revision.candidateSha256,
    baselineSha256: revision.baselineSha256,
    resultSha256: status === "applied" ? "2".repeat(64) : null,
    status,
    runId: "synthetic-maintenance-run",
    publicationId: status === "applied" ? "local-snapshot-synthetic" : null,
    snapshotManifestSha256: status === "applied" ? "3".repeat(64) : null,
    message:
      status === "applied"
        ? "合成维护回执：完整快照已核验"
        : "合成维护已确认未应用",
    completedAt: new Date(editorialTime).toISOString(),
  };
}

test("真实 HTTP 投稿→结构化修订→差异→审核→受限交付→可信回执回读", async (t) => {
  const f = await fixture(t);
  const submission = await f.request("/api/v1/feedback", "POST", {
    kind: "event",
    target: editorialDataset.events[0].id,
    source: "https://example.org/editorial-proof",
    details: "此为真实HTTP合成投稿，请更新场馆资料。",
    contact: "private-reader@example.invalid",
    consent: true,
    website: "",
    requestId: randomUUID(),
  });
  assert.equal(submission.status, 201);
  const created = await f.create({
    ...f.input,
    feedbackId: submission.data.id,
  });
  assert.equal(created.status, 201, created.message);
  const detail = await f.api(`/${created.data.id}`);
  assert.equal(detail.data.diff[0].before, null);
  assert.equal(detail.data.diff[0].after, "合成星光现场");
  const reviewed = await f.action(created.data, "review", {
    decision: "approve",
    note: "已核对真实测试归档",
  });
  assert.equal(reviewed.status, 200);
  const handoff = await f.action(reviewed.data, "handoff");
  assert.equal(handoff.data.status, "handed_off");
  const candidate = getEditorialHandoff(f.store, handoff.data.id);
  assert.equal(
    editorialSha256(encodeEditorialCandidate(candidate.candidate)),
    candidate.candidateSha256,
  );
  const prepared = prepareEditorialCandidate(
    candidate.candidate,
    editorialBytes,
    editorialTime,
  );
  assert.equal(prepared.event.venue, "合成星光现场");
  assert.doesNotMatch(
    encodeEditorialCandidate(candidate.candidate),
    /private-reader|contact|192\.0\.2|reviewNote/u,
  );
  assert.deepEqual(
    readFileSync(path.join(f.site, "data/events.v1.json")),
    editorialBytes,
    "控制台没有覆写公开基线",
  );
  recordEditorialReceipt(
    f.store,
    handoff.data.id,
    receipt(handoff.data),
    "synthetic-maintenance",
    editorialTime,
  );
  const result = await f.api(`/${handoff.data.id}`);
  assert.equal(result.data.revision.status, "applied");
  assert.equal(
    result.data.revision.receipt.snapshotManifestSha256,
    "3".repeat(64),
  );
});
test("所有新增 HTTP 入口保留鉴权、CSRF、Origin 和过期会话边界", async (t) => {
  const f = await fixture(t);
  const revision = await f.approved();
  for (const [suffix, method] of [
    ["", "GET"],
    ["/baseline", "GET"],
    [`/${revision.id}`, "GET"],
    ["", "POST"],
    [`/${revision.id}`, "PATCH"],
    [`/${revision.id}/review`, "POST"],
    [`/${revision.id}/handoff`, "POST"],
    [`/${revision.id}/withdraw`, "POST"],
  ]) {
    assert.equal(
      (
        await f.api(suffix, method, method === "GET" ? undefined : {}, {
          cookie: "",
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (await f.api("", "POST", {}, { "x-csrf-token": "" })).status,
    403,
  );
  assert.equal(
    (await f.api("", "POST", {}, { origin: "https://attacker.invalid" }))
      .status,
    403,
  );
  f.advance(31 * 60000);
  assert.equal((await f.api("/baseline")).status, 401);
});
test("未知身份、字段、缺证据、恶意 URL、未来时间与凭据内容拒绝", async (t) => {
  const f = await fixture(t);
  for (const change of [
    { target: { kind: "event", id: "e-missing" } },
    { feedbackId: "f".repeat(24) },
    { patch: { sources: [] } },
    { patch: { id: "e-replaced" } },
    { patch: { venue: "合成星光现场", status: "cancelled" } },
    { evidence: [] },
    { evidence: [{ ...f.input.evidence[0], url: "javascript:alert(1)" }] },
    {
      evidence: [
        { ...f.input.evidence[0], url: "https://reader:password@example.org/" },
      ],
    },
    { evidence: [{ ...f.input.evidence[0], url: "http://127.0.0.1/private" }] },
    {
      evidence: [
        { ...f.input.evidence[0], observedAt: "2099-01-01T00:00:00Z" },
      ],
    },
    { patch: { venue: "password=private-value" } },
    { patch: { venue: null } },
  ])
    assert.ok(
      [400, 404].includes((await f.create({ ...f.input, ...change })).status),
      JSON.stringify(change),
    );
});
test("未归档证据可以保存为待核验，但不能通过审核或交付", async (t) => {
  const f = await fixture(t);
  const created = await f.create({
    ...f.input,
    evidence: [{ ...f.input.evidence[0], captureId: "" }],
  });
  assert.equal(created.status, 201);
  const result = await f.action(created.data, "review", {
    decision: "approve",
    note: "未归档测试",
  });
  assert.equal(result.status, 409);
  assert.match(result.message, /受信维护归档/u);
  assert.equal((await f.action(created.data, "handoff")).status, 409);
});
test("同请求幂等重放、不同内容冲突、并发版本只有一个成功", async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  const [one, two] = await Promise.all([
    f.create(f.input, id),
    f.create(f.input, id),
  ]);
  assert.equal(one.status, 201);
  assert.deepEqual(one.data, two.data);
  assert.equal(f.store.recordPage("editorial", 1, 20).total, 1);
  assert.equal(
    (
      await f.create(
        {
          ...f.input,
          rationale: "这是不同的修订依据，不允许复用相同请求编号。",
        },
        id,
      )
    ).status,
    409,
  );
  const edits = await Promise.all(
    ["第一次说明已核验原文", "第二次说明已核验原文"].map((note) =>
      f.action(one.data, "review", { decision: "approve", note }),
    ),
  );
  assert.deepEqual(edits.map((item) => item.status).sort(), [200, 409]);
});
test("编辑使审批失效；不能改变关联投稿/目标或修改已交付版本", async (t) => {
  const f = await fixture(t);
  const approved = await f.approved();
  const edited = await f.api(`/${approved.id}`, "PATCH", {
    requestId: randomUUID(),
    expectedVersion: approved.version,
    input: {
      ...f.input,
      rationale: "重新核验后的另一份修订依据，仍须再次审核。",
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.status, "draft");
  assert.equal(edited.data.reviewedAt, null);
  assert.equal((await f.action(edited.data, "handoff")).status, 409);
  const handoff = await f.handedOff();
  assert.equal(
    (
      await f.api(`/${handoff.id}`, "PATCH", {
        requestId: randomUUID(),
        expectedVersion: handoff.version,
        input: f.input,
      })
    ).status,
    409,
  );
});
test("审核、交付和维护应用均拒绝漂移基线；详情保留原始差异", async (t) => {
  const f = await fixture(t);
  const approved = await f.approved();
  const other = await f.handedOff();
  const changed = Buffer.from(editorialBytes.toString() + " ");
  writeFileSync(path.join(f.site, "data/events.v1.json"), changed);
  assert.equal((await f.action(approved, "handoff")).status, 409);
  assert.throws(
    () => prepareEditorialCandidate(other.candidate, changed, editorialTime),
    /基线已变化/u,
  );
  const detail = await f.api(`/${approved.id}`);
  assert.equal(detail.data.baselineConflict, true);
  assert.equal(detail.data.diff[0].before, null);
});
test("撤回交付候选阻止维护消费，回执确认前不宣称已撤回", async (t) => {
  const f = await fixture(t);
  const handoff = await f.handedOff();
  const withdrawn = await f.action(handoff, "withdraw", {
    note: "来源发生争议，暂停交付",
  });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.data.status, "withdrawal_requested");
  assert.throws(() => getEditorialHandoff(f.store, handoff.id), /已撤回/u);
  const saved = recordEditorialReceipt(
    f.store,
    handoff.id,
    receipt(handoff, "withdrawn"),
    "maintenance",
    editorialTime,
  );
  assert.equal(saved.status, "withdrawn");
  assert.equal((await f.action(saved, "handoff")).status, 409);
});
test("历史达到100条仍允许撤回和维护终结，总历史最多102条", async (t) => {
  const f = await fixture(t);
  let revision = (await f.create()).data;
  for (let index = 0; index < 97; index++)
    revision = mutateEditorial(
      f.store,
      "edit",
      revision.id,
      {
        requestId: randomUUID(),
        expectedVersion: revision.version,
        input: f.input,
      },
      editorialBytes,
      "合成管理员",
      editorialTime,
      () => {},
    );
  revision = (
    await f.action(revision, "review", {
      decision: "approve",
      note: "核实后交付",
    })
  ).data;
  revision = (await f.action(revision, "handoff")).data;
  assert.equal(revision.history.length, 100);
  const result = await f.action(revision, "withdraw", {
    note: "历史虽满仍须撤回不应继续消费的候选",
  });
  assert.equal(result.status, 200, result.message);
  assert.equal(result.data.status, "withdrawal_requested");
  assert.equal(result.data.history.length, 101);
  assert.throws(() => getEditorialHandoff(f.store, revision.id), /已撤回/u);
  const saved = recordEditorialReceipt(
    f.store,
    revision.id,
    receipt(revision, "withdrawn"),
    "maintenance",
    editorialTime,
  );
  assert.equal(saved.status, "withdrawn");
  assert.equal(saved.history.length, 102);
  assert.equal(
    (await f.action(saved, "withdraw", { note: "重复终结不能增加历史" }))
      .status,
    409,
  );
  assert.equal(f.store.get("editorial", revision.id).history.length, 102);
});
test("维护已越过提交点时撤回请求保留，真实应用回执为最终结果", async (t) => {
  const f = await fixture(t);
  const handoff = await f.handedOff();
  f.advance(1000);
  await f.action(handoff, "withdraw", { note: "此测试模拟提交点后的撤回请求" });
  const saved = recordEditorialReceipt(
    f.store,
    handoff.id,
    receipt(handoff),
    "maintenance",
    editorialTime + 2000,
  );
  assert.equal(saved.status, "applied");
  assert.ok(saved.history.some((item) => item.action === "withdraw"));
  assert.equal(
    (await f.action(saved, "withdraw", { note: "重复撤回" })).status,
    409,
  );
});
test("回执绑定候选、基线、完整快照；重复回执幂等且无HTTP自报成功入口", async (t) => {
  const f = await fixture(t);
  const handoff = await f.handedOff();
  for (const change of [
    { candidateId: randomUUID() },
    { candidateSha256: "1".repeat(64) },
    { baselineSha256: "1".repeat(64) },
    { snapshotManifestSha256: null },
    { resultSha256: handoff.baselineSha256 },
    { publicationId: null },
  ])
    assert.throws(() =>
      recordEditorialReceipt(
        f.store,
        handoff.id,
        { ...receipt(handoff), ...change },
        "maintenance",
        editorialTime,
      ),
    );
  assert.equal(
    (await f.api(`/${handoff.id}/receipt`, "POST", receipt(handoff))).status,
    404,
  );
  const first = recordEditorialReceipt(
    f.store,
    handoff.id,
    receipt(handoff),
    "maintenance",
    editorialTime,
  );
  assert.deepEqual(
    recordEditorialReceipt(
      f.store,
      handoff.id,
      receipt(handoff),
      "maintenance",
      editorialTime,
    ),
    first,
  );
  assert.throws(
    () =>
      recordEditorialReceipt(
        f.store,
        handoff.id,
        { ...receipt(handoff), message: "不同结果" },
        "maintenance",
        editorialTime,
      ),
    /不能覆盖/u,
  );
});
test("加密 SQLite/WAL 不出现修订、摘录、联系信息，错误密钥失败", async (t) => {
  const f = await fixture(t);
  await f.handedOff();
  for (const name of readdirSync(path.join(f.directory, "private-data"))) {
    const bytes = readFileSync(path.join(f.directory, "private-data", name));
    for (const secret of [
      "合成星光现场",
      "合成验收演出将于",
      "synthetic-private@example.invalid",
      "192.0.2.215",
    ])
      assert.equal(
        bytes.includes(Buffer.from(secret)),
        false,
        `${name} 泄漏 ${secret}`,
      );
  }
  assert.throws(
    () =>
      new ConsoleStore(path.join(f.directory, "private-data"), randomBytes(32)),
  );
});
test("新固定页、清单动态页和日历预览可访问，未列出/哈希错/私有路径拒绝", async (t) => {
  const f = await fixture(t, { devStatic: true, origin: "http://127.0.0.1" });
  for (const name of ["city", "favorites", "subscriptions", "updates"])
    writeFileSync(path.join(f.site, `${name}.html`), `合成${name}`);
  for (const directory of ["groups", "events", "assets", "feeds/v1/groups"])
    mkdirSync(path.join(f.site, directory), { recursive: true });
  const files = [
    ["groups/g001.html", "<p>合成团体</p>"],
    ["groups/index.html", "<p>合成团体索引</p>"],
    ["events/index.html", "<p>合成活动索引</p>"],
    ["events/e-synthetic.html", "<p>合成活动</p>"],
    ["feeds/v1/groups/g001.ics", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"],
  ];
  for (const [name, bytes] of files)
    writeFileSync(path.join(f.site, name), bytes);
  writeFileSync(path.join(f.site, "groups/g999.html"), "未登记文件");
  writeFileSync(
    path.join(f.site, "assets/public-artifacts.v1.json"),
    JSON.stringify({
      schemaVersion: "idol-public-artifacts-v1",
      files: files.map(([name, bytes]) => ({
        path: name,
        sha256: editorialSha256(bytes),
        bytes: Buffer.byteLength(bytes),
      })),
    }),
  );
  for (const route of [
    "/city.html",
    "/favorites.html",
    "/subscriptions.html",
    "/updates.html",
    "/groups/g001.html",
    "/groups/index.html",
    "/events/index.html",
    "/events/e-synthetic.html",
  ])
    assert.equal((await fetch(f.base + route)).status, 200, route);
  const ics = await fetch(f.base + "/feeds/v1/groups/g001.ics");
  assert.match(ics.headers.get("content-type"), /^text\/calendar/u);
  for (const route of [
    "/groups/g999.html",
    "/maintenance/console/store.ts",
    "/console.sqlite",
    "/assets/page-data/private.json",
  ])
    assert.equal((await fetch(f.base + route)).status, 404, route);
  for (const route of [
    "/city.html",
    "/groups/g001.html",
    "/groups/index.html",
    "/events/index.html",
  ])
    assert.equal(
      (
        await f.request("/api/v1/pageviews", "POST", {
          id: randomUUID(),
          path: route,
          referrer: "",
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await f.request("/api/v1/pageviews", "POST", {
        id: randomUUID(),
        path: "/groups/g999.html",
        referrer: "",
      })
    ).status,
    400,
  );
  writeFileSync(path.join(f.site, "groups/g001.html"), "篡改内容");
  assert.equal((await fetch(f.base + "/groups/g001.html")).status, 404);
});

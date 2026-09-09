import assert from "node:assert/strict";
import test from "node:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fixture from "./serverEventPolicy.fixture.mjs";

const runtimeRoot = fileURLToPath(new URL("../../", import.meta.url));
const NOW = "2026-09-09T17:00:00.000Z";
const BEFORE = "2026-09-09T08:00:00.000Z";
const clone = (value) => JSON.parse(JSON.stringify(value));
const writeJson = (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
const jsonFile = async (path) => JSON.parse(await readFile(path, "utf8"));

async function setup(t, sourceIds = ["weibo-freya"], { seed = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "serverDaily-"));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("serverDaily-"));
    await rm(root, { recursive: true, force: true });
  });
  const stageRoot = join(root, "stage"),
    stateRoot = join(root, "state"),
    profileRoot = join(root, "profile");
  for (const path of [
    "private/src",
    "private/server",
    "site/src/events",
    "site/data",
  ])
    await mkdir(join(stageRoot, path), { recursive: true });
  // 隔离副本只复制纯代码与公开 fixture，不读取真实私有 store、会话或凭据。
  for (const name of [
    "pipeline",
    "pipelineStore",
    "eventApplication",
    "eventCandidates",
    "sourceCapture",
    "sourceRegistry",
    "showstart",
  ])
    await copyFile(
      join(runtimeRoot, `private/src/${name}.ts`),
      join(stageRoot, `private/src/${name}.ts`),
    );
  for (const name of ["daily", "eventPolicy"])
    await copyFile(
      join(runtimeRoot, `private/server/${name}.ts`),
      join(stageRoot, `private/server/${name}.ts`),
    );
  try {
    await copyFile(
      join(runtimeRoot, "site/src/events/model.ts"),
      join(stageRoot, "site/src/events/model.ts"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(
      resolve(runtimeRoot, "../../src/events/model.ts"),
      join(stageRoot, "site/src/events/model.ts"),
    );
  }
  await writeJson(join(stageRoot, "package.json"), { type: "module" });
  const registry = await jsonFile(join(runtimeRoot, "private/sources.v1.json"));
  registry.sources = registry.sources.filter((source) =>
    sourceIds.includes(source.id),
  );
  await writeJson(join(stageRoot, "private/sources.v1.json"), registry);
  const events = clone(
    fixture.events.filter((event) =>
      event.sources.some((source) =>
        fixture.captures.some(
          (capture) =>
            sourceIds.includes(capture.registryId) &&
            capture.source.sourceUrl === source.url,
        ),
      ),
    ),
  );
  const data = {
    schemaVersion: "idol-events-v1",
    coverage: "partial",
    updatedAt: BEFORE,
    events,
  };
  await writeJson(join(stageRoot, "site/data/events.v1.json"), data);
  const groupIds = [
    ...new Set(
      events.flatMap((event) =>
        event.performers.map((performer) => performer.groupId).filter(Boolean),
      ),
    ),
  ];
  await writeFile(
    join(stageRoot, "site/data.js"),
    `window.IDOL_MAP_DATA = ${JSON.stringify({ groups: groupIds.map((id) => ({ id })) })};\n`,
    "utf8",
  );
  const load = (name) =>
    import(pathToFileURL(join(stageRoot, `private/${name}.ts`)).href);
  const pipeline = await load("src/pipeline");
  const captures = await load("src/sourceCapture");
  const stores = await load("src/pipelineStore");
  const showstart = await load("src/showstart");
  const daily = await load("server/daily");
  const store = await stores.createPipelineStore(
    join(stageRoot, "private/store"),
  );
  const inputs = [];
  const publicBody = (sourceId) =>
    sourceId === "weibo-board"
      ? "活动信息\n2026年\n9/10 上海 舫Freya Fes 微博正文\n更多活动随后更新"
      : fixture.captures.find((capture) => capture.registryId === sourceId)
          .bodyText;
  const buildBrowser = (
    source,
    at,
    body = publicBody(source.id),
    extraLinks = [],
  ) => {
    const links =
      source.id === "weibo-board"
        ? [
            {
              text: "微博正文",
              href: "https://weibo.com/7716940453/5340601463603690",
            },
            ...extraLinks,
          ]
        : clone(
            fixture.captures.find((capture) => capture.registryId === source.id)
              .links,
          ).concat(extraLinks);
    const text = `${source.publisher}\n${body}`;
    const proof = {
      schemaVersion: "public-browser-source-v1",
      sourceUrl: source.pinnedUrls[0],
      capturedAt: at,
      captureMethod: "public-browser-visible-article",
      text,
      textSha256: captures.sha256(text),
      links,
    };
    const bytes = Buffer.from(captures.encode(proof));
    const capture = captures.captureBrowserProof(
      proof,
      bytes,
      source,
      { start: body.slice(0, 100), end: body.slice(-100), complete: true },
      new Date(at),
    );
    return {
      capture,
      proof: {
        captureId: capture.captureId,
        sha256: captures.sha256(bytes),
        bytesBase64: bytes.toString("base64"),
      },
    };
  };
  const primarySnapshot = (capture) => {
    const event = events.find((item) =>
      item.sources.some((source) => source.url === capture.source.sourceUrl),
    );
    const fields = Object.fromEntries(
      Object.entries(event).filter(([key]) => !["id", "sources"].includes(key)),
    );
    return {
      source: capture.source,
      items: [
        {
          candidateId: `c-${captures.sha256(capture.captureId).slice(0, 32)}`,
          sourceItemKey: "reviewed-event",
          originalEventUrl: capture.source.sourceUrl,
          originalUrlIsUnique: true,
          fields,
          fieldExcerpts: Object.fromEntries(
            Object.keys(fields).map((key) => [key, capture.bodyText]),
          ),
        },
      ],
    };
  };
  const httpInput = (at, detailChange = false) => {
    const source = registry.sources.find(
      (item) => item.id === "showstart-glory",
    );
    const hostUrl = source.pinnedUrls[0],
      detailUrl = "https://www.showstart.com/event/308732";
    const host =
      '<a href="/event/308732"><p class="name">GLORY星际搭车指南 Vol.40</p><p class="time">2026/09/12 12:30</p><p class="addr">MASK</p></a>';
    const oldDetail = fixture.captures.find(
      (capture) => capture.source.sourceUrl === detailUrl,
    ).bodyText;
    const detail =
      (detailChange ? oldDetail.replace("12:25", "12:20") : oldDetail)
        .split("\n")
        .map((line) => `<p>${line}</p>`)
        .join("") + `<a href="${hostUrl}">Glory偶像事务所</a>`;
    const proofs = [host, detail].map((main, index) => {
      const html = `<html data-server-rendered="true"><main>${main}</main></html>`;
      return {
        schemaVersion: "public-http-source-v1",
        sourceUrl: index ? detailUrl : hostUrl,
        capturedAt: at,
        status: 200,
        contentType: "text/html",
        sanitized: "script-and-style-elements-removed",
        rawResponseSha256: captures.sha256(html),
        htmlSha256: captures.sha256(html),
        html,
      };
    });
    const captured = proofs.map((proof) =>
      showstart.captureHttp(proof, source),
    );
    return {
      schemaVersion: "idol-capture-import-v1",
      captures: captured,
      proofs: proofs.map((proof, index) => {
        const bytes = Buffer.from(captures.encode(proof));
        return {
          captureId: captured[index].captureId,
          sha256: captures.sha256(bytes),
          bytesBase64: bytes.toString("base64"),
        };
      }),
      snapshots: [
        showstart.extractShowstartHost(proofs[0], captured[0], new Date(at)),
        ...(detailChange ? [] : [primarySnapshot(captured[1])]),
      ],
      mappings: [
        {
          eventId: "e-showstart-308732",
          sourceId: captured[1].source.sourceId,
          sourceItemKey: "reviewed-event",
        },
      ],
    };
  };
  for (const source of registry.sources) {
    if (source.collector === "showstart-public-http") {
      inputs.push(httpInput(BEFORE));
      continue;
    }
    const collected = buildBrowser(source, BEFORE);
    const snapshot =
      source.kind === "aggregator"
        ? captures.extractAggregation(collected.capture, new Date(BEFORE))
            .snapshot
        : primarySnapshot(collected.capture);
    const owner = events.find((event) =>
      event.sources.some(
        (item) => item.url === collected.capture.source.sourceUrl,
      ),
    );
    inputs.push({
      schemaVersion: "idol-capture-import-v1",
      captures: [collected.capture],
      proofs: [collected.proof],
      snapshots: [snapshot],
      mappings: owner
        ? [
            {
              eventId: owner.id,
              sourceId: collected.capture.source.sourceId,
              sourceItemKey: "reviewed-event",
            },
          ]
        : [],
    });
  }
  if (seed) {
    const input = {
      schemaVersion: "idol-capture-import-v1",
      captures: inputs.flatMap((item) => item.captures),
      proofs: inputs.flatMap((item) => item.proofs),
      snapshots: inputs.flatMap((item) => item.snapshots),
      mappings: inputs.flatMap((item) => item.mappings),
    };
    await pipeline.archiveImport(
      store,
      Buffer.from(captures.encode(input)),
      registry,
      "fixture-previous",
      new Date(BEFORE),
    );
  }
  const calls = [];
  let observation = NOW;
  const mutations = new Map();
  const collectors = {
    browser: async (source) => {
      calls.push(source.id);
      const mutate = mutations.get(source.id);
      return mutate
        ? mutate(source, observation, buildBrowser)
        : buildBrowser(source, observation);
    },
    http: async (_store, _registry, id, at) => {
      calls.push(id);
      const input = httpInput(at.toISOString(), mutations.has(id));
      const runId = `public-${id}-${new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10)}`;
      const archived = await pipeline.archiveImport(
        store,
        Buffer.from(captures.encode(input)),
        registry,
        runId,
        at,
      );
      return { ...archived, requests: 2 };
    },
  };
  const options = { stageRoot, stateRoot, profileRoot, now: new Date(NOW) };
  return {
    root,
    options,
    stageRoot,
    stateRoot,
    store,
    registry,
    events,
    calls,
    mutations,
    inputs,
    pipeline,
    captures,
    run: daily.dailyWithCollectorsForTest(collectors),
    buildBrowser,
    httpInput,
    setTime: (at) => {
      observation = at;
      options.now = new Date(at);
    },
    eventsFile: join(stageRoot, "site/data/events.v1.json"),
  };
}

test("完整前像与全部原文不变：只归档私有运行，正式字节不变", async (t) => {
  const env = await setup(t, ["weibo-freya", "weibo-season"]);
  const before = await readFile(env.eventsFile);
  const result = await env.run(env.options);
  assert.equal(result.changed, false);
  assert.equal(result.reviewCount, 0);
  assert.deepEqual(result.incidents, []);
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.every((source) => source.status === "complete"));
  assert.deepEqual(await readFile(env.eventsFile), before);
  const daily = await env.store.readRun(
    "activities",
    "server-daily-2026-09-10",
  );
  assert.equal(daily.status, "complete");
  assert.equal(JSON.parse(daily.files["captures.json"]).length, 2);
  assert.equal(daily.files["draft.json"], undefined);
});

test("双时刻真实策略走原 applyActivityRun，只更新时刻和来源观测", async (t) => {
  const env = await setup(t);
  env.mutations.set("weibo-freya", (source, at, build) =>
    build(
      source,
      at,
      fixture.captures
        .find((capture) => capture.registryId === source.id)
        .bodyText.replace("18：15", "18：25")
        .replace("18:30", "18:40"),
    ),
  );
  const before = await jsonFile(env.eventsFile);
  const result = await env.run(env.options);
  assert.equal(result.changed, true, JSON.stringify(result.incidents));
  assert.deepEqual(result.incidents, []);
  const after = await jsonFile(env.eventsFile);
  assert.equal(after.events[0].opensAt, "18:25");
  assert.equal(after.events[0].startsAt, "18:40");
  assert.equal(after.events[0].sources[0].observedAt, NOW);
  for (const key of Object.keys(before.events[0]).filter(
    (key) => !["opensAt", "startsAt", "sources"].includes(key),
  ))
    assert.deepEqual(after.events[0][key], before.events[0][key], key);
  const daily = await env.store.readRun(
    "activities",
    "server-daily-2026-09-10",
  );
  const draft = JSON.parse(daily.files["draft.json"]),
    captures = JSON.parse(daily.files["captures.json"]);
  for (const evidence of draft.changes[0].evidence)
    assert.ok(
      captures
        .find((capture) => capture.captureId === evidence.captureId)
        .bodyText.includes(evidence.excerpt),
    );
  const applications = await env.store.listRuns("applications");
  assert.equal(applications.length, 1);
  assert.equal(applications[0].status, "complete");
  // 新一日再次比较相同新正文，已确认字段快照能延续而不重复写正式数据。
  env.setTime("2026-09-11T01:00:00.000Z");
  const again = await env.run(env.options);
  assert.equal(again.changed, false);
  assert.deepEqual(again.incidents, []);
});

test("当日完成重入直接缓存，不采集、不刷新观察、不重复通知", async (t) => {
  const env = await setup(t);
  const first = await env.run(env.options);
  env.setTime("2026-09-10T06:00:00.000Z");
  const second = await env.run(env.options);
  assert.equal(env.calls.length, 1);
  assert.equal(second.changed, false);
  assert.equal(second.sources[0].reused, true);
  assert.deepEqual(second.sources[0].observedAt, first.sources[0].observedAt);
  assert.deepEqual(second.incidents, []);
});

test("聚合待审与独立官号改时刻同时出现：首日应用，次日保留新值", async (t) => {
  const env = await setup(t, ["weibo-board", "weibo-freya"]);
  env.mutations.set("weibo-board", (source, at, build) =>
    build(
      source,
      at,
      "活动信息\n2026年\n9/10 上海 舫Freya Fes 微博正文\n9/11 上海 新活动 微博正文\n更多活动随后更新",
      [
        {
          text: "微博正文",
          href: "https://weibo.com/7716940453/5340128614550286",
        },
      ],
    ),
  );
  env.mutations.set("weibo-freya", (source, at, build) =>
    build(
      source,
      at,
      fixture.captures[0].bodyText
        .replace("18：15", "18：25")
        .replace("18:30", "18:40"),
    ),
  );
  const first = await env.run(env.options);
  assert.equal(first.changed, true, JSON.stringify(first.incidents));
  assert.ok(
    first.incidents.some((incident) => incident.source === "weibo-board"),
  );
  const applied = await readFile(env.eventsFile);
  const event = JSON.parse(applied).events[0];
  assert.equal(event.opensAt, "18:25");
  assert.equal(event.startsAt, "18:40");
  env.setTime("2026-09-11T01:00:00.000Z");
  const second = await env.run(env.options);
  assert.equal(second.changed, false);
  assert.deepEqual(second.incidents, []);
  assert.deepEqual(await readFile(env.eventsFile), applied);
  assert.equal((await env.store.listRuns("applications")).length, 1);
});

test("采集已归档但应用前像漂移：持久保存待处理，连续次日提醒并保护前像", async (t) => {
  const env = await setup(t);
  const before = await readFile(env.eventsFile);
  const body = fixture.captures[0].bodyText
    .replace("18：15", "18：25")
    .replace("18:30", "18:40");
  let drift = true;
  env.mutations.set("weibo-freya", async (source, at, build) => {
    if (drift) {
      const changed = JSON.parse(before);
      changed.events[0].title += "（人工修改）";
      await writeJson(env.eventsFile, changed);
      drift = false;
    }
    return build(source, at, body);
  });
  const first = await env.run(env.options);
  assert.equal(first.changed, false);
  assert.ok(
    first.incidents.some(
      (incident) => incident.code === "daily_event_baseline_drift",
    ),
  );
  assert.equal(
    (
      await env.store.readRun(
        "activities",
        "server-source-weibo-freya-2026-09-10",
      )
    ).status,
    "complete",
  );
  assert.deepEqual(
    await readFile(
      join(
        env.stateRoot,
        "runs/daily-application-intents/server-daily-2026-09-10/files/baseline.json",
      ),
    ),
    before,
  );
  const intent = await jsonFile(
    join(
      env.stateRoot,
      "runs/daily-application-intents/server-daily-2026-09-10/files/changes.json",
    ),
  );
  assert.equal(intent.length, 2);
  const preserved = await readFile(env.eventsFile);
  for (const at of ["2026-09-11T01:00:00.000Z", "2026-09-12T01:00:00.000Z"]) {
    env.setTime(at);
    const next = await env.run(env.options);
    assert.equal(next.changed, false);
    assert.ok(
      next.incidents.some(
        (incident) =>
          incident.code === "daily_unapplied_changes_require_review",
      ),
    );
    assert.deepEqual(await readFile(env.eventsFile), preserved);
  }
  assert.equal((await env.store.listRuns("applications")).length, 0);
});

test("一源失败继续下一源，失败有独立记录而没有成功活动run", async (t) => {
  const env = await setup(t, ["weibo-freya", "weibo-season"]);
  env.mutations.set("weibo-freya", () => {
    throw new Error("browser_source_login_required");
  });
  const result = await env.run(env.options);
  assert.deepEqual(env.calls, ["weibo-freya", "weibo-season"]);
  assert.equal(
    result.sources.find((source) => source.source === "weibo-freya").status,
    "failed",
  );
  assert.equal(
    result.sources.find((source) => source.source === "weibo-season").status,
    "complete",
  );
  assert.equal(
    (
      await env.store.readRun(
        "activities",
        "server-source-weibo-freya-2026-09-10",
      )
    ).status,
    "missing",
  );
  const files = await readdir(join(env.stateRoot, "daily/2026-09-10"));
  assert.ok(files.some((file) => file.startsWith("weibo-freya.failed-")));
  assert.ok(!files.includes("weibo-freya.json"));
  assert.ok(
    result.incidents.some(
      (incident) => incident.code === "browser_source_login_required",
    ),
  );
});

test("已有当日历史归档使用原 capture；缓存正文变化也不能自动写入", async (t) => {
  const env = await setup(t);
  const source = env.registry.sources[0];
  const collected = env.buildBrowser(
    source,
    "2026-09-09T16:30:00.000Z",
    fixture.captures[0].bodyText
      .replace("18：15", "18：25")
      .replace("18:30", "18:40"),
  );
  const input = {
    schemaVersion: "idol-capture-import-v1",
    captures: [collected.capture],
    proofs: [collected.proof],
    snapshots: [],
    mappings: [],
  };
  await env.pipeline.archiveImport(
    env.store,
    Buffer.from(env.captures.encode(input)),
    env.registry,
    "fixture-today-cache",
    env.options.now,
  );
  const before = await readFile(env.eventsFile);
  const result = await env.run(env.options);
  assert.equal(env.calls.length, 0);
  assert.equal(result.changed, false);
  assert.deepEqual(result.sources[0].observedAt, ["2026-09-09T16:30:00.000Z"]);
  assert.ok(
    result.incidents.some(
      (incident) =>
        incident.code === "cached_changed_observation_requires_review",
    ),
  );
  assert.deepEqual(await readFile(env.eventsFile), before);
});

test("采集 transport 返回旧观察或破损 proof 均阻断，不能绕过原归档校验", async (t) => {
  for (const mode of ["stale", "proof"]) {
    await t.test(mode, async (subtest) => {
      const env = await setup(subtest);
      env.mutations.set("weibo-freya", (source, at, build) => {
        const result = build(source, mode === "stale" ? BEFORE : at);
        if (mode === "proof") result.proof.sha256 = "0".repeat(64);
        return result;
      });
      const result = await env.run(env.options);
      assert.equal(result.sources[0].status, "failed");
      assert.equal(result.changed, false);
      assert.equal(
        (
          await env.store.readRun(
            "activities",
            "server-source-weibo-freya-2026-09-10",
          )
        ).status,
        "missing",
      );
    });
  }
});

test("独立来源的缓存待审不清空本轮新采集的合法时刻变化", async (t) => {
  const env = await setup(t, ["weibo-board", "weibo-freya"]);
  const source = env.registry.sources.find((item) => item.id === "weibo-board");
  const collected = env.buildBrowser(
    source,
    "2026-09-09T16:30:00.000Z",
    "活动信息\n2026年\n9/10 上海 舫Freya Fes 微博正文\n更多活动另行发布",
  );
  await env.pipeline.archiveImport(
    env.store,
    Buffer.from(
      env.captures.encode({
        schemaVersion: "idol-capture-import-v1",
        captures: [collected.capture],
        proofs: [collected.proof],
        snapshots: [],
        mappings: [],
      }),
    ),
    env.registry,
    "fixture-board-cache",
    env.options.now,
  );
  env.mutations.set("weibo-freya", (registered, at, build) =>
    build(
      registered,
      at,
      fixture.captures[0].bodyText.replace("18：15", "18：25"),
    ),
  );
  const result = await env.run(env.options);
  assert.deepEqual(env.calls, ["weibo-freya"]);
  assert.equal(result.changed, true, JSON.stringify(result.incidents));
  assert.ok(
    result.incidents.some(
      (incident) =>
        incident.code === "cached_changed_observation_requires_review",
    ),
  );
  assert.equal((await jsonFile(env.eventsFile)).events[0].opensAt, "18:25");
});

test("未审标题变更跨日不重复告警，后续时间变化也不能绕过旧待审正文", async (t) => {
  const env = await setup(t);
  const body = fixture.captures[0].bodyText.replace(
    "教师节专场",
    "全新主题专场",
  );
  env.mutations.set("weibo-freya", (source, at, build) =>
    build(source, at, body),
  );
  const first = await env.run(env.options);
  assert.equal(first.changed, false);
  assert.ok(first.reviewCount > 0);
  env.setTime("2026-09-11T01:00:00.000Z");
  const second = await env.run(env.options);
  assert.equal(second.changed, false);
  assert.equal(second.reviewCount, 0);
  assert.deepEqual(second.incidents, []);
  env.setTime("2026-09-12T01:00:00.000Z");
  env.mutations.set("weibo-freya", (source, at, build) =>
    build(source, at, body.replace("18：15", "18：25")),
  );
  const third = await env.run(env.options);
  assert.equal(third.changed, false);
  assert.ok(
    third.incidents.some(
      (incident) => incident.code === "new_or_unbound_source_candidate_only",
    ),
  );
});

test("新增聚合活动只归档候选并通知，不新增正式活动", async (t) => {
  const env = await setup(t, ["weibo-board", "weibo-freya"]);
  env.mutations.set("weibo-board", (source, at, build) =>
    build(
      source,
      at,
      "活动信息\n2026年\n9/10 上海 舫Freya Fes 微博正文\n9/11 上海 新活动 微博正文\n更多活动随后更新",
      [
        {
          text: "微博正文",
          href: "https://weibo.com/7716940453/5340128614550286",
        },
      ],
    ),
  );
  const before = await readFile(env.eventsFile);
  const result = await env.run(env.options);
  assert.equal(result.changed, false);
  assert.ok(
    result.incidents.some((incident) => incident.source === "weibo-board"),
  );
  assert.deepEqual(await readFile(env.eventsFile), before);
  const run = await env.store.readRun("activities", "server-daily-2026-09-10");
  const snapshots = JSON.parse(run.files["snapshots.json"]);
  assert.equal(
    snapshots.find((snapshot) => snapshot.source.kind === "aggregator").items
      .length,
    2,
  );
});

test("只秀动详情变更：读取实际HTTP run的全部captures，首页不掩盖详情", async (t) => {
  const env = await setup(t, ["showstart-glory"]);
  env.mutations.set("showstart-glory", true);
  const before = await readFile(env.eventsFile);
  const result = await env.run(env.options);
  assert.deepEqual(env.calls, ["showstart-glory"]);
  assert.equal(result.changed, false);
  assert.ok(
    result.incidents.some(
      (incident) =>
        incident.code === "showstart_detail_body_changed_requires_review",
    ),
  );
  assert.deepEqual(await readFile(env.eventsFile), before);
  const run = await env.store.readRun("activities", "server-daily-2026-09-10");
  assert.equal(JSON.parse(run.files["captures.json"]).length, 2);
});

test("正式 URL 多活动归属或缺失历史稳定映射均不按相似名合并", async (t) => {
  const env = await setup(t);
  const baseline = await jsonFile(env.eventsFile);
  baseline.events.push({
    ...clone(baseline.events[0]),
    id: "e-another-same-title",
  });
  await writeJson(env.eventsFile, baseline);
  env.mutations.set("weibo-freya", (source, at, build) =>
    build(source, at, fixture.captures[0].bodyText.replace("18：15", "18：25")),
  );
  const result = await env.run(env.options);
  assert.equal(result.changed, false);
  assert.ok(result.reviewCount > 0);
  assert.deepEqual(await jsonFile(env.eventsFile), baseline);
});

test("首次无历史的新来源只做候选，不能从既有相似活动推导ready", async (t) => {
  const env = await setup(t, ["weibo-freya"], { seed: false });
  const result = await env.run(env.options);
  assert.equal(result.changed, false);
  assert.ok(
    result.incidents.some(
      (incident) => incident.code === "new_source_candidate_only",
    ),
  );
});

test("只处理pilot来源，已有采集尝试中断不会自动重试", async (t) => {
  const env = await setup(t, ["weibo-freya", "weibo-season"]);
  env.registry.sources.find((source) => source.id === "weibo-season").state =
    "paused";
  await writeJson(join(env.stageRoot, "private/sources.v1.json"), env.registry);
  await mkdir(join(env.stateRoot, "daily/2026-09-10"), { recursive: true });
  await writeJson(
    join(env.stateRoot, "daily/2026-09-10/weibo-freya.attempt.json"),
    {
      source: "weibo-freya",
      day: "2026-09-10",
      attemptedAt: NOW,
    },
  );
  const result = await env.run(env.options);
  assert.deepEqual(env.calls, []);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].status, "failed");
  assert.ok(
    result.incidents.some(
      (incident) => incident.code === "daily_prior_attempt_requires_review",
    ),
  );
});

test("状态与浏览器profile根的目录链接在任何采集前阻断", async (t) => {
  for (const option of ["stateRoot", "profileRoot"]) {
    await t.test(option, async (subtest) => {
      const env = await setup(subtest);
      const outside = join(env.root, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "sentinel.txt"), "preserved", "utf8");
      await symlink(
        outside,
        env.options[option],
        process.platform === "win32" ? "junction" : "dir",
      );
      await assert.rejects(env.run(env.options));
      assert.equal(env.calls.length, 0);
      assert.deepEqual(await readdir(outside), ["sentinel.txt"]);
    });
  }
});

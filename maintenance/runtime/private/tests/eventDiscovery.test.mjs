/* global structuredClone */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAggregationDiscoveries } from "../src/eventDiscovery.ts";
import { prepareEventUpdate } from "../src/eventApplication.ts";
import { captureBrowserProof, encode, sha256 } from "../src/sourceCapture.ts";
import {
  registrySource,
  validateSourceRegistry,
} from "../src/sourceRegistry.ts";
import {
  fixture as primaryFixture,
  groups as primaryGroups,
  original as primaryOriginal,
  registry as primaryRegistry,
} from "./serverPipelineFixtures.mjs";

const registry = validateSourceRegistry(
  JSON.parse(
    await readFile(new URL("../sources.v1.json", import.meta.url), "utf8"),
  ),
);
const board = registrySource(registry, "weibo-board");
const now = new Date("2026-09-11T09:00:00Z");
const detail = (id = "123456") => `https://weibo.com/7716940453/${id}`;
function capture(
  rows = ["9/12 上海 合成演出 微博正文"],
  urls = [detail()],
  options = {},
) {
  const text = `正文开始\n${options.year ?? "2026年"}\n${rows.join("\n")}\n正文结束`;
  const proof = {
    schemaVersion: "public-browser-source-v1",
    sourceUrl: options.sourceUrl ?? board.pinnedUrls[0],
    capturedAt: options.observedAt ?? "2026-09-11T08:00:00Z",
    captureMethod: "public-browser-visible-article",
    text,
    textSha256: sha256(text),
    links: urls.map((href) => ({ text: "微博正文", href })),
  };
  return captureBrowserProof(
    proof,
    Buffer.from(encode(proof)),
    board,
    { start: "正文开始", end: "正文结束", complete: options.complete ?? true },
    now,
  );
}
function discover(captures = [capture()], options = {}) {
  return buildAggregationDiscoveries({
    captures,
    freshCaptureIds: captures.map((item) => item.captureId),
    events: [],
    now,
    ...options,
  });
}
function baseline(events = []) {
  return Buffer.from(
    encode({
      schemaVersion: "idol-events-v1",
      coverage: "partial",
      updatedAt: "2026-09-10T08:00:00Z",
      events,
    }),
  );
}
function apply(changes, captures, events = []) {
  const bytes = baseline(events);
  return prepareEventUpdate(
    bytes,
    {
      schemaVersion: "idol-reviewed-event-update-v1",
      baselineSha256: sha256(bytes),
      reviewedAt: now.toISOString(),
      reviewedBy: "合成揭示板验收",
      changes,
    },
    captures,
    registry,
    [],
    now,
  );
}

test("空格年份沿用实际年份，无法解析的新年份标题不能继承旧年份", () => {
  const source = capture(
    ["9/12 上海 本年演出", "2027 年", "9/13 上海 次年演出"],
    [],
  );
  const result = discover([source]);
  assert.deepEqual(
    result.changes.map((change) => change.event.date),
    ["2026-09-12", "2027-09-13"],
  );
  assert.equal(apply(result.changes, [source]).changedIds.length, 2);
  const ambiguous = capture(
    ["9/12 上海 本年演出", "2027年（安排未定）", "9/13 上海 待核年份"],
    [],
  );
  const partial = discover([ambiguous]);
  assert.equal(partial.changes.length, 1);
  assert.equal(partial.reviews.length, 1);
});

test("当批同日期城市完整标题的不同详情身份全部复核，正常项继续", () => {
  for (const [rows, urls] of [
    [["9/12 上海 疑似同场", "9/12 上海 疑似同场 微博正文"], [detail()]],
    [
      ["9/12 上海 疑似同场 微博正文", "9/12 上海 疑似同场 微博正文"],
      [detail(), detail("123457")],
    ],
  ]) {
    const source = capture([...rows, "9/14 北京 明确新场"], urls);
    const result = discover([source]);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].event.title, "明确新场");
    assert.equal(result.reviews.length, 2);
    assert.ok(
      result.reviews.every(
        (item) => item.code === "aggregation_possible_duplicate",
      ),
    );
    assert.equal(apply(result.changes, [source]).changedIds.length, 1);
  }
});

test("完整新鲜揭示板创建最少字段，主帖与未核验的详情转介分别标注", () => {
  const source = capture();
  const result = discover([source]);
  assert.deepEqual(result.summary, {
    discovered: 1,
    created: 1,
    existing: 0,
    conflicts: 0,
    past: 0,
    overflow: 0,
  });
  const event = result.changes[0].event;
  assert.equal(event.status, "unconfirmed");
  for (const field of [
    "province",
    "venue",
    "address",
    "opensAt",
    "startsAt",
    "endsAt",
    "poster",
  ])
    assert.equal(event[field], null);
  assert.deepEqual(event.performers, []);
  assert.deepEqual(event.sources, [
    {
      url: board.pinnedUrls[0],
      label: board.label,
      publisher: board.publisher,
      kind: "aggregator",
      observedAt: source.source.observedAt,
    },
    {
      url: detail(),
      label: "揭示板所附详情（正文未核验）",
      publisher: board.publisher,
      kind: "aggregator",
      observedAt: source.source.observedAt,
    },
  ]);
  assert.equal(event.notes.includes("尚未核实"), true);
  assert.equal(apply(result.changes, [source]).dataset.events.length, 1);
  assert.deepEqual(result.bindings, [
    {
      detailUrl: detail(),
      eventId: event.id,
      date: event.date,
      city: event.city,
    },
  ]);
});

test("重复推荐去重，详情共用的多日活动仍各有稳定身份", () => {
  const source = capture(
    [
      "9/12 上海 合成演出 微博正文",
      "9/13 上海 合成演出 微博正文",
      "9/12 上海 合成演出 微博正文",
    ],
    [detail(), detail(), detail()],
  );
  const result = discover([source, source]);
  assert.equal(result.changes.length, 2);
  assert.equal(
    new Set(result.changes.map((change) => change.event.id)).size,
    2,
  );
  assert.equal(result.bindings.length, 2);
  assert.equal(apply(result.changes, [source]).changedIds.length, 2);
});

test("正文其他行及观察时间变化不改变已有条目的ID，不覆写原记录", () => {
  const first = discover();
  const edited = capture(
    [
      "页内新增说明，不属于活动",
      "9/14 北京 另一场",
      "9/12 上海 合成演出 微博正文",
    ],
    [detail()],
    { observedAt: "2026-09-11T08:30:00Z" },
  );
  const second = discover([edited]);
  const same = second.changes.find(
    (change) => change.event.title === "合成演出",
  );
  assert.equal(same.event.id, first.changes[0].event.id);
  const old = structuredClone(first.changes[0].event);
  old.status = "scheduled";
  old.venue = "已核实场地";
  const original = structuredClone(old);
  const replay = discover([edited], {
    events: [old],
    bindings: first.bindings,
  });
  assert.equal(replay.summary.existing, 1);
  assert.equal(replay.changes.length, 1);
  assert.deepEqual(old, original);
  assert.equal(replay.changes[0].event.title, "另一场");
});

test("无详情条目按规范化字段保持ID稳定，未知资料不阻止收录", () => {
  const first = discover([capture(["9/12 上海 Ａ  演出"], [])]);
  const second = discover([
    capture(["活动说明", "9/12 上海 A 演出", "9/13 北京 B"], []),
  ]);
  assert.equal(first.changes[0].event.id, second.changes[0].event.id);
  assert.equal(first.changes[0].event.title, "A 演出");
  assert.equal(first.bindings.length, 0);
});

test("只接收新鲜完整主帖，缓存、详情捕获、其他聚合源均不能冒充揭示板", () => {
  const source = capture();
  assert.equal(discover([source], { freshCaptureIds: [] }).changes.length, 0);
  assert.equal(
    discover([capture(undefined, undefined, { complete: false })]).changes
      .length,
    0,
  );
  assert.equal(
    discover([
      capture(undefined, undefined, { sourceUrl: detail("board-copy") }),
    ]).changes.length,
    0,
  );
  const forged = structuredClone(source);
  forged.registryId = "other-aggregator";
  assert.equal(discover([forged]).changes.length, 0);
  for (const field of ["publisher", "label", "sourceId", "observedAt"]) {
    const invalid = structuredClone(source);
    invalid.source[field] = "伪造";
    const result = discover([invalid]);
    assert.equal(result.changes.length, 0);
    assert.equal(result.reviews.length, 1);
  }
});

test("按中国当地日期只收录今天和未来，不限制为30天窗口", () => {
  const source = capture(
    ["9/10 上海 昨天", "9/11 上海 今天", "11/20 北京 未来"],
    [],
  );
  const result = discover([source]);
  assert.equal(result.summary.past, 1);
  assert.deepEqual(
    result.changes.map((change) => change.event.date),
    ["2026-09-11", "2026-11-20"],
  );
  const late = discover([source], { now: new Date("2026-09-11T16:00:00Z") });
  assert.equal(late.summary.past, 2);
  const past = discover([capture(["9/11 上海 今天"], [])]).changes;
  assert.throws(
    () =>
      prepareEventUpdate(
        baseline(),
        {
          schemaVersion: "idol-reviewed-event-update-v1",
          baselineSha256: sha256(baseline()),
          reviewedAt: "2026-09-11T16:00:00Z",
          reviewedBy: "合成验收",
          changes: past,
        },
        [capture(["9/11 上海 今天"], [])],
        registry,
        [],
        new Date("2026-09-11T16:00:00Z"),
      ),
    /complete_primary/,
  );
});

test("坏日期与错误详情逐行复核，后续链接保持原始顺序", () => {
  const source = capture(
    [
      "9/31 上海 坏日期 微博正文",
      "9/12 上海 正常一 微博正文",
      "9/13 北京 坏链接 微博正文",
      "9/14 北京 正常二 微博正文",
      "9/坏 上海 坏行 微博正文",
    ],
    [
      detail("baddate"),
      detail("goodone"),
      "https://weibo.com/888888/123456",
      detail("goodtwo"),
      detail("badrow"),
    ],
  );
  const result = discover([source]);
  assert.equal(result.summary.conflicts, 3);
  assert.deepEqual(
    result.changes.map((change) => change.event.title),
    ["正常一", "正常二"],
  );
  assert.deepEqual(
    result.bindings.map((binding) => binding.detailUrl),
    [detail("goodone"), detail("goodtwo")],
  );
  assert.equal(apply(result.changes, [source]).dataset.events.length, 2);
});

test("全页链接数错配停止该源，不能猜测详情关联", () => {
  const source = capture(
    ["9/12 上海 正常一 微博正文", "9/13 北京 正常二 微博正文"],
    [detail()],
  );
  const result = discover([source]);
  assert.equal(result.changes.length, 0);
  assert.equal(result.reviews[0].line, null);
  assert.equal(result.reviews[0].code, "aggregation_link_count_mismatch");
  assert.equal(
    discover([capture(["9/12 上海 未知年份"], [], { year: "年份未确认" })])
      .changes.length,
    0,
  );
});

test("超长城市作为单条坏项，不使已验证的其他条目应用失败", () => {
  const source = capture(
    [`9/12 ${"中".repeat(41)} 城市非法`, "9/13 上海 正常"],
    [],
  );
  const result = discover([source]);
  assert.equal(result.summary.conflicts, 1);
  assert.equal(result.changes.length, 1);
  assert.equal(apply(result.changes, [source]).dataset.events.length, 1);
});

test("显式详情绑定允许不同旧标题，但日期城市必须与目标一致", () => {
  const source = capture();
  const old = structuredClone(discover([source]).changes[0].event);
  old.id = "e-official-original";
  old.title = "原帖更完整的标题";
  old.status = "scheduled";
  const binding = {
    detailUrl: detail(),
    eventId: old.id,
    date: old.date,
    city: old.city,
  };
  const result = discover([source], { events: [old], bindings: [binding] });
  assert.equal(result.summary.existing, 1);
  assert.equal(result.changes.length, 0);
  for (const patch of [{ date: "2026-09-13" }, { city: "北京" }]) {
    const mismatch = discover([source], {
      events: [{ ...old, ...patch }],
      bindings: [binding],
    });
    assert.equal(mismatch.changes.length, 0);
    assert.equal(
      mismatch.reviews[0].code,
      "aggregation_binding_fields_conflict",
    );
  }
});

test("显式绑定缺失、冲突或未知字段只阻断关联条目", () => {
  const source = capture(
    ["9/12 上海 合成演出 微博正文", "9/13 北京 独立活动"],
    [detail()],
  );
  const binding = {
    detailUrl: detail(),
    eventId: "e-original",
    date: "2026-09-12",
    city: "上海",
  };
  for (const bindings of [
    [binding],
    [binding, { ...binding, eventId: "e-other" }],
    [{ ...binding, arbitrary: true }],
  ]) {
    const result = discover([source], { bindings });
    assert.equal(result.summary.conflicts, 1);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].event.title, "独立活动");
  }
});

test("同详情同日不同标题逐条复核，完全标题重复只提示且不自动绑定旧活动", () => {
  const source = capture(
    ["9/12 上海 A 微博正文", "9/12 上海 B 微博正文", "9/13 北京 C"],
    [detail(), detail()],
  );
  const conflict = discover([source]);
  assert.equal(conflict.summary.conflicts, 2);
  assert.equal(conflict.changes.length, 1);
  const old = discover().changes[0].event;
  old.sources = old.sources.slice(0, 1);
  const possible = discover(undefined, {
    events: [{ ...old, id: "e-unbound" }],
  });
  assert.equal(possible.changes.length, 0);
  assert.equal(possible.reviews[0].code, "aggregation_possible_duplicate");
  const similar = discover(undefined, {
    events: [{ ...old, id: "e-unbound", title: "相似但不同的合成演出" }],
  });
  assert.equal(similar.changes.length, 1);
});

test("稳定ID碰撞或旧字段变化进入复核，不覆盖现有活动", () => {
  const old = discover().changes[0].event;
  for (const patch of [
    { title: "已编辑标题" },
    { city: "北京" },
    { date: "2026-09-13" },
  ]) {
    const result = discover(undefined, { events: [{ ...old, ...patch }] });
    assert.equal(result.changes.length, 0);
    assert.equal(result.summary.conflicts, 1);
  }
});

test("100条变更上限明确报告overflow，后续重跑可继续新增剩余条目", () => {
  const source = capture(
    Array.from({ length: 102 }, (_, index) => `9/12 上海 演出 ${index}`),
    [],
  );
  const first = discover([source]);
  assert.equal(first.changes.length, 100);
  assert.equal(first.summary.overflow, 2);
  assert.equal(
    first.reviews.filter((item) => item.code === "aggregation_change_limit")
      .length,
    2,
  );
  const second = discover([source], {
    events: first.changes.map((change) => change.event),
  });
  assert.equal(second.changes.length, 2);
  assert.equal(second.summary.existing, 100);
  assert.equal(second.summary.overflow, 0);
});

test("前段显式旧绑定不占新增配额，超过第100行的合法条目仍可独立应用", () => {
  const source = capture(
    Array.from(
      { length: 104 },
      (_, index) => `9/12 上海 演出 ${index} 微博正文`,
    ),
    Array.from({ length: 104 }, (_, index) => detail(String(10000 + index))),
  );
  const initial = discover([source]);
  const events = initial.changes.slice(0, 4).map((change, index) => ({
    ...change.event,
    id: `e-official-${index}`,
    title: `已核实原帖标题 ${index}`,
    sources: [{ ...change.event.sources[0], url: detail(`original${index}`) }],
  }));
  const bindings = events.map((event, index) => ({
    detailUrl: detail(String(10000 + index)),
    eventId: event.id,
    date: event.date,
    city: event.city,
  }));
  const result = discover([source], { events, bindings });
  assert.equal(result.summary.existing, 4);
  assert.equal(result.changes.length, 100);
  assert.equal(result.changes[99].event.title, "演出 103");
  assert.equal(
    apply(result.changes, [source], events).dataset.events.length,
    104,
  );
});

test("自动产生的绑定不掩盖旧记录的标题冲突", () => {
  const first = discover();
  const changed = capture(["9/12 上海 修改后的标题 微博正文"]);
  const result = discover([changed], {
    events: first.changes.map((change) => change.event),
    bindings: first.bindings,
  });
  assert.equal(result.summary.conflicts, 1);
  assert.equal(result.changes.length, 0);
});

test("应用门独立拒绝伪造字段、来源、ID、状态与任意未知字段", () => {
  const source = capture();
  const good = discover([source]).changes[0];
  const mutations = [
    (change) => {
      change.event.id = "e-forged";
    },
    (change) => {
      change.event.title = "原文不存在";
    },
    (change) => {
      change.event.date = "2026-09-13";
    },
    (change) => {
      change.event.city = "北京";
    },
    (change) => {
      change.event.venue = "推测场地";
    },
    (change) => {
      change.event.startsAt = "18:00";
    },
    (change) => {
      change.event.status = "scheduled";
    },
    (change) => {
      change.event.performers = [{ groupId: null, name: "推测团体" }];
    },
    (change) => {
      change.event.notes = "伪造备注";
    },
    (change) => {
      change.event.extra = true;
    },
    (change) => {
      change.event.sources[0].url = detail();
    },
    (change) => {
      change.event.sources[1].url = detail("forged");
    },
    (change) => {
      change.event.sources[1].label = "已核验原始正文";
    },
    (change) => {
      change.event.sources.shift();
    },
    (change) => {
      change.event.sources[0].publisher = "伪造发布者";
    },
    (change) => {
      change.event.sources[0].observedAt = "2026-09-11T08:30:00Z";
    },
    (change) => {
      change.evidence[0].excerpt = "2026年";
    },
    (change) => {
      change.evidence[0].supports = [
        "title",
        "date",
        "city",
        "status",
        "venue",
      ];
    },
    (change) => {
      change.extra = "不可扩充聚合策略";
    },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(good);
    mutate(forged);
    assert.throws(() => apply([forged], [source]), /complete_primary/);
  }
});

test("聚合证据不能用于UPDATE或绕过旧活动冲突，primary原有应用仍通过", () => {
  const source = capture();
  const good = discover([source]).changes[0];
  const update = structuredClone(good);
  update.action = "update";
  assert.throws(
    () => apply([update], [source], [good.event]),
    /complete_primary/,
  );
  assert.throws(
    () => apply([good], [source], [{ ...good.event, id: "e-unbound" }]),
    /complete_primary/,
  );
  assert.equal(
    prepareEventUpdate(
      primaryOriginal,
      primaryFixture.draft,
      primaryFixture.captures,
      primaryRegistry,
      primaryGroups,
      now,
    ).dataset.events.length,
    9,
  );
});

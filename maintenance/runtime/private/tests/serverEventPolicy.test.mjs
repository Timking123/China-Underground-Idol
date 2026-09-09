import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { evaluateEventPolicy } from "../server/eventPolicy.ts";
import fixture from "./serverEventPolicy.fixture.mjs";

// 仅归档的公开完整正文与正式活动；测试不访问网络或写公开数据。
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fields = [
  "title",
  "date",
  "province",
  "city",
  "venue",
  "address",
  "opensAt",
  "startsAt",
  "endsAt",
  "status",
  "performers",
];

function recapture(
  old,
  mutate = (body) => body,
  observedAt = "2026-09-10T01:00:00Z",
) {
  const capture = clone(old);
  capture.bodyText = mutate(old.bodyText);
  capture.source.bodySha256 = hash(capture.bodyText);
  capture.source.observedAt = observedAt;
  capture.fetchedAt = observedAt;
  capture.evidenceSha256 = hash(
    JSON.stringify({
      body: capture.bodyText,
      observedAt,
      links: capture.links,
    }),
  );
  capture.articleSha256 = hash(capture.bodyText);
  return seal(capture);
}
function seal(capture) {
  capture.source.sourceId = `${capture.registryId}-${hash(capture.source.sourceUrl).slice(0, 16)}`;
  capture.captureId = hash(
    JSON.stringify(
      {
        registryId: capture.registryId,
        sourceUrl: capture.source.sourceUrl,
        observedAt: capture.source.observedAt,
        bodySha256: capture.source.bodySha256,
        evidenceSha256: capture.evidenceSha256,
        completeness: capture.source.completeness,
      },
      null,
      2,
    ) + "\n",
  );
  return capture;
}
function inputFor(registryId = "weibo-freya", mutate = (body) => body) {
  const previous = clone(
    fixture.captures.find((capture) => capture.registryId === registryId),
  );
  const current = recapture(previous, mutate);
  const event = clone(
    fixture.events.find((record) =>
      record.sources.some((source) => source.url === previous.source.sourceUrl),
    ),
  );
  const input = {
    previousCaptures: [previous],
    currentCaptures: [current],
    freshCaptureIds: [current.captureId],
    events: [event],
    now: "2026-09-10T02:00:00Z",
    bindings: [
      {
        eventId: event.id,
        registryId,
        sourceUrl: previous.source.sourceUrl,
        sourceItemKey: "reviewed-event",
        previousCaptureId: previous.captureId,
        previousFields: Object.fromEntries(
          fields.map((field) => [field, clone(event[field])]),
        ),
      },
    ],
  };
  return input;
}
function refresh(input) {
  input.currentCaptures.forEach(seal);
  input.freshCaptureIds = input.currentCaptures.map(
    (capture) => capture.captureId,
  );
  return input;
}
const laterFreya = (body) =>
  body.replace("18：15", "18：25").replace("18:30", "18:40");
function review(input, reason) {
  const result = evaluateEventPolicy(input);
  assert.equal(result.status, "review");
  assert.ok(result.reasons.includes(reason), result.reasons.join(", "));
  assert.deepEqual(result.changes, []);
  return result;
}

test("五个登记微博的完整正文均可严格识别，只变双时刻给出原文切片和 capture 绑定", () => {
  const cases = [
    ["weibo-freya", laterFreya, "18:25", "18:40"],
    [
      "weibo-season",
      (body) => body.replace("18:30/19:00", "18:35/19:05"),
      "18:35",
      "19:05",
    ],
    [
      "weibo-jadx",
      (body) => body.replace("19:15", "19:20").replace("19:30", "19:35"),
      "19:20",
      "19:35",
    ],
    [
      "weibo-mogu",
      (body) => body.replace("13:40", "13:45").replace("14:00", "14:05"),
      "13:45",
      "14:05",
    ],
    [
      "weibo-meguri",
      (body) => body.replace("18：45", "18：50").replace("19:00", "19:05"),
      "18:50",
      "19:05",
    ],
  ];
  for (const [registryId, mutate, opensAt, startsAt] of cases) {
    const input = inputFor(registryId, mutate);
    const before = JSON.stringify(input);
    const result = evaluateEventPolicy(input);
    assert.equal(result.status, "ready", `${registryId}: ${result.reasons}`);
    assert.deepEqual(
      result.changes.map((change) => [change.field, change.after]),
      [
        ["opensAt", opensAt],
        ["startsAt", startsAt],
      ],
    );
    for (const change of result.changes) {
      assert.ok(
        input.previousCaptures[0].bodyText.includes(change.previousExcerpt),
      );
      assert.ok(
        input.currentCaptures[0].bodyText.includes(change.currentExcerpt),
      );
      assert.equal(
        change.previous.captureId,
        input.previousCaptures[0].captureId,
      );
      assert.equal(
        change.current.captureId,
        input.currentCaptures[0].captureId,
      );
      assert.equal(
        change.current.bodySha256,
        hash(input.currentCaptures[0].bodyText),
      );
      assert.equal(change.sourceUrl, input.bindings[0].sourceUrl);
      assert.equal(change.sourceItemKey, "reviewed-event");
      assert.ok(
        change.currentExcerpt.length < input.currentCaptures[0].bodyText.length,
      );
    }
    assert.equal(JSON.stringify(input), before, "纯函数不得修改输入");
  }
});

test("新正文与非空 href 不变，capture/hash 更新不制造字段变化", () => {
  const input = inputFor();
  input.currentCaptures[0].articleSha256 = hash("外层计数变化");
  input.currentCaptures[0].links.push({ text: "查看翻译", href: "" });
  const result = evaluateEventPolicy(input);
  assert.equal(result.status, "unchanged");
  assert.deepEqual(result.changes, []);
});

test("缓存、相同 capture、复用证据不能冒充新观察", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.freshCaptureIds = [];
  review(input, "fresh_capture_required");
  input.currentCaptures = clone(input.previousCaptures);
  refresh(input);
  review(input, "fresh_capture_required");
  const staleEvidence = inputFor("weibo-freya", laterFreya);
  staleEvidence.currentCaptures[0].evidenceSha256 =
    staleEvidence.previousCaptures[0].evidenceSha256;
  review(refresh(staleEvidence), "fresh_capture_required");
});

test("旧观察、同一时刻不同正文和未来时间均阻断", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.currentCaptures = [
    recapture(input.previousCaptures[0], laterFreya, "2026-09-08T00:00:00Z"),
  ];
  review(refresh(input), "source_observation_regressed");
  input.currentCaptures = [
    recapture(
      input.previousCaptures[0],
      laterFreya,
      input.previousCaptures[0].source.observedAt,
    ),
  ];
  review(refresh(input), "changed_capture_requires_later_observation");
  input.currentCaptures = [
    recapture(input.previousCaptures[0], laterFreya, "2026-09-11T00:00:00Z"),
  ];
  review(refresh(input), "invalid_observation_time");
});

test("未完整 capture 或选择器不完整不得 ready", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.currentCaptures[0].source.completeness = "partial";
  review(refresh(input), "complete_capture_required");
  input.currentCaptures[0].source.completeness = "complete";
  input.currentCaptures[0].selection.complete = false;
  review(refresh(input), "complete_capture_required");
});

test("同文本的伪造正文 hash 也必须检出，不能只依赖文本相等", () => {
  const input = inputFor();
  input.currentCaptures[0].source.bodySha256 = hash("另一正文");
  review(refresh(input), "capture_body_hash_mismatch");
});

test("日期变化单独给出明确 review", () => {
  review(
    inputFor("weibo-freya", (body) =>
      laterFreya(body).replace("2026.09.10", "2026.09.11"),
    ),
    "event_date_changed_or_mismatched",
  );
});

test("标题、地址、阵容、票价、票种、正文新增链接与第三时刻变化均送人工", () => {
  for (const mutate of [
    (body) => body.replace("教师节专场", "周末专场"),
    (body) => body.replace("长宁区", "静安区"),
    (body) => body.replace("@ReRa_official-", "@另一个团"),
    (body) => body.replace("💰48", "💰58"),
    (body) => body.replace("普通🎫", "VIP2🎫"),
    (body) => body + "\nhttps://example.com/新来源",
  ])
    review(
      inputFor("weibo-freya", (body) => mutate(laterFreya(body))),
      "non_time_body_changed",
    );
  review(
    inputFor("weibo-season", (body) =>
      body.replace("18:30/19:00", "18:35/19:05").replace("21:30~", "21:40~"),
    ),
    "non_time_body_changed",
  );
});

test("非空 href 的变更、增加、删除与重排均拦截，即使正文未变", () => {
  for (const mutate of [
    (links) => {
      links[0].href += "/other";
    },
    (links) => {
      links.push({ href: "https://example.com/new", text: "新增" });
    },
    (links) => {
      links.pop();
    },
    (links) => {
      links.reverse();
    },
  ]) {
    const input = inputFor();
    mutate(input.currentCaptures[0].links);
    review(input, "source_links_changed");
  }
});

test("票价和票种数字不能作为时刻，未知、非法时刻不得补成零点", () => {
  for (const value of [
    "待定",
    "00",
    "188",
    "24:00",
    "18:99",
    "18:30预售票",
    "18:300",
  ]) {
    const input = inputFor("weibo-season", (body) =>
      body.replace("18:30/19:00", `${value}/19:05`),
    );
    review(
      input,
      /待定/u.test(value)
        ? "cancellation_or_postponement_requires_review"
        : "unknown_or_ambiguous_time_template",
    );
  }
  const input = inputFor("weibo-season", (body) =>
    body.replace("18:30/19:00", "00:00/19:05"),
  );
  input.events[0].opensAt = null;
  input.bindings[0].previousFields.opensAt = null;
  review(input, "parsed_time_preimage_mismatch");
});

test("MOGU NFKC 解析保留粗体标签与原文 hash，不能吞掉非时刻 Unicode 改动", () => {
  const input = inputFor("weibo-mogu", (body) =>
    body.replace("13:40", "１３：４５").replace("14:00", "１４：０５"),
  );
  const result = evaluateEventPolicy(input);
  assert.equal(result.status, "ready");
  assert.equal(result.changes[0].currentExcerpt, "⏰𝗢𝗣𝗘𝗡  １３：４５");
  assert.equal(result.changes[0].after, "13:45");
  assert.notEqual(
    hash(input.currentCaptures[0].bodyText.normalize("NFKC")),
    result.changes[0].current.bodySha256,
  );
  review(
    inputFor("weibo-mogu", (body) =>
      body.replace("13:40", "13:45").replace("𝗢𝗣𝗘𝗡", "OPEN"),
    ),
    "non_time_body_changed",
  );
});

test("取消、延期及相同语义关键词均送人工，不能只更新时间", () => {
  for (const word of [
    "取消",
    "延期",
    "推迟",
    "改期",
    "停演",
    "cancelled",
    "postponed",
  ]) {
    review(
      inputFor("weibo-freya", (body) => laterFreya(body) + `\n${word}`),
      "cancellation_or_postponement_requires_review",
    );
  }
});

test("多 URL 复用同一 sourceItemKey、错误前像 capture、重复映射均阻断", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.bindings.push({
    ...clone(input.bindings[0]),
    sourceUrl: "https://weibo.com/4028711630/OtherPost",
  });
  review(input, "source_item_or_capture_binding_mismatch");
  input.bindings = [input.bindings[0]];
  input.bindings[0].previousCaptureId = "wrong";
  review(input, "source_item_or_capture_binding_mismatch");
  input.bindings[0].previousCaptureId = input.previousCaptures[0].captureId;
  input.bindings.push(clone(input.bindings[0]));
  review(input, "ambiguous_source_binding");
});

test("正式活动字段与已登记前像不一致不能套用源变更", () => {
  for (const [field, value] of [
    ["opensAt", "17:00"],
    ["date", "2026-09-12"],
    ["venue", "另一个场地"],
    ["performers", []],
  ]) {
    const input = inputFor("weibo-freya", laterFreya);
    input.events[0][field] = value;
    review(input, "formal_event_preimage_mismatch");
  }
});

test("新活动与未登记来源只做候选，不从同名合并或缺席推断取消", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.events[0].id = "e-other-same-title";
  review(input, "new_event_candidate_only");
  input.previousCaptures = [];
  review(input, "new_source_candidate_only");
  input.previousCaptures = input.currentCaptures;
  input.currentCaptures = [];
  review(input, "source_missing_no_cancellation");
  const unbound = inputFor("weibo-freya", laterFreya);
  unbound.bindings = [];
  review(unbound, "new_or_unbound_source_candidate_only");
});

test("只秀动详情变化也被发现，首页正文相同不掩盖详情变更", () => {
  const previousCaptures = clone(
    fixture.captures.filter(
      (capture) => capture.registryId === "showstart-glory",
    ),
  );
  const currentCaptures = previousCaptures.map((capture) =>
    recapture(capture, (body) =>
      capture.source.sourceUrl.includes("/event/")
        ? body.replace("12:25", "12:20")
        : body,
    ),
  );
  const result = evaluateEventPolicy({
    previousCaptures,
    currentCaptures,
    freshCaptureIds: currentCaptures.map((capture) => capture.captureId),
    bindings: [],
    events: fixture.events,
    now: "2026-09-10T02:00:00Z",
  });
  assert.equal(result.status, "review");
  assert.equal(result.captures.length, 2);
  assert.equal(
    result.captures.find((capture) => capture.sourceUrl.includes("/host/"))
      .status,
    "unchanged",
  );
  assert.equal(
    result.captures.find((capture) => capture.sourceUrl.includes("/event/"))
      .status,
    "review",
  );
  assert.ok(
    result.reasons.includes("showstart_detail_body_changed_requires_review"),
  );
  assert.deepEqual(result.changes, []);
});

test("重复 capture、重复正式 eventId 与 URL 多活动归属均不得误绑", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.currentCaptures.push(clone(input.currentCaptures[0]));
  review(input, "ambiguous_capture_identity");
  input.currentCaptures.pop();
  input.events.push(clone(input.events[0]));
  review(input, "ambiguous_event_identity");
  input.events[1].id = "e-other";
  review(input, "formal_source_identity_mismatch");
});

test("模板改变、重复时刻标签与进场晚于开演均不猜测", () => {
  review(
    inputFor("weibo-jadx", (body) => body.replace("OPEN:", "进门:")),
    "unknown_or_ambiguous_time_template",
  );
  review(
    inputFor("weibo-jadx", (body) => body + "\nSTART:19:40"),
    "unknown_or_ambiguous_time_template",
  );
  review(
    inputFor("weibo-season", (body) =>
      body.replace("18:30/19:00", "19:30/19:00"),
    ),
    "unknown_or_ambiguous_time_template",
  );
});

test("单一时刻变化允许，其他未知字段保持不提议", () => {
  const result = evaluateEventPolicy(
    inputFor("weibo-freya", (body) => body.replace("18：15", "18：20")),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].field, "opensAt");
  assert.equal(result.changes[0].after, "18:20");
});

test("独立活动的待审来源不清空其他活动的确定性变化", () => {
  const first = inputFor("weibo-freya", laterFreya);
  const second = inputFor("weibo-season", (body) => body + "\n延期");
  const input = Object.fromEntries(
    Object.entries(first).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value, ...second[key]] : value,
    ]),
  );
  const result = evaluateEventPolicy(input);
  assert.equal(result.status, "review");
  assert.ok(
    result.reasons.includes("cancellation_or_postponement_requires_review"),
  );
  assert.equal(result.changes.length, 2);
  assert.ok(
    result.changes.every((change) => change.eventId === first.events[0].id),
  );
  assert.equal(
    result.captures.find((capture) => capture.registryId === "weibo-freya")
      .status,
    "ready",
  );
});

test("同一活动有待审来源时整活动停线，缺少binding仍按正式URL识别归属", () => {
  for (const retainBinding of [true, false]) {
    const first = inputFor("weibo-freya", laterFreya);
    const second = inputFor("weibo-season", (body) => body + "\n延期");
    first.events[0].sources.push(second.events[0].sources[0]);
    second.bindings[0].eventId = first.events[0].id;
    const input = {
      ...first,
      previousCaptures: [...first.previousCaptures, ...second.previousCaptures],
      currentCaptures: [...first.currentCaptures, ...second.currentCaptures],
      freshCaptureIds: [...first.freshCaptureIds, ...second.freshCaptureIds],
      bindings: [...first.bindings, ...(retainBinding ? second.bindings : [])],
    };
    const result = review(input, "event_has_source_under_review");
    assert.equal(result.captures[0].status, "review");
  }
});

test("重复字段停住整个关联活动，但保留第三个独立活动的变化", () => {
  const first = inputFor("weibo-freya", laterFreya);
  const second = inputFor("weibo-season");
  // 合成同场活动的第二官号：两个模板都拥有相同日期和正式前像。
  second.previousCaptures[0] = recapture(
    second.previousCaptures[0],
    (body) =>
      body.replace("9月11日", "9月10日").replace("18:30/19:00", "18:15/18:30"),
    second.previousCaptures[0].source.observedAt,
  );
  second.currentCaptures[0] = recapture(second.previousCaptures[0], (body) =>
    body.replace("18:15/18:30", "18:20/18:35"),
  );
  second.bindings[0] = {
    ...second.bindings[0],
    eventId: first.events[0].id,
    previousCaptureId: second.previousCaptures[0].captureId,
    previousFields: clone(first.bindings[0].previousFields),
  };
  first.events[0].sources.push(second.events[0].sources[0]);
  const third = inputFor("weibo-jadx", (body) =>
    body.replace("19:15", "19:20"),
  );
  const input = refresh({
    ...first,
    previousCaptures: [
      ...first.previousCaptures,
      ...second.previousCaptures,
      ...third.previousCaptures,
    ],
    currentCaptures: [
      ...first.currentCaptures,
      ...second.currentCaptures,
      ...third.currentCaptures,
    ],
    bindings: [...first.bindings, ...second.bindings, ...third.bindings],
    events: [...first.events, ...third.events],
  });
  const result = evaluateEventPolicy(input);
  assert.ok(
    result.reasons.includes("multiple_sources_change_same_field"),
    JSON.stringify(result),
  );
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].eventId, third.events[0].id);
  assert.ok(
    result.captures.slice(0, 2).every((capture) => capture.status === "review"),
  );
});

test("空采集、采集方法变化、时间顺序冲突均不得声明成功", () => {
  const input = inputFor("weibo-freya", laterFreya);
  input.currentCaptures[0].method = "public-http";
  review(input, "source_capture_method_changed");
  const ordered = inputFor("weibo-freya", laterFreya);
  ordered.events[0].endsAt = "18:35";
  ordered.bindings[0].previousFields.endsAt = "18:35";
  review(ordered, "time_order_requires_review");
  review(
    { ...input, previousCaptures: [], currentCaptures: [] },
    "no_captures_available",
  );
});

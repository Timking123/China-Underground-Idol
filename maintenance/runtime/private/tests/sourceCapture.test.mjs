import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  captureBrowserProof,
  encode,
  extractAggregation,
  selectBody,
  sha256,
  verifyCapture,
} from "../src/sourceCapture.ts";
import {
  registrySource,
  requireRegisteredUrl,
  validateSourceRegistry,
} from "../src/sourceRegistry.ts";

const registry = validateSourceRegistry(
  JSON.parse(
    await readFile(new URL("../sources.v1.json", import.meta.url), "utf8"),
  ),
);
const source = registrySource(registry, "weibo-board");
const now = new Date("2026-09-09T09:00:00Z");
const selection = { start: "正文开始", end: "正文结束", complete: true };
function proof(
  text = "UI 100关注\n正文开始\n2026年\n9/10 上海 免费关注活动 微博正文\n正文结束\nUI点赞200",
) {
  return {
    schemaVersion: "public-browser-source-v1",
    captureMethod: "public-browser-visible-article",
    sourceUrl: source.pinnedUrls[0],
    capturedAt: "2026-09-09T07:00:00Z",
    text,
    textSha256: sha256(text),
    links: [{ text: "微博正文", href: "https://weibo.com/7716940453/123456" }],
  };
}
function capture(input = proof()) {
  return captureBrowserProof(
    input,
    Buffer.from(encode(input)),
    source,
    selection,
    now,
  );
}

test("正文边界保留正文数字及关注文案，排除界面计数", () => {
  const first = capture();
  const next = capture(proof(proof().text.replace("UI点赞200", "UI点赞205")));
  assert.equal(first.bodyText.includes("免费关注"), true);
  assert.equal(first.bodyText.includes("UI"), false);
  assert.equal(first.source.bodySha256, next.source.bodySha256);
  assert.notEqual(first.evidenceSha256, next.evidenceSha256);
  assert.equal(first.source.observedAt, "2026-09-09T07:00:00Z");
});
test("字节、正文hash、注册来源与观察时间均校验", () => {
  const input = proof();
  assert.throws(
    () => captureBrowserProof(input, Buffer.from("{}"), source, selection, now),
    /proof_bytes/,
  );
  assert.throws(() => capture({ ...input, text: "伪造" }), /hash_mismatch/);
  assert.throws(
    () => capture({ ...input, capturedAt: "2026-09-10T00:00:00Z" }),
    /observation_time/,
  );
  assert.throws(
    () => capture({ ...input, capturedAt: "2026-02-30T00:00:00Z" }),
    /observation_time/,
  );
  assert.throws(
    () => verifyCapture({ ...capture(), bodyText: "改写" }, source, now),
    /body_hash/,
  );
  for (const url of [
    "http://weibo.com/7716940453/1",
    "https://weibo.com/other/1",
    "https://weibo.com/7716940453/a?token=x",
    "https://127.0.0.1/x",
    "https://weibo.com/7716940453/a/b",
  ])
    assert.throws(() => requireRegisteredUrl(source, url));
  assert.throws(
    () => selectBody("正文开始重复正文开始正文结束", selection),
    /ambiguous/,
  );
});
test("聚合源日期、链接顺序与共享页面边界", () => {
  const input = proof(
    "正文开始\n2026年\n9/10 上海 A 微博正文\n9/11 上海 A 微博正文\n9/10 上海 A 微博正文\n10/9 北京 窗外\n正文结束",
  );
  input.links = [input.links[0], input.links[0], input.links[0]];
  const result = extractAggregation(capture(input), now);
  assert.deepEqual(result.summary, {
    dateRows: 4,
    matchedLinks: 3,
    uniqueCandidates: 3,
    inWindow: 2,
    focus: 2,
    duplicates: 1,
    missingDetailUrlsInWindow: 0,
  });
  assert.equal(
    result.snapshot.items.every((item) => !item.originalUrlIsUnique),
    true,
  );
  assert.equal(result.snapshot.items[0].fields.venue, undefined);
  const invalid = proof(input.text.replace("2026年\n", ""));
  assert.throws(() => extractAggregation(capture(invalid), now), /yearless/);
  const bad = proof();
  bad.links[0].href = "https://weibo.com/888888/123456";
  assert.throws(() => extractAggregation(capture(bad), now), /link_mismatch/);
});

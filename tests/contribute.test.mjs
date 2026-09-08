import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Node 22.13+ 原生去类型；无需把测试构建产物写入公开仓库。
const source = await readFile(
  new URL("../src/content/contribute.ts", import.meta.url),
  "utf8",
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const {
  buildMailDraft,
  copyDraft,
  TEMPLATES,
  FIELD_LIMITS,
  MAILTO_MAX_LENGTH,
  parseContributionContext,
} = await import(moduleUrl);
const valid = {
  kind: "error",
  target: "测试团体",
  source: "https://example.com/post?id=1&lang=zh-CN",
  details: "请核对名称。",
};

for (const [kind, template] of Object.entries(TEMPLATES)) {
  test(`四类模板：${template.label}`, () => {
    const draft = buildMailDraft({ ...valid, kind });
    assert.ok(draft.subject.includes(template.label));
    assert.ok(draft.body.includes(template.prompt));
    const uri = new URL(draft.mailto);
    assert.equal(uri.pathname, "1243222867@QQ.com");
    assert.deepEqual([...uri.searchParams.keys()], ["subject", "body"]);
    assert.equal(uri.searchParams.get("body"), draft.body);
    assert.equal(uri.searchParams.get("subject"), draft.subject);
  });
}
test("CRLF、编码注入及 HTML 只作为正文文本", () => {
  const attack =
    "名称\r\nBcc: other@example.com\n%0d%0a&cc=x@example.com<script>alert(1)</script>";
  const draft = buildMailDraft({
    ...valid,
    target: attack,
    source: "",
    details: "+ & = ? # % 中文 😀",
  });
  const uri = new URL(draft.mailto);
  assert.equal(draft.subject, buildMailDraft(valid).subject);
  assert.deepEqual([...uri.searchParams.keys()], ["subject", "body"]);
  assert.match(uri.searchParams.get("body"), /<script>alert\(1\)<\/script>/);
  assert.ok(!/[\r\n]/.test(draft.mailto));
  assert.ok(!/(?<!\r)\n|\r(?!\n)/.test(draft.body));
});
test("拒绝不存在及原型链上的模板", () => {
  for (const kind of ["unknown", "__proto__", "constructor", "toString"])
    assert.throws(() => buildMailDraft({ ...valid, kind }), /有效/);
});
test("拒绝空白必填内容", () => {
  assert.throws(() => buildMailDraft({ ...valid, target: " \r\n " }), /填写/);
  assert.throws(() => buildMailDraft({ ...valid, details: "\u0000" }), /填写/);
});
test("各字段长度上限由逻辑再次校验", () => {
  for (const [field, limit] of Object.entries(FIELD_LIMITS))
    assert.throws(
      () => buildMailDraft({ ...valid, [field]: "x".repeat(limit + 1) }),
      /不得超过/,
    );
  assert.doesNotThrow(() =>
    buildMailDraft({
      ...valid,
      target: "字".repeat(160),
      details: "字".repeat(3000),
    }),
  );
});
test("长草稿保留完整正文，关闭过长 mailto", () => {
  const details = "字".repeat(3000);
  const draft = buildMailDraft({ ...valid, details });
  assert.equal(draft.mailto, null);
  assert.ok(draft.text.includes(details));
  assert.ok(buildMailDraft(valid).mailto.length <= MAILTO_MAX_LENGTH);
});
test("来源只接受公开 HTTP(S) URL，允许未提供", () => {
  for (const source of [
    "javascript:alert(1)",
    "data:text/plain,test",
    "file:///tmp/test",
    "//example.com",
    "https://u:p@example.com",
    "https://example.com\r\nBcc:x",
    "not a URL",
  ])
    assert.throws(() => buildMailDraft({ ...valid, source }), /来源/);
  assert.match(buildMailDraft({ ...valid, source: "" }).body, /未提供/);
  assert.doesNotThrow(() =>
    buildMailDraft({ ...valid, source: "http://example.com" }),
  );
});
test("控制字符清理与无效 Unicode 拒绝", () => {
  assert.ok(
    !buildMailDraft({ ...valid, details: "正文\u0000\u0001" }).body.includes(
      "\u0000",
    ),
  );
  for (const text of ["\ud800", "\udfff"])
    assert.throws(
      () => buildMailDraft({ ...valid, details: text }),
      /无效字符/,
    );
});
test("复制成功才报告成功，权限失败和 API 缺失可回退", async () => {
  let copied = "";
  assert.equal(
    await copyDraft("正文", async (value) => {
      copied = value;
    }),
    true,
  );
  assert.equal(copied, "正文");
  assert.equal(
    await copyDraft("正文", async () => {
      throw new Error("permission denied");
    }),
    false,
  );
  assert.equal(await copyDraft("正文"), false);
});
test("无网络上传、浏览器存储或 HTML 注入入口", () => {
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|innerHTML|document\.cookie/,
  );
});
test("页面无脚本时禁用表单，普通脚本支持文件离线打开", async () => {
  const html = await readFile(
    new URL("../contribute.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /id="draft-fields" disabled/);
  assert.match(html, /src="assets\/contribute\.js" defer/);
  assert.doesNotMatch(html, /type="module"|name="(?:target|details|source)"/);
  assert.match(html, /尚未发送，请在邮件客户端检查并发送/);
});

const contextGroups = [
  { id: "g001", name: "测试团体" },
  { id: "g303", name: "历史团体" },
];
const contextEvents = [
  { id: "e-known", title: "测试演出", performers: [{ groupId: "g001" }] },
];
const parseContext = (
  search,
  base = "https://idol.example.org/archive/contribute.html?source=secret#private",
) => parseContributionContext(search, contextGroups, contextEvents, base);

test("纠错入口从已核实 ID 重建本站来源并保留历史团体", () => {
  const result = parseContext(
    "?group=g001&event=e-known&page=events&kind=event",
  );
  assert.equal(result.state, "valid");
  assert.equal(result.kind, "event");
  assert.equal(result.target, "测试团体 · 测试演出 · 演出");
  assert.equal(
    result.source,
    "https://idol.example.org/archive/events.html?group=g001#e-known",
  );
  assert.equal(result.pageLink, "events.html?group=g001#e-known");
  assert.equal(parseContext("?group=g303").target, "历史团体 · 团体档案");
  assert.equal(parseContext("?page=guide&kind=rights").kind, "rights");
  assert.deepEqual(parseContext(""), { state: "none" });
});

test("畸形、重复、未知、超长与不相关 ID 不预填任何字段", () => {
  for (const search of [
    "?group=g999",
    "?group=g001&group=g001",
    "?page=group&page=events",
    "?event=e-missing",
    "?group=g303&event=e-known",
    "?group=G001",
    "?group=",
    "?group=g001%00",
    "?group=%2567001",
    "?group=%E0%A4%A",
    "?page=//evil.org",
    "?page=constructor",
    "?kind=__proto__",
    "?kind=rights&kind=error",
    "?group=g001&source=https://evil.org",
    "?url=javascript:alert(1)",
    "?page=guide%0d%0aBcc:test",
    `?group=g001&x=${"a".repeat(2048)}`,
  ])
    assert.deepEqual(
      parseContext(search),
      { state: "invalid" },
      search.slice(0, 100),
    );
});

test("离线与含凭据的宿主不泄露文件路径或账号，手动填写可继续", () => {
  for (const base of [
    "file:///C:/Users/private/site/contribute.html",
    "https://u:p@example.org/contribute.html",
    "not-url",
  ]) {
    const result = parseContext("?group=g001&page=group", base);
    assert.equal(result.state, "valid");
    assert.equal(result.source, "");
    assert.equal(result.pageLink, "group.html?group=g001");
    assert.ok(!JSON.stringify(result).includes("private"));
  }
  assert.equal(
    parseContributionContext("?group=g001", [], [], "https://example.org")
      .state,
    "invalid",
  );
});

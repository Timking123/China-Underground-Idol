import assert from "node:assert/strict";
import test from "node:test";
import {
  captureHttp,
  collectShowstart,
  extractShowstartHost,
  sanitizePublicHtml,
} from "../src/showstart.ts";
import { sha256 } from "../src/sourceCapture.ts";

const source = {
  id: "showstart-test",
  label: "测试厂牌",
  publisher: "测试",
  kind: "organizer",
  state: "pilot",
  collector: "showstart-public-http",
  pinnedUrls: ["https://www.showstart.com/host/1"],
  allowedUrlPrefixes: ["https://www.showstart.com/event/"],
  note: "测试",
};
const html =
  '<div data-server-rendered="true"><main><p>团体Token公开信息</p><a href="/event/2"><p class="name">活动</p><p class="time">2026/09/10 12:30</p><p class="addr">场地</p></a><button>查看更多</button></main></div><script>window.state={token:"synthetic-token",accessToken:"synthetic-access",cryptoKey:"synthetic-crypto",idToken:"synthetic-id"}</script>';
test("匿名SSR脚本状态在写入归档前移除，公开团名保留", () => {
  const sanitized = sanitizePublicHtml(html);
  for (const key of ["accessToken", "cryptoKey", "idToken", "synthetic-token"])
    assert.equal(sanitized.includes(key), false);
  assert.equal(sanitized.includes("团体Token"), true);
  const proof = {
    schemaVersion: "public-http-source-v1",
    sourceUrl: source.pinnedUrls[0],
    capturedAt: "2026-09-09T07:00:00Z",
    status: 200,
    contentType: "text/html",
    sanitized: "script-and-style-elements-removed",
    rawResponseSha256: sha256(html),
    html: sanitized,
    htmlSha256: sha256(sanitized),
  };
  const capture = captureHttp(proof, source);
  assert.equal(capture.source.completeness, "partial");
  assert.equal(
    extractShowstartHost(proof, capture, new Date("2026-09-09T08:00:00Z")).items
      .length,
    1,
  );
  assert.throws(
    () => captureHttp({ ...proof, html, htmlSha256: sha256(html) }, source),
    /invalid_http/,
  );
});
test("HTTP拒绝页面失败与结构失配，不自动重试", async () => {
  let calls = 0;
  await assert.rejects(
    collectShowstart(source, new Date(), async () => {
      calls++;
      return new Response("blocked", { status: 403 });
    }),
    /public_http_status_403/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    collectShowstart(
      source,
      new Date(),
      async () =>
        new Response("登录验证", { headers: { "content-type": "text/html" } }),
    ),
    /missing_public_ssr_main/,
  );
});
test("单双引号活动卡都解析，已发现但缺日期的卡必须阻断", () => {
  const second =
    "<a href='/event/3'><p class='name'>另一场</p><p class='time'>2026/09/11 13:30</p></a>";
  const proof = (content) => {
    const sanitized = sanitizePublicHtml(content);
    return {
      schemaVersion: "public-http-source-v1",
      sourceUrl: source.pinnedUrls[0],
      capturedAt: "2026-09-09T07:00:00Z",
      status: 200,
      contentType: "text/html",
      sanitized: "script-and-style-elements-removed",
      rawResponseSha256: sha256(content),
      html: sanitized,
      htmlSha256: sha256(sanitized),
    };
  };
  const input = proof(html.replace("</main>", second + "</main>"));
  assert.equal(
    extractShowstartHost(
      input,
      captureHttp(input, source),
      new Date("2026-09-09T08:00:00Z"),
    ).items.length,
    2,
  );
  const changed = proof(
    html.replace(
      "</main>",
      second.replace("class='time'", "class='changed-time'") + "</main>",
    ),
  );
  assert.throws(
    () =>
      extractShowstartHost(
        changed,
        captureHttp(changed, source),
        new Date("2026-09-09T08:00:00Z"),
      ),
    /invalid_or_duplicate_host_event/,
  );
});

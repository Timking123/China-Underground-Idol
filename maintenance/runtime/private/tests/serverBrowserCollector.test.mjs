import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  selectionForVisibleBody,
  uniqueVisiblePrimaryBody,
} from "../server/browserCollector.ts";
import { selectBody } from "../src/sourceCapture.ts";

test("完整可见正文往返，不吸收外围互动数字", () => {
  const body =
    "活动正文第一行\n" + "有日期时刻和票价的公开内容".repeat(30) + "\n最后一行";
  const article = "官号\n" + body + "\n转发 123\n评论 456";
  assert.equal(
    selectBody(article, selectionForVisibleBody(article, body)),
    body,
  );
});
test("缺失或重复正文锚点停止，不标记完整", () => {
  const body = "测试完整正文与唯一锚点".repeat(8);
  assert.throws(
    () => selectionForVisibleBody("没有正文", body),
    /not_in_article/,
  );
  assert.throws(() => selectionForVisibleBody(body + body, body), /ambiguous/);
});

test("本地微博DOM只识别主正文，嵌入转发卡不造成歧义", async (t) => {
  // 默认使用 Playwright 配套浏览器；本机也可指定已安装的浏览器 channel，不固定路径。
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_TEST_CHANNEL || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const body =
    "主正文开始\n日期 2026-09-10、进场 18:15、开演 18:30、票价 48 元。\n主正文结束";
  const main = `<div class="_text_1h76l_2 _ogText_1h76l_43 wbpro-feed-ogText"><div class="_wbtext_1h76l_19" style="white-space:pre-wrap">${body}</div></div>`;
  const card =
    '<div class="woo-box-flex feed-card-original _wrap_3pz7a_7"><div class="woo-box-item-flex _wbtext_3pz7a_64 _mid_3pz7a_35">嵌入转发卡的摘要，不能冒充主正文。</div></div>';
  await t.test("完整主正文和嵌入卡同时可见", async () => {
    await page.setContent(`<article>合成发布者${main}${card}</article>`);
    const article = page.locator("article");
    assert.equal(await article.locator("div[class*='_wbtext_']").count(), 2);
    const selected = await uniqueVisiblePrimaryBody(article);
    assert.equal(await selected.innerText(), body);
    const articleText = await article.innerText();
    assert.equal(
      selectBody(articleText, selectionForVisibleBody(articleText, body)),
      body,
    );
  });
  await t.test("重复主正文仍拒绝，即使文本完全相同", async () => {
    await page.setContent(`<article>${main}${main}${card}</article>`);
    await assert.rejects(
      uniqueVisiblePrimaryBody(page.locator("article")),
      /browser_body_template_changed/u,
    );
  });
  await t.test("只有嵌入卡或非直接子节点也不能充当主正文", async () => {
    for (const html of [
      card,
      `<div class="wbpro-feed-ogText"><section><div class="_wbtext_nested_1">${body}</div></section></div>`,
    ]) {
      await page.setContent(`<article>${html}</article>`);
      await assert.rejects(
        uniqueVisiblePrimaryBody(page.locator("article")),
        /browser_body_template_changed/u,
      );
    }
  });
  await t.test("唯一但隐藏的主正文拒绝", async () => {
    await page.setContent(
      `<article><section hidden>${main}</section>${card}</article>`,
    );
    await assert.rejects(
      uniqueVisiblePrimaryBody(page.locator("article")),
      /browser_body_not_visible/u,
    );
  });
});

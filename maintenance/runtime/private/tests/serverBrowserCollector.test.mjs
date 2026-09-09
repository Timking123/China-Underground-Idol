import test from "node:test";
import assert from "node:assert/strict";
import { selectionForVisibleBody } from "../server/browserCollector.ts";
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, script, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8"),
]);

// 跳转目标必须可接收焦点，并为桌面端粘性顶栏预留滚动空间。
assert.match(
  html,
  /<h2 id="map-heading" tabindex="-1">/u,
  "分布图跳转目标应可通过脚本聚焦",
);
assert.match(
  styles,
  /\.map-heading-row h2\s*\{[^}]*scroll-margin-top:\s*180px;/su,
  "分布图跳转目标应避开桌面端粘性顶栏",
);

// 键盘焦点离开某个控件时，搜索与地域浮层必须保持互斥。
assert.match(
  script,
  /document\.addEventListener\("focusin",[\s\S]*?\.search-control[\s\S]*?closeSearchResults\(\)[\s\S]*?\.region-filter[\s\S]*?setRegionPopover\(false\)/u,
  "键盘焦点切换时应关闭不再相关的浮层",
);
assert.match(
  script,
  /function setRegionPopover\(open\)\s*\{\s*if \(open\) closeSearchResults\(\);/u,
  "打开地域浮层前应关闭搜索结果",
);

console.log("可访问性回归契约：PASS");

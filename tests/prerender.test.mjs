import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { renderGroup, renderEvent, escapeHtml } from "../scripts/prerender.mjs";
import { safePath } from "../scripts/mediaFiles.mjs";
import { timeHtml } from "../scripts/prerenderFormat.mjs";

const group = {
  id: "g001",
  name: "档案 <测试>",
  handle: "公开官号",
  aliases: [],
  status: "活跃",
  founding: { province: "上海", city: "上海" },
  activity: { province: "上海", city: "上海" },
  styleLabel: "摇滚",
  styleNote: "资料说明",
  tags: [],
  avatar: null,
  visual: null,
  officialUrl: "javascript:alert(1)",
  wikiUrl: null,
  followers: null,
  sources: [
    {
      label: "来源",
      url: "https://weibo.com/test",
      observedAt: "2026-09-01",
      note: "来源注记",
    },
  ],
  isActive: true,
  styleState: "editorial",
};
const catalog = {
  schemaVersion: "idol-catalog-v1",
  archiveDate: "2026-09-01",
  groups: [group],
};
const event = {
  id: "e-real-123",
  title: "活动 & <script>alert(1)</script>",
  date: "2026-09-20",
  province: "上海",
  city: "上海",
  venue: "测试场地",
  address: null,
  opensAt: null,
  startsAt: null,
  endsAt: null,
  status: "cancelled",
  performers: [{ groupId: "g001", name: group.name }],
  sources: [
    {
      label: "官宣",
      url: "https://weibo.com/test",
      publisher: "主办",
      observedAt: "2026-09-01T00:00:00Z",
      kind: "official",
    },
  ],
  notes: "原始说明\n完整正文",
  poster: null,
};
const dataset = {
  schemaVersion: "idol-events-v1",
  updatedAt: "2026-09-01T00:00:00Z",
  coverage: "partial",
  events: [event],
};
const manifest = { images: {} };

test("团体静态正文、独立标题、规范链接和旧 URL 不依赖 JS", () => {
  const html = renderGroup(
    group,
    catalog,
    dataset,
    manifest,
    "https://idol.hi-veblen.com/",
  );
  assert.match(html, /<h1>档案 &lt;测试&gt;<\/h1>/);
  assert.match(html, /<title>档案 &lt;测试&gt; · 团体档案<\/title>/);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/idol.hi-veblen.com\/groups\/g001.html"/,
  );
  assert.match(html, /group.html\?group=g001/);
  assert.match(html, /href="..\/events\/e-real-123.html"/);
  assert.match(html, /来源注记/);
  assert.match(html, /<script src="..\/assets\/metrics.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script>|javascript:/);
});

test("活动静态页保留取消、未知时刻、完整说明和来源", () => {
  const html = renderEvent(
    event,
    dataset,
    manifest,
    "https://idol.hi-veblen.com/",
  );
  assert.match(html, /已取消/);
  assert.match(html, /<dt>开演<\/dt><dd>尚未核实<\/dd>/);
  assert.match(html, /原始说明\n完整正文/);
  assert.match(html, /og:url/);
  assert.match(html, /href="..\/groups\/g001.html"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /日期已过不代表活动已举办/);
});

test("HTML 文本及属性统一转义", () => {
  assert.equal(
    escapeHtml("<a \"x\" 'y'>&"),
    "&lt;a &quot;x&quot; &#39;y&#39;&gt;&amp;",
  );
});

test("观察时间跨 UTC+8 日期并保留机器可读原值", () => {
  const html = timeHtml("2026-09-18T23:10:33.896Z");
  assert.match(html, /datetime="2026-09-18T23:10:33.896Z"/);
  assert.match(html, /2026年9月19日 07:10（UTC\+8）/);
  assert.match(timeHtml("2026-09-18"), />2026年9月18日<\/time>/);
  assert.equal(timeHtml(null), "尚未收录");
});

test("生成文件路径拒绝越界和绝对路径", async () => {
  for (const relative of [
    "../data.js",
    "assets/../../bad",
    "C:/bad",
    "/bad",
    "assets//bad",
    "assets/./bad",
    "assets/bad\n",
  ])
    await assert.rejects(
      safePath(process.cwd(), relative, { write: true }),
      /非法生成路径/,
    );
});

test("单页加载拒绝错误编号、错页、无关事件和损坏响应", async () => {
  const compiled = await build({
    entryPoints: ["src/media/pageData.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const model = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
  const validGroup = { ...group, officialUrl: "https://weibo.com/test" };
  const payload = {
    schemaVersion: "idol-group-page-v1",
    catalog: { ...catalog, groups: [validGroup] },
    events: dataset,
  };
  const fetcher = async () => ({ ok: true, json: async () => payload });
  assert.equal(
    (await model.loadGroupPage("g001", fetcher)).catalog.groups[0].id,
    "g001",
  );
  await assert.rejects(model.loadGroupPage("../g001", fetcher), /编号无效/);
  await assert.rejects(model.loadGroupPage("g001\n", fetcher), /编号无效/);
  await assert.rejects(model.loadGroupPage("g002", fetcher), /关联校验失败/);
  await assert.rejects(
    model.loadGroupPage("g001", async () => ({ ok: false })),
    /无法读取/,
  );
  await assert.rejects(
    model.loadGroupPage("g001", async () => ({
      ok: true,
      json: async () => ({}),
    })),
    /格式无效/,
  );
  payload.events = {
    ...dataset,
    events: [{ ...event, performers: [{ groupId: "g002", name: "无关团体" }] }],
  };
  await assert.rejects(model.loadGroupPage("g001", fetcher), /关联校验失败/);
});

test("图片校验发现原图/变体损坏和丢失", async () => {
  const { validateMedia, MEDIA_MANIFEST } =
    await import("../scripts/validateMedia.mjs");
  const full = JSON.parse(await readFile(MEDIA_MANIFEST, "utf8"));
  const [src, entry] = Object.entries(full.images)[0];
  const report = path.resolve("reports/city-upgrade-c");
  await mkdir(report, { recursive: true });
  const root = await mkdtemp(path.join(report, "media-test-"));
  const put = async (relative, value) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), value);
  };
  await put(src, await readFile(src));
  for (const variant of entry.variants)
    await put(variant.src, await readFile(variant.src));
  await put(
    MEDIA_MANIFEST,
    JSON.stringify({ ...full, images: { [src]: entry } }),
  );
  assert.equal(
    (await validateMedia(root)).files.length,
    entry.variants.length + 1,
  );
  await put(entry.variants[0].src, "corrupt");
  await assert.rejects(validateMedia(root), /变体损坏/);
  await put(src, "changed");
  await assert.rejects(validateMedia(root), /原图已变更/);
  await put(src, await readFile(src));
  await unlink(path.join(root, entry.variants[0].src));
  await assert.rejects(validateMedia(root), { code: "ENOENT" });
});

test("零阵容有明确空态，未知时刻不伪装尚未公布", () => {
  const html = renderEvent(
    { ...event, performers: [] },
    dataset,
    manifest,
    "https://idol.hi-veblen.com/",
  );
  assert.match(html, /尚未收录可核对的出演阵容/);
  assert.match(html, /<dt>入场<\/dt><dd>尚未核实<\/dd>/);
});

test("响应式图片保留完整比例、有限尺寸和旧图降级", async () => {
  const compiled = await build({
    entryPoints: ["src/media/images.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const model = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
  const variants = JSON.parse(
    await readFile("src/media/variants.json", "utf8"),
  );
  const [src, entry] = Object.entries(variants).find(
    ([, entry]) => entry.width > 960,
  );
  const result = model.responsiveImage(src, { kind: "detail", prefix: "../" });
  assert.equal(result.width, entry.width);
  assert.equal(result.height, entry.height);
  assert.ok(result.src.startsWith("../assets/media-optimized/"));
  assert.ok(
    entry.variants.every(
      (variant) => variant.width <= 640 && variant.width <= entry.width,
    ),
  );
  assert.equal(
    model.responsiveImage("assets/new.jpg", { kind: "card" }).src,
    "assets/new.jpg",
  );
});

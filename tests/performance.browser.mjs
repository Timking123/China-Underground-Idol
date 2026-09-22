import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generatePrerender } from "../scripts/prerender.mjs";
import { validateMedia } from "../scripts/validateMedia.mjs";
import { safePath } from "../scripts/mediaFiles.mjs";

// 同机、同压缩、冷上下文、同视口/DPR；结果不外推并发或公网速度。
const root = process.cwd();
const report = path.join(root, "reports/city-upgrade-c");
const outputRoot = path.join(report, "generated");
await mkdir(outputRoot, { recursive: true });
const generated = await generatePrerender(root, { outputRoot });
const { manifest, files: mediaFiles } = await validateMedia(root);
const generatedFiles = new Set(generated.files);
const mediaSet = new Set(mediaFiles);
const legacyFiles = [
  "group.html",
  "app.css",
  "styles/site.css",
  "styles/groups.css",
  "assets/groups-data.js",
  "assets/group.js",
  "assets/metrics.js",
];
const baseline = new Map(
  legacyFiles.map((name) => [
    name,
    execFileSync("git", ["show", `817ed1c:${name}`], {
      maxBuffer: 20 * 1024 * 1024,
    }),
  ]),
);
const observed = [];
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const name = decodeURIComponent(url.pathname).slice(1);
    const legacy = name.startsWith("baseline/");
    const relative = legacy ? name.slice(9) : name;
    let body;
    if (legacy && baseline.has(relative)) body = baseline.get(relative);
    else if (!legacy && generatedFiles.has(relative))
      body = await readFile(await safePath(outputRoot, relative));
    else if (
      mediaSet.has(relative) ||
      Object.hasOwn(manifest.images, relative) ||
      ["app.css", "styles/site.css", "assets/metrics.js"].includes(relative)
    )
      body = await readFile(await safePath(root, relative));
    else {
      response.writeHead(404).end("未找到");
      return;
    }
    const type = mime[path.extname(relative)] || "application/octet-stream";
    const compressible = /text|json/.test(type);
    const encoded = compressible ? gzipSync(body, { level: 9 }) : body;
    observed.push({
      url: url.pathname,
      raw: body.length,
      gzip: compressible ? encoded.length : body.length,
      brotli: compressible ? brotliCompressSync(body).length : body.length,
    });
    response
      .writeHead(200, {
        "Content-Type": type,
        "Content-Length": encoded.length,
        "Cache-Control": "no-store",
        ...(compressible ? { "Content-Encoding": "gzip" } : {}),
      })
      .end(encoded);
  } catch {
    response.writeHead(404).end("未找到");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
const results = [];
try {
  for (const width of [375, 1440]) {
    for (const [label, entry] of [
      ["baseline", "/baseline/group.html?group=g001"],
      ["prerender", "/groups/g001.html"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      await context.addInitScript(() =>
        Object.defineProperty(navigator, "doNotTrack", {
          value: "1",
          configurable: true,
        }),
      );
      const page = await context.newPage();
      const start = observed.length;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}${entry}`, { waitUntil: "networkidle" });
      await page.locator("h1").waitFor();
      assert.ok((await page.locator("h1").innerText()).length > 0);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      const image = await page
        .locator("main img")
        .first()
        .evaluate((node) => ({
          src: node.currentSrc,
          width: node.naturalWidth,
          height: node.naturalHeight,
        }))
        .catch(() => null);
      assert.ok(image?.width > 0, "真实图片应已加载");
      // 先冻结首屏请求；全页截图会临时改变布局，不能混入首屏体积。
      const requests = observed.slice(start);
      if (label === "prerender") {
        assert.equal(
          await page.locator("link[rel=canonical]").getAttribute("href"),
          "https://idol.hi-veblen.com/groups/g001.html",
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent),
          "跳至正文",
        );
      }
      // 固定最终截图视口并等待图片解码，避免全页截图临时重排时抓到空图。
      await page.setViewportSize({
        width,
        height: await page.evaluate(
          () => document.documentElement.scrollHeight,
        ),
      });
      await page
        .locator("main img")
        .first()
        .evaluate((image) => image.decode());
      await page.screenshot({
        path: path.join(report, `${label}-${width}.png`),
        fullPage: false,
      });
      results.push({
        label,
        width,
        dpr: 1,
        requests,
        totals: {
          count: requests.length,
          rawBytes: requests.reduce((sum, item) => sum + item.raw, 0),
          gzipBodyBytes: requests.reduce((sum, item) => sum + item.gzip, 0),
          brotliEstimatedBodyBytes: requests.reduce(
            (sum, item) => sum + item.brotli,
            0,
          ),
        },
        image,
        errors,
      });
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 1000 },
  });
  const page = await context.newPage();
  const eventPath = generated.files.find((file) => file.startsWith("events/"));
  const response = await page.goto(`${origin}/${eventPath}`);
  assert.equal(response.status(), 200);
  assert.ok(await page.locator("main").innerText());
  assert.ok(await page.locator("main a[href^='https://']").count());
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(report, "event-no-js-375.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(report, "event-no-js-1440.png"),
    fullPage: true,
  });
  await page.locator("details").first().locator("summary").click();
  assert.equal(await page.locator("details").first().getAttribute("open"), "");
  assert.equal(
    await page.locator("details").first().locator("a").first().isVisible(),
    true,
  );
  // 每份 HTML 的站内链接必须落在本轮生成物或现有站点文件，禁止假详情入口。
  let internalLinks = 0;
  for (const file of generated.files.filter((name) => name.endsWith(".html"))) {
    const html = await readFile(path.join(outputRoot, file), "utf8");
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = new URL(
        match[1].replaceAll("&amp;", "&"),
        `${origin}/${file}`,
      );
      if (target.origin !== origin || match[1].startsWith("#")) continue;
      const relative = decodeURIComponent(target.pathname.slice(1));
      if (!generatedFiles.has(relative) && !mediaSet.has(relative))
        await safePath(root, relative);
      internalLinks++;
    }
  }
  assert.ok(internalLinks > generated.counts.groups);
  console.log(`静态 HTML 站内链接已验证：${internalLinks}`);
  assert.equal(
    (await context.request.get(`${origin}/groups/g99999999.html`)).status(),
    404,
  );
  assert.equal(
    (
      await context.request.get(
        `${origin}/assets/page-data/groups/g99999999.json`,
      )
    ).status(),
    404,
  );
  await context.close();
  // 发行目录的 file:// 退化场景：静态正文、图片与 CSS 均无需服务器。
  const offlineHtml = await readFile(
    path.join(outputRoot, "groups/g001.html"),
    "utf8",
  );
  const offlineMedia = [
    ...new Set(
      [
        ...offlineHtml.matchAll(
          /\.\.\/(assets\/media-optimized\/[a-f0-9-]+\.webp)/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
  for (const file of ["app.css", "styles/site.css", ...offlineMedia]) {
    await mkdir(path.dirname(path.join(outputRoot, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(outputRoot, file));
  }
  const offline = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 1000 },
  });
  const offlinePage = await offline.newPage();
  await offlinePage.goto(
    pathToFileURL(path.join(outputRoot, "groups/g001.html")).href,
  );
  assert.ok(await offlinePage.locator("main h1").innerText());
  assert.ok(
    await offlinePage
      .locator("main img")
      .evaluate((image) => image.naturalWidth > 0),
  );
  assert.equal(
    await offlinePage.locator("a[href='../group.html?group=g001']").count(),
    1,
  );
  await offline.close();
  await writeFile(
    path.join(report, "performance-browser.json"),
    JSON.stringify(
      {
        baseline: "817ed1c",
        conditions:
          "本机 Edge；375/1440×1000；DPR1；独立冷上下文；DNT1（双方均保留统计脚本）；同 gzip9；无滚动；body 字节不含 HTTP 头；Brotli 仅离线计算",
        counts: generated.counts,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    JSON.stringify(
      results.map(({ label, width, totals }) => ({ label, width, totals })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

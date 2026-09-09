import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  captureBrowserProof,
  encode,
  sha256,
  type BodySelection,
  type BrowserSourceProof,
} from "../src/sourceCapture.ts";
import { requireState, type RegisteredSource } from "../src/sourceRegistry.ts";

/** 正文来自唯一可见的完整正文节点，首尾锚点仅用于原管线的证据重建。 */
export function selectionForVisibleBody(
  article: string,
  body: string,
): BodySelection {
  requireState(
    body.trim().length > 30 && body.length <= 100_000,
    "browser_body_size",
  );
  requireState(article.includes(body), "browser_body_not_in_article");
  const start = body.slice(0, Math.min(120, Math.floor(body.length / 2)));
  const end = body.slice(-Math.min(120, Math.floor(body.length / 2)));
  for (const marker of [start, end])
    requireState(
      article.indexOf(marker) === article.lastIndexOf(marker),
      "browser_body_ambiguous",
    );
  return { start, end, complete: true };
}

export async function collectBrowserSource(
  source: RegisteredSource,
  profileRoot: string,
) {
  requireState(
    source.collector === "manual-browser" && source.pinnedUrls.length === 1,
    "browser_source_not_supported",
  );
  const url = source.pinnedUrls[0];
  requireState(
    /^https:\/\/weibo\.com\/\d{4,20}\/[A-Za-z0-9]+$/u.test(url),
    "browser_url_rejected",
  );
  await mkdir(resolve(profileRoot), { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(resolve(profileRoot), {
    headless: true,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1280, height: 1000 },
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    requireState(response?.ok(), "browser_source_http_failure");
    await page
      .locator("article")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    requireState(
      new URL(page.url()).origin === "https://weibo.com",
      "browser_source_login_required",
    );
    const articles = page.locator("article");
    requireState((await articles.count()) === 1, "browser_article_ambiguous");
    const article = articles.first();
    const expand = article.getByText("展开", { exact: true });
    if ((await expand.count()) === 1 && (await expand.isVisible())) {
      await expand.click();
      await expand.waitFor({ state: "hidden", timeout: 15_000 });
    }
    const content = article.locator("div[class*='_wbtext_']");
    requireState(
      (await content.count()) === 1,
      "browser_body_template_changed",
    );
    requireState(
      !(await expand.isVisible().catch(() => false)),
      "browser_body_incomplete",
    );
    const articleText = await article.innerText();
    requireState(
      articleText.includes(source.publisher),
      "browser_publisher_mismatch",
    );
    const bodyText = (await content.innerText())
      .replace(/\n?收起\s*$/u, "")
      .trim();
    const selection = selectionForVisibleBody(articleText, bodyText);
    const links = await article.locator("a").evaluateAll((elements) =>
      elements.map((element) => ({
        text: (element as HTMLElement).innerText,
        href: (element as HTMLAnchorElement).href,
      })),
    );
    const proof: BrowserSourceProof = {
      schemaVersion: "public-browser-source-v1",
      sourceUrl: url,
      capturedAt: new Date().toISOString(),
      captureMethod: "public-browser-visible-article",
      text: articleText,
      textSha256: sha256(articleText),
      links,
    };
    const bytes = Buffer.from(encode(proof));
    const capture = captureBrowserProof(
      proof,
      bytes,
      source,
      selection,
      new Date(),
    );
    return {
      capture,
      proof: {
        captureId: capture.captureId,
        sha256: sha256(bytes),
        bytesBase64: bytes.toString("base64"),
      },
    };
  } catch (error) {
    // 不把浏览器异常中的页面响应或配置写进通知。
    const code =
      error instanceof Error && /^browser_[a-z_]+$/u.test(error.message)
        ? error.message
        : "browser_source_unavailable";
    throw new Error(code, { cause: error });
  } finally {
    await context.close();
  }
}

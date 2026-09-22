export const publicPages = [
  "index",
  "discover",
  "geography",
  "groups",
  "group",
  "events",
  "guide",
  "contribute",
  "about",
  "city",
  "favorites",
  "subscriptions",
  "updates",
] as const;

declare const __PUBLIC_METRICS_PAGES__: readonly string[];

/** 发送前剥除查询、片段与来源路径；生成页精确清单由本次构建注入。 */
export function publicVisit(
  href: string,
  referrer: string,
  generatedPages: readonly string[] = typeof __PUBLIC_METRICS_PAGES__ ===
  "undefined"
    ? []
    : __PUBLIC_METRICS_PAGES__,
): { path: string; referrer: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  if (
    !publicPages.some((page) => path === `/${page}.html`) &&
    !generatedPages.includes(path)
  )
    return null;
  let origin = "";
  try {
    const from = new URL(referrer);
    // 保留协议以兼容 API 的 URL 校验，只含域名，不带端口、账号和路径。
    if (["http:", "https:"].includes(from.protocol))
      origin = `${from.protocol}//${from.hostname}`;
  } catch {
    /* 空来源或无效来源按直接访问处理。 */
  }
  return { path, referrer: origin };
}

import { publicVisit } from "./visit";

// 不使用第三方脚本、Cookie、本地持久化或精确定位；每个可见文档最多发送一次。
let sent = false;
async function recordVisit(): Promise<void> {
  if (
    sent ||
    document.visibilityState !== "visible" ||
    navigator.doNotTrack === "1" ||
    !window.crypto.randomUUID
  )
    return;
  const visit = publicVisit(window.location.href, document.referrer);
  if (!visit) return;
  sent = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/v1/pageviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      keepalive: true,
      body: JSON.stringify({ id: window.crypto.randomUUID(), ...visit }),
      signal: controller.signal,
    });
    // 完整消费小型确认响应后再取消超时，避免未消费的流持续占用请求连接。
    await response.text();
  } catch {
    /* 统计不可用不影响阅读，不自动重试增加访问量。 */
  } finally {
    window.clearTimeout(timeout);
  }
}
document.addEventListener("visibilitychange", () => {
  void recordVisit();
});
void recordVisit();

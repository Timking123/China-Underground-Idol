"use strict";
(() => {
  // src/metrics/visit.ts
  var publicPages = [
    "index",
    "discover",
    "geography",
    "groups",
    "group",
    "events",
    "guide",
    "contribute",
    "about"
  ];
  function publicVisit(href, referrer) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return null;
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!publicPages.some((page) => path === `/${page}.html`)) return null;
    let origin = "";
    try {
      const from = new URL(referrer);
      if (["http:", "https:"].includes(from.protocol))
        origin = `${from.protocol}//${from.hostname}`;
    } catch {
    }
    return { path, referrer: origin };
  }

  // src/metrics/page.ts
  var sent = false;
  async function recordVisit() {
    if (sent || document.visibilityState !== "visible" || navigator.doNotTrack === "1" || !window.crypto.randomUUID)
      return;
    const visit = publicVisit(window.location.href, document.referrer);
    if (!visit) return;
    sent = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8e3);
    try {
      const response = await fetch("/api/v1/pageviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        keepalive: true,
        body: JSON.stringify({ id: window.crypto.randomUUID(), ...visit }),
        signal: controller.signal
      });
      await response.text();
    } catch {
    } finally {
      window.clearTimeout(timeout);
    }
  }
  document.addEventListener("visibilitychange", () => {
    void recordVisit();
  });
  void recordVisit();
})();

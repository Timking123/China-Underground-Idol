import rawState from "../../data/feed-state.v1.json";
import { readCatalog } from "../catalog/runtime";
import { getPreferences, storageMessage } from "../preferences/browser";
import {
  buildFeedManifest,
  buildSubscriptionIcs,
  recordsForScope,
  validateFeedState,
  type FeedManifestEntry,
} from "./model";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少页面元素：${id}`);
  return node as T;
}

function start(): void {
  const status = element("feeds-load-state");
  try {
    const catalog = readCatalog();
    if (!catalog.valid) throw new Error(catalog.errors.join("；"));
    const state = validateFeedState(rawState);
    const manifest = buildFeedManifest(catalog.data, state);
    const store = getPreferences();
    const type = element<HTMLSelectElement>("feed-type");
    const range = element<HTMLSelectElement>("feed-range");
    const following = element<HTMLInputElement>("feed-following");
    const url = element<HTMLInputElement>("feed-url");
    const download = element<HTMLButtonElement>("feed-download");
    const actionStatus = element("feed-action-status");
    const protocol = window.location.protocol;
    const isHttp = protocol === "http:" || protocol === "https:";
    const params = new URLSearchParams(window.location.search);
    type.value = params.get("type") === "group" ? "group" : "city";
    following.checked = params.get("following") === "1";
    let selected: FeedManifestEntry | undefined;
    let desired = params.get("id");
    const renderSelection = (): void => {
      selected = manifest.feeds.find(
        (feed) => feed.type === type.value && feed.id === range.value,
      );
      download.disabled = !selected;
      element("feed-http-actions").hidden = !selected || !isHttp;
      element("feed-selected-name").textContent =
        selected?.label ?? "当前没有可选范围";
      const records = selected ? recordsForScope(state, selected) : [];
      const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const upcoming = records.filter(
        (record) =>
          record.snapshot.event.date >= today &&
          !record.snapshot.withdrawn &&
          !["cancelled", "postponed"].includes(record.snapshot.event.status),
      ).length;
      element("feed-count").textContent = selected
        ? `已收录 ${records.length} 条记录，其中 ${upcoming} 条为今日或未来安排（仍需核对状态）。历史与撤下记录保留以便追踪更正。`
        : "可以取消关注筛选，或先到「我的关注」添加范围。";
      element("feed-mode").textContent = !isHttp
        ? "当前从本地文件打开。请下载 ICS 后手动导入；file 地址不能作为日历订阅网址。"
        : ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
          ? "当前是本机预览地址，仅用于本机 HTTP 验证。手机无法通过此地址访问；可先下载手动导入。"
          : "复制固定地址，在日历应用中选择通过网址订阅。客户端自行决定何时刷新。";
      if (selected && isHttp) {
        url.value = new URL(selected.path, window.location.href).href;
        element<HTMLAnchorElement>("feed-open").href = url.value;
      }
      actionStatus.textContent = "";
      const next = new URL(window.location.href);
      next.search = "";
      next.searchParams.set("type", type.value);
      if (selected) next.searchParams.set("id", selected.id);
      if (following.checked) next.searchParams.set("following", "1");
      try {
        window.history.replaceState(null, "", next);
      } catch {
        /* file 或受限上下文保留当前选择。 */
      }
    };
    const renderOptions = (): void => {
      const saved = desired ?? range.value;
      desired = null;
      const prefs = store.read();
      const related = (feed: FeedManifestEntry): boolean =>
        (feed.type === "group" && prefs.group.includes(feed.id)) ||
        (feed.type === "city" && prefs.city.includes(feed.id)) ||
        state.records.some(
          (record) =>
            prefs.event.includes(record.snapshot.event.id) &&
            record.scopes.some(
              (scope) => scope.type === feed.type && scope.id === feed.id,
            ),
        );
      const options = manifest.feeds.filter(
        (feed) =>
          feed.type === type.value && (!following.checked || related(feed)),
      );
      range.replaceChildren(
        ...options.map((feed) => new Option(feed.label, feed.id)),
      );
      range.disabled = options.length === 0;
      if (options.some((feed) => feed.id === saved)) range.value = saved;
      element("feed-range-state").textContent = options.length
        ? `${options.length} 个可选${type.value === "city" ? "城市" : "团体"}。尚未收录演出的范围也有固定地址。`
        : "尚未关注此类范围，或当前范围尚未收录。";
      element("feed-storage").textContent = storageMessage();
      renderSelection();
    };
    type.addEventListener("change", renderOptions);
    following.addEventListener("change", renderOptions);
    range.addEventListener("change", renderSelection);
    store.subscribe(renderOptions);
    element("feed-copy").addEventListener("click", () => {
      if (!selected || !isHttp) return;
      void (async () => {
        try {
          await navigator.clipboard.writeText(url.value);
          actionStatus.textContent =
            "已复制订阅地址。请在日历应用中添加网址订阅。";
        } catch {
          url.focus();
          url.select();
          actionStatus.textContent =
            "浏览器未允许自动复制。地址已选中，可手动复制。";
        }
      })();
    });
    download.addEventListener("click", () => {
      if (!selected) return;
      const blob = new Blob([buildSubscriptionIcs(selected, state)], {
        type: "text/calendar;charset=utf-8",
      });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = selected.path.split("/").at(-1) ?? "idol-calendar.ics";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      actionStatus.textContent =
        "已请求下载 ICS 文件。手动导入不会自动跟随以后修订。";
    });
    renderOptions();
    if (
      params.has("id") &&
      !manifest.feeds.some(
        (feed) => feed.id === params.get("id") && feed.type === type.value,
      )
    )
      status.textContent = "链接中的订阅范围未收录，已显示可用范围。";
    else status.hidden = true;
    element("feeds-workspace").hidden = false;
  } catch {
    status.textContent =
      "订阅资料读取失败，请刷新重试。当前不能生成可靠日历；仍可到演出页查看来源。";
  }
}
start();

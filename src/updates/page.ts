import rawUpdates from "../../data/updates.v1.json";
import { getPreferences, storageMessage } from "../preferences/browser";
import {
  formatUpdateValue,
  selectUpdates,
  updateFieldLabel,
  validateUpdates,
  type UpdateEntry,
} from "./model";

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少页面元素：${id}`);
  return found as T;
}
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function renderEntry(entry: UpdateEntry): HTMLLIElement {
  const row = node("li", "", "updates-entry");
  const time = node(
    "time",
    dateFormatter.format(new Date(entry.recordedAt)),
    "updates-time",
  );
  time.dateTime = entry.recordedAt;
  const content = node("article", "", "updates-content");
  const kinds = {
    added: "新增收录",
    changed: "资料修订",
    withdrawn: "资料撤下 · 非取消结论",
    restored: "恢复收录",
  };
  content.append(
    node(
      "span",
      `${kinds[entry.kind]} · 第 ${entry.sequence} 次修订`,
      "updates-kind",
    ),
  );
  const title = node("h2");
  const link = node("a", entry.title);
  link.href = `events.html?event=${encodeURIComponent(entry.eventId)}`;
  title.append(link);
  content.append(
    title,
    node("p", entry.reason),
    node("p", entry.scopes.map((scope) => scope.label).join(" · ")),
  );
  const details = node("details");
  details.append(node("summary", `查看 ${entry.changes.length} 项差异与来源`));
  const changes = node("dl", "", "updates-diff");
  for (const change of entry.changes) {
    const item = node("div");
    item.append(
      node("dt", updateFieldLabel(change.field)),
      node("dd", `修订前：${formatUpdateValue(change.before, change.field)}`),
      node("dd", `修订后：${formatUpdateValue(change.after, change.field)}`),
    );
    changes.append(item);
  }
  const sources = node("ul", "", "updates-sources");
  for (const source of entry.sources) {
    const item = node("li");
    const sourceLink = node("a", source.label);
    sourceLink.href = source.url;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    item.append(
      sourceLink,
      document.createTextNode(
        ` · 资料观察时间 ${dateFormatter.format(new Date(source.observedAt))}`,
      ),
    );
    sources.append(item);
  }
  details.append(
    changes,
    node(
      "p",
      "以下为关联公开资料；字段变更以差异及审核原因为准。撤下记录的旧来源不证明活动取消。",
      "feeds-muted",
    ),
    sources,
    node(
      "p",
      `修订前 SHA-256：${entry.beforeHash ?? "无（新增记录）"}\n修订后 SHA-256：${entry.afterHash}`,
      "updates-hash",
    ),
  );
  content.append(details);
  row.append(time, content);
  return row;
}

function start(): void {
  const status = element("updates-status");
  try {
    const data = validateUpdates(rawUpdates);
    const store = getPreferences();
    const following = element<HTMLInputElement>("updates-following");
    following.checked =
      new URLSearchParams(window.location.search).get("following") === "1";
    let limit = 20;
    const render = (): void => {
      const prefs = store.read();
      const entries = selectUpdates(
        data,
        { groups: prefs.group, cities: prefs.city, events: prefs.event },
        following.checked,
      );
      element("updates-list").replaceChildren(
        ...entries.slice(0, limit).map(renderEntry),
      );
      element("updates-empty").hidden = entries.length !== 0;
      element("updates-empty-heading").textContent =
        following.checked && data.entries.length
          ? "关注范围内尚无新修订"
          : "尚无可追溯的新修订";
      element("updates-empty-copy").textContent =
        following.checked && data.entries.length
          ? "关注团体、城市或演出后，相关变化会汇集在这里。也可以取消筛选查看全部记录。"
          : "更新记录从本次启用开始保留。已有资料不补记为刚刚新增，有真实变更后才会显示在这里。";
      status.textContent = `${entries.length} 条${following.checked ? "相关" : ""}修订 · 从 ${dateFormatter.format(new Date(data.initializedAt))} 开始记录`;
      element("updates-more").hidden = entries.length <= limit;
      element("updates-storage").textContent = storageMessage();
      const url = new URL(window.location.href);
      url.search = following.checked ? "?following=1" : "";
      try {
        window.history.replaceState(null, "", url);
      } catch {
        /* 受限 file 上下文仍可筛选。 */
      }
    };
    following.addEventListener("change", () => {
      limit = 20;
      render();
    });
    element("updates-more").addEventListener("click", () => {
      limit += 20;
      render();
    });
    store.subscribe(() => {
      limit = 20;
      render();
    });
    element("updates-controls").hidden = false;
    render();
  } catch {
    status.textContent =
      "更新记录读取失败，请刷新重试。无法校验的记录不会显示为正常空列表。";
  }
}
start();

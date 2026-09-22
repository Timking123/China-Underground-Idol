import { normalizeRegionName } from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { validateEventDataset } from "../events/model";
import events from "../../data/events.v1.json";
import {
  createPreferences,
  PREFERENCES_KEY,
  type FollowType,
  type PreferenceStore,
} from "./model";

declare global {
  interface Window {
    idolPreferences?: PreferenceStore;
  }
}

/** 同一页面的独立脚本共用一个状态源，关注信息不发起网络请求。 */
export function getPreferences(): PreferenceStore {
  if (window.idolPreferences) return window.idolPreferences;
  const catalog = readCatalog();
  const groups = catalog.valid ? catalog.data.groups : [];
  const checked = validateEventDataset(
    events,
    groups.map((group) => group.id),
  );
  const records = checked.valid ? checked.data.events : [];
  const cities = [
    ...groups.map((group) => group.activity.city),
    ...records.map((event) => event.city),
  ]
    .filter((city): city is string => Boolean(city))
    .map(normalizeRegionName);
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* 无痕或禁用存储时暂存。 */
  }
  const store = createPreferences(
    {
      group: groups.map((group) => group.id),
      city: cities,
      event: records.map((event) => event.id),
    },
    storage,
  );
  window.idolPreferences = store;
  window.addEventListener("storage", (event) => {
    if (event.key === PREFERENCES_KEY || event.key === null) store.refresh();
  });
  return store;
}

export function storageMessage(): string {
  const mode = getPreferences().read().storage;
  return mode === "persistent"
    ? "关注仅保存在此浏览器，不上传服务器；清除浏览器数据会丢失关注。"
    : mode === "protected"
      ? "原关注数据损坏或版本不兼容，已保留原数据。本次更改仅暂存，关闭页面后可能丢失。"
      : "浏览器存储不可用，关注仅暂存于当前页面，离开或刷新后可能丢失。";
}

export function followButton(
  type: FollowType,
  id: string,
  label: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "follow-button";
  button.dataset.followType = type;
  button.dataset.followId = id;
  button.dataset.followLabel = label;
  return button;
}

/** A 可直接输出 data-follow-type / data-follow-id，再在渲染完成后调用本函数。 */
export function bindFollowButtons(root: ParentNode = document): () => void {
  const store = getPreferences();
  let status =
    document.getElementById("favorites-storage") ??
    document.getElementById("follow-status");
  if (!status) {
    status = document.createElement("p");
    status.id = "follow-status";
    status.className = "follow-status";
    status.setAttribute("role", "status");
    (document.querySelector("main") ?? document.body).append(status);
  }
  const update = () => {
    root
      .querySelectorAll<HTMLButtonElement>(
        "button[data-follow-type][data-follow-id]",
      )
      .forEach((button) => {
        const type = button.dataset.followType as FollowType;
        if (!["group", "city", "event"].includes(type)) return;
        const active = store.has(type, button.dataset.followId ?? "");
        button.textContent = active ? "已关注 · 移除" : "+ 关注";
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute(
          "aria-label",
          `${active ? "取消关注" : "关注"}${button.dataset.followLabel ?? button.dataset.followId}`,
        );
        if (button.dataset.followBound) return;
        button.dataset.followBound = "true";
        button.addEventListener("click", () => {
          const result = store.toggle(type, button.dataset.followId ?? "");
          if (status)
            status.textContent = `${result.message} ${storageMessage()}`;
        });
      });
  };
  update();
  if (status) status.textContent = storageMessage();
  return store.subscribe(update);
}

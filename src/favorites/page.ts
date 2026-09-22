import { normalizeRegionName } from "../catalog/model";
import { readCatalog } from "../catalog/runtime";
import { validateEventDataset } from "../events/model";
import { chinaToday } from "../events/navigation";
import eventInput from "../../data/events.v1.json";
import { element, link, required } from "../groups/dom";
import {
  bindFollowButtons,
  followButton,
  getPreferences,
  storageMessage,
} from "../preferences/browser";
import { appendEvents, eventRow, groupRow, section } from "../city/views";
import { followedEvents } from "./model";

export function mountFavoritesPage(): void {
  const root = required("favorites-content");
  const store = getPreferences();
  const catalog = readCatalog();
  const checked = validateEventDataset(
    eventInput,
    catalog.valid ? catalog.data.groups.map((group) => group.id) : [],
  );
  const records = checked.valid ? checked.data.events : [];
  let unbind = () => {};
  const render = () => {
    const focus =
      document.activeElement instanceof HTMLButtonElement
        ? {
            type: document.activeElement.dataset.followType,
            id: document.activeElement.dataset.followId,
          }
        : null;
    unbind();
    root.replaceChildren();
    root.setAttribute("aria-busy", "false");
    const state = store.read();
    required("favorites-storage").textContent = storageMessage();
    const total = state.group.length + state.city.length + state.event.length;
    required("favorites-count").textContent = `${total} / 500 项关注`;
    required<HTMLButtonElement>("favorites-clear").disabled = total === 0;
    if (!total) {
      const empty = section("还没有关注", "favorites-empty");
      empty.append(
        element(
          "p",
          "在团体、城市或演出旁点击关注，就能在这里整理与你有关的日程。",
        ),
        link("发现团体与现场", "discover.html"),
      );
      root.append(empty);
    } else {
      const upcoming = section("与你有关的近期演出", "favorites-upcoming");
      if (checked.valid)
        appendEvents(
          upcoming,
          followedEvents(records, state, chinaToday(), normalizeRegionName),
          "尚未收录与你关注对象相关的近期演出。这不表示他们没有活动。",
        );
      else
        upcoming.append(element("p", "活动资料暂时无法读取，原有关注仍保留。"));
      root.append(upcoming);
    }
    const cities = section("关注的城市", "favorites-cities");
    const cityList = element("ul", "", "city-list");
    for (const city of state.city) {
      const item = element("li", "", "favorite-city-row");
      item.append(
        link(city, `city.html?${new URLSearchParams({ city })}`),
        followButton("city", city, city),
      );
      cityList.append(item);
    }
    cities.append(
      state.city.length ? cityList : element("p", "尚未关注城市。"),
    );
    const groups = section("关注的团体", "favorites-groups");
    const groupList = element("ul", "", "city-list");
    for (const id of state.group) {
      const group = catalog.valid
        ? catalog.data.groups.find((item) => item.id === id)
        : null;
      if (group) groupList.append(groupRow(group));
      else {
        const item = element("li", "", "favorite-city-row");
        item.append(
          element("span", `档案暂不可用 · ${id}`),
          followButton("group", id, id),
        );
        groupList.append(item);
      }
    }
    groups.append(
      state.group.length ? groupList : element("p", "尚未关注团体。"),
    );
    const events = section("关注的演出（含历史）", "favorites-events");
    const eventList = element("ul", "", "city-list");
    for (const id of state.event) {
      const event = records.find((item) => item.id === id);
      if (event) eventList.append(eventRow(event));
      else {
        const item = element("li", "", "favorite-city-row");
        item.append(
          element("span", `演出资料暂不可用 · ${id}`),
          followButton("event", id, id),
        );
        eventList.append(item);
      }
    }
    events.append(
      state.event.length ? eventList : element("p", "尚未关注单场演出。"),
    );
    root.append(cities, groups, events);
    unbind = bindFollowButtons();
    if (focus?.type) {
      const button = [
        ...root.querySelectorAll<HTMLButtonElement>("button[data-follow-type]"),
      ].find(
        (item) =>
          item.dataset.followType === focus.type &&
          item.dataset.followId === focus.id,
      );
      (button ?? required("favorites-title")).focus({ preventScroll: true });
    }
  };
  required("favorites-clear").addEventListener("click", () => {
    required("favorites-confirm").hidden = false;
    required("favorites-confirm-yes").focus();
  });
  required("favorites-confirm-no").addEventListener("click", () => {
    required("favorites-confirm").hidden = true;
    required("favorites-clear").focus();
  });
  required("favorites-confirm-yes").addEventListener("click", () => {
    required("favorites-confirm").hidden = true;
    store.clear();
    required("favorites-title").focus();
  });
  store.subscribe(render);
  render();
}
if (
  typeof document !== "undefined" &&
  document.getElementById("favorites-content")
)
  mountFavoritesPage();

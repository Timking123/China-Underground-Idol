export type FollowType = "group" | "city" | "event";
export interface Preferences {
  version: 1;
  group: string[];
  city: string[];
  event: string[];
  activeCity: string | null;
}
export interface PreferenceSnapshot extends Preferences {
  storage: "persistent" | "memory" | "protected";
}
export interface PreferenceCatalog {
  group: Iterable<string>;
  city: Iterable<string>;
  event: Iterable<string>;
}
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const PREFERENCES_KEY = "idol.preferences.v1";
export const FOLLOW_LIMIT = 500;
const types: FollowType[] = ["group", "city", "event"];
const empty = (): Preferences => ({
  version: 1,
  group: [],
  city: [],
  event: [],
  activeCity: null,
});
const safeId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 160 &&
  value.trim() === value &&
  !/[<>\u0000-\u001f\u007f]/u.test(value); // eslint-disable-line no-control-regex -- 存储边界拒绝控制字符。

/** 未知版本、损坏数据保持原字节；不自动迁移或删除用户资料。 */
export function parsePreferences(raw: string | null): Preferences | null {
  if (raw === null) return empty();
  if (raw.length > 200000) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      value.version !== 1 ||
      Object.keys(value).some(
        (key) => !["version", ...types, "activeCity"].includes(key),
      )
    )
      return null;
    if (value.activeCity !== null && !safeId(value.activeCity)) return null;
    for (const type of types) {
      const ids = value[type];
      if (
        !Array.isArray(ids) ||
        !ids.every(safeId) ||
        new Set(ids).size !== ids.length
      )
        return null;
    }
    if (
      types.reduce((sum, type) => sum + (value[type] as string[]).length, 0) >
      FOLLOW_LIMIT
    )
      return null;
    return value as unknown as Preferences;
  } catch {
    return null;
  }
}

export function createPreferences(
  catalog: PreferenceCatalog,
  storage?: PreferenceStorage,
) {
  const known = Object.fromEntries(
    types.map((type) => [type, new Set(catalog[type])]),
  ) as Record<FollowType, Set<string>>;
  const listeners = new Set<(snapshot: PreferenceSnapshot) => void>();
  let state = empty();
  let mode: PreferenceSnapshot["storage"] = storage ? "persistent" : "memory";
  const read = (): PreferenceSnapshot => ({
    ...state,
    group: [...state.group],
    city: [...state.city],
    event: [...state.event],
    storage: mode,
  });
  const notify = () => [...listeners].forEach((listener) => listener(read()));
  const reload = (): void => {
    if (!storage || mode === "memory") return;
    try {
      const parsed = parsePreferences(storage.getItem(PREFERENCES_KEY));
      if (parsed) {
        state = parsed;
        mode = "persistent";
      } else mode = "protected";
    } catch {
      mode = "memory";
    }
  };
  reload();
  const save = (): void => {
    if (mode === "persistent" && storage) {
      try {
        storage.setItem(PREFERENCES_KEY, JSON.stringify(state));
      } catch {
        mode = "memory";
      }
    }
    notify();
  };
  return {
    read,
    has: (type: FollowType, id: string): boolean => state[type].includes(id),
    toggle(type: FollowType, id: string): { ok: boolean; message: string } {
      if (!types.includes(type) || !safeId(id))
        return { ok: false, message: "关注对象无效。" };
      // 每次写入前吸收其他标签页的变化，失效档案仍允许用户主动移除。
      if (mode === "persistent") reload();
      const found = state[type].includes(id);
      if (!found && !known[type].has(id))
        return { ok: false, message: "未找到可关注的已收录资料。" };
      if (
        !found &&
        types.reduce((sum, key) => sum + state[key].length, 0) >= FOLLOW_LIMIT
      )
        return {
          ok: false,
          message: `最多关注 ${FOLLOW_LIMIT} 项，请先移除部分关注。`,
        };
      state[type] = found
        ? state[type].filter((item) => item !== id)
        : [...state[type], id];
      save();
      return { ok: true, message: found ? "已移除关注。" : "已关注。" };
    },
    setActiveCity(city: string | null): boolean {
      if (city !== null && !known.city.has(city)) return false;
      if (mode === "persistent") reload();
      state.activeCity = city;
      save();
      return true;
    },
    clear(): void {
      if (mode === "persistent") reload();
      state = { ...empty(), activeCity: state.activeCity };
      save();
    },
    subscribe(listener: (snapshot: PreferenceSnapshot) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh(): void {
      reload();
      notify();
    },
  };
}
export type PreferenceStore = ReturnType<typeof createPreferences>;

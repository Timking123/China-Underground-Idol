import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreferences,
  parsePreferences,
  PREFERENCES_KEY,
  FOLLOW_LIMIT,
} from "../src/preferences/model.ts";
const catalog = { group: ["g-a"], city: ["深圳"], event: ["e-a"] };
function storage(raw = null) {
  return {
    raw,
    getItem() {
      return this.raw;
    },
    setItem(key, value) {
      assert.equal(key, PREFERENCES_KEY);
      this.raw = value;
    },
  };
}
test("三类关注持久化、移除、主动城市与快照隔离", () => {
  const disk = storage();
  const store = createPreferences(catalog, disk);
  let notices = 0;
  const off = store.subscribe(() => notices++);
  for (const [type, id] of [
    ["group", "g-a"],
    ["city", "深圳"],
    ["event", "e-a"],
  ])
    assert.equal(store.toggle(type, id).ok, true);
  store.setActiveCity("深圳");
  assert.equal(createPreferences(catalog, disk).read().activeCity, "深圳");
  store.read().group.length = 0;
  assert.equal(store.has("group", "g-a"), true);
  store.toggle("group", "g-a");
  off();
  store.clear();
  assert.equal(notices, 5);
  assert.deepEqual(store.read().city, []);
  assert.equal(store.read().activeCity, "深圳");
});
test("未知与恶意 ID、上限、失效档案保留且可主动移除", () => {
  const store = createPreferences(catalog);
  for (const id of ["missing", "<script>", "\n深圳"])
    assert.equal(store.toggle("group", id).ok, false);
  assert.equal(store.setActiveCity("不存在"), false);
  const ids = Array.from({ length: FOLLOW_LIMIT }, (_, index) => `g-${index}`);
  const disk = storage(
    JSON.stringify({
      version: 1,
      group: ids,
      city: [],
      event: [],
      activeCity: null,
    }),
  );
  const full = createPreferences(catalog, disk);
  assert.equal(full.read().group.length, FOLLOW_LIMIT);
  assert.equal(full.toggle("group", "g-a").ok, false);
  assert.equal(full.toggle("group", "g-0").ok, true);
  assert.equal(full.toggle("group", "g-a").ok, true);
});
test("损坏和未知版本不覆盖；不可用与配额失败可继续当前页", () => {
  for (const raw of ["{broken", '{"version":2}', "null"]) {
    assert.equal(parsePreferences(raw), null);
    const disk = storage(raw);
    const store = createPreferences(catalog, disk);
    assert.equal(store.read().storage, "protected");
    store.toggle("city", "深圳");
    store.clear();
    assert.equal(disk.raw, raw);
  }
  const blocked = createPreferences(catalog, {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  });
  assert.equal(blocked.toggle("city", "深圳").ok, true);
  assert.equal(blocked.read().storage, "memory");
  const quota = createPreferences(catalog, {
    getItem() {
      return null;
    },
    setItem() {
      throw Error();
    },
  });
  quota.toggle("city", "深圳");
  assert.equal(quota.read().storage, "memory");
});
test("多标签页写入前回读及存储事件刷新", () => {
  const disk = storage();
  const a = createPreferences(catalog, disk);
  const b = createPreferences(catalog, disk);
  a.toggle("city", "深圳");
  b.toggle("group", "g-a");
  a.refresh();
  assert.deepEqual(a.read().city, ["深圳"]);
  assert.deepEqual(a.read().group, ["g-a"]);
});

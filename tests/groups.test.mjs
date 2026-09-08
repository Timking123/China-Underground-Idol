import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const root = new URL("../", import.meta.url);
const output = await build({
  entryPoints: [fileURLToPath(new URL("src/groups/model.ts", root))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const model = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);
const group = (id, overrides = {}) => ({
  id,
  name: `测试团${id}`,
  handle: `@测试${id}`,
  aliases: [],
  status: "确认存续",
  isActive: true,
  founding: { province: null, city: null },
  activity: { province: "广东省", city: "深圳市" },
  styleLabel: "偏摇滚／实验",
  styleState: "editorial",
  styleNote: "仅测试编辑分类",
  tags: [],
  avatar: null,
  visual: null,
  officialUrl: null,
  wikiUrl: null,
  followers: null,
  sources: [],
  ...overrides,
});
const catalog = {
  schemaVersion: "idol-catalog-v1",
  archiveDate: "2026-09-01",
  groups: [
    group("g001"),
    group("g303", {
      isActive: false,
      activity: { province: null, city: null },
    }),
  ],
};
const event = (id, date, performers, status = "scheduled") => ({
  id,
  date,
  performers,
  status,
});
const budgetCatalog = {
  ...catalog,
  groups: Array.from({ length: 65 }, (_, i) =>
    group(`g${String(i + 1).padStart(3, "0")}`, {
      activity: {
        province: "北京市",
        city: `序列城市第${String(i).padStart(2, "0")}`,
      },
    }),
  ),
};
const budgetFilters = (q) => ({
  q,
  status: "all",
  regionRole: "activity",
  province: [],
  city: budgetCatalog.groups.slice(0, 64).map((item) => item.activity.city),
  style: "",
});

test("列表初始渲染有界，最后一页不重复或遗漏条目", () => {
  const records = Array.from({ length: 399 }, (_, i) => i);
  const first = model.paginateGroups(records, 1);
  assert.equal(first.items.length, 24);
  assert.equal(first.pages, 17);
  assert.deepEqual(model.paginateGroups(records, 17).items, records.slice(384));
  assert.equal(
    new Set(
      Array.from(
        { length: 17 },
        (_, i) => model.paginateGroups(records, i + 1).items,
      ).flat(),
    ).size,
    399,
  );
});

test("空结果、过大、负值和非整数页码安全收敛", () => {
  assert.deepEqual(model.paginateGroups([], 90), {
    items: [],
    page: 1,
    pages: 1,
    total: 0,
  });
  for (const value of [-1, 0, 1.4, NaN, Infinity])
    assert.equal(model.paginateGroups(Array(30), value).page, 1);
  assert.equal(model.paginateGroups(Array(30), 100).page, 2);
});

test("十倍规模仍只渲染一页，输入不被切片修改", () => {
  const records = Array.from({ length: 3990 }, (_, i) => i);
  assert.equal(model.paginateGroups(records, 1).items.length, 24);
  assert.equal(records.length, 3990);
});

test("地域文字保留未知，不能从省份补造城市", () => {
  assert.equal(
    model.describeRegion({ province: null, city: null }),
    "城市待核实",
  );
  assert.equal(
    model.describeRegion({ province: "广东省", city: null }),
    "广东省 · 城市待核实",
  );
  assert.equal(
    model.describeRegion({ province: "北京市", city: "北京" }),
    "北京",
  );
  assert.equal(
    model.describeRegion({ province: null, city: "深圳市" }),
    "深圳市",
  );
});

test("风格未知不能用原猜测标签冒充已确认编辑结论", () => {
  assert.equal(
    model.describeStyle(
      group("g001", { styleState: "uncertain", styleLabel: "猜测摇滚" }),
    ),
    "风格待核实",
  );
  assert.match(model.describeStyle(group("g001")), /^编辑分类/);
});

test("来源缺日期不补今天，时间跨 UTC+8 午夜正确显示", () => {
  assert.equal(model.displayDate(null), "观察日期未记录");
  assert.equal(model.displayDate("invalid"), "观察日期未记录");
  assert.equal(model.displayDate("2026-09-01T18:00:00Z"), "2026-09-02");
  assert.equal(
    model.todayInChina(new Date("2026-09-07T16:00:00Z")),
    "2026-09-08",
  );
});

test("相关活动只认稳定 ID，同名未绑定出演者不关联", () => {
  const rows = [
    event("e-real", "2026-09-09", [{ groupId: "g001", name: "团" }]),
    event("e-name-only", "2026-09-09", [{ groupId: null, name: "团" }]),
  ];
  assert.deepEqual(
    model.relatedEvents(rows, "g001", "2026-09-08").upcoming.map((x) => x.id),
    ["e-real"],
  );
});

test("当天属于近期，取消延期不被过滤，历史倒序且不修改输入", () => {
  const cast = [{ groupId: "g001", name: "测试" }];
  const rows = [
    event("e-today", "2026-09-08", cast, "cancelled"),
    event("e-old", "2026-09-05", cast),
    event("e-recent", "2026-09-07", cast),
    event("e-future", "2026-09-10", cast, "postponed"),
  ];
  const related = model.relatedEvents(rows, "g001", "2026-09-08");
  assert.deepEqual(
    related.upcoming.map((x) => x.id),
    ["e-today", "e-future"],
  );
  assert.deepEqual(
    related.past.map((x) => x.id),
    ["e-recent", "e-old"],
  );
  assert.equal(rows[0].id, "e-today");
  assert.equal(model.eventStatusText(rows[0]), "已取消");
  assert.match(model.eventStatusText(rows[3]), /延期/);
});

test("粉丝排序按账号观察值、未知在后，同值稳定，默认不排序", () => {
  const rows = [
    group("g001"),
    group("g002", {
      followers: { value: 50, display: "50", observedAt: null },
    }),
    group("g003", {
      followers: { value: 50, display: "50", observedAt: null },
    }),
    group("g004", { followers: { value: 0, display: "0", observedAt: null } }),
  ];
  assert.deepEqual(
    model.sortGroupList(rows, "followers").map((x) => x.id),
    ["g002", "g003", "g004", "g001"],
  );
  assert.deepEqual(model.sortGroupList(rows, "archive"), rows);
  assert.equal(rows[0].id, "g001");
});

test("列表独占 sort 参数不污染共享筛选，保留省市并集和历史条件", () => {
  const parsed = model.parseGroupListSearch(
    "?sort=followers&status=all&province=广东省&city=深圳市",
    catalog,
  );
  assert.equal(parsed.sort, "followers");
  assert.equal(parsed.filters.status, "all");
  assert.equal(parsed.ignored, false);
  assert.equal(parsed.filters.province.length, 1);
  assert.equal(parsed.filters.city.length, 1);
});

test("重复非法和超长排序参数降级，不据参数选择其他团体", () => {
  for (const search of [
    "?sort=followers&sort=archive",
    "?sort=<script>",
    "?sort=",
  ]) {
    const parsed = model.parseGroupListSearch(search, catalog);
    assert.equal(parsed.sort, "archive");
    assert.equal(parsed.ignored, true);
  }
  assert.equal(
    model.parseGroupListSearch("?sort=" + "x".repeat(5000), catalog).ignored,
    true,
  );
});

test("地区选择64项可提交，65项明确拒绝且不改动原草稿", () => {
  const cities = Array.from({ length: 65 }, (_, i) => `扩容城市${i}`);
  const draft = { province: [], city: cities };
  const before = { province: [...draft.province], city: [...draft.city] };
  assert.match(model.groupFilterSelectionError(draft), /各最多选择 64 项/);
  assert.match(model.groupFilterSelectionError(draft), /城市 65 项/);
  assert.deepEqual(draft, before);
  assert.equal(
    model.groupFilterSelectionError({
      province: [],
      city: cities.slice(0, 64),
    }),
    null,
  );
});

test("省份和城市独立计数，空筛选可提交，省份超限也不静默清空", () => {
  const values = Array.from({ length: 64 }, (_, i) => `地区${i}`);
  assert.equal(
    model.groupFilterSelectionError({ province: [], city: [] }),
    null,
  );
  assert.equal(
    model.groupFilterSelectionError({ province: values, city: values }),
    null,
  );
  assert.match(
    model.groupFilterSelectionError({
      province: [...values, "第65省"],
      city: [],
    }),
    /省份 65 项/,
  );
});

test("坏查询编码在剥离排序前失败降级，保留错误提示", () => {
  for (const query of ["?q=%", "?q=%E0%A4%A", "?q=%E0%A4", "?q=%FF"]) {
    for (const search of [query, `${query}&sort=followers`]) {
      const parsed = model.parseGroupListSearch(search, catalog);
      assert.equal(parsed.ignored, true, search);
      assert.equal(parsed.filters.q, "", search);
      assert.equal(parsed.sort, "archive", search);
    }
  }
});

test("合法百分号、中文编码与排序不被误拒绝", () => {
  for (const [search, query, sort] of [
    ["?q=%25", "%", "archive"],
    ["?q=%25&sort=followers", "%", "followers"],
    ["?q=%2525&sort=archive", "%25", "archive"],
    ["?q=%E7%B3%96%E5%BF%83&sort=followers", "糖心", "followers"],
    ["?sort=followers", "", "followers"],
  ]) {
    const parsed = model.parseGroupListSearch(search, catalog);
    assert.equal(parsed.ignored, false, search);
    assert.equal(parsed.filters.q, query, search);
    assert.equal(parsed.sort, sort, search);
  }
});

test("完整查询预算含问号及排序，4096接受而4097拒绝", () => {
  const atLimit = model.prepareGroupListSubmission(
    budgetFilters("草".repeat(75)),
    "followers",
    budgetCatalog,
  );
  assert.equal(atLimit.valid, true);
  assert.equal(atLimit.search.length, 4096);
  assert.equal(
    model.parseGroupListSearch(atLimit.search, budgetCatalog).ignored,
    false,
  );
  const overLimit = model.prepareGroupListSubmission(
    budgetFilters("草".repeat(75) + "x"),
    "followers",
    budgetCatalog,
  );
  assert.equal(overLimit.valid, false);
  assert.match(overLimit.message, /过长/);
  const raw = atLimit.search.replace("&status=all", "x&status=all");
  assert.equal(raw.length, 4097);
  assert.equal(model.parseGroupListSearch(raw, budgetCatalog).ignored, true);
  assert.equal(
    model.parseGroupListSearch(raw.slice(1), budgetCatalog).ignored,
    true,
  );
});

test("75/76/120中文乘64城市与两种排序的完整地址均按恢复预算决定", () => {
  for (const [size, sort, accepted, length] of [
    [75, "archive", true, 4081],
    [75, "followers", true, 4096],
    [76, "archive", true, 4090],
    [76, "followers", false, 4105],
    [120, "archive", false, 4486],
    [120, "followers", false, 4501],
  ]) {
    const candidate = budgetFilters("草".repeat(size));
    const before = JSON.stringify(candidate);
    const result = model.prepareGroupListSubmission(
      candidate,
      sort,
      budgetCatalog,
    );
    assert.equal(result.valid, accepted, `${size}/${sort}/${length}`);
    assert.equal(JSON.stringify(candidate), before, "不得改动候选草稿");
    if (accepted) {
      assert.equal(result.search.length, length);
      const restored = model.parseGroupListSearch(result.search, budgetCatalog);
      assert.equal(restored.ignored, false);
      assert.deepEqual(restored.filters, result.filters);
      assert.equal(restored.sort, sort);
      assert.equal(
        model.prepareGroupListSubmission(
          restored.filters,
          restored.sort,
          budgetCatalog,
        ).search,
        result.search,
        "历史记录再次准备必须得到相同完整查询串",
      );
    } else assert.match(result.message, /过长/);
  }
});

test("序列化空串和解析降级不能覆盖草稿，合法默认条件可清除", () => {
  const defaults = { ...budgetFilters(""), status: "active", city: [] };
  const reset = model.prepareGroupListSubmission(
    defaults,
    "archive",
    budgetCatalog,
  );
  assert.equal(reset.valid, true);
  assert.equal(reset.search, "");
  for (const candidate of [
    { ...defaults, q: "x".repeat(201) },
    { ...defaults, city: ["未收录城市"] },
  ]) {
    const result = model.prepareGroupListSubmission(
      candidate,
      "archive",
      budgetCatalog,
    );
    assert.equal(result.valid, false);
    assert.match(result.message, /无效/);
    assert.equal("filters" in result, false);
  }
});

test("完整候选验证保留M3数量门及合法百分号与中文", () => {
  const tooMany = budgetFilters("");
  tooMany.city = budgetCatalog.groups.map((item) => item.activity.city);
  assert.match(
    model.prepareGroupListSubmission(tooMany, "followers", budgetCatalog)
      .message,
    /64/,
  );
  for (const q of ["%", "%25", "糖心"]) {
    const prepared = model.prepareGroupListSubmission(
      { ...budgetFilters(q), city: [] },
      "followers",
      budgetCatalog,
    );
    assert.equal(prepared.valid, true);
    assert.equal(
      model.parseGroupListSearch(prepared.search, budgetCatalog).filters.q,
      q,
    );
  }
});

test("公开两页只声明轻量普通脚本，不旁路读取完整 data.js", async () => {
  for (const name of ["groups.html", "group.html"]) {
    const html = await readFile(new URL(name, root), "utf8");
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /src="assets\/groups-data\.js" defer/);
    assert.doesNotMatch(html, /src="data\.js"|type="module"/);
    assert.match(html, /aria-label="主导航"/);
  }
  for (const name of ["list.ts", "detail.ts", "dom.ts"]) {
    const code = await readFile(new URL(`src/groups/${name}`, root), "utf8");
    assert.doesNotMatch(
      code,
      /\.innerHTML\s*=|insertAdjacentHTML|\bfetch\s*\(/,
    );
  }
});

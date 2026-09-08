import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import {
  buildGroupCatalog,
  writeGroupCatalog,
} from "../scripts/groupCatalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const report = path.resolve(root, "../reports/w1/test-tmp");
await mkdir(report, { recursive: true });
const modelText = await readFile(
  new URL("../src/catalog/model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(modelText, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const model = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const catalog = await buildGroupCatalog(root);
const raw = await readFile(path.join(root, "data.js"), "utf8");
const source = JSON.parse(
  raw.replace(/^window.IDOL_MAP_DATA\s*=\s*/u, "").replace(/;\s*$/u, ""),
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const filters = (overrides) => ({
  ...model.defaultCatalogFilters(),
  ...overrides,
});
const one = () => ({ ...clone(catalog), groups: [clone(catalog.groups[0])] });
const known = (id) => catalog.groups.find((group) => group.id === id);
const ids = (groups) => groups.map((group) => group.id);

async function fixture(mutate = () => {}) {
  const directory = await mkdtemp(path.join(report, "catalog-"));
  const group = clone(source.groups[0]);
  group.weiboAvatarPath = null;
  group.avatarPath = null;
  group.preferredVisual = null;
  const input = {
    meta: { archiveCutoffDate: "2026-09-01", population: { total: 1 } },
    groups: [group],
  };
  mutate(input);
  await writeFile(
    path.join(directory, "data.js"),
    `window.IDOL_MAP_DATA=${JSON.stringify(input)};\n`,
    "utf8",
  );
  return directory;
}

test("完整保留399个稳定ID、375条默认存续与两个独立Lumina档案", () => {
  assert.deepEqual(ids(catalog.groups), ids(source.groups));
  assert.equal(catalog.groups.length, 399);
  assert.equal(
    model.filterCatalogGroups(catalog.groups, filters()).length,
    375,
  );
  assert.equal(
    model.filterCatalogGroups(catalog.groups, filters({ status: "all" }))
      .length,
    399,
  );
  assert.equal(known("g303").isActive, false);
  assert.equal(known("g123").isActive, true);
  assert.equal(known("g303").followers, null);
  assert.equal(
    model.parseCatalogGroupLink("?group=g303", catalog.groups).state,
    "valid",
  );
  assert.match(
    known("g303")
      .sources.map((s) => s.note)
      .join(" "),
    /依据用户确认，未取得官号解散公告/u,
  );
});

test("白名单投影没有UID、内部缓存或候选原始字段", () => {
  const blocked = new Set([
    "uid",
    "weiboUid",
    "candidateEvidence",
    "strictSnapshot",
    "rawResponse",
    "observationPackage",
    "sourceArchive",
    "baseX",
    "x",
    "y",
  ]);
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(blocked.has(key), false, key);
      inspect(child);
    }
  }
  inspect(catalog);
  assert.ok(
    Buffer.byteLength(JSON.stringify(catalog)) < Buffer.byteLength(raw) / 3,
  );
});

test("来源时间不刷新，未知地区不猜填，猜测标签不升级", () => {
  assert.equal(catalog.archiveDate, "2026-09-01");
  for (const group of catalog.groups) {
    const original = source.groups.find((item) => item.id === group.id);
    for (const role of ["founding", "activity"]) {
      assert.deepEqual(group[role], {
        province: original.regionPlacement[role].province,
        city: original.regionPlacement[role].city,
      });
    }
    assert.equal(
      group.followers?.observedAt ?? null,
      original.followersValue == null
        ? null
        : (original.profileObservedAt ?? null),
    );
    assert.equal(group.styleLabel, original.editorialStyle.displayLabel);
    if (original.editorialStyle.epistemicStatus === "guess")
      assert.match(group.styleNote, /猜测/u);
  }
});

test("事务所沿革、明确别名、粉丝口径及品牌图保留", () => {
  const group = known("g060");
  assert.deepEqual(group.aliases, ["neokoro", "ne♡koro", "糖心SugarHeart"]);
  assert.match(group.followers.display, /事务所账号/u);
  assert.equal(group.followers.observedAt, "2026-09-05T03:46:13.026Z");
  assert.match(group.visual.src, /g060-brand-20260905/u);
  assert.match(group.visual.label, /不是当前成员海报/u);
  assert.ok(group.sources.some((item) => item.label === "组合更名通告"));
  assert.ok(
    group.sources.some((item) => /不是 neokoro 的粉丝量/u.test(item.note)),
  );
  assert.deepEqual(
    ids(model.filterCatalogGroups(catalog.groups, filters({ q: "NEOKORO" }))),
    ["g060"],
  );
});

test("头像沿用已采用小图、保留观察日期且不放开身份阻塞", () => {
  assert.equal(catalog.groups.filter((group) => group.avatar).length, 398);
  assert.equal(catalog.groups.filter((group) => group.visual).length, 263);
  assert.equal(
    known("g057").avatar.src,
    "assets/weibo-api-avatar-candidates/g057.jpg",
  );
  assert.equal(
    known("g057").sources.find((s) => s.label === "资料头像来源").observedAt,
    "2026-09-02T13:04:46.191Z",
  );
  assert.equal(known("g153").officialUrl, null);
  assert.equal(known("g057").wikiUrl, null);
  for (const group of catalog.groups.filter((g) => g.visual))
    assert.match(group.visual.label, /未取得转载授权/u);
});

test("搜索覆盖团名、官号和别名，多个词交集且不搜索内部内容", () => {
  assert.deepEqual(
    ids(
      model.filterCatalogGroups(
        catalog.groups,
        filters({ q: "ＣｈｕＰｉｄ OFFICIAL" }),
      ),
    ),
    ["g057"],
  );
  assert.equal(
    model.filterCatalogGroups(
      catalog.groups,
      filters({ q: "candidateEvidence" }),
    ).length,
    0,
  );
  assert.equal(
    model.filterCatalogGroups(
      catalog.groups,
      filters({ q: "ChuPid 不存在的词" }),
    ).length,
    0,
  );
});

const regional = [
  {
    ...known("g001"),
    id: "g901",
    activity: { province: "北京市", city: "北京市" },
    founding: { province: "广东省", city: "广州市" },
  },
  {
    ...known("g001"),
    id: "g902",
    activity: { province: "广东省", city: "广州市" },
    founding: { province: "北京市", city: "北京市" },
  },
  {
    ...known("g001"),
    id: "g903",
    activity: { province: "广东省", city: "深圳市" },
    founding: { province: null, city: null },
  },
  {
    ...known("g001"),
    id: "g904",
    activity: { province: null, city: null },
    founding: { province: null, city: null },
  },
];

test("省市条件取并集、与存续和搜索交集；未知城市只在不限时纳入", () => {
  assert.deepEqual(
    ids(
      model.filterCatalogGroups(
        regional,
        filters({ province: ["北京"], city: ["广州"] }),
      ),
    ),
    ["g901", "g902"],
  );
  assert.deepEqual(
    ids(model.filterCatalogGroups(regional, filters({ city: ["广州市"] }))),
    ["g902"],
  );
  assert.deepEqual(
    ids(model.filterCatalogGroups(regional, filters({ province: ["广东"] }))),
    ["g902", "g903"],
  );
  assert.deepEqual(ids(model.filterCatalogGroups(regional, filters())), [
    "g901",
    "g902",
    "g903",
    "g904",
  ]);
  assert.deepEqual(
    ids(
      model.filterCatalogGroups(
        regional,
        filters({ regionRole: "founding", city: ["北京"] }),
      ),
    ),
    ["g902"],
  );
  assert.deepEqual(
    model.filterCatalogGroups(
      regional,
      filters({ city: ["广州"], style: "不存在" }),
    ),
    [],
  );
});

test("地区后缀只等名归一，不推断归属或合并不同城市", () => {
  for (const [left, right] of [
    ["北京市", "北京"],
    ["广西壮族自治区", "广西"],
    ["广东省", "广东"],
  ]) {
    assert.equal(model.normalizeRegionName(left), right);
  }
  assert.notEqual(
    model.normalizeRegionName("广州市"),
    model.normalizeRegionName("深圳市"),
  );
  assert.equal(model.normalizeRegionName("constructor"), "constructor");
  assert.equal(model.normalizeRegionName("沙市"), "沙市");
});

test("查询参数按地区角色校验，序列化稳定并支持恢复同一结果", () => {
  const local = { ...catalog, groups: regional };
  const parsed = model.parseCatalogFilters(
    "?status=all&province=北京&city=广州市&city=广州",
    local,
  );
  assert.equal(parsed.ignored, false);
  const serialized = model.serializeCatalogFilters(parsed.filters);
  assert.equal(serialized.startsWith("?"), false);
  const restored = model.parseCatalogFilters(serialized, local);
  assert.deepEqual(ids(model.filterCatalogGroups(regional, restored.filters)), [
    "g901",
    "g902",
  ]);
  assert.equal(model.serializeCatalogFilters(restored.filters), serialized);
  assert.equal(model.serializeCatalogFilters(filters()), "");
  assert.equal(
    model.serializeCatalogFilters(
      filters({ city: ["深圳市", "广州", "广州市"] }),
    ),
    model.serializeCatalogFilters(filters({ city: ["广州市", "深圳"] })),
  );
  assert.equal(
    model.parseCatalogFilters("?regionRole=founding&city=深圳", local).ignored,
    true,
  );
});

test("恶意、超长、重复和未知参数明确降级", () => {
  for (const query of [
    "?q=a&q=b",
    "?status=bad",
    "?regionRole=bad",
    "?style=不存在",
    "?city=火星",
    "?uid=123",
    "?q=%00",
    "?q=%E0%A4",
    `?q=${"a".repeat(201)}`,
    `?${"a".repeat(4097)}`,
    `?${Array(65).fill("city=北京").join("&")}`,
  ]) {
    assert.equal(
      model.parseCatalogFilters(query, catalog).ignored,
      true,
      query.slice(0, 80),
    );
  }
  assert.equal(
    model.parseCatalogFilters("?q=one&q=two", catalog).filters.q,
    "",
  );
  for (const query of [
    "?group=g99999999",
    "?group=g001&group=g001",
    "?group=G001",
    "?group=../g001",
    "?group=g000000000",
    "?group=%00",
    "?group=%E0%A4",
  ]) {
    assert.equal(
      model.parseCatalogGroupLink(query, catalog.groups).state,
      "invalid",
      query,
    );
  }
  assert.equal(
    model.parseCatalogGroupLink("?q=x", catalog.groups).state,
    "none",
  );
});

test("安全链接拒绝执行协议、凭据、控制字符、反斜杠和编码攻击", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.com",
    "https://user:pass@example.com",
    "https://user@example.com",
    " https://example.com",
    "https://example.com/%0a",
    "https://example.com/\\x",
    "https://example.com/%5c",
    "https://example.com/%zz",
    "https://example.com/\t",
  ]) {
    assert.equal(model.isSafeCatalogUrl(url), false, url);
    const value = one();
    value.groups[0].officialUrl = url;
    assert.equal(model.validateCatalog(value).valid, false, url);
  }
  assert.equal(
    model.isSafeCatalogUrl("https://example.com/中文?q=1&x=2"),
    true,
  );
});

test("图片路径只接受公开资源，穿越与执行内容失败关闭", () => {
  for (const src of [
    "assets/avatars/../g001.jpg",
    "/assets/avatars/g001.jpg",
    "//x/g001.jpg",
    "data:image/svg+xml,x",
    "assets/avatars/g001.svg",
    "assets/avatars/%2e%2e.jpg",
    "assets/private/g001.jpg",
    "assets/avatars/g001.jpg?x=1",
  ]) {
    const value = one();
    value.groups[0].avatar.src = src;
    assert.equal(model.validateCatalog(value).valid, false, src);
  }
});

test("未知字段、缺字段、类型漂移、重复ID和非法日期失败关闭", () => {
  const mutations = [
    (c) => {
      c.secret = "x";
    },
    (c) => {
      c.groups[0].uid = "x";
    },
    (c) => {
      delete c.groups[0].handle;
    },
    (c) => {
      c.groups[0].isActive = "true";
    },
    (c) => {
      c.groups.push(clone(c.groups[0]));
    },
    (c) => {
      c.groups[0].activity = "北京";
    },
    (c) => {
      c.groups[0].avatar.extra = 1;
    },
    (c) => {
      c.groups[0].followers.value = -1;
    },
    (c) => {
      c.groups[0].followers.value = 1.5;
    },
    (c) => {
      c.groups[0].followers.observedAt = "2026-02-30";
    },
    (c) => {
      c.archiveDate = "2026-02-30";
    },
    (c) => {
      c.groups[0].sources[0].observedAt = "2026-09-01T00:00:00";
    },
    (c) => {
      c.groups[0].sources[0].extra = 1;
    },
    (c) => {
      c.groups[0].aliases = ["a", "a"];
    },
    (c) => {
      c.groups[0].styleState = "verified";
    },
    (c) => {
      c.groups = {};
    },
    (c) => {
      c.groups = new Array(1);
    },
    (c) => {
      c.groups[0].sources = new Array(1);
    },
    (c) => {
      c.groups[0].tags = new Array(1);
    },
  ];
  for (const mutate of mutations) {
    const value = one();
    mutate(value);
    const result = model.validateCatalog(value);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.equal(Object.hasOwn(result, "data"), false);
  }
});

test("合法空列表与空值仍可辨别，十倍合成规模保留全部条目", () => {
  assert.equal(model.validateCatalog({ ...catalog, groups: [] }).valid, true);
  const value = one();
  Object.assign(value.groups[0], {
    avatar: null,
    visual: null,
    followers: null,
    officialUrl: null,
    wikiUrl: null,
    aliases: [],
    tags: [],
    sources: [],
    founding: { province: null, city: null },
  });
  assert.equal(model.validateCatalog(value).valid, true);
  const groups = Array.from({ length: 10 }, (_, batch) =>
    catalog.groups.map((g, i) => ({
      ...g,
      id: `g${String(batch * 399 + i + 1).padStart(4, "0")}`,
    })),
  ).flat();
  assert.equal(model.validateCatalog({ ...catalog, groups }).valid, true);
  assert.equal(
    model.filterCatalogGroups(groups, filters({ status: "all" })).length,
    3990,
  );
});

test("运行入口缺失或损坏返回可读错误且不访问网络", async () => {
  const text = await readFile(
    new URL("../src/catalog/runtime.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const supplied of [undefined, null, { bad: true }, catalog]) {
    let network = 0;
    const exports = {};
    const context = {
      exports,
      require: (name) => {
        assert.equal(name, "./model");
        return model;
      },
      window: { IDOL_GROUPS_DATA: supplied },
      fetch: () => {
        network += 1;
        throw new Error("禁止网络");
      },
    };
    vm.runInNewContext(js, context);
    const result = exports.readCatalog();
    assert.equal(result.valid, supplied === catalog);
    if (!result.valid) assert.ok(result.errors.length);
    assert.equal(network, 0);
  }
});

test("固定输入重复生成一致，写入仅在测试目录并可作为普通脚本读取", async () => {
  assert.deepEqual(await buildGroupCatalog(root), catalog);
  const directory = await fixture((input) => {
    input.groups[0].name = "</script><script>坏内容</script>";
  });
  await writeGroupCatalog(directory);
  const output = path.join(directory, "assets/groups-data.js");
  const first = await readFile(output, "utf8");
  await writeGroupCatalog(directory);
  assert.equal(await readFile(output, "utf8"), first);
  assert.equal(first.includes("</script>"), false);
  const context = { window: {} };
  vm.runInNewContext(first, context);
  assert.equal(
    context.window.IDOL_GROUPS_DATA.groups[0].name,
    "</script><script>坏内容</script>",
  );
  assert.equal(
    model.validateCatalog(context.window.IDOL_GROUPS_DATA).valid,
    true,
  );
});

test("来源脚本尾随执行、条数截断、未采用候选、缺资产均拒绝且不覆盖已有产物", async () => {
  const mutations = [
    (input) => {
      input.meta.population.total = 399;
    },
    (input) => {
      input.groups[0].weiboAvatarPath =
        "assets/weibo-api-avatar-candidates/g001.jpg";
      input.groups[0].editorialProfileSupplement = null;
    },
    (input) => {
      input.groups[0].weiboAvatarPath = "assets/avatars/missing.jpg";
    },
    (input) => {
      input.groups[0].profileUrl = "javascript:alert(1)";
    },
  ];
  for (const mutate of mutations) {
    const directory = await fixture(mutate);
    await mkdir(path.join(directory, "assets"));
    const output = path.join(directory, "assets/groups-data.js");
    await writeFile(output, "原产物", "utf8");
    await assert.rejects(writeGroupCatalog(directory));
    assert.equal(await readFile(output, "utf8"), "原产物");
  }
  const directory = await fixture();
  await writeFile(
    path.join(directory, "data.js"),
    `${raw}\nglobalThis.BAD=true;`,
    "utf8",
  );
  await assert.rejects(buildGroupCatalog(directory), SyntaxError);
  const candidateOnly = await fixture((input) => {
    input.groups[0].candidateEvidence = {
      avatarPath: "assets/avatars/missing.jpg",
      profileUrl: "javascript:alert(1)",
    };
  });
  assert.equal((await buildGroupCatalog(candidateOnly)).groups[0].avatar, null);
});

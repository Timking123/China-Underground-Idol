"use strict";
(() => {
  // src/catalog/model.ts
  var ID_PATTERN = /^g\d{3,8}$/u;
  function hasControl(value, multiline = false) {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code));
    });
  }
  var GROUP_KEYS = [
    "id",
    "name",
    "handle",
    "aliases",
    "status",
    "isActive",
    "founding",
    "activity",
    "styleLabel",
    "styleState",
    "styleNote",
    "tags",
    "avatar",
    "visual",
    "officialUrl",
    "wikiUrl",
    "followers",
    "sources"
  ];
  function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function text(value, max, empty = false) {
    return typeof value === "string" && value.length <= max && (empty || value.trim().length > 0) && !hasControl(value);
  }
  function note(value) {
    return typeof value === "string" && value.length <= 8e3 && !hasControl(value, true);
  }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
      return false;
    const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function observedAt(value) {
    if (value === null || date(value)) return true;
    if (typeof value !== "string") return false;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
      value
    );
    return Boolean(match && date(match[1]) && Number.isFinite(Date.parse(value)));
  }
  function isSafeCatalogUrl(value) {
    if (typeof value !== "string" || value.length > 4096 || !/^https?:\/\//iu.test(value) || /\s|\\/u.test(value) || hasControl(value))
      return false;
    try {
      const decoded = decodeURIComponent(value);
      if (hasControl(decoded) || decoded.includes("\\")) return false;
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  function isLocalCatalogImagePath(value) {
    return typeof value === "string" && value.length <= 240 && /^assets\/(?:avatars|weibo-avatars|weibo-api-avatar-candidates|group-visuals|posters|profile-covers|weibo-cached-visuals)\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/u.test(
      value
    );
  }
  function validateCatalog(input) {
    const errors = [];
    const fail = (path, message) => {
      if (errors.length < 200) errors.push(`${path}: ${message}`);
    };
    const shape = (value, path, keys) => {
      if (!object(value)) {
        fail(path, "必须为对象");
        return false;
      }
      for (const key of Object.keys(value))
        if (!keys.includes(key)) fail(`${path}.${key}`, "不允许的字段");
      for (const key of keys)
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "缺少字段");
      return true;
    };
    const stringField = (value, path, max = 200, empty = false) => {
      if (!text(value, max, empty))
        fail(path, "文字为空、过长、类型错误或含控制字符");
    };
    const strings = (value, path) => {
      if (!Array.isArray(value) || value.length > 64) {
        fail(path, "必须为最多64项的文字数组");
        return;
      }
      Array.from(value).forEach(
        (item, index) => stringField(item, `${path}[${index}]`)
      );
      if (new Set(value).size !== value.length) fail(path, "数组包含重复项");
    };
    const region = (value, path) => {
      if (!shape(value, path, ["province", "city"])) return;
      for (const key of ["province", "city"])
        if (value[key] !== null) stringField(value[key], `${path}.${key}`, 80);
    };
    const url = (value, path, nullable = true) => {
      if (!(nullable && value === null) && !isSafeCatalogUrl(value))
        fail(path, "必须为安全的HTTP(S)链接");
    };
    const image = (value, path) => {
      if (value === null || !shape(value, path, ["src", "alt", "label", "sourceUrl"]))
        return;
      if (!isLocalCatalogImagePath(value.src))
        fail(`${path}.src`, "非法公开素材路径");
      stringField(value.alt, `${path}.alt`, 400);
      stringField(value.label, `${path}.label`, 400);
      url(value.sourceUrl, `${path}.sourceUrl`);
    };
    if (!shape(input, "catalog", ["schemaVersion", "archiveDate", "groups"]))
      return { valid: false, errors };
    if (input.schemaVersion !== "idol-catalog-v1")
      fail("catalog.schemaVersion", "不支持的索引版本");
    if (!date(input.archiveDate))
      fail("catalog.archiveDate", "必须为真实日历日期");
    if (!Array.isArray(input.groups) || input.groups.length > 2e4) {
      fail("catalog.groups", "必须为不超过20000项的数组");
      return { valid: false, errors };
    }
    const ids = /* @__PURE__ */ new Set();
    Array.from(input.groups).forEach((group, index) => {
      const path = `catalog.groups[${index}]`;
      if (!shape(group, path, GROUP_KEYS)) return;
      if (typeof group.id !== "string" || !ID_PATTERN.test(group.id))
        fail(`${path}.id`, "非法团体ID");
      else if (ids.has(group.id)) fail(`${path}.id`, "重复团体ID");
      else ids.add(group.id);
      for (const key of ["name", "handle", "status", "styleLabel"])
        stringField(group[key], `${path}.${key}`);
      if (typeof group.isActive !== "boolean")
        fail(`${path}.isActive`, "必须为布尔值");
      if (group.styleState !== "editorial" && group.styleState !== "uncertain")
        fail(`${path}.styleState`, "非法风格状态");
      if (!note(group.styleNote)) fail(`${path}.styleNote`, "非法说明文字");
      strings(group.aliases, `${path}.aliases`);
      strings(group.tags, `${path}.tags`);
      region(group.founding, `${path}.founding`);
      region(group.activity, `${path}.activity`);
      image(group.avatar, `${path}.avatar`);
      image(group.visual, `${path}.visual`);
      url(group.officialUrl, `${path}.officialUrl`);
      url(group.wikiUrl, `${path}.wikiUrl`);
      if (group.followers !== null && shape(group.followers, `${path}.followers`, [
        "display",
        "value",
        "observedAt"
      ])) {
        stringField(group.followers.display, `${path}.followers.display`);
        if (typeof group.followers.value !== "number" || !Number.isSafeInteger(group.followers.value) || group.followers.value < 0)
          fail(`${path}.followers.value`, "必须为非负安全整数");
        if (!observedAt(group.followers.observedAt))
          fail(`${path}.followers.observedAt`, "非法观察日期");
      }
      if (!Array.isArray(group.sources) || group.sources.length > 64)
        fail(`${path}.sources`, "必须为最多64项的来源数组");
      else
        Array.from(group.sources).forEach(
          (source, sourceIndex) => {
            const sp = `${path}.sources[${sourceIndex}]`;
            if (!shape(source, sp, ["label", "url", "observedAt", "note"]))
              return;
            stringField(source.label, `${sp}.label`, 400);
            url(source.url, `${sp}.url`, false);
            if (!observedAt(source.observedAt))
              fail(`${sp}.observedAt`, "非法观察日期");
            if (!note(source.note)) fail(`${sp}.note`, "非法来源说明");
          }
        );
    });
    return errors.length ? { valid: false, errors } : { valid: true, data: input, errors: [] };
  }
  function normalizeRegionName(value) {
    const normalized = value.normalize("NFKC").trim();
    const aliases = {
      广西壮族自治区: "广西",
      宁夏回族自治区: "宁夏",
      新疆维吾尔自治区: "新疆",
      内蒙古自治区: "内蒙古",
      西藏自治区: "西藏",
      香港特别行政区: "香港",
      澳门特别行政区: "澳门"
    };
    return Object.hasOwn(aliases, normalized) ? aliases[normalized] : normalized.length > 2 ? normalized.replace(/[省市]$/u, "") : normalized;
  }

  // src/catalog/runtime.ts
  function readCatalog() {
    if (typeof window === "undefined" || window.IDOL_GROUPS_DATA === void 0) {
      return { valid: false, errors: ["团体索引未加载，请检查资料脚本后重试。"] };
    }
    return validateCatalog(window.IDOL_GROUPS_DATA);
  }

  // src/events/model.ts
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  var ID_PATTERN2 = /^e-[a-z0-9-]+$/;
  var UTC8_MS = 8 * 60 * 60 * 1e3;
  var DAY_MS = 24 * 60 * 60 * 1e3;
  var STATUS_LABELS = {
    scheduled: "计划举行",
    postponed: "已延期，请核实新日期",
    cancelled: "已取消",
    unconfirmed: "安排待确认"
  };
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function isDate(value) {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
    if (value.startsWith("0000-")) return false;
    const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function isTimestamp(value) {
    if (typeof value !== "string") return false;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value
    );
    if (!match || match[0] !== value || !isDate(match[1])) return false;
    const offset = match[5];
    if (offset && /^[+-]14:/.test(offset) && !offset.endsWith(":00"))
      return false;
    return Number.isFinite(Date.parse(value));
  }
  function isSafeUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return false;
    if (!/^https?:\/\//i.test(value) || // eslint-disable-next-line no-control-regex -- 安全边界需要明确拒绝 URL 中的控制字符。
    /[\s\\\u0000-\u001f\u007f]|%0[ad]/i.test(value))
      return false;
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  function isLocalEventPosterPath(value) {
    return typeof value === "string" && value.trim() === value && /^assets\/event-posters\/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)$/.test(
      value
    );
  }
  function validateEventDataset(input, knownGroupIds) {
    const errors = [];
    const knownIds = new Set(knownGroupIds);
    const ids = /* @__PURE__ */ new Set();
    const fail = (path, message) => {
      errors.push({ path, message });
    };
    const shape = (value, path, keys) => {
      if (!isObject(value)) {
        fail(path, "必须为对象");
        return false;
      }
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(value, key))
          fail(`${path}.${key}`, "缺少必需字段");
      }
      for (const key of Object.keys(value)) {
        if (!keys.includes(key)) fail(`${path}.${key}`, "不接受未定义字段");
      }
      return true;
    };
    const text2 = (value, path, max, nullable = false, empty = false) => {
      if (nullable && value === null) return;
      if (typeof value !== "string" || !empty && !value.trim() || typeof value === "string" && [...value].length > max) {
        fail(
          path,
          `必须为${nullable ? " null 或" : ""}${empty ? "" : "非空"}字符串，最多 ${max} 字符`
        );
      }
    };
    if (!shape(input, "$", ["schemaVersion", "updatedAt", "coverage", "events"]))
      return { valid: false, errors };
    if (input.schemaVersion !== "idol-events-v1")
      fail("$.schemaVersion", "不支持的数据版本");
    if (input.coverage !== "partial")
      fail("$.coverage", "必须明确为 partial，不能声称完整覆盖");
    if (!isTimestamp(input.updatedAt))
      fail("$.updatedAt", "必须为含明确时区的有效 ISO 时间");
    if (!Array.isArray(input.events) || input.events.length > 1e4) {
      fail("$.events", "必须为最多 10000 条记录的数组");
      return { valid: false, errors };
    }
    Array.from(input.events).forEach((event, index) => {
      const p = `$.events[${index}]`;
      if (!shape(event, p, [
        "id",
        "title",
        "date",
        "province",
        "city",
        "venue",
        "address",
        "opensAt",
        "startsAt",
        "endsAt",
        "status",
        "performers",
        "sources",
        "notes",
        "poster"
      ]))
        return;
      if (typeof event.id !== "string" || event.id.trim() !== event.id || !ID_PATTERN2.test(event.id) || event.id.length > 100) {
        fail(`${p}.id`, "活动 ID 格式无效或超过 100 字符");
      } else if (ids.has(event.id)) {
        fail(`${p}.id`, "活动 ID 重复");
      } else {
        ids.add(event.id);
      }
      text2(event.title, `${p}.title`, 160);
      if (!isDate(event.date)) fail(`${p}.date`, "必须为真实日历日期 YYYY-MM-DD");
      for (const field of ["province", "city"]) {
        text2(event[field], `${p}.${field}`, 40, true);
        if (typeof event[field] === "string" && (event[field].trim() !== event[field] || !/^[\p{Script=Han}·]+$/u.test(event[field]))) {
          fail(`${p}.${field}`, "省市须使用中文名称；未知时填写 null");
        }
      }
      text2(event.venue, `${p}.venue`, 240, true);
      text2(event.address, `${p}.address`, 500, true);
      text2(event.notes, `${p}.notes`, 4e3, false, true);
      for (const field of ["opensAt", "startsAt", "endsAt"]) {
        if (event[field] !== null && (typeof event[field] !== "string" || event[field].trim() !== event[field] || !TIME_PATTERN.test(event[field]))) {
          fail(`${p}.${field}`, "必须为 HH:mm 或 null，不支持自行推断跨日时间");
        }
      }
      if (typeof event.opensAt === "string" && typeof event.startsAt === "string" && event.opensAt > event.startsAt) {
        fail(`${p}.opensAt`, "入场不能晚于同日开演；跨日信息请留空并备注");
      }
      if (typeof event.startsAt === "string" && typeof event.endsAt === "string" && event.endsAt <= event.startsAt) {
        fail(`${p}.endsAt`, "结束必须晚于同日开演；跨日信息请留空并备注");
      }
      if (typeof event.status !== "string" || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, event.status)) {
        fail(`${p}.status`, "无效的活动状态");
      }
      if (!Array.isArray(event.performers) || event.performers.length > 200) {
        fail(`${p}.performers`, "必须为最多 200 项的数组");
      } else {
        Array.from(event.performers).forEach((performer, i) => {
          const pp = `${p}.performers[${i}]`;
          if (!shape(performer, pp, ["groupId", "name"])) return;
          text2(performer.name, `${pp}.name`, 160);
          if (performer.groupId !== null && (typeof performer.groupId !== "string" || !knownIds.has(performer.groupId))) {
            fail(
              `${pp}.groupId`,
              "团体 ID 必须来自当前完整主档；未绑定时填 null"
            );
          }
        });
      }
      if (!Array.isArray(event.sources) || !event.sources.length || event.sources.length > 30) {
        fail(`${p}.sources`, "必须有 1 至 30 项可追溯来源");
      } else {
        Array.from(event.sources).forEach((source, i) => {
          const sp = `${p}.sources[${i}]`;
          if (!shape(source, sp, [
            "url",
            "label",
            "publisher",
            "observedAt",
            "kind"
          ]))
            return;
          if (!isSafeUrl(source.url))
            fail(`${sp}.url`, "必须为安全的绝对 HTTP(S) URL");
          text2(source.label, `${sp}.label`, 240);
          text2(source.publisher, `${sp}.publisher`, 160);
          if (!isTimestamp(source.observedAt))
            fail(`${sp}.observedAt`, "必须为含明确时区的有效观察时间");
          if (typeof source.kind !== "string" || ![
            "official",
            "organizer",
            "venue",
            "wiki",
            "aggregator",
            "ticketing"
          ].includes(source.kind))
            fail(`${sp}.kind`, "来源种类无效");
        });
      }
      if (event.poster !== null && shape(event.poster, `${p}.poster`, ["src", "alt", "sourceUrl"])) {
        if (!isSafeUrl(event.poster.src) && !isLocalEventPosterPath(event.poster.src))
          fail(
            `${p}.poster.src`,
            "海报必须为安全 URL 或 assets/event-posters 下的 PNG/JPEG/WebP 图片"
          );
        text2(event.poster.alt, `${p}.poster.alt`, 240);
        if (!isSafeUrl(event.poster.sourceUrl))
          fail(`${p}.poster.sourceUrl`, "海报必须有安全来源 URL");
      }
    });
    if (errors.length) return { valid: false, errors };
    return { valid: true, data: input, errors: [] };
  }

  // data/events.v1.json
  var events_v1_default = {
    schemaVersion: "idol-events-v1",
    updatedAt: "2026-09-09T08:02:08.854Z",
    coverage: "partial",
    events: [
      {
        id: "e-weibo-5338755200452940",
        title: "偶像回响 Idol Echo Live Vol.31 · 小丸mori生诞祭",
        date: "2026-09-05",
        province: null,
        city: null,
        venue: "VeinLab未来俱乐部",
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g263",
            name: "TakeBlue"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5338755200452940",
            label: "TakeBlue 本周演出情报",
            publisher: "TakeBlue 官号",
            observedAt: "2026-09-03T11:43:48.400Z",
            kind: "official"
          }
        ],
        notes: "据已归档官号预告整理，未实时复核变更。预告中的 15:40–16:00 为 TakeBlue 出演时段，不能据此确定整场开演时间；仅收录已核实的部分阵容。省市、完整地址和整场时刻未确认。",
        poster: null
      },
      {
        id: "e-weibo-5339142341002069",
        title: "SIN RETORNO 世界树剧场演出",
        date: "2026-09-06",
        province: null,
        city: null,
        venue: "世界树剧场",
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g032",
            name: "SIN RETORNO"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5339142341002069",
            label: "SIN RETORNO 本周演出预告",
            publisher: "SIN RETORNO 官号",
            observedAt: "2026-09-03T11:46:52.435Z",
            kind: "official"
          }
        ],
        notes: "标题为依据官宣整理的描述性标题，整场活动正式名称未确认。预告中的 18:20–18:40 为本团出演时段，整场开演时间留空。省市及地址未确认；未实时复核取消、延期或阵容变更。",
        poster: null
      },
      {
        id: "e-weibo-5339009950681922",
        title: "紫禁之巅 Vol.2 —— 京门第一",
        date: "2026-09-06",
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: "北京市西城区廊房头条2号院1号楼2层01号",
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g192",
            name: "PokaPokaTime"
          },
          {
            groupId: "g190",
            name: "風時計Kazetoke"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5339009950681922",
            label: "PokaPokaTime 本周活动预告",
            publisher: "PokaPokaTime 官号",
            observedAt: "2026-09-03T11:46:52.435Z",
            kind: "official"
          },
          {
            url: "https://weibo.com/detail/5339081194342085",
            label: "風時計Kazetoke 本周课程安排",
            publisher: "風時計Kazetoke 官号",
            observedAt: "2026-09-03T11:43:48.400Z",
            kind: "official"
          }
        ],
        notes: "日期和活动全名来自 PokaPokaTime 预告，城市及完整地址由同场活动的風時計Kazetoke 官号预告交叉核对。仅列已核实的部分出演团体，整场入场、开演和结束时刻未确认；未实时复核变更。",
        poster: null
      },
      {
        province: "内蒙古",
        city: "呼和浩特",
        venue: "WHOHOT LIVEHOUSE",
        address: "呼和浩特市赛罕区尚好家快捷酒店南巷",
        opensAt: "13:40",
        startsAt: "14:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g185",
            name: "绯色苏打"
          },
          {
            groupId: null,
            name: "MOGUMOGU"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5338640013852929",
            label: "绯色苏打 TWOMAN LIVE 官宣",
            publisher: "绯色苏打 官号",
            observedAt: "2026-09-03T11:46:52.435Z",
            kind: "official"
          },
          {
            url: "https://www.sina.cn/news/detail/5331060167541520.html",
            label: "绯色苏打 8 月 12 日预告（新浪公开页）",
            publisher: "绯色苏打_Official",
            observedAt: "2026-09-08T08:33:36Z",
            kind: "official"
          },
          {
            url: "https://weibo.com/6579150992/RgdcNn1Bz",
            label: "MOGUMOGU RED²原预告",
            publisher: "MOGUMOGU",
            observedAt: "2026-09-09T07:27:48.327Z",
            kind: "official"
          }
        ],
        notes: "2026-09-09复核MOGUMOGU原预告，补充呼和浩特WHOHOT LIVEHOUSE及地址；日期与OPEN 13:40 / START 14:00和既有绯色苏打预告一致，沿用同一活动ID。MOGUMOGU身份未独立绑定，结束时刻未知。历史预告复核不表示已排除后续取消、延期或阵容变更。",
        poster: null,
        id: "e-weibo-5338640013852929",
        title: "MOGUMOGU生长计划4 · RED²红色的二次方",
        date: "2026-09-13"
      },
      {
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: null,
        opensAt: "18:45",
        startsAt: "19:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "Meguri-Kaado"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5339115526292485",
            label: "螢石FluorMelo 活动邀请转发",
            publisher: "螢石FluorMelo 官号",
            observedAt: "2026-09-03T11:47:14.413Z",
            kind: "official"
          },
          {
            url: "https://www.sina.cn/news/detail/5338725122835985.html",
            label: "Meguri-Kaado 9 月 2 日原预告（新浪公开页）",
            publisher: "Meguri-Kaado",
            observedAt: "2026-09-08T08:33:36Z",
            kind: "official"
          },
          {
            url: "https://www.sina.cn/news/detail/5334341322280544.html",
            label: "TrueWorld 场馆城市交叉依据（非本场排期）",
            publisher: "TrueWorld-",
            observedAt: "2026-09-08T08:33:36Z",
            kind: "organizer"
          },
          {
            url: "https://weibo.com/8000320501/RgfpSbTLH",
            label: "Meguri-Kaado Last one-man原预告",
            publisher: "Meguri-Kaado",
            observedAt: "2026-09-09T07:27:58.794Z",
            kind: "official"
          }
        ],
        notes: "2026-09-09复核Meguri-Kaado原帖，确认日期、入场18:45、开演19:00和门空间，沿用同一活动ID。街名廊坊/廊房仍有异写，完整地址继续留空。Stardust为协力致谢，不能据此认定出演；彩色心形不能代替成员名字，Last one-man不能单独证明解散。结束时刻未知，出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-5339115526292485",
        title: "Meguri-Kaado Last one-man",
        date: "2026-09-15"
      },
      {
        province: "上海",
        city: "上海",
        venue: "新歌空间",
        address: "上海市长宁区工人文化宫三楼",
        opensAt: "18:15",
        startsAt: "18:30",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "ReRa"
          },
          {
            groupId: null,
            name: "EMBEFUSE"
          },
          {
            groupId: null,
            name: "ANNIHILATE"
          },
          {
            groupId: null,
            name: "Arena组合"
          },
          {
            groupId: null,
            name: "第六页序"
          },
          {
            groupId: null,
            name: "BubbleLabo"
          },
          {
            groupId: null,
            name: "心跳序曲Prologue"
          },
          {
            groupId: null,
            name: "Token"
          },
          {
            groupId: null,
            name: "RAIJIN"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/4028711630/Rh1KjF7tZ",
            label: "舫Freya教师节专场原预告",
            publisher: "舫Freya",
            observedAt: "2026-09-09T07:26:58.540Z",
            kind: "organizer"
          }
        ],
        notes: "据9月7日原预告及其已编辑正文整理；仅列原文明确的9个演出团体，身份尚未逐一绑定。持教师资格证可无料入场，普通观众票种另列，不能把活动整体标作免费。结束时间未确认；出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-rh1kjf7tz",
        title: "舫Freya Fes 6.0 · 教师节专场",
        date: "2026-09-10"
      },
      {
        province: "上海",
        city: "上海",
        venue: "日不落剧场（世界树剧场）",
        address: "南京东路800号第一百货C馆7楼 星空间96号",
        opensAt: "18:30",
        startsAt: "19:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "时季SeasonMemories"
          },
          {
            groupId: null,
            name: "蛋黄πSizzle"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/7931467523/RgPxIvAGu",
            label: "时季SeasonMemories Mini Oneman原预告",
            publisher: "时季SeasonMemories",
            observedAt: "2026-09-09T07:27:09.426Z",
            kind: "official"
          },
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-09T07:17:25.069Z",
            kind: "aggregator"
          }
        ],
        notes: "日期月日、场地、地址和入场/开演来自时季原预告；2026年及上海由同期聚合汇总同场条目交叉核对。21:30为特典开始，不作为演出结束。普通入场与VIP礼包规则不同；阵容未独立绑定团体档案。出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-rgpxivagu",
        title: "时季 1st Mini Oneman「似季」",
        date: "2026-09-11"
      },
      {
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: "北京市西城区廊房头条2号院1号楼二层",
        opensAt: "19:15",
        startsAt: "19:30",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "JADX"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/8013127107/RgnpRiZ0w",
            label: "JADX CAMPUS NOISE北京原预告",
            publisher: "JADX_official",
            observedAt: "2026-09-09T07:27:37.476Z",
            kind: "official"
          }
        ],
        notes: "据JADX原发布者的巡演北京场预告整理。无料入场需提前登记，按当天排队顺序入场；原文注明全程禁止摄影/录像。结束时刻未确认，未推断其他出演者。出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-rgnpriz0w",
        title: "JADX LIVE TOUR 2026「CAMPUS NOISE」北京场",
        date: "2026-09-11"
      },
      {
        province: "北京",
        city: "北京",
        venue: "MASK LIVE",
        address: null,
        opensAt: "12:25",
        startsAt: "12:30",
        endsAt: "16:50",
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "SHIRIUSU天狼星"
          }
        ],
        sources: [
          {
            url: "https://www.showstart.com/event/308732",
            label: "秀动Glory偶像事务所演出列表",
            publisher: "Glory偶像事务所（秀动）",
            observedAt: "2026-09-09T07:54:05.166Z",
            kind: "organizer"
          },
          {
            url: "https://www.showstart.com/host/16689619",
            label: "秀动Glory偶像事务所演出列表",
            publisher: "Glory偶像事务所（秀动）",
            observedAt: "2026-09-09T07:54:02.475Z",
            kind: "organizer"
          }
        ],
        notes: "据秀动厂牌页和活动详情交叉核对：厂牌列表明确2026年，详情列OPEN 12:25、START 12:30及票务时间段结束16:50。仅列艺人栏明确的SHIRIUSU天狼星，指名票种名称不作为完整阵容。详情上方与主办正文的街址/楼层写法不同，完整地址留空，请向主办核实。临期安排与阵容可能调整。",
        poster: null,
        id: "e-showstart-308732",
        title: "GLORY星际搭车指南 Vol.40",
        date: "2026-09-12"
      }
    ]
  };

  // src/discover/model.ts
  function discoveryDate(now) {
    if (!Number.isFinite(now.getTime())) throw new RangeError("当前日期无效");
    return new Date(now.getTime() + 8 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  }
  function discoveryGroups(groups, limit = 6) {
    return groups.filter((group) => group.isActive).slice(0, Math.max(0, limit));
  }
  function discoveryEvents(events, now, limit = 3) {
    const today = discoveryDate(now);
    return events.filter((event) => event.date >= today).sort(
      (a, b) => a.date.localeCompare(b.date) || (a.startsAt ?? "99:99").localeCompare(b.startsAt ?? "99:99") || a.id.localeCompare(b.id)
    ).slice(0, Math.max(0, limit));
  }
  function discoveryCities(groups, events, now, normalize) {
    const cities = /* @__PURE__ */ new Map();
    const today = discoveryDate(now);
    const getCity = (value) => {
      if (!value) return null;
      const name = normalize(value);
      if (!name) return null;
      let item = cities.get(name);
      if (!item) {
        item = { name, groupCount: 0, upcomingCount: 0, pastCount: 0 };
        cities.set(name, item);
      }
      return item;
    };
    for (const group of groups) {
      if (group.isActive) {
        const city = getCity(group.activity.city);
        if (city) city.groupCount += 1;
      }
    }
    for (const event of events) {
      const city = getCity(event.city);
      if (city) {
        if (event.date >= today) city.upcomingCount += 1;
        else city.pastCount += 1;
      }
    }
    return [...cities.values()].sort(
      (a, b) => a.name.localeCompare(b.name, "zh-CN")
    );
  }
  function groupUrl(id) {
    return `group.html?${new URLSearchParams({ group: id })}`;
  }
  function eventUrl(event) {
    return `events.html?period=all#${encodeURIComponent(event.id)}`;
  }
  function cityUrl(city) {
    if (city.groupCount > 0) {
      return `groups.html?${new URLSearchParams({
        regionRole: "activity",
        city: city.name
      })}`;
    }
    return `events.html?${new URLSearchParams({
      period: city.upcomingCount > 0 ? "upcoming" : "past",
      city: city.name
    })}`;
  }

  // src/discover/page.ts
  var STATUS_LABELS2 = {
    scheduled: "计划举行",
    postponed: "已延期，请核实新日期",
    cancelled: "已取消",
    unconfirmed: "安排待确认"
  };
  function element(tag, className, text2) {
    const node = document.createElement(tag);
    node.className = className;
    if (text2 !== void 0) node.textContent = text2;
    return node;
  }
  function link(text2, href, className = "discover-link") {
    const node = element("a", className, text2);
    node.href = href;
    return node;
  }
  function sourceLink(text2, href) {
    const node = link(text2, href, "discover-source-link");
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
  }
  function imageView(image, name, lead) {
    const frame = element("div", lead ? "discover-visual" : "discover-avatar");
    const fallback = element(
      "span",
      "discover-image-fallback",
      lead ? "暂无可用资料图" : name.slice(0, 1)
    );
    frame.append(fallback);
    if (!image) return frame;
    const img = element("img", "");
    img.alt = image.alt;
    img.width = lead ? 720 : 64;
    img.height = lead ? 480 : 64;
    img.loading = lead ? "eager" : "lazy";
    img.decoding = "async";
    fallback.hidden = true;
    img.addEventListener("error", () => {
      img.hidden = true;
      fallback.hidden = false;
      fallback.textContent = lead ? "资料图暂时无法显示" : name.slice(0, 1);
    });
    img.src = image.src;
    frame.append(img);
    return frame;
  }
  function groupRegion(group) {
    return group.activity.city ? `主要活动地 · ${normalizeRegionName(group.activity.city)}` : "主要活动城市尚待核实";
  }
  function leadGroup(group) {
    const article = element("article", "discover-lead");
    const image = group.visual ?? group.avatar;
    const figure = element("figure", "discover-figure");
    figure.append(imageView(image, group.name, true));
    if (image) {
      const caption = element(
        "figcaption",
        "discover-image-caption",
        `${image.label} · 资料图不代表当前完整阵容。`
      );
      if (image.sourceUrl)
        caption.append(" ", sourceLink("图像来源", image.sourceUrl));
      figure.append(caption);
    }
    const text2 = element("div", "discover-lead-copy");
    const heading = element("h3", "discover-group-name");
    heading.append(link(group.name, groupUrl(group.id), "discover-title-link"));
    text2.append(heading, element("p", "discover-region", groupRegion(group)));
    const style = group.styleState === "uncertain" ? "风格资料尚待核实" : `编辑分类 · ${group.styleLabel}`;
    text2.append(element("p", "discover-style", style));
    const actions = element("div", "discover-actions");
    actions.append(
      link("了解这支团", groupUrl(group.id)),
      link(
        "查看相关演出",
        `events.html?${new URLSearchParams({ group: group.id, period: "upcoming" })}`
      )
    );
    text2.append(actions);
    article.append(figure, text2);
    return article;
  }
  function compactGroup(group) {
    const item = element("li", "discover-group-item");
    const anchor = link("", groupUrl(group.id), "discover-group-link");
    const copy = element("span", "discover-group-copy");
    copy.append(
      element("span", "discover-group-small-name", group.name),
      element("span", "discover-region", groupRegion(group))
    );
    anchor.append(imageView(group.avatar, group.name, false), copy);
    item.append(anchor);
    return item;
  }
  function eventCard(event) {
    const article = element("article", "discover-event");
    const dateBlock = element("div", "discover-event-date");
    const date2 = element("time", "", event.date.slice(5).replace("-", "."));
    date2.dateTime = event.date;
    dateBlock.append(
      date2,
      element("span", "discover-event-year", event.date.slice(0, 4)),
      element(
        "span",
        "discover-event-time",
        event.startsAt ? `${event.startsAt} 开演` : "开演待确认"
      )
    );
    const body = element("div", "discover-event-body");
    const heading = element("h3", "discover-event-title");
    heading.append(link(event.title, eventUrl(event), "discover-title-link"));
    body.append(
      element(
        "p",
        `discover-event-status discover-event-status-${event.status}`,
        STATUS_LABELS2[event.status]
      ),
      heading
    );
    body.append(
      element(
        "p",
        "discover-event-place",
        `${event.city ? normalizeRegionName(event.city) : "城市待核实"} / ${event.venue ?? "场地待公布"}`
      )
    );
    const performers = element("p", "discover-performers", "出演：");
    if (event.performers.length === 0) performers.append("阵容尚待核实");
    event.performers.forEach((performer, index) => {
      if (index > 0) performers.append("、");
      performers.append(
        performer.groupId ? link(
          performer.name,
          groupUrl(performer.groupId),
          "discover-performer-link"
        ) : performer.name
      );
    });
    body.append(performers, link("详情与官宣", eventUrl(event)));
    article.append(dateBlock, body);
    return article;
  }
  function setStatus(id, text2, error = false) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = text2;
    node.hidden = !text2;
    node.setAttribute("role", error ? "alert" : "status");
    node.classList.toggle("discover-error", error);
  }
  function renderDiscovery(catalog, rawEvents, now) {
    const feature = document.getElementById("discover-feature");
    const groupsList = document.getElementById("discover-group-list");
    const agenda = document.getElementById("discover-agenda");
    const cityList = document.getElementById("discover-city-list");
    if (!feature || !groupsList || !agenda || !cityList) return;
    for (const node of [feature, groupsList, agenda, cityList])
      node.replaceChildren();
    const update = document.getElementById("discover-events-updated");
    if (update) update.textContent = "";
    if (!catalog.valid) {
      setStatus(
        "discover-group-status",
        "团体资料暂时无法读取，请稍后重试，或通过投稿纠错告知我们。",
        true
      );
      setStatus(
        "discover-event-status",
        "演出关联资料暂时无法读取，可打开活动日历继续查阅。",
        true
      );
      setStatus(
        "discover-city-status",
        "城市入口暂时无法读取，可前往团体列表查找。",
        true
      );
      return;
    }
    const chosen = discoveryGroups(catalog.data.groups);
    setStatus(
      "discover-group-status",
      chosen.length ? "按档案顺序展示部分存续团体。" : "尚未收录可展示的存续团体，可在完整档案查看历史资料。"
    );
    if (chosen[0]) feature.append(leadGroup(chosen[0]));
    for (const group of chosen.slice(1)) groupsList.append(compactGroup(group));
    const checkedEvents = validateEventDataset(
      rawEvents,
      catalog.data.groups.map((group) => group.id)
    );
    const events = checkedEvents.valid ? checkedEvents.data.events : [];
    if (!checkedEvents.valid) {
      setStatus(
        "discover-event-status",
        "活动资料暂时无法读取，不能据此判断近期是否有演出。请稍后重试或补充官宣。",
        true
      );
    } else {
      const upcoming = discoveryEvents(events, now);
      setStatus(
        "discover-event-status",
        upcoming.length ? "仅展示已收录资料；出发前请核对官宣。" : "尚未收录近期活动，可查看历史日程，或补充可靠官宣。"
      );
      for (const event of upcoming) agenda.append(eventCard(event));
      if (update) {
        update.textContent = `活动资料编辑于 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(checkedEvents.data.updatedAt))}，不代表已核对此后的变更。`;
      }
    }
    const cities = discoveryCities(
      catalog.data.groups,
      events,
      now,
      normalizeRegionName
    );
    setStatus(
      "discover-city-status",
      cities.length ? "来自已知主要活动城市与活动记录，未标注地域的资料仍可在完整档案查找。" : "尚无可核实的城市入口，请在完整档案浏览或补充资料。"
    );
    for (const city of cities) {
      const item = element("li", "discover-city-item");
      const anchor = link("", cityUrl(city), "discover-city-link");
      anchor.append(
        element("span", "discover-city-name", city.name),
        element(
          "span",
          "discover-city-kind",
          city.groupCount > 0 ? "查团体" : city.upcomingCount > 0 ? "看近期演出" : "看历史活动"
        )
      );
      item.append(anchor);
      cityList.append(item);
    }
  }
  if (typeof document !== "undefined") {
    renderDiscovery(readCatalog(), events_v1_default, /* @__PURE__ */ new Date());
  }
})();

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
  var MAX_SEARCH_LENGTH = 4096;
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
  function parseSearch(search) {
    if (typeof search !== "string" || search.length > MAX_SEARCH_LENGTH || hasControl(search))
      return null;
    try {
      decodeURIComponent(search.replace(/\+/gu, " "));
      const params = new URLSearchParams(search);
      return [...params].length <= 160 ? params : null;
    } catch {
      return null;
    }
  }
  function parseCatalogGroupLink(search, groups) {
    const params = parseSearch(search);
    if (!params) return { state: "invalid" };
    const values = params.getAll("group");
    if (!values.length) return { state: "none" };
    if (values.length !== 1 || !ID_PATTERN.test(values[0]))
      return { state: "invalid" };
    const group = groups.find((item) => item.id === values[0]);
    return group ? { state: "valid", group } : { state: "invalid" };
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
    updatedAt: "2026-09-11T12:16:46.661Z",
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
      },
      {
        id: "e-board-fbed584ad9ad7ffb61d825ce099d8744",
        title: "RagnaRock Shanghai",
        date: "2026-09-19",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338411562960559",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-dad3447a911390fb51f00b414c6f69cf",
        title: "绮丽偶像日mini Vol.179",
        date: "2026-09-11",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341573955192098",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-108a5b4fdcec69207771143db8f3f8e9",
        title: "IDOLDAY",
        date: "2026-09-11",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341227493099174",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-96058ca060dd861b8f2bacdc210b5817",
        title: "Draw the stars",
        date: "2026-09-11",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341520552527627",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-453d742130d8263c322fbbe7ddab1902",
        title: "夜から昼子まで",
        date: "2026-09-11",
        province: null,
        city: "成都",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341948338244715",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-2145df5bb3861e05c98974f9d6fc0981",
        title: "Yu&May 秋季Mini LIVE Vol.1",
        date: "2026-09-11",
        province: null,
        city: "成都",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341948309145119",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-e1284975254cc64e0b1857938230498c",
        title: "宇宙の回响Vol.13",
        date: "2026-09-12",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340791547627105",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-e311b95ea483be4fe6cf0c2f02ddbec4",
        title: "YUMESCHOOL",
        date: "2026-09-12",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340601971114442",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-298e1a938b0aca55388e566cf0b7f0a1",
        title: "绮丽偶像日mini Vol.180",
        date: "2026-09-12",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341614647542427",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-3802977020e622c57030593f5a2decf3",
        title: "Yuiitsu Fes",
        date: "2026-09-12",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341977211307049",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-2eab244c2ece106f50a0de72cb27621a",
        title: "奉贤潮好玩·户外运动潮玩集·地偶专场",
        date: "2026-09-12",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339333636655041",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-dc1bcefeb421164745129b7112fa8799",
        title: "Galaxy Reception live 星遇现场 Vol.59",
        date: "2026-09-12",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340891061685016",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-0bd10a28228a064afe11ef677d308399",
        title: "綺麗之花",
        date: "2026-09-12",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340601405149584",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-fe390212961e5d2b2eddb94b665d4bb4",
        title: "水光下的微醺月光",
        date: "2026-09-12",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339087831828011",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-4ed201fe1647ef93051a88a76c55b532",
        title: "祝福呪縛",
        date: "2026-09-12",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341227627317391",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-e75cdc4606bc506e456b456b87423109",
        title: "Summer Fes.",
        date: "2026-09-12",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341574076827123",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-99195fe1120382d6f32b65e4d85b8fc4",
        title: "Dramatic Fes Vol.01",
        date: "2026-09-12",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340891197211223",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-f401fa2b658d7a8b055b2356e4373642",
        title: "流明FES“Eternal Vow”",
        date: "2026-09-12",
        province: null,
        city: "成都",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340568521544232",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-ca9fff245e523da8c9b3d5a4e64e0ec2",
        title: "Yu&May 秋季Mini LIVE Vol.1",
        date: "2026-09-12",
        province: null,
        city: "成都",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341948309145119",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-dd10c396a958c57b51446da3d8a0d9c1",
        title: "奇迹·Chuchu vol.5",
        date: "2026-09-12",
        province: null,
        city: "苏州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339903426561359",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-e7e7507a29e0d87618886d9fd464f1f1",
        title: "月见MOTO vol.7",
        date: "2026-09-12",
        province: null,
        city: "无锡",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338007725934214",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-932097791b90d0835096b203a6fda4ca",
        title: "Nereids in BPM World",
        date: "2026-09-12",
        province: null,
        city: "南京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338007923852241",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-5b7890dced91702b5b9c0c452e1f7653",
        title: "Juice Party Vol.3",
        date: "2026-09-12",
        province: null,
        city: "厦门",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340601514199765",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-3041951a357117d75e76dcf179f49674",
        title: "TriMoment Fes Vol.6",
        date: "2026-09-12",
        province: null,
        city: "南昌",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5336580279503200",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-d55ac3b2c1430f724a07baa70504a345",
        title: "星门Stargate Live Vol.11",
        date: "2026-09-12",
        province: null,
        city: "天津",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341547236953307",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-58436af71cea799a7ccaaf9b928bad16",
        title: "Estrellas熠期一会Live Vol.54",
        date: "2026-09-12",
        province: null,
        city: "青岛",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340601434507472",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-82e0f07bbe577913374b7dea4a8ca891",
        title: "无限色·彩域共振祭",
        date: "2026-09-12",
        province: null,
        city: "郑州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5330638693469135",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-663f8e2b95800088dd89e0237b2281e9",
        title: "以下贩上!Idol Live Vol.17.0",
        date: "2026-09-12",
        province: null,
        city: "西安",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340568668603093",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-e9cfe8f895d7e28b89181ea68e858a47",
        title: "Break the Loop ~LIVE INFINITE vol.1",
        date: "2026-09-12",
        province: null,
        city: "重庆",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341520619897256",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-b6580850466e6b25b73ca600fefc16cc",
        title: "Break the Loop 无限旅境INFINITE 2nd Anniversary Mini One Man Live",
        date: "2026-09-12",
        province: null,
        city: "重庆",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-f60f8f34a0d01faa183613447cc8b366",
        title: "玄月妖侠录·最终章",
        date: "2026-09-12",
        province: null,
        city: "武汉",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338392378216581",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-6126e54483109774cac89c855005313c",
        title: "“赶海”行动VOL.8",
        date: "2026-09-12",
        province: null,
        city: "大连",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339719825359140",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-c1c6537f735db424c588c266946eb4ee",
        title: "ULTIMATUM GAME",
        date: "2026-09-13",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338801582903474",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-d850d32d9b06ea2bfce5ee4e87799cad",
        title: "YGG IDOL Fes",
        date: "2026-09-13",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340791604250675",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-acde36f73361d7413f6f6a8eea1ec27d",
        title: "绮丽偶像日mini Vol.181",
        date: "2026-09-13",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341614345292488",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-3be8b1819074b7551731b95b5c79547b",
        title: "Galaxy Reception live 星遇现场 Vol.60",
        date: "2026-09-13",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340891061685016",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-9bc19d8bc94fea004ee856ce4bebfaa3",
        title: "散羽作画",
        date: "2026-09-13",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340983089957063",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-f4a7c3f60e6065943afa3b55d2655139",
        title: "STARRY LINK",
        date: "2026-09-13",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341871421524052",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-d8890b505aaed96f5400dbc79c040d6c",
        title: "夏が過ぎたあと",
        date: "2026-09-13",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982973305515",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-166913a2e8b0728bd10273e6dd00b90e",
        title: "Summer Fes.",
        date: "2026-09-13",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341574076827123",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-3aca7a162ee083730fbc2d0032b8d38f",
        title: "MINERAL IDOL LIVE",
        date: "2026-09-13",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341227157554011",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-d9c10b31000bd00f300f0852483a9295",
        title: "Sunday Candy Vol.14",
        date: "2026-09-13",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339414634957149",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-ddb615fcaa5a9431e70142e2dffd9fbb",
        title: "次元偶像日",
        date: "2026-09-13",
        province: null,
        city: "宁波",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982180057777",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-6e56c30a96f8e2190fc091210afb2268",
        title: "Nereids in BPM World",
        date: "2026-09-13",
        province: null,
        city: "南京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338007923852241",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-ad04450724bf2e63e7054d9ff72342ce",
        title: "NEO LIVE 3.0",
        date: "2026-09-13",
        province: null,
        city: "南昌",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339148361929039",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-65f2a7288391c7498ccb50eb2c3283e3",
        title: "空岛Skypiea Sunday Rally Vol.10",
        date: "2026-09-13",
        province: null,
        city: "天津",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341143455762603",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-2ce940bb475ecee7eb80156dced45997",
        title: "心率逃逸计划",
        date: "2026-09-13",
        province: null,
        city: "青岛",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339088574220133",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-4e29082af36c442fcdf16f3aadb4b43c",
        title: "DOKIFES!",
        date: "2026-09-13",
        province: null,
        city: "青岛",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340602040324083",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-cc0b66b6882346a8f9aba978afa31a1e",
        title: "以下贩上!Idol Live Vol.18.0",
        date: "2026-09-13",
        province: null,
        city: "西安",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982726104645",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-4843049d42e6b406f96f42f19cf921b1",
        title: "夜明fes vol.1",
        date: "2026-09-13",
        province: null,
        city: "重庆",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341691071696831",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-838cb7df53e4e8517cf2664b777b03d8",
        title: "CANDY PARTY vol.8",
        date: "2026-09-13",
        province: null,
        city: "长沙",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341256156973572",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-59fcedfaa933507f9b61492f6767b310",
        title: "青空偶像纪 Mini Fes Vol.7",
        date: "2026-09-13",
        province: null,
        city: "深圳",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341871618396381",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-d9901f353c4a2f1a67b77fa83693caf4",
        title: "绮花夜影",
        date: "2026-09-15",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982107440669",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-fd8e2e33af47c122769224b0c97a303e",
        title: "旬间希音 Midweek Melo",
        date: "2026-09-16",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340602017514676",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-b41ab45133af26788b760a815725fd08",
        title: "残光",
        date: "2026-09-16",
        province: null,
        city: "西安",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341227538976042",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-b3e3e1861b0d4dc65c39eb2c9c22a960",
        title: "花束",
        date: "2026-09-16",
        province: null,
        city: "广州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341691181533612",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-5145f4fb25b5e2333bfa9b68f23f02a4",
        title: "第一幕交响-金秋盛序",
        date: "2026-09-17",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982204698787",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-870fee52a6020ef74fa729215219e336",
        title: "绮花夜影",
        date: "2026-09-17",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982107440669",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-3444dd1b79fab3f1a874585c14c8bf35",
        title: "水光下的微醺月光",
        date: "2026-09-19",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5329613595088455",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-d5172e56274007f7c85c2136fe6d9d6b",
        title: "光年Idol Live Vol.13",
        date: "2026-09-19",
        province: null,
        city: "武汉",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340791576985980",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-4aa1bfed01450eca30c1d5ffacc99bb7",
        title: "糖分补充企划VOL.25",
        date: "2026-09-19",
        province: null,
        city: "长沙",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5338970141494151",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-5f9fdfa1cc8b067c8981d58f70528f7b",
        title: "绮花夜影",
        date: "2026-09-22",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982107440669",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-e81c88a61032c57007edc20106f9464f",
        title: "⟨裂Day⟩ — 突然蓝屏⟩⟨",
        date: "2026-09-23",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5339902678146617",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-a127722c2f79ea5bc96f88d313384978",
        title: "一瞬の沸騰、全ての序章",
        date: "2026-09-23",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5336579713536381",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-9566a140d04762d459f9c9f91f7e79d6",
        title: "绮花夜影",
        date: "2026-09-24",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982107440669",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-9ac40c65e4d2da4568247d42573adf06",
        title: "空岛 Skypiea Sunday Rally Vol.11",
        date: "2026-09-25",
        province: null,
        city: "天津",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5336561409593300",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-a3a66181065042a552f75a9894993970",
        title: "银河galaxy Idol Fes vol.9",
        date: "2026-09-26",
        province: null,
        city: "郑州",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341332295911168",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-80ae10b4357d00d81f50bd4d8f62c293",
        title: "真夜中Drift",
        date: "2026-09-28",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341546235036859",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-7a42af7262d6bdac9365f91879d84f2b",
        title: "绮花夜影",
        date: "2026-09-29",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5340982107440669",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-0e91d827d10fc0e522b8c133444211f2",
        title: "心率逃逸计划",
        date: "2026-10-01",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-44c2a6e6695d9ea9a39ac73c7856d60d",
        title: "碎夜瑠璃Lapislazuli&ANNYX&Misology bandset 3manLive",
        date: "2026-10-06",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-9c93b165766d23c0ec76d38784330d05",
        title: "惑星VORTEX 4TH ONEMAN LIVE ~奇点临界Iv·VORTEX::OMNI~with BANDSET PART",
        date: "2026-10-06",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5341871207612538",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-00ad893a0d34840fa7bf00a39eb7a77d",
        title: "黑星入梦.异常信号",
        date: "2026-10-17",
        province: null,
        city: "上海",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          },
          {
            url: "https://weibo.com/7716940453/5333896099268143",
            label: "揭示板所附详情（正文未核验）",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      },
      {
        id: "e-board-757b5071426baaa3ab151f63090ed7c8",
        title: "心率逃逸计划",
        date: "2026-10-17",
        province: null,
        city: "北京",
        venue: null,
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "unconfirmed",
        performers: [],
        sources: [
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-11T11:14:15.553Z",
            kind: "aggregator"
          }
        ],
        notes: "揭示板收录线索，活动安排待确认；场地、地址、入场及演出时刻、出演阵容和海报尚未核实，请查阅来源并在出发前确认。",
        poster: null
      }
    ]
  };

  // src/groups/dom.ts
  function element(tag, text2 = "", className = "") {
    const node = document.createElement(tag);
    if (text2) node.textContent = text2;
    if (className) node.className = className;
    return node;
  }
  function link(text2, href, external = false) {
    const node = element("a", text2);
    node.href = href;
    if (external) {
      node.target = "_blank";
      node.rel = "noopener noreferrer";
      node.setAttribute("aria-label", `${text2}（在新窗口打开）`);
    }
    return node;
  }
  function required(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`页面缺少必要元素：${id}`);
    return node;
  }
  function imageBlock(image, name, large = false, eager = false) {
    const frame = element("div", "", large ? "groups-visual" : "groups-avatar");
    const fallback = element(
      "span",
      image ? "图像暂不可用" : "暂无资料图",
      "groups-image-fallback"
    );
    fallback.setAttribute("role", "img");
    fallback.setAttribute("aria-label", `${name}：${fallback.textContent}`);
    frame.append(fallback);
    if (!image) return frame;
    const picture = element("img");
    picture.width = large ? 640 : 80;
    picture.height = large ? 480 : 80;
    picture.alt = image.alt || `${name}资料图`;
    picture.loading = eager ? "eager" : "lazy";
    picture.decoding = "async";
    picture.addEventListener("load", () => {
      fallback.hidden = true;
    });
    picture.addEventListener("error", () => {
      picture.hidden = true;
      fallback.hidden = false;
    });
    picture.src = image.src;
    frame.append(picture);
    return frame;
  }
  function showFailure(root, title, description, heading = "h2") {
    root.replaceChildren();
    const panel = element("section", "", "groups-empty");
    panel.setAttribute("role", "alert");
    panel.append(element(heading, title), element("p", description));
    panel.append(link("返回团体列表", "groups.html"));
    root.append(panel);
  }

  // src/groups/model.ts
  function describeRegion(region) {
    if (!region.city) {
      return region.province ? `${region.province} · 城市待核实` : "城市待核实";
    }
    if (!region.province || region.city === region.province) return region.city;
    const province = region.province.replace(/市$/, "");
    const city = region.city.replace(/市$/, "");
    return province === city ? region.city : `${region.province} · ${region.city}`;
  }
  function displayDate(value) {
    if (!value) return "观察日期未记录";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date2 = new Date(value);
    if (!Number.isFinite(date2.getTime())) return "观察日期未记录";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date2).replaceAll("/", "-");
  }
  function describeStyle(group) {
    return group.styleState === "uncertain" ? "风格待核实" : `编辑分类 · ${group.styleLabel || "未分类"}`;
  }
  function relatedEvents(events, groupId, today) {
    const matched = events.filter(
      (event) => event.performers.some((performer) => performer.groupId === groupId)
    );
    const ascending = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    return {
      upcoming: matched.filter((event) => event.date >= today).sort(ascending),
      past: matched.filter((event) => event.date < today).sort(ascending).reverse()
    };
  }
  function todayInChina(now = /* @__PURE__ */ new Date()) {
    return new Date(now.getTime() + 8 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  }
  function eventStatusText(event) {
    const labels = {
      scheduled: "按官宣计划",
      postponed: "已延期，请核实新日期",
      cancelled: "已取消",
      unconfirmed: "安排待确认"
    };
    return labels[event.status];
  }

  // src/groups/detail.ts
  function addFact(list, label, text2, note2) {
    list.append(element("dt", label));
    const value = element("dd", text2);
    if (note2) value.append(element("small", note2));
    list.append(value);
  }
  function eventsList(events, groupId, past) {
    const list = element("ul", "", "groups-event-list");
    for (const event of events) {
      const item = element("li");
      const date2 = element("time", event.date.slice(5).replace("-", "."));
      date2.dateTime = event.date;
      date2.append(element("span", event.date.slice(0, 4)));
      const body = element("div");
      body.append(
        link(
          event.title,
          `events.html?group=${encodeURIComponent(groupId)}&period=${past ? "past" : "upcoming"}#${encodeURIComponent(event.id)}`
        )
      );
      body.append(
        element(
          "p",
          `${eventStatusText(event)}${past ? " · 日期已过，不代表已举办" : ""}`
        )
      );
      body.append(
        element(
          "p",
          `${event.city || "城市待核实"} · ${event.venue || "场地待公布"}`
        )
      );
      body.append(
        element(
          "p",
          event.startsAt ? `开演 ${event.startsAt}（UTC+8）` : "开演时间待公布"
        )
      );
      item.append(date2, body);
      list.append(item);
    }
    return list;
  }
  function activitySection(group, catalog) {
    const section = element("section", "", "groups-detail-section");
    section.setAttribute("aria-label", "团体相关活动");
    section.append(element("h2", "从档案走向现场"));
    const validation = validateEventDataset(
      events_v1_default,
      catalog.groups.map((item) => item.id)
    );
    if (!validation.valid) {
      const error = element(
        "p",
        "相关活动资料暂时无法读取，这不表示该团体没有活动。"
      );
      error.setAttribute("role", "status");
      section.append(error);
    } else {
      const related = relatedEvents(
        validation.data.events,
        group.id,
        todayInChina()
      );
      section.append(
        element(
          "p",
          `活动资料编辑于 ${displayDate(validation.data.updatedAt)} · 仅覆盖已收录资料，出发前请核对官宣。`
        )
      );
      section.append(element("h3", "近期活动"));
      if (related.upcoming.length)
        section.append(eventsList(related.upcoming.slice(0, 5), group.id, false));
      else section.append(element("p", "尚未收录这支团体的近期活动。"));
      if (related.past.length) {
        const history = element("details");
        history.append(
          element("summary", `历史活动资料 · ${related.past.length} 条`)
        );
        history.append(eventsList(related.past.slice(0, 3), group.id, true));
        section.append(history);
      }
    }
    const actions = element("div", "", "groups-detail-actions");
    actions.append(
      link(
        "查看全部相关日程",
        `events.html?group=${encodeURIComponent(group.id)}&period=all`
      )
    );
    actions.append(link("第一次观演指南", "guide.html"));
    section.append(actions);
    return section;
  }
  function sourcesSection(group) {
    const section = element("section", "", "groups-detail-section");
    section.setAttribute("aria-label", "资料依据与身份说明");
    section.append(element("h2", "资料依据与身份说明"));
    const notes = /* @__PURE__ */ new Set();
    for (const source of group.sources) {
      if (!source.note || notes.has(source.note)) continue;
      notes.add(source.note);
      section.append(element("p", `${source.label}：${source.note}`));
    }
    if (group.sources.length) {
      const details = element("details");
      details.append(
        element("summary", `查看 ${group.sources.length} 项来源与观察日期`)
      );
      const list = element("ul", "", "groups-source-list");
      for (const source of group.sources) {
        const item = element("li");
        item.append(link(source.label, source.url, true));
        item.append(element("p", `观察于 ${displayDate(source.observedAt)}`));
        list.append(item);
      }
      details.append(list);
      section.append(details);
    } else {
      section.append(
        element("p", "当前轻量档案未附单独来源，请查阅原分布图中的历史资料。")
      );
    }
    section.append(
      link(
        "在风格分布图中查看",
        `index.html?group=${encodeURIComponent(group.id)}`
      )
    );
    section.append(
      element(
        "p",
        "宽口径风格属于编辑分类；公开账号粉丝数不等于现场人气或演出质量。"
      )
    );
    section.append(
      link(
        "补充资料或纠错",
        `contribute.html?group=${encodeURIComponent(group.id)}&page=group&kind=error`
      )
    );
    return section;
  }
  function mountGroupPage() {
    const root = required("group-main");
    const result = readCatalog();
    root.setAttribute("aria-busy", "false");
    if (!result.valid) {
      showFailure(
        root,
        "暂时无法读取团体档案",
        "资料文件缺失或未通过校验，请稍后重试；原有档案未因此被移除。",
        "h1"
      );
      return;
    }
    const parsed = parseCatalogGroupLink(
      window.location.search,
      result.data.groups
    );
    if (parsed.state !== "valid") {
      showFailure(
        root,
        parsed.state === "none" ? "请选择要查看的团体" : "未找到对应的团体档案",
        "可以返回团体列表重新查找。未知、重复或过长的团体参数不会自动跳转到其他档案。",
        "h1"
      );
      document.title = "未选择有效团体 · 地下偶像资料档案";
      return;
    }
    const group = parsed.group;
    document.title = `${group.name} · 地下偶像资料档案`;
    root.replaceChildren();
    const header = element("header", "", "groups-detail-header");
    header.append(
      element("p", `CN-IDOL / ${group.id.toUpperCase()}`, "groups-kicker")
    );
    header.append(element("h1", group.name));
    header.append(
      element(
        "span",
        group.status,
        group.isActive ? "groups-tag" : "groups-tag groups-tag-history"
      )
    );
    header.append(
      element("p", `${group.handle} · 历史状态截点 ${result.data.archiveDate}`)
    );
    if (!group.isActive)
      header.append(
        element(
          "p",
          "此记录保留历史或非存续标记；具体身份与状态依据见下方资料说明。"
        )
      );
    root.append(header);
    const hero = element("section", "", "groups-detail-hero");
    hero.setAttribute("aria-label", "团体身份与公开资料");
    const figure = element("figure");
    const visual = group.visual ?? group.avatar;
    figure.append(imageBlock(visual, group.name, true, true));
    const caption = element(
      "figcaption",
      visual ? `${visual.label} · 不据此确认当前完整阵容` : "尚未收录可用的团体资料图"
    );
    if (visual?.sourceUrl)
      caption.append(link("图像来源", visual.sourceUrl, true));
    figure.append(caption);
    hero.append(figure);
    const information = element("div");
    const facts = element("dl", "", "groups-facts");
    addFact(facts, "主要活动城市", describeRegion(group.activity));
    addFact(facts, "建团城市", describeRegion(group.founding));
    addFact(
      facts,
      "风格资料",
      describeStyle(group),
      group.styleNote || "宽口径编辑分类，不代表精确音乐测量或团体自述。"
    );
    if (group.styleState === "uncertain" && group.styleLabel)
      addFact(
        facts,
        "待核实线索",
        group.styleLabel,
        "保留原编辑线索，不作为已确认风格。"
      );
    if (group.aliases.length)
      addFact(facts, "别名 / 历史名称", group.aliases.join("、"));
    if (group.tags.length)
      addFact(
        facts,
        "资料标签",
        group.tags.join(" · "),
        "依档案中的编辑资料展示。"
      );
    if (group.followers)
      addFact(
        facts,
        "公开账号粉丝",
        group.followers.display,
        `观察于 ${displayDate(group.followers.observedAt)}；公开显示可能为近似值。`
      );
    information.append(facts);
    const actions = element("div", "", "groups-detail-actions");
    if (group.officialUrl)
      actions.append(link("查看公开官号", group.officialUrl, true));
    if (group.wikiUrl) actions.append(link("Wiki 资料页", group.wikiUrl, true));
    information.append(actions);
    information.append(
      element(
        "p",
        "资料并非实时；身份、运营状态与活动安排以相关来源为准。",
        "groups-detail-note"
      )
    );
    hero.append(information);
    root.append(hero);
    const sections = element("div", "", "groups-detail-sections");
    sections.append(activitySection(group, result.data), sourcesSection(group));
    root.append(sections);
  }
  if (typeof document !== "undefined" && document.getElementById("group-main"))
    mountGroupPage();
})();

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

  // src/catalog/runtime.ts
  function readCatalog() {
    if (typeof window === "undefined" || window.IDOL_GROUPS_DATA === void 0) {
      return { valid: false, errors: ["团体索引未加载，请检查资料脚本后重试。"] };
    }
    return validateCatalog(window.IDOL_GROUPS_DATA);
  }

  // data/events.v1.json
  var events_v1_default = {
    schemaVersion: "idol-events-v1",
    updatedAt: "2026-09-08T08:36:19Z",
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
        performers: [{ groupId: "g263", name: "TakeBlue" }],
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
        performers: [{ groupId: "g032", name: "SIN RETORNO" }],
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
          { groupId: "g192", name: "PokaPokaTime" },
          { groupId: "g190", name: "風時計Kazetoke" }
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
        id: "e-weibo-5338640013852929",
        title: "MOGUMOGU生长计划4 · RED²红色的二次方",
        date: "2026-09-13",
        province: "内蒙古",
        city: "呼和浩特",
        venue: null,
        address: null,
        opensAt: "13:40",
        startsAt: "14:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          { groupId: "g185", name: "绯色苏打" },
          { groupId: null, name: "MOGUMOGU" }
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
          }
        ],
        notes: "归档正文明确活动日期、OPEN 13:40 与 START 14:00。2026-09-08 补核绯色苏打 8 月 12 日预告，同名活动及同日日期明确指向内蒙古呼和浩特；具体场地及地址仍未确认。MOGUMOGU 按官宣名称收录，未独立核验身份绑定。补核历史预告不表示已排除后续取消、延期或阵容变更。",
        poster: null
      },
      {
        id: "e-weibo-5339115526292485",
        title: "Meguri-Kaado Last one-man",
        date: "2026-09-15",
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: null,
        opensAt: "18:45",
        startsAt: "19:00",
        endsAt: null,
        status: "scheduled",
        performers: [{ groupId: null, name: "Meguri-Kaado" }],
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
          }
        ],
        notes: "2026-09-08 补核 Meguri-Kaado 9 月 2 日原预告，确认日期、入场、开演及场地，与原邀请转发一致。结合 TrueWorld 其他场次的同场馆、区、院号、楼层资料交叉确认城市北京；该来源仅用于城市，不证明本场排期。街名存在廊坊头条与廊房头条异写，完整地址仍留空。主出演未绑定团体档案，未据致谢文案推断其他出演者。补核历史预告不表示已排除后续取消、延期或阵容变更。",
        poster: null
      }
    ]
  };

  // src/events/model.ts
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  var ID_PATTERN2 = /^e-[a-z0-9-]+$/;
  var UTC8_MS = 8 * 60 * 60 * 1e3;
  var DAY_MS = 24 * 60 * 60 * 1e3;
  var STATUS_LABELS = {
    scheduled: "按官宣计划",
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
          if (typeof source.kind !== "string" || !["official", "organizer", "venue", "wiki"].includes(source.kind))
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

  // src/content/contribute.ts
  var CONTACT_EMAIL = "1243222867@QQ.com";
  var MAILTO_MAX_LENGTH = 1800;
  var FIELD_LIMITS = {
    target: 160,
    source: 800,
    details: 3e3
  };
  var TEMPLATES = {
    error: {
      label: "资料错误",
      hint: "指出哪一项有误、建议改成什么，并附可核对的原始来源。",
      prompt: "有误内容与建议更正"
    },
    event: {
      label: "活动补充",
      hint: "提供活动名称、日期、城市、场地及主办方或团体官宣。无法确认的项目请写“待核实”。",
      prompt: "活动名称、日期、城市、场地与补充说明"
    },
    outdated: {
      label: "过时资料",
      hint: "说明哪条资料已有变化，以及新公告的日期。历史记录与当前状态可能使用不同截点。",
      prompt: "变化内容、新公告日期与建议更新"
    },
    rights: {
      label: "素材权利",
      hint: "指出涉及的页面或素材、你与素材的关系及希望采取的处理方式。可附公开作品页或授权说明，不需要敏感证件。",
      prompt: "涉及素材、权利关系与处理诉求"
    }
  };
  var PAGE_LABELS = {
    index: "风格分布图",
    discover: "发现",
    groups: "团体列表",
    group: "团体档案",
    events: "演出",
    guide: "观演指南",
    about: "关于本站"
  };
  function containsControl(value) {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
  }
  function parseContributionContext(search, groups2, events, locationHref) {
    const invalid = { state: "invalid" };
    if (search.length > 2048 || containsControl(search)) return invalid;
    let params;
    try {
      decodeURIComponent(search.replace(/\+/g, " "));
      params = new URLSearchParams(search);
    } catch {
      return invalid;
    }
    if ([...params].length === 0) return { state: "none" };
    for (const [key, value] of params) {
      if (!["group", "event", "page", "kind"].includes(key) || params.getAll(key).length !== 1 || !value || value.length > 160 || containsControl(value) || value.includes("%"))
        return invalid;
    }
    const groupId = params.get("group");
    const eventId = params.get("event");
    const group = groups2.find((item) => item.id === groupId);
    const event = events.find((item) => item.id === eventId);
    if (groupId && (!/^g\d{3,8}$/u.test(groupId) || !group) || eventId && (!/^e-[a-z0-9-]+$/u.test(eventId) || !event) || group && event && !event.performers.some((item) => item.groupId === group.id))
      return invalid;
    const page = params.get("page") ?? (event ? "events" : group ? "group" : null);
    const kind = params.get("kind") ?? "error";
    if (page && !Object.hasOwn(PAGE_LABELS, page) || !Object.hasOwn(TEMPLATES, kind))
      return invalid;
    const target = [
      group?.name,
      event?.title,
      page ? PAGE_LABELS[page] : null
    ].filter(Boolean).join(" · ");
    if (target.length > FIELD_LIMITS.target) return invalid;
    let pageLink = page ? `${page}.html` : "";
    if (page && group && ["index", "group", "events"].includes(page))
      pageLink += `?group=${encodeURIComponent(group.id)}`;
    if (page === "events" && event)
      pageLink += `#${encodeURIComponent(event.id)}`;
    let source = "";
    try {
      const base = new URL(locationHref);
      if (pageLink && /^https?:$/.test(base.protocol) && !base.username && !base.password) {
        source = new URL(pageLink, base).href;
        if (source.length > FIELD_LIMITS.source) source = "";
      }
    } catch {
    }
    return {
      state: "valid",
      kind,
      target,
      source,
      pageLink
    };
  }
  function cleanField(value, limit, label) {
    if (typeof value !== "string" || value.length > limit)
      throw new Error(`${label}不得超过 ${limit} 个字符。`);
    for (const character of value) {
      const point = character.codePointAt(0);
      if (point >= 55296 && point <= 57343)
        throw new Error(`${label}含无效字符，请重新输入。`);
    }
    return Array.from(value.replace(/\r\n?/g, "\n")).filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code >= 32 && code !== 127;
    }).join("").trim();
  }
  function buildMailDraft(input) {
    if (!Object.hasOwn(TEMPLATES, input.kind))
      throw new Error("请选择有效的资料类型。");
    const template = TEMPLATES[input.kind];
    const target = cleanField(
      input.target,
      FIELD_LIMITS.target,
      "相关页面或名称"
    );
    const source = cleanField(input.source, FIELD_LIMITS.source, "来源链接");
    const details = cleanField(input.details, FIELD_LIMITS.details, "说明");
    if (!target || !details)
      throw new Error("请填写相关页面或名称，以及具体说明。");
    if (source) {
      let url;
      try {
        url = new URL(source);
      } catch {
        throw new Error("来源请填写完整的 HTTP 或 HTTPS 公开链接，或留空。");
      }
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || /\s/u.test(source)) {
        throw new Error("来源仅接受不含登录信息的 HTTP 或 HTTPS 公开链接。");
      }
    }
    const subject = `【地偶档案·${template.label}】资料反馈`;
    const body = [
      "你好，",
      "",
      `反馈类型：${template.label}`,
      `相关页面或名称：${target}`,
      `公开来源：${source || "未提供，请编辑核实"}`,
      "",
      `${template.prompt}：`,
      details,
      "",
      "请依据原始来源核实后处理。"
    ].join("\r\n").replace(/\r?\n/g, "\r\n");
    const uri = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return {
      subject,
      body,
      text: `收件人：${CONTACT_EMAIL}\r
主题：${subject}\r
\r
${body}`,
      mailto: uri.length <= MAILTO_MAX_LENGTH ? uri : null
    };
  }
  async function copyDraft(text2, write) {
    if (!write) return false;
    try {
      await write(text2);
      return true;
    } catch {
      return false;
    }
  }
  function mountContribute(root, context = { state: "none" }) {
    const form = root.querySelector("#contribute-form");
    if (!form) return;
    const kind = root.querySelector("#draft-kind");
    const target = root.querySelector("#draft-target");
    const source = root.querySelector("#draft-source");
    const details = root.querySelector("#draft-details");
    const hint = root.querySelector("#template-hint");
    const status = root.querySelector("#draft-status");
    const preview = root.querySelector("#draft-preview");
    const result = root.querySelector("#draft-result");
    const open = root.querySelector("#open-mail");
    const copy = root.querySelector("#copy-draft");
    const select = root.querySelector("#select-draft");
    const contextNotice = root.querySelector("#draft-context");
    if (context.state !== "none" && contextNotice) {
      contextNotice.hidden = false;
      if (context.state === "valid") {
        kind.value = context.kind ?? "error";
        target.value = context.target ?? "";
        source.value = context.source ?? "";
        hint.textContent = TEMPLATES[kind.value].hint;
        contextNotice.textContent = `已带入${context.target || "反馈类型"}，可直接修改。请补充具体说明和原始来源。尚未发送。`;
        if (context.pageLink) {
          const back = root.createElement("a");
          back.href = context.pageLink;
          back.textContent = "查看相关页面";
          contextNotice.append(" ", back);
        }
      } else {
        contextNotice.textContent = "入口参数无效或相关资料未能核实，已改为手动填写。尚未发送。";
      }
    }
    let revision = 0;
    const invalidate = () => {
      revision += 1;
      result.hidden = true;
      preview.value = "";
      open.removeAttribute("href");
      status.textContent = "内容已修改，请重新生成草稿。尚未发送。";
    };
    form.addEventListener("input", invalidate);
    kind.addEventListener("change", () => {
      invalidate();
      hint.textContent = TEMPLATES[kind.value]?.hint ?? "请选择有效类型。";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const draft = buildMailDraft({
          kind: kind.value,
          target: target.value,
          source: source.value,
          details: details.value
        });
        preview.value = draft.text;
        open.hidden = !draft.mailto;
        if (draft.mailto) open.href = draft.mailto;
        else open.removeAttribute("href");
        result.hidden = false;
        status.textContent = draft.mailto ? "草稿已在本机生成。尚未发送，请在邮件客户端检查并发送。" : "草稿较长，请复制全文到邮件客户端。尚未发送，请检查并发送。";
        preview.focus();
      } catch (error) {
        result.hidden = true;
        open.removeAttribute("href");
        status.textContent = error instanceof Error ? error.message : "无法生成草稿，请检查输入。";
      }
    });
    open.addEventListener("click", () => {
      status.textContent = "已请求打开邮件客户端；尚未发送。若没有打开，请复制草稿后自行粘贴。";
    });
    const selectText = () => {
      preview.focus();
      preview.select();
    };
    select.addEventListener("click", () => {
      selectText();
      status.textContent = "草稿已选中，请使用复制命令或长按复制。尚未发送。";
    });
    copy.addEventListener("click", () => {
      const current = revision;
      const clipboard = root.defaultView?.navigator.clipboard;
      void copyDraft(
        preview.value,
        clipboard ? (text2) => clipboard.writeText(text2) : void 0
      ).then((copied) => {
        if (current !== revision || result.hidden) return;
        if (!copied) selectText();
        status.textContent = copied ? "草稿已复制。尚未发送，请粘贴到邮件客户端检查并发送。" : "自动复制不可用，已选中草稿；请使用复制命令或长按复制。尚未发送。";
      });
    });
    root.querySelector("#draft-fields").disabled = false;
    root.querySelector("#script-notice").hidden = true;
  }

  // src/content/page.ts
  var catalog = readCatalog();
  var groups = catalog.valid ? catalog.data.groups : [];
  var dataset = validateEventDataset(
    events_v1_default,
    groups.map((group) => group.id)
  );
  mountContribute(
    document,
    parseContributionContext(
      window.location.search,
      groups,
      dataset.valid ? dataset.data.events : [],
      window.location.href
    )
  );
})();

"use strict";
(() => {
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

  // data/follower-observations.v1.json
  var follower_observations_v1_default = {
    schemaVersion: "idol-follower-observations-v1",
    updatedAt: null,
    records: []
  };

  // src/catalog/followerObservations.ts
  function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function observationTime(value, now) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
      value
    );
    const time = Date.parse(value);
    const day = match ? /* @__PURE__ */ new Date(`${match[1]}T00:00:00Z`) : null;
    return match && day && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] && Number.isFinite(time) && Number.isFinite(now.getTime()) && time <= now.getTime() ? time : null;
  }
  function observationWeek(value) {
    const date = new Date(Date.parse(value) + 8 * 36e5);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return `week-${date.toISOString().slice(0, 10)}`;
  }
  function strictFollowerIdentity(group, uid) {
    if (!object(group) || !/^\d{4,20}$/u.test(uid)) return false;
    const fields = group.fieldEvidence;
    const identity = object(fields) ? fields.profileIdentity : null;
    return String(group.weiboUid ?? "") === uid && group.uidConfidence === "high" && object(identity) && identity.state === "verified" && identity.confidence === "high" && String(identity.candidateUid ?? "") === uid && !(Array.isArray(group.rejectedIdentityCandidates) && group.rejectedIdentityCandidates.some(
      (item) => object(item) && String(item.uid) === uid
    ));
  }
  function latestFollowerBaseline(sources, now) {
    const points = [];
    const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const add = (value, approximate, observedAt) => {
      const time = observationTime(observedAt, now);
      if (!count(value) || time === null || typeof observedAt !== "string")
        return;
      points.push({
        value,
        approximate: typeof approximate === "boolean" ? approximate : null,
        observedAt,
        time
      });
    };
    for (const source of sources) {
      if (!object(source)) continue;
      const fields = source.fieldEvidence;
      const evidence = object(fields) && object(fields.followers) ? fields.followers : null;
      const uid = String(source.weiboUid ?? source.uid ?? "");
      const evidenceMatches = evidence && !["blocked", "conflict", "not_found"].includes(String(evidence.state)) && (evidence.boundUid == null || String(evidence.boundUid) === uid);
      if (source.followersKnown !== false && count(source.followersValue)) {
        const times = [source.followersObservedAt];
        if (observationTime(source.followersObservedAt, now) === null) {
          times.push(source.profileObservedAt);
          if (evidenceMatches && (evidence.numericValue == null || evidence.numericValue === source.followersValue))
            times.push(evidence.observedAt);
        }
        for (const time of times)
          add(source.followersValue, source.followersApproximate, time);
      }
      if (evidenceMatches && evidence.state === "verified") {
        add(
          evidence.numericValue,
          evidence.followersApproximate ?? (evidence.numericValue === source.followersValue ? source.followersApproximate : null),
          evidence.observedAt
        );
      }
      const review = source.publicReview;
      const profile = object(review) ? review.profile : null;
      if (object(profile) && String(profile.uid ?? "") === uid && profile.followersValue === source.followersValue)
        add(
          profile.followersValue,
          profile.followersApproximate,
          profile.observedAt
        );
    }
    points.sort((a, b) => b.time - a.time);
    const latest = points[0];
    return latest ? {
      ...latest,
      conflict: points.some(
        (point) => point.time === latest.time && (point.value !== latest.value || point.approximate !== latest.approximate)
      )
    } : null;
  }
  function followerObservationConflict(record, baseline) {
    if (!baseline) return null;
    if (baseline.conflict) return "baseline_observation_conflict";
    const time = Date.parse(record.followersObservedAt);
    if (time < baseline.time) return "older_observation";
    if (time === baseline.time && (record.followersValue !== baseline.value || record.followersApproximate !== baseline.approximate))
      return "same_time_conflict";
    return null;
  }
  var keys = [
    "groupId",
    "uid",
    "followersValue",
    "followersDisplay",
    "followersApproximate",
    "followersObservedAt",
    "sourceUrl",
    "weekId",
    "identityGate",
    "responseSha256"
  ];
  function exactKeys(value, allowed) {
    return Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
  }
  function validateFollowerObservations(input, now = /* @__PURE__ */ new Date()) {
    const errors = [];
    if (!object(input) || !exactKeys(input, ["schemaVersion", "updatedAt", "records"]) || input.schemaVersion !== "idol-follower-observations-v1" || !Array.isArray(input.records))
      return { valid: false, errors: ["invalid_follower_dataset"] };
    const ids = /* @__PURE__ */ new Set();
    const uids = /* @__PURE__ */ new Set();
    let latest = null;
    for (const [index, record] of input.records.entries()) {
      if (!object(record) || !exactKeys(record, keys) || typeof record.groupId !== "string" || !/^g\d{3,8}$/u.test(record.groupId) || typeof record.uid !== "string" || !/^\d{4,20}$/u.test(record.uid) || typeof record.followersValue !== "number" || !Number.isSafeInteger(record.followersValue) || record.followersValue < 0 || typeof record.followersApproximate !== "boolean" || typeof record.followersDisplay !== "string" || record.followersDisplay !== `${record.followersApproximate ? "约" : ""}${record.followersValue}` || observationTime(record.followersObservedAt, now) === null || record.sourceUrl !== `https://weibo.com/u/${record.uid}` || record.identityGate !== "strict_uid_match" || typeof record.responseSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.responseSha256)) {
        errors.push(`invalid_follower_record:${index}`);
        continue;
      }
      const observed = record.followersObservedAt;
      if (record.weekId !== observationWeek(observed))
        errors.push(`observation_week_mismatch:${index}`);
      if (ids.has(record.groupId) || uids.has(record.uid))
        errors.push(`duplicate_follower_identity:${index}`);
      ids.add(record.groupId);
      uids.add(record.uid);
      if (latest === null || Date.parse(observed) > Date.parse(latest))
        latest = observed;
    }
    if (input.updatedAt !== latest) errors.push("invalid_follower_updated_at");
    return errors.length ? { valid: false, errors } : {
      valid: true,
      data: structuredClone(input),
      errors: []
    };
  }
  function overlayFollowerObservations(groups, input, now = /* @__PURE__ */ new Date(), mode = "current") {
    const validation = validateFollowerObservations(input, now);
    if (!validation.valid) throw new Error(validation.errors.join(","));
    const ids = new Set(groups.map((group) => group.id));
    if (ids.size !== groups.length) throw new Error("duplicate_display_group_id");
    for (const record of validation.data.records) {
      const group = groups.find((candidate) => candidate.id === record.groupId);
      if (!group || !strictFollowerIdentity(group, record.uid) || groups.filter(
        (candidate) => object(candidate) && String(candidate.weiboUid ?? "") === record.uid
      ).length !== 1)
        throw new Error(`display_identity_mismatch:${record.groupId}`);
      const conflict = followerObservationConflict(
        record,
        latestFollowerBaseline([group], now)
      );
      if (conflict) throw new Error(`follower_${conflict}:${record.groupId}`);
    }
    const byId = new Map(
      validation.data.records.map((record) => [record.groupId, record])
    );
    return groups.map((group) => {
      const copy = structuredClone(group);
      const record = byId.get(group.id);
      if (!record) return copy;
      if (mode === "archive")
        return Object.assign(copy, {
          followerObservation: structuredClone(record)
        });
      return Object.assign(copy, {
        followersValue: record.followersValue,
        followersDisplay: record.followersDisplay,
        followersApproximate: record.followersApproximate,
        followersObservedAt: record.followersObservedAt,
        followersKnown: true,
        followersText: record.followersDisplay,
        followerObservation: structuredClone(record)
      });
    });
  }

  // src/events/model.ts
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  var ID_PATTERN = /^e-[a-z0-9-]+$/;
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
    const shape = (value, path, keys2) => {
      if (!isObject(value)) {
        fail(path, "必须为对象");
        return false;
      }
      for (const key of keys2) {
        if (!Object.prototype.hasOwnProperty.call(value, key))
          fail(`${path}.${key}`, "缺少必需字段");
      }
      for (const key of Object.keys(value)) {
        if (!keys2.includes(key)) fail(`${path}.${key}`, "不接受未定义字段");
      }
      return true;
    };
    const text = (value, path, max, nullable = false, empty = false) => {
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
      if (typeof event.id !== "string" || event.id.trim() !== event.id || !ID_PATTERN.test(event.id) || event.id.length > 100) {
        fail(`${p}.id`, "活动 ID 格式无效或超过 100 字符");
      } else if (ids.has(event.id)) {
        fail(`${p}.id`, "活动 ID 重复");
      } else {
        ids.add(event.id);
      }
      text(event.title, `${p}.title`, 160);
      if (!isDate(event.date)) fail(`${p}.date`, "必须为真实日历日期 YYYY-MM-DD");
      for (const field of ["province", "city"]) {
        text(event[field], `${p}.${field}`, 40, true);
        if (typeof event[field] === "string" && (event[field].trim() !== event[field] || !/^[\p{Script=Han}·]+$/u.test(event[field]))) {
          fail(`${p}.${field}`, "省市须使用中文名称；未知时填写 null");
        }
      }
      text(event.venue, `${p}.venue`, 240, true);
      text(event.address, `${p}.address`, 500, true);
      text(event.notes, `${p}.notes`, 4e3, false, true);
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
          text(performer.name, `${pp}.name`, 160);
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
          text(source.label, `${sp}.label`, 240);
          text(source.publisher, `${sp}.publisher`, 160);
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
        text(event.poster.alt, `${p}.poster.alt`, 240);
        if (!isSafeUrl(event.poster.sourceUrl))
          fail(`${p}.poster.sourceUrl`, "海报必须有安全来源 URL");
      }
    });
    if (errors.length) return { valid: false, errors };
    return { valid: true, data: input, errors: [] };
  }
  function filterEvents(events, filters) {
    const { from = "", to = "", group = "", province = [], city = [] } = filters;
    if (from && !isDate(from) || to && !isDate(to) || from && to && from > to)
      return [];
    const normalize = (value) => value.normalize("NFKC").toLowerCase();
    const terms = normalize(filters.q ?? "").trim().split(/\s+/).filter(Boolean);
    return events.filter((event) => {
      if (from && event.date < from || to && event.date > to) return false;
      if (group && !event.performers.some((performer) => performer.groupId === group))
        return false;
      if ((province.length || city.length) && !(event.province !== null && province.includes(event.province)) && !(event.city !== null && city.includes(event.city)))
        return false;
      const haystack = normalize(
        [
          event.title,
          event.province,
          event.city,
          event.venue,
          event.address,
          event.notes,
          ...event.performers.map((performer) => performer.name)
        ].filter((value) => value !== null).join(" ")
      );
      return terms.every((term) => haystack.includes(term));
    });
  }
  function getEventTemporalState(event, now) {
    if (!isDate(event.date) || !Number.isFinite(now.getTime()))
      throw new RangeError("日期或当前时间无效");
    const local = new Date(now.getTime() + UTC8_MS);
    if (!Number.isFinite(local.getTime()) || local.getUTCFullYear() < 1 || local.getUTCFullYear() > 9999) {
      throw new RangeError("当前时间超出可支持年份");
    }
    const today = local.toISOString().slice(0, 10);
    return event.date < today ? "past" : event.date > today ? "upcoming" : "today";
  }

  // src/site/map.ts
  function parseGroupLink(search, knownGroupIds) {
    if (search.length > 2048) return { state: "invalid" };
    const values = new URLSearchParams(search).getAll("group");
    if (values.length === 0) return { state: "none" };
    if (values.length !== 1 || !/^g\d{3}$/.test(values[0]) || !knownGroupIds.has(values[0])) {
      return { state: "invalid" };
    }
    return { state: "valid", groupId: values[0] };
  }
  function groupEventsHref(groupId) {
    return `events.html?group=${encodeURIComponent(groupId)}`;
  }
  function getGroupActivitySummary(events, groupId, now) {
    const related = filterEvents(events, { group: groupId });
    const upcoming = related.filter((event) => getEventTemporalState(event, now) !== "past").sort(
      (a, b) => a.date.localeCompare(b.date) || (a.startsAt || "99:99").localeCompare(b.startsAt || "99:99") || a.id.localeCompare(b.id)
    );
    const message = related.length === 0 ? "尚未收录相关活动，不代表该团没有活动。" : upcoming.length === 0 ? `已收录 ${related.length} 条日期已过的活动资料，尚未收录近期安排；日期经过不代表实际举办。` : `近期收录 ${upcoming.length} 条活动资料，以下最多显示 3 条。资料为部分收录，出发前请核对官宣及变更。`;
    return {
      total: related.length,
      upcomingCount: upcoming.length,
      upcoming: upcoming.slice(0, 3),
      message
    };
  }
  function renderGroupEvents(groupId) {
    const section = document.querySelector("#group-events");
    const link = document.querySelector("#group-events-link");
    const summary = document.querySelector("#group-events-summary");
    const list = document.querySelector("#group-events-list");
    if (!section || !link || !summary || !list) return;
    section.hidden = false;
    link.href = `${groupEventsHref(groupId)}&period=all`;
    const profile = document.querySelector(
      "#group-profile-link"
    );
    const correction = document.querySelector(
      "#group-correction-link"
    );
    if (profile) profile.href = `group.html?group=${encodeURIComponent(groupId)}`;
    if (correction)
      correction.href = `contribute.html?group=${encodeURIComponent(groupId)}&page=index&kind=error`;
    list.replaceChildren();
    list.hidden = true;
    const groups = window.IDOL_MAP_DATA?.groups;
    const validation = validateEventDataset(
      events_v1_default,
      groups?.map((group) => group.id) ?? []
    );
    if (!validation.valid) {
      summary.textContent = "活动资料校验失败，暂时不能显示摘要；请进入活动日历查看状态。";
      return;
    }
    const result = getGroupActivitySummary(
      validation.data.events,
      groupId,
      /* @__PURE__ */ new Date()
    );
    summary.textContent = result.message;
    const statuses = {
      scheduled: "计划举行",
      cancelled: "已取消",
      postponed: "已延期，请核对新安排",
      unconfirmed: "待确认，请核对官宣"
    };
    for (const event of result.upcoming) {
      const item = document.createElement("li");
      const eventLink = document.createElement("a");
      eventLink.href = `${groupEventsHref(groupId)}#${encodeURIComponent(event.id)}`;
      eventLink.textContent = `${event.date} · ${event.title}`;
      const note = document.createElement("p");
      note.textContent = `${statuses[event.status]} · ${event.startsAt ? `开演 ${event.startsAt}（UTC+8）` : "开演时间未确认"}`;
      item.append(eventLink, note);
      list.append(item);
    }
    list.hidden = result.upcoming.length === 0;
  }
  if (typeof window !== "undefined") {
    const holder = window;
    if (holder.IDOL_MAP_DATA?.groups) {
      try {
        holder.IDOL_MAP_DATA = {
          ...holder.IDOL_MAP_DATA,
          groups: overlayFollowerObservations(
            holder.IDOL_MAP_DATA.groups,
            follower_observations_v1_default,
            /* @__PURE__ */ new Date(),
            "archive"
          )
        };
      } catch {
        holder.IDOL_FOLLOWER_LAYER_ERROR = true;
      }
    }
    window.IDOL_SITE = { parseGroupLink, groupEventsHref, renderGroupEvents };
  }
})();

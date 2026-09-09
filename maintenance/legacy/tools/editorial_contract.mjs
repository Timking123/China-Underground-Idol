import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EDITORIAL_SCHEMA_VERSION = "1.0";
export const EDITORIAL_CONTRACT_KIND = "editorial-presentation-v1";
export const STYLE_TAXONOMY_VERSION = "editorial-style-v1";
export const VISUAL_TAXONOMY_VERSION = "preferred-group-visual-v1";
export const WEAK_EVIDENCE_SUFFIX = "（猜测）";
export const EDITORIAL_IMAGE_LIMITS = Object.freeze({
  maximumBytes: 64 * 1024 * 1024,
  maximumDimension: 12_000,
  maximumPixels: 80_000_000,
  maximumAspectRatio: 20,
});
const IMAGE_DECODER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "verify_image_decode.py",
);
const decodedImageCache = new Map();
const bundledPythonRoot = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
);
const bundledPythonPath = path.join(
  bundledPythonRoot,
  process.platform === "win32" ? "python.exe" : "bin/python",
);
// Codex workspace dependencies bundle 26.903.11726；外部核验 Authenticode 有效且签名主体为 OpenAI OpCo, LLC。
const BUNDLED_PYTHON_SHA256 =
  "ebdb7ddc892a73a9ece422fda408d0bbc2d232904cedeaae359066ef2db37317";
let decodedImageQueue = Promise.resolve();
let trustedPythonPathPromise = null;

export const STYLE_BAND_CONFIG = Object.freeze({
  strong_rock: { displayBand: "强摇滚", score: 0.9 },
  rock_experimental: { displayBand: "偏摇滚／实验", score: 0.45 },
  neutral_theme: { displayBand: "中性／主题企划", score: 0 },
  orthodox_dreamy: { displayBand: "偏王道／梦幻治愈", score: -0.48 },
  strong_orthodox: { displayBand: "强王道", score: -0.9 },
  axis_out: { displayBand: "轴外风格", score: null },
  unresolved: { displayBand: "风格未判定", score: null },
});

const EPISTEMIC_STATES = new Set(["fact", "inference", "guess", "uncertain"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const VISUAL_STATES = new Set(["selected", "not_found"]);
const VISUAL_KINDS = new Set([
  "full_roster_art_poster",
  "official_profile_cover",
  "official_group_artwork",
  "wiki_group_artwork",
  "directory_group_artwork",
]);
const SOURCE_AUTHORITIES = new Set([
  "official_group",
  "official_operator",
  "wiki_secondary",
  "third_party_directory",
  "legacy_archive",
  "indexed_public_material",
]);
const IDENTITY_BINDINGS = new Set([
  "exact_group_page",
  "official_operator_names_group",
  "wiki_exact_entry",
  "manual_exact_name_match",
]);
const GROUP_SCOPES = new Set([
  "full_group_art",
  "brand_art",
  "group_identity_art",
]);
const WIKI_STATES = new Set([
  "exact_page",
  "candidate",
  "searched_not_found",
  "unreviewed",
]);
const PROFILE_SUPPLEMENT_STATES = new Set([
  "accepted_candidate",
  "not_applied",
]);
const ALLOWED_EVIDENCE_HOSTS = new Set([
  "weibo.com",
  "sina.cn",
  "sinaimg.cn",
  "idol.schoid.cn",
  "chinaidols.fandom.com",
  "wikia.nocookie.net",
  "wikia.com",
  "tokimeki-afterschool.cn",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, label) {
  assert(
    typeof value === "string" && value.trim(),
    `${label} 必须是非空字符串`,
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

export function strictMusicAxisSnapshot(groups) {
  return groups.map((group) => ({
    id: group.id,
    primaryStyle: group.primaryStyle ?? null,
    styleScore: group.styleScore ?? null,
    styleBand: group.styleBand ?? null,
    styleReviewNote: group.styleReviewNote ?? null,
    fieldEvidenceStyle: group.fieldEvidence?.style ?? null,
  }));
}

export function strictMusicAxisSha256(groups) {
  return sha256Json(strictMusicAxisSnapshot(groups));
}

export function groupIdsSha256(groups) {
  return sha256Json(
    groups.map((group) => ({ id: group.id, handleKey: group.handleKey })),
  );
}

const STRICT_PROFILE_REJECTION_PATTERN =
  /拒绝|不得|不能|不可(?:以)?|不应|并非|不是|不属于|身份(?:阻塞|冲突|不匹配)|(?:无法|未能)绑定/u;
const CANONICAL_POSITIVE_UID_PATTERN = /^[1-9]\d*$/u;

export function canonicalPositiveUid(value, label = "UID") {
  assert(
    typeof value === "string" && CANONICAL_POSITIVE_UID_PATTERN.test(value),
    `${label} 必须是不含前导零的正十进制数字字符串`,
  );
  return value;
}

export function strictMasterRejectsCandidateUid(group, candidateUid) {
  if (typeof candidateUid !== "string" || !/^\d+$/u.test(candidateUid)) {
    return false;
  }
  const uid = canonicalPositiveUid(candidateUid, "候选 UID");
  const structuredRejection = (
    Array.isArray(group?.rejectedIdentityCandidates)
      ? group.rejectedIdentityCandidates
      : []
  ).some((candidate) => {
    const rejectedUid = candidate?.uid;
    if (!rejectedUid) return false;
    return (
      canonicalPositiveUid(rejectedUid, "结构化拒绝 UID") === uid
    );
  });
  if (structuredRejection) return true;

  const identity = group?.fieldEvidence?.profileIdentity;
  if (!["blocked", "not_found"].includes(identity?.state)) return false;
  const rationale = String(identity.rationale ?? "");
  const explicitlyRejected =
    [identity.rejectedUid, identity.candidateUid].some(
      (value) => String(value ?? "").trim() === uid,
    ) || rationale.includes(uid);
  return explicitlyRejected && STRICT_PROFILE_REJECTION_PATTERN.test(rationale);
}

export function assertSameUidAcceptedProfileTakeover(
  edgeRecord,
  acceptanceRecord,
  {
    acceptedDecision = "accepted_candidate",
    acceptedStatus = "accepted",
  } = {},
) {
  if (
    edgeRecord?.decision !== acceptedDecision ||
    acceptanceRecord?.status !== acceptedStatus
  ) {
    return false;
  }
  assert(
    edgeRecord.id === acceptanceRecord.id,
    "旧 Edge 候选与新接受记录必须绑定同一团体 ID",
  );
  const edgeUid = canonicalPositiveUid(
    edgeRecord.candidateUid,
    `${edgeRecord.id} 的旧 Edge 候选 UID`,
  );
  const acceptanceUid = canonicalPositiveUid(
    acceptanceRecord.uid,
    `${edgeRecord.id} 的新接受记录 UID`,
  );
  assert(
    edgeUid === acceptanceUid,
    `${edgeRecord.id} 的不同 UID 新接受记录不得接管旧 Edge 候选`,
  );
  return true;
}

export function assertAcceptedProfileMatchesIdentityAcceptance(
  profile,
  acceptance,
  record,
  {
    acceptedStatus = "accepted",
    acceptanceSourcePath,
  } = {},
) {
  if (profile?.state !== "accepted_candidate") return false;
  assert(
    acceptance?.status === acceptedStatus,
    `${record.id}.profileSupplement 缺少对应的已接受微博身份记录`,
  );
  assert(
    acceptance.id === record.id &&
      acceptance.handleKey === record.handleKey &&
      acceptance.screenName === record.handleKey,
    `${record.id}.profileSupplement 的接受记录未绑定当前团体`,
  );
  const profileUid = canonicalPositiveUid(
    profile.uid,
    `${record.id}.profileSupplement.uid`,
  );
  const acceptanceUid = canonicalPositiveUid(
    acceptance.uid,
    `${record.id} 的身份接受 UID`,
  );
  const expectedSourceFile =
    acceptance.supplementalReviewSource ?? acceptanceSourcePath;
  assert(
    profileUid === acceptanceUid &&
      profile.displayName === acceptance.screenName &&
      profile.profileBio === (acceptance.description || null) &&
      profile.profileUrl === acceptance.profileUrl &&
      profile.followersDisplay ===
        new Intl.NumberFormat("zh-CN").format(acceptance.followersCount) &&
      profile.followersValue === acceptance.followersCount &&
      profile.followersApproximate === false &&
      profile.identityReason === acceptance.identityEvidenceSummary &&
      profile.sourceFile === expectedSourceFile,
    `${record.id}.profileSupplement 未精确绑定微博身份接受记录`,
  );
  return true;
}

export function assertUniqueFinalAcceptedProfileUids(groups, records) {
  assert(Array.isArray(groups), "严格主档 groups 必须是数组");
  assert(Array.isArray(records), "编辑展示覆盖 records 必须是数组");
  const recordsById = new Map(records.map((record) => [record?.id, record]));
  const ownersByUid = new Map();

  for (const group of groups) {
    const rawStrictUid = group?.weiboUid;
    const strictUid =
      rawStrictUid === null ||
      rawStrictUid === undefined ||
      rawStrictUid === ""
        ? ""
        : canonicalPositiveUid(
            rawStrictUid,
            `${group.id} 的严格主档 UID`,
          );
    const profile = recordsById.get(group?.id)?.profileSupplement;
    const acceptedUid =
      profile?.state === "accepted_candidate"
        ? canonicalPositiveUid(profile.uid, `${group.id} 的 accepted UID`)
        : "";
    if (acceptedUid) {
      assert(
        !strictUid || strictUid === acceptedUid,
        `${group.id} 的 accepted UID 与严格主档 UID 冲突`,
      );
    }
    const finalUid = strictUid || acceptedUid;
    if (!finalUid) continue;
    const previousOwner = ownersByUid.get(finalUid);
    assert(
      !previousOwner || previousOwner === group.id,
      `最终 accepted UID ${finalUid} 在 ${previousOwner} 与 ${group.id} 间跨团重复`,
    );
    ownersByUid.set(finalUid, group.id);
  }

  return ownersByUid;
}

export function edgeBrowserReviewEditorialEvidence(record, sourcePath) {
  if (record?.status !== "accepted") return null;
  const location = record.activityCity ?? record.foundingCity ?? null;
  const locationRole = record.activityCity
    ? "activity"
    : record.foundingCity
      ? "founding"
      : null;
  const style = record.style ?? null;
  const buildLocationEvidence = (value, role) =>
    value
      ? {
          decision: "accepted_candidate",
          cityClue: value.city,
          cityClueRole: role,
          expectedProvince: value.province,
          expectedCity: value.city,
          finalUrl: value.sourceUrl,
        }
      : null;
  return {
    decision: "accepted_candidate",
    profileBio: record.description || null,
    ...(location
      ? {
          cityClue: location.city,
          cityClueRole: locationRole,
          expectedProvince: location.province,
          expectedCity: location.city,
          finalUrl: location.sourceUrl,
        }
      : {}),
    ...(record.activityCity
      ? {
          activityLocationEvidence: buildLocationEvidence(
            record.activityCity,
            "activity",
          ),
        }
      : {}),
    ...(record.foundingCity
      ? {
          foundingLocationEvidence: buildLocationEvidence(
            record.foundingCity,
            "founding",
          ),
        }
      : {}),
    ...(style
      ? {
          styleClue: style.sourceValue,
          styleClueAuthority:
            style.sourceUrl === record.profileUrl
              ? "official_profile_bio"
              : "official_group_post",
          styleSourceUrl: style.sourceUrl,
          expectedAxisBand: style.axisBand,
          styleSummary: style.rationale,
          styleConclusion: style.conclusion,
          styleEpistemicStatus: style.epistemicStatus,
          styleConfidence: style.confidence,
          styleUncertaintyCodes: style.uncertaintyCodes,
          edgeBrowserReviewStyle: true,
        }
      : {}),
    evidenceSource: sourcePath,
  };
}

const REGION_DEFINITIONS = Object.freeze({
  上海: ["上海市", "cn-shanghai", "上海市", "cn-shanghai/shanghai"],
  广东: ["广东省", "cn-guangdong", null, null],
  北京: ["北京市", "cn-beijing", "北京市", "cn-beijing/beijing"],
  四川: ["四川省", "cn-sichuan", null, null],
  江苏: ["江苏省", "cn-jiangsu", null, null],
  湖北: ["湖北省", "cn-hubei", null, null],
  陕西: ["陕西省", "cn-shaanxi", null, null],
  重庆: ["重庆市", "cn-chongqing", "重庆市", "cn-chongqing/chongqing"],
  河南: ["河南省", "cn-henan", null, null],
  湖南: ["湖南省", "cn-hunan", null, null],
  福建: ["福建省", "cn-fujian", null, null],
  山东: ["山东省", "cn-shandong", null, null],
  广西: ["广西壮族自治区", "cn-guangxi", null, null],
  天津: ["天津市", "cn-tianjin", "天津市", "cn-tianjin/tianjin"],
  江西: ["江西省", "cn-jiangxi", null, null],
  浙江: ["浙江省", "cn-zhejiang", null, null],
  安徽: ["安徽省", "cn-anhui", null, null],
  辽宁: ["辽宁省", "cn-liaoning", null, null],
  吉林: ["吉林省", "cn-jilin", null, null],
  海南: ["海南省", "cn-hainan", null, null],
  贵州: ["贵州省", "cn-guizhou", null, null],
  甘肃: ["甘肃省", "cn-gansu", null, null],
  山西: ["山西省", "cn-shanxi", null, null],
  内蒙古: ["内蒙古自治区", "cn-inner-mongolia", null, null],
  河北: ["河北省", "cn-hebei", null, null],
  云南: ["云南省", "cn-yunnan", null, null],
  宁夏: ["宁夏回族自治区", "cn-ningxia", null, null],
  新疆: ["新疆维吾尔自治区", "cn-xinjiang", null, null],
});

const PROVINCE_CITY_KEYWORDS = Object.freeze({
  广东: [
    "广州",
    "深圳",
    "珠海",
    "汕头",
    "佛山",
    "韶关",
    "湛江",
    "肇庆",
    "江门",
    "茂名",
    "惠州",
    "梅州",
    "汕尾",
    "河源",
    "阳江",
    "清远",
    "东莞",
    "中山",
    "潮州",
    "揭阳",
    "云浮",
  ],
  四川: [
    "成都",
    "绵阳",
    "德阳",
    "乐山",
    "宜宾",
    "南充",
    "自贡",
    "攀枝花",
    "泸州",
    "广元",
    "遂宁",
    "内江",
    "眉山",
    "广安",
    "达州",
    "雅安",
    "巴中",
    "资阳",
    "凉山",
    "阿坝",
    "甘孜",
  ],
  江苏: [
    "南京",
    "苏州",
    "无锡",
    "常州",
    "镇江",
    "扬州",
    "泰州",
    "南通",
    "徐州",
    "淮安",
    "盐城",
    "连云港",
    "宿迁",
  ],
  湖北: [
    "武汉",
    "宜昌",
    "襄阳",
    "荆州",
    "鄂州",
    "荆门",
    "黄石",
    "十堰",
    "孝感",
    "黄冈",
    "咸宁",
    "随州",
    "恩施",
  ],
  陕西: [
    "西安",
    "咸阳",
    "宝鸡",
    "渭南",
    "铜川",
    "延安",
    "榆林",
    "汉中",
    "安康",
    "商洛",
  ],
  河南: [
    "郑州",
    "洛阳",
    "开封",
    "新乡",
    "安阳",
    "焦作",
    "许昌",
    "漯河",
    "商丘",
    "周口",
    "驻马店",
    "南阳",
    "信阳",
    "濮阳",
    "鹤壁",
    "平顶山",
    "三门峡",
  ],
  湖南: [
    "长沙",
    "株洲",
    "湘潭",
    "衡阳",
    "邵阳",
    "岳阳",
    "常德",
    "张家界",
    "益阳",
    "郴州",
    "永州",
    "怀化",
    "娄底",
    "湘西",
  ],
  福建: [
    "福州",
    "厦门",
    "泉州",
    "漳州",
    "莆田",
    "宁德",
    "南平",
    "三明",
    "龙岩",
  ],
  山东: [
    "济南",
    "青岛",
    "淄博",
    "枣庄",
    "东营",
    "烟台",
    "潍坊",
    "济宁",
    "泰安",
    "威海",
    "日照",
    "临沂",
    "德州",
    "聊城",
    "滨州",
    "菏泽",
  ],
  广西: [
    "南宁",
    "柳州",
    "桂林",
    "梧州",
    "北海",
    "防城港",
    "钦州",
    "贵港",
    "玉林",
    "百色",
    "贺州",
    "河池",
    "来宾",
    "崇左",
  ],
  江西: [
    "南昌",
    "景德镇",
    "萍乡",
    "九江",
    "新余",
    "鹰潭",
    "赣州",
    "吉安",
    "宜春",
    "抚州",
    "上饶",
  ],
  浙江: [
    "杭州",
    "宁波",
    "温州",
    "嘉兴",
    "湖州",
    "绍兴",
    "金华",
    "衢州",
    "舟山",
    "台州",
    "丽水",
  ],
  安徽: [
    "合肥",
    "芜湖",
    "蚌埠",
    "淮南",
    "马鞍山",
    "淮北",
    "铜陵",
    "安庆",
    "黄山",
    "滁州",
    "阜阳",
    "宿州",
    "六安",
    "亳州",
    "池州",
    "宣城",
  ],
  辽宁: [
    "沈阳",
    "大连",
    "鞍山",
    "抚顺",
    "本溪",
    "丹东",
    "锦州",
    "营口",
    "阜新",
    "辽阳",
    "盘锦",
    "铁岭",
    "朝阳",
    "葫芦岛",
  ],
  吉林: [
    "长春",
    "吉林市",
    "四平",
    "辽源",
    "通化",
    "白山",
    "松原",
    "白城",
    "延边",
  ],
  海南: ["海口", "三亚", "三沙", "儋州"],
  贵州: [
    "贵阳",
    "六盘水",
    "遵义",
    "安顺",
    "毕节",
    "铜仁",
    "黔西南",
    "黔东南",
    "黔南",
  ],
  甘肃: [
    "兰州",
    "嘉峪关",
    "金昌",
    "白银",
    "天水",
    "武威",
    "张掖",
    "平凉",
    "酒泉",
    "庆阳",
    "定西",
    "陇南",
    "临夏",
    "甘南",
  ],
  山西: [
    "太原",
    "大同",
    "阳泉",
    "长治",
    "晋城",
    "朔州",
    "晋中",
    "运城",
    "忻州",
    "临汾",
    "吕梁",
  ],
  内蒙古: [
    "呼和浩特",
    "包头",
    "乌海",
    "赤峰",
    "通辽",
    "鄂尔多斯",
    "呼伦贝尔",
    "巴彦淖尔",
    "乌兰察布",
    "兴安盟",
    "锡林郭勒",
    "阿拉善",
  ],
  河北: [
    "石家庄",
    "唐山",
    "秦皇岛",
    "邯郸",
    "邢台",
    "保定",
    "张家口",
    "承德",
    "沧州",
    "廊坊",
    "衡水",
  ],
  云南: [
    "昆明",
    "曲靖",
    "玉溪",
    "保山",
    "昭通",
    "丽江",
    "普洱",
    "临沧",
    "楚雄",
    "红河",
    "文山",
    "西双版纳",
    "大理",
    "德宏",
    "怒江",
    "迪庆",
  ],
  宁夏: ["银川", "石嘴山", "吴忠", "固原", "中卫"],
  新疆: [
    "乌鲁木齐",
    "克拉玛依",
    "吐鲁番",
    "哈密",
    "昌吉",
    "博尔塔拉",
    "巴音郭楞",
    "阿克苏",
    "克孜勒苏",
    "喀什",
    "和田",
    "伊犁",
    "塔城",
    "阿勒泰",
  ],
});

const REGION_EVIDENCE_FIELDS = Object.freeze([
  "profileBio",
  "notes",
  "styleReviewNote",
  "secondaryTags",
  "originalSecondaryTags",
]);

export function normalizeEditorialRegion(
  group,
  supplementalOrigin = null,
  verifiedRegionSupplement = null,
) {
  const sourceRegion = String(
    group.city ?? group.region ?? group.地区 ?? "",
  ).trim();
  const supplement =
    typeof verifiedRegionSupplement === "string"
      ? {
          text: verifiedRegionSupplement,
          basis: "acceptedProfileSupplement",
          singleReason: "accepted_public_profile_single_same_province_city",
          multipleReason: "multiple_same_province_cities_in_profile_supplement",
          authority: "official_group",
        }
      : verifiedRegionSupplement;
  if (supplement?.province && supplement?.city) {
    const matchedRegion = Object.entries(REGION_DEFINITIONS).find(
      ([, definition]) => definition[0] === supplement.province,
    );
    if (!matchedRegion) {
      throw new Error("地域补充给出了不受控省级行政区");
    }
    const [regionLabel, definition] = matchedRegion;
    const [province, provinceKey, municipality, municipalityKey] = definition;
    const normalizedCity = /(?:自治州|盟|地区|市)$/u.test(supplement.city)
      ? supplement.city
      : `${supplement.city}市`;
    const allowedCities = municipality
      ? new Set([municipality])
      : new Set(
          (PROVINCE_CITY_KEYWORDS[regionLabel] ?? []).map((city) =>
            /(?:自治州|盟|地区|市)$/u.test(city) ? city : `${city}市`,
          ),
        );
    if (!allowedCities.has(normalizedCity)) {
      throw new Error("地域补充给出的城市不属于受控省级行政区");
    }
    return {
      province,
      city: normalizedCity,
      provinceKey,
      cityKey:
        municipality && normalizedCity === municipality
          ? municipalityKey
          : `${provinceKey}/${encodeURIComponent(normalizedCity)}`,
      resolutionState: "evidence_text",
      resolutionBasis: [supplement.basis],
      resolutionReason: supplement.singleReason,
      cityCandidates: [],
      conflict: false,
      manualReview: false,
      conflictingCities: [],
      sourceRegion: String(supplementalOrigin ?? (sourceRegion || regionLabel)),
    };
  }
  const definition = REGION_DEFINITIONS[sourceRegion];
  if (!definition)
    return {
      province: null,
      city: null,
      provinceKey: null,
      cityKey: null,
      resolutionState: "unknown",
      resolutionBasis: [],
      resolutionReason: "no_supported_region",
      cityCandidates: [],
      conflict: false,
      manualReview: false,
      conflictingCities: [],
      sourceRegion: sourceRegion || null,
    };
  const [province, provinceKey, municipality, municipalityKey] = definition;
  if (municipality)
    return {
      province,
      city: municipality,
      provinceKey,
      cityKey: municipalityKey,
      resolutionState: "direct_municipality",
      resolutionBasis: ["region"],
      resolutionReason: "municipality",
      cityCandidates: [],
      conflict: false,
      manualReview: false,
      conflictingCities: [],
      sourceRegion,
    };
  const cityHitsFromText = (value) => {
    const cityHits = new Set();
    const text = String(value ?? "");
    for (const keyword of PROVINCE_CITY_KEYWORDS[sourceRegion] ?? []) {
      if (!text.includes(keyword)) continue;
      cityHits.add(
        /(?:自治州|盟|地区|市)$/u.test(keyword) ? keyword : `${keyword}市`,
      );
    }
    return cityHits;
  };
  const hits = new Map();
  for (const field of REGION_EVIDENCE_FIELDS) {
    const raw = group[field];
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const text = String(value ?? "");
      for (const keyword of PROVINCE_CITY_KEYWORDS[sourceRegion] ?? []) {
        if (!text.includes(keyword)) continue;
        const city = /(?:自治州|盟|地区|市)$/u.test(keyword)
          ? keyword
          : `${keyword}市`;
        const hit = hits.get(city) ?? { city, fields: new Set() };
        hit.fields.add(field);
        hits.set(city, hit);
      }
    }
  }
  const supplementHits = cityHitsFromText(supplement?.text);
  const wikiHits = cityHitsFromText(supplementalOrigin);
  if (supplementHits.size > 0) {
    if (supplementHits.size === 1) {
      const city = [...supplementHits][0];
      const conflictingCities = [
        ...new Set(
          [...hits.keys(), ...wikiHits].filter((item) => item !== city),
        ),
      ].sort();
      if (
        conflictingCities.length > 0 &&
        supplement.authority !== "official_group"
      ) {
        const cityCandidates = [
          ...new Set([city, ...conflictingCities]),
        ].sort();
        return {
          province,
          city: null,
          provinceKey,
          cityKey: null,
          resolutionState: "city_unresolved",
          resolutionBasis: [
            supplement.basis,
            ...(hits.size
              ? [
                  ...new Set(
                    [...hits.values()].flatMap((hit) => [...hit.fields]),
                  ),
                ].sort()
              : []),
            ...(wikiHits.size ? ["communityWikiOrigin"] : []),
          ],
          resolutionReason:
            "curated_editorial_conflicts_with_other_city_evidence",
          cityCandidates,
          conflict: true,
          manualReview: true,
          conflictingCities,
          sourceRegion,
        };
      }
      return {
        province,
        city,
        provinceKey,
        cityKey: `${provinceKey}/${encodeURIComponent(city)}`,
        resolutionState: "evidence_text",
        resolutionBasis: [supplement.basis],
        resolutionReason: conflictingCities.length
          ? "official_supplement_overrides_conflicting_city_evidence"
          : supplement.singleReason,
        cityCandidates: [],
        conflict: conflictingCities.length > 0,
        manualReview: conflictingCities.length > 0,
        conflictingCities,
        sourceRegion,
      };
    }
    if (supplementHits.size > 1) {
      return {
        province,
        city: null,
        provinceKey,
        cityKey: null,
        resolutionState: "city_unresolved",
        resolutionBasis: [supplement.basis],
        resolutionReason: supplement.multipleReason,
        cityCandidates: [...supplementHits].sort(),
        conflict: true,
        manualReview: true,
        conflictingCities: [...supplementHits].sort(),
        sourceRegion,
      };
    }
  }
  if (hits.size === 1) {
    const hit = [...hits.values()][0];
    const conflictingCities = [...wikiHits]
      .filter((city) => city !== hit.city)
      .sort();
    if (conflictingCities.length > 0) {
      return {
        province,
        city: null,
        provinceKey,
        cityKey: null,
        resolutionState: "city_unresolved",
        resolutionBasis: [...hit.fields, "communityWikiOrigin"].sort(),
        resolutionReason: "legacy_and_wiki_city_conflict",
        cityCandidates: [...new Set([hit.city, ...conflictingCities])].sort(),
        conflict: true,
        manualReview: true,
        conflictingCities,
        sourceRegion,
      };
    }
    return {
      province,
      city: hit.city,
      provinceKey,
      cityKey: `${provinceKey}/${encodeURIComponent(hit.city)}`,
      resolutionState: "evidence_text",
      resolutionBasis: [...hit.fields].sort(),
      resolutionReason: "single_same_province_city_mention",
      cityCandidates: [],
      conflict: false,
      manualReview: false,
      conflictingCities: [],
      sourceRegion,
    };
  }
  if (hits.size > 1) {
    return {
      province,
      city: null,
      provinceKey,
      cityKey: null,
      resolutionState: "city_unresolved",
      resolutionBasis: [
        ...new Set([...hits.values()].flatMap((hit) => [...hit.fields])),
      ].sort(),
      resolutionReason: "multiple_same_province_city_mentions",
      cityCandidates: [...hits.keys()].sort(),
      conflict: true,
      manualReview: true,
      conflictingCities: [...hits.keys()].sort(),
      sourceRegion,
    };
  }
  if (wikiHits.size > 0) {
    if (wikiHits.size === 1) {
      const city = [...wikiHits][0];
      return {
        province,
        city,
        provinceKey,
        cityKey: `${provinceKey}/${encodeURIComponent(city)}`,
        resolutionState: "evidence_text",
        resolutionBasis: ["communityWikiOrigin"],
        resolutionReason: "exact_wiki_origin_single_same_province_city",
        cityCandidates: [],
        conflict: false,
        manualReview: false,
        conflictingCities: [],
        sourceRegion,
      };
    }
    if (wikiHits.size > 1) {
      return {
        province,
        city: null,
        provinceKey,
        cityKey: null,
        resolutionState: "city_unresolved",
        resolutionBasis: ["communityWikiOrigin"],
        resolutionReason: "multiple_same_province_cities_in_wiki_origin",
        cityCandidates: [...wikiHits].sort(),
        conflict: true,
        manualReview: true,
        conflictingCities: [...wikiHits].sort(),
        sourceRegion,
      };
    }
  }
  return {
    province,
    city: null,
    provinceKey,
    cityKey: null,
    resolutionState: "city_unresolved",
    resolutionBasis: [],
    resolutionReason: "no_city_evidence",
    cityCandidates: [],
    conflict: false,
    manualReview: false,
    conflictingCities: [],
    sourceRegion,
  };
}

function emptyEditorialLocation(role, reason) {
  return {
    province: null,
    city: null,
    provinceKey: null,
    cityKey: null,
    resolutionState: "unknown",
    resolutionBasis: [],
    resolutionReason: reason,
    cityCandidates: [],
    conflict: false,
    manualReview: false,
    conflictingCities: [],
    sourceRegion: null,
    locationRole: role,
  };
}

function profileRegionSupplement(profileRecord, role) {
  const roleSpecific = profileRecord?.[`${role}LocationEvidence`];
  const effectiveRecord = roleSpecific ?? profileRecord;
  if (!effectiveRecord?.cityClue && !effectiveRecord?.profileBio) return null;
  const configuredRole = effectiveRecord.cityClueRole ?? "activity";
  if (configuredRole !== role) return null;
  if (effectiveRecord.decision === "accepted_candidate") {
    return {
      text: [effectiveRecord.profileBio, effectiveRecord.cityClue]
        .filter(Boolean)
        .join("；"),
      basis: "acceptedProfileSupplement",
      singleReason: "accepted_public_profile_single_same_province_city",
      multipleReason: "multiple_same_province_cities_in_profile_supplement",
      authority: "official_group",
      province: effectiveRecord.expectedProvince ?? null,
      city: effectiveRecord.expectedCity ?? null,
    };
  }
  if (
    effectiveRecord.decision === "editorial_evidence_only" &&
    effectiveRecord.cityClue
  ) {
    return {
      text: effectiveRecord.cityClue,
      basis: "curatedEditorialEvidence",
      singleReason: "curated_editorial_single_same_province_city",
      multipleReason:
        "multiple_same_province_cities_in_curated_editorial_evidence",
      authority: "curated_editorial",
      province: effectiveRecord.expectedProvince ?? null,
      city: effectiveRecord.expectedCity ?? null,
    };
  }
  return null;
}

export function buildEditorialRegionDecision(
  group,
  wikiRecord,
  profileRecord,
  curatedRecord = null,
) {
  const wikiOrigin =
    wikiRecord?.wikiState === "matched" &&
    wikiRecord.candidateEvidence?.origin?.usableForEditorialRegion === true
      ? wikiRecord.candidateEvidence.origin.value
      : null;
  const activitySupplement =
    profileRegionSupplement(curatedRecord, "activity") ??
    profileRegionSupplement(profileRecord, "activity");
  const foundingSupplement =
    profileRegionSupplement(curatedRecord, "founding") ??
    profileRegionSupplement(profileRecord, "founding");
  const activity = {
    ...normalizeEditorialRegion(group, null, activitySupplement),
    locationRole: "activity",
  };
  let founding = emptyEditorialLocation(
    "founding",
    "no_verified_founding_city_evidence",
  );
  if (wikiOrigin || foundingSupplement) {
    const foundingEvidenceGroup = {
      ...group,
      city: null,
      profileBio: null,
      notes: null,
      styleReviewNote: null,
      secondaryTags: [],
      originalSecondaryTags: [],
    };
    founding = {
      ...normalizeEditorialRegion(
        foundingEvidenceGroup,
        wikiOrigin,
        foundingSupplement,
      ),
      locationRole: "founding",
    };
    if (
      wikiOrigin &&
      !founding.resolutionBasis.includes("communityWikiOrigin") &&
      !foundingSupplement
    ) {
      founding.resolutionBasis = [
        ...founding.resolutionBasis,
        "communityWikiOrigin",
      ];
    }
  }
  const primaryRole = activity.city
    ? "activity"
    : founding.city
      ? "founding"
      : activity.province
        ? "activity"
        : "founding";
  const primary = primaryRole === "activity" ? activity : founding;
  return {
    ...primary,
    primaryRole,
    conflict: activity.conflict || founding.conflict,
    manualReview: activity.manualReview || founding.manualReview,
    conflictingCities: [
      ...new Set([
        ...activity.conflictingCities,
        ...founding.conflictingCities,
      ]),
    ].sort(),
    founding,
    activity,
  };
}

export function assertControlledHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = [...ALLOWED_EVIDENCE_HOSTS].some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
  assert(
    parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      allowed,
    `${label} 必须是受控来源域、无 userinfo 和端口的 HTTPS URL`,
  );
  return parsed;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPngDimensions(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  let offset = 8;
  let dimensions = null;
  let foundImageData = false;
  let foundEnd = false;
  let chunkIndex = 0;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) return null;
    const type = bytes.subarray(typeStart, dataStart).toString("ascii");
    if (pngCrc32(bytes, typeStart, dataEnd) !== bytes.readUInt32BE(dataEnd)) {
      return null;
    }
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) return null;
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      }[colorType];
      if (
        !validDepths?.includes(bitDepth) ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        ![0, 1].includes(bytes[dataStart + 12])
      ) {
        return null;
      }
      dimensions = { width, height, format: "png" };
    } else if (type === "IHDR") {
      return null;
    }
    if (type === "IDAT") {
      if (length === 0) return null;
      foundImageData = true;
    }
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) return null;
      foundEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (offset !== bytes.length || !dimensions || !foundImageData || !foundEnd) {
    return null;
  }
  return dimensions;
}

function readJpegDimensions(bytes) {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return null;
  }
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  let dimensions = null;
  let scanDataStart = null;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length - 2) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length - 2) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (length < 8) return null;
      const componentCount = bytes[offset + 7];
      if (componentCount < 1 || length < 8 + componentCount * 3) return null;
      dimensions = {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
        format: "jpeg",
      };
    }
    if (marker === 0xda) {
      if (length < 6 || !dimensions) return null;
      scanDataStart = offset + length;
      break;
    }
    offset += length;
  }
  if (scanDataStart === null || scanDataStart >= bytes.length - 2) return null;
  return dimensions;
}

function readUInt24Le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readWebpDimensions(bytes) {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    return null;
  }
  let canvasDimensions = null;
  let payloadDimensions = null;
  let imagePayloadCount = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) return null;
    if (type === "VP8X" && size >= 10) {
      canvasDimensions = {
        width: readUInt24Le(bytes, data + 4) + 1,
        height: readUInt24Le(bytes, data + 7) + 1,
        format: "webp",
      };
    }
    if (type === "VP8L" && size >= 6 && bytes[data] === 0x2f) {
      imagePayloadCount += 1;
      payloadDimensions = {
        width: 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8),
        height:
          1 +
          (bytes[data + 2] >> 6) +
          (bytes[data + 3] << 2) +
          ((bytes[data + 4] & 0x0f) << 10),
        format: "webp",
      };
    }
    if (
      type === "VP8 " &&
      size >= 11 &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      imagePayloadCount += 1;
      payloadDimensions = {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
        format: "webp",
      };
    }
    offset = data + size + (size % 2);
  }
  if (offset !== bytes.length || imagePayloadCount !== 1) return null;
  const dimensions = canvasDimensions ?? payloadDimensions;
  if (
    !dimensions ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    (canvasDimensions &&
      payloadDimensions &&
      (canvasDimensions.width !== payloadDimensions.width ||
        canvasDimensions.height !== payloadDimensions.height))
  )
    return null;
  return dimensions;
}

async function trustedPythonPath() {
  if (!trustedPythonPathPromise) {
    trustedPythonPathPromise = (async () => {
      const [rootStat, executableStat, realRoot, realExecutable] =
        await Promise.all([
          fs.lstat(bundledPythonRoot),
          fs.lstat(bundledPythonPath),
          fs.realpath(bundledPythonRoot),
          fs.realpath(bundledPythonPath),
        ]);
      assert(
        rootStat.isDirectory() && !rootStat.isSymbolicLink(),
        "Codex bundled Python 根目录必须是非链接真实目录",
      );
      assert(
        executableStat.isFile() && !executableStat.isSymbolicLink(),
        "Codex bundled Python 必须是非链接普通文件",
      );
      assert(
        isWithin(realRoot, realExecutable),
        "Codex bundled Python 解析到受控运行时目录外",
      );
      assert(
        sha256(await fs.readFile(realExecutable)) === BUNDLED_PYTHON_SHA256,
        "Codex bundled Python 可执行文件摘要与本档案锁定值不一致",
      );
      return realExecutable;
    })();
  }
  return await trustedPythonPathPromise;
}

function scheduleDecodedImage(task) {
  const result = decodedImageQueue.then(task, task);
  decodedImageQueue = result.catch(() => undefined);
  return result;
}

function decodeImageWithPillow(bytes, digest, limits) {
  if (decodedImageCache.has(digest)) return decodedImageCache.get(digest);
  const decoding = scheduleDecodedImage(async () => {
    const pythonPath = await trustedPythonPath();
    return await new Promise((resolve, reject) => {
      const child = spawn(
        pythonPath,
        [
          "-I",
          "-B",
          IMAGE_DECODER_PATH,
          String(limits.maximumBytes),
          String(limits.maximumDimension),
          String(limits.maximumPixels),
          String(limits.maximumAspectRatio),
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("Pillow 图片完整解码超时"));
      }, 120_000);
      child.once("error", (error) =>
        finish(new Error(`无法启动 Pillow 图片解码器：${error.message}`)),
      );
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > 4096) {
          child.kill();
          finish(new Error("Pillow 图片解码器输出异常"));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= 16_384) stderr.push(chunk);
      });
      child.once("close", (code) => {
        if (settled) return;
        const diagnostic = Buffer.concat(stderr)
          .toString("utf8")
          .trim()
          .slice(0, 1000);
        if (code !== 0) {
          finish(
            new Error(
              `素材无法由 Pillow 完整解码${diagnostic ? `：${diagnostic}` : ""}`,
            ),
          );
          return;
        }
        try {
          finish(null, JSON.parse(Buffer.concat(stdout).toString("utf8")));
        } catch {
          finish(new Error("Pillow 图片解码器返回无效结果"));
        }
      });
      child.stdin.once("error", (error) => {
        if (error?.code !== "EPIPE") finish(error);
      });
      child.stdin.end(bytes);
    });
  });
  decodedImageCache.set(digest, decoding);
  decoding.catch(() => decodedImageCache.delete(digest));
  return decoding;
}

export async function inspectImageBuffer(bytes, requestedLimits = {}) {
  const limits = { ...EDITORIAL_IMAGE_LIMITS, ...requestedLimits };
  for (const key of [
    "maximumBytes",
    "maximumDimension",
    "maximumPixels",
    "maximumAspectRatio",
  ]) {
    assert(
      Number.isFinite(limits[key]) &&
        limits[key] > 0 &&
        limits[key] <= EDITORIAL_IMAGE_LIMITS[key],
      `图片调用方 ${key} 上限无效`,
    );
  }
  assert(Buffer.isBuffer(bytes), "素材必须以 Buffer 提供");
  assert(
    bytes.length > 0 && bytes.length <= limits.maximumBytes,
    "素材字节数越出允许范围",
  );
  const dimensions =
    readPngDimensions(bytes) ??
    readJpegDimensions(bytes) ??
    readWebpDimensions(bytes);
  assert(dimensions, "素材不是受支持的 JPEG、PNG 或 WebP 图像");
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  const longEdge = Math.max(dimensions.width, dimensions.height);
  assert(
    Number.isInteger(dimensions.width) &&
      Number.isInteger(dimensions.height) &&
      shortEdge > 0 &&
      longEdge <= limits.maximumDimension &&
      dimensions.width * dimensions.height <= limits.maximumPixels &&
      longEdge / shortEdge <= limits.maximumAspectRatio,
    "素材尺寸、像素数或宽高比越出允许范围",
  );
  const digest = sha256(bytes);
  const decoded = await decodeImageWithPillow(bytes, digest, limits);
  assert(
    decoded?.format === dimensions.format &&
      decoded?.width === dimensions.width &&
      decoded?.height === dimensions.height,
    "素材容器信息与完整解码结果不一致",
  );
  return {
    ...dimensions,
    bytes: bytes.length,
    sha256: digest,
  };
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

export function exactGroupRecordsById(source, label, expectedCount = 399) {
  assert(
    isPlainObject(source) &&
      Array.isArray(source.records) &&
      source.records.length === expectedCount,
    `${label} 必须包含 ${expectedCount} 条逐团记录`,
  );
  const records = new Map();
  for (const record of source.records) {
    assert(
      isPlainObject(record) &&
        /^g\d{3}$/u.test(record.id ?? "") &&
        !records.has(record.id),
      `${label} 含无效或重复 ID`,
    );
    records.set(record.id, record);
  }
  return records;
}

export async function resolveControlledSourceJson(rootDirectory, entry, label) {
  assert(isPlainObject(entry), `${label} 候选源配置缺失`);
  assert(
    /^sources\/[^/\\]+\.json$/u.test(entry.path ?? ""),
    `${label} 候选源必须是 sources 下的单层 JSON 文件`,
  );
  const archiveRoot = path.resolve(rootDirectory);
  const sourcesRoot = path.join(archiveRoot, "sources");
  const resolved = path.resolve(archiveRoot, entry.path);
  assert(isWithin(sourcesRoot, resolved), `${label} 候选源越出 sources 边界`);

  const [sourcesStat, fileStat] = await Promise.all([
    fs.lstat(sourcesRoot),
    fs.lstat(resolved),
  ]);
  assert(
    sourcesStat.isDirectory() && !sourcesStat.isSymbolicLink(),
    `${label} 的 sources 根目录必须是非链接真实目录`,
  );
  assert(
    fileStat.isFile() && !fileStat.isSymbolicLink(),
    `${label} 候选源必须是非链接普通文件`,
  );

  const [realArchiveRoot, realSourcesRoot, realPath] = await Promise.all([
    fs.realpath(archiveRoot),
    fs.realpath(sourcesRoot),
    fs.realpath(resolved),
  ]);
  const expectedSourcesRoot = path.join(realArchiveRoot, "sources");
  assert(
    path.relative(expectedSourcesRoot, realSourcesRoot) === "",
    `${label} 的 sources 根目录解析到归档外`,
  );
  assert(
    isWithin(realSourcesRoot, realPath),
    `${label} 候选源解析到 sources 边界外`,
  );
  return realPath;
}

export async function readControlledFileBytes(
  rootDirectory,
  relativePath,
  allowedPattern,
  label,
) {
  assert(
    typeof relativePath === "string" &&
      allowedPattern instanceof RegExp &&
      allowedPattern.test(relativePath) &&
      !relativePath.includes("\\"),
    `${label} 路径不在允许范围`,
  );
  const archiveRoot = path.resolve(rootDirectory);
  const resolved = path.resolve(archiveRoot, relativePath);
  const relative = path.relative(archiveRoot, resolved);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${label} 路径越出归档边界`,
  );
  const parent = path.dirname(resolved);
  const [archiveStat, parentStat, fileStat] = await Promise.all([
    fs.lstat(archiveRoot),
    fs.lstat(parent),
    fs.lstat(resolved),
  ]);
  assert(
    archiveStat.isDirectory() && !archiveStat.isSymbolicLink(),
    `${label} 的归档根目录必须是非链接真实目录`,
  );
  assert(
    parentStat.isDirectory() && !parentStat.isSymbolicLink(),
    `${label} 的父目录必须是非链接真实目录`,
  );
  assert(
    fileStat.isFile() && !fileStat.isSymbolicLink(),
    `${label} 必须是非链接普通文件`,
  );
  const [realArchiveRoot, realParent, realFile] = await Promise.all([
    fs.realpath(archiveRoot),
    fs.realpath(parent),
    fs.realpath(resolved),
  ]);
  const expectedParent = path.resolve(
    realArchiveRoot,
    path.dirname(relativePath),
  );
  assert(
    path.relative(expectedParent, realParent) === "" &&
      isWithin(realParent, realFile),
    `${label} 解析到归档外`,
  );
  return await fs.readFile(realFile);
}

function processAppearsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export async function acquireControlledWriteLock(
  rootDirectory,
  relativeLockPath,
  toolId,
) {
  assert(
    /^sources\/\.[a-z0-9-]+\.lock$/u.test(relativeLockPath ?? ""),
    "写入锁必须是 sources 下的固定隐藏 lock 文件",
  );
  assert(
    typeof toolId === "string" && toolId.startsWith("tools/"),
    "写入锁 toolId 无效",
  );
  const archiveRoot = path.resolve(rootDirectory);
  const lockPath = path.resolve(archiveRoot, relativeLockPath);
  const parentPath = path.dirname(lockPath);
  const [archiveStat, parentStat, realArchiveRoot, realParent] =
    await Promise.all([
      fs.lstat(archiveRoot),
      fs.lstat(parentPath),
      fs.realpath(archiveRoot),
      fs.realpath(parentPath),
    ]);
  assert(
    archiveStat.isDirectory() && !archiveStat.isSymbolicLink(),
    "写入锁的归档根目录必须是非链接真实目录",
  );
  assert(
    parentStat.isDirectory() && !parentStat.isSymbolicLink(),
    "写入锁的父目录必须是非链接真实目录",
  );
  assert(
    path.relative(path.join(realArchiveRoot, "sources"), realParent) === "",
    "写入锁父目录解析到归档外",
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nonce = crypto.randomBytes(32).toString("hex");
    let lockHandle;
    let createdLock = false;
    try {
      lockHandle = await fs.open(lockPath, "wx");
      createdLock = true;
      const lockRecord = {
        schemaVersion: "controlled-write-lock-v1",
        toolId,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        nonce,
      };
      const lockBytes = Buffer.from(
        `${JSON.stringify(lockRecord, null, 2)}\n`,
        "utf8",
      );
      await lockHandle.writeFile(lockBytes);
      await lockHandle.sync();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await lockHandle.close();
        const currentBytes = await readControlledFileBytes(
          archiveRoot,
          relativeLockPath,
          /^sources\/\.[a-z0-9-]+\.lock$/u,
          "写入锁",
        );
        const current = JSON.parse(currentBytes.toString("utf8"));
        assert(
          current.toolId === toolId &&
            current.nonce === nonce &&
            crypto.timingSafeEqual(
              crypto.createHash("sha256").update(lockBytes).digest(),
              crypto.createHash("sha256").update(currentBytes).digest(),
            ),
          "写入锁在事务期间已变化，拒绝删除未知锁",
        );
        await fs.unlink(lockPath);
      };
    } catch (error) {
      if (lockHandle) {
        try {
          await lockHandle.close();
        } catch {
          // 保留原始异常。
        }
      }
      if (error?.code !== "EEXIST") {
        if (createdLock) {
          try {
            await fs.unlink(lockPath);
          } catch (cleanupError) {
            if (cleanupError?.code !== "ENOENT") throw cleanupError;
          }
        }
        throw error;
      }

      let existingBytes;
      try {
        existingBytes = await readControlledFileBytes(
          archiveRoot,
          relativeLockPath,
          /^sources\/\.[a-z0-9-]+\.lock$/u,
          "既有写入锁",
        );
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      let existing;
      try {
        existing = JSON.parse(existingBytes.toString("utf8"));
      } catch {
        throw new Error(
          `${relativeLockPath} 内容无效；确认没有写入进程后需人工移除`,
        );
      }
      const validExisting =
        existing !== null &&
        typeof existing === "object" &&
        !Array.isArray(existing) &&
        Object.keys(existing).sort().join("|") ===
          "createdAt|hostname|nonce|pid|schemaVersion|toolId" &&
        existing?.schemaVersion === "controlled-write-lock-v1" &&
        existing.toolId === toolId &&
        Number.isSafeInteger(existing.pid) &&
        existing.pid > 0 &&
        typeof existing.hostname === "string" &&
        existing.hostname.length > 0 &&
        typeof existing.createdAt === "string" &&
        Number.isFinite(Date.parse(existing.createdAt)) &&
        new Date(existing.createdAt).toISOString() === existing.createdAt &&
        /^[a-f0-9]{64}$/u.test(existing.nonce ?? "");
      if (!validExisting) {
        throw new Error(
          `${relativeLockPath} 不是已知写入锁；确认没有写入进程后需人工移除`,
        );
      }
      if (
        existing.hostname !== os.hostname() ||
        processAppearsAlive(existing.pid)
      ) {
        throw new Error(
          `${relativeLockPath} 已由 PID ${existing.pid} 持有，拒绝并发写入`,
        );
      }

      const currentBytes = await readControlledFileBytes(
        archiveRoot,
        relativeLockPath,
        /^sources\/\.[a-z0-9-]+\.lock$/u,
        "待恢复写入锁",
      );
      assert(
        crypto.timingSafeEqual(
          crypto.createHash("sha256").update(existingBytes).digest(),
          crypto.createHash("sha256").update(currentBytes).digest(),
        ),
        "写入锁在恢复检查期间已变化",
      );
      try {
        await fs.unlink(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error("无法取得归档写入锁");
}

export async function atomicWriteTextFile(
  rootDirectory,
  targetPath,
  content,
  label,
) {
  const archiveRoot = path.resolve(rootDirectory);
  const resolvedTarget = path.resolve(targetPath);
  const relativeTarget = path.relative(archiveRoot, resolvedTarget);
  assert(
    relativeTarget &&
      !relativeTarget.startsWith("..") &&
      !path.isAbsolute(relativeTarget),
    `${label} 目标越出归档边界`,
  );
  const parentPath = path.dirname(resolvedTarget);
  const [archiveStat, parentStat, realArchiveRoot, realParent] =
    await Promise.all([
      fs.lstat(archiveRoot),
      fs.lstat(parentPath),
      fs.realpath(archiveRoot),
      fs.realpath(parentPath),
    ]);
  assert(
    archiveStat.isDirectory() && !archiveStat.isSymbolicLink(),
    `${label} 的归档根目录必须是非链接真实目录`,
  );
  assert(
    parentStat.isDirectory() && !parentStat.isSymbolicLink(),
    `${label} 的父目录必须是非链接真实目录`,
  );
  const expectedRealParent = path.resolve(
    realArchiveRoot,
    path.dirname(relativeTarget),
  );
  assert(
    path.relative(expectedRealParent, realParent) === "",
    `${label} 的父目录解析到归档外`,
  );
  try {
    const [targetStat, realTarget] = await Promise.all([
      fs.lstat(resolvedTarget),
      fs.realpath(resolvedTarget),
    ]);
    assert(
      targetStat.isFile() &&
        !targetStat.isSymbolicLink() &&
        isWithin(realParent, realTarget),
      `${label} 现有目标必须是归档内非链接普通文件`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(
    realParent,
    `.${path.basename(resolvedTarget)}.${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporaryPath, resolvedTarget);
  } finally {
    try {
      await fs.unlink(temporaryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export async function inspectEditorialAsset(rootDirectory, relativePath) {
  assertString(relativePath, "preferredVisualDecision.assetPath");
  assert(
    /^assets\/(?:group-visuals|posters|profile-covers|weibo-avatars|weibo-api-avatar-candidates|weibo-cached-visuals)\/g\d{3}\.(?:jpe?g|png|webp)$/iu.test(
      relativePath,
    ),
    `${relativePath} 不在允许的编辑展示素材目录`,
  );
  const assetRoot = path.join(rootDirectory, "assets");
  const absolutePath = path.resolve(rootDirectory, relativePath);
  assert(isWithin(assetRoot, absolutePath), `${relativePath} 越出 assets 边界`);
  const [archiveStat, assetRootStat, stat] = await Promise.all([
    fs.lstat(rootDirectory),
    fs.lstat(assetRoot),
    fs.lstat(absolutePath),
  ]);
  assert(
    archiveStat.isDirectory() && !archiveStat.isSymbolicLink(),
    "归档根目录必须是非链接真实目录",
  );
  assert(
    assetRootStat.isDirectory() && !assetRootStat.isSymbolicLink(),
    "assets 根目录必须是非链接真实目录",
  );
  assert(
    stat.isFile() && !stat.isSymbolicLink(),
    `${relativePath} 必须是普通文件`,
  );
  const [realArchiveRoot, realAssetRoot, realPath] = await Promise.all([
    fs.realpath(rootDirectory),
    fs.realpath(assetRoot),
    fs.realpath(absolutePath),
  ]);
  assert(
    path.relative(path.join(realArchiveRoot, "assets"), realAssetRoot) === "",
    "assets 根目录解析到归档外",
  );
  assert(
    isWithin(realAssetRoot, realPath),
    `${relativePath} 解析到 assets 边界外`,
  );
  return await inspectImageBuffer(await fs.readFile(realPath));
}

function validateEvidenceItem(item, label) {
  assert(isPlainObject(item), `${label} 必须是对象`);
  assertString(item.sourceType, `${label}.sourceType`);
  assert(
    SOURCE_AUTHORITIES.has(item.sourceAuthority),
    `${label}.sourceAuthority 无效`,
  );
  assertControlledHttpsUrl(item.sourceUrl, `${label}.sourceUrl`);
  assertString(item.summary, `${label}.summary`);
  assert(
    ["direct", "corroborating", "weak", "conflicting"].includes(item.strength),
    `${label}.strength 无效`,
  );
}

function validateEditorialStyle(style, record) {
  const label = `${record.id}.editorialStyleDecision`;
  assert(isPlainObject(style), `${label} 必须是对象`);
  assert(style.state === "complete", `${label}.state 必须为 complete`);
  assert(
    style.taxonomyVersion === STYLE_TAXONOMY_VERSION,
    `${label}.taxonomyVersion 无效`,
  );
  assert(
    EPISTEMIC_STATES.has(style.epistemicStatus),
    `${label}.epistemicStatus 无效`,
  );
  assert(CONFIDENCE_LEVELS.has(style.confidence), `${label}.confidence 无效`);
  assertString(style.conclusion, `${label}.conclusion`);
  assertString(style.displayLabel, `${label}.displayLabel`);
  const weak = ["guess", "uncertain"].includes(style.epistemicStatus);
  assert(
    weak === style.displayLabel.endsWith(WEAK_EVIDENCE_SUFFIX),
    `${label}.displayLabel 的猜测后缀与 epistemicStatus 不一致`,
  );
  const band = STYLE_BAND_CONFIG[style.axisBand];
  assert(band, `${label}.axisBand 无效`);
  assert(
    style.layoutBand === band.displayBand,
    `${label}.layoutBand 与 axisBand 不一致`,
  );
  if (band.score === null) {
    assert(style.score === null, `${label}.score 在轴外或未判定时必须为 null`);
  } else {
    assert(
      Number.isFinite(style.score) && style.score >= -1 && style.score <= 1,
      `${label}.score 无效`,
    );
    const scoreMatchesBand = {
      strong_rock: style.score >= 0.75,
      rock_experimental: style.score >= 0.25 && style.score < 0.75,
      neutral_theme: style.score > -0.25 && style.score < 0.25,
      orthodox_dreamy: style.score > -0.75 && style.score <= -0.25,
      strong_orthodox: style.score <= -0.75,
    }[style.axisBand];
    assert(scoreMatchesBand, `${label}.score 与 axisBand 不一致`);
  }
  assert(
    Array.isArray(style.basisKinds) && style.basisKinds.length > 0,
    `${label}.basisKinds 不能为空`,
  );
  assert(
    Array.isArray(style.evidenceItems) && style.evidenceItems.length > 0,
    `${label}.evidenceItems 不能为空`,
  );
  style.evidenceItems.forEach((item, index) =>
    validateEvidenceItem(item, `${label}.evidenceItems[${index}]`),
  );
  assert(
    Array.isArray(style.uncertaintyCodes),
    `${label}.uncertaintyCodes 必须是数组`,
  );
  assert(typeof style.conflict === "boolean", `${label}.conflict 必须是布尔值`);
  assert(
    typeof style.manualReview === "boolean",
    `${label}.manualReview 必须是布尔值`,
  );
  assert(
    !style.conflict || style.manualReview,
    `${label} 冲突结论必须进入人工复核`,
  );
  if (style.epistemicStatus === "uncertain") {
    assert(
      style.uncertaintyCodes.length > 0,
      `${label} 不确定结论必须给出 uncertaintyCodes`,
    );
    assert(
      style.axisBand === "unresolved",
      `${label} 不确定骨架结论必须进入 unresolved`,
    );
  }
  if (style.epistemicStatus === "fact") {
    assert(style.confidence === "high", `${label} fact 必须是 high confidence`);
    assert(
      style.evidenceItems.some((item) =>
        ["official_group", "official_operator"].includes(item.sourceAuthority),
      ),
      `${label} fact 缺少官方证据`,
    );
  }
  if (style.epistemicStatus === "inference") {
    assert(
      style.confidence === "medium",
      `${label} inference 必须是 medium confidence`,
    );
  }
  if (weak)
    assert(style.confidence === "low", `${label} 弱结论必须是 low confidence`);
  assertString(style.rationale, `${label}.rationale`);
  assertString(style.evidenceSummary, `${label}.evidenceSummary`);
  assert(
    isPlainObject(style.legacyMusicAxisRef),
    `${label}.legacyMusicAxisRef 必须是对象`,
  );
}

function validateWikiDecision(wiki, record) {
  const label = `${record.id}.wikiDecision`;
  assert(isPlainObject(wiki), `${label} 必须是对象`);
  assert(WIKI_STATES.has(wiki.state), `${label}.state 无效`);
  const search = assertControlledHttpsUrl(wiki.searchUrl, `${label}.searchUrl`);
  assert(
    search.hostname === "chinaidols.fandom.com" &&
      search.pathname === "/zh/wiki/Special:Search",
    `${label}.searchUrl 必须是 China Idols Wiki 站内搜索页`,
  );
  if (["exact_page", "candidate"].includes(wiki.state)) {
    const page = assertControlledHttpsUrl(wiki.pageUrl, `${label}.pageUrl`);
    assert(
      page.hostname === "chinaidols.fandom.com" &&
        page.pathname.startsWith("/zh/wiki/") &&
        page.pathname !== "/zh/wiki/Special:Search",
      `${label}.pageUrl 不是 China Idols Wiki 精确或候选页`,
    );
    assert(Number.isInteger(wiki.pageId), `${label}.pageId 必须是整数`);
    assert(Number.isInteger(wiki.revisionId), `${label}.revisionId 必须是整数`);
    assertString(wiki.revisionTimestamp, `${label}.revisionTimestamp`);
  } else {
    assert(
      wiki.pageUrl === null,
      `${label}.pageUrl 在 ${wiki.state} 时必须为 null`,
    );
    for (const field of ["pageId", "revisionId", "revisionTimestamp"]) {
      assert(
        wiki[field] === null,
        `${label}.${field} 在 ${wiki.state} 时必须为 null`,
      );
    }
  }
  assertString(wiki.label, `${label}.label`);
  assertString(wiki.title, `${label}.title`);
  assert(
    wiki.sourceAuthority === "community_wiki",
    `${label}.sourceAuthority 必须如实标为 community_wiki`,
  );
  assert(
    wiki.styleCandidate === null || isPlainObject(wiki.styleCandidate),
    `${label}.styleCandidate 必须为对象或 null`,
  );
  if (wiki.styleCandidate) {
    assertString(wiki.styleCandidate.value, `${label}.styleCandidate.value`);
    const source = assertControlledHttpsUrl(
      wiki.styleCandidate.sourceUrl,
      `${label}.styleCandidate.sourceUrl`,
    );
    assert(
      source.hostname === "chinaidols.fandom.com",
      `${label}.styleCandidate.sourceUrl 不是 China Idols Wiki`,
    );
  }
  assert(
    wiki.originCandidate === null || isPlainObject(wiki.originCandidate),
    `${label}.originCandidate 必须为对象或 null`,
  );
  if (wiki.originCandidate) {
    assertString(wiki.originCandidate.value, `${label}.originCandidate.value`);
    const source = assertControlledHttpsUrl(
      wiki.originCandidate.sourceUrl,
      `${label}.originCandidate.sourceUrl`,
    );
    assert(
      source.hostname === "chinaidols.fandom.com",
      `${label}.originCandidate.sourceUrl 不是 China Idols Wiki`,
    );
  }
  assert(
    wiki.visualCandidate === null || isPlainObject(wiki.visualCandidate),
    `${label}.visualCandidate 必须为对象或 null`,
  );
  if (wiki.visualCandidate) {
    assertString(
      wiki.visualCandidate.fileTitle,
      `${label}.visualCandidate.fileTitle`,
    );
    assertControlledHttpsUrl(
      wiki.visualCandidate.sourceUrl,
      `${label}.visualCandidate.sourceUrl`,
    );
    for (const field of ["filePageUrl", "mediaUrl"]) {
      if (wiki.visualCandidate[field]) {
        assertControlledHttpsUrl(
          wiki.visualCandidate[field],
          `${label}.visualCandidate.${field}`,
        );
      }
    }
  }
  assert(
    wiki.identityCandidate === null || isPlainObject(wiki.identityCandidate),
    `${label}.identityCandidate 必须为对象或 null`,
  );
  if (wiki.identityCandidate) {
    canonicalPositiveUid(
      wiki.identityCandidate.weiboUid,
      `${label}.identityCandidate.weiboUid`,
    );
    assert(
      wiki.identityCandidate.usableForFollowerBindingWithoutWeiboCheck ===
        false,
      `${label}.identityCandidate 不得绕过微博粉丝绑定复核`,
    );
  }
  assertString(wiki.reason, `${label}.reason`);
}

function validateRegionDecision(
  region,
  group,
  wikiRecord,
  profileRecord,
  curatedRecord,
) {
  const expected = buildEditorialRegionDecision(
    group,
    wikiRecord,
    profileRecord,
    curatedRecord,
  );
  assert(
    JSON.stringify(region) === JSON.stringify(expected),
    `${group.id}.regionDecision 与受控地域词表判定不一致`,
  );
}

function validateProfileSupplement(profile, record) {
  const label = `${record.id}.profileSupplement`;
  assert(isPlainObject(profile), `${label} 必须是对象`);
  assert(PROFILE_SUPPLEMENT_STATES.has(profile.state), `${label}.state 无效`);
  if (profile.state === "not_applied") {
    for (const field of [
      "uid",
      "displayName",
      "profileBio",
      "profileUrl",
      "followersDisplay",
      "followersValue",
      "followersApproximate",
      "avatarAssetPath",
      "avatarSourceUrl",
      "avatarMediaUrl",
      "avatarQuality",
    ]) {
      assert(profile[field] === null, `${label}.${field} 必须为 null`);
    }
    assertString(profile.reason, `${label}.reason`);
    return;
  }
  canonicalPositiveUid(profile.uid, `${label}.uid`);
  assertString(profile.displayName, `${label}.displayName`);
  if (profile.profileBio !== null) {
    assertString(profile.profileBio, `${label}.profileBio`);
  }
  const page = assertControlledHttpsUrl(
    profile.profileUrl,
    `${label}.profileUrl`,
  );
  assert(page.hostname === "weibo.com", `${label}.profileUrl 必须是微博主页`);
  assertString(profile.followersDisplay, `${label}.followersDisplay`);
  assert(
    Number.isFinite(profile.followersValue) && profile.followersValue >= 0,
    `${label}.followersValue 无效`,
  );
  assert(
    typeof profile.followersApproximate === "boolean",
    `${label}.followersApproximate 必须是布尔值`,
  );
  assertString(profile.identityReason, `${label}.identityReason`);
}

async function validateProfileAvatar(profile, record, rootDirectory) {
  const label = `${record.id}.profileSupplement`;
  if (profile.state === "not_applied" || profile.avatarAssetPath === null) {
    for (const field of [
      "avatarAssetPath",
      "avatarSourceUrl",
      "avatarMediaUrl",
      "avatarQuality",
    ]) {
      assert(profile[field] === null, `${label}.${field} 必须为 null`);
    }
    return;
  }
  assert(
    new RegExp(
      `^assets/(?:weibo-avatars|weibo-api-avatar-candidates)/${record.id}\\.(?:jpe?g|png|webp)$`,
      "iu",
    ).test(profile.avatarAssetPath),
    `${label}.avatarAssetPath 必须绑定当前团体 ID`,
  );
  const sourcePage = assertControlledHttpsUrl(
    profile.avatarSourceUrl,
    `${label}.avatarSourceUrl`,
  );
  assert(
    sourcePage.hostname === "weibo.com",
    `${label}.avatarSourceUrl 必须是微博主页`,
  );
  assertControlledHttpsUrl(profile.avatarMediaUrl, `${label}.avatarMediaUrl`);
  assert(
    isPlainObject(profile.avatarQuality),
    `${label}.avatarQuality 必须是对象`,
  );
  const inspected = await inspectEditorialAsset(
    rootDirectory,
    profile.avatarAssetPath,
  );
  for (const field of ["format", "width", "height", "bytes", "sha256"]) {
    assert(
      profile.avatarQuality[field] === inspected[field],
      `${label}.avatarQuality.${field} 与本地素材不一致`,
    );
  }
}

function validateEdgeBrowserReviewProfile(
  profile,
  record,
  group,
  sourceBatch,
  candidateSources,
) {
  const review = candidateSources.edgeBrowserReview?.records?.find(
    (item) => item.id === record.id,
  );
  const sourcePath = sourceBatch.candidateSources.edgeBrowserReview.path;
  if (!review) {
    assert(
      profile.state !== "accepted_candidate" ||
        profile.sourceFile !== sourcePath,
      `${record.id}.profileSupplement 不得伪造 Edge 浏览器接受来源`,
    );
    return;
  }
  if (
    review.status !== "accepted" ||
    strictMasterRejectsCandidateUid(group, review.uid)
  ) {
    assert(
      profile.state === "not_applied",
      `${record.id}.profileSupplement 不得绕过 Edge 浏览器非接受决定或严格主档否决`,
    );
    return;
  }
  assert(
    profile.state === "accepted_candidate" &&
      profile.uid === review.uid &&
      profile.displayName === review.screenName &&
      profile.profileBio === (review.description || null) &&
      profile.profileUrl === review.profileUrl &&
      profile.followersDisplay === review.followersDisplay &&
      profile.followersValue === review.followersValue &&
      profile.followersApproximate === review.followersApproximate &&
      profile.observedAt === review.observedAt &&
      profile.identityReason === review.identityEvidenceSummary &&
      profile.sourceFile === sourcePath &&
      profile.avatarAssetPath === review.avatarSource?.localPath &&
      profile.avatarSourceUrl === review.profileUrl,
    `${record.id}.profileSupplement 未精确绑定 Edge 浏览器人工接受决定`,
  );
  if (review.avatarSource?.strategy === "api_reuse_same_uid") {
    const material = candidateSources.apiAvatar?.records?.find(
      (item) => item.id === record.id,
    );
    assert(
      String(material?.uid ?? "") === review.uid &&
        material?.localPath === review.avatarSource.localPath &&
        material?.originalUrl === profile.avatarMediaUrl,
      `${record.id}.profileSupplement 未按同 UID 复用当前 API 头像素材`,
    );
  } else {
    assert(
      review.avatarSource?.strategy === "browser_verified_asset" &&
        review.avatarSource.uid === review.uid &&
        review.avatarSource.sourceUrl === review.profileUrl &&
        review.avatarSource.originalUrl === profile.avatarMediaUrl,
      `${record.id}.profileSupplement 未绑定浏览器直取头像`,
    );
    for (const field of ["format", "width", "height", "bytes", "sha256"]) {
      assert(
        review.avatarSource.quality?.[field] === profile.avatarQuality?.[field],
        `${record.id}.profileSupplement 的浏览器头像 ${field} 未绑定人工素材清单`,
      );
    }
  }
}

async function validatePreferredVisual(
  visual,
  record,
  group,
  rootDirectory,
  sourceBatch,
  candidateSources,
) {
  const label = `${record.id}.preferredVisualDecision`;
  assert(isPlainObject(visual), `${label} 必须是对象`);
  assert(VISUAL_STATES.has(visual.state), `${label}.state 无效`);
  assert(
    visual.taxonomyVersion === VISUAL_TAXONOMY_VERSION,
    `${label}.taxonomyVersion 无效`,
  );
  assertString(visual.rationale, `${label}.rationale`);
  assert(
    visual.rosterVerification === "not_required_by_policy",
    `${label}.rosterVerification 无效`,
  );
  assert(
    visual.rightsStatus === "research_only_unknown",
    `${label}.rightsStatus 无效`,
  );
  if (visual.state === "not_found") {
    for (const field of [
      "kind",
      "sourceAuthority",
      "identityBinding",
      "groupScope",
      "assetPath",
      "sourceUrl",
      "priorityRank",
      "quality",
    ]) {
      assert(
        visual[field] === null,
        `${label}.${field} 在 not_found 时必须为 null`,
      );
    }
    assertString(visual.fallbackReason, `${label}.fallbackReason`);
    return;
  }
  assert(VISUAL_KINDS.has(visual.kind), `${label}.kind 无效`);
  assert(
    SOURCE_AUTHORITIES.has(visual.sourceAuthority),
    `${label}.sourceAuthority 无效`,
  );
  assert(
    IDENTITY_BINDINGS.has(visual.identityBinding),
    `${label}.identityBinding 无效`,
  );
  assert(GROUP_SCOPES.has(visual.groupScope), `${label}.groupScope 无效`);
  assert(
    visual.kind !== "full_roster_art_poster" ||
      visual.groupScope === "full_group_art",
    `${label}.groupScope 与完整团体海报不一致`,
  );
  assert(
    !["official_profile_cover", "official_group_artwork"].includes(
      visual.kind,
    ) ||
      ["official_group", "official_operator"].includes(visual.sourceAuthority),
    `${label}.sourceAuthority 与官方素材类别不一致`,
  );
  assert(
    !["wiki_group_artwork", "directory_group_artwork"].includes(visual.kind) ||
      ["wiki_secondary", "third_party_directory", "legacy_archive"].includes(
        visual.sourceAuthority,
      ),
    `${label}.sourceAuthority 与 Wiki/目录素材类别不一致`,
  );
  assert(
    new RegExp(
      `^assets/(?:group-visuals|posters|profile-covers|weibo-cached-visuals)/${record.id}\\.(?:jpe?g|png|webp)$`,
      "iu",
    ).test(visual.assetPath),
    `${label}.assetPath 必须绑定当前团体 ID`,
  );
  const expectedPriority =
    visual.kind === "full_roster_art_poster"
      ? visual.sourceAuthority === "wiki_secondary"
        ? 2
        : 1
      : visual.kind === "official_group_artwork"
        ? 3
        : visual.kind === "official_profile_cover"
          ? 4
          : 5;
  assert(
    visual.priorityRank === expectedPriority,
    `${label}.priorityRank 与素材类别或来源优先级不一致`,
  );
  assertControlledHttpsUrl(visual.sourceUrl, `${label}.sourceUrl`);
  assert(isPlainObject(visual.quality), `${label}.quality 必须是对象`);
  const inspected = await inspectEditorialAsset(
    rootDirectory,
    visual.assetPath,
  );
  for (const field of ["format", "width", "height", "bytes", "sha256"]) {
    assert(
      visual.quality[field] === inspected[field],
      `${label}.quality.${field} 与本地素材不一致`,
    );
  }
  const edgeBrowserReview =
    candidateSources.edgeBrowserReview?.records?.find(
      (item) => item.id === record.id,
    );
  const usesEdgeBrowserReview =
    visual.manualReviewSource ===
    sourceBatch.candidateSources.edgeBrowserReview?.path;
  if (usesEdgeBrowserReview) {
    const sourceVisual = edgeBrowserReview?.visual;
    const expectedManualDecision = {
      full_roster_art_poster: "edge_browser_confirmed_full_roster_art",
      official_group_artwork: "edge_browser_confirmed_group_artwork",
      official_profile_cover: "edge_browser_confirmed_profile_cover",
    }[sourceVisual?.kind];
    const standardGate = sourceBatch.policies.visual;
    const fallbackGate =
      candidateSources.edgeBrowserReview?.policy
        ?.browserVisualManualLowResolutionGate;
    const passes = (gate) =>
      isPlainObject(gate) &&
      inspected.bytes >= gate.minimumBytes &&
      Math.min(inspected.width, inspected.height) >= gate.minimumShortEdge &&
      inspected.width * inspected.height >= gate.minimumPixels;
    assert(
      edgeBrowserReview?.status === "accepted" &&
        expectedManualDecision &&
        sourceVisual.kind === visual.kind &&
        sourceVisual.groupScope === visual.groupScope &&
        sourceVisual.assetPath === visual.assetPath &&
        sourceVisual.sourceUrl === visual.sourceUrl &&
        sourceVisual.gate === visual.quality.gate &&
        visual.sourceUid === edgeBrowserReview.uid &&
        visual.manualReviewDecision === expectedManualDecision &&
        visual.manualReviewedAt === edgeBrowserReview.observedAt,
      `${label} 未绑定 Edge 浏览器人工团体图决定`,
    );
    for (const field of ["format", "width", "height", "bytes", "sha256"]) {
      assert(
        sourceVisual.quality?.[field] === inspected[field],
        `${label} 的 Edge 浏览器素材 ${field} 不一致`,
      );
    }
    assert(
      (sourceVisual.gate === "standard" && passes(standardGate)) ||
        (sourceVisual.gate === "manual_low_resolution_fallback" &&
          sourceVisual.kind === "full_roster_art_poster" &&
          !passes(standardGate) &&
          passes(fallbackGate)),
      `${label} 的 Edge 浏览器素材质量门无效`,
    );
    assert(
      sourceVisual.gate !== "manual_low_resolution_fallback" ||
        visual.rationale.includes("低清兜底门"),
      `${label} 未透明说明浏览器低清兜底门`,
    );
    assert(
      sourceVisual.kind !== "official_profile_cover" ||
        /品牌|不把.*成员合照/u.test(visual.rationale),
      `${label} 未透明说明官号品牌背景不是成员合照`,
    );
  } else {
    assert(visual.quality.gate === "pass", `${label}.quality.gate 无效`);
  }
  const usesCachedReview = visual.assetPath.startsWith(
    "assets/weibo-cached-visuals/",
  );
  if (usesCachedReview) {
    const expectedKind = {
      confirmed_full_roster_art: "full_roster_art_poster",
      suitable_group_artwork: "official_group_artwork",
      suitable_profile_cover: "official_profile_cover",
    }[visual.manualReviewDecision];
    assert(
      expectedKind === visual.kind,
      `${label}.manualReviewDecision 与素材类别不一致`,
    );
    assert(
      visual.manualReviewSource ===
        sourceBatch.candidateSources.weiboCachedVisualReview.path,
      `${label}.manualReviewSource 无效`,
    );
    assertString(visual.manualReviewedAt, `${label}.manualReviewedAt`);
    canonicalPositiveUid(visual.sourceUid, `${label}.sourceUid`);
    const material = candidateSources.cachedVisual?.records?.find(
      (item) => item.id === record.id,
    );
    const reviewIds =
      candidateSources.cachedVisualReview?.decisions?.[
        visual.manualReviewDecision
      ] ?? [];
    const acceptance = candidateSources.identityAcceptance?.records?.find(
      (item) => item.id === record.id,
    );
    const supplemental =
      candidateSources.identitySupplementalReview?.records?.find(
        (item) => item.id === record.id,
      );
    const strictUid =
      typeof group.weiboUid === "string" ? group.weiboUid : "";
    const browserUid =
      typeof edgeBrowserReview?.uid === "string" ? edgeBrowserReview.uid : "";
    const historicalUid = String(acceptance?.uid ?? "").trim();
    const expectedUid =
      CANONICAL_POSITIVE_UID_PATTERN.test(strictUid) &&
      !strictMasterRejectsCandidateUid(group, strictUid)
        ? strictUid
        : edgeBrowserReview?.status === "accepted" &&
            CANONICAL_POSITIVE_UID_PATTERN.test(browserUid) &&
            !strictMasterRejectsCandidateUid(group, browserUid)
          ? browserUid
          : (acceptance?.status ===
                sourceBatch.candidateSources.weiboIdentityAcceptance
                  .acceptedStatus ||
              supplemental?.decisionStatus ===
                sourceBatch.candidateSources.weiboIdentityAcceptance
                  .acceptedStatus) &&
              !strictMasterRejectsCandidateUid(group, historicalUid)
            ? historicalUid
            : null;
    assert(
      reviewIds.includes(record.id) &&
        ["downloaded_verified", "reused_verified"].includes(material?.state) &&
        material?.assetPath === visual.assetPath &&
        String(material?.selectedCandidate?.sourceUid ?? "") === expectedUid &&
        visual.sourceUid === expectedUid,
      `${label} 未绑定人工复核、素材清单与已接受官号身份`,
    );
  }
  assertString(visual.fallbackReason, `${label}.fallbackReason`);
}

export async function validateEditorialOverlay(
  overlay,
  archive,
  sourceBatch,
  rootDirectory,
  candidateSources = {},
) {
  assert(isPlainObject(overlay), "编辑展示覆盖数据必须是对象");
  assert(
    overlay.schemaVersion === EDITORIAL_SCHEMA_VERSION,
    "编辑展示覆盖 schemaVersion 无效",
  );
  assert(
    overlay.contractKind === EDITORIAL_CONTRACT_KIND,
    "编辑展示覆盖 contractKind 无效",
  );
  assert(Array.isArray(overlay.records), "编辑展示覆盖 records 必须是数组");
  assert(
    overlay.records.length === archive.groups.length,
    "编辑展示覆盖必须与主档团体数量一致",
  );
  assertUniqueFinalAcceptedProfileUids(archive.groups, overlay.records);
  assert(
    overlay.groupIdsSha256 === groupIdsSha256(archive.groups),
    "编辑展示覆盖的 ID 集合摘要与主档不一致",
  );
  assert(
    overlay.sourceDataSha256 === sha256Json(archive),
    "严格主档内容摘要变化；拒绝应用陈旧编辑展示覆盖",
  );
  assert(
    overlay.strictMusicAxisSha256 === strictMusicAxisSha256(archive.groups),
    "严格 music-axis-v2 摘要变化；拒绝应用编辑展示覆盖",
  );
  assert(
    overlay.sourceBatchSha256 === sha256Json(sourceBatch),
    "编辑展示覆盖的来源批次摘要不一致",
  );
  assert(
    overlay.wikiSourceSha256 === sha256Json(candidateSources.wiki),
    "编辑展示覆盖的 China Idols Wiki 候选摘要不一致",
  );
  assert(
    overlay.wikiVisualSourceSha256 === sha256Json(candidateSources.wikiVisual),
    "编辑展示覆盖的 China Idols Wiki 团体图素材摘要不一致",
  );
  assert(
    overlay.avatarSourceSha256 === sha256Json(candidateSources.avatar),
    "编辑展示覆盖的微博官号头像素材摘要不一致",
  );
  assert(
    overlay.edgeSourceSha256 ===
      (candidateSources.edge ? sha256Json(candidateSources.edge) : null),
    "编辑展示覆盖的 Edge 候选摘要不一致",
  );
  assert(
    candidateSources.edgeBrowserReview?.schemaVersion ===
      sourceBatch.candidateSources.edgeBrowserReview?.schemaVersion &&
      overlay.edgeBrowserReviewSourceSha256 ===
        sha256Json(candidateSources.edgeBrowserReview),
    "编辑展示覆盖的 Edge 微博人工复核补充摘要或版本不一致",
  );
  const edgeBrowserSource = candidateSources.edgeBrowserReview;
  assert(
    edgeBrowserSource?.policy?.statement ===
      "editorial display only / never mutate strict master" &&
      edgeBrowserSource.policy.canonicalImpact === "none" &&
      edgeBrowserSource.policy.automaticAcceptance === false &&
      edgeBrowserSource.policy.apiAvatarReuseRequiresSameUid === true &&
      edgeBrowserSource.policy.renamedSuccessorRequiresOfficialCrossEvidence ===
        true &&
      edgeBrowserSource.policy.closedAccountNeverBindsFollowersOrAvatar ===
        true &&
      edgeBrowserSource.policy.strictMasterSameUidRejectionWins === true,
    "Edge 微博人工复核补充越过展示层身份边界",
  );
  for (const [sourceKey, expectedPath] of [
    ["strictMaster", sourceBatch.sourceData],
    [
      "baseIdentityAcceptance",
      sourceBatch.candidateSources.weiboIdentityAcceptance.path,
    ],
    ["weiboApiCandidates", sourceBatch.candidateSources.weiboApiProfile.path],
    [
      "weiboApiAvatarMaterials",
      sourceBatch.candidateSources.weiboApiAvatar.path,
    ],
    ["chinaIdolsWikiCandidates", sourceBatch.candidateSources.wiki.path],
  ]) {
    assert(
      edgeBrowserSource.sourceFiles?.[sourceKey]?.path === expectedPath &&
        /^[a-f0-9]{64}$/u.test(
          edgeBrowserSource.sourceFiles?.[sourceKey]?.sha256 ?? "",
        ),
      `Edge 微博人工复核补充的 ${sourceKey} 来源声明未闭合`,
    );
  }
  const edgeBrowserCounts = {
    accepted: 0,
    no_current_profile: 0,
    strict_rejected: 0,
  };
  const edgeBrowserIds = new Set();
  for (const review of edgeBrowserSource.records ?? []) {
    const group = archive.groups.find((item) => item.id === review?.id);
    assert(
      group &&
        !edgeBrowserIds.has(review.id) &&
        review.name === group.name &&
        review.handleKey === group.handleKey &&
        Object.hasOwn(edgeBrowserCounts, review.status),
      "Edge 微博人工复核补充含未知、重复或未绑定主档的记录",
    );
    edgeBrowserIds.add(review.id);
    edgeBrowserCounts[review.status] += 1;
    if (review.status === "strict_rejected") {
      assert(
        strictMasterRejectsCandidateUid(group, review.candidateUid),
        `${review.id} 的 Edge 严格拒绝未绑定同 UID 主档否决`,
      );
    }
  }
  for (const [status, count] of Object.entries(edgeBrowserCounts)) {
    assert(
      edgeBrowserSource.statusCounts?.[status] === count,
      `Edge 微博人工复核补充 statusCounts.${status} 不一致`,
    );
  }
  assert(
    edgeBrowserSource.statusCounts?.total === edgeBrowserIds.size,
    "Edge 微博人工复核补充总数不闭合",
  );
  for (const [overlayField, sourceField, label] of [
    ["identityAcceptanceSourceSha256", "identityAcceptance", "微博身份接受批次"],
    [
      "identitySupplementalReviewSourceSha256",
      "identitySupplementalReview",
      "微博身份补充复核批次",
    ],
    ["apiProfileSourceSha256", "apiProfile", "微博正式 profile 候选"],
    ["apiAvatarSourceSha256", "apiAvatar", "微博正式 API 头像素材"],
    ["cachedVisualSourceSha256", "cachedVisual", "微博缓存视觉素材"],
    [
      "cachedVisualCandidateSourceSha256",
      "cachedVisualCandidate",
      "微博缓存视觉候选",
    ],
    [
      "cachedVisualReviewSourceSha256",
      "cachedVisualReview",
      "微博缓存视觉人工复核",
    ],
    [
      "officialEvidenceSupplementSourceSha256",
      "officialEvidenceSupplement",
      "官号地域风格补充证据",
    ],
    [
      "wikiAdjudicationSupplementSourceSha256",
      "wikiAdjudicationSupplement",
      "Wiki 编辑裁决补充",
    ],
  ]) {
    assert(
      overlay[overlayField] === sha256Json(candidateSources[sourceField]),
      `编辑展示覆盖的${label}摘要不一致`,
    );
  }
  const expected = new Map(archive.groups.map((group) => [group.id, group]));
  const wikiById = new Map(
    (candidateSources.wiki?.records ?? []).map((record) => [record.id, record]),
  );
  const profileById = new Map(
    (candidateSources.edge?.records ?? []).map((record) => [record.id, record]),
  );
  const identityAcceptanceById = new Map(
    (candidateSources.identityAcceptance?.records ?? []).map((record) => [
      record.id,
      record,
    ]),
  );
  const identitySupplementalReviewById = new Map(
    (candidateSources.identitySupplementalReview?.records ?? []).map((record) => [
      record.id,
      record,
    ]),
  );
  const edgeBrowserReviewById = new Map(
    (candidateSources.edgeBrowserReview?.records ?? []).map((record) => [
      record.id,
      record,
    ]),
  );
  const effectiveIdentityAcceptanceById = new Map(identityAcceptanceById);
  for (const [id, supplemental] of identitySupplementalReviewById) {
    effectiveIdentityAcceptanceById.set(id, {
      ...identityAcceptanceById.get(id),
      status: supplemental.decisionStatus,
      reviewBasis: supplemental.reviewBasis,
      identityEvidenceSummary: supplemental.identityEvidenceSummary,
      supplementalReviewSource:
        sourceBatch.candidateSources.weiboIdentitySupplementalReview.path,
    });
  }
  for (const group of archive.groups) {
    assertSameUidAcceptedProfileTakeover(
      profileById.get(group.id),
      effectiveIdentityAcceptanceById.get(group.id),
      {
        acceptedDecision:
          sourceBatch.candidateSources.edgeProfile.acceptedDecision,
        acceptedStatus:
          sourceBatch.candidateSources.weiboIdentityAcceptance.acceptedStatus,
      },
    );
  }
  const officialEvidenceById = new Map(
    (candidateSources.officialEvidenceSupplement?.records ?? []).map(
      (record) => [
        record.id,
        {
          decision: sourceBatch.candidateSources.edgeProfile.acceptedDecision,
          cityClue: record.activity?.cityClue ?? null,
          cityClueRole: record.activity?.cityClueRole ?? null,
          expectedProvince: record.activity?.expectedProvince ?? null,
          expectedCity: record.activity?.expectedCity ?? null,
          finalUrl: record.activity?.sourceUrl ?? null,
          styleClue: record.style?.styleClue ?? null,
          styleClueAuthority: record.style?.styleClueAuthority ?? null,
          styleSourceUrl: record.style?.sourceUrl ?? null,
          evidenceSource:
            sourceBatch.candidateSources.officialEvidenceSupplement.path,
        },
      ],
    ),
  );
  const wikiAdjudicationById = new Map(
    (candidateSources.wikiAdjudicationSupplement?.records ?? []).map((record) => [
      record.id,
      {
        decision:
          sourceBatch.candidateSources.edgeProfile.editorialEvidenceDecision,
        cityClue: record.founding?.expectedCity ?? null,
        cityClueRole: record.founding?.cityClueRole ?? null,
        expectedProvince: record.founding?.expectedProvince ?? null,
        expectedCity: record.founding?.expectedCity ?? null,
        finalUrl: record.wikiPageUrl,
        styleClue: record.style?.sourceValue ?? null,
        styleClueAuthority: record.style
          ? "community_wiki_manual_adjudication"
          : null,
        styleSourceUrl: record.style ? record.wikiPageUrl : null,
        expectedAxisBand: record.style?.expectedAxisBand ?? null,
        styleSummary: record.style?.summary ?? null,
        evidenceSource:
          sourceBatch.candidateSources.wikiAdjudicationSupplement.path,
      },
    ]),
  );
  const edgeBrowserEvidenceById = new Map(
    (candidateSources.edgeBrowserReview?.records ?? [])
      .map((record) => [
        record.id,
        edgeBrowserReviewEditorialEvidence(
          record,
          sourceBatch.candidateSources.edgeBrowserReview.path,
        ),
      ])
      .filter(([, evidence]) => evidence !== null),
  );
  const curatedEvidenceById = new Map();
  for (const id of new Set([
    ...officialEvidenceById.keys(),
    ...wikiAdjudicationById.keys(),
    ...edgeBrowserEvidenceById.keys(),
  ])) {
    curatedEvidenceById.set(id, {
      ...(wikiAdjudicationById.get(id) ?? {}),
      ...(officialEvidenceById.get(id) ?? {}),
      ...(edgeBrowserEvidenceById.get(id) ?? {}),
    });
  }
  const seen = new Set();
  for (const record of overlay.records) {
    assert(/^g\d{3}$/u.test(record.id ?? ""), "编辑展示覆盖包含无效 ID");
    assert(!seen.has(record.id), `${record.id} 在编辑展示覆盖中重复`);
    seen.add(record.id);
    const group = expected.get(record.id);
    assert(group, `${record.id} 不存在于严格主档`);
    assert(
      record.handleKey === group.handleKey,
      `${record.id}.handleKey 与严格主档不一致`,
    );
    validateEditorialStyle(record.editorialStyleDecision, record);
    validateWikiDecision(record.wikiDecision, record);
    validateProfileSupplement(record.profileSupplement, record);
    assert(
      record.profileSupplement.state !== "accepted_candidate" ||
        !strictMasterRejectsCandidateUid(
          group,
          record.profileSupplement.uid,
        ),
      `${record.id}.profileSupplement 被严格主档的同 UID 显式拒绝否决`,
    );
    await validateProfileAvatar(
      record.profileSupplement,
      record,
      rootDirectory,
    );
    validateEdgeBrowserReviewProfile(
      record.profileSupplement,
      record,
      group,
      sourceBatch,
      candidateSources,
    );
    if (
      record.profileSupplement.state === "accepted_candidate" &&
      edgeBrowserReviewById.get(record.id)?.status !== "accepted"
    ) {
      assertAcceptedProfileMatchesIdentityAcceptance(
        record.profileSupplement,
        effectiveIdentityAcceptanceById.get(record.id),
        record,
        {
          acceptedStatus:
            sourceBatch.candidateSources.weiboIdentityAcceptance.acceptedStatus,
          acceptanceSourcePath:
            sourceBatch.candidateSources.weiboIdentityAcceptance.path,
        },
      );
    }
    validateRegionDecision(
      record.regionDecision,
      group,
      wikiById.get(record.id),
      profileById.get(record.id),
      curatedEvidenceById.get(record.id),
    );
    const officialEvidence =
      candidateSources.officialEvidenceSupplement?.records?.find(
        (item) => item.id === record.id,
      );
    if (officialEvidence?.style) {
      assert(
        record.editorialStyleDecision.epistemicStatus === "fact" &&
          record.editorialStyleDecision.confidence === "high" &&
          record.editorialStyleDecision.axisBand ===
            officialEvidence.style.expectedAxisBand &&
          record.editorialStyleDecision.evidenceItems.some(
            (item) =>
              item.sourceAuthority === "official_group" &&
              item.sourceUrl === officialEvidence.style.sourceUrl,
          ),
        `${record.id}.editorialStyleDecision 未绑定官号直接风格证据`,
      );
    }
    const wikiAdjudication =
      candidateSources.wikiAdjudicationSupplement?.records?.find(
        (item) => item.id === record.id,
      );
    if (wikiAdjudication?.style) {
      assert(
        record.editorialStyleDecision.epistemicStatus === "inference" &&
          record.editorialStyleDecision.confidence === "medium" &&
          record.editorialStyleDecision.axisBand ===
            wikiAdjudication.style.expectedAxisBand &&
          record.editorialStyleDecision.evidenceItems.some(
            (item) =>
              item.sourceAuthority === "wiki_secondary" &&
              item.sourceUrl === wikiAdjudication.wikiPageUrl &&
              item.sourceType === "china_idols_wiki_manual_adjudication",
          ),
        `${record.id}.editorialStyleDecision 未绑定 Wiki 人工裁决`,
      );
    }
    const edgeBrowserReview =
      candidateSources.edgeBrowserReview?.records?.find(
        (item) => item.id === record.id,
      );
    if (edgeBrowserReview?.style) {
      const browserStyle = edgeBrowserReview.style;
      assert(
        record.editorialStyleDecision.conclusion === browserStyle.conclusion &&
          record.editorialStyleDecision.epistemicStatus ===
            browserStyle.epistemicStatus &&
          record.editorialStyleDecision.confidence === browserStyle.confidence &&
          record.editorialStyleDecision.axisBand === browserStyle.axisBand &&
          record.editorialStyleDecision.layoutBand ===
            STYLE_BAND_CONFIG[browserStyle.axisBand].displayBand &&
          record.editorialStyleDecision.score ===
            STYLE_BAND_CONFIG[browserStyle.axisBand].score &&
          record.editorialStyleDecision.rationale === browserStyle.rationale &&
          browserStyle.uncertaintyCodes.every((code) =>
            record.editorialStyleDecision.uncertaintyCodes.includes(code),
          ) &&
          record.editorialStyleDecision.evidenceItems.some(
            (item) =>
              item.sourceAuthority === "official_group" &&
              item.sourceUrl === browserStyle.sourceUrl,
          ),
        `${record.id}.editorialStyleDecision 未绑定 Edge 浏览器人工风格决定`,
      );
    }
    await validatePreferredVisual(
      record.preferredVisualDecision,
      record,
      group,
      rootDirectory,
      sourceBatch,
      candidateSources,
    );
  }
  const coverage = summarizeEditorialCoverage(overlay.records);
  assert(
    JSON.stringify(coverage) === JSON.stringify(overlay.coverage),
    "编辑展示覆盖计数与逐团记录不一致",
  );
  return coverage;
}

export function summarizeEditorialCoverage(records) {
  const style = { fact: 0, inference: 0, guess: 0, uncertain: 0 };
  const visual = { selected: 0, not_found: 0 };
  const wiki = {
    exact_page: 0,
    candidate: 0,
    searched_not_found: 0,
    unreviewed: 0,
  };
  const profileSupplement = { accepted_candidate: 0, not_applied: 0 };
  const region = {
    direct_municipality: 0,
    evidence_text: 0,
    city_unresolved: 0,
    unknown: 0,
  };
  for (const record of records) {
    style[record.editorialStyleDecision.epistemicStatus] += 1;
    visual[record.preferredVisualDecision.state] += 1;
    wiki[record.wikiDecision.state] += 1;
    profileSupplement[record.profileSupplement.state] += 1;
    region[record.regionDecision.resolutionState] += 1;
  }
  return {
    total: records.length,
    style,
    visual,
    wiki,
    profileSupplement,
    region,
  };
}

export async function loadEditorialOverlay(rootDirectory) {
  const archivePath = path.join(rootDirectory, "data", "群体分布数据.json");
  const sourceBatchPath = path.join(
    rootDirectory,
    "sources",
    "编辑展示复核批次.json",
  );
  const overlayPath = path.join(rootDirectory, "data", "编辑展示覆盖数据.json");
  const [archiveBytes, sourceBatchBytes, overlayBytes] = await Promise.all([
    readControlledFileBytes(
      rootDirectory,
      "data/群体分布数据.json",
      /^data\/群体分布数据\.json$/u,
      "严格主档",
    ),
    readControlledFileBytes(
      rootDirectory,
      "sources/编辑展示复核批次.json",
      /^sources\/编辑展示复核批次\.json$/u,
      "编辑展示复核批次",
    ),
    readControlledFileBytes(
      rootDirectory,
      "data/编辑展示覆盖数据.json",
      /^data\/编辑展示覆盖数据\.json$/u,
      "编辑展示覆盖数据",
    ),
  ]);
  const archive = JSON.parse(archiveBytes.toString("utf8"));
  const sourceBatch = JSON.parse(sourceBatchBytes.toString("utf8"));
  const overlay = JSON.parse(overlayBytes.toString("utf8"));
  const wikiPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.wiki,
    "China Idols Wiki",
  );
  const wikiVisualPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.wikiVisual,
    "China Idols Wiki 团体图",
  );
  const avatarPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboAvatar,
    "微博官号头像素材",
  );
  const identityAcceptancePath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboIdentityAcceptance,
    "微博编辑身份接受批次",
  );
  const identitySupplementalReviewPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboIdentitySupplementalReview,
    "微博编辑身份补充复核批次",
  );
  const apiProfilePath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboApiProfile,
    "微博正式 profile 候选",
  );
  const apiAvatarPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboApiAvatar,
    "微博正式 API 头像素材",
  );
  const cachedVisualPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboCachedVisual,
    "微博缓存视觉素材",
  );
  const cachedVisualCandidatePath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboCachedVisualCandidates,
    "微博缓存视觉候选",
  );
  const cachedVisualReviewPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.weiboCachedVisualReview,
    "微博缓存视觉人工复核",
  );
  const officialEvidenceSupplementPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.officialEvidenceSupplement,
    "官号地域风格补充证据",
  );
  const wikiAdjudicationSupplementPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.wikiAdjudicationSupplement,
    "Wiki 编辑裁决补充",
  );
  const edgeBrowserReviewPath = await resolveControlledSourceJson(
    rootDirectory,
    sourceBatch.candidateSources?.edgeBrowserReview,
    "Edge 微博人工复核补充",
  );
  const edgeEntry = sourceBatch.candidateSources?.edgeProfile;
  let edgePath = null;
  try {
    edgePath = await resolveControlledSourceJson(
      rootDirectory,
      edgeEntry,
      "Edge profile",
    );
  } catch (error) {
    if (error?.code !== "ENOENT" || edgeEntry?.required) throw error;
  }
  const [
    wiki,
    wikiVisual,
    avatar,
    identityAcceptance,
    identitySupplementalReview,
    apiProfile,
    apiAvatar,
    cachedVisual,
    cachedVisualCandidate,
    cachedVisualReview,
    officialEvidenceSupplement,
    wikiAdjudicationSupplement,
    edgeBrowserReview,
  ] = await Promise.all(
    [
      wikiPath,
      wikiVisualPath,
      avatarPath,
      identityAcceptancePath,
      identitySupplementalReviewPath,
      apiProfilePath,
      apiAvatarPath,
      cachedVisualPath,
      cachedVisualCandidatePath,
      cachedVisualReviewPath,
      officialEvidenceSupplementPath,
      wikiAdjudicationSupplementPath,
      edgeBrowserReviewPath,
    ].map(async (filePath) =>
      JSON.parse(await fs.readFile(filePath, "utf8")),
    ),
  );
  let edge = null;
  if (edgePath) edge = JSON.parse(await fs.readFile(edgePath, "utf8"));
  const coverage = await validateEditorialOverlay(
    overlay,
    archive,
    sourceBatch,
    rootDirectory,
    {
      wiki,
      wikiVisual,
      avatar,
      edge,
      identityAcceptance,
      identitySupplementalReview,
      apiProfile,
      apiAvatar,
      cachedVisual,
      cachedVisualCandidate,
      cachedVisualReview,
      officialEvidenceSupplement,
      wikiAdjudicationSupplement,
      edgeBrowserReview,
    },
  );
  return {
    archive,
    sourceBatch,
    candidateSources: {
      wiki,
      wikiVisual,
      avatar,
      edge,
      identityAcceptance,
      identitySupplementalReview,
      apiProfile,
      apiAvatar,
      cachedVisual,
      cachedVisualCandidate,
      cachedVisualReview,
      officialEvidenceSupplement,
      wikiAdjudicationSupplement,
      edgeBrowserReview,
    },
    overlay,
    coverage,
    recordsById: new Map(overlay.records.map((record) => [record.id, record])),
  };
}

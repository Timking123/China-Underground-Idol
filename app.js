(() => {
  "use strict";

  const data = window.IDOL_MAP_DATA;
  if (!data || !Array.isArray(data.groups)) {
    document.body.textContent =
      "分布图数据未能载入，请确认 data.js 与 index.html 位于同一目录。";
    return;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const UNRESOLVED_CITY_KEY = "__city_unresolved__";
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const groupsById = new Map(data.groups.map((group) => [group.id, group]));
  const activeGroupCount = data.groups.filter((group) => group.isActive).length;
  const nodeElements = new Map();
  const tetherElements = new Map();

  const elements = {
    svg: document.querySelector("#idol-map"),
    chartCanvas: document.querySelector(".chart-canvas"),
    chartGrid: document.querySelector(".chart-grid"),
    bandLayer: document.querySelector("#band-layer"),
    axisLayer: document.querySelector("#axis-layer"),
    tetherLayer: document.querySelector("#tether-layer"),
    nodeLayer: document.querySelector("#node-layer"),
    selectionRing: document.querySelector("#selection-ring"),
    chartLive: document.querySelector("#chart-live"),
    coverageLine: document.querySelector("#coverage-line"),
    scopeActiveCount: document.querySelector("#scope-active-count"),
    scopeTotalCount: document.querySelector("#scope-total-count"),
    methodActiveCount: document.querySelector("#method-active-count"),
    methodTotalCount: document.querySelector("#method-total-count"),
    searchInput: document.querySelector("#idol-search"),
    searchResults: document.querySelector("#search-results"),
    clearSearch: document.querySelector("#clear-search"),
    regionFilter: document.querySelector(".region-filter"),
    regionFilterToggle: document.querySelector("#region-filter-toggle"),
    regionFilterSummary: document.querySelector("#region-filter-summary"),
    regionFilterPopover: document.querySelector("#region-filter-popover"),
    regionScopeInputs: [
      ...document.querySelectorAll('input[name="region-scope"]'),
    ],
    regionFilterTree: document.querySelector("#region-filter-tree"),
    regionMatchCount: document.querySelector("#region-match-count"),
    regionChipsBar: document.querySelector("#region-chips-bar"),
    regionChips: document.querySelector("#region-chips"),
    clearRegionFilter: document.querySelector("#clear-region-filter"),
    clearRegionPopover: document.querySelector("#clear-region-popover"),
    evidenceFilterButtons: [
      ...document.querySelectorAll("[data-evidence-filter]"),
    ],
    clearEvidenceFilter: document.querySelector("#clear-evidence-filter"),
    apiCoverageLine: document.querySelector("#api-coverage-line"),
    scopeButtons: [...document.querySelectorAll("[data-scope]")],
    zoomIn: document.querySelector("#zoom-in"),
    zoomOut: document.querySelector("#zoom-out"),
    zoomFit: document.querySelector("#zoom-fit"),
    detailPanel: document.querySelector("#detail-panel"),
    detailIndex: document.querySelector("#detail-index"),
    detailStatus: document.querySelector("#detail-status"),
    posterStage: document.querySelector(".poster-stage"),
    detailPoster: document.querySelector("#detail-poster"),
    posterFallback: document.querySelector("#poster-fallback"),
    posterInitials: document.querySelector("#poster-initials"),
    posterLabel: document.querySelector("#poster-label"),
    detailName: document.querySelector("#detail-name"),
    detailHandle: document.querySelector("#detail-handle"),
    detailFollowers: document.querySelector("#detail-followers"),
    detailFoundingRegion: document.querySelector("#detail-region"),
    detailActivityRegion: document.querySelector("#detail-activity-region"),
    detailStyle: document.querySelector("#detail-style"),
    detailBand: document.querySelector("#detail-band"),
    detailEditorialStyle: document.querySelector("#detail-editorial-style"),
    detailEditorialStatus: document.querySelector("#detail-editorial-status"),
    detailProfileSupplementRow: document.querySelector(
      "#detail-profile-supplement-row",
    ),
    detailProfileSupplement: document.querySelector(
      "#detail-profile-supplement",
    ),
    detailDate: document.querySelector("#detail-date"),
    detailTags: document.querySelector("#detail-tags"),
    detailNote: document.querySelector("#detail-note"),
    reviewUpdate: document.querySelector("#review-update"),
    reviewUpdateHeading: document.querySelector("#review-update-heading"),
    reviewUpdateSummary: document.querySelector("#review-update-summary"),
    reviewUpdateLinks: document.querySelector("#review-update-links"),
    profileLink: document.querySelector("#profile-link"),
    evidenceLink: document.querySelector("#evidence-link"),
    styleSourceLink: document.querySelector("#style-source-link"),
    editorialSourceLink: document.querySelector("#editorial-source-link"),
    wikiLink: document.querySelector("#wiki-link"),
    profileSupplementLink: document.querySelector("#profile-supplement-link"),
    avatarSourceLink: document.querySelector("#avatar-source-link"),
    posterSourceLink: document.querySelector("#poster-source-link"),
    profileObserved: document.querySelector("#profile-observed"),
    candidateEvidence: document.querySelector("#candidate-evidence"),
    candidateEvidenceState: document.querySelector("#candidate-evidence-state"),
    candidateProfileState: document.querySelector("#candidate-profile-state"),
    candidateProfileAvatar: document.querySelector("#candidate-profile-avatar"),
    candidateProfileAvatarFallback: document.querySelector(
      "#candidate-profile-avatar-fallback",
    ),
    candidateProfileAvatarState: document.querySelector(
      "#candidate-profile-avatar-state",
    ),
    candidateProfileAvatarNote: document.querySelector(
      "#candidate-profile-avatar-note",
    ),
    candidateProfileGate: document.querySelector("#candidate-profile-gate"),
    candidateProfileName: document.querySelector("#candidate-profile-name"),
    candidateProfileFollowers: document.querySelector(
      "#candidate-profile-followers",
    ),
    candidateProfileObserved: document.querySelector(
      "#candidate-profile-observed",
    ),
    candidateProfileBio: document.querySelector("#candidate-profile-bio"),
    candidateProfileLink: document.querySelector("#candidate-profile-link"),
    candidateTimelineState: document.querySelector("#candidate-timeline-state"),
    candidateTimelineList: document.querySelector("#candidate-timeline-list"),
    candidateSearchState: document.querySelector("#candidate-search-state"),
    candidateSearchList: document.querySelector("#candidate-search-list"),
  };

  elements.scopeActiveCount.textContent = String(activeGroupCount);
  elements.scopeTotalCount.textContent = String(data.groups.length);
  elements.methodActiveCount.textContent = String(activeGroupCount);
  elements.methodTotalCount.textContent = String(data.groups.length);

  const state = {
    scope: "active",
    regionScope: "any",
    selectedProvinces: new Set(),
    selectedCities: new Set(),
    selectedEvidenceFilters: new Set(),
    expandedProvinces: new Set(),
    selectedId: null,
    emptyFilterSelection: false,
    searchMatches: [],
    activeSearchIndex: -1,
    animationFrame: null,
    view: { x: 0, y: 0, width: data.world.width, height: data.world.height },
    drag: null,
    dragMoved: false,
  };
  const allRegionCatalog = buildRegionCatalog("any");
  let regionCatalog = allRegionCatalog;

  function svgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(name, String(value));
      }
    });
    return element;
  }

  function appendSvgText(parent, text, attributes = {}) {
    const element = svgElement("text", attributes);
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function regionLabel(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function standardProvinceLabel(value) {
    const label = regionLabel(value) || "省份待核实";
    if (
      /(?:省|市|特别行政区|自治区)$/u.test(label) ||
      ["全国", "省份待核实", "未明确", "其他"].includes(label)
    ) {
      return label;
    }
    const specialLabels = {
      北京: "北京市",
      天津: "天津市",
      上海: "上海市",
      重庆: "重庆市",
      广西: "广西壮族自治区",
      宁夏: "宁夏回族自治区",
      新疆: "新疆维吾尔自治区",
      内蒙古: "内蒙古自治区",
      香港: "香港特别行政区",
      澳门: "澳门特别行政区",
    };
    return specialLabels[label] || `${label}省`;
  }

  function standardCityLabel(value) {
    const label = regionLabel(value);
    return label?.replace(/市$/u, "") || null;
  }

  function regionKey(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .replace(/(?:壮族|回族|维吾尔)自治区$/u, "")
      .replace(/(?:特别行政区|自治区|省|市)$/u, "")
      .replace(/\s+/g, "")
      .toLocaleLowerCase("zh-CN");
  }

  function regionResolutionState(group) {
    return (
      group.regionPlacement?.resolutionState ||
      (typeof group.regionNormalized === "object"
        ? group.regionNormalized?.resolutionState
        : null) ||
      null
    );
  }

  function reliableNormalizedCity(normalized) {
    if (!normalized?.city || normalized.cityKey === UNRESOLVED_CITY_KEY)
      return false;
    const resolutionState = normalized.resolutionState;
    if (!resolutionState) return true;
    return [
      "resolved",
      "verified",
      "city_resolved",
      "city_verified",
      "exact_city",
      "city_exact",
      "direct_municipality",
      "evidence_text",
    ].includes(resolutionState);
  }

  function reliableNormalizedProvince(normalized) {
    return Boolean(
      normalized?.province &&
      normalized.resolutionState !== "unknown" &&
      !/待核实/u.test(normalized.province) &&
      normalized.provinceKey !== regionKey("省份待核实"),
    );
  }

  function normalizedPlacement(placement, fallback = {}) {
    const source = placement && typeof placement === "object" ? placement : {};
    let province = regionLabel(
      source.province ||
        source.provinceName ||
        source.provinceLabel ||
        fallback.province,
    );
    const city = standardCityLabel(
      source.city || source.cityName || source.cityLabel || fallback.city,
    );
    province = standardProvinceLabel(province || "省份待核实");
    return {
      province,
      provinceKey: regionKey(province),
      city,
      cityKey: city ? regionKey(city) : UNRESOLVED_CITY_KEY,
      resolutionState:
        source.resolutionState || fallback.resolutionState || null,
      conflict: source.conflict ?? false,
      manualReview: source.manualReview ?? false,
    };
  }

  function normalizedGroupRegion(group) {
    const placement =
      group.regionPlacement && typeof group.regionPlacement === "object"
        ? group.regionPlacement
        : {};
    const normalized =
      group.regionNormalized && typeof group.regionNormalized === "object"
        ? group.regionNormalized
        : {};
    let province = regionLabel(
      placement.province ||
        placement.provinceName ||
        placement.provinceLabel ||
        normalized.province ||
        normalized.provinceName ||
        normalized.provinceLabel,
    );
    let city = standardCityLabel(
      placement.city ||
        placement.cityName ||
        placement.cityLabel ||
        normalized.city ||
        normalized.cityName ||
        normalized.cityLabel,
    );

    if (!province && typeof group.regionNormalized === "string") {
      const parts = group.regionNormalized
        .split(/[／/·>|]/u)
        .map((part) => part.trim())
        .filter(Boolean);
      province = regionLabel(parts[0]);
      city = regionLabel(parts[1]);
      city = standardCityLabel(city);
    }
    return normalizedPlacement(placement, {
      province: province || regionLabel(group.region),
      city,
      resolutionState: regionResolutionState(group),
    });
  }

  function rawRegionSlot(group, role) {
    const placement =
      group.regionPlacement && typeof group.regionPlacement === "object"
        ? group.regionPlacement
        : null;
    if (!placement) return null;
    if (placement[role] && typeof placement[role] === "object") {
      return placement[role];
    }
    return placement.primaryRole === role ? placement : null;
  }

  function normalizedRegionSlot(group, role) {
    const slot = rawRegionSlot(group, role);
    return slot ? normalizedPlacement(slot) : null;
  }

  function scopedGroupRegions(group, scope = state.regionScope) {
    const roles = scope === "any" ? ["founding", "activity"] : [scope];
    const slots = roles
      .map((role) => normalizedRegionSlot(group, role))
      .filter(Boolean);
    if (slots.length > 0) return slots;
    return scope === "any" ? [normalizedGroupRegion(group)] : [];
  }

  function regionResolutionLabel(normalized) {
    const stateValue = normalized.resolutionState;
    const labels = {
      resolved: "城市已可靠解析",
      verified: "城市已可靠解析",
      city_resolved: "城市已可靠解析",
      city_verified: "城市已可靠解析",
      exact_city: "城市已可靠解析",
      city_exact: "城市已可靠解析",
      direct_municipality: "直辖市标准化",
      evidence_text: "公开文本解析",
      city_unresolved: "城市待核实",
      province_only: "仅解析到省级",
      unresolved: "地域待核实",
      unknown: "地域待核实",
      ambiguous: "城市存在歧义",
    };
    if (labels[stateValue]) return labels[stateValue];
    if (!normalized.city) return "仅解析到省级";
    return reliableNormalizedCity(normalized) ? null : "城市待核实";
  }

  function needsRegionManualReview(normalized) {
    const conflict = normalized?.conflict;
    const hasConflict =
      conflict === true ||
      (Array.isArray(conflict) && conflict.length > 0) ||
      (typeof conflict === "string" &&
        !["", "none", "false", "resolved"].includes(
          conflict.trim().toLocaleLowerCase("zh-CN"),
        ));
    return normalized?.manualReview === true || hasConflict;
  }

  function formatRegionSlot(group, role) {
    const normalized = normalizedRegionSlot(group, role);
    if (!normalized) return "待核实（未提供该城市资料）";
    const cityReliable = reliableNormalizedCity(normalized);
    const resolutionLabel = regionResolutionLabel(normalized);
    const qualifiers = [];
    if (!cityReliable) qualifiers.push(resolutionLabel || "城市待核实");
    if (needsRegionManualReview(normalized)) {
      qualifiers.push("存在冲突，待人工复核");
    }
    return `${normalized.province} · ${cityReliable ? normalized.city : "城市待核实"}${qualifiers.length ? `（${[...new Set(qualifiers)].join("；")}）` : ""}`;
  }

  function buildRegionCatalog(scope = "any") {
    const provinces = new Map();
    const ensureProvince = (label) => {
      const safeLabel = standardProvinceLabel(label);
      const key = regionKey(safeLabel);
      if (!provinces.has(key)) {
        provinces.set(key, {
          key,
          label: safeLabel,
          count: 0,
          cities: new Map(),
        });
      }
      return provinces.get(key);
    };
    const addCity = (province, cityLabel) => {
      const safeLabel = standardCityLabel(cityLabel);
      if (!safeLabel) return;
      const key = regionKey(safeLabel);
      if (!province.cities.has(key)) {
        province.cities.set(key, { key, label: safeLabel, count: 0 });
      }
      return province.cities.get(key);
    };

    data.groups.forEach((group) => {
      const seenProvinces = new Set();
      const seenCities = new Set();
      scopedGroupRegions(group, scope).forEach((normalized) => {
        if (!reliableNormalizedProvince(normalized)) return;
        const province = ensureProvince(normalized.province);
        if (!seenProvinces.has(province.key)) {
          province.count += 1;
          seenProvinces.add(province.key);
        }
        if (!reliableNormalizedCity(normalized)) return;
        const city = addCity(province, normalized.city);
        const selectionKey = citySelectionKey(province.key, city.key);
        if (!seenCities.has(selectionKey)) {
          city.count += 1;
          seenCities.add(selectionKey);
        }
      });
    });

    return [...provinces.values()]
      .map((province) => ({
        ...province,
        cities: [...province.cities.values()].sort((a, b) =>
          a.label.localeCompare(b.label, "zh-CN"),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }

  function safeHttpsUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  function safeCandidateWeiboUrl(value) {
    const safeUrl = safeHttpsUrl(value);
    if (!safeUrl) return null;
    const hostname = new URL(safeUrl).hostname.toLowerCase();
    return hostname === "weibo.com" || hostname === "www.weibo.com"
      ? safeUrl
      : null;
  }

  function safeCandidateAvatarPath(value, groupId) {
    const match = String(value ?? "").match(
      /^assets\/weibo-api-avatar-candidates\/(g\d{3})\.(?:jpg|png|webp)$/u,
    );
    return match?.[1] === groupId ? value : null;
  }

  function safeAssetPath(value, folder) {
    if (!value) return null;
    const pattern = new RegExp(
      `^assets/${folder}/[a-z0-9_-]+\\.(?:jpe?g|png|webp)$`,
      "i",
    );
    return pattern.test(value) ? value : null;
  }

  function preferredAvatarPath(group) {
    return (
      safeAssetPath(group.weiboAvatarPath, "weibo-avatars") ||
      safeAssetPath(group.weiboAvatarPath, "weibo-api-avatar-candidates") ||
      safeAssetPath(group.avatarPath, "avatars") ||
      safeAssetPath(group.avatarPath, "weibo-avatars")
    );
  }

  function safeVisualAssetPath(value) {
    return (
      safeAssetPath(value, "group-visuals") ||
      safeAssetPath(value, "posters") ||
      safeAssetPath(value, "profile-covers") ||
      safeAssetPath(value, "weibo-cached-visuals")
    );
  }

  function normalizedStylePlacement(group) {
    const placement = group.stylePlacement;
    if (
      placement &&
      ["verified_axis", "axis_out", "unresolved"].includes(placement.kind)
    ) {
      return {
        kind: placement.kind,
        lane: placement.lane || null,
        label: placement.label || group.styleBand || "未判定／阻塞",
        comparable: Boolean(placement.comparable),
        score: Number.isFinite(placement.score) ? placement.score : null,
      };
    }

    const editorial = group.editorialStyle;
    if (editorial && typeof editorial === "object") {
      const label = editorial.layoutBand || group.styleBand;
      if (editorial.axisBand === "axis_out") {
        return {
          kind: "axis_out",
          lane: "axis_out",
          label: label || "轴外编辑风格",
          comparable: false,
          score: null,
        };
      }
      if (editorial.axisBand === "unresolved") {
        return {
          kind: "unresolved",
          lane: "unresolved",
          label: label || "未判定",
          comparable: false,
          score: null,
        };
      }
      if (
        Number.isFinite(editorial.score) ||
        Number.isFinite(group.styleScore)
      ) {
        return {
          kind: "verified_axis",
          lane: editorial.axisBand || label,
          label: label || "宽口径编辑风格",
          comparable: true,
          score: Number.isFinite(editorial.score)
            ? editorial.score
            : group.styleScore,
        };
      }
    }

    const sourceState = group.fieldEvidence?.style?.state;
    if (
      sourceState === "verified" ||
      (Number.isFinite(group.styleScore) && group.styleBand !== "风格未判定")
    ) {
      return {
        kind: "verified_axis",
        lane: group.styleBand,
        label: group.styleBand || "宽口径编辑风格",
        comparable: true,
        score: Number.isFinite(group.styleScore) ? group.styleScore : null,
      };
    }
    if (sourceState === "axis_out") {
      return {
        kind: "axis_out",
        lane: "axis_out",
        label: "轴外编辑风格",
        comparable: false,
        score: null,
      };
    }
    return {
      kind: "unresolved",
      lane: sourceState === "blocked" ? "blocked" : "unresolved",
      label: sourceState === "blocked" ? "身份阻塞／未判定" : "未判定",
      comparable: false,
      score: null,
    };
  }

  function normalizedEditorialStyle(group) {
    if (group.editorialStyle && typeof group.editorialStyle === "object") {
      return {
        displayLabel:
          group.editorialStyle.displayLabel ||
          group.editorialStyle.conclusion ||
          "未形成宽口径结论",
        conclusion: group.editorialStyle.conclusion || null,
        epistemicStatus: group.editorialStyle.epistemicStatus || "unreviewed",
        confidence: group.editorialStyle.confidence || null,
        axisBand: group.editorialStyle.axisBand || null,
        rationale: group.editorialStyle.rationale || null,
        evidenceSummary: group.editorialStyle.evidenceSummary || null,
        sourceUrl: group.editorialStyle.sourceUrl || null,
      };
    }

    const legacyLabel =
      group.originalPrimaryStyle && group.originalPrimaryStyle !== "无法判断"
        ? group.originalPrimaryStyle
        : null;
    return {
      displayLabel: legacyLabel || "尚无宽口径风格结论",
      conclusion: null,
      epistemicStatus: legacyLabel ? "legacy_editorial" : "unreviewed",
      confidence: null,
      axisBand: null,
      rationale: null,
      evidenceSummary: null,
      sourceUrl: null,
    };
  }

  function epistemicStatusLabel(value) {
    const labels = {
      fact: "公开事实",
      inference: "编辑推断",
      guess: "编辑猜测",
      uncertain: "证据不确定",
      verified: "证据充分",
      strong: "强证据",
      moderate: "中等证据",
      weak: "弱证据线索",
      tentative: "暂定线索",
      inferred: "编辑性归纳",
      legacy_editorial: "旧档案编辑口径",
      not_found: "未取得证据",
      blocked: "身份阻塞",
      unreviewed: "尚未核对",
      unresolved: "未判定",
    };
    return labels[value] || String(value || "尚未核对").replaceAll("_", " ");
  }

  function confidenceLabel(value) {
    const labels = { high: "高", medium: "中", low: "低" };
    return labels[value] || (value ? String(value) : "未标注");
  }

  function strictMusicLabel(group) {
    const strictMusic =
      group.strictMusicAxisV2 && typeof group.strictMusicAxisV2 === "object"
        ? group.strictMusicAxisV2
        : {};
    const styleEvidence = group.fieldEvidence?.style;
    const strictState = strictMusic.state || styleEvidence?.state;
    const strictLabel =
      strictMusic.primaryStyle ||
      styleEvidence?.assignedStyle ||
      (strictMusic.styleBand && strictMusic.styleBand !== "风格未判定"
        ? strictMusic.styleBand
        : null);
    if (strictState === "verified") return strictLabel || "已验证音乐定位";
    if (strictState === "axis_out") return strictLabel || "轴外音乐定位";
    if (strictState === "blocked") return "身份阻塞，未进行音乐判定";
    if (strictState === "not_found") return "未取得严格整团音乐定位";
    if (strictLabel) return strictLabel;
    return "严格音乐定位尚未判定";
  }

  function normalizedProfileSupplement(group) {
    const raw =
      group.editorialProfile ||
      group.profileSupplement ||
      group.editorialProfileSupplement;
    if (!raw) return null;
    if (typeof raw === "string") {
      const url = safeHttpsUrl(raw);
      return url
        ? {
            label: "补充公开主页候选",
            url,
            appliedFields: [],
            rationale: null,
          }
        : null;
    }
    if (typeof raw !== "object") return null;
    const url = safeHttpsUrl(
      raw.profileUrl || raw.pageUrl || raw.url || raw.sourceUrl,
    );
    const label =
      raw.displayName ||
      raw.handle ||
      raw.label ||
      raw.title ||
      "补充公开主页候选";
    return {
      label,
      url,
      appliedFields: Array.isArray(raw.appliedFields)
        ? raw.appliedFields.filter((field) =>
            [
              "identity",
              "followers",
              "displayName",
              "profileBio",
              "avatar",
            ].includes(field),
          )
        : [],
      rationale:
        raw.rationale || raw.reason || raw.note || raw.identityReason || null,
    };
  }

  function isSupersededProfileWarning(warning, group, profileSupplement) {
    if (!profileSupplement) return false;
    const appliedFields = new Set(profileSupplement.appliedFields || []);
    const message = String(warning || "");
    if (/^粉丝量未取得/u.test(message)) {
      return (
        appliedFields.has("followers") &&
        group.followersKnown &&
        Number.isFinite(group.followersValue)
      );
    }
    if (/^头像未取得/u.test(message)) {
      return appliedFields.has("avatar") && Boolean(group.weiboAvatarPath);
    }
    if (
      /^(?:身份定向复核未取得|候选 UID 的展示名与团名不匹配)/u.test(message)
    ) {
      return (
        appliedFields.has("identity") &&
        Boolean(group.weiboUid && safeHttpsUrl(group.profileUrl))
      );
    }
    return false;
  }

  function placementClassName(kind) {
    return {
      verified_axis: "is-verified-axis",
      axis_out: "is-axis-out",
      unresolved: "is-unresolved",
    }[kind];
  }

  function compactNumber(value) {
    return new Intl.NumberFormat("zh-CN", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }

  function followersLabel(group) {
    if (!group.followersKnown) return group.followersText;
    return group.uidConfidence === "medium"
      ? `候选${group.followersText}（UID 中置信）`
      : group.followersText;
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN")
      .replace(/[\s@·・_\-—–/\\()[\]【】（）.]+/g, "");
  }

  function isSubsequence(query, candidate) {
    let queryIndex = 0;
    for (const character of candidate) {
      if (character === query[queryIndex]) queryIndex += 1;
      if (queryIndex === query.length) return true;
    }
    return false;
  }

  function bigramScore(query, candidate) {
    if (query.length < 2) return 0;
    const queryBigrams = new Set();
    const candidateBigrams = new Set();
    for (let index = 0; index < query.length - 1; index += 1) {
      queryBigrams.add(query.slice(index, index + 2));
    }
    for (let index = 0; index < candidate.length - 1; index += 1) {
      candidateBigrams.add(candidate.slice(index, index + 2));
    }
    let overlap = 0;
    queryBigrams.forEach((bigram) => {
      if (candidateBigrams.has(bigram)) overlap += 1;
    });
    return overlap / queryBigrams.size;
  }

  function scoreCandidate(group, rawQuery) {
    const query = normalizeSearch(rawQuery);
    if (!query) return 0;
    const normalizedRegion = normalizedGroupRegion(group);
    const fields = [
      group.name,
      group.handle,
      group.handleKey,
      group.profileDisplayName,
      group.primaryStyle,
      group.styleBand,
      group.editorialStyle?.displayLabel,
      group.editorialStyle?.conclusion,
      group.editorialStyle?.axisBand,
      group.editorialStyle?.evidenceSummary,
      group.stylePlacement?.label,
      group.stylePlacement?.lane,
      normalizedRegion.province,
      normalizedRegion.city,
      ...(group.secondaryTags || []),
      ...(group.publicReview?.aliases || []),
    ]
      .filter(Boolean)
      .map(normalizeSearch);

    let bestScore = 0;
    fields.forEach((candidate, fieldIndex) => {
      if (!candidate) return;
      const primaryBonus = fieldIndex < 3 ? 40 : 0;
      let score = 0;
      if (candidate === query) {
        score = 1000;
      } else if (candidate.startsWith(query)) {
        score = 820 - Math.min(candidate.length - query.length, 80);
      } else if (candidate.includes(query)) {
        score = 650 - candidate.indexOf(query) * 4;
      } else {
        const similarity = bigramScore(query, candidate);
        if (similarity >= 0.34) score = 330 + similarity * 180;
        if (isSubsequence(query, candidate))
          score = Math.max(score, 260 - candidate.length);
      }
      if (score > 0) bestScore = Math.max(bestScore, score + primaryBonus);
    });
    return bestScore;
  }

  function bandPlacementKind(band) {
    if (["verified_axis", "axis_out", "unresolved"].includes(band.kind)) {
      return band.kind;
    }
    if (
      ["verified_axis", "axis_out", "unresolved"].includes(band.placementKind)
    ) {
      return band.placementKind;
    }
    if (/轴外/u.test(band.label || "")) return "axis_out";
    if (/未判定|阻塞|待核/u.test(band.label || "")) return "unresolved";
    return "verified_axis";
  }

  function renderBands() {
    const { world } = data;
    data.bands.forEach((band, index) => {
      const placementKind = bandPlacementKind(band);
      const isComparable =
        placementKind === "verified_axis" && band.comparable !== false;
      const fill = svgElement("rect", {
        x: isComparable ? world.knownXStart - 55 : 120,
        y: band.top,
        width: isComparable
          ? world.knownXEnd - world.knownXStart + 110
          : world.width - 240,
        height: band.bottom - band.top,
        class:
          placementKind === "axis_out"
            ? "axis-out-style-fill"
            : placementKind === "unresolved"
              ? "unresolved-style-fill"
              : `band-fill${index % 2 === 1 ? " band-alternate" : ""}`,
      });
      elements.bandLayer.append(fill);

      elements.bandLayer.append(
        svgElement("line", {
          x1: isComparable ? world.knownXStart - 55 : 120,
          y1: band.bottom,
          x2: isComparable ? world.knownXEnd + 55 : world.width - 120,
          y2: band.bottom,
          class: `band-rule${isComparable ? "" : " is-categorical"}`,
        }),
      );

      const labelY = band.top + 28;
      appendSvgText(elements.bandLayer, band.label, {
        x: world.followerUnknownXEnd + 82,
        y: labelY,
        class: "band-label",
        "text-anchor": "end",
      });
      appendSvgText(
        elements.bandLayer,
        band.description ||
          (isComparable
            ? styleBandCaption(band.label)
            : placementKind === "axis_out"
              ? "宽口径轴外编辑风格 · 带内纵向不表示程度"
              : "未判定或身份阻塞 · 不参与纵轴比较"),
        {
          x: world.followerUnknownXEnd + 82,
          y: labelY + 24,
          class: "band-sublabel",
          "text-anchor": "end",
        },
      );
    });

    elements.bandLayer.append(
      svgElement("rect", {
        x: world.followerUnknownXStart,
        y: 120,
        width: world.followerUnknownXEnd - world.followerUnknownXStart,
        height:
          Math.max(
            world.unknownStyleBottom || 0,
            ...data.bands.map((band) => band.bottom),
          ) - 120,
        class: "unknown-followers-fill",
      }),
    );
  }

  function configureWorld() {
    [elements.chartCanvas, elements.chartGrid].forEach((rectangle) => {
      rectangle.setAttribute("width", String(data.world.width));
      rectangle.setAttribute("height", String(data.world.height));
    });
    elements.svg.setAttribute(
      "viewBox",
      `0 0 ${data.world.width} ${data.world.height}`,
    );
  }

  function styleBandCaption(label) {
    const captions = {
      强摇滚: "重型 · 朋克 · 核",
      "偏摇滚／实验": "另类 · 暗黑 · 实验",
      "中性／主题企划": "主题 · 综合 · 电子",
      "偏王道／梦幻治愈": "梦幻 · 治愈 · 轻甜",
      强王道: "传统王道 · 元气",
    };
    return captions[label] || "编辑性风格分带";
  }

  function renderAxes() {
    const { world, followerDomain } = data;
    elements.axisLayer.append(
      svgElement("line", {
        x1: world.knownXStart,
        y1: world.axisY,
        x2: world.knownXEnd,
        y2: world.axisY,
        class: "axis-line",
      }),
      svgElement("line", {
        x1: world.followerUnknownXEnd + 100,
        y1: 100,
        x2: world.followerUnknownXEnd + 100,
        y2: world.unknownStyleBottom,
        class: "unknown-divider",
      }),
    );

    followerDomain.ticks.forEach((tick) => {
      elements.axisLayer.append(
        svgElement("line", {
          x1: tick.x,
          y1: 105,
          x2: tick.x,
          y2: world.axisY + 16,
          class: "axis-tick",
        }),
      );
      appendSvgText(elements.axisLayer, compactNumber(tick.value), {
        x: tick.x,
        y: world.axisY + 42,
        class: "axis-label",
        "text-anchor": "middle",
      });
    });

    appendSvgText(elements.axisLayer, "公开粉丝量（对数轴）  →", {
      x: world.knownXEnd,
      y: world.axisY + 78,
      class: "axis-title",
      "text-anchor": "end",
    });
    appendSvgText(elements.axisLayer, "粉丝量待核实", {
      x: world.followerUnknownXStart + 24,
      y: 92,
      class: "band-label",
    });
    appendSvgText(elements.axisLayer, "独立区域 · 不参与横轴排序", {
      x: world.followerUnknownXStart + 24,
      y: 118,
      class: "unknown-label",
    });
    appendSvgText(
      elements.axisLayer,
      `已知范围 ${compactNumber(followerDomain.minimum)}—${compactNumber(followerDomain.maximum)}`,
      {
        x: world.knownXStart,
        y: world.axisY + 78,
        class: "unknown-label",
      },
    );
  }

  function renderNodes() {
    const tetherFragment = document.createDocumentFragment();
    const nodeFragment = document.createDocumentFragment();

    data.groups.forEach((group) => {
      const placement = normalizedStylePlacement(group);
      const editorialStyle = normalizedEditorialStyle(group);
      const displacement = Math.hypot(
        group.x - group.baseX,
        group.y - group.baseY,
      );
      if (displacement > 7) {
        const tether = svgElement("line", {
          x1: group.baseX,
          y1: group.baseY,
          x2: group.x,
          y2: group.y,
          class: `tether${group.isActive ? "" : " is-non-active"}`,
          "data-id": group.id,
        });
        tetherElements.set(group.id, tether);
        tetherFragment.append(tether);
      }

      const node = svgElement("g", {
        class: `idol-node ${placementClassName(placement.kind)}${group.isActive ? "" : " is-non-active"}${group.uidConfidence === "medium" ? " is-medium-identity" : ""}`,
        transform: `translate(${group.x} ${group.y})`,
        tabindex: "-1",
        role: "button",
        "data-id": group.id,
        "aria-label": `${group.name}，${followersLabel(group)}，宽口径编辑风格：${editorialStyle.displayLabel}，图上位置：${placement.label}`,
      });
      const title = svgElement("title");
      title.textContent = `${group.name}｜${followersLabel(group)}｜${placement.label}｜${editorialStyle.displayLabel}`;
      node.append(title);

      const visual = svgElement("g", { class: "node-visual" });
      visual.append(
        svgElement("circle", { r: 30, class: "node-focus" }),
        svgElement("circle", { r: 25, class: "node-disc" }),
      );

      const initials = appendSvgText(visual, group.initials || "?", {
        x: 0,
        y: 7,
        class: "node-initials",
      });
      initials.setAttribute("aria-hidden", "true");

      const avatarPath = preferredAvatarPath(group);
      if (avatarPath) {
        const image = svgElement("image", {
          href: avatarPath,
          x: -25,
          y: -25,
          width: 50,
          height: 50,
          class: "avatar-image",
          "clip-path": "url(#avatar-clip)",
          preserveAspectRatio: "xMidYMid slice",
        });
        image.addEventListener("error", () => image.classList.add("is-broken"));
        visual.append(image);
      }

      appendSvgText(visual, group.shortName || group.name, {
        x: 0,
        y: 45,
        class: "node-name",
      });
      node.append(visual);

      node.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.dragMoved) return;
        selectGroup(group.id, { focus: true, scrollDetail: true });
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectGroup(group.id, { focus: true, scrollDetail: true });
          return;
        }
        const directionByKey = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowUp: "up",
          ArrowDown: "down",
        };
        const direction = directionByKey[event.key];
        if (direction) {
          event.preventDefault();
          const nextGroup = findDirectionalGroup(group, direction);
          if (nextGroup) {
            selectGroup(nextGroup.id);
            nodeElements.get(nextGroup.id)?.focus();
          }
        }
      });

      nodeElements.set(group.id, node);
      nodeFragment.append(node);
    });

    elements.tetherLayer.append(tetherFragment);
    elements.nodeLayer.append(nodeFragment);
  }

  function findDirectionalGroup(currentGroup, direction) {
    const horizontal = direction === "left" || direction === "right";
    const sign = direction === "left" || direction === "up" ? -1 : 1;
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    data.groups.forEach((candidate) => {
      if (candidate.id === currentGroup.id) return;
      if (!groupIsVisible(candidate)) return;
      const deltaX = candidate.x - currentGroup.x;
      const deltaY = candidate.y - currentGroup.y;
      const primaryDelta = horizontal ? deltaX : deltaY;
      const crossDelta = horizontal ? deltaY : deltaX;
      if (primaryDelta * sign <= 1) return;
      const score = Math.abs(primaryDelta) + Math.abs(crossDelta) * 1.35;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }

  function setLink(element, href, label, unavailableLabel = "暂无可用链接") {
    const safeHref = safeHttpsUrl(href);
    if (safeHref) {
      element.href = safeHref;
      element.textContent = label;
      element.classList.remove("is-disabled");
      element.removeAttribute("aria-disabled");
      element.tabIndex = 0;
    } else {
      element.removeAttribute("href");
      element.textContent = unavailableLabel;
      element.classList.add("is-disabled");
      element.setAttribute("aria-disabled", "true");
      element.tabIndex = -1;
    }
  }

  function fallbackProfileUrl(group) {
    if (!group.handleKey) return null;
    return `https://weibo.com/n/${encodeURIComponent(group.handleKey)}`;
  }

  function formatObservedDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function sourceKind(url) {
    const safeUrl = safeHttpsUrl(url);
    if (!safeUrl) return "不可用来源";
    const hostname = new URL(safeUrl).hostname.toLowerCase();
    if (hostname === "weibo.com" || hostname.endsWith(".weibo.com")) {
      return "微博官号";
    }
    if (hostname === "sina.cn" || hostname.endsWith(".sina.cn")) {
      return "新浪公开页";
    }
    if (
      hostname === "chinaidols.fandom.com" ||
      hostname.endsWith(".chinaidols.fandom.com")
    ) {
      return "China Idols Wiki";
    }
    if (hostname === "idol.schoid.cn") return "团体资料目录";
    return hostname;
  }

  function wikiLinkConfig(group) {
    const wikiCandidate = group.wiki || group.wikiReview;
    const wiki =
      wikiCandidate && typeof wikiCandidate === "object" ? wikiCandidate : {};
    const stateAliases = {
      matched: "exact_page",
      exact_page: "exact_page",
      candidate: "candidate",
      not_found: "searched_not_found",
      searched_not_found: "searched_not_found",
      unreviewed: "unreviewed",
      not_checked: "unreviewed",
    };
    const state = stateAliases[wiki.state] || "unreviewed";
    const exactPageUrl = safeHttpsUrl(wiki.pageUrl);
    if (state === "exact_page" && exactPageUrl) {
      const kind = sourceKind(exactPageUrl);
      return {
        href: exactPageUrl,
        label: wiki.title
          ? `${kind}：${wiki.title} ↗`
          : `打开${kind}精确团体条目 ↗`,
        unavailableLabel: "精确团体条目不可用",
      };
    }

    const labels = {
      candidate: "Wiki 候选未绑定 · 打开安全搜索入口 ↗",
      searched_not_found: "Wiki 暂无精确条目 · 打开安全搜索入口 ↗",
      unreviewed: "Wiki 尚未核对 · 打开安全搜索入口 ↗",
    };
    const unavailableLabels = {
      candidate: "Wiki 候选未绑定 · 暂无安全搜索入口",
      searched_not_found: "Wiki 暂无精确条目",
      unreviewed: "Wiki 尚未核对",
    };
    return {
      href: safeHttpsUrl(wiki.searchUrl),
      label: labels[state],
      unavailableLabel: unavailableLabels[state],
    };
  }

  function preferredVisualLabel(visual) {
    const labels = {
      full_roster_art_poster: "完整团体艺术海报（未逐人核验，按展示口径采用）",
      full_roster_poster: "团体海报（未逐人核验，按展示口径采用）",
      group_photo_candidate: "候选团体合照（未逐人核验）",
      brand_visual: "品牌视觉（非成员海报）",
      banner: "团体横幅视觉",
      profile_cover: "官号背景图",
      official_profile_cover: "官号背景图（按展示口径采用）",
      official_group_artwork: "官方团体视觉（按展示口径采用）",
      wiki_group_artwork: "Wiki 团体视觉（按展示口径采用）",
      third_party_cover: "第三方团体资料封面",
    };
    return labels[visual.kind] || "团体视觉素材（按展示口径采用）";
  }

  function visualUsesContain(visual) {
    return (
      /poster|art/u.test(visual.kind || "") ||
      visual.groupScope === "full_roster" ||
      visual.groupScope === "full_group_art" ||
      visual.path?.startsWith("assets/group-visuals/")
    );
  }

  function renderPoster(group) {
    elements.posterInitials.textContent = group.initials || "?";
    const candidates = [];
    const addCandidate = (candidate) => {
      const path = candidate?.avatarFallback
        ? preferredAvatarPath(group)
        : safeVisualAssetPath(candidate?.path);
      if (!path || candidates.some((item) => item.path === path)) return;
      candidates.push({ ...candidate, path });
    };

    if (group.preferredVisual && typeof group.preferredVisual === "object") {
      addCandidate({
        path: group.preferredVisual.assetPath,
        kind: group.preferredVisual.kind || "profile_cover",
        groupScope: group.preferredVisual.groupScope || null,
        label: preferredVisualLabel(group.preferredVisual),
        sourceUrl: group.preferredVisual.sourceUrl || null,
        rationale: group.preferredVisual.rationale || null,
      });
    }

    const profileCoverPath = safeAssetPath(
      group.profileCoverPath,
      "profile-covers",
    );
    const legacyPosterPath = safeAssetPath(group.posterPath, "posters");
    const confirmedProfilePoster =
      group.profileCoverPosterConfirmed &&
      group.profileCoverKind === "full_roster_poster";

    if (group.posterConfirmed) {
      addCandidate({
        path: legacyPosterPath,
        kind: "full_roster_art_poster",
        groupScope: "full_roster",
        label: "完整团体艺术海报（未逐人核验，按展示口径采用）",
        sourceUrl: group.posterSourcePage,
      });
    }
    if (confirmedProfilePoster) {
      addCandidate({
        path: profileCoverPath,
        kind: "full_roster_poster",
        groupScope: "full_roster",
        label: "微博官号背景图 · 团体海报（按展示口径采用）",
        sourceUrl:
          group.fieldEvidence?.profileCover?.sourceUrl ||
          group.profileCoverSourcePage,
      });
    }
    if (profileCoverPath) {
      addCandidate({
        path: profileCoverPath,
        kind: group.profileCoverKind || "profile_cover",
        groupScope: null,
        label:
          group.profileCoverKind === "brand_visual"
            ? "微博官号背景图 · 品牌视觉（非成员海报）"
            : group.profileCoverKind === "group_photo_candidate"
              ? "微博官号背景图 · 候选团体合照（未逐人核验）"
              : "微博官号背景图（海报完整性未核验）",
        sourceUrl:
          group.fieldEvidence?.profileCover?.sourceUrl ||
          group.profileCoverSourcePage,
      });
    }
    addCandidate({
      path: legacyPosterPath,
      kind: "third_party_cover",
      groupScope: null,
      label: group.posterLabel || "团体资料封面（未逐人核验）",
      sourceUrl: group.posterSourcePage,
    });
    addCandidate({
      path: preferredAvatarPath(group),
      kind: "official_profile_avatar_fallback",
      groupScope: "profile_identity_only",
      label: "官号头像兜底（尚未找到可核验团体海报）",
      sourceUrl:
        group.fieldEvidence?.avatar?.sourceUrl ||
        group.avatarSourcePage ||
        group.profileUrl,
      rationale:
        "完整团体海报、官方艺术图、背景图与资料封面均不可用，暂以已绑定官号头像保持详情可辨识；不计作团体海报。",
      avatarFallback: true,
    });

    const showFallback = (label) => {
      elements.detailPoster.onerror = null;
      elements.detailPoster.hidden = true;
      elements.detailPoster.removeAttribute("src");
      elements.posterFallback.hidden = false;
      elements.posterStage.classList.remove("is-poster-art", "is-cover-visual");
      elements.posterLabel.textContent = label;
      setLink(
        elements.posterSourceLink,
        null,
        "查看当前图像来源 ↗",
        "暂无图像来源",
      );
    };

    if (candidates.length === 0) {
      showFallback("暂无可核验图像");
      return;
    }

    let candidateIndex = 0;
    const showCandidate = () => {
      const candidate = candidates[candidateIndex];
      if (!candidate) {
        showFallback("图像载入失败 · 已回退首字母");
        return;
      }
      const contain = visualUsesContain(candidate);
      elements.posterStage.classList.toggle("is-poster-art", contain);
      elements.posterStage.classList.toggle("is-cover-visual", !contain);
      elements.detailPoster.hidden = false;
      elements.posterFallback.hidden = true;
      elements.detailPoster.alt = `${group.name}的${candidate.label}`;
      elements.posterLabel.textContent = candidate.label;
      setLink(
        elements.posterSourceLink,
        candidate.sourceUrl,
        `当前图像来源（${sourceKind(candidate.sourceUrl)}） ↗`,
        "暂无图像来源",
      );
      elements.detailPoster.onerror = () => {
        candidateIndex += 1;
        showCandidate();
      };
      elements.detailPoster.src = candidate.path;
    };
    showCandidate();
  }

  function candidateGateLabel(value) {
    const labels = {
      strict_uid_match: "严格 UID 一致",
      strict_rejected: "严格主档已拒绝",
      strict_uid_conflict: "与严格 UID 冲突",
      source_conflict: "候选来源相互冲突",
      conflict: "身份冲突",
      manual_required: "候选待人工确认",
      unbound_keyword_hit: "关键词命中 · 未绑定",
      no_candidate: "未取得候选",
      not_returned: "接口未返回",
      not_queried: "尚未查询",
      query_failed: "查询失败",
      unavailable: "证据不可用",
    };
    return labels[value] || String(value || "未载入").replaceAll("_", " ");
  }

  function candidateSourceStateLabel(value) {
    const labels = {
      collected: "正式接口缓存",
      partial_trial_bounded: "体验采集缓存",
      partial_trial_recovered: "体验时间线缓存",
      cached: "本地缓存",
      candidate: "候选记录",
      rejected_by_strict_master: "严格主档已拒绝",
      conflict: "候选冲突",
      no_usable_candidate: "没有可用候选",
      not_collected: "尚未采集",
      blocked: "能力门阻塞",
      not_returned: "接口未返回",
      not_queried: "尚未查询",
      query_failed: "查询失败",
      unavailable: "暂无可用证据",
    };
    return labels[value] || String(value || "未载入").replaceAll("_", " ");
  }

  function candidateEvidenceFor(group) {
    const evidence = group?.candidateEvidence;
    return evidence && typeof evidence === "object" ? evidence : {};
  }

  function candidateSummaries(section) {
    return Array.isArray(section?.summaries)
      ? section.summaries.slice(0, 3)
      : [];
  }

  function renderCandidatePostList(element, section, emptyLabel) {
    element.replaceChildren();
    const summaries = candidateSummaries(section);
    if (summaries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "candidate-list-empty";
      empty.textContent = emptyLabel;
      element.append(empty);
      return;
    }

    summaries.forEach((summary) => {
      const item = document.createElement("li");
      const copy = document.createElement("p");
      copy.textContent = summary.text || "博文正文摘要未返回";
      item.append(copy);

      const meta = document.createElement("p");
      meta.className = "candidate-item-meta";
      const author = [summary.authorName, summary.authorUid]
        .filter(Boolean)
        .join(" · UID ");
      const createdAt = formatObservedDate(summary.createdAt);
      meta.textContent =
        [author, createdAt].filter(Boolean).join(" · ") || "时间未记录";
      item.append(meta);

      const postUrl = safeCandidateWeiboUrl(summary.postUrl);
      if (postUrl) {
        const link = document.createElement("a");
        link.href = postUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "查看对应微博（候选证据） ↗";
        item.append(link);
      }
      element.append(item);
    });
  }

  function renderCandidateEvidence(group) {
    const evidence = candidateEvidenceFor(group);
    const profile = evidence.profile || {};
    const timeline = evidence.timeline || {};
    const search = evidence.search || {};
    const profileSummary = candidateSummaries(profile)[0] || null;
    const profileGate = profile.gateState || "unavailable";
    const timelineCount = candidateSummaries(timeline).length;
    const searchCount = candidateSummaries(search).length;
    const acceptedProfile =
      group.editorialProfileSupplement?.state === "accepted_candidate"
        ? group.editorialProfileSupplement
        : null;
    const acceptedFields = new Set(acceptedProfile?.appliedFields || []);
    const acceptedProfileMatchesCandidate = Boolean(
      acceptedProfile &&
      profileSummary &&
      String(profileSummary.uid || "") === String(acceptedProfile.uid || ""),
    );

    const containsManualReview = [
      "manual_required",
      "strict_rejected",
      "strict_uid_conflict",
      "source_conflict",
      "conflict",
    ].includes(profileGate);
    elements.candidateEvidenceState.textContent =
      acceptedProfileMatchesCandidate
        ? "身份已接受 · 展示层采用"
        : profileGate === "strict_uid_match"
          ? "严格 UID 一致 · 原始候选"
          : containsManualReview
            ? "含待复核线索 · 未应用"
            : timelineCount + searchCount > 0
              ? "有缓存线索 · 未应用"
              : "暂无可用候选";
    elements.candidateProfileState.textContent = candidateSourceStateLabel(
      profile.sourceState,
    );
    const candidateAvatarPath = safeCandidateAvatarPath(
      profileSummary?.candidateAvatarPath,
      group.id,
    );
    const candidateAvatarApplied = Boolean(
      acceptedProfileMatchesCandidate &&
      acceptedFields.has("avatar") &&
      candidateAvatarPath &&
      candidateAvatarPath === group.weiboAvatarPath &&
      candidateAvatarPath === acceptedProfile.avatarAssetPath,
    );
    elements.candidateProfileAvatar.onerror = null;
    if (candidateAvatarPath) {
      elements.candidateProfileAvatar.hidden = false;
      elements.candidateProfileAvatarFallback.hidden = true;
      elements.candidateProfileAvatar.alt = candidateAvatarApplied
        ? `${group.name}经独立身份接受的官号头像（展示层已采用）`
        : `${group.name}的候选官号头像（未应用）`;
      elements.candidateProfileAvatarState.textContent = candidateAvatarApplied
        ? "本地已校验 · 展示层已采用"
        : "本地已校验 · 未应用";
      elements.candidateProfileAvatarNote.textContent = candidateAvatarApplied
        ? "经独立身份接受后作为本页展示头像；严格主档未改写"
        : "仅作候选证据预览，未替换主头像";
      elements.candidateProfileAvatar.onerror = () => {
        elements.candidateProfileAvatar.hidden = true;
        elements.candidateProfileAvatar.removeAttribute("src");
        elements.candidateProfileAvatarFallback.hidden = false;
        elements.candidateProfileAvatarState.textContent =
          "本地候选头像载入失败";
        elements.candidateProfileAvatarNote.textContent =
          "素材路径仍保留在证据记录中";
      };
      elements.candidateProfileAvatar.src = candidateAvatarPath;
    } else {
      elements.candidateProfileAvatar.hidden = true;
      elements.candidateProfileAvatar.removeAttribute("src");
      elements.candidateProfileAvatar.alt = "";
      elements.candidateProfileAvatarFallback.hidden = false;
      elements.candidateProfileAvatarState.textContent = "暂无本地候选头像";
      elements.candidateProfileAvatarNote.textContent =
        "当前缓存没有通过本地素材校验的头像";
    }
    elements.candidateProfileGate.textContent = candidateGateLabel(profileGate);
    elements.candidateProfileName.textContent = profileSummary
      ? [
          profileSummary.displayName,
          profileSummary.uid && `UID ${profileSummary.uid}`,
        ]
          .filter(Boolean)
          .join(" · ") || "未返回账号名称"
      : "未取得候选账号";
    elements.candidateProfileFollowers.textContent = profileSummary
      ? profileSummary.followersDisplay ||
        (Number.isFinite(profileSummary.followersValue)
          ? `${profileSummary.followersValue.toLocaleString("zh-CN")} 人`
          : "未返回")
      : "—";
    elements.candidateProfileObserved.textContent =
      formatObservedDate(profileSummary?.observedAt) || "未记录";
    elements.candidateProfileBio.textContent = profileSummary?.bio
      ? `账号简介：${profileSummary.bio}`
      : "未取得可展示的账号简介。";

    const profileLinkBlocked = [
      "strict_rejected",
      "strict_uid_conflict",
      "source_conflict",
      "conflict",
    ].includes(profileGate);
    const candidateProfileUrl = profileLinkBlocked
      ? null
      : safeCandidateWeiboUrl(profileSummary?.profileUrl);
    elements.candidateProfileLink.hidden = !candidateProfileUrl;
    setLink(
      elements.candidateProfileLink,
      candidateProfileUrl,
      acceptedProfileMatchesCandidate
        ? "打开已接受的展示主页 ↗"
        : "打开候选主页（未应用） ↗",
      "候选主页不可用",
    );

    elements.candidateTimelineState.textContent = `${candidateSourceStateLabel(
      timeline.sourceState,
    )} · ${timelineCount} 条摘要`;
    renderCandidatePostList(
      elements.candidateTimelineList,
      timeline,
      "当前缓存没有可安全绑定到该团的官号动态。",
    );
    elements.candidateSearchState.textContent = `${candidateSourceStateLabel(
      search.sourceState,
    )} · ${searchCount} 条线索`;
    renderCandidatePostList(
      elements.candidateSearchList,
      search,
      "当前缓存没有该团的关键词搜索线索。",
    );
  }

  function clearCandidateEvidence() {
    elements.candidateEvidenceState.textContent = "当前筛选无结果";
    elements.candidateProfileState.textContent = "—";
    elements.candidateProfileAvatar.onerror = null;
    elements.candidateProfileAvatar.hidden = true;
    elements.candidateProfileAvatar.removeAttribute("src");
    elements.candidateProfileAvatar.alt = "";
    elements.candidateProfileAvatarFallback.hidden = false;
    elements.candidateProfileAvatarState.textContent = "暂无本地候选头像";
    elements.candidateProfileAvatarNote.textContent =
      "当前筛选范围内没有团体。";
    elements.candidateProfileGate.textContent = "—";
    elements.candidateProfileName.textContent = "—";
    elements.candidateProfileFollowers.textContent = "—";
    elements.candidateProfileObserved.textContent = "—";
    elements.candidateProfileBio.textContent = "当前筛选范围内没有团体。";
    elements.candidateProfileLink.hidden = true;
    setLink(elements.candidateProfileLink, null, "", "当前筛选无候选主页");
    elements.candidateTimelineState.textContent = "—";
    renderCandidatePostList(
      elements.candidateTimelineList,
      null,
      "当前筛选范围内没有团体。",
    );
    elements.candidateSearchState.textContent = "—";
    renderCandidatePostList(
      elements.candidateSearchList,
      null,
      "当前筛选范围内没有团体。",
    );
  }

  function updateDetails(group) {
    const placement = normalizedStylePlacement(group);
    const editorialStyle = normalizedEditorialStyle(group);
    elements.detailIndex.textContent = `NO. ${String(group.sourceOrder).padStart(3, "0")}`;
    elements.detailStatus.textContent =
      group.status || (group.isActive ? "确认存续" : "状态待核实");
    elements.detailStatus.classList.toggle("is-active", group.isActive);
    elements.detailName.textContent = group.name;
    elements.detailHandle.textContent = [group.handle, group.profileDisplayName]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(" · ");
    elements.detailFollowers.textContent = group.followersKnown
      ? followersLabel(group)
      : "待核实（不参与横轴排序）";
    elements.detailFoundingRegion.textContent = formatRegionSlot(
      group,
      "founding",
    );
    elements.detailActivityRegion.textContent = formatRegionSlot(
      group,
      "activity",
    );
    elements.detailStyle.textContent = strictMusicLabel(group);
    elements.detailBand.textContent = placement.comparable
      ? `${placement.label} · 可纵向比较`
      : `${placement.label} · 仅分类`;
    elements.detailEditorialStyle.textContent = editorialStyle.displayLabel;
    elements.detailEditorialStatus.textContent = `${epistemicStatusLabel(
      editorialStyle.epistemicStatus,
    )} · 置信${confidenceLabel(editorialStyle.confidence)}`;
    const profileSupplement = normalizedProfileSupplement(group);
    const profileAppliedFields = new Set(
      profileSupplement?.appliedFields || [],
    );
    elements.detailProfileSupplementRow.hidden = !profileSupplement;
    elements.detailProfileSupplement.textContent = profileSupplement
      ? `补充公开主页候选／展示口径：${profileSupplement.label}`
      : "—";
    const evidenceAfterCutoff = Boolean(
      group.evidenceDate && group.evidenceDate > data.meta.archiveCutoffDate,
    );
    elements.detailDate.textContent = group.evidenceDate
      ? `${group.evidenceDate}${evidenceAfterCutoff ? "（晚于截点，见来源）" : ""}`
      : "未记录";

    elements.detailTags.replaceChildren();
    const tags = [...(group.secondaryTags || [])];
    const confidence = group.publicReview?.profile
      ? null
      : group.confidenceNormalized;
    if (confidence?.status) tags.push(`存续信心：${confidence.status}`);
    if (confidence?.style) tags.push(`风格信心：${confidence.style}`);
    if (confidence?.overall) tags.push(`判定信心：${confidence.overall}`);
    if (group.weiboUid)
      tags.push(
        `UID 匹配：${group.uidConfidence === "medium" ? "中（候选）" : "高"}`,
      );
    if (group.fieldEvidence?.profileIdentity?.state === "blocked")
      tags.push(
        group.publicReview?.profile
          ? "历史单团身份：阻塞；企划账号已复核"
          : "身份：阻塞",
      );
    if (group.fieldEvidence?.profileIdentity?.state === "not_found")
      tags.push(
        group.publicReview?.profile
          ? "历史单团身份：未取得 UID；事务所账号已复核"
          : profileAppliedFields.has("identity")
            ? "严格主档身份：未取得 UID（展示已补充）"
            : "身份复核：未取得 UID",
      );
    tags.push(
      placement.comparable
        ? "图上位置：宽口径编辑风格主带"
        : placement.kind === "axis_out"
          ? "图上位置：宽口径轴外分类带"
          : "图上位置：未判定分类带",
    );
    const wikiState = (group.wiki || group.wikiReview)?.state;
    if (["matched", "exact_page"].includes(wikiState))
      tags.push("资料页：精确条目已绑定");
    if (wikiState === "candidate") tags.push("资料页：候选未绑定");
    if (profileSupplement) tags.push("主页：补充公开候选／展示口径");
    if (tags.length === 0) tags.push("暂无补充标签");
    tags.forEach((tag) => {
      const element = document.createElement("span");
      element.textContent = tag;
      elements.detailTags.append(element);
    });

    const publicReview = group.publicReview;
    elements.reviewUpdate.hidden = !publicReview;
    elements.reviewUpdateLinks.replaceChildren();
    elements.reviewUpdateSummary.textContent = publicReview?.summary || "";
    elements.reviewUpdateHeading.textContent = publicReview
      ? `补充复核 · ${publicReview.reviewedAt}`
      : "补充复核";
    for (const source of publicReview?.links || []) {
      const link = document.createElement("a");
      link.className = "secondary-link";
      setLink(link, source.url, `${source.label} ↗`);
      elements.reviewUpdateLinks.append(link);
    }
    const notes = [];
    if (group.profileBio) notes.push(`官号简介：${group.profileBio}`);
    if (group.notes && !publicReview?.profile)
      notes.push(`既有归档备注：${group.notes}`);
    if (group.strictMusicAxisV2?.styleReviewNote)
      notes.push(`严格音乐轴复核：${group.strictMusicAxisV2.styleReviewNote}`);
    if (!group.editorialStyle && group.styleReviewNote)
      notes.push(`既有风格复核：${group.styleReviewNote}`);
    if (editorialStyle.conclusion)
      notes.push(`宽口径风格结论：${editorialStyle.conclusion}`);
    if (editorialStyle.evidenceSummary)
      notes.push(`宽口径证据摘要：${editorialStyle.evidenceSummary}`);
    if (editorialStyle.rationale)
      notes.push(`宽口径判定理由：${editorialStyle.rationale}`);
    if (group.preferredVisual?.rationale)
      notes.push(`首选视觉说明：${group.preferredVisual.rationale}`);
    if (profileSupplement?.rationale)
      notes.push(`补充公开主页候选说明：${profileSupplement.rationale}`);
    if (profileSupplement) {
      const appliedFieldLabels = {
        identity: "UID／主页",
        followers: "粉丝量",
        displayName: "账号名称",
        profileBio: "账号简介",
        avatar: "微博官号头像",
      };
      const appliedLabels = profileSupplement.appliedFields
        .map((field) => appliedFieldLabels[field])
        .filter(Boolean);
      notes.push(
        `严格主档保留补充前原值；本页仅将${appliedLabels.join("、") || "已列字段"}按独立展示补充呈现。`,
      );
    }
    (group.dataWarnings || [])
      .filter(
        (warning) =>
          !isSupersededProfileWarning(warning, group, profileSupplement),
      )
      .forEach((warning) => notes.push(`数据提示：${warning}`));
    if (!group.weiboUid)
      notes.push(
        "未取得数字 UID，主页按钮使用按官号名生成的备用路径，跳转结果需人工复核。",
      );
    if (group.uidConfidence === "medium")
      notes.push(
        "数字 UID 为中置信候选；对应粉丝量、头像和主页应在外部使用前人工复核。",
      );
    if (
      group.fieldEvidence?.followers?.decisionNote &&
      group.fieldEvidence.followers.browserRawDisplay !==
        group.fieldEvidence.followers.rawDisplay
    ) {
      const followerReviewLabel = publicReview?.profile
        ? "历史严格单团粉丝量复核（企划账号已补充）"
        : profileAppliedFields.has("followers")
          ? "严格主档粉丝量复核（补充前）"
          : "粉丝量复核";
      notes.push(
        `${followerReviewLabel}：${group.fieldEvidence.followers.decisionNote}`,
      );
    }
    if (evidenceAfterCutoff && !publicReview?.status)
      notes.push(
        "该日期晚于归档截点，通常表示截点前已公开的未来行程；请结合备注与来源判断，不应解释为截点后采集。",
      );
    if (group.profileCoverPath) {
      notes.push(
        group.profileCoverReviewNote ||
          "当前图像来自微博官号背景，海报完整性尚待核验。",
      );
    } else if (
      group.fieldEvidence?.profileCover?.state === "not_found" &&
      group.profileCoverReviewNote
    ) {
      notes.push(group.profileCoverReviewNote);
    } else if (group.posterPath && !group.posterConfirmed) {
      notes.push("当前图像是团体资料封面，尚未逐人确认是否为完整成员海报。");
    }
    elements.detailNote.textContent = notes.join(" ") || "暂无补充说明。";

    renderPoster(group);
    renderCandidateEvidence(group);
    const profileIdentityBlocked =
      group.fieldEvidence?.profileIdentity?.state === "blocked" &&
      !publicReview?.profile;
    setLink(
      elements.profileLink,
      profileIdentityBlocked
        ? null
        : group.profileUrl || fallbackProfileUrl(group),
      publicReview?.profile
        ? "打开企划／事务所账号 ↗"
        : group.weiboUid
          ? "打开团体主页 ↗"
          : "按官号打开备用主页 ↗",
      profileIdentityBlocked ? "身份阻塞 · 暂不提供主页跳转" : "暂无可用主页",
    );
    setLink(
      elements.evidenceLink,
      group.evidenceUrl,
      "查看存续／一般判定来源 ↗",
    );
    const styleEvidence = group.fieldEvidence?.style;
    setLink(
      elements.styleSourceLink,
      styleEvidence?.sourceUrl,
      styleEvidence?.state === "blocked"
        ? `查看风格阻塞证据（${sourceKind(styleEvidence.sourceUrl)}） ↗`
        : `风格证据（${sourceKind(styleEvidence?.sourceUrl)}） ↗`,
      "暂无直接风格证据",
    );
    setLink(
      elements.editorialSourceLink,
      editorialStyle.sourceUrl,
      `宽口径风格依据（${sourceKind(editorialStyle.sourceUrl)}） ↗`,
      "暂无独立宽口径风格依据",
    );
    const wikiLink = wikiLinkConfig(group);
    setLink(
      elements.wikiLink,
      wikiLink.href,
      wikiLink.label,
      wikiLink.unavailableLabel,
    );
    elements.profileSupplementLink.hidden = !profileSupplement?.url;
    setLink(
      elements.profileSupplementLink,
      profileSupplement?.url,
      `补充公开主页候选（展示口径，${sourceKind(profileSupplement?.url)}） ↗`,
      "补充公开主页候选暂无安全链接",
    );
    const avatarEvidence = group.fieldEvidence?.avatar;
    const avatarSourceUrl =
      avatarEvidence?.state === "verified"
        ? avatarEvidence.sourceUrl || group.avatarSourcePage
        : group.avatarSourcePage;
    setLink(
      elements.avatarSourceLink,
      avatarSourceUrl,
      `头像来源（${sourceKind(avatarSourceUrl)}） ↗`,
      avatarEvidence?.state === "blocked" ? "头像身份阻塞" : "暂无头像来源",
    );
    const observed = formatObservedDate(group.profileObservedAt);
    const batchObserved = formatObservedDate(data.meta.profileObservedAt);
    const coverObserved = formatObservedDate(group.profileCoverObservedAt);
    const profileBasis = group.weiboUid
      ? `数字 UID ${group.uidConfidence === "medium" ? "中置信候选" : "高置信定位"}`
      : "按官号名生成备用路径 · 未验证最终可达";
    const coverObservedSuffix = coverObserved
      ? ` · 官号背景观察：${coverObserved}`
      : "";
    elements.profileObserved.textContent = observed
      ? `主页公开资料观察：${observed}（中国标准时间） · ${profileBasis}`
      : `未取得单团主页观察时间 · 采集批次：${batchObserved || "未记录"}（中国标准时间） · ${profileBasis}`;
    elements.profileObserved.textContent += coverObservedSuffix;
  }

  function selectGroup(id, options = {}) {
    const group = groupsById.get(id);
    if (!group) return;
    if (!group.isActive && state.scope === "active") applyScope("all");

    if (state.selectedId && nodeElements.has(state.selectedId)) {
      const previous = nodeElements.get(state.selectedId);
      previous.classList.remove("is-selected");
      previous.removeAttribute("aria-current");
      previous.setAttribute("tabindex", "-1");
    }

    state.selectedId = id;
    state.emptyFilterSelection = false;
    const selectedNode = nodeElements.get(id);
    selectedNode.classList.add("is-selected");
    selectedNode.setAttribute("aria-current", "true");
    selectedNode.setAttribute("tabindex", "0");
    elements.nodeLayer.append(selectedNode);
    elements.selectionRing.style.transform = `translate(${group.x}px, ${group.y}px)`;
    elements.selectionRing.classList.add("is-visible");
    updateDetails(group);
    const placement = normalizedStylePlacement(group);
    const editorialStyle = normalizedEditorialStyle(group);
    elements.chartLive.textContent = `已选择${group.name}，公开粉丝量${followersLabel(group)}，宽口径编辑风格${editorialStyle.displayLabel}，图上位置${placement.label}${placement.comparable ? "，可纵向比较" : "，仅作分类"}。严格音乐定位请在团体详情查看。`;

    if (options.focus) focusGroup(group);
    if (
      options.scrollDetail &&
      window.matchMedia("(max-width: 860px)").matches
    ) {
      elements.detailPanel.scrollIntoView({
        behavior: prefersReducedMotion.matches ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  function citySelectionKey(provinceKey, cityKey) {
    return `${provinceKey}/${cityKey}`;
  }

  function selectedRegionCount() {
    return state.selectedProvinces.size + state.selectedCities.size;
  }

  function groupMatchesRegion(group) {
    if (selectedRegionCount() === 0) return true;
    return scopedGroupRegions(group).some(
      (normalized) =>
        state.selectedProvinces.has(normalized.provinceKey) ||
        (reliableNormalizedCity(normalized) &&
          state.selectedCities.has(
            citySelectionKey(normalized.provinceKey, normalized.cityKey),
          )),
    );
  }

  function groupHasDataGap(group) {
    const editorial = normalizedEditorialStyle(group);
    const unresolvedStyle = [
      "guess",
      "uncertain",
      "weak",
      "tentative",
      "not_found",
      "blocked",
      "unreviewed",
      "unresolved",
    ].includes(editorial.epistemicStatus);
    const roleRegions = [
      group.regionPlacement?.founding,
      group.regionPlacement?.activity,
    ].filter(Boolean);
    const hasResolvedCity = roleRegions.some(reliableNormalizedCity);
    const visualMissing = group.preferredVisual?.state !== "selected";
    return (
      !group.followersKnown ||
      unresolvedStyle ||
      !hasResolvedCity ||
      visualMissing
    );
  }

  function groupMatchesEvidenceCategory(group, category) {
    const evidence = candidateEvidenceFor(group);
    const profileGate = evidence.profile?.gateState;
    if (category === "strict_uid_match") {
      return profileGate === "strict_uid_match";
    }
    if (category === "manual_review") {
      return (
        [
          "manual_required",
          "strict_rejected",
          "strict_uid_conflict",
          "source_conflict",
          "conflict",
        ].includes(profileGate) ||
        evidence.search?.gateState === "unbound_keyword_hit"
      );
    }
    if (category === "timeline_available") {
      return candidateSummaries(evidence.timeline).length > 0;
    }
    if (category === "data_gap") return groupHasDataGap(group);
    return false;
  }

  function groupMatchesEvidenceFilters(group) {
    if (state.selectedEvidenceFilters.size === 0) return true;
    return [...state.selectedEvidenceFilters].some((category) =>
      groupMatchesEvidenceCategory(group, category),
    );
  }

  function renderEvidenceFilterControls() {
    elements.evidenceFilterButtons.forEach((button) => {
      const category = button.dataset.evidenceFilter;
      const selected = state.selectedEvidenceFilters.has(category);
      button.setAttribute("aria-pressed", String(selected));
      const count = data.groups.filter(
        (group) =>
          groupMatchesBaseFilters(group) &&
          groupMatchesEvidenceCategory(group, category),
      ).length;
      const countElement = button.querySelector("[data-filter-count]");
      if (countElement) countElement.textContent = String(count);
    });
    elements.clearEvidenceFilter.hidden =
      state.selectedEvidenceFilters.size === 0;

    const profileCount = data.groups.filter(
      (group) =>
        candidateSummaries(candidateEvidenceFor(group).profile).length > 0,
    ).length;
    const avatarMaterialCount = data.groups.filter((group) => {
      const summary = candidateSummaries(
        candidateEvidenceFor(group).profile,
      )[0];
      return Boolean(
        safeCandidateAvatarPath(summary?.candidateAvatarPath, group.id),
      );
    }).length;
    const timelineCount = data.groups.filter(
      (group) =>
        candidateSummaries(candidateEvidenceFor(group).timeline).length > 0,
    ).length;
    const searchCount = data.groups.filter(
      (group) =>
        candidateSummaries(candidateEvidenceFor(group).search).length > 0,
    ).length;
    elements.apiCoverageLine.textContent = `微博 API 候选层 · 缓存快照／非实时 · 档案 ${profileCount} 团 · 本地头像 ${avatarMaterialCount} 团 · 官号动态 ${timelineCount} 团 · 搜索线索 ${searchCount} 团 · 不改写主档与图上坐标`;
  }

  function groupMatchesBaseFilters(group) {
    return (
      (state.scope === "all" || group.isActive) && groupMatchesRegion(group)
    );
  }

  function groupIsVisible(group) {
    return groupMatchesBaseFilters(group) && groupMatchesEvidenceFilters(group);
  }

  function renderRegionTree() {
    elements.regionFilterTree.replaceChildren();
    if (regionCatalog.length === 0) {
      const empty = document.createElement("p");
      empty.className = "region-tree-empty";
      empty.textContent = "此口径暂无可用地域资料";
      elements.regionFilterTree.append(empty);
      return;
    }
    regionCatalog.forEach((province, provinceIndex) => {
      const provinceItem = document.createElement("section");
      provinceItem.className = "region-province";
      const provinceRow = document.createElement("div");
      provinceRow.className = "region-province-row";
      const provinceLabel = document.createElement("label");
      provinceLabel.className = "region-option";
      const provinceCheckbox = document.createElement("input");
      provinceCheckbox.type = "checkbox";
      provinceCheckbox.id = `region-province-${provinceIndex}`;
      provinceCheckbox.checked = state.selectedProvinces.has(province.key);
      provinceCheckbox.addEventListener("change", () => {
        if (provinceCheckbox.checked) state.selectedProvinces.add(province.key);
        else state.selectedProvinces.delete(province.key);
        renderRegionChips();
        applyFilters();
      });
      const provinceName = document.createElement("span");
      provinceName.textContent = province.label;
      const provinceCount = document.createElement("small");
      provinceCount.textContent = String(province.count);
      provinceLabel.append(provinceCheckbox, provinceName, provinceCount);
      provinceRow.append(provinceLabel);

      const cityList = document.createElement("div");
      cityList.className = "region-city-list";
      cityList.id = `region-cities-${provinceIndex}`;
      const expanded = state.expandedProvinces.has(province.key);
      cityList.hidden = !expanded;
      if (province.cities.length > 0) {
        const expandButton = document.createElement("button");
        expandButton.type = "button";
        expandButton.className = "region-expand-button";
        expandButton.setAttribute("aria-expanded", String(expanded));
        expandButton.setAttribute("aria-controls", cityList.id);
        expandButton.setAttribute(
          "aria-label",
          `${expanded ? "收起" : "展开"}${province.label}城市`,
        );
        expandButton.textContent = expanded ? "−" : "+";
        expandButton.addEventListener("click", () => {
          if (expanded) state.expandedProvinces.delete(province.key);
          else state.expandedProvinces.add(province.key);
          renderRegionTree();
          const updatedButton = elements.regionFilterTree.querySelector(
            `[aria-controls="${cityList.id}"]`,
          );
          updatedButton?.focus();
        });
        provinceRow.append(expandButton);
      }
      provinceItem.append(provinceRow);

      province.cities.forEach((city, cityIndex) => {
        const cityLabel = document.createElement("label");
        cityLabel.className = "region-option region-city-option";
        const cityCheckbox = document.createElement("input");
        cityCheckbox.type = "checkbox";
        cityCheckbox.id = `region-city-${provinceIndex}-${cityIndex}`;
        const selectionKey = citySelectionKey(province.key, city.key);
        cityCheckbox.checked = state.selectedCities.has(selectionKey);
        cityCheckbox.addEventListener("change", () => {
          if (cityCheckbox.checked) state.selectedCities.add(selectionKey);
          else state.selectedCities.delete(selectionKey);
          renderRegionChips();
          applyFilters();
        });
        const cityName = document.createElement("span");
        cityName.textContent = city.label;
        const cityCount = document.createElement("small");
        cityCount.textContent = String(city.count);
        cityLabel.append(cityCheckbox, cityName, cityCount);
        cityList.append(cityLabel);
      });
      provinceItem.append(cityList);
      elements.regionFilterTree.append(provinceItem);
    });
  }

  function renderRegionChips() {
    elements.regionChips.replaceChildren();
    const chips = [];
    allRegionCatalog.forEach((province) => {
      if (state.selectedProvinces.has(province.key)) {
        chips.push({
          label: province.label,
          remove: () => state.selectedProvinces.delete(province.key),
        });
      }
      province.cities.forEach((city) => {
        const selectionKey = citySelectionKey(province.key, city.key);
        if (state.selectedCities.has(selectionKey)) {
          chips.push({
            label: `${province.label} · ${city.label}`,
            remove: () => state.selectedCities.delete(selectionKey),
          });
        }
      });
    });
    chips.forEach((chip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "region-chip";
      button.setAttribute("aria-label", `移除地域条件：${chip.label}`);
      button.textContent = `${chip.label} ×`;
      button.addEventListener("click", () => {
        chip.remove();
        renderRegionTree();
        renderRegionChips();
        applyFilters();
        elements.regionFilterToggle.focus();
      });
      elements.regionChips.append(button);
    });
    elements.regionChipsBar.hidden = chips.length === 0;
    elements.clearRegionPopover.disabled = chips.length === 0;
  }

  function setRegionPopover(open) {
    if (open) closeSearchResults();
    elements.regionFilterPopover.hidden = !open;
    elements.regionFilterToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      const firstInput = elements.regionFilterPopover.querySelector(
        'input[name="region-scope"]:checked',
      );
      firstInput?.focus();
    }
  }

  function applyRegionScope(scope) {
    if (!["any", "founding", "activity"].includes(scope)) return;
    state.regionScope = scope;
    regionCatalog = buildRegionCatalog(scope);
    elements.regionScopeInputs.forEach((input) => {
      input.checked = input.value === scope;
    });
    renderRegionTree();
    renderRegionChips();
    applyFilters();
  }

  function clearRegionSelection() {
    state.selectedProvinces.clear();
    state.selectedCities.clear();
    renderRegionTree();
    renderRegionChips();
    applyFilters();
  }

  function clearFilteredSelection() {
    const selected = nodeElements.get(state.selectedId);
    selected?.classList.remove("is-selected");
    selected?.removeAttribute("aria-current");
    selected?.setAttribute("tabindex", "-1");
    state.selectedId = null;
    state.emptyFilterSelection = true;
    elements.selectionRing.classList.remove("is-visible");
    elements.detailIndex.textContent = "FILTER / 0";
    elements.detailStatus.textContent = "筛选无结果";
    elements.detailStatus.classList.remove("is-active");
    elements.detailName.textContent = "当前筛选无匹配团体";
    elements.detailHandle.textContent =
      "调整地域、资料状态或显示范围后再选择团体";
    [
      elements.detailFollowers,
      elements.detailFoundingRegion,
      elements.detailActivityRegion,
      elements.detailStyle,
      elements.detailBand,
      elements.detailEditorialStyle,
      elements.detailEditorialStatus,
      elements.detailDate,
    ].forEach((element) => {
      element.textContent = "—";
    });
    elements.detailProfileSupplementRow.hidden = true;
    elements.reviewUpdate.hidden = true;
    elements.reviewUpdateSummary.textContent = "";
    elements.reviewUpdateLinks.replaceChildren();
    elements.detailTags.replaceChildren();
    elements.detailNote.textContent =
      "地域条件内部取并集；资料状态内部取并集，不同筛选维度之间取交集。";
    elements.detailPoster.onerror = null;
    elements.detailPoster.hidden = true;
    elements.detailPoster.removeAttribute("src");
    elements.detailPoster.alt = "";
    elements.posterFallback.hidden = false;
    elements.posterInitials.textContent = "—";
    elements.posterStage.classList.remove("is-poster-art", "is-cover-visual");
    elements.posterLabel.textContent = "暂无匹配团体";
    [
      elements.profileLink,
      elements.evidenceLink,
      elements.styleSourceLink,
      elements.editorialSourceLink,
      elements.wikiLink,
      elements.profileSupplementLink,
      elements.avatarSourceLink,
      elements.posterSourceLink,
    ].forEach((element) => setLink(element, null, "", "当前筛选无可用链接"));
    elements.profileSupplementLink.hidden = true;
    elements.profileObserved.textContent = "当前筛选范围内没有团体。";
    clearCandidateEvidence();
  }

  function applyFilters() {
    renderEvidenceFilterControls();
    const visibleGroups = [];
    data.groups.forEach((group) => {
      const visible = groupIsVisible(group);
      if (visible) visibleGroups.push(group);
      nodeElements.get(group.id)?.classList.toggle("is-filtered", !visible);
      tetherElements.get(group.id)?.classList.toggle("is-filtered", !visible);
    });

    const visibleCount = visibleGroups.length;
    const visibleFollowers = visibleGroups.filter(
      (group) => group.followersKnown,
    ).length;
    const visibleHighUid = visibleGroups.filter(
      (group) => group.weiboUid && group.uidConfidence === "high",
    ).length;
    const visibleMediumUid = visibleGroups.filter(
      (group) => group.weiboUid && group.uidConfidence === "medium",
    ).length;
    const visibleAvatars = visibleGroups.filter((group) =>
      preferredAvatarPath(group),
    ).length;
    const visibleProfileCovers = visibleGroups.filter((group) =>
      safeAssetPath(group.profileCoverPath, "profile-covers"),
    ).length;
    const evidenceFilterCount = state.selectedEvidenceFilters.size;
    elements.coverageLine.textContent = `已显示 ${visibleCount}/${data.groups.length}${evidenceFilterCount ? ` · 资料筛选 ${evidenceFilterCount} 项` : ""} · 当前粉丝量 ${visibleFollowers}（UID 高置信 ${visibleHighUid} / 中置信 ${visibleMediumUid}） · 头像 ${visibleAvatars} · 官号背景 ${visibleProfileCovers}`;
    const regionCount = selectedRegionCount();
    const regionScopeLabel = {
      any: "任一",
      founding: "建团城市",
      activity: "主要活动城市",
    }[state.regionScope];
    elements.regionFilterSummary.textContent = regionCount
      ? `${regionScopeLabel} · ${regionCount} 项 · ${visibleCount} 团`
      : `${regionScopeLabel} · 全部地域 · ${visibleCount} 团`;
    elements.regionMatchCount.textContent = `${regionScopeLabel}口径 · 当前范围匹配 ${visibleCount} 团`;

    const hasSearchQuery = Boolean(elements.searchInput.value.trim());
    if (hasSearchQuery) {
      const keepSearchResultsOpen = !elements.searchResults.hidden;
      renderSearchResults(elements.searchInput.value, {
        open: keepSearchResultsOpen,
      });
    }
    const selected = groupsById.get(state.selectedId);
    if (selected && !groupIsVisible(selected)) {
      const replacement = hasSearchQuery
        ? state.searchMatches[0]
        : data.groups.find(groupIsVisible);
      if (replacement) selectGroup(replacement.id);
      else clearFilteredSelection();
    } else if (!selected && state.emptyFilterSelection) {
      const replacement = hasSearchQuery
        ? state.searchMatches[0]
        : data.groups.find(groupIsVisible);
      if (replacement) selectGroup(replacement.id);
    }
  }

  function applyScope(scope) {
    state.scope = scope;
    elements.scopeButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scope === scope),
      );
    });

    applyFilters();
  }

  function renderSearchResults(query, { open = true } = {}) {
    const trimmedQuery = query.trim().slice(0, 120);
    elements.clearSearch.hidden = trimmedQuery.length === 0;
    if (!trimmedQuery) {
      closeSearchResults();
      return;
    }

    state.searchMatches = data.groups
      .map((group) => ({ group, score: scoreCandidate(group, trimmedQuery) }))
      .filter((entry) => entry.score > 0 && groupIsVisible(entry.group))
      .sort(
        (a, b) =>
          b.score - a.score || a.group.sourceOrder - b.group.sourceOrder,
      )
      .slice(0, 10)
      .map((entry) => entry.group);
    state.activeSearchIndex = state.searchMatches.length > 0 ? 0 : -1;
    elements.searchResults.replaceChildren();

    if (state.searchMatches.length === 0) {
      const item = document.createElement("li");
      item.className = "empty-result";
      item.setAttribute("role", "option");
      item.setAttribute("aria-disabled", "true");
      item.textContent = "当前显示范围与地域中没有匹配团体";
      elements.searchResults.append(item);
    } else {
      state.searchMatches.forEach((group, index) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        button.tabIndex = -1;
        button.id = `search-option-${group.id}`;
        button.setAttribute("role", "option");
        button.setAttribute(
          "aria-selected",
          String(index === state.activeSearchIndex),
        );
        item.setAttribute("role", "presentation");

        const avatar = document.createElement("span");
        avatar.className = "result-avatar";
        const avatarPath = preferredAvatarPath(group);
        if (avatarPath) {
          const image = document.createElement("img");
          image.src = avatarPath;
          image.alt = "";
          image.addEventListener("error", () => {
            avatar.replaceChildren(
              document.createTextNode(group.initials || "?"),
            );
          });
          avatar.append(image);
        } else {
          avatar.textContent = group.initials || "?";
        }

        const copy = document.createElement("span");
        copy.className = "result-copy";
        const name = document.createElement("strong");
        name.textContent = group.name;
        const handle = document.createElement("span");
        const normalizedRegion = normalizedGroupRegion(group);
        handle.textContent = `${group.handle || "无官号"} · ${normalizedRegion.province}${normalizedRegion.city ? `／${normalizedRegion.city}` : "／城市待核实"} · ${normalizedEditorialStyle(group).displayLabel}`;
        copy.append(name, handle);

        const meta = document.createElement("span");
        meta.className = "result-meta";
        meta.textContent = followersLabel(group);
        button.append(avatar, copy, meta);
        button.addEventListener("pointermove", () =>
          setActiveSearchIndex(index),
        );
        button.addEventListener("click", () => chooseSearchResult(index));
        item.append(button);
        elements.searchResults.append(item);
      });
    }

    elements.searchResults.hidden = !open;
    elements.searchInput.setAttribute("aria-expanded", String(open));
    if (open) syncActiveSearchOption(false);
    else elements.searchInput.removeAttribute("aria-activedescendant");
  }

  function closeSearchResults() {
    state.searchMatches = [];
    state.activeSearchIndex = -1;
    elements.searchResults.hidden = true;
    elements.searchResults.replaceChildren();
    elements.searchInput.setAttribute("aria-expanded", "false");
    elements.searchInput.removeAttribute("aria-activedescendant");
  }

  function setActiveSearchIndex(index) {
    if (state.searchMatches.length === 0) return;
    state.activeSearchIndex =
      (index + state.searchMatches.length) % state.searchMatches.length;
    syncActiveSearchOption(true);
  }

  function syncActiveSearchOption(scroll) {
    const buttons = [
      ...elements.searchResults.querySelectorAll(".search-result"),
    ];
    elements.searchInput.removeAttribute("aria-activedescendant");
    buttons.forEach((button, index) => {
      const selected = index === state.activeSearchIndex;
      button.setAttribute("aria-selected", String(selected));
      if (selected) {
        elements.searchInput.setAttribute("aria-activedescendant", button.id);
        if (scroll) button.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function chooseSearchResult(index) {
    const group = state.searchMatches[index];
    if (!group) return;
    elements.searchInput.value = group.name;
    elements.clearSearch.hidden = false;
    selectGroup(group.id, { focus: true, scrollDetail: false });
    elements.searchInput.focus({ preventScroll: true });
    closeSearchResults();
  }

  function viewportAspect() {
    const rectangle = elements.svg.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0
      ? rectangle.width / rectangle.height
      : data.world.width / data.world.height;
  }

  function fitRectangle(rectangle) {
    const aspect = viewportAspect();
    let width = rectangle.width;
    let height = rectangle.height;
    if (width / height > aspect) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
    return {
      x: rectangle.x + (rectangle.width - width) / 2,
      y: rectangle.y + (rectangle.height - height) / 2,
      width,
      height,
    };
  }

  function clampView(view) {
    const margin = 420;
    const minWidth = 560;
    const aspect = viewportAspect();
    const maxWidth = Math.max(
      data.world.width + margin * 2,
      (data.world.height + margin * 2) * aspect,
    );
    const width = Math.min(maxWidth, Math.max(minWidth, view.width));
    const height = width / aspect;
    const minX = -margin;
    const maxX = data.world.width + margin - width;
    const minY = -margin;
    const maxY = data.world.height + margin - height;
    return {
      x:
        maxX < minX
          ? (data.world.width - width) / 2
          : Math.min(maxX, Math.max(minX, view.x)),
      y:
        maxY < minY
          ? (data.world.height - height) / 2
          : Math.min(maxY, Math.max(minY, view.y)),
      width,
      height,
    };
  }

  function setView(view) {
    state.view = clampView(view);
    const { x, y, width, height } = state.view;
    elements.svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  }

  function animateView(targetView) {
    const target = clampView(targetView);
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    if (prefersReducedMotion.matches) {
      setView(target);
      return;
    }

    const start = { ...state.view };
    const startTime = performance.now();
    const duration = 520;
    const easeOut = (value) => 1 - (1 - value) ** 4;

    const frame = (currentTime) => {
      const progress = Math.min(1, (currentTime - startTime) / duration);
      const eased = easeOut(progress);
      setView({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        width: start.width + (target.width - start.width) * eased,
        height: start.height + (target.height - start.height) * eased,
      });
      if (progress < 1) state.animationFrame = requestAnimationFrame(frame);
    };
    state.animationFrame = requestAnimationFrame(frame);
  }

  function fitWorld(animate = true) {
    const target = fitRectangle({
      x: -120,
      y: -100,
      width: data.world.width + 240,
      height: data.world.height + 200,
    });
    if (animate) animateView(target);
    else setView(target);
  }

  function focusGroup(group) {
    const target = fitRectangle({
      x: group.x - 540,
      y: group.y - 330,
      width: 1080,
      height: 660,
    });
    animateView(target);
  }

  function zoomBy(scale, anchor) {
    const current = state.view;
    const point = anchor || {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    };
    const newWidth = current.width * scale;
    const newHeight = current.height * scale;
    const ratioX = (point.x - current.x) / current.width;
    const ratioY = (point.y - current.y) / current.height;
    animateView({
      x: point.x - newWidth * ratioX,
      y: point.y - newHeight * ratioY,
      width: newWidth,
      height: newHeight,
    });
  }

  function svgPoint(clientX, clientY) {
    const matrix = elements.svg.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }

  function bindInteractions() {
    elements.scopeButtons.forEach((button) => {
      button.addEventListener("click", () => applyScope(button.dataset.scope));
    });

    elements.searchInput.addEventListener("input", () =>
      renderSearchResults(elements.searchInput.value),
    );
    elements.searchInput.addEventListener("focus", () => {
      if (elements.searchInput.value.trim())
        renderSearchResults(elements.searchInput.value);
    });
    elements.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSearchIndex(state.activeSearchIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSearchIndex(state.activeSearchIndex - 1);
      } else if (event.key === "Enter" && state.activeSearchIndex >= 0) {
        event.preventDefault();
        chooseSearchResult(state.activeSearchIndex);
      } else if (event.key === "Escape") {
        closeSearchResults();
      }
    });
    elements.clearSearch.addEventListener("click", () => {
      elements.searchInput.value = "";
      elements.clearSearch.hidden = true;
      closeSearchResults();
      elements.searchInput.focus();
    });
    elements.regionFilterToggle.addEventListener("click", () => {
      setRegionPopover(elements.regionFilterPopover.hidden);
    });
    elements.regionScopeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) applyRegionScope(input.value);
      });
    });
    elements.regionFilterPopover.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRegionPopover(false);
        elements.regionFilterToggle.focus();
      }
    });
    elements.clearRegionFilter.addEventListener("click", () => {
      clearRegionSelection();
      elements.regionFilterToggle.focus();
    });
    elements.clearRegionPopover.addEventListener("click", () => {
      clearRegionSelection();
      setRegionPopover(false);
      elements.regionFilterToggle.focus();
    });
    elements.evidenceFilterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const category = button.dataset.evidenceFilter;
        if (state.selectedEvidenceFilters.has(category)) {
          state.selectedEvidenceFilters.delete(category);
        } else {
          state.selectedEvidenceFilters.add(category);
        }
        applyFilters();
      });
    });
    elements.clearEvidenceFilter.addEventListener("click", () => {
      state.selectedEvidenceFilters.clear();
      applyFilters();
      elements.evidenceFilterButtons[0]?.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".search-control")) closeSearchResults();
      if (!event.target.closest(".region-filter")) setRegionPopover(false);
    });
    document.addEventListener("focusin", (event) => {
      if (!event.target.closest(".search-control")) closeSearchResults();
      if (!event.target.closest(".region-filter")) setRegionPopover(false);
    });

    elements.zoomIn.addEventListener("click", () => zoomBy(0.72));
    elements.zoomOut.addEventListener("click", () => zoomBy(1.38));
    elements.zoomFit.addEventListener("click", () => fitWorld(true));
    elements.svg.addEventListener(
      "wheel",
      (event) => {
        if (window.matchMedia("(max-width: 860px)").matches && !event.ctrlKey)
          return;
        event.preventDefault();
        if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
        const anchor = svgPoint(event.clientX, event.clientY);
        if (!anchor) return;
        const scale = Math.exp(
          Math.min(120, Math.max(-120, event.deltaY)) * 0.0018,
        );
        const current = state.view;
        const newWidth = current.width * scale;
        const newHeight = current.height * scale;
        const ratioX = (anchor.x - current.x) / current.width;
        const ratioY = (anchor.y - current.y) / current.height;
        setView({
          x: anchor.x - newWidth * ratioX,
          y: anchor.y - newHeight * ratioY,
          width: newWidth,
          height: newHeight,
        });
      },
      { passive: false },
    );

    elements.svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".idol-node")) return;
      if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        view: { ...state.view },
      };
      state.dragMoved = false;
      elements.svg.setPointerCapture(event.pointerId);
      elements.svg.classList.add("is-dragging");
    });
    elements.svg.addEventListener("pointermove", (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) return;
      const rectangle = elements.svg.getBoundingClientRect();
      const deltaX = event.clientX - state.drag.startX;
      const deltaY = event.clientY - state.drag.startY;
      if (Math.hypot(deltaX, deltaY) > 4) state.dragMoved = true;
      setView({
        x:
          state.drag.view.x -
          (deltaX / rectangle.width) * state.drag.view.width,
        y:
          state.drag.view.y -
          (deltaY / rectangle.height) * state.drag.view.height,
        width: state.drag.view.width,
        height: state.drag.view.height,
      });
    });
    const endDrag = (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) return;
      if (elements.svg.hasPointerCapture(event.pointerId))
        elements.svg.releasePointerCapture(event.pointerId);
      state.drag = null;
      elements.svg.classList.remove("is-dragging");
      window.setTimeout(() => {
        state.dragMoved = false;
      }, 0);
    };
    elements.svg.addEventListener("pointerup", endDrag);
    elements.svg.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", () => {
      window.clearTimeout(bindInteractions.resizeTimer);
      bindInteractions.resizeTimer = window.setTimeout(
        () => setView(state.view),
        90,
      );
    });
  }

  configureWorld();
  renderBands();
  renderAxes();
  renderNodes();
  renderRegionTree();
  renderRegionChips();
  renderEvidenceFilterControls();
  bindInteractions();
  applyScope("active");
  requestAnimationFrame(() => {
    fitWorld(false);
    const preferred =
      data.groups.find((group) => group.name === "惑星VORTEX") ||
      data.groups.find((group) => group.isActive);
    if (preferred) selectGroup(preferred.id);
  });
})();

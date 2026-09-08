import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** @typedef {import('../src/catalog/model').GroupCatalog} GroupCatalog */

// 生成与浏览器共用真实验证器；内存编译不产生额外运行时依赖或生成文件。
const modelSource = await readFile(
  new URL("../src/catalog/model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(modelSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const model = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

async function ordinaryPath(root, relative) {
  const base = await realpath(root);
  let current = base;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
    ) {
      throw new Error(
        `索引来源或素材必须为普通文件，禁止符号链接：${relative}`,
      );
    }
  }
  const resolved = path.relative(base, await realpath(current));
  if (resolved.startsWith("..") || path.isAbsolute(resolved))
    throw new Error(`索引资源越界：${relative}`);
  return current;
}

function region(slot) {
  return { province: slot?.province ?? null, city: slot?.city ?? null };
}

function avatar(group, officialUrl) {
  const src = group.weiboAvatarPath || group.avatarPath;
  if (!src) return null;
  if (!model.isLocalCatalogImagePath(src))
    throw new Error(`${group.id}: 非法头像路径`);
  const supplement = group.editorialProfileSupplement;
  const reviewed = group.publicReview?.profile;
  const accepted =
    supplement?.state === "accepted_candidate" &&
    supplement.appliedFields?.includes("avatar") &&
    supplement.avatarAssetPath === src;
  if (
    src.startsWith("assets/weibo-api-avatar-candidates/") &&
    !accepted &&
    reviewed?.avatarAssetPath !== src
  ) {
    throw new Error(`${group.id}: 候选头像没有正式采用依据`);
  }
  return {
    src,
    alt: `${group.name}的资料头像`,
    label: "已收录资料头像；不证明当前阵容或转载授权",
    sourceUrl:
      reviewed?.avatarAssetPath === src
        ? (reviewed.sourceUrl ?? null)
        : accepted
          ? (supplement.avatarSourceUrl ?? null)
          : (officialUrl ?? group.avatarSourcePage ?? null),
  };
}

function project(group) {
  const review = group.publicReview;
  const style = group.editorialStyle;
  const officialUrl =
    review?.profile?.sourceUrl ??
    (group.fieldEvidence?.profileIdentity?.state === "blocked"
      ? null
      : (group.profileUrl ?? null));
  const wiki = review?.wiki ?? group.wiki;
  const wikiUrl = wiki?.state === "exact_page" ? (wiki.pageUrl ?? null) : null;
  const selected =
    group.preferredVisual?.state === "selected" ? group.preferredVisual : null;
  const visual = selected
    ? {
        src: selected.assetPath,
        alt: `${group.name}的资料图`,
        label:
          selected.kind === "brand_visual"
            ? "品牌资料图；不是当前成员海报；未取得转载授权"
            : "资料图；未核验当前阵容及全员完整性；未取得转载授权",
        sourceUrl: selected.sourceUrl ?? null,
      }
    : null;
  const styleNote =
    style?.epistemicStatus === "uncertain"
      ? "公开线索不足或冲突，风格暂未判定。"
      : style?.epistemicStatus === "guess"
        ? "基于有限公开线索的编辑猜测，不能视为官宣音乐定位。"
        : "沿用已收录资料的编辑分类；不代表连续测量，也不等同于经严格核验的官宣音乐定位。";
  const sources = [];
  const add = (label, url, observedAt = null, note = "") => {
    if (url !== null && url !== undefined)
      sources.push({ label, url, observedAt, note });
  };
  add(
    review?.profile ? "已复核账号主页" : "已收录账号主页",
    officialUrl,
    review?.profile?.observedAt ?? group.profileObservedAt ?? null,
    review?.profile
      ? "账号范围与原组合的关系请参见补充复核说明。"
      : "资料时点的已收录主页；当前账号及团体状态仍以最新来源为准。",
  );
  add(
    wiki?.label || "社区 Wiki 团体资料",
    wikiUrl,
    wiki?.observedAt ?? null,
    wiki?.scopeNote || "社区整理的历史资料，不等同于官方当前公告。",
  );
  add(
    "原始清单资料来源",
    group.evidenceUrl,
    null,
    "资料日期可能是演出或证据日期，不作为本次观察时间。",
  );
  add("编辑风格参考", style?.sourceUrl, null, styleNote);
  add(
    "资料图来源",
    visual?.sourceUrl,
    selected?.observedAt ?? null,
    visual?.label || "",
  );
  const image = avatar(group, officialUrl);
  const supplement = group.editorialProfileSupplement;
  const avatarObservedAt = !image
    ? null
    : review?.profile?.avatarAssetPath === image.src
      ? (review.profile.avatarObservedAt ?? null)
      : supplement?.state === "accepted_candidate" &&
          supplement.avatarAssetPath === image?.src
        ? (supplement.observedAt ?? null)
        : group.fieldEvidence?.avatar?.assetPath === image?.src
          ? (group.fieldEvidence.avatar.observedAt ?? null)
          : null;
  add("资料头像来源", image?.sourceUrl, avatarObservedAt, image?.label || "");
  if (review?.summary) {
    // 链接仅提供相关资料；尤其不能把用户确认的解散状态包装成 Wiki 或官宣结论。
    add(
      "补充复核说明（相关资料链接）",
      officialUrl ?? wikiUrl ?? group.evidenceUrl,
      null,
      `${review.reviewedAt ? `复核记录日期：${review.reviewedAt}。` : ""}${review.summary}`,
    );
  }
  for (const link of review?.links ?? [])
    add(link.label, link.url, null, "补充复核收录的相关公开链接。");
  return {
    id: group.id,
    name: group.name,
    handle: group.handle,
    aliases: review?.aliases ?? [],
    status: group.status,
    isActive: group.isActive,
    founding: region(group.regionPlacement?.founding),
    activity: region(group.regionPlacement?.activity),
    styleLabel: style?.displayLabel ?? "风格暂未判定",
    styleState:
      !style || style.epistemicStatus === "uncertain"
        ? "uncertain"
        : "editorial",
    styleNote,
    tags: group.secondaryTags ?? [],
    avatar: image,
    visual,
    officialUrl,
    wikiUrl,
    followers:
      group.followersValue == null
        ? null
        : {
            display:
              typeof (group.followersText ?? group.followersDisplay) !==
              "string"
                ? null
                : `${group.followersText ?? group.followersDisplay}${review?.entityKind?.includes("事务所") ? "（事务所账号）" : ""}`,
            value: group.followersValue,
            observedAt: group.profileObservedAt ?? null,
          },
    sources,
  };
}

/** 从正式展示对象白名单投影；固定来源产生固定结果，不访问网络或候选原始响应。
 * @param {string} root
 * @returns {Promise<GroupCatalog>}
 */
export async function buildGroupCatalog(root) {
  const input = await readFile(await ordinaryPath(root, "data.js"), "utf8");
  const match = /^\s*window\.IDOL_MAP_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/u.exec(
    input,
  );
  if (!match) throw new Error("data.js 必须为单一正式数据赋值");
  const source = JSON.parse(match[1]);
  if (
    !Array.isArray(source.groups) ||
    !Number.isSafeInteger(source.meta?.population?.total) ||
    source.meta.population.total !== source.groups.length
  )
    throw new Error("来源条数与清单声明不一致");
  const catalog = {
    schemaVersion: "idol-catalog-v1",
    archiveDate: source.meta.archiveCutoffDate,
    groups: source.groups.map(project),
  };
  const result = model.validateCatalog(catalog);
  if (!result.valid)
    throw new Error(`团体索引验证失败：\n${result.errors.join("\n")}`);
  for (const src of new Set(
    catalog.groups.flatMap((group) =>
      [group.avatar?.src, group.visual?.src].filter(Boolean),
    ),
  )) {
    await ordinaryPath(root, src);
  }
  return result.data;
}

/** 仅集成构建调用；所有验证成功后才写入普通脚本产物。
 * @param {string} root
 * @returns {Promise<void>}
 */
export async function writeGroupCatalog(root) {
  const catalog = await buildGroupCatalog(root);
  const assets = path.join(root, "assets");
  await mkdir(assets, { recursive: true });
  if ((await lstat(assets)).isSymbolicLink())
    throw new Error("索引输出目录禁止符号链接");
  const target = path.join(assets, "groups-data.js");
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("索引输出必须为普通文件");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const json = JSON.stringify(catalog).replace(
    /[<>\u2028\u2029]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  await writeFile(target, `window.IDOL_GROUPS_DATA=${json};\n`, "utf8");
}

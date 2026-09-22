import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildGroupCatalog } from "./groupCatalog.mjs";
import { readEventAssets } from "./eventAssets.mjs";
import { validateMedia } from "./validateMedia.mjs";
import { writePublicFile } from "./mediaFiles.mjs";
import {
  readVerification,
  verificationSection,
} from "./prerenderVerification.mjs";

import { escapeHtml, timeHtml } from "./prerenderFormat.mjs";
export { escapeHtml } from "./prerenderFormat.mjs";
function external(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !/[\s\\]/.test(url)
      ? url
      : null;
  } catch {
    return null;
  }
}
function anchor(label, href) {
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}
function sourceLink(label, url) {
  return external(url)
    ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}
function facts(entries) {
  return `<dl>${entries.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value && typeof value === "object" && "dateTime" in value ? timeHtml(value.dateTime) : escapeHtml(value || "尚未收录")}</dd>`).join("")}</dl>`;
}
function sources(items) {
  return `<section><h2>资料来源</h2><details><summary>查看 ${items.length} 条来源与观察时间</summary><ul>${items.map((source) => `<li>${sourceLink(source.label, source.url)}<p>${source.observedAt ? `观察于 ${timeHtml(source.observedAt)}` : "观察日期尚未收录"}${source.publisher ? ` · ${escapeHtml(source.publisher)}` : ""}</p>${source.note ? `<p>${escapeHtml(source.note)}</p>` : ""}</li>`).join("")}</ul></details></section>`;
}
function media(image, manifest) {
  if (!image) return "";
  const entry = manifest.images[image.src];
  // 远程图片不自动请求：避免新增跟踪请求及脆弱的跨站依赖。
  if (!entry)
    return image.src.startsWith("assets/")
      ? (() => {
          throw new Error(`图片缺少变体：${image.src}`);
        })()
      : "";
  const variant =
    entry.variants.find((item) => item.width >= 640) ?? entry.variants.at(-1);
  return `<figure><img src="../${escapeHtml(variant.src)}" srcset="${entry.variants.map((item) => `../${escapeHtml(item.src)} ${item.width}w`).join(", ")}" sizes="(max-width: 760px) calc(100vw - 48px), 480px" width="${entry.width}" height="${entry.height}" alt="${escapeHtml(image.alt)}" decoding="async" fetchpriority="high"><figcaption>${escapeHtml(image.label || "已收录活动海报")}${image.sourceUrl ? ` · ${sourceLink("图片来源", image.sourceUrl)}` : ""} · ${anchor("查看原图", `../${image.src}`)}</figcaption></figure>`;
}
const statusLabels = {
  scheduled: "计划举行，出发前请核对官宣",
  unconfirmed: "安排尚未核实",
  postponed: "已延期，请核对新日期",
  cancelled: "已取消",
};

function documentHtml({
  title,
  description,
  relative,
  body,
  image,
  manifest,
  baseUrl,
}) {
  const canonical = new URL(relative, baseUrl).href;
  const entry = image && manifest.images[image.src];
  const shareImage = entry?.variants.at(-1);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="article"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="地下偶像资料档案"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta name="twitter:card" content="${shareImage ? "summary_large_image" : "summary"}">${shareImage ? `<meta property="og:image" content="${escapeHtml(new URL(shareImage.src, baseUrl).href)}"><meta property="og:image:width" content="${shareImage.width}"><meta property="og:image:height" content="${shareImage.height}"><meta property="og:image:alt" content="${escapeHtml(image.alt)}">` : ""}<link rel="icon" href="data:,"><link rel="stylesheet" href="../app.css"><link rel="stylesheet" href="../styles/site.css"><link rel="stylesheet" href="../assets/prerender.css"></head><body class="prerender-page"><a class="skip-link" href="#main">跳至正文</a><div class="prerender-shell"><nav class="site-nav" aria-label="主导航">${[
    ["发现", "discover.html"],
    ["团体", "groups.html"],
    ["演出", "events.html"],
    ["全国地图", "geography.html"],
    ["风格图", "index.html"],
    ["观演指南", "guide.html"],
    ["城市", "city.html"],
    ["我的关注", "favorites.html"],
  ]
    .map(([label, href]) => anchor(label, `../${href}`))
    .join(
      "",
    )}</nav><main id="main">${body}</main><footer><p>独立公益资料整理 · 非官方档案</p>${anchor("投稿纠错", "../contribute.html")} · ${anchor("关于资料口径", "../about.html")} · ${anchor("更新动态", "../updates.html")}</footer></div><script src="../assets/metrics.js" defer></script></body></html>\n`;
}

export function renderGroup(group, catalog, dataset, manifest, baseUrl) {
  const image = group.visual ?? group.avatar;
  const related = dataset.events.filter((event) =>
    event.performers.some((performer) => performer.groupId === group.id),
  );
  const description = `${group.name}的团体档案：${group.activity.city || "活动城市尚未收录"}，${group.status}。${group.styleLabel || "风格尚未核实"}。收录公开来源与相关演出。`;
  const body = `<header><p class="prerender-kicker">团体档案 · ${escapeHtml(group.id)}</p><h1>${escapeHtml(group.name)}</h1><p>${escapeHtml(group.handle)}</p><p>${anchor("返回团体列表", "../groups.html")} · ${anchor("打开交互档案与关注", `../group.html?group=${group.id}`)}</p></header><div class="prerender-lead">${media(image, manifest)}<section><h2>基本资料</h2>${facts(
    [
      ["档案状态", group.status],
      [
        "成立地区",
        [group.founding.province, group.founding.city]
          .filter(Boolean)
          .join(" · "),
      ],
      [
        "活动地区",
        [group.activity.province, group.activity.city]
          .filter(Boolean)
          .join(" · "),
      ],
      ["风格", group.styleLabel],
      ["其他名称", group.aliases.join("、")],
      ["标签", group.tags.join("、")],
      ["档案截点", { dateTime: catalog.archiveDate }],
    ],
  )}<p>${escapeHtml(group.styleNote)}</p>${group.followers ? `<p>公开关注数：${escapeHtml(group.followers.display)} · 观察日期 ${timeHtml(group.followers.observedAt)}</p>` : ""}<p>${group.officialUrl ? sourceLink("公开官号", group.officialUrl) : "公开官号尚未收录"}${group.wikiUrl ? ` · ${sourceLink("百科资料", group.wikiUrl)}` : ""}</p></section></div><section><h2>已收录相关活动</h2><p>以下包含历史日期；日期已过不代表活动已举办。资料覆盖不完整，出发前核对官宣。</p>${related.length ? `<ul>${related.map((event) => `<li>${anchor(event.title, `../events/${event.id}.html`)}<p>${timeHtml(event.date)} · ${escapeHtml(event.city || "城市尚未核实")} · ${escapeHtml(statusLabels[event.status])}</p></li>`).join("")}</ul>` : "<p>尚未收录可关联的活动。</p>"}</section>${sources(group.sources)}`;
  return documentHtml({
    title: `${group.name} · 团体档案`,
    description,
    relative: `groups/${group.id}.html`,
    body,
    image,
    manifest,
    baseUrl,
  });
}

export function renderEvent(event, dataset, manifest, baseUrl, verification) {
  const description = `${event.title}，${event.date}，${event.city || "城市尚未核实"}，${event.venue || "场地尚未核实"}。${statusLabels[event.status]}。`;
  const body = `<header><p class="prerender-kicker">演出档案 · ${escapeHtml(event.date)}</p><h1>${escapeHtml(event.title)}</h1><p>${escapeHtml(statusLabels[event.status])}</p><p>${anchor("返回演出列表", `../events.html?period=all#${event.id}`)}</p></header><div class="prerender-lead">${media(event.poster, manifest)}<section><h2>演出安排</h2>${facts(
    [
      [
        "日期",
        verification?.field(event, "date") ?? `${event.date}（尚未核实）`,
      ],
      [
        "地区",
        [event.province, event.city].filter(Boolean).join(" · ") || "尚未核实",
      ],
      [
        "场地",
        verification?.field(event, "venue") ?? event.venue ?? "尚未核实",
      ],
      [
        "地址",
        verification?.field(event, "address") ?? event.address ?? "尚未核实",
      ],
      [
        "入场",
        verification?.field(event, "opensAt") ?? event.opensAt ?? "尚未核实",
      ],
      [
        "开演",
        verification?.field(event, "startsAt") ?? event.startsAt ?? "尚未核实",
      ],
      [
        "结束",
        verification?.field(event, "endsAt") ?? event.endsAt ?? "尚未核实",
      ],
      ["资料更新", { dateTime: dataset.updatedAt }],
    ],
  )}<p>时刻均为 UTC+8。日期已过不代表活动已举办；团体出演时段不能代替整场开演时间。</p></section></div><section><h2>已收录出演者</h2><ul>${event.performers.map((performer) => `<li>${performer.groupId ? anchor(performer.name, `../groups/${performer.groupId}.html`) : escapeHtml(performer.name)}</li>`).join("")}</ul><p>${event.performers.length ? "仅展示资料中可核对的部分阵容。" : "尚未收录可核对的出演阵容。"}</p></section><section><h2>活动说明</h2><p class="prerender-notes">${escapeHtml(event.notes || "尚未收录补充说明。")}</p></section>${sources(event.sources)}`;
  return documentHtml({
    title: `${event.title} · ${event.date}演出档案`,
    description,
    relative: `events/${event.id}.html`,
    body: body + verificationSection(event, verification),
    image: event.poster,
    manifest,
    baseUrl,
  });
}

/** 仅写 outputRoot 内的精确文件；旧 HTML 与脚本均不修改。 */
export async function generatePrerender(
  root,
  { outputRoot = root, baseUrl = "https://idol.hi-veblen.com/" } = {},
) {
  if (!external(baseUrl) || new URL(baseUrl).search || new URL(baseUrl).hash)
    throw new Error("规范站点地址必须为无查询与锚点的 HTTP(S) 地址");
  baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const [catalog, { dataset }, { manifest }] = await Promise.all([
    buildGroupCatalog(root),
    readEventAssets(root),
    validateMedia(root),
  ]);
  const verification = await readVerification(root, dataset.events);
  await mkdir(outputRoot, { recursive: true });
  const files = [];
  const write = async (relative, value) => {
    await writePublicFile(outputRoot, relative, value);
    files.push(relative);
  };
  for (const group of catalog.groups) {
    await write(
      `groups/${group.id}.html`,
      renderGroup(group, catalog, dataset, manifest, baseUrl),
    );
    await write(
      `assets/page-data/groups/${group.id}.json`,
      JSON.stringify({
        schemaVersion: "idol-group-page-v1",
        catalog: { ...catalog, groups: [group] },
        events: {
          ...dataset,
          events: dataset.events.filter((event) =>
            event.performers.some(
              (performer) => performer.groupId === group.id,
            ),
          ),
        },
      }),
    );
  }
  for (const event of dataset.events)
    await write(
      `events/${event.id}.html`,
      renderEvent(event, dataset, manifest, baseUrl, verification),
    );
  for (const [kind, label, entries] of [
    [
      "groups",
      "团体静态索引",
      catalog.groups.map((group) => [group.id, group.name]),
    ],
    [
      "events",
      "演出静态索引",
      dataset.events.map((event) => [
        event.id,
        `${event.date} · ${event.title}`,
      ]),
    ],
  ]) {
    await write(
      `${kind}/index.html`,
      documentHtml({
        title: `${label} · 地下偶像资料档案`,
        description: `全部已收录${kind === "groups" ? "团体" : "演出"}的独立档案链接；资料覆盖不完整。`,
        relative: `${kind}/index.html`,
        body: `<header><p class="prerender-kicker">资料目录</p><h1>${label}</h1><p>共 ${entries.length} 条已收录档案，收录不代表实时核验或完整覆盖。</p></header><ul>${entries.map(([id, name]) => `<li>${anchor(name, `${id}.html`)}</li>`).join("")}</ul>`,
        image: null,
        manifest,
        baseUrl,
      }),
    );
  }
  await write(
    "assets/page-data/catalog.json",
    JSON.stringify({
      ...catalog,
      groups: catalog.groups.map((group) => ({
        ...group,
        sources: [],
        styleNote: "",
        visual: null,
      })),
    }),
  );
  await write(
    "assets/prerender.css",
    await readFile(
      new URL("../src/media/prerender.css", import.meta.url),
      "utf8",
    ),
  );
  return {
    files: files.sort(),
    counts: { groups: catalog.groups.length, events: dataset.events.length },
  };
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  console.log(
    await generatePrerender(path.resolve(process.argv[2] ?? "."), {
      outputRoot: path.resolve(
        process.argv[3] ?? "reports/city-upgrade-c/generated",
      ),
    }),
  );

import { geoMercator, geoPath } from "d3-geo";
import { GEOGRAPHY_DATA } from "../geography/model";
import { orientBasemap } from "../geography/renderer";
import { element, link } from "../groups/dom";
import type { DailyStat, RegionStat } from "./contracts";

const SVG = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
}
export function trendChart(days: DailyStat[]): HTMLElement {
  const container = element("div");
  const legend = element("div", "", "legend");
  for (const [text, name] of [
    ["浏览量 PV", "pv"],
    ["访客估算 UV", "uv"],
  ]) {
    const item = element("span", "", name);
    item.append(element("i"), text);
    legend.append(item);
  }
  container.append(legend);
  const chart = svg("svg", {
    viewBox: "0 0 920 255",
    class: "trend-chart",
    role: "img",
    "aria-label": "每日浏览量与访客估算折线图，具体数值可在下方展开表格",
  });
  const max = Math.max(5, ...days.map((day) => day.pv));
  const top = Math.ceil(max / 5) * 5;
  const x = (index: number): number =>
    43 + (index * 851) / Math.max(1, days.length - 1);
  const y = (value: number): number => 217 - (value * 192) / top;
  for (let i = 0; i <= 4; i++) {
    const value = (top * i) / 4;
    chart.append(
      svg("line", {
        x1: "43",
        x2: "894",
        y1: String(y(value)),
        y2: String(y(value)),
        class: "chart-grid",
      }),
    );
    const label = svg("text", {
      x: "32",
      y: String(y(value) + 4),
      "text-anchor": "end",
    });
    label.textContent = Math.round(value).toLocaleString("zh-CN");
    chart.append(label);
  }
  const plot = (key: "pv" | "uv"): string =>
    days
      .map(
        (day, i) =>
          `${i ? "L" : "M"}${x(i).toFixed(2)},${y(day[key]).toFixed(2)}`,
      )
      .join(" ");
  if (days.length)
    chart.append(
      svg("path", {
        d: `${plot("pv")} L${x(days.length - 1)},217 L43,217 Z`,
        class: "chart-area",
      }),
      svg("path", { d: plot("pv"), class: "chart-line-pv" }),
      svg("path", { d: plot("uv"), class: "chart-line-uv" }),
    );
  if (days.length === 1) {
    chart.append(
      svg("circle", {
        cx: String(x(0)),
        cy: String(y(days[0].pv)),
        r: "3",
        class: "chart-point",
      }),
    );
  }
  const labels = new Set([
    0,
    Math.round((days.length - 1) / 4),
    Math.round((days.length - 1) / 2),
    Math.round(((days.length - 1) * 3) / 4),
    days.length - 1,
  ]);
  for (const index of labels)
    if (days[index]) {
      const label = svg("text", {
        x: String(x(index)),
        y: "242",
        "text-anchor": "middle",
      });
      label.textContent = days[index].day.slice(5).replace("-", "/");
      chart.append(label);
    }
  const chartFrame = element("div", "", "trend-frame");
  chartFrame.tabIndex = 0;
  chartFrame.setAttribute("role", "region");
  chartFrame.setAttribute(
    "aria-label",
    "访问趋势图，小屏幕可横向滚动，数值见下方表格",
  );
  chartFrame.append(chart);
  container.append(
    chartFrame,
    element(
      "p",
      "UV 按同日 IP 与浏览器类型估算，不等于真实人数；切换日期范围不会合并为跨日独立访客。",
      "chart-note",
    ),
  );
  const details = element("details", "", "chart-details");
  details.append(element("summary", "查看每日数据表"));
  const wrap = element("div", "", "table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "每日访问数据，可横向滚动");
  const table = element("table");
  const head = element("thead");
  const row = element("tr");
  for (const title of ["日期", "浏览量 PV", "访客估算 UV", "独立 IP"])
    row.append(element("th", title));
  head.append(row);
  const body = element("tbody");
  for (const day of days) {
    const tr = element("tr");
    for (const text of [day.day, day.pv, day.uv, day.ips])
      tr.append(element("td", String(text)));
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  details.append(wrap);
  container.append(details);
  return container;
}

const normalizeProvince = (name: string): string =>
  name.replace(/(?:壮族|回族|维吾尔)?自治区|特别行政区|省|市/gu, "");
export function heatColor(count: number, maximum: number): string {
  if (count === 0) return "oklch(0.285 0.018 25)";
  const strength = Math.log1p(count) / Math.log1p(Math.max(1, maximum));
  return `oklch(${(0.38 + 0.4 * strength).toFixed(3)} ${(0.075 + 0.1 * strength).toFixed(3)} 27)`;
}
export function regionMap(regions: RegionStat[]): HTMLElement {
  const wrapper = element("div");
  const layout = element("div", "", "map-layout");
  const mapColumn = element("div");
  const selected = element("p", "点击省份查看访问量", "map-selection");
  selected.setAttribute("role", "status");
  const chart = svg("svg", {
    viewBox: "0 0 800 455",
    class: "region-map",
    role: "group",
    "aria-label": "中国省级访问量地图，颜色越亮表示浏览量越高",
  });
  const provinces = new Map<string, number>();
  for (const region of regions)
    if (["中国", "China", "CN"].includes(region.country)) {
      const name = normalizeProvince(region.province);
      provinces.set(name, (provinces.get(name) ?? 0) + region.pv);
    }
  const maximum = Math.max(1, ...provinces.values());
  if (GEOGRAPHY_DATA.basemap) {
    const basemap = orientBasemap(GEOGRAPHY_DATA.basemap);
    const projection = geoMercator().fitExtent(
      [
        [15, 8],
        [785, 440],
      ],
      basemap,
    );
    const draw = geoPath(projection);
    for (const feature of basemap.features) {
      const province = GEOGRAPHY_DATA.provinces.find(
        (item) => item.id === feature.properties.provinceId,
      );
      const count = province
        ? (provinces.get(normalizeProvince(province.name)) ?? 0)
        : 0;
      const name = province?.name ?? feature.properties.name;
      const node = svg("path", {
        d: draw(feature) ?? "",
        class: province ? "province" : "map-symbol",
        fill: province ? heatColor(count, maximum) : "none",
      });
      if (province) {
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", `${name}：${count} 次浏览`);
        const title = svg("title");
        title.textContent = `${name} · ${count.toLocaleString("zh-CN")} 次`;
        node.append(title);
        const choose = (): void => {
          selected.textContent = `${name} · ${count.toLocaleString("zh-CN")} 次浏览`;
        };
        node.addEventListener("click", choose);
        node.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose();
          }
        });
      }
      chart.append(node);
    }
  }
  const key = element("div", "", "map-key");
  key.append(element("span", "较少"));
  // 图例使用 SVG 填色，保持严格 CSP 下不依赖动态 style 属性。
  const scale = svg("svg", {
    viewBox: "0 0 160 9",
    width: "160",
    height: "9",
    "aria-hidden": "true",
  });
  for (let i = 0; i < 6; i++)
    scale.append(
      svg("rect", {
        x: String(i * 27),
        y: "0",
        width: "23",
        height: "7",
        fill: heatColor(
          i ? Math.expm1((Math.log1p(maximum) * i) / 5) : 0,
          maximum,
        ),
      }),
    );
  key.append(scale, element("span", "较多"));
  mapColumn.append(chart, selected, key);
  const ranking = element("div");
  ranking.append(element("h3", "地区排行"));
  const list = element("ol", "", "rank-list");
  for (const [i, region] of [...regions]
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 10)
    .entries()) {
    const li = element("li");
    const label = ["中国", "China", "CN"].includes(region.country)
      ? region.province === "未知"
        ? "中国 · 地区未知"
        : region.province
      : region.province === "未知"
        ? region.country
        : `${region.country} · ${region.province}`;
    li.append(
      element("span", String(i + 1).padStart(2, "0"), "rank-number"),
      element("strong", label),
      element("span", region.pv.toLocaleString("zh-CN"), "amount"),
    );
    list.append(li);
  }
  if (!regions.length)
    ranking.append(
      element("p", "开始采集后，地区排行会显示在这里。", "chart-note"),
    );
  ranking.append(list);
  layout.append(mapColumn, ranking);
  wrapper.append(layout);
  const note = element(
    "p",
    "地区由 IP 估算，可能受运营商与代理影响；未知及海外地区计入排行，不强行落点。底图沿用站点省级地图。地区数据：",
    "map-caption",
  );
  const source = element("a", "ip2region（本地查询）");
  source.href = "https://github.com/lionsoul2014/ip2region";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  note.append(source);
  wrapper.append(note);
  const attribution = element("details", "", "chart-details map-attribution");
  attribution.append(element("summary", "地图来源与授权说明"));
  for (const text of GEOGRAPHY_DATA.attribution)
    attribution.append(element("p", text));
  attribution.append(
    link(
      "Natural Earth · 公共领域",
      "https://www.naturalearthdata.com/about/terms-of-use/",
      true,
    ),
    element("span", " · "),
    link("GeoNames", "https://www.geonames.org/export/", true),
    element("span", " · "),
    link("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", true),
  );
  wrapper.append(attribution);
  return wrapper;
}

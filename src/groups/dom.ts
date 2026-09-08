import type { CatalogImage } from "../catalog/model";

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function link(
  text: string,
  href: string,
  external = false,
): HTMLAnchorElement {
  const node = element("a", text);
  node.href = href;
  if (external) {
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.setAttribute("aria-label", `${text}（在新窗口打开）`);
  }
  return node;
}

export function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`页面缺少必要元素：${id}`);
  return node as T;
}

/** 图像加载失败仍保留相同占位和文本，不更换为未经采用的候选图片。 */
export function imageBlock(
  image: CatalogImage | null,
  name: string,
  large = false,
  eager = false,
): HTMLElement {
  const frame = element("div", "", large ? "groups-visual" : "groups-avatar");
  const fallback = element(
    "span",
    image ? "图像暂不可用" : "暂无资料图",
    "groups-image-fallback",
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

export function showFailure(
  root: HTMLElement,
  title: string,
  description: string,
  heading: "h1" | "h2" = "h2",
): void {
  root.replaceChildren();
  const panel = element("section", "", "groups-empty");
  panel.setAttribute("role", "alert");
  panel.append(element(heading, title), element("p", description));
  panel.append(link("返回团体列表", "groups.html"));
  root.append(panel);
}

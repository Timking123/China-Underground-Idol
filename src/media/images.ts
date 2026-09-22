import data from "./variants.json";

interface Variant {
  src: string;
  width: number;
  height: number;
}
interface ImageEntry {
  width: number;
  height: number;
  variants: Variant[];
}
const images: Record<string, ImageEntry> = data;

/** prefix 用于目录下的静态页；外链与尚无变体的图片原样降级。 */
export function responsiveImage(
  src: string,
  options: { kind: "avatar" | "card" | "detail"; prefix?: string },
): {
  src: string;
  srcset?: string;
  sizes?: string;
  width?: number;
  height?: number;
} {
  const prefix = options.prefix ?? "";
  const original = src.startsWith("assets/") ? `${prefix}${src}` : src;
  const entry = images[src];
  if (!entry?.variants.length) return { src: original };
  const target = { avatar: 96, card: 320, detail: 640 }[options.kind];
  const selected =
    entry.variants.find((variant) => variant.width >= target) ??
    entry.variants.at(-1)!;
  return {
    src: `${prefix}${selected.src}`,
    srcset: entry.variants
      .map((variant) => `${prefix}${variant.src} ${variant.width}w`)
      .join(", "),
    sizes:
      options.kind === "avatar"
        ? "64px"
        : options.kind === "card"
          ? "(max-width: 600px) calc(100vw - 48px), 320px"
          : "(max-width: 760px) calc(100vw - 48px), 480px",
    width: entry.width,
    height: entry.height,
  };
}

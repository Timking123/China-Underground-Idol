import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readJson, safePath } from "./mediaFiles.mjs";

export const MEDIA_MANIFEST = "assets/media-optimized/manifest.v1.json";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/** 无 Python 的发布校验；来源或任一变体改变均须重建，不能静默退回错误素材。 */
export async function validateMedia(root) {
  const manifest = await readJson(root, MEDIA_MANIFEST);
  if (
    manifest.schemaVersion !== "idol-media-v1" ||
    !manifest.images ||
    Array.isArray(manifest.images) ||
    !Object.keys(manifest.images).length
  )
    throw new Error("图片清单无效或为空");
  const files = new Set([MEDIA_MANIFEST]);
  for (const [src, entry] of Object.entries(manifest.images)) {
    if (
      !/^assets\/(?:avatars|weibo-avatars|weibo-api-avatar-candidates|group-visuals|posters|profile-covers|weibo-cached-visuals|event-posters)\/[a-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(
        src,
      )
    )
      throw new Error(`非白名单图片：${src}`);
    const bytes = await readFile(await safePath(root, src));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
      throw new Error(`原图已变更：${src}`);
    if (
      ![entry.width, entry.height].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      !Array.isArray(entry.variants) ||
      !entry.variants.length ||
      !Array.isArray(entry.sources)
    )
      throw new Error(`图片尺寸或来源无效：${src}`);
    let previous = 0;
    for (const variant of entry.variants) {
      if (
        !Number.isSafeInteger(variant.width) ||
        variant.width <= previous ||
        variant.width > 640 ||
        variant.width > entry.width ||
        variant.height !==
          Math.max(
            1,
            Math.round((entry.height * variant.width) / entry.width),
          ) ||
        variant.src !==
          `assets/media-optimized/${entry.sha256.slice(0, 20)}-${variant.width}.webp`
      )
        throw new Error(`变体尺寸或路径错误：${src}`);
      const encoded = await readFile(await safePath(root, variant.src));
      if (
        sha256(encoded) !== variant.sha256 ||
        encoded.length !== variant.bytes ||
        encoded.toString("ascii", 0, 4) !== "RIFF" ||
        encoded.toString("ascii", 8, 12) !== "WEBP" ||
        encoded.readUInt32LE(4) !== encoded.length - 8
      )
        throw new Error(`变体损坏：${variant.src}`);
      previous = variant.width;
      files.add(variant.src);
    }
  }
  return { files: [...files].sort(), manifest };
}

import { build } from "esbuild";
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 直接编译实际领域模块，避免 Node 工具与浏览器维护两套路径正则。
const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/events/model.ts", import.meta.url)),
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const model = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

/** 正式发布门不限制记录数、发布者平台或是否使用海报。 */
export function validatePublishedEvents(input, knownIds) {
  const result = model.validateEventDataset(input, knownIds);
  if (!result.valid)
    throw new Error(
      result.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("\n"),
    );
  for (const event of result.data.events) {
    if (/^e-(?:test|fixture|summary)(?:-|$)/.test(event.id))
      throw new Error(`${event.id}: 测试保留 ID 不能进入正式资料`);
    for (const source of event.sources) {
      const host = new URL(source.url).hostname.replace(/\.$/, "");
      if (
        /(?:^|\.)(?:example\.(?:com|net|org)|test|invalid|localhost)$/.test(
          host,
        )
      )
        throw new Error(`${event.id}: 示例来源不能进入正式资料`);
    }
  }
  return result.data;
}

function hasImageContainer(bytes, extension) {
  if (extension === ".png") {
    return (
      bytes.length >= 57 &&
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.toString("ascii", 12, 16) === "IHDR" &&
      bytes.readUInt32BE(16) > 0 &&
      bytes.readUInt32BE(20) > 0 &&
      bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return (
      bytes.length >= 32 &&
      bytes.readUInt16BE(0) === 0xffd8 &&
      bytes.readUInt16BE(bytes.length - 2) === 0xffd9 &&
      bytes.includes(Buffer.from([0xff, 0xda])) &&
      [0xc0, 0xc1, 0xc2].some((marker) =>
        bytes.includes(Buffer.from([0xff, marker])),
      )
    );
  }
  return (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.readUInt32LE(4) === bytes.length - 8 &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
  );
}

/** 不跟随任一级符号链接；扩展名之外再检查图片签名和基本容器。 */
export async function readLocalEventPoster(root, src) {
  if (!model.isLocalEventPosterPath(src))
    throw new Error(`非法本地活动海报路径：${src}`);
  const base = await realpath(root);
  let current = base;
  const parts = src.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      throw new Error(`本地活动海报不存在：${src}`);
    }
    if (stat.isSymbolicLink())
      throw new Error(`本地活动海报禁止符号链接：${src}`);
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
      throw new Error(`本地活动海报不是普通文件：${src}`);
  }
  const relative = path.relative(base, await realpath(current));
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`本地活动海报越界：${src}`);
  const bytes = await readFile(current);
  if (!hasImageContainer(bytes, path.extname(src)))
    throw new Error(`本地活动海报不是匹配扩展名的图片：${src}`);
  return bytes;
}

export async function readEventAssets(root) {
  const [raw, master] = await Promise.all([
    readFile(path.join(root, "data/events.v1.json"), "utf8"),
    readFile(path.join(root, "data/群体分布数据.json"), "utf8"),
  ]);
  const dataset = validatePublishedEvents(
    JSON.parse(raw),
    JSON.parse(master).groups.map((group) => group.id),
  );
  const localPosters = [
    ...new Set(
      dataset.events.flatMap((event) =>
        event.poster && model.isLocalEventPosterPath(event.poster.src)
          ? [event.poster.src]
          : [],
      ),
    ),
  ].sort();
  for (const src of localPosters) await readLocalEventPoster(root, src);
  return { dataset, localPosters };
}

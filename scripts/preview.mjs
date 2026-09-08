import { createServer } from "node:http";
import { readFile, realpath, lstat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readEventAssets, readLocalEventPoster } from "./eventAssets.mjs";
import { publicFiles, isPublicImage } from "./siteManifest.mjs";

// 只向本机提供页面白名单；开发配置与 Git 元数据不属于预览资源。
export async function createPreviewServer(
  directory = fileURLToPath(new URL("../", import.meta.url)),
) {
  const root = await realpath(directory);
  const { localPosters } = await readEventAssets(root);
  const files = new Set(publicFiles);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const name =
        decodeURIComponent(
          new URL(request.url, "http://127.0.0.1").pathname,
        ).replace(/^\//, "") || "index.html";
      const asset = isPublicImage(name) || localPosters.includes(name);
      if ((!files.has(name) && !asset) || name.split("/").includes("..")) {
        response.writeHead(404).end();
        return;
      }
      if (
        name.startsWith("assets/event-posters/") &&
        !localPosters.includes(name)
      ) {
        response.writeHead(404).end();
        return;
      }
      let component = root;
      const parts = name.split("/");
      for (const [index, part] of parts.entries()) {
        component = path.join(component, part);
        const stat = await lstat(component);
        if (
          stat.isSymbolicLink() ||
          (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
        ) {
          response.writeHead(404).end();
          return;
        }
      }
      const target = await realpath(path.join(root, name));
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        response.writeHead(404).end();
        return;
      }
      const body = localPosters.includes(name)
        ? await readLocalEventPoster(root, name)
        : await readFile(target);
      response.writeHead(200, {
        "Content-Type":
          mime[path.extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const port = Number(process.argv[2] ?? 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("端口必须在 1024–65535 之间");
  (await createPreviewServer()).listen(port, "127.0.0.1", () =>
    console.log(`本机预览：http://127.0.0.1:${port}`),
  );
}

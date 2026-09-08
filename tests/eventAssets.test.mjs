import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rm,
  symlink,
  rmdir,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  readEventAssets,
  readLocalEventPoster,
} from "../scripts/eventAssets.mjs";
import { packageSite } from "../scripts/packageSite.mjs";
import { buildSite } from "../scripts/build.mjs";
import { createPreviewServer } from "../scripts/preview.mjs";
import { request } from "node:http";

const root = fileURLToPath(new URL("../", import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

function previewRequest(server, name, method = "GET") {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host: "127.0.0.1",
        port: server.address().port,
        path: `/${name}`,
        method,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    call.on("error", reject);
    call.end();
  });
}

async function fixture(run) {
  const tempParent = path.join(root, ".build");
  await mkdir(tempParent, { recursive: true });
  const temporary = await mkdtemp(path.join(tempParent, "event-assets-test-"));
  try {
    for (const directory of [
      "data",
      "styles",
      "assets/event-posters",
      ...[
        "avatars",
        "posters",
        "group-visuals",
        "profile-covers",
        "weibo-api-avatar-candidates",
        "weibo-avatars",
        "weibo-cached-visuals",
      ].map((name) => `assets/${name}`),
    ])
      await mkdir(path.join(temporary, directory), { recursive: true });
    await copyFile(
      path.join(root, "data/群体分布数据.json"),
      path.join(temporary, "data/群体分布数据.json"),
    );
    const dataset = JSON.parse(
      await readFile(
        new URL("fixtures/events-seed-20260905.json", import.meta.url),
        "utf8",
      ),
    );
    dataset.events.push({
      ...dataset.events[0],
      id: "e-maintenance-addition",
      sources: [
        {
          ...dataset.events[0].sources[0],
          url: "https://venue.org/announcement",
          kind: "venue",
        },
      ],
      poster: {
        src: "assets/event-posters/event-1.png",
        alt: "仅用于临时回归的合成海报",
        sourceUrl: "https://venue.org/announcement",
      },
    });
    await writeFile(
      path.join(temporary, "data/events.v1.json"),
      JSON.stringify(dataset),
      "utf8",
    );
    await writeFile(
      path.join(temporary, "assets/event-posters/event-1.png"),
      png,
    );
    await run(temporary, dataset);
  } finally {
    // 只删除本测试在 integration/.build 下新建的随机目录。
    assert.equal(path.dirname(temporary), tempParent);
    assert.ok(path.basename(temporary).startsWith("event-assets-test-"));
    await rm(temporary, { recursive: true, force: true });
  }
}

test("六条合法活动与非微博来源、本地海报可维护，只打包被引用图片", async () => {
  await fixture(async (temporary, dataset) => {
    const required = [
      "index.html",
      "discover.html",
      "groups.html",
      "group.html",
      "events.html",
      "guide.html",
      "contribute.html",
      "about.html",
      "app.css",
      "app.js",
      "data.js",
      "styles/site.css",
      "styles/events.css",
      "styles/content.css",
      "styles/groups.css",
      "styles/discover.css",
      "assets/groups-data.js",
      "assets/groups.js",
      "assets/group.js",
      "assets/discover.js",
      "assets/site.js",
      "assets/events.js",
      "assets/contribute.js",
    ];
    for (const file of required)
      await writeFile(path.join(temporary, file), "临时打包回归占位", "utf8");
    // 只缺新发现模块时必须在生成任何脚本前停止，旧占位也不能被半成品覆盖。
    for (const file of [
      "src/site/map.ts",
      "src/events/page.ts",
      "src/content/page.ts",
      "src/groups/list.ts",
      "src/groups/detail.ts",
    ]) {
      await mkdir(path.dirname(path.join(temporary, file)), {
        recursive: true,
      });
      await writeFile(path.join(temporary, file), "export {};", "utf8");
    }
    await assert.rejects(
      buildSite(temporary),
      /模块尚未齐全：src\/discover\/page.ts/,
    );
    assert.equal(
      await readFile(path.join(temporary, "assets/groups-data.js"), "utf8"),
      "临时打包回归占位",
    );
    await writeFile(
      path.join(temporary, "assets/event-posters/unreferenced.png"),
      png,
    );
    const first = await readEventAssets(temporary);
    assert.equal(first.dataset.events.length, 6);
    assert.deepEqual(first.localPosters, ["assets/event-posters/event-1.png"]);
    await writeFile(
      path.join(temporary, "assets/event-posters/event-2.png"),
      png,
    );
    dataset.events[0].poster = {
      ...dataset.events[5].poster,
      src: "assets/event-posters/event-2.png",
    };
    dataset.events[1].poster = dataset.events[5].poster;
    await writeFile(
      path.join(temporary, "data/events.v1.json"),
      JSON.stringify(dataset),
      "utf8",
    );
    const files = await packageSite(temporary);
    for (const file of [
      "discover.html",
      "groups.html",
      "group.html",
      "assets/groups-data.js",
      "assets/groups.js",
      "assets/group.js",
      "assets/discover.js",
    ])
      assert.ok(files.includes(file), file);
    const manifestPath = path.join(temporary, ".build/site/manifest.sha256");
    const firstManifest = await readFile(manifestPath, "utf8");
    await writeFile(
      path.join(temporary, "assets/debug.js"),
      "内部开发占位",
      "utf8",
    );
    assert.deepEqual(await packageSite(temporary), files);
    assert.equal(await readFile(manifestPath, "utf8"), firstManifest);
    assert.ok(!files.includes("assets/debug.js"));
    const server = await createPreviewServer(temporary);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      for (const file of [
        "discover.html",
        "groups.html",
        "group.html",
        "assets/groups-data.js",
        "assets/discover.js",
        "styles/groups.css",
      ])
        assert.equal((await previewRequest(server, file)).status, 200, file);
      const head = await previewRequest(server, "discover.html", "HEAD");
      assert.equal(head.status, 200);
      assert.equal(head.body, "");
      assert.match(head.headers["content-type"], /text\/html/u);
      assert.equal(head.headers["x-content-type-options"], "nosniff");
      assert.equal(
        (await previewRequest(server, "discover.html", "POST")).status,
        405,
      );
      for (const file of [
        "assets/debug.js",
        "data/events.v1.json",
        "src/site/map.ts",
        ".build/site/index.html",
        "assets/%2e%2e/scripts/build.mjs",
        "assets%2f..%2f..%2fprivate.txt",
      ])
        assert.equal((await previewRequest(server, file)).status, 404, file);
      await symlink(
        path.join(temporary, "styles"),
        path.join(temporary, "assets/avatars/g999.png"),
        "junction",
      );
      assert.equal(
        (await previewRequest(server, "assets/avatars/g999.png")).status,
        404,
      );
      await rm(path.join(temporary, "assets/avatars/g999.png"));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(
      files.filter((file) => file.startsWith("assets/event-posters/")).length,
      2,
    );
    assert.ok(!files.includes("assets/event-posters/unreferenced.png"));
    for (const src of (await readEventAssets(temporary)).localPosters)
      assert.deepEqual(
        await readFile(path.join(temporary, ".build/site", src)),
        await readLocalEventPoster(temporary, src),
      );
    await rm(path.join(temporary, "assets/discover.js"));
    await assert.rejects(packageSite(temporary), /ENOENT/);
    assert.equal(await readFile(manifestPath, "utf8"), firstManifest);
    await writeFile(
      path.join(temporary, "assets/discover.js"),
      "临时打包回归占位",
      "utf8",
    );
    await writeFile(
      path.join(temporary, ".build/site/private.txt"),
      "不得发布",
      "utf8",
    );
    await assert.rejects(packageSite(temporary), /非白名单文件/);
  });
});

test("不存在、非图片、错扩展名和非普通文件明确失败", async () => {
  await fixture(async (temporary) => {
    await assert.rejects(
      readLocalEventPoster(temporary, "assets/event-posters/missing.png"),
      /不存在/,
    );
    for (const bytes of [
      Buffer.from("<html>不是图片</html>"),
      png.subarray(0, 24),
    ]) {
      await writeFile(
        path.join(temporary, "assets/event-posters/event-1.png"),
        bytes,
      );
      await assert.rejects(readEventAssets(temporary), /不是匹配扩展名的图片/);
      await assert.rejects(packageSite(temporary), /不是匹配扩展名的图片/);
    }
    await writeFile(
      path.join(temporary, "assets/event-posters/wrong.jpg"),
      png,
    );
    await assert.rejects(
      readLocalEventPoster(temporary, "assets/event-posters/wrong.jpg"),
      /不是匹配扩展名/,
    );
    await mkdir(path.join(temporary, "assets/event-posters/directory.png"));
    await assert.rejects(
      readLocalEventPoster(temporary, "assets/event-posters/directory.png"),
      /不是普通文件/,
    );
  });
});

test("已有公开 JPEG 和 WebP 图像可用作临时本地海报格式回归", async () => {
  await fixture(async (temporary) => {
    for (const [source, target] of [
      ["assets/avatars/g001.jpg", "assets/event-posters/photo.jpg"],
      ["assets/group-visuals/g303.webp", "assets/event-posters/photo.webp"],
    ]) {
      const bytes = await readFile(path.join(root, source));
      await writeFile(path.join(temporary, target), bytes);
      assert.deepEqual(await readLocalEventPoster(temporary, target), bytes);
    }
  });
});

test("本地海报拒绝任意目录、越界、编码穿越、非图片扩展名", async () => {
  await fixture(async (temporary) => {
    for (const src of [
      "../private.png",
      "assets/event-posters/../secret.png",
      "assets/event-posters/%2e%2e.png",
      "assets/posters/event.png",
      "assets/private/a.png",
      "assets/event-posters/a.svg",
      "assets/event-posters/a.txt",
      "assets/event-posters/a.png?raw=1",
      "assets/event-posters/a.png\n",
    ]) {
      await assert.rejects(readLocalEventPoster(temporary, src), /非法本地/);
    }
  });
});

test("本地海报拒绝文件名位置及目录层的符号联接，即使目标在站内", async () => {
  await fixture(async (temporary) => {
    const source = path.join(temporary, "assets/event-posters/event-1.png");
    // Windows 无文件符号链接权限；联接在同一 lstat 分支验证最终路径分量。
    await mkdir(path.join(temporary, "link-target"));
    await symlink(
      path.join(temporary, "link-target"),
      path.join(temporary, "assets/event-posters/link.png"),
      "junction",
    );
    await assert.rejects(
      readLocalEventPoster(temporary, "assets/event-posters/link.png"),
      /禁止符号链接/,
    );
    await rm(path.join(temporary, "assets/event-posters/link.png"));
    await rm(source);
    await rmdir(path.join(temporary, "assets/event-posters"));
    await mkdir(path.join(temporary, "other"));
    await writeFile(path.join(temporary, "other/event-1.png"), png);
    await symlink(
      path.join(temporary, "other"),
      path.join(temporary, "assets/event-posters"),
      "junction",
    );
    await assert.rejects(readEventAssets(temporary), /禁止符号链接/);
  });
});

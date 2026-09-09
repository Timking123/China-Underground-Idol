import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  link,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const BASE = "/srv/china-underground-idol";
const CONFIG = "/etc/nginx/sites-available/idol.hi-veblen.com.conf";
const INPUTS = new Set([
  "data/events.v1.json",
  "data/follower-observations.v2.json",
]);
export const GENERATED_FILES = new Set([
  "assets/groups-data.js",
  "assets/site.js",
  "assets/events.js",
  "assets/contribute.js",
  "assets/groups.js",
  "assets/group.js",
  "assets/discover.js",
]);
export const PUBLIC_FILES = new Set([
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
  ...GENERATED_FILES,
]);
const PUBLIC_IMAGE =
  /^assets\/(?:avatars|posters|group-visuals|profile-covers|weibo-api-avatar-candidates|weibo-avatars|weibo-cached-visuals)\/g\d{3}[a-zA-Z0-9.-]*\.(?:png|jpe?g|webp|svg)$/u;
const EVENT_IMAGE =
  /^assets\/event-posters\/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)$/u;
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const exec = promisify(execFile);
function requireState(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function safeName(name: string): string {
  requireState(
    /^[A-Za-z0-9_./-]+$/u.test(name) &&
      name.split("/").every((part) => part && part !== "." && part !== ".."),
    "publication_path_escape",
  );
  requireState(!path.isAbsolute(name), "publication_absolute_entry");
  return name;
}
async function exists(target: string) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function ordinaryParents(target: string) {
  requireState(path.isAbsolute(target), "publication_absolute_path_required");
  let current = path.parse(target).root;
  for (const part of target
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const state = await lstat(current);
    requireState(
      state.isDirectory() && !state.isSymbolicLink(),
      "publication_directory_link",
    );
  }
}
async function bytes(target: string, limit = 20_000_000) {
  await ordinaryParents(path.dirname(target));
  const before = await lstat(target);
  requireState(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1 &&
      before.size <= limit,
    "publication_file_type_or_size",
  );
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const state = await handle.stat();
    requireState(
      state.isFile() && state.nlink === 1 && state.size <= limit,
      "publication_opened_file_type",
    );
    const value = await handle.readFile();
    requireState(value.length <= limit, "publication_file_too_large");
    return value;
  } finally {
    await handle.close();
  }
}
async function exclusiveJson(target: string, value: unknown) {
  await ordinaryParents(path.dirname(target));
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}-${randomUUID()}`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(encode(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary);
  }
}
async function replaceOwned(target: string, next: Buffer, previous: Buffer) {
  requireState(
    (await bytes(target)).equals(previous),
    "publication_input_preimage_changed",
  );
  const temporary = path.join(
    path.dirname(target),
    `.publication-${randomUUID()}`,
  );
  const handle = await open(
    temporary,
    "wx",
    (await lstat(target)).mode & 0o777,
  );
  try {
    await handle.writeFile(next);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    requireState(
      (await bytes(target)).equals(previous),
      "publication_input_preimage_changed",
    );
    await rename(temporary, target);
  } finally {
    if (await exists(temporary)) await unlink(temporary);
  }
}
export interface CandidateManifest {
  manifestSha256: string;
  publicFileCount: number;
  files: Record<string, string>;
}
export async function inspectPublicationCandidate(
  source: string,
): Promise<CandidateManifest> {
  const raw = await bytes(path.join(source, "manifest.sha256"), 2_000_000);
  const files: Record<string, string> = {};
  for (const line of raw.toString("utf8").trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9_./-]+)$/u.exec(line);
    requireState(match, "publication_manifest_line");
    const name = safeName(match[2]);
    requireState(
      PUBLIC_FILES.has(name) ||
        PUBLIC_IMAGE.test(name) ||
        EVENT_IMAGE.test(name),
      "publication_nonpublic_file",
    );
    requireState(!Object.hasOwn(files, name), "publication_duplicate_file");
    files[name] = match[1];
  }
  requireState(
    [...PUBLIC_FILES].every((name) => Object.hasOwn(files, name)) &&
      Object.keys(files).length <= 10000,
    "publication_missing_entry",
  );
  const actual: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      requireState(!entry.isSymbolicLink(), "publication_candidate_link");
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else {
        requireState(entry.isFile(), "publication_candidate_special_file");
        actual.push(path.relative(source, target).split(path.sep).join("/"));
      }
    }
  };
  await ordinaryParents(source);
  await visit(source);
  requireState(
    actual.length === Object.keys(files).length + 1 &&
      actual.every(
        (name) => name === "manifest.sha256" || Object.hasOwn(files, name),
      ),
    "publication_candidate_file_set",
  );
  let total = 0;
  for (const [name, expected] of Object.entries(files)) {
    const value = await bytes(path.join(source, name));
    total += value.length;
    requireState(
      total <= 512_000_000 && sha256(value) === expected,
      "publication_candidate_hash",
    );
  }
  return {
    manifestSha256: sha256(raw),
    publicFileCount: Object.keys(files).length,
    files,
  };
}

/** 真浏览器只访问本地候选；三个主流程和空结果反例均须完成。 */
export async function validatePublicationCandidate(
  source: string,
): Promise<void> {
  const manifest = await inspectPublicationCandidate(source);
  const failures: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const name =
        decodeURIComponent(
          new URL(request.url ?? "/", "http://127.0.0.1").pathname,
        ).slice(1) || "index.html";
      if (name === "favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (!Object.hasOwn(manifest.files, name)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const contents = await bytes(path.join(source, safeName(name)));
      requireState(
        sha256(contents) === manifest.files[name],
        "publication_browser_source_drift",
      );
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };
      response.writeHead(200, {
        "Content-Type": types[path.extname(name)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(contents);
    })().catch(() => {
      failures.push("local_response_failed");
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  requireState(
    address && typeof address !== "string",
    "publication_local_server_address",
  );
  const origin = `http://127.0.0.1:${address.port}`;
  let browser:
    | Awaited<ReturnType<(typeof import("playwright"))["chromium"]["launch"]>>
    | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        failures.push("nonlocal_browser_request");
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", () => failures.push("page_error"));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push("console_error");
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failures.push(`http_${response.status()}`);
    });
    page.on("requestfailed", () => failures.push("request_failed"));
    const visit = async (name: string) => {
      const result = await page.goto(`${origin}/${name}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      requireState(result?.ok(), "publication_browser_navigation");
    };
    await visit("index.html");
    await page.locator("#idol-map").waitFor({ state: "visible" });
    await page
      .locator("#idol-map [role='button']")
      .first()
      .waitFor({ state: "visible" });
    const group = await page.evaluate(
      () =>
        (
          window as unknown as {
            IDOL_MAP_DATA?: { groups?: { name: string }[] };
          }
        ).IDOL_MAP_DATA?.groups?.[0]?.name,
    );
    requireState(group, "publication_map_empty");
    await page.locator("#idol-search").fill(group);
    await page.locator("#search-results .search-result").first().click();
    requireState(
      (await page.locator("#detail-name").innerText()).includes(group),
      "publication_map_detail",
    );
    await visit("events.html");
    await page
      .locator("#events-query")
      .fill("publication-no-matching-event-9f3c1");
    await page.locator("#events-query").press("Enter");
    await page.locator("#events-empty").waitFor({ state: "visible" });
    await page.locator("#events-query").fill("");
    await page.locator("#events-query").press("Enter");
    await page.locator("#events-month-view").click();
    await page.locator("#events-calendar").waitFor({ state: "visible" });
    await visit("groups.html");
    const firstName = await page
      .locator("#groups-results h3 a")
      .first()
      .innerText();
    requireState(firstName.length > 0, "publication_groups_empty");
    await page.locator("#groups-query").fill(firstName);
    await page.locator("#groups-query").press("Enter");
    requireState(
      (await page.locator("#groups-results").innerText()).includes(firstName),
      "publication_groups_search",
    );
    requireState(failures.length === 0, "publication_browser_failure");
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  requireState(
    (await inspectPublicationCandidate(source)).manifestSha256 ===
      manifest.manifestSha256,
    "publication_candidate_changed_after_browser",
  );
}

export interface PublicationOptions {
  stageRoot: string;
  repoRoot: string;
  stateRoot: string;
  runId: string;
}
export interface PublicationBaseline {
  previous: string;
  previousManifestSha256: string;
  configSha256: string;
}
export interface PublicationDependencies {
  base: string;
  command: (file: string, args: string[], cwd: string) => Promise<string>;
  browser: (source: string) => Promise<void>;
  baseline: () => Promise<PublicationBaseline>;
  now: () => Date;
}
async function command(file: string, args: string[], cwd: string) {
  try {
    const result = await exec(file, args, {
      cwd,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 10_000_000,
    });
    return result.stdout;
  } catch {
    throw new Error(
      `publication_command_failed_${file === "git" ? "git" : "npm"}`,
    );
  }
}
async function baseline(): Promise<PublicationBaseline> {
  await ordinaryParents(BASE);
  const previous = await readlink(path.join(BASE, "current"));
  requireState(
    /^releases\/[a-z0-9][a-z0-9-]{1,90}$/u.test(previous),
    "publication_previous_link",
  );
  return {
    previous,
    previousManifestSha256: sha256(
      await bytes(path.join(BASE, previous, "manifest.sha256"), 2_000_000),
    ),
    configSha256: sha256(await bytes(CONFIG, 2_000_000)),
  };
}
export function createPublicationPreparer(deps: PublicationDependencies) {
  return async function prepare(
    options: PublicationOptions,
  ): Promise<{ changed: boolean; requestPath?: string }> {
    const { stageRoot, repoRoot, stateRoot, runId } = options;
    requireState(
      /^[a-z0-9][a-z0-9-]{0,90}$/u.test(runId),
      "publication_run_id",
    );
    requireState(
      path.resolve(repoRoot) === path.join(deps.base, "maintenance/repo") &&
        path.resolve(stateRoot) === path.join(deps.base, "maintenance/state"),
      "publication_fixed_paths",
    );
    for (const root of [stageRoot, repoRoot, stateRoot])
      await ordinaryParents(root);
    const publishRoot = path.join(stateRoot, "publish");
    await mkdir(publishRoot, { recursive: true, mode: 0o700 });
    await ordinaryParents(publishRoot);
    const pending = path.join(publishRoot, "pending.json");
    const preparing = path.join(publishRoot, "preparing.json");
    requireState(
      !(await exists(preparing)),
      "publication_preparing_requires_review",
    );
    requireState(!(await exists(pending)), "publication_pending_exists");
    const lockPath = path.join(publishRoot, ".prepare.lock");
    const lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(encode({ runId }));
    await lock.sync();
    try {
      requireState(
        !(await exists(preparing)),
        "publication_preparing_requires_review",
      );
      requireState(!(await exists(pending)), "publication_pending_exists");
      const git = (args: string[]) =>
        deps.command(
          "git",
          ["-c", "core.hooksPath=/dev/null", ...args],
          repoRoot,
        );
      const gitValue = async (args: string[]) => (await git(args)).trim();
      requireState(
        (await gitValue(["branch", "--show-current"])) === "main",
        "publication_main_required",
      );
      requireState(
        (await gitValue(["status", "--porcelain=v1", "-uall"])) === "",
        "publication_repo_dirty",
      );
      const baseSha = await gitValue(["rev-parse", "HEAD"]);
      requireState(/^[a-f0-9]{40}$/u.test(baseSha), "publication_base_sha");
      const tracked = (await git(["ls-files", "-z"]))
        .split("\0")
        .filter(Boolean);
      const updates: { name: string; next: Buffer; previous: Buffer }[] = [];
      for (const name of tracked) {
        if (name.startsWith("maintenance/") || GENERATED_FILES.has(name))
          continue;
        // 维护源允许中文公开数据名；Git 返回绝不作为命令字符串拼接。
        requireState(
          !path.isAbsolute(name) &&
            !name.split("/").includes("..") &&
            !name.includes("\\"),
          "publication_tracked_path",
        );
        const previous = await bytes(path.join(repoRoot, name));
        const next = await bytes(path.join(stageRoot, "site", name));
        if (previous.equals(next)) continue;
        requireState(
          INPUTS.has(name),
          "publication_unexpected_maintenance_change",
        );
        updates.push({ name, next, previous });
      }
      requireState(
        [...INPUTS].every((name) => tracked.includes(name)),
        "publication_inputs_not_tracked",
      );
      if (!updates.length) return { changed: false };
      const frozenBaseline = await deps.baseline();
      // 在 fetch、维护源替换和提交推送前保存意图；失败后即使源相同也必须人工核对。
      const preparation = {
        schemaVersion: "idol-publication-preparing-v1",
        runId,
        baseSha,
        repoRoot,
        inputs: updates.map((update) => ({
          path: update.name,
          beforeSha256: sha256(update.previous),
          afterSha256: sha256(update.next),
        })),
      };
      await exclusiveJson(preparing, preparation);
      requireState(
        (await bytes(preparing)).equals(encode(preparation)),
        "publication_preparing_drift",
      );
      await git(["fetch", "origin", "main"]);
      requireState(
        (await gitValue(["rev-parse", "refs/remotes/origin/main"])) === baseSha,
        "publication_origin_drift",
      );
      requireState(
        (await gitValue(["rev-parse", "HEAD"])) === baseSha &&
          (await gitValue(["status", "--porcelain=v1", "-uall"])) === "",
        "publication_repo_preimage_changed",
      );
      for (const update of updates)
        await replaceOwned(
          path.join(repoRoot, update.name),
          update.next,
          update.previous,
        );
      await deps.command("npm", ["run", "package:site"], repoRoot);
      const changed = (await git(["diff", "--name-only", "-z"]))
        .split("\0")
        .filter(Boolean);
      const untracked = (
        await git(["ls-files", "--others", "--exclude-standard", "-z"])
      )
        .split("\0")
        .filter(Boolean);
      const allChanges = [...new Set([...changed, ...untracked])];
      requireState(
        allChanges.length > 0 &&
          allChanges.every(
            (name) => INPUTS.has(name) || GENERATED_FILES.has(name),
          ),
        "publication_unexpected_build_change",
      );
      requireState(
        (await gitValue(["diff", "--cached", "--name-only"])) === "",
        "publication_unexpected_staged_change",
      );
      for (const update of updates)
        requireState(
          (await bytes(path.join(repoRoot, update.name))).equals(update.next),
          "publication_build_input_changed",
        );
      const frozenChanges = new Map<string, string>();
      for (const name of allChanges)
        frozenChanges.set(name, sha256(await bytes(path.join(repoRoot, name))));
      const verifyFrozenChanges = async () => {
        for (const [name, expected] of frozenChanges)
          requireState(
            sha256(await bytes(path.join(repoRoot, name))) === expected,
            "publication_changed_file_drift",
          );
      };
      const source = path.join(repoRoot, ".build/site");
      const candidate = await inspectPublicationCandidate(source);
      await deps.browser(source);
      requireState(
        (await inspectPublicationCandidate(source)).manifestSha256 ===
          candidate.manifestSha256,
        "publication_browser_manifest_drift",
      );
      requireState(
        JSON.stringify(await deps.baseline()) ===
          JSON.stringify(frozenBaseline),
        "publication_online_preimage_drift",
      );
      requireState(
        (await gitValue(["rev-parse", "HEAD"])) === baseSha,
        "publication_head_changed",
      );
      await verifyFrozenChanges();
      await git(["add", "--", ...allChanges]);
      const staged = (await git(["diff", "--cached", "--name-only", "-z"]))
        .split("\0")
        .filter(Boolean)
        .sort();
      requireState(
        JSON.stringify(staged) === JSON.stringify([...allChanges].sort()),
        "publication_staged_set_changed",
      );
      await git(["commit", "-m", `更新活动与粉丝资料：${runId}`]);
      const newSha = await gitValue(["rev-parse", "HEAD"]);
      requireState(
        /^[a-f0-9]{40}$/u.test(newSha) && newSha !== baseSha,
        "publication_new_sha",
      );
      requireState(
        (await gitValue(["status", "--porcelain=v1", "-uall"])) === "",
        "publication_post_commit_dirty",
      );
      await verifyFrozenChanges();
      requireState(
        (await inspectPublicationCandidate(source)).manifestSha256 ===
          candidate.manifestSha256,
        "publication_post_commit_manifest_drift",
      );
      await git(["push", "origin", "HEAD:main"]);
      requireState(
        (await gitValue(["ls-remote", "origin", "refs/heads/main"])).split(
          /\s+/u,
        )[0] === newSha,
        "publication_push_unverified",
      );
      requireState(
        (await gitValue(["rev-parse", "HEAD"])) === newSha &&
          (await gitValue(["status", "--porcelain=v1", "-uall"])) === "",
        "publication_post_push_drift",
      );
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(deps.now());
      const release = `auto-${date}-${newSha.slice(0, 12)}`;
      const verified = {
        schemaVersion: "idol-publication-verified-v1",
        runId,
        baseSha,
        newSha,
        source,
        repoRoot,
        manifestSha256: candidate.manifestSha256,
        gitPushVerified: true,
        browserVerified: true,
      };
      const verificationRoot = path.join(publishRoot, "verified");
      await mkdir(verificationRoot, { recursive: true, mode: 0o700 });
      await exclusiveJson(
        path.join(verificationRoot, `${runId}.json`),
        verified,
      );
      requireState(
        JSON.stringify(await deps.baseline()) ===
          JSON.stringify(frozenBaseline),
        "publication_online_preimage_drift",
      );
      const request = {
        schemaVersion: "idol-publish-request-v1",
        runId,
        release,
        source,
        repoRoot,
        baseSha,
        newSha,
        manifestSha256: candidate.manifestSha256,
        publicFileCount: candidate.publicFileCount,
        ...frozenBaseline,
        verificationSha256: sha256(encode(verified)),
      };
      await exclusiveJson(pending, request);
      requireState(
        (await bytes(pending)).equals(encode(request)),
        "publication_pending_drift",
      );
      requireState(
        (await bytes(preparing)).equals(encode(preparation)),
        "publication_preparing_drift",
      );
      await unlink(preparing);
      return { changed: true, requestPath: pending };
    } finally {
      await lock.close();
      requireState(
        (await bytes(lockPath, 10_000)).equals(encode({ runId })),
        "publication_prepare_lock_changed",
      );
      await unlink(lockPath);
    }
  };
}
export const preparePublication = createPublicationPreparer({
  base: BASE,
  command,
  browser: validatePublicationCandidate,
  baseline,
  now: () => new Date(),
});

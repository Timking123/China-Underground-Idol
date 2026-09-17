import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { realpath, lstat } from "node:fs/promises";
import path from "node:path";

export function inside(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/** 对尚未创建的路径也解析已有父目录，避免软链接绕过隔离检查。 */
export function canonicalPath(filename: string): string {
  const absolute = path.resolve(filename);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(canonicalPath(parent), path.basename(absolute));
  }
}

export function privateFile(filename: string): void {
  const info = lstatSync(filename);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    (process.platform !== "win32" &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
  )
    throw new Error("私人文件必须为当前用户独占的普通文件");
}

export function privateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    (process.platform !== "win32" &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
  )
    throw new Error("私人目录必须仅当前用户可访问");
}

function inRepository(filename: string): boolean {
  let current = path.dirname(filename);
  for (;;) {
    if (existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function assertStorageIsolation(
  dataDirectory: string,
  keyFile: string,
  publicDirectories: string[],
): void {
  const data = canonicalPath(dataDirectory);
  const key = canonicalPath(keyFile);
  if (inside(data, key)) throw new Error("密钥须与数据库分开保存");
  if (inRepository(key) || inRepository(data))
    throw new Error("私人运行目录和密钥不得位于源码仓库");
  for (const publicDirectory of publicDirectories) {
    const directory = canonicalPath(publicDirectory);
    if (
      inside(directory, data) ||
      inside(data, directory) ||
      inside(directory, key)
    )
      throw new Error("私人存储不能与任何公开目录重叠");
  }
}

/** 发布目录由运维管理；每次请求固定一个具体 release，后续读取不再经过 current。 */
export function createSiteFileResolver(
  siteDirectory: string,
  protectedPaths: string[],
): (relativeFile: string) => Promise<string> {
  const configured = path.resolve(siteDirectory);
  const initial = realpathSync(configured);
  const allowedRoot = path.dirname(initial);
  const isolated = protectedPaths.map(canonicalPath);
  const assertPublic = (resolved: string): void => {
    if (
      resolved === allowedRoot ||
      !inside(allowedRoot, resolved) ||
      isolated.some(
        (privatePath) =>
          inside(resolved, privatePath) || inside(privatePath, resolved),
      )
    )
      throw new Error("公开发行路径超出允许范围");
  };
  assertPublic(initial);
  return async (relativeFile: string): Promise<string> => {
    // 该参数仅由服务器固定路由/静态白名单提供，不接受任意 HTTP 文件路径。
    if (
      path.isAbsolute(relativeFile) ||
      relativeFile.split(/[\\/]/u).includes("..")
    )
      throw new Error("公开文件路径不正确");
    const release = await realpath(configured);
    assertPublic(release);
    const filename = await realpath(path.join(release, relativeFile));
    if (!inside(release, filename) || filename === release)
      throw new Error("公开文件不得链接至发行目录之外");
    assertPublic(filename);
    const info = await lstat(filename);
    if (!info.isFile() || info.nlink !== 1)
      throw new Error("公开文件必须是普通独占文件");
    return filename;
  };
}

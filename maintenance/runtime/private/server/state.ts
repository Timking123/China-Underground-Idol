import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { encode } from "../src/sourceCapture.ts";
import { requireState } from "../src/sourceRegistry.ts";

export async function regularPath(
  path: string,
  allowMissing = false,
): Promise<void> {
  requireState(isAbsolute(path), "state_absolute_path_required");
  let current = resolve(path);
  while (true) {
    try {
      const stat = await lstat(current);
      requireState(!stat.isSymbolicLink(), "state_symbolic_link_rejected");
      requireState(
        stat.isDirectory() ||
          (current === path && stat.isFile() && stat.nlink === 1),
        "state_nonregular_path",
      );
    } catch (error) {
      if (!(allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT"))
        throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function privateDirectory(path: string): Promise<void> {
  await regularPath(path, true);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await regularPath(path);
  const stat = await lstat(path);
  requireState(stat.isDirectory(), "state_directory_required");
  if (process.platform !== "win32")
    requireState((stat.mode & 0o077) === 0, "state_directory_not_private");
}

export async function writeOnce(path: string, data: unknown): Promise<void> {
  const bytes = Buffer.from(encode(data));
  requireState(bytes.length <= 1024 * 1024, "state_record_too_large");
  await privateDirectory(dirname(path));
  await regularPath(path, true);
  const handle = await open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== "win32") {
    const directory = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

export async function readOptional(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    await regularPath(path);
    const stat = await lstat(path);
    requireState(
      stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024,
      "state_record_invalid",
    );
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listDirectories(path: string): Promise<string[]> {
  await privateDirectory(path);
  const entries = await readdir(path, { withFileTypes: true });
  requireState(
    entries.every((entry) => entry.isDirectory() && !entry.isSymbolicLink()),
    "state_run_directory_invalid",
  );
  return entries.map((entry) => entry.name).sort();
}

export function safeFailure(error: unknown): string {
  const value = error instanceof Error ? error.message : "maintenance_failure";
  return /^[a-z][a-z0-9_]{0,94}$/u.test(value) ? value : "maintenance_failure";
}

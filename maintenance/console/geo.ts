import { existsSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import {
  IPv4,
  IPv6,
  newWithVectorIndex,
  loadVectorIndexFromFile,
  verify,
} from "ip2region.js";
import type { Region } from "../../src/admin/contracts.ts";

export interface GeoLocator {
  ready: boolean;
  locate(ip: string): Promise<Region>;
  close(): void;
}
const unknown: Region = { country: "未知", province: "未知", city: "未知" };
export function createGeoLocator(directory?: string): GeoLocator {
  const files = directory
    ? [
        path.join(directory, "ip2region_v4.xdb"),
        path.join(directory, "ip2region_v6.xdb"),
      ]
    : [];
  if (files.length !== 2 || !files.every(existsSync))
    return { ready: false, locate: async () => ({ ...unknown }), close() {} };
  const searchers: ReturnType<typeof newWithVectorIndex>[] = [];
  try {
    for (const file of files) {
      // 官方 verifyFromFile 在抛错时不会关闭 fd，这里显式保证失败释放。
      const fd = openSync(file, "r");
      try {
        verify(fd);
      } finally {
        closeSync(fd);
      }
    }
    searchers.push(
      newWithVectorIndex(IPv4, files[0], loadVectorIndexFromFile(files[0])),
    );
    searchers.push(
      newWithVectorIndex(IPv6, files[1], loadVectorIndexFromFile(files[1])),
    );
  } catch {
    for (const searcher of searchers) searcher.close();
    console.error("IP 地区库不可用，访问地区将显示未知");
    return { ready: false, locate: async () => ({ ...unknown }), close() {} };
  }
  // 官方文件查询对象复用内部缓冲；逐次串行查询，避免并发 IO 覆盖缓冲。
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  return {
    ready: true,
    locate(ip) {
      const pending = queue.then(async () => {
        if (closed) return { ...unknown };
        if (
          /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(
            ip,
          ) ||
          ip === "::1" ||
          /^(?:fc|fd|fe80:)/iu.test(ip)
        )
          return { country: "本地网络", province: "未知", city: "未知" };
        const result = await searchers[isIP(ip) === 6 ? 1 : 0].search(ip);
        const parts = result.split("|");
        const clean = (value: string | undefined): string =>
          value && value !== "0" && value.length <= 80 ? value : "未知";
        return {
          country: clean(parts[0]),
          province: clean(parts[1]),
          city: clean(parts[2]),
        };
      });
      queue = pending.catch(() => undefined);
      return pending.catch(() => ({ ...unknown }));
    },
    close() {
      if (closed) return;
      closed = true;
      for (const searcher of searchers) searcher.close();
    },
  };
}

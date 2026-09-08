import { validateCatalog } from "./model";

declare global {
  interface Window {
    IDOL_GROUPS_DATA?: unknown;
  }
}

/** 读取已加载的普通脚本数据，不抓取网络，也不把失败伪装为空列表。 */
export function readCatalog(): ReturnType<typeof validateCatalog> {
  if (typeof window === "undefined" || window.IDOL_GROUPS_DATA === undefined) {
    return { valid: false, errors: ["团体索引未加载，请检查资料脚本后重试。"] };
  }
  return validateCatalog(window.IDOL_GROUPS_DATA);
}

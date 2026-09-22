import { validateCatalog, type GroupCatalog } from "../catalog/model";
import { validateEventDataset, type EventDataset } from "../events/model";

export interface GroupPageData {
  schemaVersion: "idol-group-page-v1";
  catalog: GroupCatalog;
  events: EventDataset;
}
type Fetcher = (
  input: string,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** HTTP 页面按需加载；file 模式由调用方保留旧普通脚本路径降级。 */
async function load(path: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(path);
  if (!response.ok) throw new Error("资料暂时无法读取，请稍后重试。");
  return response.json();
}

export async function loadCatalogPage(
  fetcher: Fetcher = (url) => window.fetch(url),
): Promise<GroupCatalog> {
  const result = validateCatalog(
    await load("assets/page-data/catalog.json", fetcher),
  );
  if (!result.valid) throw new Error("团体列表资料校验失败。");
  return result.data;
}

export async function loadGroupPage(
  groupId: string,
  fetcher: Fetcher = (url) => window.fetch(url),
): Promise<GroupPageData> {
  if (!/^g\d{3,8}$/.test(groupId) || groupId.trim() !== groupId)
    throw new Error("团体编号无效。");
  const input = await load(`assets/page-data/groups/${groupId}.json`, fetcher);
  if (
    !input ||
    typeof input !== "object" ||
    !("schemaVersion" in input) ||
    input.schemaVersion !== "idol-group-page-v1" ||
    !("catalog" in input) ||
    !("events" in input)
  )
    throw new Error("团体档案格式无效。");
  const catalog = validateCatalog(input.catalog);
  // 发布时已用全档案校验关联；单页只携带实际出现的参演者 ID。
  const associatedIds = new Set<string>();
  if (
    input.events &&
    typeof input.events === "object" &&
    "events" in input.events &&
    Array.isArray(input.events.events)
  ) {
    for (const event of input.events.events) {
      if (
        !event ||
        typeof event !== "object" ||
        !Array.isArray(event.performers)
      )
        continue;
      for (const performer of event.performers)
        if (
          performer &&
          typeof performer.groupId === "string" &&
          /^g\d{3,8}$/.test(performer.groupId)
        )
          associatedIds.add(performer.groupId);
    }
  }
  const events = validateEventDataset(input.events, associatedIds);
  if (
    !catalog.valid ||
    !events.valid ||
    catalog.data.groups.length !== 1 ||
    catalog.data.groups[0]?.id !== groupId ||
    events.data.events.some(
      (event) =>
        !event.performers.some((performer) => performer.groupId === groupId),
    )
  )
    throw new Error("团体档案关联校验失败。");
  return {
    schemaVersion: "idol-group-page-v1",
    catalog: catalog.data,
    events: events.data,
  };
}

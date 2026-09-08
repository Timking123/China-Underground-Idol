import { readCatalog } from "../catalog/runtime";
import rawDataset from "../../data/events.v1.json";
import { validateEventDataset } from "../events/model";
import { mountContribute, parseContributionContext } from "./contribute";

// 即使资料脚本失败，手动草稿仍可用；预填只使用通过校验的公开对象。
const catalog = readCatalog();
const groups = catalog.valid ? catalog.data.groups : [];
const dataset = validateEventDataset(
  rawDataset,
  groups.map((group) => group.id),
);
mountContribute(
  document,
  parseContributionContext(
    window.location.search,
    groups,
    dataset.valid ? dataset.data.events : [],
    window.location.href,
  ),
);

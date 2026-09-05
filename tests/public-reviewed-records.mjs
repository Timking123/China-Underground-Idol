import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "data.js"), "utf8"),
  context,
);
const data = context.window.IDOL_MAP_DATA;
const review = JSON.parse(
  fs.readFileSync(path.join(root, "data/公开补充复核.json"), "utf8"),
);
const ids = new Set(data.groups.map((group) => group.id));
assert.equal(
  ids.size,
  399,
  "完整档案应保留 399 条，不能用补充覆盖删除历史条目",
);
assert.equal(data.groups.filter((group) => group.isActive).length, 375);
assert.equal(data.meta.population.active, 375);
for (const record of review.records) {
  const group = data.groups.find((item) => item.id === record.id);
  assert.ok(group, `${record.id} 缺少展示记录`);
  assert.equal(group.handle, record.expectedHandle);
  assert.equal(group.publicReview.reviewedAt, record.reviewedAt);
  if (record.status) {
    assert.equal(group.status, record.status.value);
    assert.equal(group.isActive, false);
    assert.equal(group.evidenceUrl, null, "用户确认不能伪装为旧官号公告");
  }
  if (!record.profile) continue;
  assert.equal(group.weiboUid, record.profile.uid);
  assert.equal(group.followersValue, record.profile.followersValue);
  assert.equal(group.followersApproximate, record.profile.followersApproximate);
  assert.equal(group.profileObservedAt, record.profile.observedAt);
  assert.equal(
    group.stylePlacement.comparable,
    false,
    "多团账号不可视为单团音乐风格",
  );
  const band = data.bands.find((item) => item.label === group.styleBand);
  assert.ok(band && group.y >= band.top && group.y <= band.bottom);
  assert.ok(
    data.metadata.regionOptions.some((province) =>
      province.cities.some(
        (city) => city.cityKey === group.regionPlacement.cityKey,
      ),
    ),
  );
  for (const asset of [
    group.weiboAvatarPath,
    group.preferredVisual.assetPath,
  ]) {
    assert.ok(
      fs.statSync(path.join(root, asset)).size > 0,
      `缺少素材：${asset}`,
    );
  }
  assert.equal(group.preferredVisual.kind, "brand_visual");
  assert.equal(
    group.strictSnapshot.profile.weiboUid,
    null,
    "不得改写严格历史 UID",
  );
}
assert.equal(
  data.groups.find((group) => group.id === "g123").isActive,
  true,
  "不能误改另一个 Lumina-Official",
);
assert.equal(
  data.groups.find((group) => group.id === "g060").wiki.state,
  "exact_page",
);
assert.equal(
  data.groups.find((group) => group.id === "g360").wiki.pageUrl,
  null,
);
console.log("公开补充资料与历史隔离回归：PASS");

import { parseWeeklyRuntimeInputs } from "../src/weeklyScope.ts";

export const TEST_NOW = "2026-09-09T10:00:00.000Z";
export const clone = (value) => JSON.parse(JSON.stringify(value));

/** 合成源不写入正式 runtime；只复现受审来源的结构及原身份类别。 */
export function weeklyFixture(count = 375) {
  const model = {
    display: { groups: [] },
    master: { groups: [] },
    editorial: { schemaVersion: "1.0", records: [] },
    publicReview: {
      schemaVersion: "public-reviewed-supplement-v1",
      records: [],
    },
    conflicts: {
      schemaVersion: "weibo-official-strict-master-conflicts-v1",
      records: [],
    },
    acceptance: { schemaVersion: "synthetic", records: [] },
    supplement: { schemaVersion: "synthetic", records: [] },
    edge: { schemaVersion: "synthetic", records: [] },
  };
  let strict = 0;
  for (let index = 1; model.display.groups.length < count; index += 1) {
    if ([275, 303].includes(index)) continue;
    const id = `g${String(index).padStart(3, "0")}`,
      uid =
        index === 60
          ? "2030310713"
          : index === 360
            ? "8257746955"
            : String(10_000_000_000 + index);
    const group = {
      id,
      name: `合成账号${index}`,
      handle: `@fixture_${index}`,
      status: "确认存续",
      isActive: true,
      weiboUid: uid,
      uidSource: "weibo_browser_profile",
      uidConfidence: "high",
      profileUrl: `https://weibo.com/u/${uid}`,
      profileObservedAt: "2026-09-09T08:00:00.000Z",
      followersValue: 1000,
      followersApproximate: false,
      fieldEvidence: {
        profileIdentity: {
          state: "verified",
          confidence: "high",
          candidateUid: uid,
          method: "synthetic_uid_evidence",
        },
      },
    };
    if ([60, 360].includes(index)) {
      const record = {
        id,
        expectedHandle: group.handle,
        entityKind: index === 60 ? "事务所账号" : "多团企划",
        summary: "这是已复核账号范围，粉丝不属于旗下任意单团。",
        profile: {
          uid,
          sourceUrl: group.profileUrl,
          observedAt: group.profileObservedAt,
          followersValue: 1000,
          followersApproximate: false,
        },
      };
      group.uidSource = "public_reviewed_account_scope";
      group.fieldEvidence.profileIdentity.state = "blocked";
      group.publicReview = record;
      model.publicReview.records.push(record);
      model.conflicts.records.push({ id, uid, reason: "不是单团账号" });
    } else if (strict < 279) {
      strict += 1;
    } else {
      const note = `合成编辑接受理由${id}`;
      group.uidSource = "editorial_profile_supplement";
      group.fieldEvidence.profileIdentity.state = "not_found";
      group.editorialProfileSupplement = {
        state: "accepted_candidate",
        uid,
        profileUrl: group.profileUrl,
        appliedFields: ["identity"],
        identityReason: note,
      };
      model.editorial.records.push({
        id,
        profileSupplement: {
          ...group.editorialProfileSupplement,
          sourceFile: "sources/微博编辑身份接受批次_2026-09-04.json",
        },
      });
      model.acceptance.records.push({
        id,
        uid,
        status: "accepted",
        identityEvidenceSummary: note,
        reviewBasis: "synthetic_editorial_acceptance",
      });
    }
    model.display.groups.push(group);
    const master = clone(group);
    if (group.uidSource !== "weibo_browser_profile") {
      master.weiboUid = null;
      master.uidConfidence = null;
    }
    model.master.groups.push(master);
  }
  for (const index of [
    275,
    303,
    ...Array.from({ length: 22 }, (_, i) => 1001 + i),
  ]) {
    const id = `g${index}`;
    model.display.groups.push({
      id,
      name: `合成排除${index}`,
      isActive: false,
      status: [275, 303].includes(index) ? "已解散" : "暂停",
      weiboUid: String(20_000_000_000 + index),
    });
    // 旧主档的存续布尔值不能覆盖当前受审展示的明确解散状态。
    model.master.groups.push({
      id,
      name: `合成旧档${index}`,
      isActive: true,
      status: "确认存续",
    });
  }
  return {
    model,
    inputs() {
      const value = (item) => Buffer.from(JSON.stringify(item) + "\n");
      return parseWeeklyRuntimeInputs({
        "display.js": Buffer.from(
          `window.IDOL_MAP_DATA=${JSON.stringify(model.display)};\n`,
        ),
        "master.json": value(model.master),
        "editorial.json": value(model.editorial),
        "public-review.json": value(model.publicReview),
        "conflicts.json": value(model.conflicts),
        "identity-acceptance.json": value(model.acceptance),
        "identity-supplement.json": value(model.supplement),
        "edge-review.json": value(model.edge),
      });
    },
  };
}

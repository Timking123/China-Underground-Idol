import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readJson } from "./mediaFiles.mjs";
import { escapeHtml, timeHtml } from "./prerenderFormat.mjs";

/** 使用 A 的唯一验证模型；核验快照与主档失配时终止构建。 */
export async function readVerification(root, events) {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/events/verification.ts", import.meta.url)),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const model = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  const input = await readJson(root, "data/event-verifications.v1.json");
  const validation = model.validateEventVerificationDataset(input, events);
  if (!validation.valid)
    throw new Error(`静态页核验层无效：${JSON.stringify(validation.errors)}`);
  return {
    record: (id) => model.getEventVerification(validation.data, id),
    field: (event, field) =>
      model.eventFieldLabel(
        event,
        model.getEventVerification(validation.data, event.id),
        field,
      ),
    navigation: (event) =>
      model.buildVenueNavigationUrl(
        event,
        model.getEventVerification(validation.data, event.id),
      ),
    labels: model.VERIFICATION_LABELS,
    roles: model.SOURCE_ROLE_LABELS,
    fieldLabels: model.VERIFICATION_FIELD_LABELS,
  };
}

export function verificationSection(event, verification) {
  const record = verification?.record(event.id);
  if (!record)
    return "<section><h2>资料核验</h2><p>尚未收录本活动的核验记录；原始资料不代表当前安排已确认。</p></section>";
  const e = escapeHtml;
  const navigation = verification.navigation(event);
  return `<section><h2>资料核验</h2><p>${e(verification.labels[record.outcome])} · 最近尝试 ${timeHtml(record.checkedAt)}</p><p>成功核验时间：${record.verifiedAt ? timeHtml(record.verifiedAt) : "尚无成功核验"}</p><p>${e(record.summary)}</p>${navigation ? `<p><a href="${e(navigation)}" rel="noopener noreferrer">打开已核验场馆导航</a></p>` : "<p>地址未满足可靠导航条件，请核对官宣。</p>"}<details><summary>查看 ${record.evidence.length} 条核验依据与字段变化</summary><ul>${record.evidence.map((item) => `<li><a href="${e(item.url)}" rel="noopener noreferrer">${e(item.publisher)} · ${e(verification.roles[item.role])}</a><p>${timeHtml(item.observedAt)} · ${e({ read: "已回读", unavailable: "无法读取", insufficient: "信息不足" }[item.result])}</p><p>${e(item.note)}</p></li>`).join("")}</ul>${record.changes.length ? `<h3>可追溯字段变化</h3><ul>${record.changes.map((item) => `<li>${e(verification.fieldLabels[item.field])}：${e(item.previous ?? "尚未收录")} → ${e(item.current ?? "尚未收录")}<p>${timeHtml(item.observedAt)} · ${e(item.reason)}</p><a href="${e(item.sourceUrl)}">变化来源</a></li>`).join("")}</ul>` : "<p>未记录可证明的字段变化。</p>"}</details></section>`;
}

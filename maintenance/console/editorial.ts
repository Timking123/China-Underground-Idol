import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  validateEventDataset,
  type EventDataset,
  type EventRecord,
} from "../../src/events/model.ts";
import {
  editorialFields,
  type EditorialBaseline,
  type EditorialCandidate,
  type EditorialDetail,
  type EditorialDiff,
  type EditorialEvidence,
  type EditorialField,
  type EditorialInput,
  type EditorialPatch,
  type EditorialReceipt,
  type EditorialRevision,
} from "../../src/admin/editorial-contracts.ts";
import type { Feedback } from "../../src/admin/contracts.ts";
import { ConsoleStore } from "./store.ts";
import { HttpError, object, textField } from "./validation.ts";

export const editorialSha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const encodeEditorialCandidate = (value: EditorialCandidate): string =>
  JSON.stringify(value, null, 2) + "\n";
const BUCKET = "editorial";
function strict(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const data = object(value);
  if (Object.keys(data).some((key) => !fields.includes(key)))
    throw new HttpError(400, "修订包含未允许字段");
  return data;
}
function digest(value: unknown): string {
  const hash = textField(value, 64, true);
  if (!/^[a-f0-9]{64}$/u.test(hash))
    throw new HttpError(400, "基线或候选哈希不正确");
  return hash;
}
function timestamp(value: unknown, now: number): string {
  const text = textField(value, 32, true);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().replace(".000Z", "Z") !==
      text.replace(".000Z", "Z") ||
    Date.parse(text) > now
  )
    throw new HttpError(400, "证据或审核时间须为真实且非未来的 UTC 时间");
  return text;
}
function safeUrl(value: unknown): string {
  const text = textField(value, 800, true);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "证据链接不正确");
  }
  const host = url.hostname.toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    isIP(host) ||
    host.startsWith("[") ||
    !host.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal)$/u.test(host) ||
    /(?:token|password|secret|authorization|cookie)/iu.test(url.search)
  )
    throw new HttpError(400, "证据须为不含凭据的公开网页链接");
  return text;
}
function publicText(value: unknown, maximum: number, required = true): string {
  const text = textField(value, maximum, required);
  if (
    /\b(?:authorization|set-cookie|cookie|access_token|refresh_token|client_secret|password)\s*["']?\s*[:=]|\bbearer\s+[a-z0-9._~-]{12,}/iu.test(
      text,
    )
  )
    throw new HttpError(400, "公开修订不能包含凭据");
  return text;
}
function baselineData(bytes: Uint8Array): EventDataset {
  if (bytes.length > 4 * 1024 * 1024)
    throw new HttpError(503, "活动基线超过读取上限");
  let input: unknown;
  try {
    input = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new HttpError(503, "活动基线无法解析");
  }
  // 本模块不能变更阵容；这里只保留公开基线已有的 ID，维护侧仍校验权威团体主档。
  const events = (input as { events?: unknown })?.events;
  const groupIds = new Set<string>();
  if (Array.isArray(events))
    for (const event of events) {
      if (event && typeof event === "object" && Array.isArray(event.performers))
        for (const performer of event.performers) {
          if (
            performer &&
            typeof performer === "object" &&
            typeof performer.groupId === "string"
          )
            groupIds.add(performer.groupId);
        }
    }
  const validated = validateEventDataset(input, groupIds);
  if (!validated.valid) throw new HttpError(503, "活动基线未通过资料校验");
  return validated.data;
}
export function editorialBaseline(bytes: Uint8Array): EditorialBaseline {
  const data = baselineData(bytes);
  return {
    baselineSha256: editorialSha256(bytes),
    updatedAt: data.updatedAt,
    fields: editorialFields,
    events: data.events.map(
      (event) =>
        ({
          id: event.id,
          ...Object.fromEntries(
            editorialFields.map((field) => [field, event[field]]),
          ),
        }) as EditorialBaseline["events"][number],
    ),
  };
}
function parseInput(value: unknown, now: number): EditorialInput {
  const data = strict(value, [
    "feedbackId",
    "baselineSha256",
    "target",
    "patch",
    "evidence",
    "rationale",
  ]);
  const target = strict(data.target, ["kind", "id"]);
  const id = textField(target.id, 160, true);
  if (target.kind !== "event" || !/^e-[a-z0-9-]+$/u.test(id))
    throw new HttpError(400, "请选择有效的稳定活动编号");
  const feedbackId = textField(data.feedbackId, 24, true);
  if (!/^[a-f0-9]{24}$/u.test(feedbackId))
    throw new HttpError(400, "投稿编号不正确");
  const patchValue = strict(data.patch, editorialFields);
  if (!Object.keys(patchValue).length)
    throw new HttpError(400, "至少修订一个字段");
  const patch: EditorialPatch = {};
  for (const field of editorialFields)
    if (Object.hasOwn(patchValue, field))
      patch[field] =
        patchValue[field] === null
          ? null
          : publicText(patchValue[field], 2000, false);
  if (
    !Array.isArray(data.evidence) ||
    !data.evidence.length ||
    data.evidence.length > 12
  )
    throw new HttpError(400, "请提供 1 至 12 条可核对证据");
  const evidence: EditorialEvidence[] = data.evidence.map((item) => {
    const source = strict(item, [
      "captureId",
      "url",
      "label",
      "publisher",
      "kind",
      "observedAt",
      "excerpt",
      "supports",
    ]);
    const captureId = textField(source.captureId, 180);
    if (
      (captureId && !/^[a-zA-Z0-9_-]+$/u.test(captureId)) ||
      !["official", "organizer", "venue", "ticketing"].includes(
        String(source.kind),
      )
    )
      throw new HttpError(400, "证据档案编号或来源类型不正确");
    if (
      !Array.isArray(source.supports) ||
      !source.supports.length ||
      source.supports.some(
        (field) =>
          !editorialFields.includes(field as EditorialField) ||
          !Object.hasOwn(patch, String(field)),
      ) ||
      new Set(source.supports).size !== source.supports.length
    )
      throw new HttpError(400, "证据支持字段须与本次修订对应");
    return {
      captureId,
      url: safeUrl(source.url),
      label: publicText(source.label, 160),
      publisher: publicText(source.publisher, 160),
      kind: source.kind as EditorialEvidence["kind"],
      observedAt: timestamp(source.observedAt, now),
      excerpt: publicText(source.excerpt, 3000),
      supports: source.supports as EditorialField[],
    };
  });
  for (const field of Object.keys(patch))
    if (
      !evidence.some((item) => item.supports.includes(field as EditorialField))
    )
      throw new HttpError(400, `字段 ${field} 缺少证据`);
  const captureIds = evidence.map((item) => item.captureId).filter(Boolean);
  if (new Set(captureIds).size !== captureIds.length)
    throw new HttpError(400, "证据档案编号重复");
  const rationale = publicText(data.rationale, 2000);
  if (rationale.length < 11)
    throw new HttpError(400, "请至少用 11 个字符说明修订依据");
  return {
    feedbackId,
    baselineSha256: digest(data.baselineSha256),
    target: { kind: "event", id },
    patch,
    evidence,
    rationale,
  };
}
function applyInput(
  input: EditorialInput,
  bytes: Uint8Array,
): { event: EventRecord; diff: EditorialDiff[] } {
  if (input.baselineSha256 !== editorialSha256(bytes))
    throw new HttpError(409, "公开基线已变化，请重新载入并核对修订");
  const data = baselineData(bytes);
  const old = data.events.find((item) => item.id === input.target.id);
  if (!old) throw new HttpError(404, "当前公开基线不存在该活动");
  const diff: EditorialDiff[] = [];
  for (const field of editorialFields)
    if (Object.hasOwn(input.patch, field)) {
      const after = input.patch[field]!;
      if (after === old[field])
        throw new HttpError(400, `字段 ${field} 没有变化`);
      diff.push({ field, before: old[field], after });
    }
  const event = { ...structuredClone(old), ...input.patch } as EventRecord;
  // 公开来源只从已验证格式的证据映射，不接受任意 sources 对象。
  for (const item of input.evidence) {
    const source = {
      url: item.url,
      label: item.label,
      publisher: item.publisher,
      kind: item.kind,
      observedAt: item.observedAt,
    };
    event.sources = event.sources.filter(
      (existing) => existing.url !== source.url,
    );
    event.sources.push(source);
  }
  const checked = validateEventDataset(
    {
      ...data,
      events: data.events.map((item) => (item.id === old.id ? event : item)),
    },
    data.events.flatMap((item) =>
      item.performers.flatMap((performer) =>
        performer.groupId ? [performer.groupId] : [],
      ),
    ),
  );
  if (!checked.valid)
    throw new HttpError(
      400,
      `修订不符合公开资料契约：${checked.errors[0]?.message ?? "无效字段"}`,
    );
  return { event, diff };
}
/** 维护侧必须再使用真实 SourceCapture 与 prepareEventUpdate 完成证据和发布验证。 */
export function prepareEditorialCandidate(
  value: unknown,
  bytes: Uint8Array,
  now = Date.now(),
): {
  candidate: EditorialCandidate;
  candidateSha256: string;
  event: EventRecord;
  diff: EditorialDiff[];
} {
  const data = strict(value, [
    "schemaVersion",
    "candidateId",
    "revisionId",
    "revisionVersion",
    "reviewedBy",
    "reviewedAt",
    "feedbackId",
    "baselineSha256",
    "target",
    "patch",
    "evidence",
    "rationale",
  ]);
  if (
    data.schemaVersion !== "idol-editorial-candidate-v1" ||
    !Number.isSafeInteger(data.revisionVersion) ||
    Number(data.revisionVersion) < 1
  )
    throw new HttpError(400, "候选版本不正确");
  for (const field of ["candidateId", "revisionId"])
    if (!/^[a-f0-9-]{36}$/u.test(String(data[field])))
      throw new HttpError(400, "候选编号不正确");
  const input = parseInput(
    Object.fromEntries(
      [
        "feedbackId",
        "baselineSha256",
        "target",
        "patch",
        "evidence",
        "rationale",
      ].map((key) => [key, data[key]]),
    ),
    now,
  );
  const candidate: EditorialCandidate = {
    ...input,
    schemaVersion: "idol-editorial-candidate-v1",
    candidateId: String(data.candidateId),
    revisionId: String(data.revisionId),
    revisionVersion: Number(data.revisionVersion),
    reviewedBy: textField(data.reviewedBy, 64, true),
    reviewedAt: timestamp(data.reviewedAt, now),
  };
  if (candidate.evidence.some((item) => !item.captureId))
    throw new HttpError(409, "来源尚未关联受信维护归档，请完成核验后交付");
  if (
    Date.parse(candidate.reviewedAt) <
      Date.parse(baselineData(bytes).updatedAt) ||
    candidate.evidence.some(
      (item) => Date.parse(item.observedAt) > Date.parse(candidate.reviewedAt),
    )
  )
    throw new HttpError(400, "审核时间早于基线或证据观察时间");
  return {
    candidate,
    candidateSha256: editorialSha256(encodeEditorialCandidate(candidate)),
    ...applyInput(input, bytes),
  };
}
export function getEditorialRevision(
  store: ConsoleStore,
  id: string,
): EditorialRevision {
  const revision = store.get<EditorialRevision>(BUCKET, id);
  if (!revision) throw new HttpError(404, "修订不存在");
  return revision;
}
export function editorialDetail(
  store: ConsoleStore,
  id: string,
  bytes: Uint8Array,
): EditorialDetail {
  const revision = getEditorialRevision(store, id);
  const baselineConflict = revision.baselineSha256 !== editorialSha256(bytes);
  const diff = store.get<EditorialDiff[]>("editorial-diff", id) ?? [];
  return { revision, diff, baselineConflict };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
/** 幂等记录与业务修改同事务；失败不消耗请求键，重放不重复审计。 */
export function mutateEditorial(
  store: ConsoleStore,
  action: "create" | "edit" | "review" | "handoff" | "withdraw",
  id: string | null,
  value: unknown,
  bytes: Uint8Array | null,
  actor: string,
  now: number,
  authorize: () => void,
): EditorialRevision {
  const data = object(value);
  const requestId = textField(data.requestId, 36, true);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      requestId,
    )
  )
    throw new HttpError(400, "请求编号不正确");
  const requestHash = editorialSha256(canonical({ action, id, data }));
  const requestKey = store.vault.tag(
    "editorial-request",
    `${actor}/${requestId}`,
  );
  return store.transaction(() => {
    authorize();
    const previous = store.get<{ hash: string; result: EditorialRevision }>(
      "editorial-requests",
      requestKey,
    );
    if (previous) {
      if (previous.hash !== requestHash)
        throw new HttpError(409, "请求编号已用于不同内容");
      return previous.result;
    }
    let revision: EditorialRevision;
    let diff: EditorialDiff[] | undefined;
    if (action === "create" || action === "edit") {
      strict(data, ["requestId", "expectedVersion", "input"]);
      const input = parseInput(data.input, now);
      if (!store.get<Feedback>("feedback", input.feedbackId))
        throw new HttpError(404, "关联投稿不存在");
      if (!bytes) throw new HttpError(503, "公开基线不可用");
      diff = applyInput(input, bytes).diff;
      if (action === "create") {
        if (data.expectedVersion !== 0)
          throw new HttpError(409, "新建修订版本须为零");
        revision = {
          ...input,
          id: randomUUID(),
          version: 1,
          status: "draft",
          createdAt: now,
          updatedAt: now,
          actor,
          reviewNote: "",
          reviewedBy: null,
          reviewedAt: null,
          candidate: null,
          candidateSha256: null,
          receipt: null,
          history: [],
        };
      } else {
        revision = getEditorialRevision(store, id!);
        if (data.expectedVersion !== revision.version)
          throw new HttpError(409, "修订已被更新，请刷新后重试");
        if (!["draft", "approved", "rejected"].includes(revision.status))
          throw new HttpError(409, "已交付或已结束的修订不能编辑，请新建修订");
        if (
          input.feedbackId !== revision.feedbackId ||
          input.target.id !== revision.target.id
        )
          throw new HttpError(409, "修订不能更换投稿或目标身份");
        revision = {
          ...revision,
          ...input,
          version: revision.version + 1,
          status: "draft",
          updatedAt: now,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: "",
        };
      }
    } else {
      strict(data, [
        "requestId",
        "expectedVersion",
        ...(action === "review"
          ? ["decision", "note"]
          : action === "withdraw"
            ? ["note"]
            : []),
      ]);
      revision = getEditorialRevision(store, id!);
      if (data.expectedVersion !== revision.version)
        throw new HttpError(409, "修订已被更新，请刷新后重试");
      if (action === "review") {
        if (
          !["draft", "rejected"].includes(revision.status) ||
          !["approve", "reject"].includes(String(data.decision))
        )
          throw new HttpError(409, "当前状态不能执行此审核");
        const note = textField(data.note, 2000, true);
        if (data.decision === "approve") {
          if (!bytes) throw new HttpError(503, "公开基线不可用");
          applyInput(revision, bytes);
          if (revision.evidence.some((item) => !item.captureId))
            throw new HttpError(409, "来源尚未关联受信维护归档，修订仍待核验");
          if (
            Date.parse(baselineData(bytes).updatedAt) > now ||
            revision.evidence.some((item) => Date.parse(item.observedAt) > now)
          )
            throw new HttpError(409, "基线或证据时间晚于当前审核时间");
        }
        revision = {
          ...revision,
          status: data.decision === "approve" ? "approved" : "rejected",
          reviewNote: note,
          reviewedBy: actor,
          reviewedAt: new Date(now).toISOString(),
        };
      } else if (action === "handoff") {
        if (
          revision.status !== "approved" ||
          !revision.reviewedBy ||
          !revision.reviewedAt
        )
          throw new HttpError(409, "仅已审核修订可交付");
        if (!bytes) throw new HttpError(503, "公开基线不可用");
        const candidate: EditorialCandidate = {
          schemaVersion: "idol-editorial-candidate-v1",
          candidateId: randomUUID(),
          revisionId: revision.id,
          revisionVersion: revision.version,
          feedbackId: revision.feedbackId,
          baselineSha256: revision.baselineSha256,
          target: revision.target,
          patch: revision.patch,
          evidence: revision.evidence,
          rationale: revision.rationale,
          reviewedBy: revision.reviewedBy,
          reviewedAt: revision.reviewedAt,
        };
        const prepared = prepareEditorialCandidate(candidate, bytes, now);
        revision = {
          ...revision,
          status: "handed_off",
          candidate: prepared.candidate,
          candidateSha256: prepared.candidateSha256,
        };
      } else {
        const note = textField(data.note, 2000, true);
        if (
          !["draft", "approved", "rejected", "handed_off"].includes(
            revision.status,
          )
        )
          throw new HttpError(409, "当前状态不能撤回；已应用资料须另建修订");
        revision = {
          ...revision,
          status:
            revision.status === "handed_off"
              ? "withdrawal_requested"
              : "withdrawn",
          reviewNote: note,
        };
      }
      revision = { ...revision, version: revision.version + 1, updatedAt: now };
    }
    revision.history.push({
      at: now,
      actor,
      action,
      note:
        action === "review" || action === "withdraw" ? revision.reviewNote : "",
    });
    // 常规历史最多100条；单次撤回额外保留一条，再由单次维护回执终结，最多102条。
    // 不能让编辑次数耗尽撤回名额，已交付候选仍必须能够停止消费。
    if (revision.history.length > (action === "withdraw" ? 101 : 100))
      throw new HttpError(409, "修订历史已满，请新建修订");
    store.put(BUCKET, revision.id, revision, now);
    if (diff) store.put("editorial-diff", revision.id, diff, now);
    store.audit(`资料修订:${action}`, revision.id, actor, now);
    store.put(
      "editorial-requests",
      requestKey,
      { hash: requestHash, result: revision },
      now,
    );
    return revision;
  });
}
/** 维护锁内、应用前调用；撤回请求立即令尚未消费的候选失效。 */
export function getEditorialHandoff(
  store: ConsoleStore,
  revisionId: string,
): { candidate: EditorialCandidate; candidateSha256: string } {
  const revision = getEditorialRevision(store, revisionId);
  if (
    revision.status !== "handed_off" ||
    !revision.candidate ||
    !revision.candidateSha256
  )
    throw new HttpError(409, "候选未交付、已撤回或已有结果");
  return {
    candidate: revision.candidate,
    candidateSha256: revision.candidateSha256,
  };
}
/** 仅供可信维护进程本地调用；HTTP 不提供提交成功回执的入口。 */
export function recordEditorialReceipt(
  store: ConsoleStore,
  revisionId: string,
  value: unknown,
  actor: string,
  now = Date.now(),
): EditorialRevision {
  const data = strict(value, [
    "schemaVersion",
    "candidateId",
    "candidateSha256",
    "baselineSha256",
    "resultSha256",
    "status",
    "runId",
    "publicationId",
    "snapshotManifestSha256",
    "message",
    "completedAt",
  ]);
  if (
    data.schemaVersion !== "idol-editorial-receipt-v1" ||
    !["applied", "rejected", "withdrawn"].includes(String(data.status))
  )
    throw new HttpError(400, "维护回执格式不正确");
  const receipt: EditorialReceipt = {
    schemaVersion: "idol-editorial-receipt-v1",
    candidateId: textField(data.candidateId, 36, true),
    candidateSha256: digest(data.candidateSha256),
    baselineSha256: digest(data.baselineSha256),
    resultSha256: data.resultSha256 === null ? null : digest(data.resultSha256),
    status: data.status as EditorialReceipt["status"],
    runId: textField(data.runId, 160, true),
    publicationId:
      data.publicationId === null
        ? null
        : textField(data.publicationId, 160, true),
    snapshotManifestSha256:
      data.snapshotManifestSha256 === null
        ? null
        : digest(data.snapshotManifestSha256),
    message: textField(data.message, 2000, true),
    completedAt: timestamp(data.completedAt, now),
  };
  return store.transaction(() => {
    const revision = getEditorialRevision(store, revisionId);
    if (revision.receipt) {
      if (canonical(revision.receipt) !== canonical(receipt))
        throw new HttpError(409, "维护结果已冻结，不能覆盖");
      return revision;
    }
    // 完整快照提交可能先于撤回、回执入库却晚于撤回；不能让较晚的撤回时间掩盖真实完成。
    const earliestCompletion =
      receipt.status === "applied"
        ? revision.history.find((item) => item.action === "handoff")?.at
        : revision.updatedAt;
    if (
      !revision.candidate ||
      revision.candidate.candidateId !== receipt.candidateId ||
      revision.candidateSha256 !== receipt.candidateSha256 ||
      revision.baselineSha256 !== receipt.baselineSha256 ||
      earliestCompletion === undefined ||
      Date.parse(receipt.completedAt) < earliestCompletion
    )
      throw new HttpError(409, "回执与候选、基线或时间不一致");
    if (
      !["handed_off", "withdrawal_requested"].includes(revision.status) ||
      (receipt.status === "applied" &&
        (!receipt.publicationId ||
          !receipt.snapshotManifestSha256 ||
          !receipt.resultSha256 ||
          receipt.resultSha256 === receipt.baselineSha256))
    )
      throw new HttpError(409, "维护回执缺少实际应用与发布依据");
    if (
      receipt.status !== "applied" &&
      (receipt.publicationId !== null ||
        receipt.resultSha256 !== null ||
        receipt.snapshotManifestSha256 !== null)
    )
      throw new HttpError(400, "未应用回执不能携带发布结果");
    const next: EditorialRevision = {
      ...revision,
      version: revision.version + 1,
      updatedAt: now,
      status:
        receipt.status === "applied"
          ? "applied"
          : receipt.status === "withdrawn"
            ? "withdrawn"
            : "failed",
      receipt,
      history: [
        ...revision.history,
        {
          at: now,
          actor,
          action: `receipt:${receipt.status}`,
          note: receipt.message,
        },
      ],
    };
    store.put(BUCKET, revisionId, next, now);
    store.audit(`资料修订:receipt:${receipt.status}`, revisionId, actor, now);
    return next;
  });
}

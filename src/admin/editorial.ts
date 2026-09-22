import { element, link } from "../groups/dom";
import type { Feedback, PageResult } from "./contracts";
import {
  editorialFields,
  editorialFieldLabels,
  editorialStatusLabels,
  type EditorialBaseline,
  type EditorialDetail,
  type EditorialEvidence,
  type EditorialField,
  type EditorialInput,
  type EditorialPatch,
  type EditorialRevision,
} from "./editorial-contracts";

type Api = <T>(endpoint: string, method?: string, body?: unknown) => Promise<T>;
let fieldNumber = 0;
const display = (value: string | null, name?: EditorialField): string => {
  if (name === "status" && value) {
    const labels: Record<string, string> = {
      scheduled: "已确认",
      unconfirmed: "尚未核实",
      cancelled: "已取消",
      postponed: "已延期",
    };
    return labels[value] ?? value;
  }
  return value === null ? "尚未公布" : value || "（空）";
};
const time = (value: number | string): string =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
function field(
  label: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): HTMLLabelElement {
  const node = element("label", "", "editorial-field");
  const text = element("span", label);
  text.id = `editorial-field-${++fieldNumber}`;
  control.setAttribute("aria-labelledby", text.id);
  node.append(text, control);
  return node;
}
function input(value = "", maxLength = 2000): HTMLInputElement {
  const node = element("input");
  node.value = value;
  node.maxLength = maxLength;
  return node;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const node = element("button", label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function statusNode(): HTMLParagraphElement {
  const node = element("p", "", "form-status");
  node.setAttribute("role", "status");
  return node;
}
function diffTable(
  rows: {
    field: EditorialField;
    before: string | null;
    after: string | null;
  }[],
  beforeLabel = "当前公开资料",
): HTMLElement {
  const root = element("div", "", "editorial-diff");
  for (const row of rows) {
    const item = element("section", "", "editorial-diff-row");
    item.append(element("h4", editorialFieldLabels[row.field]));
    const before = element("div", "", "editorial-before");
    const after = element("div", "", "editorial-after");
    before.append(
      element("small", beforeLabel),
      element("p", display(row.before, row.field)),
    );
    after.append(
      element("small", "本次修订"),
      element("p", display(row.after, row.field)),
    );
    item.append(before, after);
    root.append(item);
  }
  return root;
}

export async function renderEditorial(
  api: Api,
  feedback?: Feedback | null,
): Promise<HTMLElement> {
  const root = element("section", "", "panel editorial-workspace");
  root.append(
    element("h2", "活动资料修订"),
    element(
      "p",
      "关联读者投稿，核对来源和差异，再交给维护流程。团体资料继续在投稿与反馈中核实处理。",
      "muted",
    ),
  );
  const [baseline, page] = await Promise.all([
    api<EditorialBaseline>("editorial/baseline"),
    api<PageResult<EditorialRevision>>("editorial?page=1"),
  ]);
  const actions = element("div", "", "toolbar");
  const workspace = element("div", "", "editorial-detail");
  const list = element("div", "", "editorial-list");
  const listStatus = statusNode();
  const pager = element("div", "", "pagination");
  let listGeneration = 0;
  let detailGeneration = 0;
  let pending = false;
  let activePage = 1;
  function guarded(action: () => void): void {
    if (pending) {
      listStatus.textContent = "正在保存，请稍候。";
      return;
    }
    action();
  }
  function drawList(result: PageResult<EditorialRevision>): void {
    activePage = result.page;
    list.hidden = false;
    list.replaceChildren();
    if (!result.total)
      list.append(
        element(
          "p",
          "尚无结构化修订。从投稿详情选择“整理活动修订”，或使用投稿编号新建。",
          "empty-state",
        ),
      );
    for (const revision of result.items) {
      const eventTitle =
        baseline.events.find((event) => event.id === revision.target.id)
          ?.title ?? revision.target.id;
      const row = button(
        `${editorialStatusLabels[revision.status]} · ${eventTitle} · ${time(revision.updatedAt)}`,
        () =>
          guarded(() => {
            void open(revision.id);
          }),
      );
      row.className = "editorial-list-item";
      list.append(row);
    }
    pager.replaceChildren();
    if (result.total > result.pageSize) {
      const previous = button("上一页", () =>
        guarded(() => {
          void refreshList(result.page - 1);
        }),
      );
      const next = button("下一页", () =>
        guarded(() => {
          void refreshList(result.page + 1);
        }),
      );
      previous.disabled = result.page <= 1;
      next.disabled = result.page * result.pageSize >= result.total;
      pager.append(
        previous,
        element("span", `第 ${result.page} 页 · 共 ${result.total} 条`),
        next,
      );
    }
  }
  async function refreshList(pageNumber = activePage): Promise<void> {
    const generation = ++listGeneration;
    try {
      const result = await api<PageResult<EditorialRevision>>(
        `editorial?page=${pageNumber}`,
      );
      if (generation === listGeneration) drawList(result);
    } catch (error) {
      listStatus.textContent =
        error instanceof Error ? error.message : "无法载入修订";
    }
  }
  async function open(id: string): Promise<void> {
    const generation = ++detailGeneration;
    workspace.replaceChildren(element("p", "正在读取修订与基线…"));
    try {
      const detail = await api<EditorialDetail>(`editorial/${id}`);
      if (generation === detailGeneration) drawDetail(detail);
    } catch (error) {
      if (generation === detailGeneration)
        workspace.replaceChildren(
          element("p", error instanceof Error ? error.message : "读取失败"),
        );
    }
  }
  function drawDetail(detail: EditorialDetail): void {
    const { revision } = detail;
    workspace.replaceChildren();
    const title = element(
      "h3",
      `${editorialStatusLabels[revision.status]} · 第 ${revision.version} 版`,
    );
    title.tabIndex = -1;
    workspace.append(
      title,
      element(
        "p",
        baseline.events.find((event) => event.id === revision.target.id)
          ?.title ?? revision.target.id,
        "muted",
      ),
    );
    if (
      detail.baselineConflict &&
      [
        "draft",
        "approved",
        "rejected",
        "handed_off",
        "withdrawal_requested",
      ].includes(revision.status)
    )
      workspace.append(
        element(
          "p",
          ["handed_off", "withdrawal_requested"].includes(revision.status)
            ? "当前公开基线已变化。本候选不能覆盖变化后的资料，请等待维护结果或申请撤回。"
            : "当前公开基线已变化。以下为保存时的差异；交付前须重新载入基线、核对并审核。",
          "editorial-warning",
        ),
      );
    workspace.append(
      diffTable(detail.diff, "保存时的公开资料"),
      element("h4", "修订依据"),
      element("p", revision.rationale),
    );
    for (const evidence of revision.evidence) {
      const section = element("section", "", "editorial-evidence");
      section.append(
        link(evidence.label, evidence.url, true),
        element(
          "p",
          `${evidence.publisher} · 观察于 ${time(evidence.observedAt)}`,
          "muted",
        ),
        element("blockquote", evidence.excerpt),
        element(
          "p",
          `支持：${evidence.supports.map((name) => editorialFieldLabels[name]).join("、")}`,
        ),
      );
      section.append(
        element(
          "p",
          evidence.captureId
            ? "已关联维护归档，交付时仍须维护流程复核原文。"
            : "待核验：来源尚未进入受信维护归档，暂不具备交付条件。",
          "muted",
        ),
      );
      workspace.append(section);
    }
    const details = element("details");
    details.append(element("summary", "追踪编号与操作记录"));
    details.append(
      element(
        "p",
        `投稿：${revision.feedbackId} · 活动：${revision.target.id}`,
      ),
      element("p", `修订：${revision.id}`),
      element("p", `基线：${revision.baselineSha256}`),
    );
    if (revision.candidateSha256)
      details.append(element("p", `候选：${revision.candidateSha256}`));
    const history = element("ol");
    const labels: Record<string, string> = {
      create: "新建修订",
      edit: "编辑并重新待审",
      review: "审核",
      handoff: "交付候选",
      withdraw: "申请撤回",
      "receipt:applied": "维护应用完成",
      "receipt:rejected": "维护未应用",
      "receipt:withdrawn": "维护确认撤回",
    };
    for (const item of revision.history)
      history.append(
        element(
          "li",
          `${time(item.at)} · ${item.actor} · ${labels[item.action] ?? item.action}${item.note ? `：${item.note}` : ""}`,
        ),
      );
    details.append(history);
    workspace.append(details);
    if (revision.receipt) {
      const receipt = revision.receipt;
      const box = element("section", "", "editorial-receipt");
      box.append(
        element("h4", "维护结果"),
        element("p", receipt.message),
        element(
          "p",
          `运行：${receipt.runId} · 完成于 ${time(receipt.completedAt)}`,
        ),
      );
      if (receipt.publicationId)
        box.append(
          element("p", `发行：${receipt.publicationId}`),
          element("p", `完整快照：${receipt.snapshotManifestSha256}`),
        );
      if (receipt.status === "applied")
        box.append(
          element(
            "p",
            "该结果由维护流程回执确认。本地快照不表示服务器已上线。已应用内容需要另建修订。",
            "muted",
          ),
        );
      workspace.append(box);
    }
    const note = element("textarea");
    note.maxLength = 2000;
    note.placeholder = "核对结果、未采纳原因或撤回原因（内部保存）";
    const feedbackStatus = statusNode();
    const buttons = element("div", "", "toolbar");
    let requestKey = "";
    let requestPayload = "";
    async function mutate(
      action: string,
      body: Record<string, unknown>,
    ): Promise<void> {
      if (pending) return;
      const payload = JSON.stringify({ action, body });
      if (payload !== requestPayload) {
        requestKey = crypto.randomUUID();
        requestPayload = payload;
      }
      pending = true;
      const disabled = new Map(
        [...buttons.querySelectorAll("button")].map((control) => [
          control,
          control.disabled,
        ]),
      );
      for (const control of buttons.querySelectorAll("button"))
        control.disabled = true;
      note.disabled = true;
      feedbackStatus.textContent = "正在保存…";
      try {
        await api<EditorialRevision>(
          `editorial/${revision.id}/${action}`,
          "POST",
          { ...body, expectedVersion: revision.version, requestId: requestKey },
        );
        if (root.isConnected) {
          await open(revision.id);
          await refreshList();
        }
      } catch (error) {
        feedbackStatus.textContent = `${error instanceof Error ? error.message : "保存失败"}；输入仍保留。`;
      } finally {
        pending = false;
        note.disabled = false;
        for (const [control, wasDisabled] of disabled)
          control.disabled = wasDisabled;
      }
    }
    if (["draft", "approved", "rejected"].includes(revision.status)) {
      buttons.append(
        button("编辑修订 / 重载基线", () =>
          guarded(() => {
            const generation = ++detailGeneration;
            void api<EditorialBaseline>("editorial/baseline")
              .then((fresh) => {
                if (generation === detailGeneration)
                  drawEditor(fresh, revision);
              })
              .catch((error: unknown) => {
                feedbackStatus.textContent =
                  error instanceof Error ? error.message : "基线读取失败";
              });
          }),
        ),
      );
    }
    if (["draft", "rejected"].includes(revision.status)) {
      const approve = button("核验通过", () => {
        void mutate("review", { decision: "approve", note: note.value });
      });
      approve.disabled =
        detail.baselineConflict ||
        revision.evidence.some((item) => !item.captureId);
      buttons.append(
        approve,
        button("不予采纳", () => {
          void mutate("review", { decision: "reject", note: note.value });
        }),
      );
    }
    if (revision.status === "approved") {
      const handoff = button("交付维护候选", () => {
        void mutate("handoff", {});
      });
      handoff.disabled = detail.baselineConflict;
      handoff.className = "primary";
      buttons.append(handoff);
    }
    if (revision.status === "handed_off" && revision.candidate) {
      workspace.append(
        element(
          "p",
          "候选等待维护流程读取、核验和生成完整快照。此步骤不会修改公开站点。",
          "editorial-warning",
        ),
      );
      buttons.append(
        button("下载受限候选", () => {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(revision.candidate, null, 2) + "\n"], {
              type: "application/json",
            }),
          );
          const anchor = element("a");
          anchor.href = url;
          anchor.download = `editorial-${revision.id}.json`;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
      );
    }
    if (
      ["draft", "approved", "rejected", "handed_off"].includes(revision.status)
    )
      buttons.append(
        button(
          revision.status === "handed_off" ? "申请撤回候选" : "撤回修订",
          () => {
            void mutate("withdraw", { note: note.value });
          },
        ),
      );
    if (revision.status === "withdrawal_requested")
      workspace.append(
        element(
          "p",
          "已请求撤回，等待维护确认。若已进入应用提交阶段，以实际维护回执为准。",
          "editorial-warning",
        ),
      );
    if (buttons.childElementCount)
      workspace.append(field("内部处理说明", note), buttons, feedbackStatus);
    title.focus();
  }
  function drawEditor(
    current: EditorialBaseline,
    revision?: EditorialRevision,
  ): void {
    ++detailGeneration;
    if (list.querySelector(".empty-state")) list.hidden = true;
    workspace.replaceChildren();
    const title = element(
      "h3",
      revision ? "编辑活动修订" : "从投稿整理活动修订",
    );
    title.tabIndex = -1;
    const form = element("form", "", "editor-form");
    const feedbackId = input(revision?.feedbackId ?? feedback?.id ?? "", 24);
    feedbackId.required = true;
    feedbackId.readOnly = Boolean(revision);
    const eventSelect = element("select");
    eventSelect.required = true;
    const placeholder = element("option", "请选择需修订的活动");
    placeholder.value = "";
    eventSelect.append(placeholder);
    for (const event of current.events) {
      const option = element(
        "option",
        `${event.date} · ${event.title} · ${event.city ?? "城市待公布"}`,
      );
      option.value = event.id;
      eventSelect.append(option);
    }
    eventSelect.value =
      revision?.target.id ??
      current.events.find((event) => event.id === feedback?.target)?.id ??
      "";
    eventSelect.disabled = Boolean(revision);
    const patchHost = element("div", "", "editorial-patch-fields");
    const preview = element("div");
    const controls = new Map<
      EditorialField,
      {
        enabled: HTMLInputElement;
        value: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        unknown: HTMLInputElement;
      }
    >();
    function patch(): EditorialPatch {
      const result: EditorialPatch = {};
      for (const [name, control] of controls)
        if (control.enabled.checked)
          result[name] = control.unknown.checked
            ? null
            : control.value.value.trim();
      return result;
    }
    function updatePreview(): void {
      const event = current.events.find(
        (item) => item.id === eventSelect.value,
      );
      const changes = patch();
      preview.replaceChildren(element("h4", "差异预览"));
      if (event)
        preview.append(
          diffTable(
            editorialFields
              .filter((name) => Object.hasOwn(changes, name))
              .map((name) => ({
                field: name,
                before: event[name],
                after: changes[name]!,
              })),
          ),
        );
    }
    function drawFields(): void {
      controls.clear();
      patchHost.replaceChildren();
      const event = current.events.find(
        (item) => item.id === eventSelect.value,
      );
      if (!event) {
        preview.replaceChildren();
        return;
      }
      for (const name of editorialFields) {
        const group = element("fieldset", "", "editorial-patch-field");
        const enabled = input();
        enabled.type = "checkbox";
        enabled.checked = Boolean(
          revision && Object.hasOwn(revision.patch, name),
        );
        const toggle = field(`修订${editorialFieldLabels[name]}`, enabled);
        toggle.classList.add("editorial-toggle");
        const raw =
          revision && Object.hasOwn(revision.patch, name)
            ? revision.patch[name]!
            : event[name];
        let value: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (name === "status") {
          value = element("select");
          for (const [key, label] of [
            ["scheduled", "已确认"],
            ["unconfirmed", "尚未核实"],
            ["cancelled", "已取消"],
            ["postponed", "已延期"],
          ]) {
            const option = element("option", label);
            option.value = key;
            value.append(option);
          }
        } else if (name === "notes") {
          value = element("textarea");
          value.maxLength = 2000;
        } else {
          value = input();
          if (name === "date") value.type = "date";
          if (["opensAt", "startsAt", "endsAt"].includes(name))
            value.type = "time";
        }
        value.value = raw ?? "";
        const unknown = input();
        unknown.type = "checkbox";
        unknown.checked = raw === null;
        const nullable = !["title", "date", "status", "notes"].includes(name);
        if (!nullable) unknown.checked = false;
        const unknownLabel = field("尚未公布 / 未知", unknown);
        unknownLabel.classList.add("editorial-toggle");
        unknownLabel.hidden = !nullable;
        const valueField = field(editorialFieldLabels[name], value);
        const currentValue = element(
          "small",
          `当前：${display(event[name], name)}`,
        );
        const update = (): void => {
          value.disabled = !enabled.checked || unknown.checked;
          unknown.disabled = !enabled.checked;
          valueField.hidden = !enabled.checked;
          unknownLabel.hidden = !enabled.checked || !nullable;
          currentValue.hidden = enabled.checked;
          updatePreview();
        };
        controls.set(name, { enabled, value, unknown });
        enabled.addEventListener("change", update);
        unknown.addEventListener("change", update);
        value.addEventListener("input", updatePreview);
        group.append(toggle, currentValue, valueField, unknownLabel);
        patchHost.append(group);
        update();
      }
      updatePreview();
    }
    eventSelect.addEventListener("change", drawFields);
    drawFields();
    const evidenceHost = element("div", "", "editorial-evidence-fields");
    const evidenceReaders: (() => EditorialEvidence)[] = [];
    function addEvidence(initial?: EditorialEvidence): void {
      if (evidenceReaders.length >= 12) return;
      const section = element("fieldset", "", "editorial-evidence");
      section.append(
        element("legend", `公开证据 ${evidenceReaders.length + 1}`),
      );
      const url = input(initial?.url ?? feedback?.source ?? "", 800);
      url.type = "url";
      url.required = true;
      const label = input(initial?.label ?? "", 160);
      label.required = true;
      const publisher = input(initial?.publisher ?? "", 160);
      publisher.required = true;
      const kind = element("select");
      for (const [value, text] of [
        ["official", "团体官宣"],
        ["organizer", "主办方"],
        ["venue", "场馆"],
        ["ticketing", "票务平台"],
      ]) {
        const option = element("option", text);
        option.value = value;
        kind.append(option);
      }
      kind.value = initial?.kind ?? "official";
      const observed = input(initial?.observedAt ?? "", 32);
      observed.placeholder = "实际观察时间，如 2026-09-19T01:00:00Z";
      observed.required = true;
      const excerpt = element("textarea");
      excerpt.value = initial?.excerpt ?? "";
      excerpt.maxLength = 3000;
      excerpt.required = true;
      const supports = element("div", "", "editorial-supports");
      const supported = new Map<EditorialField, HTMLInputElement>();
      for (const name of editorialFields) {
        const choice = input();
        choice.type = "checkbox";
        choice.checked = initial?.supports.includes(name) ?? false;
        supported.set(name, choice);
        const item = field(editorialFieldLabels[name], choice);
        item.classList.add("editorial-toggle");
        supports.append(item);
      }
      const capture = input(initial?.captureId ?? "", 180);
      capture.placeholder = "维护归档后填写；未归档可先保存待核验";
      const archive = element("details");
      archive.append(
        element("summary", "维护归档关联（尚未归档可留空）"),
        field("维护证据编号", capture),
        element(
          "p",
          "来源网页和摘录是核对入口。只有维护侧已有受信原文归档，才能通过审核交付；填写编号本身不等于验证通过。",
          "muted",
        ),
      );
      section.append(
        field("来源标题", label),
        field("公开来源链接", url),
        field("发布者", publisher),
        field("来源类型", kind),
        field("真实观察时间（UTC）", observed),
        field("支持修订的原文摘录", excerpt),
        element("p", "这段证据支持哪些修订字段："),
        supports,
        archive,
      );
      const reader = (): EditorialEvidence => ({
        captureId: capture.value.trim(),
        url: url.value.trim(),
        label: label.value.trim(),
        publisher: publisher.value.trim(),
        kind: kind.value as EditorialEvidence["kind"],
        observedAt: observed.value.trim(),
        excerpt: excerpt.value.trim(),
        supports: [...supported]
          .filter(([, choice]) => choice.checked)
          .map(([name]) => name),
      });
      evidenceReaders.push(reader);
      section.append(
        button("移除此证据", () => {
          const index = evidenceReaders.indexOf(reader);
          if (index >= 0) evidenceReaders.splice(index, 1);
          section.remove();
        }),
      );
      evidenceHost.append(section);
    }
    if (revision) revision.evidence.forEach(addEvidence);
    else addEvidence();
    const rationale = element("textarea");
    rationale.maxLength = 2000;
    rationale.minLength = 11;
    rationale.required = true;
    rationale.value = revision?.rationale ?? "";
    rationale.placeholder = "说明核对过程、为何修改这些字段（至少 11 个字符）";
    const save = element("button", "保存修订并待审核", "primary");
    save.type = "submit";
    const result = statusNode();
    let requestKey = crypto.randomUUID();
    let lastBody = "";
    form.append(
      field("关联投稿编号", feedbackId),
      field("目标活动", eventSelect),
      element(
        "p",
        "只勾选需修改的字段。未知值明确标注，不依据来源缺席推断取消。",
        "muted",
      ),
      patchHost,
      preview,
      element("h4", "证据与核对依据"),
      evidenceHost,
      button("添加另一条证据", () => addEvidence()),
      field("公开修订依据", rationale),
      save,
      result,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (pending) return;
      const data: EditorialInput = {
        feedbackId: feedbackId.value.trim(),
        target: { kind: "event", id: eventSelect.value },
        baselineSha256: current.baselineSha256,
        patch: patch(),
        evidence: evidenceReaders.map((read) => read()),
        rationale: rationale.value.trim(),
      };
      const body = JSON.stringify(data);
      if (body !== lastBody) {
        requestKey = crypto.randomUUID();
        lastBody = body;
      }
      pending = true;
      form.inert = true;
      form.setAttribute("aria-busy", "true");
      result.textContent = "正在校验并加密保存…";
      void api<EditorialRevision>(
        revision ? `editorial/${revision.id}` : "editorial",
        revision ? "PATCH" : "POST",
        {
          requestId: requestKey,
          expectedVersion: revision?.version ?? 0,
          input: data,
        },
      )
        .then(async (saved) => {
          if (root.isConnected) {
            await open(saved.id);
            await refreshList(1);
          }
        })
        .catch((error: unknown) => {
          result.textContent = `${error instanceof Error ? error.message : "保存失败"}；输入仍保留。`;
        })
        .finally(() => {
          pending = false;
          form.inert = false;
          form.setAttribute("aria-busy", "false");
        });
    });
    workspace.append(title, form);
    title.focus();
  }
  actions.append(
    button("新建活动修订", () =>
      guarded(() => {
        const generation = ++detailGeneration;
        void api<EditorialBaseline>("editorial/baseline")
          .then((fresh) => {
            if (generation === detailGeneration) drawEditor(fresh);
          })
          .catch((error: unknown) => {
            listStatus.textContent =
              error instanceof Error ? error.message : "基线读取失败";
          });
      }),
    ),
    button("刷新维护结果", () =>
      guarded(() => {
        ++detailGeneration;
        workspace.replaceChildren();
        void refreshList();
      }),
    ),
  );
  drawList(page);
  root.append(actions, listStatus, list, pager, workspace);
  if (feedback) drawEditor(baseline);
  return root;
}

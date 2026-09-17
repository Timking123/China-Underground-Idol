import type {
  ApiResult,
  ConsoleSettings,
  FeedbackInput,
  FeedbackKind,
} from "../admin/contracts";
import { element } from "../groups/dom";
import { buildMailDraft } from "./contribute";

/** 在线提交与邮件草稿共用输入；只在点击时发送，不保存草稿到浏览器存储。 */
export function mountOnlineContribution(root: Document): void {
  const form = root.querySelector<HTMLFormElement>("#contribute-form");
  const fields = root.querySelector<HTMLFieldSetElement>("#draft-fields");
  const status = root.querySelector<HTMLElement>("#draft-status");
  const view = root.defaultView;
  if (!form || !fields || !status || !view) return;
  const draftButton = fields.querySelector<HTMLButtonElement>(
    "button[type=submit]",
  );
  if (!draftButton || root.querySelector("#online-submit")) return;
  draftButton.textContent = "生成邮件草稿";
  draftButton.classList.remove("content-button-primary");
  const submit = element(
    "button",
    "直接提交反馈",
    "content-button content-button-primary",
  );
  submit.id = "online-submit";
  submit.type = "button";
  submit.disabled = true;
  const contactField = element("div", "", "content-field");
  const contactLabel = element("label", "联系方式（选填，仅管理员可见）");
  contactLabel.htmlFor = "online-contact";
  const contact = element("input");
  contact.id = "online-contact";
  contact.maxLength = 160;
  contact.autocomplete = "off";
  contact.placeholder = "邮箱或你希望使用的联系渠道";
  contactField.append(
    contactLabel,
    contact,
    element("small", "仅在需要补充核实时使用，不会公开展示。"),
  );
  const consentLabel = element("label", "", "online-consent");
  const consent = element("input");
  consent.type = "checkbox";
  consent.id = "online-consent";
  consentLabel.append(
    consent,
    "我已阅读隐私说明，同意将本次反馈和选填联系方式提交给管理员核查。",
  );
  const notice = element(
    "p",
    "网页提交内容会加密保存，仅管理员可见；用于防滥用的 IP 最长保存 90 天。",
    "content-hint",
  );
  const privacy = element("a", "查看隐私说明");
  privacy.href = "about.html#privacy";
  notice.append(" ", privacy);
  const trap = element("input");
  trap.name = "website";
  trap.type = "text";
  trap.hidden = true;
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");
  for (const node of [contactField, consentLabel, notice, trap, submit])
    fields.insertBefore(node, draftButton);
  let busy = false;
  let available = false;
  let interacted = false;
  // 超时不代表服务器未收到：相同载荷的重试沿用编号，修改后才生成新编号。
  let attempt:
    { signature: string; requestId: string; accepted: boolean } | undefined;
  const input = (selector: string): string =>
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
      ?.value ?? "";
  const edited = (): void => {
    interacted = true;
    if (busy) return;
    submit.disabled = !available;
    status.textContent = available
      ? "当前输入尚未提交。可直接提交给管理员，或生成邮件草稿自行发送。"
      : "当前输入尚未提交。可生成邮件草稿自行发送。";
  };
  form.addEventListener("input", edited);
  form.addEventListener("change", edited);
  form.addEventListener("submit", () => {
    interacted = true;
  });
  submit.addEventListener("click", () => {
    if (busy || !available || !form.reportValidity()) return;
    interacted = true;
    if (!consent.checked) {
      status.textContent = "请先勾选投稿隐私说明，再直接提交。";
      consent.focus();
      return;
    }
    const values = {
      kind: input("#draft-kind") as FeedbackKind,
      target: input("#draft-target"),
      source: input("#draft-source"),
      details: input("#draft-details"),
      contact: contact.value,
      consent: true,
      website: trap.value,
    };
    try {
      buildMailDraft(values);
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "请检查输入。";
      return;
    }
    const signature = JSON.stringify(values);
    if (attempt?.signature !== signature)
      attempt = {
        signature,
        requestId: view.crypto.randomUUID(),
        accepted: false,
      };
    if (attempt.accepted) {
      status.textContent = "这份内容已经提交，请等待管理员核查。";
      submit.disabled = true;
      return;
    }
    const current = attempt;
    const payload: FeedbackInput = { ...values, requestId: current.requestId };
    busy = true;
    fields.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.textContent = "正在提交，请稍候…";
    const controller = new AbortController();
    const timeout = view.setTimeout(() => controller.abort(), 15000);
    void view
      .fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify(payload),
      })
      .then(async (response) => {
        const result = (await response.json()) as ApiResult<{ id: string }>;
        if (
          !response.ok ||
          result?.code !== 0 ||
          typeof result.data?.id !== "string" ||
          !result.data.id ||
          result.data.id.length > 100
        )
          throw new Error("提交结果暂未确认");
        current.accepted = true;
        status.textContent = `已提交。反馈编号：${result.data.id}。内容仅供管理员核查，不会自动公开；如需追问，请保留编号。`;
        const resultPanel = root.querySelector<HTMLElement>("#draft-result");
        if (resultPanel) resultPanel.hidden = true;
      })
      .catch(() => {
        status.textContent =
          "提交结果暂未确认。内容已保留；可重试本次提交，或生成邮件草稿自行发送。";
      })
      .finally(() => {
        view.clearTimeout(timeout);
        busy = false;
        fields.disabled = false;
        form.removeAttribute("aria-busy");
        submit.disabled = current.accepted || !available;
      });
  });
  if (
    !["https:", "http:"].includes(view.location.protocol) ||
    !view.crypto.randomUUID
  ) {
    status.textContent = "离线访问可生成邮件草稿；直接提交请打开在线网站。";
    return;
  }
  const controller = new AbortController();
  const timeout = view.setTimeout(() => controller.abort(), 10000);
  void view
    .fetch("/api/v1/public-config", {
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
    .then(async (response) => {
      const result = (await response.json()) as ApiResult<ConsoleSettings>;
      if (
        !response.ok ||
        result?.code !== 0 ||
        typeof result.data?.acceptFeedback !== "boolean"
      )
        throw new Error("投稿接口不可用");
      available = result.data.acceptFeedback;
      submit.disabled = !available;
      if (
        typeof result.data.feedbackNotice === "string" &&
        result.data.feedbackNotice.length <= 500 &&
        result.data.feedbackNotice
      ) {
        const message = element(
          "p",
          result.data.feedbackNotice,
          "content-callout",
        );
        form.before(message);
      }
      if (!interacted)
        status.textContent = available
          ? "填写后可直接提交给管理员，也可以选择生成邮件草稿。"
          : "暂时暂停接收网页反馈，可以生成邮件草稿联系管理员。";
    })
    .catch(() => {
      if (!interacted)
        status.textContent =
          "网页提交暂不可用。输入仍可用于生成邮件草稿，请自行发送。";
    })
    .finally(() => view.clearTimeout(timeout));
}

export const CONTACT_EMAIL = "1243222867@QQ.com";
export const MAILTO_MAX_LENGTH = 1800;
export const FIELD_LIMITS = {
  target: 160,
  source: 800,
  details: 3000,
} as const;
export const TEMPLATES = {
  error: {
    label: "资料错误",
    hint: "指出哪一项有误、建议改成什么，并附可核对的原始来源。",
    prompt: "有误内容与建议更正",
  },
  event: {
    label: "活动补充",
    hint: "提供活动名称、日期、城市、场地及主办方或团体官宣。无法确认的项目请写“待核实”。",
    prompt: "活动名称、日期、城市、场地与补充说明",
  },
  outdated: {
    label: "过时资料",
    hint: "说明哪条资料已有变化，以及新公告的日期。历史记录与当前状态可能使用不同截点。",
    prompt: "变化内容、新公告日期与建议更新",
  },
  rights: {
    label: "素材权利",
    hint: "指出涉及的页面或素材、你与素材的关系及希望采取的处理方式。可附公开作品页或授权说明，不需要敏感证件。",
    prompt: "涉及素材、权利关系与处理诉求",
  },
} as const;
export type TemplateKind = keyof typeof TEMPLATES;
export interface DraftInput {
  kind: TemplateKind;
  target: string;
  source: string;
  details: string;
}
export interface MailDraft {
  subject: string;
  body: string;
  text: string;
  mailto: string | null;
}

export interface ContributionContext {
  state: "none" | "valid" | "invalid";
  kind?: TemplateKind;
  target?: string;
  source?: string;
  pageLink?: string;
}

const PAGE_LABELS = {
  index: "风格分布图",
  discover: "发现",
  groups: "团体列表",
  group: "团体档案",
  events: "演出",
  guide: "观演指南",
  about: "关于本站",
} as const;

function containsControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** 参数仅用于寻找已收录公开对象；任何无效参数都回到手动填写。 */
export function parseContributionContext(
  search: string,
  groups: readonly { id: string; name: string }[],
  events: readonly {
    id: string;
    title: string;
    performers: readonly { groupId: string | null }[];
  }[],
  locationHref: string,
): ContributionContext {
  const invalid: ContributionContext = { state: "invalid" };
  if (search.length > 2048 || containsControl(search)) return invalid;
  let params: URLSearchParams;
  try {
    decodeURIComponent(search.replace(/\+/g, " "));
    params = new URLSearchParams(search);
  } catch {
    return invalid;
  }
  if ([...params].length === 0) return { state: "none" };
  for (const [key, value] of params) {
    if (
      !["group", "event", "page", "kind"].includes(key) ||
      params.getAll(key).length !== 1 ||
      !value ||
      value.length > 160 ||
      containsControl(value) ||
      value.includes("%")
    )
      return invalid;
  }
  const groupId = params.get("group");
  const eventId = params.get("event");
  const group = groups.find((item) => item.id === groupId);
  const event = events.find((item) => item.id === eventId);
  if (
    (groupId && (!/^g\d{3,8}$/u.test(groupId) || !group)) ||
    (eventId && (!/^e-[a-z0-9-]+$/u.test(eventId) || !event)) ||
    (group &&
      event &&
      !event.performers.some((item) => item.groupId === group.id))
  )
    return invalid;
  const page =
    params.get("page") ?? (event ? "events" : group ? "group" : null);
  const kind = params.get("kind") ?? "error";
  if (
    (page && !Object.hasOwn(PAGE_LABELS, page)) ||
    !Object.hasOwn(TEMPLATES, kind)
  )
    return invalid;
  const target = [
    group?.name,
    event?.title,
    page ? PAGE_LABELS[page as keyof typeof PAGE_LABELS] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (target.length > FIELD_LIMITS.target) return invalid;
  let pageLink = page ? `${page}.html` : "";
  if (page && group && ["index", "group", "events"].includes(page))
    pageLink += `?group=${encodeURIComponent(group.id)}`;
  if (page === "events" && event)
    pageLink += `#${encodeURIComponent(event.id)}`;
  let source = "";
  try {
    const base = new URL(locationHref);
    if (
      pageLink &&
      /^https?:$/.test(base.protocol) &&
      !base.username &&
      !base.password
    ) {
      source = new URL(pageLink, base).href;
      if (source.length > FIELD_LIMITS.source) source = "";
    }
  } catch {
    /* 离线或不可解析的宿主地址不进入草稿。 */
  }
  return {
    state: "valid",
    kind: kind as TemplateKind,
    target,
    source,
    pageLink,
  };
}

function cleanField(value: string, limit: number, label: string): string {
  if (typeof value !== "string" || value.length > limit)
    throw new Error(`${label}不得超过 ${limit} 个字符。`);
  // 拒绝孤立代理项，避免 URI 编码异常；换行仅作为正文文本保留。
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff)
      throw new Error(`${label}含无效字符，请重新输入。`);
  }
  return Array.from(value.replace(/\r\n?/g, "\n"))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
}

export function buildMailDraft(input: DraftInput): MailDraft {
  if (!Object.hasOwn(TEMPLATES, input.kind))
    throw new Error("请选择有效的资料类型。");
  const template = TEMPLATES[input.kind];
  const target = cleanField(
    input.target,
    FIELD_LIMITS.target,
    "相关页面或名称",
  );
  const source = cleanField(input.source, FIELD_LIMITS.source, "来源链接");
  const details = cleanField(input.details, FIELD_LIMITS.details, "说明");
  if (!target || !details)
    throw new Error("请填写相关页面或名称，以及具体说明。");
  if (source) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error("来源请填写完整的 HTTP 或 HTTPS 公开链接，或留空。");
    }
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      /\s/u.test(source)
    ) {
      throw new Error("来源仅接受不含登录信息的 HTTP 或 HTTPS 公开链接。");
    }
  }
  // 邮件头完全由固定模板产生；所有用户输入只放入编码后的正文。
  const subject = `【地偶档案·${template.label}】资料反馈`;
  const body = [
    "你好，",
    "",
    `反馈类型：${template.label}`,
    `相关页面或名称：${target}`,
    `公开来源：${source || "未提供，请编辑核实"}`,
    "",
    `${template.prompt}：`,
    details,
    "",
    "请依据原始来源核实后处理。",
  ]
    .join("\r\n")
    .replace(/\r?\n/g, "\r\n");
  const uri = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return {
    subject,
    body,
    text: `收件人：${CONTACT_EMAIL}\r\n主题：${subject}\r\n\r\n${body}`,
    mailto: uri.length <= MAILTO_MAX_LENGTH ? uri : null,
  };
}

export async function copyDraft(
  text: string,
  write?: (value: string) => Promise<void>,
): Promise<boolean> {
  if (!write) return false;
  try {
    await write(text);
    return true;
  } catch {
    return false;
  }
}

export function mountContribute(
  root: Document,
  context: ContributionContext = { state: "none" },
): void {
  const form = root.querySelector<HTMLFormElement>("#contribute-form");
  if (!form) return;
  const kind = root.querySelector<HTMLSelectElement>("#draft-kind")!;
  const target = root.querySelector<HTMLInputElement>("#draft-target")!;
  const source = root.querySelector<HTMLInputElement>("#draft-source")!;
  const details = root.querySelector<HTMLTextAreaElement>("#draft-details")!;
  const hint = root.querySelector<HTMLElement>("#template-hint")!;
  const status = root.querySelector<HTMLElement>("#draft-status")!;
  const preview = root.querySelector<HTMLTextAreaElement>("#draft-preview")!;
  const result = root.querySelector<HTMLElement>("#draft-result")!;
  const open = root.querySelector<HTMLAnchorElement>("#open-mail")!;
  const copy = root.querySelector<HTMLButtonElement>("#copy-draft")!;
  const select = root.querySelector<HTMLButtonElement>("#select-draft")!;
  const contextNotice = root.querySelector<HTMLElement>("#draft-context");
  if (context.state !== "none" && contextNotice) {
    contextNotice.hidden = false;
    if (context.state === "valid") {
      kind.value = context.kind ?? "error";
      target.value = context.target ?? "";
      source.value = context.source ?? "";
      hint.textContent = TEMPLATES[kind.value as TemplateKind].hint;
      contextNotice.textContent = `已带入${context.target || "反馈类型"}，可直接修改。请补充具体说明和原始来源。尚未发送。`;
      if (context.pageLink) {
        const back = root.createElement("a");
        back.href = context.pageLink;
        back.textContent = "查看相关页面";
        contextNotice.append(" ", back);
      }
    } else {
      contextNotice.textContent =
        "入口参数无效或相关资料未能核实，已改为手动填写。尚未发送。";
    }
  }
  let revision = 0;
  const invalidate = (): void => {
    revision += 1;
    result.hidden = true;
    preview.value = "";
    open.removeAttribute("href");
    status.textContent = "内容已修改，请重新生成草稿。尚未发送。";
  };
  form.addEventListener("input", invalidate);
  kind.addEventListener("change", () => {
    invalidate();
    hint.textContent =
      TEMPLATES[kind.value as TemplateKind]?.hint ?? "请选择有效类型。";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const draft = buildMailDraft({
        kind: kind.value as TemplateKind,
        target: target.value,
        source: source.value,
        details: details.value,
      });
      preview.value = draft.text;
      open.hidden = !draft.mailto;
      if (draft.mailto) open.href = draft.mailto;
      else open.removeAttribute("href");
      result.hidden = false;
      status.textContent = draft.mailto
        ? "草稿已在本机生成。尚未发送，请在邮件客户端检查并发送。"
        : "草稿较长，请复制全文到邮件客户端。尚未发送，请检查并发送。";
      preview.focus();
    } catch (error) {
      result.hidden = true;
      open.removeAttribute("href");
      status.textContent =
        error instanceof Error ? error.message : "无法生成草稿，请检查输入。";
    }
  });
  open.addEventListener("click", () => {
    status.textContent =
      "已请求打开邮件客户端；尚未发送。若没有打开，请复制草稿后自行粘贴。";
  });
  const selectText = (): void => {
    preview.focus();
    preview.select();
  };
  select.addEventListener("click", () => {
    selectText();
    status.textContent = "草稿已选中，请使用复制命令或长按复制。尚未发送。";
  });
  copy.addEventListener("click", () => {
    const current = revision;
    const clipboard = root.defaultView?.navigator.clipboard;
    void copyDraft(
      preview.value,
      clipboard ? (text) => clipboard.writeText(text) : undefined,
    ).then((copied) => {
      if (current !== revision || result.hidden) return;
      if (!copied) selectText();
      status.textContent = copied
        ? "草稿已复制。尚未发送，请粘贴到邮件客户端检查并发送。"
        : "自动复制不可用，已选中草稿；请使用复制命令或长按复制。尚未发送。";
    });
  });
  // 仅在脚本成功初始化后开放输入；无脚本时不会发生原生表单提交。
  root.querySelector<HTMLFieldSetElement>("#draft-fields")!.disabled = false;
  root.querySelector<HTMLElement>("#script-notice")!.hidden = true;
}

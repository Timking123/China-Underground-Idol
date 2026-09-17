import { element, link, required } from "../groups/dom";
import {
  kindLabels,
  statusLabels,
  feedbackStatuses,
  type ApiResult,
  type AdminSession,
  type Audit,
  type ConsoleSettings,
  type Dashboard,
  type Feedback,
  type FeedbackStatus,
  type PageResult,
  type SystemInfo,
  type Visit,
} from "./contracts";
import { regionMap, trendChart } from "./charts";

const view = required("view");
const login = required("login");
const shell = required("console");
const loginStatus = required("login-status");
const message = required("console-status");
const range = required<HTMLSelectElement>("range");
let csrf = "";
let loggedIn = false;
let generation = 0;
let feedbackPage = 1;
let feedbackFilter = "";
let visitsPage = 1;
let auditPage = 1;
let sessionEpoch = 0;
let idleTimer = 0;
let absoluteTimer = 0;
let absoluteDeadline = 0;
let resumeSession = false;
const requests = new Set<AbortController>();
const descriptions: Record<string, [string, string]> = {
  overview: ["网站总览", "了解访问变化，处理读者带来的新线索。"],
  feedback: ["投稿与反馈", "把每一条补充、纠错和建议，留在清楚的处理流程里。"],
  traffic: ["访问趋势", "按天查看浏览量、访客估算与独立 IP。"],
  regions: ["地区分布", "看看读者从哪里来。颜色越亮，访问量越高。"],
  visits: ["访问记录", "完整 IP、访问页面和大致地区，仅管理员可见。"],
  content: ["内容巡检", "从已发布档案定位资料，带着原始来源整理修订。"],
  settings: ["网站设置", "管理投稿入口、接收提示和访问统计。"],
  security: ["安全与审计", "检查运行状态，管理登录密码与操作记录。"],
};
function currentView(): string {
  const name = window.location.hash.slice(1);
  return Object.hasOwn(descriptions, name) ? name : "overview";
}
function date(time: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(time);
}
function showLogin(text = "请输入管理员账号和密码。"): void {
  loggedIn = false;
  csrf = "";
  generation++;
  sessionEpoch++;
  window.clearTimeout(idleTimer);
  window.clearTimeout(absoluteTimer);
  absoluteDeadline = 0;
  for (const request of requests) request.abort();
  requests.clear();
  // 移除私人节点及表单值，不能仅靠 hidden 隐藏旧会话的数据。
  view.replaceChildren();
  view.inert = false;
  view.setAttribute("aria-busy", "false");
  required("admin-name").textContent = "";
  message.textContent = "";
  required("view-title").textContent = "管理工作台";
  required("view-description").textContent = "";
  shell.hidden = true;
  login.hidden = false;
  loginStatus.textContent = text;
  required<HTMLInputElement>("password").value = "";
  feedbackPage = 1;
  feedbackFilter = "";
  visitsPage = 1;
  auditPage = 1;
}
function armIdleLock(): void {
  window.clearTimeout(idleTimer);
  if (loggedIn)
    idleTimer = window.setTimeout(
      () => showLogin("长时间未操作，工作台已锁定，请重新登录。"),
      30 * 60 * 1000,
    );
}
async function api<T>(
  endpoint: string,
  method = "GET",
  body?: unknown,
  token = csrf,
): Promise<T> {
  if (loggedIn && performance.now() >= absoluteDeadline) {
    showLogin("登录已达到最长有效期，请重新登录。");
    throw new Error("登录已过期，请重新登录。");
  }
  const epoch = sessionEpoch;
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), 15000);
  requests.add(abort);
  try {
    const response = await fetch(`/api/v1/admin/${endpoint}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: abort.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method !== "GET" && token ? { "X-CSRF-Token": token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (epoch !== sessionEpoch) throw new Error("登录状态已改变");
    if (response.status === 401 && endpoint !== "login") {
      showLogin("登录已过期，请重新登录。");
      throw new Error("登录已过期，请重新登录。");
    }
    const result = (await response.json()) as ApiResult<T>;
    if (loggedIn && performance.now() >= absoluteDeadline) {
      showLogin("登录已达到最长有效期，请重新登录。");
      throw new Error("登录已过期，请重新登录。");
    }
    if (epoch !== sessionEpoch) throw new Error("登录状态已改变");
    if (!response.ok || result.code !== 0)
      throw new Error(result.message || "请求未完成");
    armIdleLock();
    return result.data;
  } catch (error) {
    if (abort.signal.aborted)
      throw new Error("请求已取消或超时，请稍后重试", { cause: error });
    if (error instanceof SyntaxError)
      throw new Error("服务返回异常，请稍后重试", { cause: error });
    throw error;
  } finally {
    requests.delete(abort);
    window.clearTimeout(timer);
  }
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = element("button", text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function panel(
  title: string,
  subtitle = "",
  destination?: string,
): HTMLElement {
  const section = element("section", "", "panel");
  const head = element("div", "", "panel-heading");
  const text = element("div");
  text.append(element("h2", title));
  if (subtitle) text.append(element("p", subtitle));
  head.append(text);
  if (destination) {
    const go = link("查看全部 ↗", `#${destination}`);
    go.className = "section-link";
    head.append(go);
  }
  section.append(head);
  return section;
}
function empty(title: string, description: string): HTMLElement {
  const node = element("div", "", "empty-state");
  node.append(element("h3", title), element("p", description));
  return node;
}
function table(titles: string[]): {
  wrapper: HTMLElement;
  body: HTMLTableSectionElement;
} {
  const wrapper = element("div", "", "table-wrap");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", `${titles.join("、")}表格，可横向滚动`);
  const node = element("table");
  const head = element("thead");
  const row = element("tr");
  for (const title of titles) {
    const th = element("th", title);
    th.scope = "col";
    row.append(th);
  }
  head.append(row);
  const body = element("tbody");
  node.append(head, body);
  wrapper.append(node);
  return { wrapper, body };
}
function pagination(
  data: PageResult<unknown>,
  onPage: (page: number) => void,
): HTMLElement {
  const node = element("div", "", "pagination");
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const previous = button("上一页", () => onPage(data.page - 1));
  const next = button("下一页", () => onPage(data.page + 1));
  previous.disabled = data.page <= 1;
  next.disabled = data.page >= pages;
  node.append(
    element("span", `共 ${data.total} 条 · ${data.page} / ${pages} 页`),
    previous,
    next,
  );
  return node;
}
function field(label: string, input: HTMLElement): HTMLElement {
  const node = element("div", "", "field");
  const title = element("label", label);
  title.htmlFor = input.id;
  node.append(title, input);
  return node;
}
function badge(status: FeedbackStatus): HTMLElement {
  return element("span", statusLabels[status], `status-pill status-${status}`);
}

async function renderOverview(full: boolean): Promise<HTMLElement> {
  const data = await api<Dashboard>(`dashboard?days=${range.value}`);
  const root = element("div");
  if (full) {
    const last = data.days[data.days.length - 1];
    const strip = element("div", "", "metric-strip");
    for (const [title, value, note] of [
      ["今日浏览量", last?.pv ?? 0, "PV · 页面浏览次数"],
      ["今日访客估算", last?.uv ?? 0, "UV · 按 IP 与浏览器估算"],
      ["今日独立 IP", last?.ips ?? 0, "去重后的网络地址"],
      ["待处理反馈", data.pending, "投稿、纠错与读者建议"],
    ] as const) {
      const item = element("section", "", "metric");
      item.append(
        element("p", title, "metric-label"),
        element("p", value.toLocaleString("zh-CN"), "metric-value"),
        element("p", note, "metric-note"),
      );
      strip.append(item);
    }
    root.append(strip);
  }
  const trend = panel(
    "每日访问趋势",
    `最近 ${range.value} 天 · ${data.totalPv.toLocaleString("zh-CN")} 次浏览`,
    full ? "traffic" : undefined,
  );
  trend.append(
    trendChart(
      data.firstDay ? data.days.filter((day) => day.day >= data.firstDay!) : [],
    ),
  );
  if (!data.firstDay)
    trend.append(
      element(
        "p",
        "尚无访问记录。统计会从功能启用后开始，之前的日期没有历史数据。",
        "notice",
      ),
    );
  root.append(trend);
  if (full) {
    const map = panel(
      "读者来自哪里",
      "省级访问量 · 亮度随浏览量增加",
      "regions",
    );
    map.append(regionMap(data.regions));
    root.append(map);
  }
  return root;
}
async function renderRegions(): Promise<HTMLElement> {
  const data = await api<Dashboard>(`dashboard?days=${range.value}`);
  const root = element("div");
  const map = panel(
    "地区访问热力",
    `最近 ${range.value} 天 · ${data.totalPv.toLocaleString("zh-CN")} 次浏览`,
  );
  map.append(regionMap(data.regions));
  root.append(map);
  const detail = panel("全部地区", "未知与海外同样计入总量");
  const entries = table(["国家或地区", "省级地区", "浏览量", "占比"]);
  for (const region of data.regions) {
    const row = element("tr");
    for (const text of [
      region.country,
      region.province,
      String(region.pv),
      data.totalPv ? `${((region.pv / data.totalPv) * 100).toFixed(1)}%` : "—",
    ])
      row.append(element("td", text));
    entries.body.append(row);
  }
  detail.append(
    data.regions.length
      ? entries.wrapper
      : empty(
          "还没有地区数据",
          "访问开始后会自动汇总，无法定位的地址会显示为未知。",
        ),
  );
  root.append(detail);
  return root;
}
async function renderFeedback(): Promise<HTMLElement> {
  const data = await api<PageResult<Feedback>>(
    `feedback?page=${feedbackPage}&status=${feedbackFilter}`,
  );
  const root = panel(
    "反馈收件箱",
    "仅管理员可见，处理状态不会自动发送邮件或公开内容",
  );
  const toolbar = element("div", "", "toolbar");
  const control = element("div");
  const label = element("label", "处理状态");
  label.htmlFor = "feedback-filter";
  const select = element("select");
  select.id = "feedback-filter";
  for (const status of ["", ...feedbackStatuses]) {
    const option = element(
      "option",
      status ? statusLabels[status as FeedbackStatus] : "全部状态",
    );
    option.value = status;
    select.append(option);
  }
  select.value = feedbackFilter;
  select.addEventListener("change", () => {
    feedbackFilter = select.value;
    feedbackPage = 1;
    void loadView();
  });
  control.append(label, select);
  toolbar.append(
    control,
    element("span", `${data.total} 条反馈`, "content-count"),
  );
  root.append(toolbar);
  const list = table(["类型 / 内容", "收到时间", "状态", "操作"]);
  const detail = element("section", "", "detail-panel");
  detail.hidden = true;
  for (const item of data.items) {
    const row = element("tr");
    const content = element("td");
    content.append(
      element(
        "span",
        `${kindLabels[item.kind]} · ${item.target}`,
        "feedback-target",
      ),
      element("span", item.details.slice(0, 75), "feedback-excerpt"),
    );
    const status = element("td");
    status.append(badge(item.status));
    const action = element("td");
    const open = button("查看处理", () =>
      openFeedback(item, detail, open, (updated) => {
        Object.assign(item, updated);
        status.replaceChildren(badge(updated.status));
        if (!root.isConnected) return;
        if (feedbackFilter && updated.status !== feedbackFilter) {
          void loadView().then(() => {
            if (loggedIn && currentView() === "feedback")
              message.textContent =
                "处理结果已加密保存；该记录已移出当前状态筛选。";
          });
        }
      }),
    );
    open.setAttribute("aria-label", `查看处理：${item.target}`);
    action.append(open);
    row.append(content, element("td", date(item.createdAt)), status, action);
    list.body.append(row);
  }
  root.append(
    data.items.length
      ? list.wrapper
      : empty("当前没有待查看的反馈", "收到投稿、意见或建议后，会出现在这里。"),
    pagination(data, (page) => {
      feedbackPage = page;
      void loadView();
    }),
    detail,
  );
  return root;
}
function openFeedback(
  item: Feedback,
  host: HTMLElement,
  trigger: HTMLButtonElement,
  onSaved: (updated: Feedback) => void,
): void {
  if (host.getAttribute("aria-busy") === "true") return;
  host.replaceChildren();
  host.hidden = false;
  const title = element("h3", `${kindLabels[item.kind]} · ${item.target}`);
  title.tabIndex = -1;
  host.append(title);
  const details = element("dl", "", "detail-grid");
  for (const [label, value] of [
    ["提交编号", item.id],
    ["收到时间", date(item.createdAt)],
    ["具体内容", item.details],
    ["联系方式", item.contact || "未填写"],
    ["提交 IP", item.ip || "已按期限清理"],
  ])
    details.append(element("dt", label), element("dd", value));
  if (item.source) {
    const value = element("dd");
    let safeSource = false;
    try {
      safeSource = ["http:", "https:"].includes(new URL(item.source).protocol);
    } catch {
      /* 无效来源按文本展示。 */
    }
    value.append(
      safeSource
        ? link("查看公开来源 ↗", item.source, true)
        : element("span", item.source),
    );
    details.append(element("dt", "来源链接"), value);
  }
  host.append(details);
  const form = element("form", "", "editor-form");
  const status = element("select");
  status.id = "review-status";
  for (const name of feedbackStatuses) {
    const option = element("option", statusLabels[name]);
    option.value = name;
    status.append(option);
  }
  status.value = item.status;
  const note = element("textarea");
  note.id = "review-note";
  note.maxLength = 2000;
  note.value = item.note;
  note.placeholder = "记录已核实的来源、处理结果或未采纳原因。";
  const save = element("button", "保存处理结果", "primary");
  save.type = "submit";
  const result = element("p", "", "form-status");
  result.setAttribute("role", "status");
  form.append(
    field("处理状态", status),
    field("内部处理意见（仅管理员可见）", note),
    save,
    result,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const epoch = sessionEpoch;
    host.setAttribute("aria-busy", "true");
    const openButtons = Array.from(
      host.parentElement?.querySelectorAll<HTMLButtonElement>("table button") ??
        [],
    );
    for (const openButton of openButtons) openButton.disabled = true;
    save.disabled = true;
    status.disabled = true;
    note.disabled = true;
    result.textContent = "正在加密保存…";
    void api<Feedback>(`feedback/${encodeURIComponent(item.id)}`, "PATCH", {
      status: status.value,
      note: note.value,
    })
      .then((updated) => {
        if (epoch !== sessionEpoch) return;
        if (form.isConnected) result.textContent = "处理结果已加密保存。";
        onSaved(updated);
      })
      .catch((error) => {
        if (form.isConnected)
          result.textContent =
            error instanceof Error
              ? `${error.message}；输入仍保留。`
              : "保存失败，输入仍保留。";
      })
      .finally(() => {
        host.setAttribute("aria-busy", "false");
        for (const openButton of openButtons) openButton.disabled = false;
        save.disabled = false;
        status.disabled = false;
        note.disabled = false;
      });
  });
  const close = (): void => {
    if (save.disabled) {
      result.textContent = "正在保存，请稍候。";
      return;
    }
    host.replaceChildren();
    host.hidden = true;
    trigger.focus();
  };
  host.onkeydown = (event) => {
    if (event.key === "Escape") close();
  };
  host.append(form, button("关闭详情", close));
  title.focus();
  host.scrollIntoView({ block: "nearest" });
}
async function renderVisits(): Promise<HTMLElement> {
  const data = await api<PageResult<Visit>>(`visits?page=${visitsPage}`);
  const root = panel(
    "最近访问明细",
    "完整 IP 与访问地址加密保存，90 天后自动清理",
  );
  const rows = table([
    "访问时间",
    "完整 IP",
    "大致地区",
    "访问页面",
    "来源 / 设备",
  ]);
  for (const visit of data.items) {
    const row = element("tr");
    const info = element("td");
    info.append(
      element("span", visit.referrer),
      element("small", `${visit.browser} · ${visit.device}`),
    );
    row.append(
      element("td", date(visit.createdAt)),
      element("td", visit.ip, "ip-cell"),
      element(
        "td",
        [visit.country, visit.province, visit.city]
          .filter(
            (value, index, all) =>
              value !== "未知" && all.indexOf(value) === index,
          )
          .join(" · ") || "未知",
      ),
      element("td", visit.path),
      info,
    );
    rows.body.append(row);
  }
  root.append(
    data.items.length
      ? rows.wrapper
      : empty(
          "还没有访问明细",
          "后台页面、明显爬虫与健康检查不会计入访客统计。",
        ),
    pagination(data, (page) => {
      visitsPage = page;
      void loadView();
    }),
  );
  return root;
}
async function renderContent(): Promise<HTMLElement> {
  const data = await api<{
    groups: {
      id: string;
      name: string;
      status: string;
      activity: { province: string; city: string };
      styleLabel: string;
    }[];
  }>("catalog");
  const root = panel("已发布团体资料", "修订仍需核对来源，并进入现有发布流程");
  if (!Array.isArray(data.groups)) throw new Error("公开资料索引格式不正确");
  const search = element("input");
  search.type = "search";
  search.placeholder = "搜索团体名称、城市或状态";
  search.setAttribute("aria-label", "搜索公开团体资料");
  const toolbar = element("div", "", "toolbar");
  const count = element(
    "span",
    `${data.groups.length} 条档案`,
    "content-count",
  );
  toolbar.append(search, count);
  root.append(toolbar);
  const results = table(["团体", "主要活动地区", "状态", "操作"]);
  const pages = element("div");
  const noResults = empty("没有匹配的档案", "试试团体名称、活动城市或状态。 ");
  let page = 1;
  const draw = (): void => {
    const term = search.value.trim().toLocaleLowerCase("zh-CN");
    const matches = data.groups.filter(
      (group) =>
        /^g\d{3,8}$/u.test(group.id) &&
        `${group.name} ${group.activity?.province} ${group.activity?.city} ${group.status}`
          .toLocaleLowerCase("zh-CN")
          .includes(term),
    );
    results.body.replaceChildren();
    count.textContent = `匹配 ${matches.length} 条档案`;
    for (const group of matches.slice((page - 1) * 50, page * 50)) {
      if (!/^g\d{3,8}$/u.test(group.id)) continue;
      const row = element("tr");
      const actions = element("td");
      actions.append(
        link("查看档案 ↗", `/group.html?group=${group.id}`, true),
        element("span", "　"),
        link("整理修订", `/contribute.html?group=${group.id}`, true),
      );
      row.append(
        element("td", group.name),
        element(
          "td",
          group.activity?.city || group.activity?.province || "未知",
        ),
        element("td", group.status),
        actions,
      );
      results.body.append(row);
    }
    noResults.hidden = matches.length > 0;
    results.wrapper.hidden = matches.length === 0;
    pages.replaceChildren(
      pagination(
        { items: [], total: matches.length, page, pageSize: 50 },
        (next) => {
          page = next;
          draw();
          search.focus();
        },
      ),
    );
  };
  search.addEventListener("input", () => {
    page = 1;
    draw();
  });
  draw();
  root.append(results.wrapper, noResults, pages);
  const note = element(
    "p",
    "后台不直接覆盖采集资料；“整理修订”会带入档案信息进入投稿页，核实后沿用现有资料发布流程。",
    "chart-note",
  );
  root.append(note);
  return root;
}
async function renderSettings(): Promise<HTMLElement> {
  const data = await api<ConsoleSettings>("settings");
  const root = panel(
    "接收与统计设置",
    "保存后立即生效，不会删除已经收到的资料",
  );
  const form = element("form", "", "editor-form");
  const accept = element("input");
  accept.type = "checkbox";
  accept.checked = data.acceptFeedback;
  accept.id = "accept-feedback";
  const analytics = element("input");
  analytics.type = "checkbox";
  analytics.checked = data.analyticsEnabled;
  analytics.id = "analytics-enabled";
  for (const [input, text] of [
    [accept, "接收网页投稿、意见反馈与建议"],
    [analytics, "记录网站访问量和地区分布"],
  ] as const) {
    const label = element("label", "", "check-field");
    label.append(input, text);
    form.append(label);
  }
  const notice = element("textarea");
  notice.id = "feedback-notice";
  notice.maxLength = 300;
  notice.value = data.feedbackNotice;
  notice.placeholder = "例如：来信较多，资料将按收到顺序核查。";
  form.append(field("投稿页提示语（可留空，最多 300 字符）", notice));
  form.append(
    element(
      "p",
      "访问明细保留 90 天，私人载荷加密保存。暂停统计后保留现有历史汇总。",
      "security-note",
    ),
  );
  const save = element("button", "保存设置", "primary");
  save.type = "submit";
  const status = element("p", "", "form-status");
  status.setAttribute("role", "status");
  form.append(save, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    status.textContent = "正在保存…";
    accept.disabled = true;
    analytics.disabled = true;
    notice.disabled = true;
    void api("settings", "PATCH", {
      acceptFeedback: accept.checked,
      analyticsEnabled: analytics.checked,
      feedbackNotice: notice.value,
    })
      .then(() => {
        if (form.isConnected) status.textContent = "设置已保存。";
      })
      .catch((error) => {
        if (form.isConnected)
          status.textContent =
            error instanceof Error
              ? `${error.message}；输入仍保留。`
              : "保存失败，输入仍保留。";
      })
      .finally(() => {
        save.disabled = false;
        accept.disabled = false;
        analytics.disabled = false;
        notice.disabled = false;
      });
  });
  root.append(form);
  return root;
}
async function renderSecurity(): Promise<HTMLElement> {
  const [system, audit] = await Promise.all([
    api<SystemInfo>("system"),
    api<PageResult<Audit>>(`audit?page=${auditPage}`),
  ]);
  const root = element("div");
  const grid = element("div", "", "security-summary");
  const running = panel("存储与运行", "状态来自当前管理服务");
  const details = element("dl", "", "detail-grid");
  for (const [label, value] of [
    ["当前管理员", system.username],
    ["数据加密", system.encryption],
    ["明细保留", `${system.retentionDays} 天`],
    [
      "地区数据库",
      system.geoReady ? "本地 IPv4 / IPv6 可用" : "未配置，地区显示未知",
    ],
    ["公开资料", system.siteAvailable ? "可读取" : "暂不可读"],
    ["数据库大小", `${(system.databaseBytes / 1048576).toFixed(2)} MB`],
    ["服务运行", `${Math.floor(system.uptimeSeconds / 60)} 分钟`],
    ["上次清理", system.lastCleanup ? date(system.lastCleanup) : "尚未执行"],
  ])
    details.append(element("dt", label), element("dd", value));
  running.append(
    details,
    element(
      "p",
      "密码仅保存散列。数据库中的私人载荷经过加密，密钥独立保存；本页不显示密钥或凭据。",
      "security-note",
    ),
  );
  const security = panel("登录安全", "密码修改后，所有已登录会话立即失效");
  const form = element("form", "", "editor-form");
  const current = element("input");
  current.id = "current-password";
  current.type = "password";
  current.autocomplete = "current-password";
  current.required = true;
  current.maxLength = 256;
  const replacement = element("input");
  replacement.id = "new-password";
  replacement.type = "password";
  replacement.autocomplete = "new-password";
  replacement.minLength = 14;
  replacement.maxLength = 256;
  replacement.required = true;
  const confirm = element("input");
  confirm.id = "confirm-password";
  confirm.type = "password";
  confirm.autocomplete = "new-password";
  confirm.required = true;
  const save = element("button", "修改密码", "primary");
  save.type = "submit";
  const status = element("p", "", "form-status");
  status.setAttribute("role", "status");
  form.append(
    field("当前密码", current),
    field("新密码（至少 14 字符）", replacement),
    field("再次输入新密码", confirm),
    save,
    status,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (replacement.value !== confirm.value) {
      status.textContent = "两次新密码不一致。";
      return;
    }
    save.disabled = true;
    const body = {
      currentPassword: current.value,
      newPassword: replacement.value,
    };
    current.value = "";
    replacement.value = "";
    confirm.value = "";
    void api("password", "POST", body)
      .then(() => showLogin("密码已更新，请使用新密码登录。"))
      .catch((error) => {
        status.textContent =
          error instanceof Error ? error.message : "修改失败";
      })
      .finally(() => {
        save.disabled = false;
      });
  });
  security.append(
    form,
    button("退出全部登录会话", () => {
      void api("logout-all", "POST", {})
        .then(() => showLogin("全部登录会话已退出。"))
        .catch((error) => {
          status.textContent =
            error instanceof Error ? error.message : "操作失败";
        });
    }),
  );
  grid.append(running, security);
  root.append(grid);
  const history = panel(
    "管理员操作审计",
    "仅记录动作与对象，不将投稿正文或完整 IP 写入操作描述",
  );
  const rows = table(["时间", "操作", "操作人", "对象"]);
  for (const item of audit.items) {
    const row = element("tr");
    for (const value of [
      date(item.createdAt),
      item.action,
      item.actor,
      item.target || "—",
    ])
      row.append(element("td", value));
    rows.body.append(row);
  }
  history.append(
    audit.items.length
      ? rows.wrapper
      : empty("暂无操作记录", "管理员操作发生后将在这里留存审计。"),
    pagination(audit, (page) => {
      auditPage = page;
      void loadView();
    }),
  );
  root.append(history);
  return root;
}
async function loadView(): Promise<void> {
  if (!loggedIn) return;
  const name = currentView();
  const version = ++generation;
  const focusId = document.activeElement?.id;
  const [title, description] = descriptions[name];
  required("view-title").textContent = title;
  required("view-description").textContent = description;
  for (const nav of document.querySelectorAll<HTMLAnchorElement>(
    "[data-view]",
  )) {
    if (nav.dataset.view === name) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  range.disabled = !["overview", "traffic", "regions"].includes(name);
  view.setAttribute("aria-busy", "true");
  view.inert = true;
  message.textContent = "正在读取…";
  try {
    const content = await (name === "overview"
      ? renderOverview(true)
      : name === "traffic"
        ? renderOverview(false)
        : name === "regions"
          ? renderRegions()
          : name === "feedback"
            ? renderFeedback()
            : name === "visits"
              ? renderVisits()
              : name === "content"
                ? renderContent()
                : name === "settings"
                  ? renderSettings()
                  : renderSecurity());
    if (version !== generation || !loggedIn) return;
    view.replaceChildren(content);
    view.inert = false;
    if (focusId)
      document.getElementById(focusId)?.focus({ preventScroll: true });
    message.textContent = `已更新 · ${date(Date.now())}`;
  } catch (error) {
    if (version !== generation || !loggedIn) return;
    const failure = empty(
      "暂时无法读取",
      error instanceof Error ? error.message : "请稍后重试",
    );
    failure.append(
      button("重试", () => {
        void loadView();
      }),
    );
    view.replaceChildren(failure);
    message.textContent = "读取未完成。";
  } finally {
    if (version === generation) {
      view.setAttribute("aria-busy", "false");
      view.inert = false;
    }
  }
}
function enter(data: AdminSession, requestStarted: number): void {
  const remaining = data.absoluteRemainingMs;
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > 8 * 60 * 60 * 1000
  ) {
    showLogin("无法确认登录有效期，请重新登录。");
    return;
  }
  // 从请求开始计时，保守扣除网络耗时；普通 API 成功不能延长绝对期限。
  absoluteDeadline = requestStarted + remaining;
  const delay = absoluteDeadline - performance.now();
  if (delay <= 0) {
    showLogin("登录已达到最长有效期，请重新登录。");
    return;
  }
  window.clearTimeout(absoluteTimer);
  absoluteTimer = window.setTimeout(
    () => showLogin("登录已达到最长有效期，请重新登录。"),
    delay,
  );
  csrf = data.csrf;
  loggedIn = true;
  login.hidden = true;
  shell.hidden = false;
  required("admin-name").textContent = data.username;
  armIdleLock();
  void loadView();
}
required<HTMLFormElement>("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const submit = required<HTMLButtonElement>("login-submit");
  if (submit.disabled) return;
  const epoch = sessionEpoch;
  const password = required<HTMLInputElement>("password");
  const body = {
    username: required<HTMLInputElement>("username").value,
    password: password.value,
  };
  password.value = "";
  submit.disabled = true;
  loginStatus.textContent = "正在登录…";
  const requestStarted = performance.now();
  void api<AdminSession>("login", "POST", body)
    .then((data) => {
      if (epoch === sessionEpoch) enter(data, requestStarted);
    })
    .catch((error) => {
      if (epoch === sessionEpoch) {
        loginStatus.textContent =
          error instanceof Error ? error.message : "登录失败";
        password.focus();
      }
    })
    .finally(() => {
      submit.disabled = false;
    });
});
required("logout").addEventListener("click", () => {
  const token = csrf;
  showLogin("正在结束登录会话…");
  const epoch = sessionEpoch;
  const submit = required<HTMLButtonElement>("login-submit");
  submit.disabled = true;
  void api("logout", "POST", {}, token)
    .then(() => {
      if (epoch === sessionEpoch) loginStatus.textContent = "已安全退出。";
    })
    .catch(() => {
      if (epoch === sessionEpoch)
        loginStatus.textContent =
          "私人界面已清除，但服务端退出未确认。请重新登录后重试退出，或关闭共享设备浏览器。";
    })
    .finally(() => {
      submit.disabled = false;
    });
});
required("refresh").addEventListener("click", () => {
  void loadView();
});
range.addEventListener("change", () => {
  void loadView();
});
window.addEventListener("hashchange", () => {
  void loadView();
});
// 禁用历史页面恢复带回私人 DOM；恢复后重新检查服务端会话。
async function restoreSession(): Promise<void> {
  showLogin("正在重新校验登录状态…");
  const epoch = sessionEpoch;
  const submit = required<HTMLButtonElement>("login-submit");
  submit.disabled = true;
  try {
    const requestStarted = performance.now();
    const data = await api<AdminSession>("session");
    if (epoch === sessionEpoch) enter(data, requestStarted);
  } catch {
    if (epoch === sessionEpoch) showLogin();
  } finally {
    submit.disabled = false;
  }
}
window.addEventListener("pagehide", () => {
  resumeSession = true;
  showLogin("正在重新校验登录状态…");
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    resumeSession = false;
    void restoreSession();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && loggedIn) {
    resumeSession = true;
    showLogin("正在重新校验登录状态…");
  } else if (!document.hidden && resumeSession) {
    resumeSession = false;
    void restoreSession();
  }
});
void restoreSession();

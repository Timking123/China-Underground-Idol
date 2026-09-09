// 仅供离线测试的浏览器替身；不导入 Playwright，不发网络请求，不读取会话状态。
export const TARGET = {
  id: "318",
  group: "users",
  action: "show_batch/other",
  apiPath: "users/show_batch/other",
  api_path: "users/show_batch/other",
  title: "批量获取其他用户的基本信息",
  description: "批量获取其他用户的基本信息",
  trialEnabled: true,
  isMyself: false,
  billingType: 1,
  pricePerUnit: 3,
  extraConfig: "",
};

// 价格解析器不使用此依赖；替身隔离未物化的站点路径，解析函数仍来自真实源码。
export const WEEKLY_LIMITS = Object.freeze({
  batchSize: 50,
  maximumBatches: 8,
  intervalMs: 2000,
  reserveCredits: 4000,
});

let scenario;
export const calls = { launches: [], requests: [], disposed: [], closed: 0 };

export function configure(patch = {}) {
  scenario = {
    account: {
      id: "9000000001",
      csrfToken: "SYNTHETIC_CSRF_SECRET",
      username: "合成姓名",
    },
    commands: { commands: [{ ...TARGET, privateNote: "合成敏感字段" }] },
    subscription: {
      serviceStatus: { kind: "formal_active", balance: 99999 },
      invoice: "合成账单",
    },
    cells: ["users", TARGET.apiPath, TARGET.title, "3C/条"],
    rowCount: 1,
    ...patch,
  };
  calls.launches = [];
  calls.requests = [];
  calls.disposed = [];
  calls.closed = 0;
  calls.route = undefined;
  calls.navigation = undefined;
}

function kindFor(url) {
  if (url.endsWith("/auth/me")) return "account";
  if (url.endsWith("/me/commands")) return "commands";
  if (url.endsWith("/me/billing/subscription")) return "subscription";
  throw new Error("合成浏览器收到未许可端点");
}

function makeResponse(kind, url) {
  const response = scenario.responses?.[kind] ?? {};
  const bytes =
    response.bytes ??
    Buffer.from(response.body ?? JSON.stringify(scenario[kind]));
  return {
    status: () => response.status ?? 200,
    url: () => response.url ?? url,
    headers: () => ({
      "content-type": "application/json;charset=utf-8",
      "content-length": String(bytes.length),
      ...response.headers,
    }),
    body: async () => bytes,
    dispose: async () => {
      calls.disposed.push(kind);
    },
  };
}

function rows() {
  const value = {
    filter: () => value,
    first: () => value,
    waitFor: async () => {
      if (scenario.rowsError) throw new Error(scenario.rowsError);
    },
    count: async () => scenario.rowCount,
    locator: (selector) => {
      if (selector !== "td") throw new Error("合成单元格选择器不匹配");
      return { allInnerTexts: async () => scenario.cells };
    },
  };
  return value;
}

export const chromium = {
  launchPersistentContext: async (profileRoot, options) => {
    calls.launches.push({ profileRoot, options });
    if (scenario.launchError) throw new Error(scenario.launchError);
    await scenario.onLaunch?.();
    return {
      request: {
        get: async (url, options) => {
          const kind = kindFor(url);
          calls.requests.push({ url, options });
          await scenario.onRequest?.(kind);
          if (scenario.requestError) throw new Error(scenario.requestError);
          return makeResponse(kind, url);
        },
      },
      route: async (pattern, handler) => {
        calls.route = { pattern, handler };
      },
      newPage: async () => ({
        goto: async (url, options) => {
          calls.navigation = { url, options };
          if (scenario.navigationError)
            throw new Error(scenario.navigationError);
          return {
            status: () => scenario.planStatus ?? 200,
            url: () =>
              scenario.responseURL ?? "https://open.weibo.com/cli/plan",
            request: () => ({
              redirectedFrom: () => (scenario.redirected ? {} : null),
            }),
          };
        },
        url: () =>
          scenario.pageURL ?? "https://open.weibo.com/cli/plan#services",
        getByRole: (role, options) => ({
          role,
          options,
          waitFor: async () => {
            if (scenario.headingError) throw new Error(scenario.headingError);
          },
        }),
        locator: (selector) => {
          if (selector !== "table tbody tr")
            throw new Error("合成表格选择器不匹配");
          return rows();
        },
      }),
      close: async () => {
        calls.closed++;
        if (scenario.closeError) throw new Error(scenario.closeError);
      },
    };
  },
};

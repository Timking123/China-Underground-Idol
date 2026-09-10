import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  rmdir,
  symlink,
} from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const producerURL = new URL("../server/weeklyAccounting.ts", import.meta.url)
  .href;
// 替身仅存在于测试进程，不提供可向生产采集器注入响应或端点的参数。
const fixtureURL = `data:text/javascript,${encodeURIComponent(`
let scenario;
export const calls = { requests: [], launches: [], disposed: [], closed: 0, waits: [] };
export function configure(input) {
  scenario = input;
  calls.requests = []; calls.launches = []; calls.disposed = []; calls.closed = 0; calls.waits = [];
  calls.route = undefined;
}
export async function setTimeout(milliseconds) {
  calls.waits.push(milliseconds);
  await scenario.onWait?.(milliseconds);
}
export const chromium = {
  launchPersistentContext: async (profileRoot, options) => {
    calls.launches.push({ profileRoot, options });
    await scenario.onLaunch?.();
    if (scenario.launchError) throw new Error(scenario.launchError);
    return {
      route: async (pattern, handler) => { calls.route = { pattern, handler }; },
      request: { get: async (url, options) => {
        const kinds = {
          "https://open.weibo.com/cli/api/auth/me": "account",
          "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1": "ledger",
          "https://open.weibo.com/cli/api/me/usage-logs?limit=20": "usage",
        };
        const kind = kinds[url];
        if (!kind) throw new Error("合成浏览器收到未知请求");
        calls.requests.push({ kind, url, options });
        await scenario.onRequest?.(kind);
        if (scenario.requestError) throw new Error(scenario.requestError);
        const sequence = scenario.responses?.[kind];
        const attempt = calls.requests.filter((request) => request.kind === kind).length - 1;
        const patch = (Array.isArray(sequence) ? sequence[Math.min(attempt, sequence.length - 1)] : sequence) ?? {};
        if (patch.requestError) throw Object.assign(new Error(patch.requestError.message), patch.requestError);
        const bytes = patch.bytes ?? Buffer.from(patch.body ?? JSON.stringify(scenario[kind]));
        return {
          status: () => patch.status ?? 200,
          url: () => patch.url ?? url,
          headers: () => ({ "content-type": "application/json;charset=utf-8", "content-length": String(bytes.length), ...patch.headers }),
          body: async () => { if (patch.bodyError) throw Object.assign(new Error(patch.bodyError.message), patch.bodyError); return bytes; },
          dispose: async () => { calls.disposed.push(kind); },
        };
      } },
      close: async () => { calls.closed++; if (scenario.closeError) throw new Error(scenario.closeError); },
    };
  },
};
`)}`;
const { calls, configure } = await import(fixtureURL);
register(
  `data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (["playwright", "node:timers/promises"].includes(specifier) && context.parentURL === ${JSON.stringify(producerURL)})
      return { url: ${JSON.stringify(fixtureURL)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`,
  import.meta.url,
);
const { collectWeeklyAccounting, projectWeeklyAccounting } = await import(
  producerURL
);

const ACCOUNT = "9000000001";
const SECRET = "SYNTHETIC_PRIVATE_CREDENTIAL";
const scope = createHash("sha256").update(ACCOUNT).digest("hex").slice(0, 16);

function observation(count = 3) {
  const batches = Array.from({ length: count }, (_, index) => ({
    uids: Array.from({ length: 50 }, (_, offset) =>
      String(7000000000 + 50 * index + offset),
    ),
    startedAt: new Date(
      Date.UTC(2026, 8, 10, 16, 0, 1 + index * 10),
    ).toISOString(),
    observedAt: new Date(
      Date.UTC(2026, 8, 10, 16, 0, 3 + index * 10, 764),
    ).toISOString(),
    maximumCredits: 150,
  }));
  const logs = batches.map((batch, index) => ({
    id: String(517161 + index),
    userId: ACCOUNT,
    createdAt: new Date(Date.parse(batch.observedAt) + 236).toISOString(),
    method: "GET",
    commandPath: "users/show_batch/other",
    statusCode: 200,
    recordCount: 50,
    billingType: 1,
    creditsDeducted: 150,
    requestParams: { uids: batch.uids.join(","), token: SECRET },
    tokenId: SECRET,
    username: SECRET,
    tokenDisplay: SECRET,
    authorizationLabel: SECRET,
    accountMatched: true,
  }));
  const records = logs.map((row, index) => ({
    id: String(295244 + index),
    user_id: ACCOUNT,
    created_at: row.createdAt,
    source_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    delta: "-150",
    balance_after: String(20456 - 150 * (index + 1)),
    description: "[users/show_batch/other] per_record: 50 records × 3 pts",
    type: "api_deduct",
    source_type: "api_call",
    lot_breakdown: SECRET,
    accountMatched: true,
  }));
  return {
    expectedAccountScope: scope,
    projectionAt: "2026-09-10T16:10:00.000Z",
    batches,
    account: {
      id: ACCOUNT,
      weibo_uid: "8111111111",
      username: SECRET,
      csrfToken: SECRET,
    },
    ledger: { records, page: 1, limit: 20, hasOlder: true, hasNewer: false },
    usage: { logs, limit: 20, hasOlder: true, hasNewer: false },
  };
}

async function fixture(t, patch = {}) {
  const input = { ...observation(), ...patch };
  configure(input);
  const temporary = await mkdtemp(
    path.join(tmpdir(), "idol-weekly-accounting-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith("idol-weekly-accounting-"));
    assert.equal((await lstat(temporary)).isSymbolicLink(), false);
    await rm(temporary, { recursive: true, force: true });
  });
  const stageRoot = path.join(temporary, "stage");
  const profileRoot = path.join(temporary, "synthetic-profile");
  await mkdir(stageRoot, { mode: 0o700 });
  await mkdir(profileRoot, { mode: 0o700 });
  return { ...input, temporary, stageRoot, profileRoot };
}

async function noArchive(f) {
  const root = path.join(f.stageRoot, "private", "official-accounting");
  assert.deepEqual(await readdir(root), []);
}

test("当前官方字段生成三笔唯一核账投影，236ms 官方时钟超前在有界容差内", () => {
  const input = observation();
  const bytes = projectWeeklyAccounting(input);
  const result = JSON.parse(bytes);
  assert.equal(result.schemaVersion, "idol-official-accounting-observation-v1");
  assert.equal(
    result.sourceKind,
    "official_browser_response_whitelist_projection",
  );
  assert.equal(result.accountScopeHash, scope);
  assert.deepEqual(
    result.ledger.map((row) => row.balanceAfter),
    ["20306", "20156", "20006"],
  );
  assert.deepEqual(
    result.usage.map((row) => row.id),
    ["517161", "517162", "517163"],
  );
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "schemaVersion",
      "projectionAt",
      "accountScopeHash",
      "sourceKind",
      "sources",
      "ledger",
      "usage",
      "notes",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(result.ledger[0]).sort(),
    [
      "id",
      "source_id",
      "createdAt",
      "delta",
      "balanceAfter",
      "description",
      "type",
      "sourceType",
      "accountMatched",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(result.usage[0]).sort(),
    [
      "id",
      "createdAt",
      "method",
      "commandPath",
      "status",
      "recordCount",
      "billingType",
      "creditsDeducted",
      "requestParams",
      "accountMatched",
    ].sort(),
  );
  assert.deepEqual(result.usage[0].requestParams, {
    uids: input.batches[0].uids.join(","),
  });
  assert.equal(bytes.includes(SECRET), false);
  assert.equal(bytes.includes(ACCOUNT), false);
  assert.equal(
    result.ledger.every((row) => row.accountMatched),
    true,
  );
  assert.equal(
    result.usage.every((row) => row.accountMatched),
    true,
  );
});

test("输入支持一至八批，仍按请求顺序投影且不依赖原始账单排序", () => {
  for (const count of [1, 8]) {
    const input = observation(count);
    input.ledger.records.reverse();
    input.usage.logs.reverse();
    assert.equal(
      JSON.parse(projectWeeklyAccounting(input)).usage.length,
      count,
    );
  }
});

for (const [name, mutate, code] of [
  [
    "当前账户哈希不匹配",
    (f) => {
      f.expectedAccountScope = "0000000000000000";
    },
    "account_mismatch",
  ],
  [
    "不能用微博 UID 代替平台账户 ID",
    (f) => {
      f.expectedAccountScope = createHash("sha256")
        .update(f.account.weibo_uid)
        .digest("hex")
        .slice(0, 16);
    },
    "account_mismatch",
  ],
  [
    "账本账户错即使伪造 accountMatched",
    (f) => {
      f.ledger.records[0].user_id = "9000000002";
    },
    "account_mismatch",
  ],
  [
    "usage 账户错即使伪造 accountMatched",
    (f) => {
      f.usage.logs[0].userId = "9000000002";
    },
    "account_mismatch",
  ],
  [
    "缺原始账本账户",
    (f) => {
      delete f.ledger.records[0].user_id;
    },
    "account_invalid",
  ],
  [
    "缺原始 usage 账户",
    (f) => {
      delete f.usage.logs[0].userId;
    },
    "account_invalid",
  ],
  [
    "零批次",
    (f) => {
      f.batches = [];
    },
    "scope_invalid",
  ],
  [
    "超过八批次",
    (f) => {
      f.batches = observation(9).batches;
    },
    "scope_invalid",
  ],
  [
    "批次重用 UID",
    (f) => {
      f.batches[1].uids[0] = f.batches[0].uids[0];
    },
    "scope_invalid",
  ],
  [
    "空 UID",
    (f) => {
      f.batches[0].uids = [];
    },
    "scope_invalid",
  ],
  [
    "批次时间反向",
    (f) => {
      f.batches[0].startedAt = f.batches[1].startedAt;
    },
    "scope_invalid",
  ],
  [
    "投影早于观察",
    (f) => {
      f.projectionAt = f.batches[0].observedAt;
    },
    "projection_time_invalid",
  ],
  [
    "非真实日期",
    (f) => {
      f.batches[0].startedAt = "2026-02-30T16:00:00.000Z";
    },
    "scope_invalid",
  ],
  [
    "未知 wrapper",
    (f) => {
      f.ledger.data = f.ledger.records;
      delete f.ledger.records;
    },
    "response_invalid",
  ],
  [
    "错误账本分页",
    (f) => {
      f.ledger.page = 2;
    },
    "response_invalid",
  ],
  [
    "缺 usage",
    (f) => {
      f.usage.logs.shift();
    },
    "usage_nonunique",
  ],
  [
    "缺 ledger",
    (f) => {
      f.ledger.records.shift();
    },
    "ledger_nonunique",
  ],
  [
    "usage ID 重复",
    (f) => {
      f.usage.logs[1].id = f.usage.logs[0].id;
    },
    "duplicate_row",
  ],
  [
    "ledger ID 重复",
    (f) => {
      f.ledger.records[1].id = f.ledger.records[0].id;
    },
    "duplicate_row",
  ],
  [
    "两个完整 usage 匹配",
    (f) => {
      f.usage.logs.push({ ...f.usage.logs[0], id: "999001" });
    },
    "usage_nonunique",
  ],
  [
    "同一时间有两个 ledger",
    (f) => {
      f.ledger.records.push({ ...f.ledger.records[0], id: "999002" });
    },
    "ledger_nonunique",
  ],
  [
    "source_id 重用",
    (f) => {
      f.ledger.records[1].source_id = f.ledger.records[0].source_id;
    },
    "row_reused",
  ],
  [
    "完整 UID 顺序不符",
    (f) => {
      f.usage.logs[0].requestParams.uids = [...f.batches[0].uids]
        .reverse()
        .join(",");
    },
    "usage_nonunique",
  ],
  [
    "UID 仅部分相同",
    (f) => {
      f.usage.logs[0].requestParams.uids = f.batches[0].uids
        .slice(0, 49)
        .join(",");
    },
    "usage_nonunique",
  ],
  [
    "错误业务命令",
    (f) => {
      f.usage.logs[0].commandPath = "statuses/user_timeline/other";
    },
    "usage_nonunique",
  ],
  [
    "usage 非 200",
    (f) => {
      f.usage.logs[0].statusCode = 503;
    },
    "usage_invalid",
  ],
  [
    "usage 非 GET",
    (f) => {
      f.usage.logs[0].method = "POST";
    },
    "usage_invalid",
  ],
  [
    "费用超过请求预算",
    (f) => {
      f.usage.logs[0].creditsDeducted = 151;
    },
    "usage_invalid",
  ],
  [
    "负费用",
    (f) => {
      f.usage.logs[0].creditsDeducted = -1;
    },
    "usage_invalid",
  ],
  [
    "超过六位精度的费用",
    (f) => {
      f.usage.logs[0].creditsDeducted = 1.0000001;
    },
    "usage_invalid",
  ],
  [
    "非法批次预算",
    (f) => {
      f.batches[0].maximumCredits = -1;
    },
    "scope_invalid",
  ],
  [
    "条数超过请求上界",
    (f) => {
      f.usage.logs[0].recordCount = 51;
    },
    "usage_invalid",
  ],
  [
    "正返回条数却零扣费",
    (f) => {
      f.usage.logs[0].creditsDeducted = 0;
    },
    "usage_invalid",
  ],
  [
    "账本费用不符",
    (f) => {
      f.ledger.records[0].delta = "-149";
    },
    "ledger_invalid",
  ],
  [
    "非法账本余额",
    (f) => {
      f.ledger.records[1].balance_after = "-1";
    },
    "ledger_invalid",
  ],
  [
    "usage 比观察晚 1001ms",
    (f) => {
      f.usage.logs[0].createdAt = new Date(
        Date.parse(f.batches[0].observedAt) + 1001,
      ).toISOString();
    },
    "usage_nonunique",
  ],
  [
    "usage 比请求开始早 1001ms",
    (f) => {
      f.usage.logs[0].createdAt = new Date(
        Date.parse(f.batches[0].startedAt) - 1001,
      ).toISOString();
    },
    "usage_nonunique",
  ],
  [
    "账本和 usage 创建时间不同",
    (f) => {
      f.ledger.records[0].created_at = new Date(
        Date.parse(f.usage.logs[0].createdAt) + 1,
      ).toISOString();
    },
    "ledger_nonunique",
  ],
  [
    "账本备注含凭据时拒绝",
    (f) => {
      f.ledger.records[0].description = SECRET;
    },
    "ledger_invalid",
  ],
]) {
  test(`${name}时拒绝核账，错误不携带原始内容`, () => {
    const input = observation();
    mutate(input);
    assert.throws(
      () => projectWeeklyAccounting(input),
      (error) => {
        assert.equal(error.message, `weekly_accounting_${code}`);
        assert.equal(error.stack.includes(SECRET), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  });
}

test("一秒容差边界可匹配，不能用它放宽完整 UID 与账户约束", () => {
  for (const offset of [-1000, 1000]) {
    const input = observation();
    input.usage.logs[0].createdAt = new Date(
      Date.parse(
        offset < 0 ? input.batches[0].startedAt : input.batches[0].observedAt,
      ) + offset,
    ).toISOString();
    input.ledger.records[0].created_at = input.usage.logs[0].createdAt;
    assert.equal(JSON.parse(projectWeeklyAccounting(input)).usage.length, 3);
  }
});

test("合法小数余额必须透传原始十进制字符串，不因账号过去的零碎消费而卡住", () => {
  const input = observation(1);
  input.ledger.records[0].balance_after = "20306.125600";
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.ledger[0].balanceAfter, "20306.125600");
});

test("六位以内小数扣费及预算按百万分之一积分比较，账本字符串保持原格式", () => {
  const input = observation(1);
  input.batches[0].maximumCredits = 147.5;
  input.usage.logs[0].creditsDeducted = 147.5;
  input.ledger.records[0].delta = "-147.500000";
  input.ledger.records[0].balance_after = "20308.500000";
  input.ledger.records[0].description =
    "[users/show_batch/other] per_record: 50 records × 2.95 pts";
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.usage[0].creditsDeducted, 147.5);
  assert.equal(result.ledger[0].delta, "-147.500000");
  assert.equal(result.ledger[0].balanceAfter, "20308.500000");
  input.usage.logs[0].creditsDeducted = 147.500001;
  assert.throws(() => projectWeeklyAccounting(input), {
    message: "weekly_accounting_usage_invalid",
  });
});

test("响应慢于官方记账两秒以上时仍按完整请求时间区间匹配，不能要求记录只在最后一秒", () => {
  const input = observation(1);
  input.batches[0].observedAt = new Date(
    Date.parse(input.batches[0].observedAt) + 2500,
  ).toISOString();
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.usage[0].createdAt, input.usage.logs[0].createdAt);
  assert.equal(result.ledger[0].createdAt, input.ledger.records[0].created_at);
});

for (const [name, mutate, code] of [
  [
    "余额超过百万分之一积分安全整数",
    (f) => {
      f.ledger.records[0].balance_after = "9007199254.740992";
    },
    "ledger_invalid",
  ],
  [
    "余额超过六位小数",
    (f) => {
      f.ledger.records[0].balance_after = "20306.0000001";
    },
    "ledger_invalid",
  ],
  [
    "借记相差百万分之一积分",
    (f) => {
      f.ledger.records[0].delta = "-150.000001";
    },
    "ledger_invalid",
  ],
  [
    "单价超过六位小数",
    (f) => {
      f.ledger.records[0].description =
        "[users/show_batch/other] per_record: 50 records × 3.0000001 pts";
    },
    "ledger_invalid",
  ],
  [
    "预算超过百万分之一积分安全整数",
    (f) => {
      f.batches[0].maximumCredits = Number.MAX_SAFE_INTEGER;
    },
    "scope_invalid",
  ],
]) {
  test(`${name}仍拒绝，不用浮点容差掩盖金额差异`, () => {
    const input = observation(1);
    mutate(input);
    assert.throws(() => projectWeeklyAccounting(input), {
      message: `weekly_accounting_${code}`,
    });
  });
}

test("部分账号缺失时投影实际49条147C，后续余额链按实际扣费闭合", () => {
  const input = observation();
  input.usage.logs[1].recordCount = 49;
  input.usage.logs[1].creditsDeducted = 147;
  input.ledger.records[1].delta = "-147";
  input.ledger.records[1].description =
    "[users/show_batch/other] per_record: 49 records × 3 pts";
  input.ledger.records[1].balance_after = "20159";
  input.ledger.records[2].balance_after = "20009";
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.usage[1].recordCount, 49);
  assert.equal(result.usage[1].creditsDeducted, 147);
  assert.equal(result.ledger[1].delta, "-147");
  assert.equal(result.ledger[2].balanceAfter, "20009");
});

test("每批可能使用不同 guard，单价和余额实值留给纯核账按各批合约判断", () => {
  const input = observation();
  input.batches[1].maximumCredits = 200;
  input.usage.logs[1].creditsDeducted = 200;
  input.ledger.records[1].delta = "-200";
  input.ledger.records[1].description =
    "[users/show_batch/other] per_record: 50 records × 4 pts";
  input.ledger.records[1].balance_after = "25000";
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.usage[1].creditsDeducted, 200);
  assert.equal(result.ledger[1].balanceAfter, "25000");
});

test("零条零扣费且官方没有账本项时不伪造 ledger", () => {
  const input = observation();
  input.usage.logs[1].recordCount = 0;
  input.usage.logs[1].creditsDeducted = 0;
  input.ledger.records.splice(1, 1);
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.usage.length, 3);
  assert.equal(result.usage[1].creditsDeducted, 0);
  assert.equal(result.ledger.length, 2);
  assert.equal(
    result.ledger.some((row) => row.createdAt === result.usage[1].createdAt),
    false,
  );
});

test("零条零扣费的真实唯一零额账本保留；同时间非零或重复账本拒绝", () => {
  const input = observation();
  input.usage.logs[1].recordCount = 0;
  input.usage.logs[1].creditsDeducted = 0;
  input.ledger.records[1].delta = "0";
  input.ledger.records[1].description =
    "[users/show_batch/other] per_record: 0 records × 3 pts";
  const result = JSON.parse(projectWeeklyAccounting(input));
  assert.equal(result.ledger.length, 3);
  assert.equal(result.ledger[1].delta, "0");
  input.ledger.records[1].delta = "-1";
  assert.throws(() => projectWeeklyAccounting(input), {
    message: "weekly_accounting_ledger_invalid",
  });
  input.ledger.records[1].delta = "0";
  input.ledger.records.push({ ...input.ledger.records[1], id: "999003" });
  assert.throws(() => projectWeeklyAccounting(input), {
    message: "weekly_accounting_ledger_nonunique",
  });
});

test("生产入口只发三个固定 GET，不导航、不手工拼凭据，关闭后仅返回白名单 Buffer", async (t) => {
  const f = await fixture(t);
  const startedAt = Date.now();
  const bytes = await collectWeeklyAccounting(f);
  const proof = JSON.parse(bytes);
  assert.ok(Date.parse(proof.projectionAt) >= startedAt);
  assert.equal(calls.launches.length, 1);
  assert.equal(calls.launches[0].profileRoot, f.profileRoot);
  assert.equal(calls.launches[0].options.locale, "zh-CN");
  assert.equal(calls.launches[0].options.serviceWorkers, "block");
  assert.equal(calls.launches[0].options.acceptDownloads, false);
  assert.deepEqual(
    calls.requests.map((row) => row.url),
    [
      "https://open.weibo.com/cli/api/auth/me",
      "https://open.weibo.com/cli/api/me/credit/ledger?limit=20&page=1",
      "https://open.weibo.com/cli/api/me/usage-logs?limit=20",
    ],
  );
  for (const { options } of calls.requests) {
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.headers["Cache-Control"], "no-cache");
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.timeout > 0 && options.timeout <= 15000);
  }
  assert.deepEqual(calls.disposed, ["account", "ledger", "usage"]);
  assert.equal(calls.closed, 1);
  assert.equal(bytes.includes(SECRET), false);
  assert.equal(bytes.includes(ACCOUNT), false);
  let aborted = false;
  await calls.route.handler({
    abort: async () => {
      aborted = true;
    },
  });
  assert.equal(aborted, true);
  await noArchive(f);
});

for (const [name, patch, code] of [
  ["账户 401", { responses: { account: { status: 401 } } }, "login_required"],
  ["账本 403", { responses: { ledger: { status: 403 } } }, "login_required"],
  ["usage 302", { responses: { usage: { status: 302 } } }, "login_required"],
  [
    "账本 503",
    { responses: { ledger: { status: 503 } } },
    "source_http_failure",
  ],
  [
    "usage 500",
    { responses: { usage: { status: 500 } } },
    "source_http_failure",
  ],
  [
    "意外响应 URL",
    { responses: { ledger: { url: "https://unexpected.example" } } },
    "source_http_failure",
  ],
  [
    "HTML 登录页",
    { responses: { account: { headers: { "content-type": "text/html" } } } },
    "response_invalid",
  ],
  ["坏 JSON", { responses: { ledger: { body: "{bad" } } }, "response_invalid"],
  [
    "坏 UTF8",
    { responses: { usage: { bytes: Buffer.from([0xff]) } } },
    "response_invalid",
  ],
  [
    "声明超限",
    { responses: { ledger: { headers: { "content-length": "99999999" } } } },
    "response_too_large",
  ],
  [
    "正文超限",
    {
      responses: {
        usage: {
          bytes: Buffer.alloc(4 * 1024 * 1024 + 1),
          headers: { "content-length": "" },
        },
      },
    },
    "response_too_large",
  ],
  [
    "HTTP200 错误对象",
    { responses: { ledger: { body: JSON.stringify({ error: SECRET }) } } },
    "response_invalid",
  ],
  [
    "响应中账户错",
    { account: { id: "9000000002", csrfToken: SECRET } },
    "account_mismatch",
  ],
  [
    "原始异常带凭据",
    { requestError: `Authorization Bearer ${SECRET}` },
    "unavailable",
  ],
  ["启动错误带凭据", { launchError: SECRET }, "unavailable"],
  ["关闭失败", { closeError: SECRET }, "browser_close_failed"],
]) {
  test(`${name}时生产入口拒绝且不留原始响应`, async (t) => {
    const f = await fixture(t, patch);
    await assert.rejects(collectWeeklyAccounting(f), (error) => {
      assert.equal(error.message, `weekly_accounting_${code}`);
      assert.equal(error.stack.includes(SECRET), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    if (code === "account_mismatch") assert.equal(calls.requests.length, 1);
    await noArchive(f);
  });
}

test("投影校验失败从采集入口保留固定失败码且净化日志", async (t) => {
  const input = observation();
  input.usage.logs[0].userId = "9000000002";
  const f = await fixture(t, input);
  const logged = [];
  for (const name of ["log", "warn", "error", "info", "debug"]) {
    t.mock.method(console, name, (...args) => logged.push(args));
  }
  await assert.rejects(collectWeeklyAccounting(f), {
    message: "weekly_accounting_account_mismatch",
  });
  assert.deepEqual(logged, []);
  await noArchive(f);
});

test("不存在正常会话时要求登录，不能新造 profile", async (t) => {
  const f = await fixture(t);
  await rmdir(f.profileRoot);
  await assert.rejects(collectWeeklyAccounting(f), {
    message: "weekly_accounting_login_required",
  });
  assert.equal(calls.launches.length, 0);
  await assert.rejects(lstat(f.profileRoot), { code: "ENOENT" });
});

test("拒绝相对路径、父级穿越与 profile 联接", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    collectWeeklyAccounting({ ...f, profileRoot: "relative" }),
    { message: "weekly_accounting_unsafe_path" },
  );
  await assert.rejects(
    collectWeeklyAccounting({
      ...f,
      stageRoot: `${f.stageRoot}${path.sep}..${path.sep}other`,
    }),
    { message: "weekly_accounting_unsafe_path" },
  );
  const linked = path.join(f.temporary, "linked-profile");
  await symlink(
    f.profileRoot,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(collectWeeklyAccounting({ ...f, profileRoot: linked }), {
    message: "weekly_accounting_unsafe_path",
  });
  assert.equal(calls.launches.length, 0);
});

test("并发采集不抢占现有锁且不启动第二个浏览器", async (t) => {
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    onLaunch: async () => {
      entered();
      await paused;
    },
  });
  const first = collectWeeklyAccounting(f);
  await started;
  await assert.rejects(collectWeeklyAccounting(f), {
    message: "weekly_accounting_locked",
  });
  assert.equal(calls.launches.length, 1);
  release();
  await first;
  await noArchive(f);
});

test("总时限耗尽后不发下一个 GET", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await fixture(t, {
    onRequest: async (kind) => {
      if (kind === "account") t.mock.timers.tick(90001);
    },
  });
  await assert.rejects(collectWeeklyAccounting(f), {
    message: "weekly_accounting_timeout",
  });
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.closed, 1);
  await noArchive(f);
});

for (const kind of ["account", "ledger", "usage"]) {
  test(`${kind} 的 503、429 暂时故障可退避恢复，最多三次固定只读 GET`, async (t) => {
    const f = await fixture(t, {
      responses: { [kind]: [{ status: 503 }, { status: 429 }, {}] },
    });
    const result = JSON.parse(await collectWeeklyAccounting(f));
    assert.equal(result.usage.length, 3);
    assert.deepEqual(calls.waits, [1000, 2000]);
    assert.equal(
      calls.requests.filter((request) => request.kind === kind).length,
      3,
    );
    assert.equal(
      calls.disposed.filter((disposed) => disposed === kind).length,
      3,
    );
    assert.equal(calls.requests.length, 5);
    assert.equal(calls.closed, 1);
    await noArchive(f);
  });
}

for (const [name, patch] of [
  ["网络系统码", { requestError: { code: "ECONNRESET", message: SECRET } }],
  [
    "Playwright 网络消息",
    {
      requestError: {
        message: `apiRequestContext.get: connect ECONNREFUSED ${SECRET}`,
      },
    },
  ],
  [
    "Playwright 超时",
    { requestError: { name: "TimeoutError", message: SECRET } },
  ],
  ["响应体网络中断", { bodyError: { code: "EPIPE", message: SECRET } }],
]) {
  test(`${name}只重试失败来源且成功后停止退避`, async (t) => {
    const f = await fixture(t, { responses: { ledger: [patch, {}] } });
    const bytes = await collectWeeklyAccounting(f);
    assert.deepEqual(calls.waits, [1000]);
    assert.deepEqual(
      calls.requests.map((request) => request.kind),
      ["account", "ledger", "ledger", "usage"],
    );
    assert.equal(bytes.includes(SECRET), false);
    await noArchive(f);
  });
}

for (const [name, patch, code] of [
  ["持续 429", { status: 429 }, "source_http_failure"],
  ["持续 503", { status: 503 }, "source_http_failure"],
  [
    "持续网络异常",
    { requestError: { code: "ETIMEDOUT", message: SECRET } },
    "unavailable",
  ],
]) {
  test(`${name}在第三次失败后停止，不读取下一来源`, async (t) => {
    const f = await fixture(t, { responses: { account: patch } });
    await assert.rejects(collectWeeklyAccounting(f), (error) => {
      assert.equal(error.message, `weekly_accounting_${code}`);
      assert.equal(error.stack.includes(SECRET), false);
      return true;
    });
    assert.deepEqual(
      calls.requests.map((request) => request.kind),
      ["account", "account", "account"],
    );
    assert.deepEqual(calls.waits, [1000, 2000]);
    assert.equal(calls.closed, 1);
    await noArchive(f);
  });
}

for (const [name, patch, code] of [
  ["401", { status: 401 }, "login_required"],
  ["403", { status: 403 }, "login_required"],
  ["登录重定向", { status: 302 }, "login_required"],
  ["404", { status: 404 }, "source_http_failure"],
  [
    "503 却来自错误 URL",
    { status: 503, url: "https://unexpected.example" },
    "source_http_failure",
  ],
  ["HTTP200 坏 JSON", { body: "{bad" }, "response_invalid"],
  [
    "HTTP200 错误 schema",
    { body: JSON.stringify({ success: false, error: SECRET }) },
    "response_invalid",
  ],
  [
    "HTTP200 缺少身份",
    { body: JSON.stringify({ csrfToken: SECRET }) },
    "account_invalid",
  ],
  [
    "HTTP200 身份错误",
    { body: JSON.stringify({ id: "9000000002" }) },
    "account_mismatch",
  ],
  [
    "非网络异常",
    {
      requestError: {
        message: `Target page, context or browser has been closed ${SECRET}`,
      },
    },
    "unavailable",
  ],
]) {
  test(`${name}不重试也不等待`, async (t) => {
    const f = await fixture(t, { responses: { account: patch } });
    await assert.rejects(collectWeeklyAccounting(f), {
      message: `weekly_accounting_${code}`,
    });
    assert.equal(calls.requests.length, 1);
    assert.deepEqual(calls.waits, []);
    await noArchive(f);
  });
}

test("剩余总时限不足完整退避时立即停止，不能开启下一次尝试", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await fixture(t, {
    responses: { account: { status: 503 } },
    onRequest: async () => {
      t.mock.timers.tick(89000);
    },
  });
  await assert.rejects(collectWeeklyAccounting(f), {
    message: "weekly_accounting_timeout",
  });
  assert.equal(calls.requests.length, 1);
  assert.deepEqual(calls.waits, []);
  assert.equal(calls.closed, 1);
  await noArchive(f);
});

test("退避和所有来源共用总时限，超时后不发 GET", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await fixture(t, {
    responses: { account: [{ status: 503 }, {}] },
    onWait: async () => {
      t.mock.timers.tick(90001);
    },
  });
  await assert.rejects(collectWeeklyAccounting(f), {
    message: "weekly_accounting_timeout",
  });
  assert.equal(calls.requests.length, 1);
  assert.deepEqual(calls.waits, [1000]);
  await noArchive(f);
});

test("下一来源的单次超时被截到本次剩余总预算", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = await fixture(t, {
    responses: { ledger: [{ status: 503 }, {}] },
    onRequest: async (kind) => {
      if (kind === "account") t.mock.timers.tick(80000);
    },
    onWait: async (milliseconds) => {
      t.mock.timers.tick(milliseconds);
    },
  });
  await collectWeeklyAccounting(f);
  assert.deepEqual(
    calls.requests.map((request) => request.options.timeout),
    [15000, 10000, 9000, 9000],
  );
  assert.deepEqual(calls.waits, [1000]);
  await noArchive(f);
});

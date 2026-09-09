import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import {
  parseWeeklyProviderPrice,
  resolveCurrentWeeklyCapability,
  validateWeeklyProviderCapability,
  weeklyEvidenceBytes,
  weeklyBudget,
  WEEKLY_MANAGEMENT_COMMANDS,
  WEEKLY_PROVIDER_FILES,
} from "../src/weeklyContract.ts";
import { runWeeklyRuntime } from "../src/weeklyRuntime.ts";
import { WEEKLY_ARCHIVE } from "../src/weeklyScope.ts";
import { encode, sha256 } from "../src/sourceCapture.ts";
import { pathToFileURL } from "node:url";
import path from "node:path";

// 全部数值和身份均为内存合成夹具，不读取或续写正式价目、凭据与运行账本。
const now = new Date("2026-09-09T13:20:00.000Z");
const uid = "9000000001",
  account = sha256(uid).slice(0, 16);
const price = () => ({
  schemaVersion: "idol-weekly-provider-price-v1",
  observedAt: "2026-09-09T13:18:00.000Z",
  accountScopeHash: account,
  serviceKind: "formal_active",
  displayPrice: "3C/条",
  targetMatchCount: 1,
  target: {
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
  },
  sources: Object.fromEntries(
    Object.entries({
      plan: "plan#services",
      commands: "api/me/commands",
      account: "api/auth/me",
      subscription: "api/me/billing/subscription",
    }).map(([key, route]) => [
      key,
      { url: `https://open.weibo.com/cli/${route}`, status: 200 },
    ]),
  ),
});
const command = () => ({
  command: {
    id: "318",
    group: "users",
    action: "show_batch/other",
    name: "users show_batch/other",
    api_path: "users/show_batch/other",
    invocation_path: "/users/show_batch/other.json",
    method: "GET",
    title: "批量获取其他用户的基本信息",
    description: "批量获取其他用户的基本信息",
    required_fields: [],
    input_schema: { uids: "string", screen_name: "string" },
    flags: [
      {
        name: "uids",
        type: "string",
        required: false,
        description: "需要查询的用户ID，用半角逗号分隔，一次最多50个。",
      },
      {
        name: "screen_name",
        type: "string",
        required: false,
        description: "需要查询的用户昵称，用半角逗号分隔，一次最多50个。",
      },
    ],
    trial_enabled: true,
    status: "active",
    created_at: "2026-06-04T17:36:35.000Z",
    updated_at: "2026-09-07T11:03:03.000Z",
  },
});
const identity = (kind) => ({
  schemaVersion: `weibo-cli-${kind}-cache-v1`,
  ready: kind === "doctor",
  ...(kind === "doctor"
    ? { steps: { login: true, developer_verification: true, service: true } }
    : {}),
  service_status: { kind: "formal_active", balance: 21581 },
  accountScopeHash: account,
});
function bundle() {
  const files = { [WEEKLY_PROVIDER_FILES.price]: weeklyEvidenceBytes(price()) };
  for (const [index, kind] of Object.keys(
    WEEKLY_MANAGEMENT_COMMANDS,
  ).entries()) {
    const observedAt = `2026-09-09T13:19:0${index + 1}.000Z`;
    files[WEEKLY_PROVIDER_FILES[kind]] = weeklyEvidenceBytes({
      schemaVersion: "idol-weekly-management-evidence-v1",
      command: WEEKLY_MANAGEMENT_COMMANDS[kind],
      startedAt: observedAt,
      observedAt,
      cliVersion: "0.9.1",
      exitCode: 0,
      timedOut: false,
      signal: null,
      stderr: "",
      projection: kind === "command" ? command() : identity(kind),
    });
  }
  return files;
}
function mutate(files, name, change) {
  const value = JSON.parse(files[name]);
  change(value);
  files[name] = Buffer.from(encode(value));
}

test("完整四份证据重建 3C 合同，me.ready=false可用，375按1125C计提且保留4000C", () => {
  const files = bundle(),
    capability = resolveCurrentWeeklyCapability(files, now);
  assert.equal(capability.unitCost, 3);
  assert.equal(capability.accountScope, account);
  assert.equal(capability.priceObservedAt, price().observedAt);
  assert.deepEqual(
    capability.evidence.map((item) => item.path),
    Object.values(WEEKLY_PROVIDER_FILES),
  );
  assert.deepEqual(weeklyBudget(capability, 375, "auto", now, "provider"), {
    maximumCredits: 1125,
    budgetCredits: 1125,
    reserveCredits: 4000,
  });
  assert.throws(
    () =>
      weeklyBudget(
        { ...capability, balance: 5124 },
        375,
        "auto",
        now,
        "provider",
      ),
    /weekly_budget_or_reserve_exceeded/u,
  );
  assert.equal(
    weeklyBudget({ ...capability, balance: 4075 }, 25, "auto", now, "provider")
      .maximumCredits,
    75,
  );
  validateWeeklyProviderCapability(capability, files, now);
});

test("未知、过期、未来、错误单位、billingType及重复命令价目全部拒绝", () => {
  for (const value of [null, {}, { unitCost: 3, balance: 21581 }])
    assert.throws(
      () => resolveCurrentWeeklyCapability(value, now),
      /current_returned_item_price_unavailable/u,
    );
  for (const change of [
    (value) => {
      value.observedAt = "2026-09-09T12:49:59.999Z";
    },
    (value) => {
      value.observedAt = "2026-09-09T13:20:00.001Z";
    },
    (value) => {
      value.displayPrice = "3C/次";
    },
    (value) => {
      value.target.billingType = 2;
    },
    (value) => {
      value.target.pricePerUnit = 4;
    },
    (value) => {
      value.target.apiPath = "statuses/user_timeline";
    },
    (value) => {
      value.targetMatchCount = 2;
    },
    (value) => {
      value.sources.commands.status = 401;
    },
    (value) => {
      value.sources.plan.url = "https://example.test/price";
    },
    (value) => {
      value.serviceKind = "trial_active";
    },
    (value) => {
      value.csrfToken = "synthetic-secret";
    },
  ]) {
    const value = price();
    change(value);
    assert.throws(() =>
      parseWeeklyProviderPrice(Buffer.from(encode(value)), now),
    );
  }
});

test("管理证据拒绝错账号、未正式、未ready、弱退出证据、重复flag及50上限不明", () => {
  const changes = [
    [
      "doctor",
      (value) => {
        value.projection.ready = false;
      },
    ],
    [
      "me",
      (value) => {
        value.projection.accountScopeHash = "b".repeat(16);
      },
    ],
    [
      "me",
      (value) => {
        value.projection.service_status.kind = "trial_active";
      },
    ],
    [
      "me",
      (value) => {
        value.projection.service_status.balance = 3999;
      },
    ],
    [
      "doctor",
      (value) => {
        delete value.exitCode;
      },
    ],
    [
      "doctor",
      (value) => {
        value.exitCode = 1;
      },
    ],
    [
      "me",
      (value) => {
        value.startedAt = "2026-09-09T13:14:59.000Z";
      },
    ],
    [
      "command",
      (value) => {
        value.projection.command.id = "317";
      },
    ],
    [
      "command",
      (value) => {
        value.projection.commands = [value.projection.command];
      },
    ],
    [
      "command",
      (value) => {
        value.projection.command.flags[1] = value.projection.command.flags[0];
      },
    ],
    [
      "command",
      (value) => {
        value.projection.command.flags[0].description = "需要查询的用户ID";
      },
    ],
  ];
  for (const [kind, change] of changes) {
    const files = bundle();
    mutate(files, WEEKLY_PROVIDER_FILES[kind], change);
    assert.throws(() => resolveCurrentWeeklyCapability(files, now));
  }
});

test("归档重放从证据重建，重算普通hash不能替代合同；按checkedAt保留历史零探针重放", () => {
  const files = bundle(),
    capability = resolveCurrentWeeklyCapability(files, now);
  for (const patch of [
    { unitCost: 1 },
    { accountScope: "c".repeat(16) },
    { balance: 999999 },
  ])
    assert.throws(
      () =>
        validateWeeklyProviderCapability(
          { ...capability, ...patch },
          files,
          now,
        ),
      /weekly_provider_capability_replay_mismatch/u,
    );
  const changed = bundle();
  mutate(changed, WEEKLY_PROVIDER_FILES.command, (value) => {
    value.command = ["users", "show_batch/other"];
  });
  const rehashed = {
    ...capability,
    evidence: capability.evidence.map((item) => ({
      ...item,
      sha256: sha256(changed[item.path]),
    })),
  };
  assert.throws(
    () => validateWeeklyProviderCapability(rehashed, changed, now),
    /invalid_provider_management_evidence/u,
  );
  assert.throws(
    () =>
      resolveCurrentWeeklyCapability(files, new Date("2026-09-10T00:00:00Z")),
    /stale_current_provider_price/u,
  );
  assert.doesNotThrow(() =>
    validateWeeklyProviderCapability(capability, files, now),
  );
});

const helperModule = `import { projectCliSuccessPayload } from ${JSON.stringify(pathToFileURL(path.join(WEEKLY_ARCHIVE, "tools/collect_weibo_official.mjs")).href)};
export { projectCliSuccessPayload };
export async function resolveCliEntrypoint(){ globalThis.WEEKLY_PROVIDER_PROBE.resolves++; return {entrypoint:'synthetic-cli.js',version:'0.9.1'}; }
export function createCliEnvironment(){ return {}; }`;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperModule).toString("base64")}`;
const compiled = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/weeklyProviderCapability.ts", import.meta.url),
    ),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { Date: "globalThis.WEEKLY_PROVIDER_PROBE.Date" },
  plugins: [
    {
      name: "offline-provider",
      setup(builder) {
        const stubs = {
          "./weeklyScope.ts": `export const WEEKLY_STAGE='synthetic-stage', WEEKLY_ARCHIVE='synthetic-archive', WEEKLY_LIMITS={reserveCredits:4000};`,
          "./pipeline.ts": `export async function readStageFile(root,relative){ const s=globalThis.WEEKLY_PROVIDER_PROBE; s.reads.push({root,relative}); if(root!=='synthetic-stage'||relative!=='private/provider-price/current.json')throw new Error('unexpected_price_path'); if(s.missing){const e=new Error('missing');e.code='ENOENT';throw e;} return s.price; }`,
          "node:url": `export function pathToFileURL(value){if(!value.endsWith('collect_weibo_official.mjs'))throw new Error('unexpected_helper_path');return {href:${JSON.stringify(helperUrl)}};}`,
          "node:child_process": `export function execFile(executable,args,options,callback){const s=globalThis.WEEKLY_PROVIDER_PROBE; const index=s.commands.length; s.commands.push(args.slice(1)); if(args[0]!=='synthetic-cli.js'||options.windowsHide!==true)throw new Error('unexpected_management_entry'); s.time+=(s.delay?.[index]??1000); const result=s.responses[index]; callback(result.error??null,JSON.stringify(result.payload),result.stderr??'');}`,
        };
        builder.onResolve(
          {
            filter:
              /^(\.\/weeklyScope\.ts|\.\/pipeline\.ts|node:url|node:child_process)$/,
          },
          (args) => ({ path: args.path, namespace: "provider-stub" }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "provider-stub" },
          (args) => ({ contents: stubs[args.path], loader: "js" }),
        );
      },
    },
  ],
});
const productionProbe = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
function probeState() {
  const state = {
    price: weeklyEvidenceBytes(price()),
    time: now.getTime(),
    commands: [],
    reads: [],
    resolves: 0,
    responses: [
      {
        payload: {
          ready: true,
          steps: { login: true, developer_verification: true, service: true },
          service_status: { kind: "formal_active", balance: 21581 },
          user: {
            id: uid,
            access_token: "wb_synthetic_secret_12345678901234567890",
          },
          cookie: "synthetic-cookie",
        },
      },
      {
        payload: {
          service_status: { kind: "formal_active", balance: 21581 },
          user: {
            id: uid,
            access_token: "wb_synthetic_secret_12345678901234567890",
          },
        },
      },
      { payload: command() },
    ],
  };
  state.Date = class extends Date {
    constructor(value) {
      super(value ?? state.time);
    }
    static now() {
      return state.time;
    }
  };
  globalThis.WEEKLY_PROVIDER_PROBE = state;
  return state;
}
test("真实生产函数的离线替身：固定价目前置、仅三管理、失败零业务、凭据投影与拒绝外部evidence", async () => {
  try {
    for (const condition of ["missing", "stale", "future", "unknown"]) {
      const state = probeState();
      if (condition === "missing") state.missing = true;
      else {
        const value = price();
        if (condition === "stale") value.observedAt = "2026-09-09T12:40:00Z";
        if (condition === "future") value.observedAt = "2026-09-09T14:00:00Z";
        if (condition === "unknown") value.target.billingType = 2;
        state.price = Buffer.from(encode(value));
      }
      await assert.rejects(
        productionProbe.collectCurrentWeeklyProviderCapability(),
      );
      assert.equal(state.resolves, 0);
      assert.deepEqual(state.commands, []);
    }
    const good = probeState(),
      result = await productionProbe.collectCurrentWeeklyProviderCapability();
    assert.deepEqual(good.commands, Object.values(WEEKLY_MANAGEMENT_COMMANDS));
    assert.equal(result.capability.unitCost, 3);
    assert.equal(Object.keys(result.files).length, 4);
    assert.equal(
      Buffer.concat(Object.values(result.files))
        .toString("utf8")
        .includes("synthetic-secret"),
      false,
    );
    assert.equal(
      Buffer.concat(Object.values(result.files))
        .toString("utf8")
        .includes("synthetic_secret"),
      false,
    );
    for (const index of [0, 1, 2]) {
      const state = probeState();
      state.responses[index].error = { code: 1 };
      state.responses[index].stderr =
        "Authorization: Bearer SYNTHETIC_SECRET_ONLY";
      await assert.rejects(
        productionProbe.collectCurrentWeeklyProviderCapability(),
        (error) => error.message === "weekly_management_query_failed",
      );
      assert.equal(state.commands.length, index + 1);
    }
    for (const [index, change] of [
      [
        0,
        (value) => {
          value.payload.ready = false;
        },
      ],
      [
        1,
        (value) => {
          value.payload.user.id = "9000000002";
        },
      ],
      [
        1,
        (value) => {
          value.payload.nested = { error: { message: "synthetic failure" } };
        },
      ],
      [
        2,
        (value) => {
          value.payload.command.csrfToken = "SYNTHETIC_SECRET_ONLY";
        },
      ],
    ]) {
      const state = probeState();
      change(state.responses[index]);
      await assert.rejects(
        productionProbe.collectCurrentWeeklyProviderCapability(),
        (error) => !error.message.includes("SYNTHETIC_SECRET_ONLY"),
      );
      assert.equal(state.commands.length, index + 1);
    }
    const staleDuring = probeState();
    staleDuring.delay = [30 * 60_000];
    await assert.rejects(
      productionProbe.collectCurrentWeeklyProviderCapability(),
    );
    assert.equal(staleDuring.commands.length, 1);
    const untouched = probeState();
    await assert.rejects(
      runWeeklyRuntime({
        trigger: "manual",
        live: true,
        budgetCredits: "auto",
        evidence: { unitCost: 3, balance: 21581 },
      }),
      /external_weekly_provider_evidence_rejected/u,
    );
    assert.deepEqual(untouched.commands, []);
    assert.deepEqual(untouched.reads, []);
  } finally {
    delete globalThis.WEEKLY_PROVIDER_PROBE;
  }
});

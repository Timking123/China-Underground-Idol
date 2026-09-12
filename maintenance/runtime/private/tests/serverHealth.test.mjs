import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const NOW = "2026-09-12T08:00:00+08:00";
const DAILY = "daily-2026-09-12";
const WEEKLY = "weekly-2026-09-11";
const complete = (finishedAt = NOW) => ({ status: "complete", finishedAt });

// 执行真实 health 入口，仅隔离文件、周更及网络边界；禁止触碰服务器状态或发送通知。
function runHealth({ names, receipts }) {
  const stubs = {
    "/server/state.ts": `
      const receipts = ${JSON.stringify(receipts)};
      export const privateDirectory = async () => {};
      export const listDirectories = async () => ${JSON.stringify([...names].sort())};
      export const readOptional = async (p) => {
        const path = p.replaceAll(String.fromCharCode(92), '/');
        if (path.endsWith('/publish/pending.json')) return null;
        const name = path.match(/\\/runs\\/([^/]+)\\/receipt\\.json$/)?.[1];
        if (!name) throw new Error('unexpected_state_read');
        console.log('TEST_RECEIPT ' + name);
        return receipts[name] ?? null;
      };
      export const writeOnce = async () => { throw new Error('unexpected_state_write'); };
      export const safeFailure = (error) => error.message;
    `,
    "/server/weeklyRunRecovery.ts": `
      export const readWeeklyRunReceipt = async (state, name) => {
        if (name !== '${WEEKLY}') throw new Error('unexpected_weekly_run');
        return ${JSON.stringify(complete())};
      };
      export const requestWeeklyRunRecovery = async () => { throw new Error('unexpected_recovery'); };
      export const completeWeeklyRunRecovery = async () => { throw new Error('unexpected_recovery'); };
    `,
    "/server/weeklyPreflight.ts": `
      export const selectWeeklyRunId = async () => '${WEEKLY}';
      export const assertWeeklyApplicationReady = async () => { throw new Error('unexpected_weekly_apply'); };
    `,
    "/server/incident.ts": `
      export const sendMaintenanceNotice = async () => { throw new Error('unexpected_notice'); };
      export const sendMaintenanceIncident = async (incident) => {
        console.log('TEST_INCIDENT ' + JSON.stringify(incident));
        return { status: 'sent', code: 'DELIVERED' };
      };
    `,
  };
  const loader = `
    const stubs = ${JSON.stringify(stubs)};
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const url = new URL(specifier, context.parentURL);
        const key = Object.keys(stubs).find((item) => url.pathname.endsWith('/private' + item));
        if (key) return { url: 'health-test:' + key, shortCircuit: true };
      }
      return next(specifier, context);
    }
    export async function load(url, context, next) {
      if (url.startsWith('health-test:')) return { format: 'module', source: stubs[url.slice(12)], shortCircuit: true };
      return next(url, context);
    }
  `;
  const script = `
    import { register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loader)}), import.meta.url);
    const RealDate = Date;
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['${NOW}'])); } };
    globalThis.fetch = async (url) => {
      if (url !== 'https://idol.hi-veblen.com/manifest.sha256') throw new Error('network_forbidden');
      console.log('TEST_MANIFEST');
      return new Response(('a'.repeat(64) + '  index.html\\n').repeat(20));
    };
    process.argv[2] = 'health';
    await import(${JSON.stringify(new URL("../server/runner.ts", import.meta.url).href)});
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TEST_MANIFEST/);
  assert.match(result.stdout, /"status":"complete"/);
  return {
    stdout: result.stdout,
    incidents: result.stdout
      .split("\n")
      .filter((line) => line.startsWith("TEST_INCIDENT "))
      .map((line) => JSON.parse(line.slice("TEST_INCIDENT ".length))),
  };
}

test("health 只选择完整日期运行目录，内部日更意图和带后缀目录不会遮蔽成功回执", () => {
  const result = runHealth({
    names: [
      "daily-2026-09-11",
      DAILY,
      "daily-application-intents",
      "daily-2026-09-12-backup",
      WEEKLY,
    ],
    receipts: { [DAILY]: complete() },
  });
  assert.deepEqual(result.incidents, []);
  assert.match(result.stdout, new RegExp(`TEST_RECEIPT ${DAILY}`));
  assert.doesNotMatch(result.stdout, /TEST_RECEIPT .*?(?:intents|backup)/);
});

test("health 对周更也排除内部状态目录", () => {
  const result = runHealth({
    names: [DAILY, WEEKLY, "weekly-application-intents"],
    receipts: { [DAILY]: complete() },
  });
  assert.deepEqual(result.incidents, []);
});

test("health 仍提示已完成日更的通知投递失败", () => {
  const result = runHealth({
    names: [DAILY, "daily-application-intents", WEEKLY],
    receipts: {
      [DAILY]: {
        ...complete(),
        notificationFailures: [{ code: "synthetic_failure" }],
      },
    },
  });
  assert.deepEqual(
    result.incidents.map(({ code, source }) => ({ code, source })),
    [{ code: "notification_pending", source: "daily" }],
  );
});

for (const [name, names, receipt] of [
  ["缺少当轮回执", [DAILY], null],
  ["本轮明确失败", [DAILY], { status: "blocked", finishedAt: NOW }],
  ["最新完成回执已过期", [DAILY], complete("2026-09-10T00:00:00+08:00")],
  ["只有内部目录", [], null],
]) {
  test(`health 仍告警真正的日更异常：${name}`, () => {
    const result = runHealth({
      names: [...names, "daily-application-intents", WEEKLY],
      receipts: { [DAILY]: receipt },
    });
    assert.deepEqual(
      result.incidents.map(({ code, source }) => ({ code, source })),
      [{ code: "scheduled_run_missing", source: "daily" }],
    );
  });
}

test("health 不以旧成功回执掩盖最新日期运行缺少回执", () => {
  const result = runHealth({
    names: ["daily-2026-09-11", DAILY, WEEKLY],
    receipts: { "daily-2026-09-11": complete() },
  });
  assert.deepEqual(
    result.incidents.map(({ code, source }) => ({ code, source })),
    [{ code: "scheduled_run_missing", source: "daily" }],
  );
});

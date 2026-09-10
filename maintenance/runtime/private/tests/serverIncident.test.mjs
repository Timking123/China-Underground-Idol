import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  sendMaintenanceIncident,
  sendMaintenanceNotice,
} from "../server/incident.ts";

test("实际维护包装器把小写故障码转换为有效通知，并真实走发送器", async () => {
  const root = await mkdtemp(join(tmpdir(), "idol-incident-"));
  let count = 0;
  const result = await sendMaintenanceIncident(
    {
      runId: "daily-2026-09-10",
      kind: "service",
      code: "maintenance_failed",
      source: "daily",
      action: "inspect_logs",
    },
    {
      stateRoot: root,
      sendKey: "SCT123456SyntheticOnly",
      fetchImpl: async (_url, options) => {
        count++;
        assert.match(String(options.body), /MAINTENANCE_FAILED/);
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      },
    },
  );
  assert.equal(result.status, "sent");
  assert.equal(count, 1);
});
test("通知失败不得被当作已完成", async () => {
  const root = await mkdtemp(join(tmpdir(), "idol-incident-fail-"));
  await assert.rejects(
    sendMaintenanceIncident(
      {
        runId: "daily-2026-09-10",
        kind: "service",
        code: "maintenance_failed",
      },
      { stateRoot: root },
    ),
    /notification_delivery_failed/,
  );
});

test("更新通知失败单独返回阻塞状态，数据发布调用方可继续", async () => {
  const root = await mkdtemp(join(tmpdir(), "idol-notice-fail-"));
  const result = await sendMaintenanceNotice(
    {
      runId: "weekly-2026-09-11",
      kind: "weekly",
      code: "weekly_accounts_skipped",
      action: "accounts_skipped",
    },
    { stateRoot: root },
  );
  assert.deepEqual(result, { status: "blocked", code: "SEND_KEY_MISSING" });
});

test("跳过账号通知只外发固定说明，失败发送有记录且未知结果不盲重发", async () => {
  const root = await mkdtemp(join(tmpdir(), "idol-notice-unknown-"));
  let calls = 0;
  const incident = {
    runId: "weekly-2026-09-11",
    kind: "weekly",
    code: "weekly_accounts_skipped",
    action: "accounts_skipped",
  };
  const options = {
    stateRoot: root,
    sendKey: "SCT123456SyntheticOnly",
    fetchImpl: async (_url, request) => {
      calls++;
      const body = new URLSearchParams(String(request.body));
      assert.match(body.get("desp"), /已保留其旧资料，其余账号继续更新/);
      throw new Error("synthetic transport failed");
    },
  };
  assert.equal(
    (await sendMaintenanceNotice(incident, options)).status,
    "blocked",
  );
  const second = await sendMaintenanceNotice(incident, options);
  assert.equal(second.status, "suppressed");
  assert.equal(second.code, "UNKNOWN_OUTCOME");
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sendMaintenanceIncident } from "../server/incident.ts";

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

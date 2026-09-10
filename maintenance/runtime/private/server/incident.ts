import { notifyIncident, type Incident } from "./notify.ts";

/** 业务内部小写错误码在通知边界统一转换，异常正文永不进入外部消息。 */
export async function sendMaintenanceNotice(
  incident: Omit<Incident, "message">,
  options: Parameters<typeof notifyIncident>[1],
) {
  const code = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(incident.code)
    ? incident.code.toUpperCase()
    : "MAINTENANCE_FAILURE";
  return await notifyIncident(
    { ...incident, code, message: "请按固定错误码核查服务器维护记录。" },
    options,
  );
}

/** 故障告警入口保留失败退出；资料更新另存通知结果，避免渠道故障阻断发布。 */
export async function sendMaintenanceIncident(
  incident: Omit<Incident, "message">,
  options: Parameters<typeof notifyIncident>[1],
) {
  const result = await sendMaintenanceNotice(incident, options);
  if (result.status === "blocked")
    throw new Error("notification_delivery_failed");
  return result;
}

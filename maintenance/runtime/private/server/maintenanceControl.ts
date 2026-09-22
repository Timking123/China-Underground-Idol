import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const MAINTENANCE_CONTROL =
  "/etc/china-underground-idol/maintenance-control.json";
export interface MaintenanceControl {
  paused: boolean;
  code:
    | "maintenance_paused"
    | "maintenance_enabled"
    | "maintenance_control_invalid";
}

/** 只有 root 管理的明确 enabled 才放行；缺失、损坏、链接或权限漂移均拒绝。 */
export function readMaintenanceControl(
  filename = MAINTENANCE_CONTROL,
): MaintenanceControl {
  try {
    let directory = path.dirname(filename);
    for (;;) {
      const info = lstatSync(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (process.platform !== "win32" &&
          (info.uid !== 0 || (info.mode & 0o022) !== 0))
      )
        throw new Error("control_parent");
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    const info = lstatSync(filename);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 1024 ||
      (process.platform !== "win32" &&
        (info.uid !== 0 || (info.mode & 0o022) !== 0))
    )
      throw new Error("control_file");
    const value = JSON.parse(readFileSync(filename, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      Object.keys(value).sort().join(",") !== "mode,schemaVersion" ||
      value.schemaVersion !== "idol-maintenance-control-v1" ||
      !["paused", "enabled"].includes(String(value.mode))
    )
      throw new Error("control_schema");
    return value.mode === "enabled"
      ? { paused: false, code: "maintenance_enabled" }
      : { paused: true, code: "maintenance_paused" };
  } catch {
    return { paused: true, code: "maintenance_control_invalid" };
  }
}

export function assertMaintenanceEnabled(): void {
  const control = readMaintenanceControl();
  if (control.paused) throw new Error(control.code);
}

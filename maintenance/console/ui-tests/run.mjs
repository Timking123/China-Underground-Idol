import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

// 随机密码只通过子进程环境传递，不写入文件、不打印到日志。
const env = {
  ...process.env,
  IDOL_UI_FIXTURE_PASSWORD: randomBytes(32).toString("base64url"),
};
const preview = spawn(
  process.execPath,
  ["maintenance/console/ui-tests/preview.mjs"],
  { env, stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("合成服务启动超时")),
      20000,
    );
    preview.once("error", reject);
    preview.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`合成服务提前退出 ${code}`));
    });
    preview.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("合成验收服务已启动")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const test = spawn(
    process.execPath,
    ["maintenance/console/ui-tests/browser.mjs"],
    { env, stdio: "inherit", windowsHide: true },
  );
  const [code] = await once(test, "exit");
  process.exitCode = code ?? 1;
} finally {
  preview.kill();
  if (preview.exitCode === null) await once(preview, "exit");
}

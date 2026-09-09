import assert from "node:assert/strict";

export const CLI_VERSION = "0.9.1";

export function cliRequest(source, args) {
  assert(Array.isArray(args) && args.length > 0, "CLI 请求必须包含命令");
  const route = args
    .slice(0, 4)
    .filter((argument) => !String(argument).startsWith("--"))
    .map((argument) => encodeURIComponent(argument))
    .join("/");
  return {
    source,
    url: `https://open.weibo.com/cli/local-command/${route}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      cliPackage: "@weibo-ai/weibo-cli",
      expectedVersion: CLI_VERSION,
      args,
    },
  };
}

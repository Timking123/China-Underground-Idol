import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  applyLocalEditorial,
  loadLocalEditorialRuntime,
} from "../maintenance/localEditorial.mjs";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const runtime = await loadLocalEditorialRuntime(config.root, {
  outputRoot: path.join(config.directory, "runtime"),
});
const store = new runtime.ConsoleStore(
  path.join(config.directory, "private"),
  await readFile(path.join(config.directory, "synthetic.key")),
);
await applyLocalEditorial({
  root: config.root,
  workspace: config.workspace,
  store,
  runtime,
  revisionId: config.revisionId,
  evidence: JSON.parse(
    await readFile(path.join(config.directory, "evidence.json"), "utf8"),
  ),
  now: new Date(config.now),
  afterCommit: () => {
    const revision = runtime.getEditorialRevision(store, config.revisionId);
    runtime.mutateEditorial(
      store,
      "withdraw",
      revision.id,
      {
        requestId: randomUUID(),
        expectedVersion: revision.version,
        note: "合成真实进程退出前的提交后撤回",
      },
      null,
      "合成管理员",
      Date.now(),
      () => {},
    );
    // 实际退出，故意不执行finally；父测试只能通过显式死进程锁恢复继续。
    process.exit(77);
  },
});
throw new Error("崩溃探针未触发");

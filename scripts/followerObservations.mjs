import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const source = await readFile(
  new URL("../src/catalog/followerObservations.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const model = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
export const {
  validateFollowerObservations,
  emptyFollowerObservations,
  overlayFollowerObservations,
} = model;

/** 来源目录及文件只允许普通路径；旧测试夹具没有补充层时按空层处理。 */
export async function readFollowerObservations(root, now = new Date()) {
  const base = await realpath(root);
  const directory = path.join(base, "data");
  const target = path.join(directory, "follower-observations.v1.json");
  try {
    const parent = await lstat(directory);
    if (parent.isSymbolicLink() || !parent.isDirectory())
      throw new Error("unsafe_follower_directory");
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("unsafe_follower_file");
  } catch (error) {
    if (error.code === "ENOENT") return emptyFollowerObservations();
    throw error;
  }
  const validation = validateFollowerObservations(
    JSON.parse(await readFile(target, "utf8")),
    now,
  );
  if (!validation.valid) throw new Error(validation.errors.join(","));
  return validation.data;
}

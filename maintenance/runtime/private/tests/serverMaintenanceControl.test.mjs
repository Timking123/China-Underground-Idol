import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readMaintenanceControl } from "../server/maintenanceControl.ts";
import { createPublicationPreparer } from "../server/publisher.ts";
import { consumePublication } from "../server/publicationReceipt.ts";

test("缺失或损坏开关 fail-closed，不生成替代开关", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "idol-control-"));
  const file = path.join(root, "control.json");
  assert.equal(readMaintenanceControl(file).paused, true);
  await writeFile(file, "broken");
  assert.equal(readMaintenanceControl(file).paused, true);
  assert.equal(await readFile(file, "utf8"), "broken");
  if (process.platform === "win32") {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: "idol-maintenance-control-v1",
        mode: "paused",
      }),
    );
    assert.equal(readMaintenanceControl(file).code, "maintenance_paused");
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: "idol-maintenance-control-v1",
        mode: "enabled",
      }),
    );
    assert.equal(readMaintenanceControl(file).paused, false);
  }
});

test("真实维护入口暂停时零 Provider、通知、状态写入；health 只读报告", () => {
  for (const command of [
    "daily",
    "weekly",
    "health",
    "publish-result",
    "service-failure",
  ]) {
    const script = `
      import { register } from 'node:module';
      const loader = ${JSON.stringify(`
        export async function resolve(s,c,next) { return next(s,c); }
        export async function load(url,c,next) {
          if (url.endsWith('/maintenanceControl.ts')) return {format:'module',shortCircuit:true,source:
            "export const readMaintenanceControl=()=>({paused:true,code:'maintenance_paused'}); export const assertMaintenanceEnabled=()=>{throw new Error('maintenance_paused')};"};
          if (url.endsWith('/state.ts')) return {format:'module',shortCircuit:true,source:
            "export const privateDirectory=()=>{throw new Error('SIDE_EFFECT')}; export const writeOnce=privateDirectory; export const readOptional=privateDirectory; export const listDirectories=privateDirectory; export const regularPath=privateDirectory; export const safeFailure=e=>e.message;"};
          if (url.endsWith('/incident.ts')) return {format:'module',shortCircuit:true,source:
            "export const sendMaintenanceNotice=()=>{throw new Error('SIDE_EFFECT')}; export const sendMaintenanceIncident=sendMaintenanceNotice;"};
          return next(url,c);
        }
      `)};
      register('data:text/javascript,'+encodeURIComponent(loader),import.meta.url);
      globalThis.fetch=()=>{throw new Error('SIDE_EFFECT')};
      process.argv[2]=${JSON.stringify(command)};
      await import(${JSON.stringify(new URL("../server/runner.ts", import.meta.url).href)});
    `;
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, ["health", "service-failure"].includes(command) ? 0 : 1, result.stderr);
    assert.match(result.stdout + result.stderr, /maintenance_paused/);
    assert.doesNotMatch(result.stdout + result.stderr, /SIDE_EFFECT/);
  }
});

test("直接发布准备和回执消费入口在任何文件读取、锁和命令前拒绝", async () => {
  let effects = 0;
  const pause = () => {
    throw new Error("maintenance_paused");
  };
  const prepare = createPublicationPreparer({
    assertEnabled: pause,
    base: "/unused",
    command: async () => {
      effects++;
    },
    browser: async () => {
      effects++;
    },
    baseline: async () => {
      effects++;
    },
    now: () => new Date(),
  });
  await assert.rejects(prepare({}), /maintenance_paused/);
  await assert.rejects(
    consumePublication("/unused", "/unused", pause),
    /maintenance_paused/,
  );
  assert.equal(effects, 0);
});

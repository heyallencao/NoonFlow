import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions } from "child_process";

function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

export function spawnSkillsCli(
  args: string[],
  options?: SpawnOptions
) {
  return spawn(getNpxCommand(), ["skills", ...args], {
    ...options,
    shell: false,
  });
}

export function spawnSkillsCliSync(
  args: string[],
  options?: SpawnSyncOptions
) {
  return spawnSync(getNpxCommand(), ["skills", ...args], {
    ...options,
    shell: false,
  });
}

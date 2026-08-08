import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const commandArgs = process.argv.slice(2);

if (commandArgs.length === 0) {
  console.error("[run-with-dev-data-dir] Missing command to execute.");
  process.exit(1);
}

function resolveDevDataDir() {
  const explicitDir = process.env.MONOLITH_DEV_USER_DATA_DIR?.trim()
    || process.env.CLAUDE_GUI_DATA_DIR?.trim();

  if (explicitDir) {
    return path.resolve(explicitDir);
  }

  return path.join(os.homedir(), ".monolith-dev");
}

const [command, ...args] = commandArgs;
const devDataDir = resolveDevDataDir();
const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    MONOLITH_DEV_USER_DATA_DIR: devDataDir,
    CLAUDE_GUI_DATA_DIR: devDataDir,
  },
});

child.on("error", (error) => {
  console.error("[run-with-dev-data-dir] Failed to start command:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

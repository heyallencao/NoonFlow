import { BrowserWindow, ipcMain } from "electron";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProcessEnvWithShellPath, sanitizeDesktopChildEnv } from "../lib/shell-env";
import { nodePackageManagerAction, shouldUseWindowsCommandShell } from "../lib/command-spawn";
import { initializationStepStatus, installCompletionStatus } from "../lib/install-status";
import type { InstallPrerequisites, InstallStartOptions, InstallState } from "../bridge.d";

type RuntimeTarget = "claude" | "codex" | "pi";

const RUNTIME_INSTALL_PACKAGE: Record<RuntimeTarget, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  pi: "@earendil-works/pi-coding-agent",
};

const RUNTIME_BINARY: Record<RuntimeTarget, string> = {
  claude: "claude",
  codex: "codex",
  pi: "pi",
};

const RUNTIME_LABEL: Record<RuntimeTarget, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
};

const PI_MIN_NODE_VERSION = [22, 19, 0] as const;

let installState: InstallState = {
  status: "idle",
  currentStep: null,
  steps: [],
  logs: [],
};

let installAbortController: AbortController | null = null;
let handlersRegistered = false;
const INSTALL_DRY_RUN_ENABLED = (
  process.env.NOONFLOW_INSTALL_DRY_RUN
  ?? process.env.MONOLITH_INSTALL_DRY_RUN
) === "1";

function emitProgress() {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || window.isDestroyed()) return;
  window.webContents.send("install:progress", { ...installState });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    return /aborted|cancelled|canceled/i.test(error.message);
  }
  return false;
}

function markCancelled(logLine?: string) {
  if (logLine && !installState.logs.includes(logLine)) {
    installState.logs.push(logLine);
  }
  installState.status = "cancelled";
  installState.currentStep = null;
  emitProgress();
}

function hasNonEmptyFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function detectClaudeInitialized(): boolean {
  const home = os.homedir();
  const hasCliFiles = [
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".claude.json"),
    path.join(home, ".claude", ".credentials.json"),
  ].some((candidate) => hasNonEmptyFile(candidate));

  return Boolean(
    process.env.ANTHROPIC_API_KEY
      || process.env.ANTHROPIC_AUTH_TOKEN
      || hasCliFiles,
  );
}

function detectCodexInitialized(): boolean {
  const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
  return Boolean(
    process.env.OPENAI_API_KEY
      || process.env.CODEX_AUTH_TOKEN
      || hasNonEmptyFile(codexAuthPath),
  );
}

function nodeSupportsPi(version: string | undefined): boolean {
  const match = version?.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const current = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < PI_MIN_NODE_VERSION.length; index += 1) {
    if (current[index] > PI_MIN_NODE_VERSION[index]) return true;
    if (current[index] < PI_MIN_NODE_VERSION[index]) return false;
  }
  return true;
}

async function detectPiInitialized(): Promise<boolean> {
  const env = sanitizeDesktopChildEnv(await getProcessEnvWithShellPath(process.env));
  try {
    const output = execFileSync(process.platform === "win32" ? "pi.cmd" : "pi", ["--offline", "--list-models"], {
      env: {
        ...env,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).toString();
    return /^provider\s{2,}model\s{2,}/m.test(output);
  } catch {
    return false;
  }
}

function ensureRuntimeDirectory(runtime: RuntimeTarget): void {
  const home = os.homedir();
  const dirPath = runtime === "claude"
    ? path.join(home, ".claude")
    : runtime === "codex"
    ? path.join(home, ".codex")
    : path.join(home, ".pi", "agent");
  mkdirSync(dirPath, { recursive: true });
}

async function waitForDuration(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function captureVersion(command: string): Promise<string | undefined> {
  const env = sanitizeDesktopChildEnv(await getProcessEnvWithShellPath(process.env));
  try {
    const executable = process.platform === "win32"
      ? command === "node" ? "node.exe" : `${command}.cmd`
      : command;
    return execFileSync(executable, ["--version"], {
      env,
      timeout: 5000,
      shell: process.platform === "win32",
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

async function commandExists(command: string): Promise<boolean> {
  if (command === "pi") {
    const env = sanitizeDesktopChildEnv(await getProcessEnvWithShellPath(process.env));
    try {
      const output = execFileSync(process.platform === "win32" ? "pi.cmd" : "pi", ["--help"], {
        env,
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      }).toString();
      return /AI coding assistant/i.test(output) && /--mode\s+<mode>/i.test(output) && /--list-models/i.test(output);
    } catch {
      return false;
    }
  }
  return (await captureVersion(command)) !== undefined;
}

async function homebrewPackageInstalled(brew: string, packageName: string): Promise<boolean> {
  const env = sanitizeDesktopChildEnv(await getProcessEnvWithShellPath(process.env));
  try {
    const output = execFileSync(brew, ["list", "--versions", packageName], {
      env,
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

async function runCommand(
  args: string[],
  signal: AbortSignal,
  onLog: (line: string) => void,
): Promise<void> {
  const env = sanitizeDesktopChildEnv(await getProcessEnvWithShellPath(process.env));

  await new Promise<void>((resolve, reject) => {
    const [command, ...commandArgs] = args;
    const child = spawn(command, commandArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      shell: shouldUseWindowsCommandShell(command),
    });

    child.stdout?.on("data", (buffer: Buffer) => {
      for (const line of buffer.toString().split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        onLog(line);
      }
    });
    child.stderr?.on("data", (buffer: Buffer) => {
      for (const line of buffer.toString().split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        onLog(line);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

function resolveInstallPlan(options: InstallStartOptions) {
  const includeNode = options.includeNode ?? false;
  const installClaude = options.installClaude ?? true;
  const installCodex = options.installCodex ?? true;
  const installPi = options.installPi ?? true;
  const initializeClaude = options.initializeClaude ?? installClaude;
  const initializeCodex = options.initializeCodex ?? installCodex;
  const initializePi = options.initializePi ?? installPi;
  const upgradeExisting = options.upgradeExisting ?? false;

  const runtimes: RuntimeTarget[] = [];
  if (installClaude || initializeClaude) runtimes.push("claude");
  if (installCodex || initializeCodex) runtimes.push("codex");
  if (installPi || initializePi) runtimes.push("pi");

  if (runtimes.length === 0) {
    throw new Error("No tool selected for installation");
  }

  return {
    includeNode,
    installClaude,
    installCodex,
    installPi,
    initializeClaude,
    initializeCodex,
    initializePi,
    upgradeExisting,
    runtimes,
  };
}

async function runInstallSequence(options: InstallStartOptions, signal: AbortSignal) {
  const plan = resolveInstallPlan(options);
  let needsSetup = false;

  try {
    const steps = [
      ...(plan.includeNode ? [{ id: "install-node", label: "Installing Node.js" }] : []),
      { id: "check-node", label: "Checking Node.js" },
      ...(plan.installClaude ? [{ id: "install-claude", label: "Installing Claude Code" }] : []),
      ...(plan.installCodex ? [{ id: "install-codex", label: "Installing Codex CLI" }] : []),
      ...(plan.installPi ? [{ id: "install-pi", label: "Installing Pi CLI" }] : []),
      ...(plan.initializeClaude ? [{ id: "init-claude", label: "Initializing Claude environment" }] : []),
      ...(plan.initializeCodex ? [{ id: "init-codex", label: "Initializing Codex environment" }] : []),
      ...(plan.initializePi ? [{ id: "init-pi", label: "Initializing Pi environment" }] : []),
      { id: "verify", label: "Verifying installation" },
    ];

    installState = {
      status: "running",
      currentStep: null,
      steps: steps.map((step) => ({ ...step, status: "pending" as const })),
      logs: [],
    };
    emitProgress();

    const setStep = (id: string, status: InstallState["steps"][number]["status"], error?: string) => {
      const step = installState.steps.find((item) => item.id === id);
      if (step) {
        step.status = status;
        if (error) step.error = error;
      }
      installState.currentStep = id;
      emitProgress();
    };

    const addLog = (line: string) => {
      installState.logs.push(line);
      emitProgress();
    };

    if (INSTALL_DRY_RUN_ENABLED) {
      addLog("Install dry-run mode enabled.");

      if (plan.includeNode) {
        setStep("install-node", "running");
        addLog("Dry-run: simulating Node.js installation...");
        await waitForDuration(250, signal).catch((error) => {
          if (signal.aborted || isAbortError(error)) {
            markCancelled();
            return;
          }
          throw error;
        });
        if (signal.aborted) {
          markCancelled();
          return;
        }
        setStep("install-node", "success");
      }

      setStep("check-node", "running");
      await waitForDuration(200, signal).catch((error) => {
        if (signal.aborted || isAbortError(error)) {
          markCancelled();
          return;
        }
        throw error;
      });
      if (signal.aborted) {
        markCancelled();
        return;
      }
      addLog("Dry-run: Node.js found: v24.0.0");
      setStep("check-node", "success");

      for (const runtime of plan.runtimes) {
        if (runtime === "claude" && plan.installClaude) {
          setStep("install-claude", "running");
          addLog("Dry-run: npm install -g @anthropic-ai/claude-code (skipped)");
          await waitForDuration(250, signal);
          if (signal.aborted) {
            markCancelled();
            return;
          }
          setStep("install-claude", "success");
        }

        if (runtime === "codex" && plan.installCodex) {
          setStep("install-codex", "running");
          addLog("Dry-run: npm install -g @openai/codex (skipped)");
          await waitForDuration(250, signal);
          if (signal.aborted) {
            markCancelled();
            return;
          }
          setStep("install-codex", "success");
        }

        if (runtime === "pi" && plan.installPi) {
          setStep("install-pi", "running");
          addLog("Dry-run: npm install -g --ignore-scripts @earendil-works/pi-coding-agent (skipped)");
          await waitForDuration(250, signal);
          if (signal.aborted) {
            markCancelled();
            return;
          }
          setStep("install-pi", "success");
        }
      }

      if (plan.initializeClaude) {
        setStep("init-claude", "running");
        addLog("Dry-run: Claude environment initialization check complete");
        await waitForDuration(150, signal);
        if (signal.aborted) {
          markCancelled();
          return;
        }
        setStep("init-claude", initializationStepStatus(true));
      }

      if (plan.initializeCodex) {
        setStep("init-codex", "running");
        addLog("Dry-run: Codex environment initialization check complete");
        await waitForDuration(150, signal);
        if (signal.aborted) {
          markCancelled();
          return;
        }
        setStep("init-codex", "success");
      }

      if (plan.initializePi) {
        setStep("init-pi", "running");
        addLog("Dry-run: Pi model/auth initialization check complete");
        await waitForDuration(150, signal);
        if (signal.aborted) {
          markCancelled();
          return;
        }
        setStep("init-pi", "success");
      }

      setStep("verify", "running");
      await waitForDuration(180, signal);
      if (signal.aborted) {
        markCancelled();
        return;
      }
      addLog("Dry-run: verification succeeded");
      setStep("verify", "success");
      installState.status = "success";
      installState.currentStep = null;
      emitProgress();
      return;
    }

    if (plan.includeNode && !signal.aborted) {
      setStep("install-node", "running");
      addLog("Installing Node.js via package manager...");
      try {
        if (process.platform === "darwin") {
          const brew = existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : "/usr/local/bin/brew";
          if (!existsSync(brew)) {
            throw new Error("Homebrew is required but not found");
          }
          const action = nodePackageManagerAction(await homebrewPackageInstalled(brew, "node"));
          await runCommand([brew, action, "node"], signal, addLog);
        } else if (process.platform === "win32") {
          const action = nodePackageManagerAction(await commandExists("node"));
          await runCommand(
            [
              "winget",
              action,
              "-e",
              "--id",
              "OpenJS.NodeJS.LTS",
              "--accept-source-agreements",
              "--accept-package-agreements",
            ],
            signal,
            addLog,
          );
        } else {
          throw new Error("Automatic Node.js installation is only supported on macOS/Windows");
        }
        setStep("install-node", "success");
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          markCancelled();
          return;
        }
        setStep("install-node", "failed", String(error));
        installState.status = "failed";
        emitProgress();
        return;
      }
    }

    if (signal.aborted) {
      markCancelled();
      return;
    }

    setStep("check-node", "running");
    const nodeVersion = await captureVersion("node");
    if (!nodeVersion) {
      setStep("check-node", "failed", "Node.js is not installed");
      installState.status = "failed";
      emitProgress();
      return;
    }
    addLog(`Node.js found: ${nodeVersion}`);
    if (plan.runtimes.includes("pi") && !nodeSupportsPi(nodeVersion)) {
      setStep("check-node", "failed", "Pi requires Node.js 22.19.0 or newer");
      addLog(`Pi requires Node.js >=22.19.0; found ${nodeVersion}.`);
      installState.status = "failed";
      emitProgress();
      return;
    }
    setStep("check-node", "success");

    if (signal.aborted) {
      markCancelled();
      return;
    }

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    for (const runtime of plan.runtimes) {
      const installEnabled = runtime === "claude"
        ? plan.installClaude
        : runtime === "codex"
        ? plan.installCodex
        : plan.installPi;
      const stepId = `install-${runtime}`;
      if (!installEnabled) {
        continue;
      }

      setStep(stepId, "running");
      const binary = RUNTIME_BINARY[runtime];
      const alreadyInstalled = await commandExists(binary);

      if (alreadyInstalled && !plan.upgradeExisting) {
        addLog(`${RUNTIME_LABEL[runtime]} is already installed, skipping install.`);
        setStep(stepId, "success");
        continue;
      }

      const installArgs = [npmCommand, "install", "-g"];
      if (runtime === "pi") installArgs.push("--ignore-scripts");
      installArgs.push(RUNTIME_INSTALL_PACKAGE[runtime]);
      addLog(`Running: ${installArgs.join(" ")}`);
      try {
        await runCommand(installArgs, signal, addLog);
        setStep(stepId, "success");
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          markCancelled();
          return;
        }
        setStep(stepId, "failed", String(error));
        installState.status = "failed";
        emitProgress();
        return;
      }
    }

    if (signal.aborted) {
      markCancelled();
      return;
    }

    if (plan.initializeClaude) {
      setStep("init-claude", "running");
      if (!(await commandExists("claude"))) {
        setStep("init-claude", "failed", "Claude Code CLI is not installed");
        installState.status = "failed";
        emitProgress();
        return;
      }
      ensureRuntimeDirectory("claude");
      if (detectClaudeInitialized()) {
        addLog("Claude environment initialized.");
        setStep("init-claude", "success");
      } else {
        addLog("Claude CLI is installed, but authentication was not detected.");
        addLog("Run `claude login` to finish Claude initialization.");
        needsSetup = true;
        setStep("init-claude", initializationStepStatus(false));
      }
    }

    if (plan.initializeCodex) {
      setStep("init-codex", "running");
      if (!(await commandExists("codex"))) {
        setStep("init-codex", "failed", "Codex CLI is not installed");
        installState.status = "failed";
        emitProgress();
        return;
      }
      ensureRuntimeDirectory("codex");
      if (detectCodexInitialized()) {
        addLog("Codex environment initialized.");
        setStep("init-codex", initializationStepStatus(true));
      } else {
        addLog("Codex CLI is installed, but credentials were not detected.");
        addLog("Configure Codex API Key in Settings or run `codex login`.");
        needsSetup = true;
        setStep("init-codex", initializationStepStatus(false));
      }
    }

    if (plan.initializePi) {
      setStep("init-pi", "running");
      if (!(await commandExists("pi"))) {
        setStep("init-pi", "failed", "Pi CLI is not installed");
        installState.status = "failed";
        emitProgress();
        return;
      }
      ensureRuntimeDirectory("pi");
      if (await detectPiInitialized()) {
        addLog("Pi model and authentication configuration detected.");
        setStep("init-pi", initializationStepStatus(true));
      } else {
        addLog("Pi CLI is installed, but no authenticated model was detected.");
        addLog("Run `pi`, use `/login`, then choose a model with `/model`.");
        needsSetup = true;
        setStep("init-pi", initializationStepStatus(false));
      }
    }

    if (signal.aborted) {
      markCancelled();
      return;
    }

    setStep("verify", "running");
    for (const runtime of plan.runtimes) {
      const version = await captureVersion(RUNTIME_BINARY[runtime]);
      if (!version) {
        setStep("verify", "failed", `${RUNTIME_LABEL[runtime]} was installed but could not be verified`);
        installState.status = "failed";
        emitProgress();
        return;
      }
      addLog(`${RUNTIME_LABEL[runtime]} installed: ${version}`);
    }

    setStep("verify", "success");
    installState.status = installCompletionStatus(needsSetup);
    installState.currentStep = null;
    emitProgress();
  } finally {
    if (installAbortController?.signal === signal) {
      installAbortController = null;
    }
  }
}

export function registerInstallHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle("install:check-prerequisites", async (): Promise<InstallPrerequisites> => {
    const [hasNode, hasClaude, hasCodex, hasPi, nodeVersion, claudeVersion, codexVersion, piVersion, piInitialized] = await Promise.all([
      commandExists("node"),
      commandExists("claude"),
      commandExists("codex"),
      commandExists("pi"),
      captureVersion("node"),
      captureVersion("claude"),
      captureVersion("codex"),
      captureVersion("pi"),
      detectPiInitialized(),
    ]);
    const hasHomebrew =
      process.platform === "darwin" && (existsSync("/opt/homebrew/bin/brew") || existsSync("/usr/local/bin/brew"));

    return {
      hasNode,
      nodeVersion,
      hasClaude,
      claudeVersion,
      hasCodex,
      codexVersion,
      hasPi,
      piVersion,
      claudeInitialized: detectClaudeInitialized(),
      codexInitialized: detectCodexInitialized(),
      piInitialized,
      nodeSupportsPi: nodeSupportsPi(nodeVersion),
      hasHomebrew,
      platform: os.platform(),
    };
  });

  ipcMain.handle("install:start", async (_event, options?: InstallStartOptions): Promise<void> => {
    if (installState.status === "running") {
      throw new Error("Installation is already running");
    }

    installAbortController = new AbortController();
    const startOptions: InstallStartOptions = {
      includeNode: options?.includeNode ?? false,
      installClaude: options?.installClaude ?? true,
      installCodex: options?.installCodex ?? true,
      installPi: options?.installPi ?? true,
      initializeClaude: options?.initializeClaude,
      initializeCodex: options?.initializeCodex,
      initializePi: options?.initializePi,
      upgradeExisting: options?.upgradeExisting ?? false,
    };

    runInstallSequence(startOptions, installAbortController.signal).catch((error) => {
      if (isAbortError(error) || installAbortController?.signal.aborted) {
        markCancelled();
        return;
      }
      installState.status = "failed";
      installState.logs.push(String(error));
      emitProgress();
    });
  });

  ipcMain.handle("install:cancel", (): void => {
    installAbortController?.abort();
    if (installState.status === "running") {
      markCancelled("Cancelling installation...");
    }
  });

  ipcMain.handle("install:get-logs", (): string[] => {
    return [...installState.logs];
  });
}

import { BrowserWindow, ipcMain } from "electron";
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProcessEnvWithShellPath, sanitizeDesktopChildEnv } from "../lib/shell-env";
import type { InstallPrerequisites, InstallStartOptions, InstallState } from "../bridge.d";

type RuntimeTarget = "claude" | "codex";

const RUNTIME_INSTALL_PACKAGE: Record<RuntimeTarget, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

const RUNTIME_BINARY: Record<RuntimeTarget, string> = {
  claude: "claude",
  codex: "codex",
};

const RUNTIME_LABEL: Record<RuntimeTarget, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const GIT_LABEL = "Git";
const GIT_BINARY = "git";

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

function ensureRuntimeDirectory(runtime: RuntimeTarget): void {
  const home = os.homedir();
  const dirPath = runtime === "claude"
    ? path.join(home, ".claude")
    : path.join(home, ".codex");
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
    return execSync(`${command} --version`, {
      env,
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

async function commandExists(command: string): Promise<boolean> {
  return (await captureVersion(command)) !== undefined;
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
  const installGit = options.installGit ?? false;
  const installClaude = options.installClaude ?? true;
  const installCodex = options.installCodex ?? true;
  const initializeClaude = options.initializeClaude ?? installClaude;
  const initializeCodex = options.initializeCodex ?? installCodex;

  const runtimes: RuntimeTarget[] = [];
  if (installClaude || initializeClaude) runtimes.push("claude");
  if (installCodex || initializeCodex) runtimes.push("codex");

  if (!installGit && runtimes.length === 0) {
    throw new Error("No tool selected for installation");
  }

  return {
    includeNode,
    installGit,
    installClaude,
    installCodex,
    initializeClaude,
    initializeCodex,
    runtimes,
  };
}

async function runInstallSequence(options: InstallStartOptions, signal: AbortSignal) {
  const plan = resolveInstallPlan(options);

  try {
    const steps = [
      ...(plan.includeNode ? [{ id: "install-node", label: "Installing Node.js" }] : []),
      { id: "check-node", label: "Checking Node.js" },
      ...(plan.installGit ? [{ id: "install-git", label: "Installing Git" }] : []),
      ...(plan.installClaude ? [{ id: "install-claude", label: "Installing Claude Code" }] : []),
      ...(plan.installCodex ? [{ id: "install-codex", label: "Installing Codex CLI" }] : []),
      ...(plan.initializeClaude ? [{ id: "init-claude", label: "Initializing Claude environment" }] : []),
      ...(plan.initializeCodex ? [{ id: "init-codex", label: "Initializing Codex environment" }] : []),
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
      addLog("Dry-run: Node.js found: v20.0.0");
      setStep("check-node", "success");

      if (plan.installGit) {
        setStep("install-git", "running");
        addLog("Dry-run: brew install git / winget install Git.Git (skipped)");
        await waitForDuration(220, signal);
        if (signal.aborted) {
          markCancelled();
          return;
        }
        setStep("install-git", "success");
      }

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
      }

      if (plan.initializeClaude) {
        setStep("init-claude", "running");
        addLog("Dry-run: Claude environment initialization check complete");
        await waitForDuration(150, signal);
        if (signal.aborted) {
          markCancelled();
          return;
        }
        setStep("init-claude", "success");
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
          await runCommand([brew, "install", "node"], signal, addLog);
        } else if (process.platform === "win32") {
          await runCommand(
            [
              "winget",
              "install",
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
    setStep("check-node", "success");

    if (signal.aborted) {
      markCancelled();
      return;
    }

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    if (plan.installGit) {
      setStep("install-git", "running");
      const alreadyInstalled = await commandExists(GIT_BINARY);

      if (alreadyInstalled) {
        addLog("Git is already installed, skipping install.");
        setStep("install-git", "success");
      } else {
        addLog(`Installing ${GIT_LABEL} via package manager...`);
        try {
          if (process.platform === "darwin") {
            const brew = existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : "/usr/local/bin/brew";
            if (!existsSync(brew)) {
              throw new Error("Homebrew is required but not found");
            }
            await runCommand([brew, "install", "git"], signal, addLog);
          } else if (process.platform === "win32") {
            await runCommand(
              [
                "winget",
                "install",
                "-e",
                "--id",
                "Git.Git",
                "--accept-source-agreements",
                "--accept-package-agreements",
              ],
              signal,
              addLog,
            );
          } else {
            throw new Error("Automatic Git installation is only supported on macOS/Windows");
          }
          setStep("install-git", "success");
        } catch (error) {
          if (signal.aborted || isAbortError(error)) {
            markCancelled();
            return;
          }
          setStep("install-git", "failed", String(error));
          installState.status = "failed";
          emitProgress();
          return;
        }
      }

      if (signal.aborted) {
        markCancelled();
        return;
      }
    }

    for (const runtime of plan.runtimes) {
      const installEnabled = runtime === "claude" ? plan.installClaude : plan.installCodex;
      const stepId = `install-${runtime}`;
      if (!installEnabled) {
        continue;
      }

      setStep(stepId, "running");
      const binary = RUNTIME_BINARY[runtime];
      const alreadyInstalled = await commandExists(binary);

      if (alreadyInstalled) {
        addLog(`${RUNTIME_LABEL[runtime]} is already installed, skipping install.`);
        setStep(stepId, "success");
        continue;
      }

      addLog(`Running: npm install -g ${RUNTIME_INSTALL_PACKAGE[runtime]}`);
      try {
        await runCommand([npmCommand, "install", "-g", RUNTIME_INSTALL_PACKAGE[runtime]], signal, addLog);
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
      } else {
        addLog("Claude CLI is installed, but authentication was not detected.");
        addLog("Run `claude login` to finish Claude initialization.");
      }
      setStep("init-claude", "success");
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
      } else {
        addLog("Codex CLI is installed, but credentials were not detected.");
        addLog("Configure Codex API Key in Settings or run `codex login`.");
      }
      setStep("init-codex", "success");
    }

    if (signal.aborted) {
      markCancelled();
      return;
    }

    setStep("verify", "running");
    if (plan.installGit) {
      const gitVersion = await captureVersion(GIT_BINARY);
      if (!gitVersion) {
        setStep("verify", "failed", `${GIT_LABEL} was installed but could not be verified`);
        installState.status = "failed";
        emitProgress();
        return;
      }
      addLog(`${GIT_LABEL} installed: ${gitVersion}`);
    }
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
    installState.status = "success";
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
    const [hasNode, hasGit, hasClaude, hasCodex, nodeVersion, gitVersion, claudeVersion, codexVersion] = await Promise.all([
      commandExists("node"),
      commandExists(GIT_BINARY),
      commandExists("claude"),
      commandExists("codex"),
      captureVersion("node"),
      captureVersion(GIT_BINARY),
      captureVersion("claude"),
      captureVersion("codex"),
    ]);
    const hasHomebrew =
      process.platform === "darwin" && (existsSync("/opt/homebrew/bin/brew") || existsSync("/usr/local/bin/brew"));

    return {
      hasNode,
      nodeVersion,
      hasGit,
      gitVersion,
      hasClaude,
      claudeVersion,
      hasCodex,
      codexVersion,
      claudeInitialized: detectClaudeInitialized(),
      codexInitialized: detectCodexInitialized(),
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
      installGit: options?.installGit ?? false,
      installClaude: options?.installClaude ?? true,
      installCodex: options?.installCodex ?? true,
      initializeClaude: options?.initializeClaude,
      initializeCodex: options?.initializeCodex,
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

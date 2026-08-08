"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Tick01Icon,
  Cancel01Icon,
  MinusSignIcon,
  Loading02Icon,
  RecordIcon,
  Copy01Icon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

type InstallTarget = "git" | "claude" | "codex" | "both";
type RuntimeKey = "claude" | "codex";

interface InstallProgress {
  status: "idle" | "running" | "success" | "failed" | "cancelled";
  currentStep: string | null;
  steps: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "success" | "failed" | "skipped";
    error?: string;
  }>;
  logs: string[];
}

interface InstallWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete?: () => void;
  target?: InstallTarget;
}

type WizardPhase =
  | "checking"
  | "confirm"
  | "already-installed"
  | "installing"
  | "success"
  | "failed";

interface PrereqResult {
  hasNode: boolean;
  nodeVersion?: string;
  hasGit: boolean;
  gitVersion?: string;
  hasClaude: boolean;
  claudeVersion?: string;
  hasCodex: boolean;
  codexVersion?: string;
  claudeInitialized: boolean;
  codexInitialized: boolean;
  hasHomebrew?: boolean;
  platform?: string;
}

function getInstallAPI() {
  if (typeof window !== "undefined") {
    return window.electronAPI?.install;
  }
  return undefined;
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <HugeiconsIcon icon={Tick01Icon} className="size-4 text-emerald-500" />;
    case "running":
      return <HugeiconsIcon icon={Loading02Icon} className="size-4 text-blue-500 animate-spin" />;
    case "failed":
      return <HugeiconsIcon icon={Cancel01Icon} className="size-4 text-red-500" />;
    case "skipped":
      return <HugeiconsIcon icon={MinusSignIcon} className="size-4 text-muted-foreground" />;
    default:
      return <HugeiconsIcon icon={RecordIcon} className="size-3.5 text-muted-foreground/40" />;
  }
}

function runtimeDisplay(runtime: RuntimeKey): string {
  return runtime === "claude" ? "Claude Code" : "Codex";
}

function runtimeCliDisplay(runtime: RuntimeKey): string {
  return runtime === "claude" ? "Claude Code CLI" : "Codex CLI";
}

function runtimeLoginCommand(runtime: RuntimeKey): string {
  return runtime === "claude" ? "claude login" : "codex login";
}

export function InstallWizard({
  open,
  onOpenChange,
  onInstallComplete,
  target = "both",
}: InstallWizardProps) {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const isSingleTarget = target !== "both";
  const includeGit = target === "git";
  const includeClaude = target === "both" || target === "claude";
  const includeCodex = target === "both" || target === "codex";
  const titleTarget = target === "both" ? "Claude + Codex" : target === "git" ? "Git" : runtimeDisplay(target);
  const activeRuntimes = useMemo<RuntimeKey[]>(
    () => (target === "both" ? ["claude", "codex"] : target === "git" ? [] : [target]),
    [target],
  );

  const [phase, setPhase] = useState<WizardPhase>("checking");
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedBrew, setCopiedBrew] = useState(false);
  const [prereqs, setPrereqs] = useState<PrereqResult | null>(null);
  const [installClaude, setInstallClaude] = useState(true);
  const [installCodex, setInstallCodex] = useState(true);
  const [initializeClaude, setInitializeClaude] = useState(true);
  const [initializeCodex, setInitializeCodex] = useState(true);

  const logEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const isRuntimeInstalled = useCallback((data: PrereqResult, runtime: RuntimeKey) => {
    return runtime === "claude" ? data.hasClaude : data.hasCodex;
  }, []);

  const isRuntimeInitialized = useCallback((data: PrereqResult, runtime: RuntimeKey) => {
    return runtime === "claude" ? data.claudeInitialized : data.codexInitialized;
  }, []);

  const runtimeVersion = useCallback((data: PrereqResult, runtime: RuntimeKey) => {
    return runtime === "claude" ? data.claudeVersion : data.codexVersion;
  }, []);

  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const cancelInstall = useCallback(async () => {
    const api = getInstallAPI();
    if (!api) return;
    try {
      await api.cancel();
    } catch {
      // ignore cancel errors
    }
  }, []);

  const startInstall = useCallback(async (options?: {
    includeNode?: boolean;
    installGit?: boolean;
    installClaude?: boolean;
    installCodex?: boolean;
    initializeClaude?: boolean;
    initializeCodex?: boolean;
  }) => {
    const api = getInstallAPI();
    if (!api) return;

    setPhase("installing");

    if (cleanupRef.current) cleanupRef.current();
    cleanupRef.current = api.onProgress((p) => {
      setProgress(p);
      setLogs(p.logs);

      if (p.status === "success") {
        setPhase("success");
      } else if (p.status === "failed" || p.status === "cancelled") {
        setPhase("failed");
      }
    });

    try {
      await api.start(options);
    } catch (err: unknown) {
      setPhase("failed");
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Installation error: ${msg}`]);
    }
  }, []);

  const checkPrereqs = useCallback(async () => {
    const api = getInstallAPI();
    if (!api) return;

    setPhase("checking");
    setLogs(["Checking environment..."]);
    setProgress(null);
    setPrereqs(null);

    try {
      const result = await api.checkPrerequisites();
      setPrereqs(result);

      setInstallClaude(activeRuntimes.includes("claude") ? !result.hasClaude : false);
      setInstallCodex(activeRuntimes.includes("codex") ? !result.hasCodex : false);
      setInitializeClaude(activeRuntimes.includes("claude") ? !result.claudeInitialized : false);
      setInitializeCodex(activeRuntimes.includes("codex") ? !result.codexInitialized : false);

      const nextLogs: string[] = [];
      nextLogs.push(result.hasNode ? `Node.js ${result.nodeVersion} found.` : "Node.js not found.");
      if (includeGit) {
        nextLogs.push(
          result.hasGit
            ? `Git ${result.gitVersion ?? "installed"} detected.`
            : "Git not detected.",
        );
      }
      for (const runtime of activeRuntimes) {
        const installed = isRuntimeInstalled(result, runtime);
        const initialized = isRuntimeInitialized(result, runtime);
        nextLogs.push(
          installed
            ? `${runtimeDisplay(runtime)} ${runtimeVersion(result, runtime) ?? "installed"} detected.`
            : `${runtimeCliDisplay(runtime)} not detected.`,
        );
        if (!initialized) {
          nextLogs.push(`${runtimeDisplay(runtime)} auth not detected. Initialization will include auth guidance.`);
        }
      }
      setLogs((prev) => [...prev, ...nextLogs]);

      const allInstalled = (includeGit ? result.hasGit : true)
        && activeRuntimes.every((runtime) => isRuntimeInstalled(result, runtime));
      const allInitialized = activeRuntimes.every((runtime) => isRuntimeInitialized(result, runtime));
      if (allInstalled && allInitialized) {
        setPhase("already-installed");
        return;
      }

      setPhase("confirm");
    } catch (err: unknown) {
      setPhase("failed");
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Error checking prerequisites: ${msg}`]);
    }
  }, [activeRuntimes, includeGit, isRuntimeInitialized, isRuntimeInstalled, runtimeVersion]);

  const handleConfirmInstall = useCallback(() => {
    if (!prereqs) return;

    const canInstallGit = includeGit && !prereqs.hasGit;
    const canInstallClaude = activeRuntimes.includes("claude") ? installClaude : false;
    const canInstallCodex = activeRuntimes.includes("codex") ? installCodex : false;
    const canInitClaude = activeRuntimes.includes("claude") && initializeClaude && (canInstallClaude || prereqs.hasClaude);
    const canInitCodex = activeRuntimes.includes("codex") && initializeCodex && (canInstallCodex || prereqs.hasCodex);
    const hasAnyAction = canInstallGit || canInstallClaude || canInstallCodex || canInitClaude || canInitCodex;

    if (!hasAnyAction) {
      setLogs((prev) => [...prev, "Select at least one install/init action to continue."]);
      return;
    }

    const needsNode = !prereqs.hasNode && (canInstallClaude || canInstallCodex);
    startInstall({
      includeNode: needsNode,
      installGit: canInstallGit,
      installClaude: canInstallClaude,
      installCodex: canInstallCodex,
      initializeClaude: canInitClaude,
      initializeCodex: canInitCodex,
    });
  }, [activeRuntimes, includeGit, initializeClaude, initializeCodex, installClaude, installCodex, prereqs, startInstall]);

  const handleCopyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [logs]);

  const handleDone = useCallback(() => {
    onOpenChange(false);
    onInstallComplete?.();
  }, [onOpenChange, onInstallComplete]);

  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen && phase === "installing") {
        await cancelInstall();
      }
      onOpenChange(nextOpen);
    },
    [phase, cancelInstall, onOpenChange],
  );

  useEffect(() => {
    if (open) {
      setPhase("checking"); // eslint-disable-line react-hooks/set-state-in-effect -- reset before async check
      setLogs([]);
      setProgress(null);
      setCopied(false);
      setCopiedBrew(false);
      setPrereqs(null);
      setInstallClaude(activeRuntimes.includes("claude"));
      setInstallCodex(activeRuntimes.includes("codex"));
      setInitializeClaude(activeRuntimes.includes("claude"));
      setInitializeCodex(activeRuntimes.includes("codex"));
      checkPrereqs();
    }
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [open, checkPrereqs, activeRuntimes]);

  const steps = progress?.steps ?? [];
  const needsNodeInstall = Boolean(prereqs && !prereqs.hasNode && ((includeClaude && installClaude) || (includeCodex && installCodex)));
  const needsGitInstall = Boolean(prereqs && includeGit && !prereqs.hasGit);
  const requiresManualPackageManager = Boolean(
    prereqs
      && prereqs.platform === "darwin"
      && !prereqs.hasHomebrew
      && (needsNodeInstall || needsGitInstall),
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isZh ? `安装 ${titleTarget}` : `Install ${titleTarget}`}</DialogTitle>
          <DialogDescription>
            {phase === "confirm"
              ? isSingleTarget
                ? (
                    target === "git"
                      ? (isZh ? "准备一键安装 Git。" : "One-click install Git.")
                      : (isZh ? `准备一键安装并初始化 ${titleTarget} 环境。` : `One-click install and initialize ${titleTarget}.`)
                  )
                : "Configure one-click install and initialization for Claude and Codex."
              : isSingleTarget
                ? (
                    target === "git"
                      ? (isZh ? "自动安装 Git" : "Automatically install Git")
                      : (isZh ? `自动安装并初始化 ${titleTarget} 环境` : `Automatically install and initialize ${titleTarget} environment`)
                  )
                : "Automatically install and initialize Claude and Codex environments"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {steps.length > 0 && (
            <div className="space-y-2">
              {steps.map((step) => (
                <div key={step.id} className="flex items-center gap-2.5 text-sm">
                  <StepIcon status={step.status} />
                  <span
                    className={cn(
                      step.status === "pending" && "text-muted-foreground",
                      step.status === "running" && "text-foreground font-medium",
                      step.status === "success" && "text-emerald-700 dark:text-emerald-400",
                      step.status === "failed" && "text-red-700 dark:text-red-400",
                      step.status === "skipped" && "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  {step.error && (
                    <span className="text-xs text-red-500 ml-auto truncate max-w-[200px]">{step.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {phase === "checking" && steps.length === 0 && (
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <HugeiconsIcon icon={Loading02Icon} className="size-4 animate-spin" />
              <span>{t("install.checkingPrereqs")}</span>
            </div>
          )}

          {phase === "confirm" && requiresManualPackageManager && (
            <div className="space-y-3">
              <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm space-y-1.5">
                <p className="text-amber-700 dark:text-amber-400 font-medium">{t("install.homebrewRequired")}</p>
                <p className="text-muted-foreground text-xs">{t("install.homebrewDescription")}</p>
              </div>
              <div className="rounded-md bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 px-3 py-2.5 flex items-center gap-2">
                <code className="flex-1 text-xs text-zinc-300 break-all select-all">
                  /bin/bash -c &quot;$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)&quot;
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-7 px-2"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
                      setCopiedBrew(true);
                      setTimeout(() => setCopiedBrew(false), 2000);
                    } catch {
                      // clipboard not available
                    }
                  }}
                >
                  <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
                  <span className="text-xs">{copiedBrew ? t("install.copied") : t("install.copy")}</span>
                </Button>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>{t("install.homebrewSteps")}</p>
                <ol className="list-decimal list-inside space-y-0.5 text-xs">
                  <li>{t("install.homebrewStep1")}</li>
                  <li>{t("install.homebrewStep2")}</li>
                  <li>{t("install.homebrewStep3")}</li>
                  <li>{t("install.homebrewStep4")}</li>
                </ol>
              </div>
            </div>
          )}

          {phase === "confirm" && !requiresManualPackageManager && (
            <div className="space-y-3">
              <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm space-y-1.5">
                {!prereqs?.hasNode && (includeClaude || includeCodex) ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    Node.js — not found (will be installed via {prereqs?.platform === "win32" ? "winget" : "Homebrew"})
                  </p>
                ) : prereqs?.hasNode ? (
                  <p className="text-emerald-700 dark:text-emerald-400">Node.js {prereqs.nodeVersion} — found</p>
                ) : (
                  <p className="text-muted-foreground">Node.js — optional for Git-only setup</p>
                )}

                {includeGit && (
                  <p className={prereqs?.hasGit ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                    Git — {prereqs?.hasGit ? `installed (${prereqs.gitVersion ?? "unknown version"})` : "not found"}
                  </p>
                )}

                {activeRuntimes.includes("claude") && (
                  <>
                    <p className={prereqs?.hasClaude ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Claude Code CLI — {prereqs?.hasClaude ? `installed (${prereqs.claudeVersion ?? "unknown version"})` : "not found"}
                    </p>
                    <p className={prereqs?.claudeInitialized ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Claude auth — {prereqs?.claudeInitialized ? "detected" : "not detected"}
                    </p>
                  </>
                )}

                {activeRuntimes.includes("codex") && (
                  <>
                    <p className={prereqs?.hasCodex ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Codex CLI — {prereqs?.hasCodex ? `installed (${prereqs.codexVersion ?? "unknown version"})` : "not found"}
                    </p>
                    <p className={prereqs?.codexInitialized ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Codex auth — {prereqs?.codexInitialized ? "detected" : "not detected"}
                    </p>
                  </>
                )}
              </div>

              {prereqs && !isSingleTarget && (
                <div className="rounded-lg border border-border-subtle bg-bg-secondary/40 p-3 space-y-3">
                  {includeClaude && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Install Claude Code CLI</p>
                          <p className="text-xs text-muted-foreground">Required for Claude runtime</p>
                        </div>
                        <Switch
                          checked={installClaude}
                          onCheckedChange={(checked) => {
                            setInstallClaude(checked);
                            if (!checked && !prereqs.hasClaude) {
                              setInitializeClaude(false);
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Initialize Claude environment</p>
                          <p className="text-xs text-muted-foreground">Checks auth status and creates runtime folder</p>
                        </div>
                        <Switch
                          checked={initializeClaude}
                          disabled={!installClaude && !prereqs.hasClaude}
                          onCheckedChange={setInitializeClaude}
                        />
                      </div>
                    </>
                  )}
                  {includeCodex && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Install Codex CLI</p>
                          <p className="text-xs text-muted-foreground">Required for Codex runtime</p>
                        </div>
                        <Switch
                          checked={installCodex}
                          onCheckedChange={(checked) => {
                            setInstallCodex(checked);
                            if (!checked && !prereqs.hasCodex) {
                              setInitializeCodex(false);
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Initialize Codex environment</p>
                          <p className="text-xs text-muted-foreground">Checks auth status and creates runtime folder</p>
                        </div>
                        <Switch
                          checked={initializeCodex}
                          disabled={!installCodex && !prereqs.hasCodex}
                          onCheckedChange={setInitializeCodex}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {prereqs && isSingleTarget && target !== "git" && (
                <p className="text-xs text-muted-foreground">
                  {isZh
                    ? `安装后若未检测到认证信息，请执行 ${runtimeLoginCommand(activeRuntimes[0])}`
                    : `If auth is still missing after installation, run ${runtimeLoginCommand(activeRuntimes[0])}.`}
                </p>
              )}
            </div>
          )}

          {phase === "already-installed" && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 px-4 py-3">
              <HugeiconsIcon icon={Tick01Icon} className="size-5 text-emerald-500 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">Already installed</p>
                <p className="text-muted-foreground text-xs">
                  {target === "git"
                    ? (isZh ? "Git 已安装。" : "Git is already installed.")
                    : (isZh
                      ? `${titleTarget} 已安装并完成初始化`
                      : `${titleTarget} is already installed and initialized.`)}
                </p>
              </div>
            </div>
          )}

          {phase === "success" && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 px-4 py-3">
              <HugeiconsIcon icon={Tick01Icon} className="size-5 text-emerald-500 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">{t("install.complete")}</p>
                <p className="text-muted-foreground text-xs">
                  {isSingleTarget
                    ? (
                        target === "git"
                          ? (isZh ? "Git 已安装完成。" : "Git was installed successfully.")
                          : (isZh
                            ? `${titleTarget} 已安装并初始化完成。`
                            : `${titleTarget} was installed and initialized successfully.`)
                      )
                    : "Selected runtimes were installed and initialized successfully."}
                </p>
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div className="rounded-md bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 max-h-48 overflow-y-auto">
              <div className="p-3 font-mono text-xs text-zinc-300 space-y-0.5">
                {logs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {logs.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleCopyLogs}>
              <HugeiconsIcon icon={Copy01Icon} />
              {copied ? t("install.copied") : t("install.copyLogs")}
            </Button>
          )}

          {phase === "confirm" && requiresManualPackageManager && (
            <Button size="sm" onClick={checkPrereqs}>{t("install.recheck")}</Button>
          )}
          {phase === "confirm" && !requiresManualPackageManager && (
            <Button size="sm" onClick={handleConfirmInstall}>
              <HugeiconsIcon icon={Download04Icon} />
              {t("install.install")}
            </Button>
          )}

          {phase === "installing" && (
            <Button variant="destructive" size="sm" onClick={cancelInstall}>
              {t("install.cancel")}
            </Button>
          )}

          {phase === "failed" && (
            <Button size="sm" onClick={checkPrereqs}>{t("install.retry")}</Button>
          )}

          {(phase === "success" || phase === "already-installed") && (
            <Button size="sm" onClick={handleDone}>{t("install.done")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

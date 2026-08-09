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
import { needsNodeInstallation } from "@/lib/install-plan";

type InstallTarget = "claude" | "codex" | "pi" | "both" | "all";
type RuntimeKey = "claude" | "codex" | "pi";

interface InstallProgress {
  status: "idle" | "running" | "success" | "needs_setup" | "failed" | "cancelled";
  currentStep: string | null;
  steps: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "success" | "needs_setup" | "failed" | "skipped";
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
  | "needs-setup"
  | "failed";

interface PrereqResult {
  hasNode: boolean;
  nodeVersion?: string;
  hasClaude: boolean;
  claudeVersion?: string;
  hasCodex: boolean;
  codexVersion?: string;
  hasPi: boolean;
  piVersion?: string;
  claudeInitialized: boolean;
  codexInitialized: boolean;
  piInitialized: boolean;
  nodeSupportsPi: boolean;
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
    case "needs_setup":
      return <HugeiconsIcon icon={RecordIcon} className="size-4 text-amber-500" />;
    case "failed":
      return <HugeiconsIcon icon={Cancel01Icon} className="size-4 text-red-500" />;
    case "skipped":
      return <HugeiconsIcon icon={MinusSignIcon} className="size-4 text-muted-foreground" />;
    default:
      return <HugeiconsIcon icon={RecordIcon} className="size-3.5 text-muted-foreground/40" />;
  }
}

function runtimeDisplay(runtime: RuntimeKey): string {
  return runtime === "claude" ? "Claude Code" : runtime === "codex" ? "Codex" : "Pi";
}

function runtimeCliDisplay(runtime: RuntimeKey): string {
  return `${runtimeDisplay(runtime)} CLI`;
}

function runtimeLoginCommand(runtime: RuntimeKey): string {
  return runtime === "claude" ? "claude login" : runtime === "codex" ? "codex login" : "pi → /login";
}

export function InstallWizard({
  open,
  onOpenChange,
  onInstallComplete,
  target = "all",
}: InstallWizardProps) {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const isSingleTarget = target !== "both" && target !== "all";
  const includeClaude = target === "both" || target === "all" || target === "claude";
  const includeCodex = target === "both" || target === "all" || target === "codex";
  const includePi = target === "all" || target === "pi";
  const titleTarget = target === "all"
    ? "Claude Code + Codex + Pi"
    : target === "both"
    ? "Claude Code + Codex"
    : runtimeDisplay(target);
  const activeRuntimes = useMemo<RuntimeKey[]>(
    () => target === "all"
      ? ["claude", "codex", "pi"]
      : target === "both"
      ? ["claude", "codex"]
      : [target],
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
  const [installPi, setInstallPi] = useState(true);
  const [initializeClaude, setInitializeClaude] = useState(true);
  const [initializeCodex, setInitializeCodex] = useState(true);
  const [initializePi, setInitializePi] = useState(true);

  const logEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const isRuntimeInstalled = useCallback((data: PrereqResult, runtime: RuntimeKey) => {
    return runtime === "claude" ? data.hasClaude : runtime === "codex" ? data.hasCodex : data.hasPi;
  }, []);

  const isRuntimeInitialized = useCallback((data: PrereqResult, runtime: RuntimeKey) => {
    return runtime === "claude"
      ? data.claudeInitialized
      : runtime === "codex"
      ? data.codexInitialized
      : data.piInitialized;
  }, []);

  const runtimeVersion = useCallback((data: PrereqResult, runtime: RuntimeKey) => {
    return runtime === "claude" ? data.claudeVersion : runtime === "codex" ? data.codexVersion : data.piVersion;
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
    installClaude?: boolean;
    installCodex?: boolean;
    installPi?: boolean;
    initializeClaude?: boolean;
    initializeCodex?: boolean;
    initializePi?: boolean;
    upgradeExisting?: boolean;
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
      } else if (p.status === "needs_setup") {
        setPhase("needs-setup");
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
      setInstallPi(activeRuntimes.includes("pi") ? !result.hasPi : false);
      setInitializeClaude(activeRuntimes.includes("claude") ? !result.claudeInitialized : false);
      setInitializeCodex(activeRuntimes.includes("codex") ? !result.codexInitialized : false);
      setInitializePi(activeRuntimes.includes("pi") ? !result.piInitialized : false);

      const nextLogs: string[] = [];
      nextLogs.push(result.hasNode ? `Node.js ${result.nodeVersion} found.` : "Node.js not found.");
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

      const allInstalled = activeRuntimes.every((runtime) => isRuntimeInstalled(result, runtime));
      const allInitialized = activeRuntimes.every((runtime) => isRuntimeInitialized(result, runtime));
      const nodeCompatible = !activeRuntimes.includes("pi") || result.nodeSupportsPi;
      if (allInstalled && allInitialized && nodeCompatible) {
        setPhase("already-installed");
        return;
      }

      setPhase("confirm");
    } catch (err: unknown) {
      setPhase("failed");
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Error checking prerequisites: ${msg}`]);
    }
  }, [activeRuntimes, isRuntimeInitialized, isRuntimeInstalled, runtimeVersion]);

  const handleConfirmInstall = useCallback(() => {
    if (!prereqs) return;

    const canInstallClaude = activeRuntimes.includes("claude") ? installClaude : false;
    const canInstallCodex = activeRuntimes.includes("codex") ? installCodex : false;
    const canInstallPi = activeRuntimes.includes("pi") ? installPi : false;
    const canInitClaude = activeRuntimes.includes("claude") && initializeClaude && (canInstallClaude || prereqs.hasClaude);
    const canInitCodex = activeRuntimes.includes("codex") && initializeCodex && (canInstallCodex || prereqs.hasCodex);
    const canInitPi = activeRuntimes.includes("pi") && initializePi && (canInstallPi || prereqs.hasPi);
    const hasAnyAction = canInstallClaude || canInstallCodex || canInstallPi || canInitClaude || canInitCodex || canInitPi;

    if (!hasAnyAction) {
      setLogs((prev) => [...prev, "Select at least one install/init action to continue."]);
      return;
    }

    const needsNode = needsNodeInstallation({
      hasNode: prereqs.hasNode,
      nodeSupportsPi: prereqs.nodeSupportsPi,
      installClaude: canInstallClaude,
      installCodex: canInstallCodex,
      installPi: canInstallPi,
      initializePi: canInitPi,
    });
    startInstall({
      includeNode: needsNode,
      installClaude: canInstallClaude,
      installCodex: canInstallCodex,
      installPi: canInstallPi,
      initializeClaude: canInitClaude,
      initializeCodex: canInitCodex,
      initializePi: canInitPi,
    });
  }, [activeRuntimes, initializeClaude, initializeCodex, initializePi, installClaude, installCodex, installPi, prereqs, startInstall]);

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
      setInstallPi(activeRuntimes.includes("pi"));
      setInitializeClaude(activeRuntimes.includes("claude"));
      setInitializeCodex(activeRuntimes.includes("codex"));
      setInitializePi(activeRuntimes.includes("pi"));
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
  const needsNodeInstall = Boolean(
    prereqs
      && needsNodeInstallation({
        hasNode: prereqs.hasNode,
        nodeSupportsPi: prereqs.nodeSupportsPi,
        installClaude: includeClaude && installClaude,
        installCodex: includeCodex && installCodex,
        installPi: includePi && installPi,
        initializePi: includePi && initializePi,
      }),
  );
  const requiresManualPackageManager = Boolean(
    prereqs
      && prereqs.platform === "darwin"
      && !prereqs.hasHomebrew
      && needsNodeInstall,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isZh ? `安装 ${titleTarget}` : `Install ${titleTarget}`}</DialogTitle>
          <DialogDescription>
            {phase === "confirm"
              ? isSingleTarget
                ? (isZh ? `准备一键安装并初始化 ${titleTarget} 环境。` : `One-click install and initialize ${titleTarget}.`)
                : isZh
                  ? `配置 ${titleTarget} 的一键安装与初始化。`
                  : `Configure one-click install and initialization for ${titleTarget}.`
              : isSingleTarget
                ? (isZh ? `自动安装并初始化 ${titleTarget} 环境` : `Automatically install and initialize ${titleTarget} environment`)
                : isZh
                  ? `自动安装并初始化 ${titleTarget} 环境`
                  : `Automatically install and initialize ${titleTarget} environments`}
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
                      step.status === "needs_setup" && "text-amber-700 dark:text-amber-400",
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
                {!prereqs?.hasNode && (includeClaude || includeCodex || includePi) ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    Node.js — not found (will be installed via {prereqs?.platform === "win32" ? "winget" : "Homebrew"})
                  </p>
                ) : includePi && prereqs?.hasNode && !prereqs.nodeSupportsPi ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    Node.js {prereqs.nodeVersion} — Pi requires Node.js 22.19.0 or newer (will be upgraded)
                  </p>
                ) : prereqs?.hasNode ? (
                  <p className="text-emerald-700 dark:text-emerald-400">Node.js {prereqs.nodeVersion} — found</p>
                ) : null}


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

                {activeRuntimes.includes("pi") && (
                  <>
                    <p className={prereqs?.hasPi ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Pi CLI — {prereqs?.hasPi ? `installed (${prereqs.piVersion ?? "unknown version"})` : "not found"}
                    </p>
                    <p className={prereqs?.piInitialized ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Pi model/auth — {prereqs?.piInitialized ? "detected" : "not detected"}
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
                  {includePi && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Install Pi CLI</p>
                          <p className="text-xs text-muted-foreground">Requires Node.js 22.19.0 or newer</p>
                        </div>
                        <Switch
                          checked={installPi}
                          onCheckedChange={(checked) => {
                            setInstallPi(checked);
                            if (!checked && !prereqs.hasPi) setInitializePi(false);
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Initialize Pi environment</p>
                          <p className="text-xs text-muted-foreground">Checks native models/auth and creates ~/.pi/agent</p>
                        </div>
                        <Switch
                          checked={initializePi}
                          disabled={!installPi && !prereqs.hasPi}
                          onCheckedChange={setInitializePi}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {prereqs && isSingleTarget && (
                <p className="text-xs text-muted-foreground">
                  {isZh
                    ? `安装后若未检测到认证信息，请执行 ${runtimeLoginCommand(activeRuntimes[0])}`
                    : `If auth is still missing after installation, run ${runtimeLoginCommand(activeRuntimes[0])}.`}
                </p>
              )}
            </div>
          )}

          {phase === "already-installed" && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-500/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <HugeiconsIcon icon={Tick01Icon} className="size-5 text-emerald-500 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-400">Already installed</p>
                  <p className="text-muted-foreground text-xs">
                    {isZh
                      ? `${titleTarget} 已安装并完成初始化`
                      : `${titleTarget} is already installed and initialized.`}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startInstall({
                  installClaude: includeClaude,
                  installCodex: includeCodex,
                  installPi: includePi,
                  initializeClaude: false,
                  initializeCodex: false,
                  initializePi: false,
                  upgradeExisting: true,
                })}
              >
                {isZh ? "更新到最新版" : "Update latest"}
              </Button>
            </div>
          )}

          {phase === "success" && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 px-4 py-3">
              <HugeiconsIcon icon={Tick01Icon} className="size-5 text-emerald-500 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">{t("install.complete")}</p>
                <p className="text-muted-foreground text-xs">
                  {isSingleTarget
                    ? (isZh
                      ? `${titleTarget} 已安装并初始化完成。`
                      : `${titleTarget} was installed and initialized successfully.`)
                    : "Selected runtimes were installed and initialized successfully."}
                </p>
              </div>
            </div>
          )}

          {phase === "needs-setup" && (
            <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 px-4 py-3">
              <HugeiconsIcon icon={RecordIcon} className="mt-0.5 size-5 shrink-0 text-amber-500" />
              <div className="text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  {isZh ? "已安装，还需要完成认证" : "Installed — authentication still required"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isZh
                    ? "请按日志中的登录指引完成至少一个运行时的认证，然后刷新状态。"
                    : "Follow the login guidance in the logs, then refresh runtime status."}
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

          {(phase === "success" || phase === "needs-setup" || phase === "already-installed") && (
            <Button size="sm" onClick={handleDone}>{t("install.done")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

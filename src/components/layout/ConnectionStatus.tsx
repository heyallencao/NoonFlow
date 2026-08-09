"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { InstallWizard } from "@/components/layout/InstallWizard";
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from "@/lib/browser-storage";

interface RuntimeStatus {
  id: "claude_code" | "codex" | "pi";
  label: string;
  launchable: boolean;
  installed: boolean;
  configured: boolean;
  available: boolean;
  version?: string;
  status_message?: string;
}

interface RuntimeStatusResponse {
  runtimes: RuntimeStatus[];
}

const BASE_INTERVAL = 30_000; // 30s
const BACKED_OFF_INTERVAL = 60_000; // 60s after 3 consecutive stable results
const STABLE_THRESHOLD = 3;
const INSTALL_WIZARD_DISMISSED_KEY = "noonflow:install-wizard-dismissed";
const LEGACY_INSTALL_WIZARD_DISMISSED_KEYS = ["monolith:install-wizard-dismissed"] as const;

export function ConnectionStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RuntimeStatusResponse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const hasNativeInstallBridge =
    typeof window !== "undefined" &&
    !!window.electronAPI?.install;
  const stableCountRef = useRef(0);
  const lastConnectedRef = useRef<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPromptedRef = useRef(false);

  // Use a ref-based approach to avoid circular deps between check and schedule
  const checkRef = useRef<() => void>(() => {});

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const interval = stableCountRef.current >= STABLE_THRESHOLD
      ? BACKED_OFF_INTERVAL
      : BASE_INTERVAL;
    timerRef.current = setTimeout(() => checkRef.current(), interval);
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant-runtimes");
      if (res.ok) {
        const data: RuntimeStatusResponse = await res.json();
        const anyAvailable = data.runtimes.some((runtime) => runtime.available);
        if (lastConnectedRef.current === anyAvailable) {
          stableCountRef.current++;
        } else {
          stableCountRef.current = 0;
        }
        lastConnectedRef.current = anyAvailable;
        setStatus(data);
      }
    } catch {
      if (lastConnectedRef.current === false) {
        stableCountRef.current++;
      } else {
        stableCountRef.current = 0;
      }
      lastConnectedRef.current = false;
      setStatus({ runtimes: [] });
    }
    schedule();
  }, [schedule]);

  useEffect(() => {
    checkRef.current = checkStatus;
  }, [checkStatus]);

  useEffect(() => {
    checkStatus(); // eslint-disable-line react-hooks/set-state-in-effect -- setState is called asynchronously after fetch
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [checkStatus]);

  const handleManualRefresh = useCallback(() => {
    stableCountRef.current = 0;
    checkStatus();
  }, [checkStatus]);

  // Auto-prompt install wizard on first disconnect detection (desktop bridge only)
  useEffect(() => {
    if (
      status !== null &&
      !status.runtimes.some((runtime) => runtime.available) &&
      hasNativeInstallBridge &&
      !autoPromptedRef.current &&
      !dialogOpen &&
      !wizardOpen
    ) {
      const dismissed = readCompatibleStorageValue(
        getLocalStorageSafe(),
        INSTALL_WIZARD_DISMISSED_KEY,
        LEGACY_INSTALL_WIZARD_DISMISSED_KEYS,
      );
      if (!dismissed) {
        autoPromptedRef.current = true;
        setWizardOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- intentional: auto-prompt on first disconnect
      }
    }
  }, [status, hasNativeInstallBridge, dialogOpen, wizardOpen]);

  const handleWizardOpenChange = useCallback((open: boolean) => {
    setWizardOpen(open);
    if (!open) {
      // Remember that user dismissed the wizard so we don't auto-prompt again
      writeStorageValue(getLocalStorageSafe(), INSTALL_WIZARD_DISMISSED_KEY, "1");
    }
  }, []);

  const connected = status?.runtimes.some((runtime) => runtime.available) ?? false;
  const availableLabels = status?.runtimes.filter((runtime) => runtime.available).map((runtime) => runtime.label).join(", ") || "";

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors",
          status === null
            ? "bg-muted text-muted-foreground"
            : connected
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-red-500/15 text-red-700 dark:text-red-400"
        )}
      >
        <span
          className={cn(
            "block h-1.5 w-1.5 shrink-0 rounded-full",
            status === null
              ? "bg-muted-foreground/40"
              : connected
                ? "bg-emerald-500"
                : "bg-red-500"
          )}
        />
        {status === null
          ? t('connection.checking')
          : connected
            ? t('connection.connected')
            : t('connection.disconnected')}
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {connected ? t('connection.installed') : t('connection.notInstalled')}
            </DialogTitle>
            <DialogDescription>
              {connected
                ? `${availableLabels} ${status?.runtimes.filter((runtime) => runtime.available).length === 1 ? "is" : "are"} ready.`
                : "At least one Claude Code, Codex, or Pi runtime is required to use this application."}
            </DialogDescription>
          </DialogHeader>

          {connected ? (
            <div className="space-y-2 text-sm">
              {status?.runtimes.map((runtime) => (
                <div key={runtime.id} className={cn("flex items-center gap-3 rounded-lg px-4 py-3", runtime.available ? "bg-emerald-500/10" : "bg-muted/50")}>
                  <span className={cn("block h-2.5 w-2.5 shrink-0 rounded-full", runtime.available ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                  <div>
                    <p className={cn("font-medium", runtime.available && "text-emerald-700 dark:text-emerald-400")}>{runtime.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {runtime.available ? `${runtime.version || "Installed"} · Ready` : runtime.status_message || "Needs setup"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3 rounded-lg bg-red-500/10 px-4 py-3">
                <span className="block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                <p className="font-medium text-red-700 dark:text-red-400">Not detected</p>
              </div>

              <div>
                <h4 className="font-medium mb-1.5">1. Install Claude Code CLI</h4>
                <code className="block rounded-md bg-muted px-3 py-2 text-xs">
                  npm install -g @anthropic-ai/claude-code
                </code>
              </div>

              <div>
                <h4 className="font-medium mb-1.5">2. Install Codex CLI</h4>
                <code className="block rounded-md bg-muted px-3 py-2 text-xs">
                  npm install -g @openai/codex
                </code>
              </div>

              <div>
                <h4 className="font-medium mb-1.5">3. Install Pi CLI</h4>
                <code className="block rounded-md bg-muted px-3 py-2 text-xs">
                  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
                </code>
              </div>

              <div>
                <h4 className="font-medium mb-1.5">4. Initialize one runtime</h4>
                <code className="block rounded-md bg-muted px-3 py-2 text-xs">
                  claude login  # or: codex login  # or: pi then /login
                </code>
              </div>

              <div>
                <h4 className="font-medium mb-1.5">5. Verify Installation</h4>
                <code className="block rounded-md bg-muted px-3 py-2 text-xs">
                  claude --version; codex --version; pi --version
                </code>
              </div>

              {hasNativeInstallBridge && (
                <div className="pt-2 border-t">
                  <Button
                    onClick={() => {
                      setDialogOpen(false);
                      setWizardOpen(true);
                    }}
                    className="w-full"
                  >
                    {t('connection.installAuto')}
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleManualRefresh}
            >
              {t('connection.refresh')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InstallWizard
        open={wizardOpen}
        onOpenChange={handleWizardOpenChange}
        onInstallComplete={handleManualRefresh}
        target="all"
      />
    </>
  );
}

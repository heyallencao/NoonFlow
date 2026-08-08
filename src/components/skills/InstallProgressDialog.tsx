"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, CheckmarkCircle02Icon, Cancel01Icon, ZapIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

interface InstallProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "install" | "uninstall";
  source: string;
  skillName: string;
  skillId?: string;
  onComplete: () => void;
  defaultRuntime?: "claude-code" | "codex";
}

type Phase = "idle" | "running" | "success" | "error";

export function InstallProgressDialog({
  open,
  onOpenChange,
  action,
  source,
  skillName,
  skillId,
  onComplete,
  defaultRuntime = "claude-code",
}: InstallProgressDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [runtime, setRuntime] = useState<"claude-code" | "codex">(defaultRuntime);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startProcess = useCallback(async () => {
    setPhase("running");
    setLogs([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const endpoint =
        action === "install"
          ? "/api/skills/marketplace/install"
          : "/api/skills/marketplace/remove";

      const body =
        action === "install"
          ? { source, global: true, runtime }
          : { skill: skillId || skillName, global: true, runtime };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        setPhase("error");
        if (res.status === 409) {
          // Conflict: skill already exists
          const errorData = await res.json();
          setLogs((prev) => [...prev, errorData.error || "Skill already exists"]);
        } else {
          setLogs((prev) => [...prev, `HTTP ${res.status}: ${res.statusText}`]);
        }
        return;
      }

      if (!res.body) {
        setPhase("error");
        setLogs((prev) => [...prev, "No response body"]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            let data: string;
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }

            if (currentEvent === "output") {
              setLogs((prev) => [...prev, data]);
            } else if (currentEvent === "done") {
              setPhase("success");
            } else if (currentEvent === "error") {
              setPhase("error");
              setLogs((prev) => [...prev, `Error: ${data}`]);
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setPhase("error");
        setLogs((prev) => [...prev, (err as Error).message]);
      }
    }
  }, [action, source, skillId, skillName, runtime]);

  useEffect(() => {
    if (!open) {
      // Dialog was closed — abort any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (phase === "idle") {
      setRuntime(defaultRuntime);
    }
  }, [defaultRuntime, phase]);

  const handleStart = () => {
    void startProcess();
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleClose = (open?: boolean) => {
    if (open === true) return; // Ignore dialog opening events
    abortRef.current?.abort();
    if (phase === "success") {
      onComplete();
    }
    onOpenChange(false);
  };

  const handleCloseClick = () => {
    handleClose(false);
  };

  // Reset phase when dialog closes so it can be reopened
  useEffect(() => {
    if (!open) {
      setPhase("idle");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg overflow-hidden rounded-2xl border-border-default bg-bg-secondary p-0 shadow-2xl" showCloseButton={false}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-3 text-base font-bold text-foreground">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              phase === "idle" ? "bg-primary/10 text-primary" :
              phase === "running" ? "bg-primary/10 text-primary" :
              phase === "success" ? "bg-success/10 text-success" :
              "bg-destructive/10 text-destructive"
            )}>
              {phase === "idle" && (
                <HugeiconsIcon icon={ZapIcon} className="h-5 w-5" />
              )}
              {phase === "running" && (
                <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin" />
              )}
              {phase === "success" && (
                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-5 w-5" />
              )}
              {phase === "error" && (
                <HugeiconsIcon icon={Cancel01Icon} className="h-5 w-5" />
              )}
            </div>
            {phase === "idle"
              ? t('skills.install')
              : phase === "running"
                ? t('skills.installing')
                : phase === "success"
                  ? t('skills.installSuccess')
                  : t('skills.installFailed')}
          </DialogTitle>
        </DialogHeader>

        {action === "install" && phase === "idle" && (
          <div className="mx-4 mb-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Install for:</span>
            <div className="flex rounded-lg border border-border-subtle bg-bg-tertiary p-0.5">
              {(["claude-code", "codex"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRuntime(r)}
                  className={cn(
                    "px-3 py-1 text-[11px] font-medium rounded-md transition-all",
                    runtime === r
                      ? "bg-bg-hover text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r === "claude-code" ? "Claude Code" : "Codex CLI"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-4 mb-4 bg-bg-primary border border-border-subtle rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed custom-scrollbar text-muted-foreground/80">
          {logs.length === 0 && phase === "running" && (
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-muted-foreground/40 italic">{t('skills.installing')}...</span>
            </div>
          )}
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all border-b border-white/[0.02] py-1 last:border-0">
              <span className="text-primary/40 mr-2 opacity-50">›</span>
              {line}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>

        <DialogFooter className="border-t border-border-subtle bg-bg-secondary p-4 flex items-center justify-end">
          {phase === "idle" && action === "install" ? (
            <div className="flex w-full justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseClick}
                className="rounded-lg font-bold px-4 text-muted-foreground hover:text-foreground hover:bg-bg-hover"
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleStart}
                className="rounded-lg font-bold px-6 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t('skills.install')}
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleCloseClick}
              variant={phase === "running" ? "ghost" : "default"}
              size="sm"
              className={cn(
                "rounded-lg font-bold px-6",
                phase === "running" ? "text-muted-foreground hover:text-foreground hover:bg-bg-hover" : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {phase === "running" ? t('common.cancel') : t('common.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useDeferredValue, useState } from "react";
import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, ZapIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { isImeComposingEvent } from "@/lib/ime";
import { CodeMirrorSourceEditor } from "@/components/layout/CodeMirrorSourceEditor";
import { useTranslation } from "@/hooks/useTranslation";

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, scope: "global" | "project", content: string) => Promise<void>;
}

const DEFAULT_TEMPLATE = `---
description: What this skill teaches Claude to do
---
# Skill Name

## When to use

## Instructions
`;

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateSkillDialogProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [content, setContent] = useState(DEFAULT_TEMPLATE);
  const [editorVersion, setEditorVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"source" | "preview">("source");
  const deferredContent = useDeferredValue(content);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError("Name can only contain letters, numbers, dashes, and underscores");
      return;
    }

    setCreating(true);
    setError("");
    try {
      await onCreate(trimmed, scope, content);
      setName("");
      setScope("global");
      setContent(DEFAULT_TEMPLATE);
      setEditorVersion((current) => current + 1);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-2xl border-border-default bg-bg-secondary p-0 shadow-2xl sm:max-w-2xl">
        <DialogHeader className="p-4 pb-2">
          <div className="flex w-full items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <HugeiconsIcon icon={ZapIcon} className="h-4 w-4" />
              </div>
              {t("skills.newSkill")}
            </DialogTitle>
            <div className="flex items-center gap-4 text-xs font-medium">
              <button
                onClick={() => setViewMode("source")}
                className={cn(
                  "transition-colors",
                  viewMode === "source"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("skills.edit")}
              </button>
              <button
                onClick={() => setViewMode("preview")}
                className={cn(
                  "transition-colors",
                  viewMode === "preview"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("skills.preview")}
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-4 pt-2">
          <div className="flex items-center overflow-hidden rounded-xl border border-border-subtle bg-bg-primary focus-within:ring-1 focus-within:ring-primary/50 transition-all">
            <input
              className="flex-1 border-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/30"
              placeholder="skill-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isImeComposingEvent(e)) {
                  e.preventDefault();
                }
              }}
            />
            <div className="h-5 w-px bg-border-subtle" />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "global" | "project")}
              className="cursor-pointer appearance-none border-none bg-transparent px-3 py-2 pr-8 text-sm text-foreground outline-none hover:bg-bg-hover focus:ring-0 transition-colors"
              style={{
                background:
                  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'1.5\' stroke=\'rgba(255,255,255,0.3)\' class=\'w-4 h-4\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9\' /%3E%3C/svg%3E") no-repeat right 8px center / 14px',
              }}
            >
              <option value="global" className="bg-bg-secondary">{t("skills.global")}</option>
              <option value="project" className="bg-bg-secondary">{t("skills.project")}</option>
            </select>
          </div>

          <div className="h-[300px] overflow-hidden rounded-xl border border-border-subtle bg-bg-primary">
            {viewMode === "source" ? (
              <CodeMirrorSourceEditor
                value={content}
                valueVersion={editorVersion}
                isDark={isDark}
                language="markdown"
                readOnly={false}
                onChange={setContent}
                onSaveShortcut={() => {
                  void handleCreate();
                }}
                className="h-full w-full"
              />
            ) : (
              <div className="prose prose-sm h-full w-full max-w-none overflow-y-auto p-4 dark:prose-invert custom-scrollbar">
                <pre className="m-0 bg-transparent p-0 text-xs text-muted-foreground">{deferredContent}</pre>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive px-1">{error}</p>}
        </div>

        <DialogFooter className="border-t border-border-subtle bg-bg-secondary p-4 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            className="text-muted-foreground hover:text-foreground hover:bg-bg-hover rounded-lg"
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg font-bold px-4"
          >
            {creating && <HugeiconsIcon icon={Loading02Icon} className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {t("skills.createSkill")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

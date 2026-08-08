"use client";

import { useState, useCallback, useEffect, useDeferredValue } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FloppyDiskIcon,
  Delete02Icon,
  EyeIcon,
  Edit02Icon,
  GlobeIcon,
  FolderOpenIcon,
  Loading02Icon,
  LayoutTwoColumnIcon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "@/hooks/useTranslation";
import { CodeMirrorSourceEditor } from "@/components/layout/CodeMirrorSourceEditor";
import type { SkillItem } from "./SkillListItem";

type ViewMode = "edit" | "preview" | "split";

interface SkillEditorProps {
  skill: SkillItem;
  onSave: (skill: SkillItem, content: string) => Promise<void>;
  onDelete: (skill: SkillItem) => void;
  onBack?: () => void;
}

export function SkillEditor({ skill, onSave, onDelete, onBack }: SkillEditorProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [content, setContent] = useState(skill.content);
  const [editorVersion, setEditorVersion] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deferredContent = useDeferredValue(content);
  const isDirty = content !== skill.content;

  useEffect(() => {
    setContent(skill.content);
    setEditorVersion((current) => current + 1);
    setConfirmDelete(false);
    setSaved(false);
  }, [skill.name, skill.filePath, skill.content]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(skill, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [skill, content, onSave]);

  const handleDelete = () => {
    if (skill.source === "installed") {
      onDelete(skill);
      return;
    }
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const markdownContent = (
    <div className="prose prose-sm dark:prose-invert max-w-none overflow-auto p-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredContent}</ReactMarkdown>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        {onBack && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onBack}
            className="mr-2 shrink-0 border-border-subtle bg-card text-foreground shadow-sm hover:border-primary/30 hover:bg-accent/40"
            aria-label="Back"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold">/{skill.name}</span>
          {isDirty && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-orange-400"
              title="Unsaved changes"
            />
          )}
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 px-1.5 py-0 text-[10px]",
              skill.source === "global"
                ? "border-green-500/40 text-green-600 dark:text-green-400"
                : skill.source === "installed"
                  ? "border-orange-500/40 text-orange-600 dark:text-orange-400"
                  : skill.source === "plugin"
                    ? "border-indigo-500/40 text-indigo-600 dark:text-indigo-400"
                    : "border-blue-500/40 text-blue-600 dark:text-blue-400"
            )}
          >
            {skill.source === "global" ? (
              <HugeiconsIcon icon={GlobeIcon} className="mr-0.5 h-2.5 w-2.5" />
            ) : skill.source === "installed" ? (
              <HugeiconsIcon icon={FolderOpenIcon} className="mr-0.5 h-2.5 w-2.5" />
            ) : (
              <HugeiconsIcon icon={FolderOpenIcon} className="mr-0.5 h-2.5 w-2.5" />
            )}
            {skill.source === "installed" && skill.installedSource
              ? `installed:${skill.installedSource}`
              : skill.source}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "edit" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("edit")}
              >
                <HugeiconsIcon icon={Edit02Icon} className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skills.edit")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "preview" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("preview")}
              >
                <HugeiconsIcon icon={EyeIcon} className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skills.preview")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "split" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("split")}
              >
                <HugeiconsIcon icon={LayoutTwoColumnIcon} className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skills.splitView")}</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button size="xs" onClick={handleSave} disabled={!isDirty || saving} className="gap-1">
            {saving ? (
              <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />
            ) : (
              <HugeiconsIcon icon={FloppyDiskIcon} className="h-3 w-3" />
            )}
            {saving ? "Saving" : saved ? t("skills.saved") : t("skills.save")}
          </Button>

          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            size="icon-xs"
            onClick={handleDelete}
          >
            <HugeiconsIcon icon={Delete02Icon} className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {viewMode === "edit" && (
          <CodeMirrorSourceEditor
            value={content}
            valueVersion={editorVersion}
            isDark={isDark}
            language="markdown"
            readOnly={false}
            onChange={setContent}
            onSaveShortcut={() => {
              if (isDirty) {
                void handleSave();
              }
            }}
            className="h-full w-full min-h-[400px]"
          />
        )}
        {viewMode === "preview" && <div className="h-full overflow-auto">{markdownContent}</div>}
        {viewMode === "split" && (
          <div className="flex h-full divide-x divide-border">
            <div className="min-w-0 flex-1">
              <CodeMirrorSourceEditor
                value={content}
                valueVersion={editorVersion}
                isDark={isDark}
                language="markdown"
                readOnly={false}
                onChange={setContent}
                onSaveShortcut={() => {
                  if (isDirty) {
                    void handleSave();
                  }
                }}
                className="h-full w-full"
              />
            </div>
            <div className="min-w-0 flex-1 overflow-auto">{markdownContent}</div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{skill.filePath}</span>
      </div>
    </div>
  );
}

"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CommandLineIcon,
  Edit02Icon,
  EyeIcon,
  LayoutTwoColumnIcon,
} from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeMirrorSourceEditor } from "@/components/layout/CodeMirrorSourceEditor";
import { useTranslation } from "@/hooks/useTranslation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentItem } from "./types";

interface AgentDetailProps {
  agent: AgentItem;
  onBack: () => void;
}

type MarkdownViewMode = "edit" | "preview" | "split";

function resolveContentLanguage(agent: AgentItem): string {
  return agent.format === "yaml" ? "yaml" : "markdown";
}

export function AgentDetail({ agent, onBack }: AgentDetailProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const runtimeLabel =
    agent.runtime === "claude" ? t("automation.runtime.claude") : t("automation.runtime.codex");
  const isMarkdownAgent = agent.format === "markdown";
  const [viewMode, setViewMode] = useState<MarkdownViewMode>("split");
  const [tab, setTab] = useState<"content" | "prompt">(
    agent.defaultPrompt ? "prompt" : "content"
  );
  const promptContent = useMemo(() => agent.defaultPrompt ?? "", [agent.defaultPrompt]);
  const deferredContent = useDeferredValue(agent.content);
  const markdownPreview = (
    <div className="prose prose-sm dark:prose-invert max-w-none overflow-auto p-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredContent}</ReactMarkdown>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onBack}
          className="mr-2 shrink-0 border-border-subtle bg-card text-foreground shadow-sm hover:border-primary/30 hover:bg-accent/40"
          aria-label="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold">/{agent.name}</span>
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
            <HugeiconsIcon icon={CommandLineIcon} className="mr-0.5 h-2.5 w-2.5" />
            {runtimeLabel}
          </Badge>
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
            {agent.format.toUpperCase()}
          </Badge>
          {agent.sourceName ? (
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
              {agent.sourceName}
            </Badge>
          ) : null}
        </div>

        {isMarkdownAgent ? (
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
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(value) => setTab(value as "content" | "prompt")}>
            <TabsList>
              <TabsTrigger value="content">{t("agents.tabs.content")}</TabsTrigger>
              <TabsTrigger value="prompt" disabled={!agent.defaultPrompt}>
                {t("agents.tabs.prompt")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
        {agent.description}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isMarkdownAgent ? (
          <>
            {viewMode === "edit" && (
              <CodeMirrorSourceEditor
                value={agent.content}
                valueVersion={0}
                isDark={isDark}
                language="markdown"
                readOnly
                className="h-full w-full"
              />
            )}
            {viewMode === "preview" && <div className="h-full overflow-auto">{markdownPreview}</div>}
            {viewMode === "split" && (
              <div className="flex h-full divide-x divide-border">
                <div className="min-w-0 flex-1">
                  <CodeMirrorSourceEditor
                    value={agent.content}
                    valueVersion={0}
                    isDark={isDark}
                    language="markdown"
                    readOnly
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1 overflow-auto">{markdownPreview}</div>
              </div>
            )}
          </>
        ) : (
          <Tabs value={tab} className="h-full">
            <TabsContent value="content" className="h-full">
              <CodeMirrorSourceEditor
                value={agent.content}
                valueVersion={0}
                isDark={isDark}
                language={resolveContentLanguage(agent)}
                readOnly
                className="h-full w-full"
              />
            </TabsContent>
            <TabsContent value="prompt" className="h-full">
              {agent.defaultPrompt ? (
                <CodeMirrorSourceEditor
                  value={promptContent}
                  valueVersion={0}
                  isDark={isDark}
                  language="markdown"
                  readOnly
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t("agents.noPrompt")}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{agent.filePath}</span>
      </div>
    </div>
  );
}

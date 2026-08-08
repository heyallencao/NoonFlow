"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Plug01Icon } from "@hugeicons/core-free-icons";
import { CodeMirrorSourceEditor } from "@/components/layout/CodeMirrorSourceEditor";
import { useTranslation } from "@/hooks/useTranslation";
import type { HookItem } from "./types";

interface HookDetailProps {
  hook: HookItem;
  onBack: () => void;
}

export function HookDetail({ hook, onBack }: HookDetailProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [tab, setTab] = useState<"config" | "scripts">(
    hook.scripts.length > 0 ? "scripts" : "config"
  );

  const configContent = useMemo(() => JSON.stringify(hook.content, null, 2), [hook.content]);
  const runtimeLabel =
    hook.runtime === "claude" ? t("automation.runtime.claude") : t("automation.runtime.codex");
  const [scriptTab, setScriptTab] = useState(hook.scripts[0]?.command ?? "none");
  const activeScript =
    hook.scripts.find((script) => script.command === scriptTab) ?? hook.scripts[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          className="mr-1 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold">/{hook.event}</span>
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
            <HugeiconsIcon icon={Plug01Icon} className="mr-0.5 h-2.5 w-2.5" />
            {runtimeLabel}
          </Badge>
          {hook.matcher ? (
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
              {hook.matcher}
            </Badge>
          ) : null}
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as "config" | "scripts")}>
          <TabsList>
            <TabsTrigger value="scripts">{t("hooks.tabs.scripts")}</TabsTrigger>
            <TabsTrigger value="config">{t("hooks.tabs.config")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
        {hook.description}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Tabs value={tab} className="h-full">
          <TabsContent value="scripts" className="h-full overflow-auto">
            <div className="flex h-full flex-col">
              {hook.scripts.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                  {t("hooks.noScripts")}
                </div>
              ) : (
                <>
                  <div className="border-b border-border px-4 py-2">
                    <Tabs value={scriptTab} onValueChange={setScriptTab}>
                      <TabsList>
                        {hook.scripts.map((script, index) => (
                          <TabsTrigger
                            key={`${hook.id}:script-tab:${index}`}
                            value={script.command}
                            className="max-w-52 truncate"
                          >
                            {t("hooks.script.command", { n: index + 1 })}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="border-b border-border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all text-xs text-muted-foreground">
                          {activeScript?.command}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground/80">
                          {activeScript?.scriptPath ?? t("hooks.script.unresolved")}
                        </p>
                      </div>
                      {activeScript?.scriptPath ? (
                        <Badge variant="outline" className="ml-3 shrink-0 text-[10px]">
                          {activeScript.exists ? t("hooks.script.loaded") : t("hooks.script.missing")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {activeScript?.content ? (
                    <CodeMirrorSourceEditor
                      value={activeScript.content}
                      valueVersion={0}
                      isDark={isDark}
                      language={activeScript.language}
                      readOnly
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 py-6 text-sm text-muted-foreground">
                      {activeScript?.error ?? t("hooks.script.noContent")}
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="config" className="h-full">
            <CodeMirrorSourceEditor
              value={configContent}
              valueVersion={0}
              isDark={isDark}
              language="json"
              readOnly
              className="h-full w-full"
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{hook.filePath}</span>
      </div>
    </div>
  );
}

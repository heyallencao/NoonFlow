"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryKeys } from '@/lib/queries/query-keys';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import { useAssistantRuntimesQuery } from '@/lib/queries/assistant-runtime-queries';
import { SETTING_KEYS, type AssistantRuntime } from '@/types';
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { CodeIcon, CpuIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function AssistantsSection() {
  const { t } = useTranslation();
  const appSettingsQuery = useAppSettingsQuery();
  const runtimesQuery = useAssistantRuntimesQuery();
  const queryClient = useQueryClient();

  const [defaultAssistantRuntime, setDefaultAssistantRuntime] = useState<AssistantRuntime>('claude_code');
  const [claudeEnabled, setClaudeEnabled] = useState(true);
  const [codexEnabled, setCodexEnabled] = useState(true);
  const [piEnabled, setPiEnabled] = useState(true);
  const [codexAuthToken, setCodexAuthToken] = useState('');
  const [codexBaseUrl, setCodexBaseUrl] = useState('');
  const [codexDefaultModel, setCodexDefaultModel] = useState('');
  const [codexExtraEnv, setCodexExtraEnv] = useState('{}');
  const [assistantSaving, setAssistantSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const appSettings = appSettingsQuery.data?.settings;
    if (!appSettings || initialized) return;

    const storedRuntime = appSettings[SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME];
    setDefaultAssistantRuntime(storedRuntime === 'codex' || storedRuntime === 'pi' ? storedRuntime : 'claude_code');
    setClaudeEnabled(appSettings[SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE] !== 'false');
    setCodexEnabled(appSettings[SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX] !== 'false');
    setPiEnabled(appSettings[SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_PI] !== 'false');
    setCodexAuthToken(appSettings[SETTING_KEYS.CODEX_AUTH_TOKEN] || '');
    setCodexBaseUrl(appSettings[SETTING_KEYS.CODEX_BASE_URL] || '');
    setCodexDefaultModel(appSettings[SETTING_KEYS.CODEX_DEFAULT_MODEL] || '');
    setCodexExtraEnv(appSettings[SETTING_KEYS.CODEX_EXTRA_ENV] || '{}');
    setInitialized(true);
  }, [appSettingsQuery.data, initialized]);

  const saveAssistantSettings = async () => {
    setAssistantSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            [SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME]: defaultAssistantRuntime,
            [SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE]: claudeEnabled ? 'true' : 'false',
            [SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX]: codexEnabled ? 'true' : 'false',
            [SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_PI]: piEnabled ? 'true' : 'false',
            [SETTING_KEYS.CODEX_AUTH_TOKEN]: codexAuthToken,
            [SETTING_KEYS.CODEX_BASE_URL]: codexBaseUrl,
            [SETTING_KEYS.CODEX_DEFAULT_MODEL]: codexDefaultModel,
            [SETTING_KEYS.CODEX_EXTRA_ENV]: codexExtraEnv,
          },
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to save assistant settings');
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.assistantRuntimes() });
    } finally {
      setAssistantSaving(false);
    }
  };

  const runtimeStatusById = new Map((runtimesQuery.data?.runtimes || []).map((runtime) => [runtime.id, runtime]));
  const claudeStatus = runtimeStatusById.get('claude_code');
  const codexStatus = runtimeStatusById.get('codex');
  const piStatus = runtimeStatusById.get('pi');

  return (
    <div className="space-y-12">
      {/* Runtimes Configuration */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary/80">Runtime Selection</h3>
            <Button size="sm" variant="default" onClick={saveAssistantSettings} disabled={assistantSaving || appSettingsQuery.isLoading} className="bg-primary hover:bg-primary/90 shadow-primary/30 shadow-md">
              {assistantSaving ? t('provider.saving') : 'Save Changes'}
            </Button>
          </div>

          <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <label className="text-[13px] font-semibold">
                Default Engine
              </label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">The primary agent used for new sessions.</p>
            </div>
            <div>
              <Select value={defaultAssistantRuntime} onValueChange={(value) => setDefaultAssistantRuntime(value as AssistantRuntime)}>
                <SelectTrigger className="w-full sm:max-w-xs h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude_code">Claude Code</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                  <SelectItem value="pi">Pi</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <label className="text-[13px] font-semibold">
                Active Assistants
              </label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Enable or disable specific engines.</p>
            </div>
            <div className="space-y-4 sm:max-w-md">
              <div className={cn(
                "flex items-center justify-between p-4 border-b transition-all rounded-lg",
                claudeEnabled ? "border-primary/30 bg-primary/5" : "border-border/50 opacity-50"
              )}>
                <div className="flex items-center gap-3">
                  <HugeiconsIcon icon={CodeIcon} className={cn("h-5 w-5", claudeEnabled && "text-primary")} />
                  <div>
                    <p className="text-[12px] font-semibold">Claude Code</p>
                    <p className={cn(
                      "text-xs mt-0.5 flex items-center gap-1.5",
                      claudeStatus?.available ? "text-success" : "text-warning"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", claudeStatus?.available ? "bg-success" : "bg-warning")} />
                      {claudeStatus?.status_message || (claudeStatus?.available ? 'Ready' : 'Unavailable')}
                    </p>
                  </div>
                </div>
                <Switch checked={claudeEnabled} onCheckedChange={setClaudeEnabled} />
              </div>

              <div className={cn(
                "flex items-center justify-between p-4 border-b transition-all rounded-lg",
                codexEnabled ? "border-info/30 bg-info/5" : "border-border/50 opacity-50"
              )}>
                <div className="flex items-center gap-3">
                  <HugeiconsIcon icon={CpuIcon} className={cn("h-5 w-5", codexEnabled && "text-info")} />
                  <div>
                    <p className="text-[12px] font-semibold">Codex</p>
                    <p className={cn(
                      "text-xs mt-0.5 flex items-center gap-1.5",
                      codexStatus?.available ? "text-success" : "text-warning"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", codexStatus?.available ? "bg-success" : "bg-warning")} />
                      {codexStatus?.status_message || (codexStatus?.available ? 'Ready' : 'Unavailable')}
                    </p>
                  </div>
                </div>
                <Switch checked={codexEnabled} onCheckedChange={setCodexEnabled} />
              </div>

              <div className={cn(
                "flex items-center justify-between p-4 border-b transition-all rounded-lg",
                piEnabled ? "border-violet-500/30 bg-violet-500/5" : "border-border/50 opacity-50"
              )}>
                <div className="flex items-center gap-3">
                  <HugeiconsIcon icon={CodeIcon} className={cn("h-5 w-5", piEnabled && "text-violet-500")} />
                  <div>
                    <p className="text-[12px] font-semibold">Pi</p>
                    <p className={cn("text-xs mt-0.5 flex items-center gap-1.5", piStatus?.available ? "text-success" : "text-warning")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", piStatus?.available ? "bg-success" : "bg-warning")} />
                      {piStatus?.status_message || (piStatus?.available ? 'Ready' : 'Unavailable')}
                    </p>
                  </div>
                </div>
                <Switch checked={piEnabled} onCheckedChange={setPiEnabled} />
              </div>
            </div>
          </div>
        </section>

        {/* Codex Configuration */}
        {codexEnabled && (
          <section className="space-y-6 p-6 bg-info/5 rounded-lg border border-info/20">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-info">Codex Credentials</h3>

            <div className="grid gap-8 md:grid-cols-[1fr_2fr] items-start">
              <div className="space-y-2">
                <label className="text-[13px] font-semibold">API Key</label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Your OpenAI or compatible provider key.</p>
              </div>
              <Input
                value={codexAuthToken}
                onChange={(event) => setCodexAuthToken(event.target.value)}
                placeholder="sk-..."
                type="password"
                className="font-mono text-sm max-w-md h-10"
              />
            </div>

            <div className="grid gap-8 md:grid-cols-[1fr_2fr] items-start">
              <div className="space-y-2">
                <label className="text-[13px] font-semibold">Base URL</label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">API endpoint for Codex requests.</p>
              </div>
              <Input
                value={codexBaseUrl}
                onChange={(event) => setCodexBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="font-mono text-sm max-w-md h-10"
              />
            </div>

            <div className="grid gap-8 md:grid-cols-[1fr_2fr] items-start">
              <div className="space-y-2">
                <label className="text-[13px] font-semibold">Default Model</label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Model name used by the Codex engine.</p>
              </div>
              <Input
                value={codexDefaultModel}
                onChange={(event) => setCodexDefaultModel(event.target.value)}
                placeholder="gpt-4o-mini"
                className="font-mono text-sm max-w-md h-10"
              />
            </div>

            <div className="grid gap-8 md:grid-cols-[1fr_2fr] items-start">
              <div className="space-y-2">
                <label className="text-[13px] font-semibold">Extra Environment</label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">JSON format extra variables.</p>
              </div>
              <Textarea
                value={codexExtraEnv}
                onChange={(event) => setCodexExtraEnv(event.target.value)}
                className="min-h-32 font-mono text-sm max-w-md resize-y"
                placeholder='{"OPENAI_ORG_ID":""}'
              />
            </div>
          </section>
        )}
    </div>
  );
}

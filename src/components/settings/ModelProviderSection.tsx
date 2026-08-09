"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CodeIcon,
  CpuIcon,
  Download04Icon,
  Loading02Icon,
  PencilEdit01Icon,
  RefreshIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/hooks/useTranslation";
import { CLAUDE_AUTH_MODE_KEY, CODEX_AUTH_MODE_KEY, type AssistantAuthMode } from "@/lib/assistant-auth";
import { publishProviderChanged } from "@/lib/events/app-event-bus";
import { parseContextWindowOverrides } from "@/lib/default-context-sizes";
import { useAssistantRuntimesQuery } from "@/lib/queries/assistant-runtime-queries";
import { usePiModelsQuery, useProviderModelsQuery } from "@/lib/queries/provider-queries";
import { queryKeys } from "@/lib/queries/query-keys";
import { useAppSettingsQuery } from "@/lib/queries/settings-queries";
import { cn } from "@/lib/utils";
import { SETTING_KEYS, type ApiProvider, type AssistantRuntime } from "@/types";
import { InstallWizard } from "../layout/InstallWizard";
import { PresetConnectDialog } from "./provider-manager/PresetConnectDialog";
import {
  GEMINI_IMAGE_MODELS,
  QUICK_PRESETS,
  getGeminiImageModel,
  getProviderIcon,
  reorderProviders,
  type QuickPreset,
} from "./provider-manager/constants";
import { ProviderForm } from "./ProviderForm";
import type { ProviderFormData } from "./ProviderForm";

type InstallerTarget = "claude" | "codex" | "pi";
type RuntimeCardKey = "claude" | "codex" | "pi";

interface InstallPrereqSnapshot {
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
}

interface FileSnapshot<T = unknown> {
  path: string;
  exists: boolean;
  content: T | null;
  error?: string;
}

interface EnvironmentResponse {
  runtimes: {
    claude: { binaryPath: string | null; version: string | null };
    codex: { binaryPath: string | null; version: string | null };
    pi: { binaryPath: string | null; version: string | null };
  };
  files: {
    claudeSettings: FileSnapshot;
    claudeLegacyConfig: FileSnapshot;
    claudeCredentials: FileSnapshot;
    claudeGlobalClaudeMd: FileSnapshot<string>;
    codexConfig: FileSnapshot<string>;
    codexAuth: FileSnapshot;
    codexGlobalAgentsMd: FileSnapshot<string>;
    piSettings: FileSnapshot;
    piAuth: FileSnapshot;
    piModels: FileSnapshot;
    piTrust: FileSnapshot;
    piGlobalAgentsMd: FileSnapshot<string>;
  };
}

function formatProviderTypeLabel(providerType: string) {
  return providerType.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeProviderEndpoint(provider: ApiProvider, isZh: boolean) {
  if (provider.base_url?.trim()) return provider.base_url.trim();
  if (provider.notes?.trim()) return provider.notes.trim();
  return isZh ? "使用默认地址" : "Uses default endpoint";
}

function resolveGeminiImageModelLabel(provider: ApiProvider) {
  const currentModel = getGeminiImageModel(provider);
  return GEMINI_IMAGE_MODELS.find((item) => item.value === currentModel)?.label || currentModel;
}

function isValidContextWindowOverrides(raw: string): boolean {
  const normalized = raw.trim();
  if (!normalized) {
    return true;
  }

  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    return Object.keys(parseContextWindowOverrides(normalized)).length === Object.keys(parsed).length;
  } catch {
    return false;
  }
}

function inferAuthMode(
  savedMode: string | undefined,
  ...values: Array<string | undefined>
): AssistantAuthMode {
  if (savedMode === "login" || savedMode === "api_key") {
    return savedMode;
  }
  return values.some((value) => Boolean(value?.trim())) ? "api_key" : "login";
}

// ─── Runtime Status Cards ──────────────────────────────────────────────────────

interface RuntimeCard {
  key: RuntimeCardKey;
  label: string;
  icon: typeof CodeIcon;
  version: string | null;
  installed: boolean;
  initialized: boolean;
  configured: boolean;
  available: boolean;
  enabled: boolean;
  statusMessage: string | null | undefined;
}


function RuntimeStatusSection({
  runtimeCards,
  nodeVersion,
  selectedRuntime,
  onSelectRuntime,
  hasNativeInstallBridge,
  onInstallClick,
  isZh,
}: {
  runtimeCards: RuntimeCard[];
  nodeVersion: string | undefined;
  selectedRuntime: RuntimeCardKey;
  onSelectRuntime: (key: RuntimeCardKey) => void;
  hasNativeInstallBridge: boolean;
  onInstallClick: (target: InstallerTarget) => void;
  isZh: boolean;
}) {
  return (
    <div className="space-y-2">
      {/* Node.js */}
      <div className="rounded-lg border border-border-subtle bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        Node.js:{" "}
        {nodeVersion
          ? `${isZh ? "已安装" : "Installed"} (${nodeVersion})`
          : isZh
            ? "未检测到"
            : "Not detected"}
      </div>

      {/* Claude / Codex */}
      {runtimeCards.map((runtime) => {
        const isSelected = selectedRuntime === runtime.key;
        return (
          <div
            key={runtime.key}
            role="button"
            tabIndex={0}
            onClick={() => onSelectRuntime(runtime.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectRuntime(runtime.key);
              }
            }}
            className={cn(
              "w-full rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer",
              isSelected
                ? "border-primary/30 bg-primary/5"
                : "border-border-subtle bg-background/60 hover:bg-muted/30",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-muted/50">
                  <HugeiconsIcon icon={runtime.icon} className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{runtime.label}</span>
                    {runtime.version && (
                      <span className="text-[11px] text-muted-foreground">{runtime.version}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[10px]",
                        runtime.enabled
                          ? "border-success/20 bg-success/10 text-success"
                          : "border-border-subtle bg-muted text-muted-foreground",
                      )}
                    >
                      {runtime.enabled
                        ? isZh
                          ? "已启用"
                          : "Enabled"
                        : isZh
                          ? "已禁用"
                          : "Disabled"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {runtime.configured
                        ? isZh
                          ? "凭据已就绪"
                          : "Configured"
                        : isZh
                          ? "待配置"
                          : "Needs setup"}
                    </span>
                  </div>
                </div>
              </div>
              {hasNativeInstallBridge && (!runtime.installed || !runtime.initialized) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInstallClick(runtime.key as InstallerTarget);
                  }}
                  className="h-6 text-[10px] gap-1 px-2"
                >
                  <HugeiconsIcon
                    icon={runtime.installed ? Tick01Icon : Download04Icon}
                    className="h-3 w-3"
                  />
                  {runtime.installed
                    ? isZh
                      ? `初始化 ${runtime.label}`
                      : `Init ${runtime.label}`
                    : isZh
                      ? `安装 ${runtime.label}`
                      : `Install ${runtime.label}`}
                </Button>
              )}
            </div>
          </div>
        );
      })}


    </div>
  );
}

// workaround: declare the type inline to avoid circular import issues
function runtimeCardsInner(
  prereq: InstallPrereqSnapshot | null,
  environment: EnvironmentResponse | null,
  claudeStatus: { configured: boolean; available: boolean; status_message?: string } | undefined,
  codexStatus: { configured: boolean; available: boolean; status_message?: string } | undefined,
  piStatus: { configured: boolean; launchable: boolean; available: boolean; installed: boolean; version?: string; status_message?: string } | undefined,
  claudeEnabled: boolean,
  codexEnabled: boolean,
  piEnabled: boolean,
) {
  return [
    {
      key: "claude" as const,
      label: "Claude Code",
      icon: CodeIcon,
      version: prereq?.claudeVersion ?? environment?.runtimes.claude.version ?? null,
      installed: prereq?.hasClaude ?? Boolean(environment?.runtimes.claude.binaryPath),
      initialized: prereq?.claudeInitialized ?? Boolean(claudeStatus?.configured),
      configured: claudeStatus?.configured ?? false,
      available: claudeStatus?.available ?? false,
      enabled: claudeEnabled,
      statusMessage: claudeStatus?.status_message,
    },
    {
      key: "codex" as const,
      label: "Codex",
      icon: CpuIcon,
      version: prereq?.codexVersion ?? environment?.runtimes.codex.version ?? null,
      installed: prereq?.hasCodex ?? Boolean(environment?.runtimes.codex.binaryPath),
      initialized: prereq?.codexInitialized ?? Boolean(codexStatus?.configured),
      configured: codexStatus?.configured ?? false,
      available: codexStatus?.available ?? false,
      enabled: codexEnabled,
      statusMessage: codexStatus?.status_message,
    },
    {
      key: "pi" as const,
      label: "Pi",
      icon: CodeIcon,
      version: prereq?.piVersion ?? environment?.runtimes.pi.version ?? piStatus?.version ?? null,
      installed: prereq?.hasPi ?? Boolean(environment?.runtimes.pi.binaryPath),
      initialized: prereq?.piInitialized ?? Boolean(piStatus?.configured),
      configured: piStatus?.configured ?? false,
      available: piStatus?.available ?? false,
      enabled: piEnabled,
      statusMessage: piStatus?.status_message,
    },
  ];
}

// ─── Main ModelProviderSection ────────────────────────────────────────────────

export type ModelProviderSectionMode = "providers" | "environment";

export function ModelProviderSection({ mode = "providers" }: { mode?: ModelProviderSectionMode }) {
  const queryClient = useQueryClient();
  const { locale } = useTranslation();
  const isZh = locale === "zh";

  const appSettingsQuery = useAppSettingsQuery();
  const runtimesQuery = useAssistantRuntimesQuery(mode === "environment");
  const providerModelsQuery = useProviderModelsQuery();
  const piModelsQuery = usePiModelsQuery(mode === "environment");

  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState("");
  const [envDetected, setEnvDetected] = useState<Record<string, string>>({});
  const [providersLoading, setProvidersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [environment, setEnvironment] = useState<EnvironmentResponse | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [prereq, setPrereq] = useState<InstallPrereqSnapshot | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);

  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeCardKey>("claude");
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);
  const [connectPreset, setConnectPreset] = useState<QuickPreset | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [draggedProviderId, setDraggedProviderId] = useState<string | null>(null);
  const [dragOverProviderId, setDragOverProviderId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [installWizardOpen, setInstallWizardOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState<InstallerTarget>("claude");

  const [defaultAssistantRuntime, setDefaultAssistantRuntime] = useState<AssistantRuntime>("claude_code");
  const [claudeEnabled, setClaudeEnabled] = useState(true);
  const [claudeAuthMode, setClaudeAuthMode] = useState<AssistantAuthMode>("login");
  const [claudeAuthToken, setClaudeAuthToken] = useState("");
  const [claudeBaseUrl, setClaudeBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [codexEnabled, setCodexEnabled] = useState(true);
  const [piEnabled, setPiEnabled] = useState(true);
  const [piDefaultModel, setPiDefaultModel] = useState("");
  const [codexAuthMode, setCodexAuthMode] = useState<AssistantAuthMode>("login");
  const [codexAuthToken, setCodexAuthToken] = useState("");
  const [codexBaseUrl, setCodexBaseUrl] = useState("");
  const [codexDefaultModel, setCodexDefaultModel] = useState("");
  const [codexExtraEnv, setCodexExtraEnv] = useState("{}");
  const [contextWindowOverrides, setContextWindowOverrides] = useState("{}");
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeFeedback, setRuntimeFeedback] = useState<{
    state: "idle" | "saving" | "success" | "error";
    message: string;
  }>({ state: "idle", message: "" });

  const hasNativeInstallBridge = typeof window !== "undefined" && !!window.electronAPI?.install;

  const fetchProviders = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error(isZh ? "加载提供商失败" : "Failed to load providers");
      const data = (await res.json()) as {
        providers?: ApiProvider[];
        env_detected?: Record<string, string>;
        default_provider_id?: string;
      };
      setProviders(data.providers || []);
      setEnvDetected(data.env_detected || {});
      setDefaultProviderId(data.default_provider_id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : isZh ? "加载提供商失败" : "Failed to load providers");
    } finally {
      setProvidersLoading(false);
    }
  }, [isZh]);

  const fetchInstallPrereqs = useCallback(async () => {
    if (!window.electronAPI?.install) return;
    try {
      const data = await window.electronAPI.install.checkPrerequisites();
      setPrereq({
        hasNode: data.hasNode,
        nodeVersion: data.nodeVersion,
        hasClaude: data.hasClaude,
        claudeVersion: data.claudeVersion,
        hasCodex: data.hasCodex,
        codexVersion: data.codexVersion,
        hasPi: data.hasPi,
        piVersion: data.piVersion,
        claudeInitialized: data.claudeInitialized,
        codexInitialized: data.codexInitialized,
        piInitialized: data.piInitialized,
        nodeSupportsPi: data.nodeSupportsPi,
      });
    } catch {
      // best effort
    }
  }, []);

  const refreshEnvironment = useCallback(async () => {
    setEnvironmentLoading(true);
    setEnvironmentError(null);
    try {
      const [envData] = await Promise.all([
        fetch("/api/environment").then(async (res) => {
          if (!res.ok) throw new Error(isZh ? "加载环境信息失败" : "Failed to load environment info");
          return res.json() as Promise<EnvironmentResponse>;
        }),
        hasNativeInstallBridge ? fetchInstallPrereqs() : Promise.resolve(),
      ]);
      setEnvironment(envData);
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : isZh ? "加载环境信息失败" : "Failed to load environment info");
    } finally {
      setEnvironmentLoading(false);
    }
  }, [fetchInstallPrereqs, hasNativeInstallBridge, isZh]);

  useEffect(() => { void fetchProviders(); }, [fetchProviders]);
  useEffect(() => { if (mode === "environment") void refreshEnvironment(); }, [mode, refreshEnvironment]);

  useEffect(() => {
    const appSettings = appSettingsQuery.data?.settings;
    if (!appSettings) return;
    const storedRuntime = appSettings[SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME];
    setDefaultAssistantRuntime(storedRuntime === "codex" || storedRuntime === "pi" ? storedRuntime : "claude_code");
    setClaudeEnabled(appSettings[SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE] !== "false");
    setClaudeAuthMode(
      inferAuthMode(
        appSettings[CLAUDE_AUTH_MODE_KEY],
        appSettings.anthropic_auth_token,
        appSettings.anthropic_base_url,
      ),
    );
    setClaudeAuthToken(appSettings.anthropic_auth_token || "");
    setClaudeBaseUrl(appSettings.anthropic_base_url || "");
    setDefaultModel(appSettings[SETTING_KEYS.DEFAULT_MODEL] || "");
    setCodexEnabled(appSettings[SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX] !== "false");
    setPiEnabled(appSettings[SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_PI] !== "false");
    setPiDefaultModel(appSettings[SETTING_KEYS.PI_DEFAULT_MODEL] || "");
    setCodexAuthMode(
      inferAuthMode(
        appSettings[CODEX_AUTH_MODE_KEY],
        appSettings[SETTING_KEYS.CODEX_AUTH_TOKEN],
        appSettings[SETTING_KEYS.CODEX_BASE_URL],
      ),
    );
    setCodexAuthToken(appSettings[SETTING_KEYS.CODEX_AUTH_TOKEN] || "");
    setCodexBaseUrl(appSettings[SETTING_KEYS.CODEX_BASE_URL] || "");
    setCodexDefaultModel(appSettings[SETTING_KEYS.CODEX_DEFAULT_MODEL] || "");
    setCodexExtraEnv(appSettings[SETTING_KEYS.CODEX_EXTRA_ENV] || "{}");
    setContextWindowOverrides(appSettings[SETTING_KEYS.CONTEXT_WINDOW_OVERRIDES] || "{}");
  }, [appSettingsQuery.data]);

  useEffect(() => {
    if (runtimeFeedback.state !== "success") return;
    const timer = window.setTimeout(() => {
      setRuntimeFeedback((current) => (current.state === "success" ? { state: "idle", message: "" } : current));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [runtimeFeedback.state]);

  useEffect(() => {
    if (!piDefaultModel && piModelsQuery.data?.default_model) {
      setPiDefaultModel(piModelsQuery.data.default_model);
    }
  }, [piDefaultModel, piModelsQuery.data?.default_model]);

  const sortedProviders = useMemo(
    () => [...providers].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    [providers],
  );

  const providerModelMap = useMemo(() => {
    const map = new Map<string, Array<{ value: string; label: string }>>();
    for (const group of providerModelsQuery.data?.groups || []) {
      map.set(group.provider_id, group.models);
    }
    return map;
  }, [providerModelsQuery.data?.groups]);

  const allSuggestedModels = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const group of providerModelsQuery.data?.groups || []) {
      for (const model of group.models) {
        if (!map.has(model.value)) map.set(model.value, model);
      }
    }
    return Array.from(map.values());
  }, [providerModelsQuery.data?.groups]);

  const envKeyEntries = Object.entries(envDetected);
  const claudeStatus = runtimesQuery.data?.runtimes.find((r) => r.id === "claude_code");
  const codexStatus = runtimesQuery.data?.runtimes.find((r) => r.id === "codex");
  const piStatus = runtimesQuery.data?.runtimes.find((r) => r.id === "pi");

  const runtimeCards = useMemo(
    () =>
      runtimeCardsInner(
        prereq,
        environment,
        claudeStatus,
        codexStatus,
        piStatus,
        claudeEnabled,
        codexEnabled,
        piEnabled,
      ),
    [prereq, environment, claudeStatus, codexStatus, piStatus, claudeEnabled, codexEnabled, piEnabled],
  );
  const claudeLoginDetected = Boolean(
    environment?.files.claudeCredentials.exists
      || environment?.files.claudeSettings.exists
      || environment?.files.claudeLegacyConfig.exists,
  );
  const codexLoginDetected = Boolean(environment?.files.codexAuth.exists);

  const nonMediaPresets = QUICK_PRESETS.filter((preset) => preset.category !== "media");
  const domesticPresetKeys = new Set([
    "glm-cn",
    "glm-global",
    "kimi",
    "moonshot",
    "minimax-cn",
    "minimax-global",
    "volcengine",
    "bailian",
    "deepseek",
    "siliconflow",
    "stepfun",
    "qianfan",
  ]);
  const domesticPresets = nonMediaPresets.filter((preset) => domesticPresetKeys.has(preset.key));
  const globalPresets = nonMediaPresets.filter((preset) => !domesticPresetKeys.has(preset.key));
  const visibleError = error || (mode === "environment" ? environmentError : null);
  const enabledRuntimeCount = [claudeEnabled, codexEnabled, piEnabled].filter(Boolean).length;
  const piRuntimeCard = runtimeCards.find((card) => card.key === "pi");

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchProviders(),
      mode === "environment" ? refreshEnvironment() : Promise.resolve(),
      appSettingsQuery.refetch(),
      runtimesQuery.refetch(),
      providerModelsQuery.refetch(),
      piModelsQuery.refetch(),
    ]);
  }, [appSettingsQuery, fetchProviders, mode, piModelsQuery, providerModelsQuery, refreshEnvironment, runtimesQuery]);

  const handleEditSave = useCallback(
    async (data: ProviderFormData) => {
      if (!editingProvider) return;
      const res = await fetch(`/api/providers/${editingProvider.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || (isZh ? "更新提供商失败" : "Failed to update provider"));
      }
      await refreshAll();
      publishProviderChanged();
    },
    [editingProvider, isZh, refreshAll],
  );

  const handlePresetAdd = useCallback(
    async (data: ProviderFormData) => {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || (isZh ? "添加提供商失败" : "Failed to create provider"));
      }
      await refreshAll();
      publishProviderChanged();
    },
    [isZh, refreshAll],
  );

  const handleDelete = useCallback(
    async (provider: ApiProvider) => {
      setDeletingId(provider.id);
      try {
        const res = await fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || (isZh ? "删除提供商失败" : "Failed to delete provider"));
        }
        setDeleteTarget(null);
        await refreshAll();
        publishProviderChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : isZh ? "删除提供商失败" : "Failed to delete provider");
      } finally {
        setDeletingId(null);
      }
    },
    [isZh, refreshAll],
  );

  const handleReorder = useCallback(
    async (draggedId: string, targetId: string) => {
      const reordered = reorderProviders(sortedProviders, draggedId, targetId);
      if (reordered === sortedProviders) return;
      setProviders(reordered);
      setReordering(true);
      setError(null);
      try {
        await Promise.all(
          reordered.map((provider, index) =>
            fetch(`/api/providers/${provider.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sort_order: index }),
            }).then(async (res) => {
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || (isZh ? "调整顺序失败" : "Failed to reorder providers"));
              }
            }),
          ),
        );
        publishProviderChanged();
        await queryClient.invalidateQueries({ queryKey: queryKeys.providers() });
      } catch (err) {
        setError(err instanceof Error ? err.message : isZh ? "调整顺序失败" : "Failed to reorder providers");
        await fetchProviders();
      } finally {
        setReordering(false);
      }
    },
    [fetchProviders, isZh, queryClient, sortedProviders],
  );

  const saveRuntimeSettings = useCallback(async () => {
    try {
      JSON.parse(codexExtraEnv || "{}");
    } catch {
      setSelectedRuntime("codex");
      setRuntimeFeedback({
        state: "error",
        message: isZh ? "Codex 额外环境变量必须是合法 JSON。" : "Codex extra environment must be valid JSON.",
      });
      return;
    }

    if (!isValidContextWindowOverrides(contextWindowOverrides || "{}")) {
      setSelectedRuntime("claude");
      setRuntimeFeedback({
        state: "error",
        message: isZh
          ? "上下文窗口覆盖必须是合法 JSON，且每个值都要是大于 0 的数字。"
          : "Context window overrides must be valid JSON with positive numeric values.",
      });
      return;
    }

    setRuntimeSaving(true);
    setRuntimeFeedback({ state: "saving", message: isZh ? "正在保存..." : "Saving..." });
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            [CLAUDE_AUTH_MODE_KEY]: claudeAuthMode,
            anthropic_auth_token: claudeAuthMode === "api_key" ? claudeAuthToken : "",
            anthropic_base_url: claudeAuthMode === "api_key" ? claudeBaseUrl : "",
            [SETTING_KEYS.DEFAULT_MODEL]: defaultModel,
            [SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME]: defaultAssistantRuntime,
            [SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE]: claudeEnabled ? "true" : "false",
            [SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX]: codexEnabled ? "true" : "false",
            [SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_PI]: piEnabled ? "true" : "false",
            [SETTING_KEYS.PI_DEFAULT_MODEL]: piDefaultModel,
            [CODEX_AUTH_MODE_KEY]: codexAuthMode,
            [SETTING_KEYS.CODEX_AUTH_TOKEN]: codexAuthMode === "api_key" ? codexAuthToken : "",
            [SETTING_KEYS.CODEX_BASE_URL]: codexAuthMode === "api_key" ? codexBaseUrl : "",
            [SETTING_KEYS.CODEX_DEFAULT_MODEL]: codexDefaultModel,
            [SETTING_KEYS.CODEX_EXTRA_ENV]: codexExtraEnv,
            [SETTING_KEYS.CONTEXT_WINDOW_OVERRIDES]: contextWindowOverrides,
          },
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || (isZh ? "保存失败" : "Failed to save"));
      }
      setRuntimeFeedback({ state: "success", message: isZh ? "已保存。" : "Saved." });
      await Promise.all([appSettingsQuery.refetch(), runtimesQuery.refetch(), providerModelsQuery.refetch(), piModelsQuery.refetch()]);
    } catch (err) {
      setRuntimeFeedback({
        state: "error",
        message: err instanceof Error ? err.message : isZh ? "保存失败" : "Failed to save",
      });
    } finally {
      setRuntimeSaving(false);
    }
  }, [
    appSettingsQuery,
    claudeAuthMode,
    claudeAuthToken,
    claudeBaseUrl,
    claudeEnabled,
    codexAuthMode,
    codexAuthToken,
    codexBaseUrl,
    codexDefaultModel,
    codexEnabled,
    codexExtraEnv,
    piEnabled,
    piDefaultModel,
    defaultAssistantRuntime,
    defaultModel,
    contextWindowOverrides,
    isZh,
    providerModelsQuery,
    piModelsQuery,
    runtimesQuery,
  ]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const renderPresetCard = (preset: QuickPreset) => (
    <button
      key={preset.key}
      type="button"
      onClick={() => {
        setConnectPreset(preset);
        setConnectDialogOpen(true);
      }}
      className="rounded-xl border border-border-subtle bg-background/60 px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-background"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-muted/50">
          {preset.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{preset.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {isZh ? preset.descriptionZh : preset.description}
          </p>
        </div>
      </div>
    </button>
  );

  return (
    <div className="space-y-12">
      {/* ══ ERRORS ══ */}
      {visibleError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {visibleError}
        </div>
      )}

      {/* ══ OPERATION ZONE ══ */}
      <div className="space-y-6">
        {mode === "environment" ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full text-xs">
              {isZh ? `默认引擎 ${defaultAssistantRuntime === "codex" ? "Codex" : defaultAssistantRuntime === "pi" ? "Pi" : "Claude"}` : `Default ${defaultAssistantRuntime === "codex" ? "Codex" : defaultAssistantRuntime === "pi" ? "Pi" : "Claude"}`}
            </Badge>
            <Badge variant="outline" className="rounded-full text-xs">
              {isZh ? `已启用运行时 ${enabledRuntimeCount}/3` : `${enabledRuntimeCount}/3 runtimes enabled`}
            </Badge>
            <Badge variant="outline" className="rounded-full text-xs">
              {isZh ? `候选模型 ${allSuggestedModels.length}` : `${allSuggestedModels.length} suggested models`}
            </Badge>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full text-xs">
              {isZh ? `已连接 ${providers.length}` : `${providers.length} connected`}
            </Badge>
            <Badge variant="outline" className="rounded-full text-xs">
              {isZh ? `国内预设 ${domesticPresets.length}` : `${domesticPresets.length} CN presets`}
            </Badge>
            <Badge variant="outline" className="rounded-full text-xs">
              {isZh ? `可用模型 ${allSuggestedModels.length}` : `${allSuggestedModels.length} models`}
            </Badge>
          </div>
        )}

        {mode === "environment" && (
        <div className="space-y-5 rounded-2xl border border-border-subtle bg-bg-secondary/20 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {isZh ? "环境初始化" : "Environment Init"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isZh
                  ? "首次打开时先准备好 Claude Code、Codex 或 Pi，其他细节先不展开。"
                  : "Set up Claude Code, Codex, or Pi first."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshEnvironment()}
              disabled={environmentLoading}
              className="h-7 text-xs gap-1"
            >
              <HugeiconsIcon
                icon={environmentLoading ? Loading02Icon : RefreshIcon}
                className={cn("h-3 w-3", environmentLoading && "animate-spin")}
              />
              {isZh ? "刷新检测" : "Refresh"}
            </Button>
          </div>

          <RuntimeStatusSection
            runtimeCards={runtimeCards}
            nodeVersion={prereq?.nodeVersion}
            selectedRuntime={selectedRuntime}
            onSelectRuntime={setSelectedRuntime}
            hasNativeInstallBridge={hasNativeInstallBridge}
            onInstallClick={(target) => {
              setInstallTarget(target);
              setInstallWizardOpen(true);
            }}
            isZh={isZh}
          />

          <div className="rounded-xl border border-border-subtle bg-background/60 px-4 py-3 text-[11px] text-muted-foreground">
            {isZh
              ? "Claude 和 Codex 保留应用内认证切换；Pi 沿用 ~/.pi/agent/auth.json 或受支持的环境变量。"
              : "Claude and Codex keep in-app auth controls; Pi uses ~/.pi/agent/auth.json or supported environment variables."}
          </div>

          <div className="rounded-xl border border-border-subtle bg-background/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Claude Code</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {isZh
                    ? "优先使用本机 Claude 环境，可在 CLI 登录和 API Token 之间切换。"
                    : "Use the local Claude environment and switch between CLI login and API token mode."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {runtimeFeedback.state !== "idle" && (
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs",
                      runtimeFeedback.state === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                      runtimeFeedback.state === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                      runtimeFeedback.state === "saving" && "border-border-subtle bg-background text-muted-foreground",
                    )}
                  >
                    {runtimeFeedback.message}
                  </span>
                )}
                <Switch checked={claudeEnabled} onCheckedChange={setClaudeEnabled} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {isZh ? "认证方式" : "Authentication"}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setClaudeAuthMode("login")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    claudeAuthMode === "login"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {isZh ? "CLI 登录" : "CLI login"}
                </button>
                <button
                  type="button"
                  onClick={() => setClaudeAuthMode("api_key")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    claudeAuthMode === "api_key"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {isZh ? "API Token" : "API token"}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {claudeAuthMode === "login"
                  ? (
                      claudeLoginDetected
                        ? (isZh
                            ? "已检测到本机 Claude 登录态。保存后将忽略这里之前填过的 token 和 base URL。"
                            : "Local Claude login detected. Saving will ignore any token/base URL previously entered here.")
                        : (isZh
                            ? "未检测到本机 Claude 登录态，请先运行 `claude login`。"
                            : "No local Claude login detected yet. Run `claude login` first.")
                    )
                  : (isZh
                      ? "API Token 模式下，Base URL 为可选；如果之后想切回登录态，切回 CLI 登录并保存即可。"
                      : "In API token mode, Base URL is optional. To switch back later, pick CLI login and save.")}
              </p>
            </div>

            {claudeAuthMode === "api_key" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {isZh ? "授权令牌" : "Token"}
                  </label>
                  <Input
                    type="password"
                    value={claudeAuthToken}
                    onChange={(e) => setClaudeAuthToken(e.target.value)}
                    placeholder="sk-ant-..."
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {isZh ? "Base URL（可选）" : "Base URL (optional)"}
                  </label>
                  <Input
                    value={claudeBaseUrl}
                    onChange={(e) => setClaudeBaseUrl(e.target.value)}
                    placeholder="https://api.anthropic.com"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {isZh ? "默认模型" : "Default model"}
                </label>
                <Input
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  placeholder="sonnet"
                  className="h-8 text-xs"
                />
              </div>
              <Button onClick={() => void saveRuntimeSettings()} disabled={runtimeSaving} size="sm" className="h-8 text-xs gap-1">
                {runtimeSaving && <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />}
                {isZh ? "保存运行时" : "Save runtime"}
              </Button>
            </div>

            {allSuggestedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allSuggestedModels.map((model) => (
                  <button
                    key={`claude-${model.value}`}
                    type="button"
                    onClick={() => setDefaultModel(model.value)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      defaultModel === model.value
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {isZh ? "上下文窗口大小覆盖" : "Context Window Overrides"}
              </label>
              <Textarea
                value={contextWindowOverrides}
                onChange={(e) => setContextWindowOverrides(e.target.value)}
                placeholder='{"sonnet": 200000, "haiku": 100000}'
                rows={2}
                className="text-xs resize-none font-mono"
              />
            </div>
          </div>

          <div className="rounded-xl border border-border-subtle bg-background/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Codex</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {isZh
                    ? "本机 Codex 环境和额外 env 集中放在这里，默认引擎也一并设置。"
                    : "Keep local Codex auth, extra env, and the default engine together here."}
                </p>
              </div>
              <Switch checked={codexEnabled} onCheckedChange={setCodexEnabled} />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {isZh ? "默认引擎" : "Default runtime"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDefaultAssistantRuntime("claude_code")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    defaultAssistantRuntime === "claude_code"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  Claude
                </button>
                <button
                  type="button"
                  onClick={() => setDefaultAssistantRuntime("codex")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    defaultAssistantRuntime === "codex"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  Codex
                </button>
                <button
                  type="button"
                  onClick={() => setDefaultAssistantRuntime("pi")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    defaultAssistantRuntime === "pi"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  Pi
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {isZh ? "认证方式" : "Authentication"}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCodexAuthMode("login")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    codexAuthMode === "login"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {isZh ? "CLI 登录" : "CLI login"}
                </button>
                <button
                  type="button"
                  onClick={() => setCodexAuthMode("api_key")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    codexAuthMode === "api_key"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {isZh ? "API Key" : "API key"}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {codexAuthMode === "login"
                  ? (
                      codexLoginDetected
                        ? (isZh
                            ? "已检测到 ~/.codex/auth.json。保存后将优先走 CLI 登录态。"
                            : "Detected ~/.codex/auth.json. Saving will prefer the CLI login.")
                        : (isZh
                            ? "未检测到 Codex 登录态，请先运行 `codex login`。"
                            : "No Codex login detected yet. Run `codex login` first.")
                    )
                  : (isZh
                      ? "API Key 模式下，Base URL 为可选。"
                      : "Base URL is optional in API key mode.")}
              </p>
            </div>

            {codexAuthMode === "api_key" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">API Key</label>
                  <Input
                    type="password"
                    value={codexAuthToken}
                    onChange={(e) => setCodexAuthToken(e.target.value)}
                    placeholder="sk-..."
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {isZh ? "Base URL（可选）" : "Base URL (optional)"}
                  </label>
                  <Input
                    value={codexBaseUrl}
                    onChange={(e) => setCodexBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {isZh ? "默认模型" : "Default model"}
                </label>
                <Input
                  value={codexDefaultModel}
                  onChange={(e) => setCodexDefaultModel(e.target.value)}
                  placeholder="gpt-5-codex"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {isZh ? "额外环境变量" : "Extra env"}
                </label>
                <Textarea
                  value={codexExtraEnv}
                  onChange={(e) => setCodexExtraEnv(e.target.value)}
                  placeholder='{"OPENAI_ORG_ID":""}'
                  className="min-h-20 text-xs"
                />
              </div>
            </div>
          </div>

        <div className="rounded-xl border border-border-subtle bg-background/60 p-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={CodeIcon} className="h-4 w-4 text-violet-500" />
                  <p className="text-sm font-semibold text-foreground">Pi</p>
                  <Badge variant="outline" className="rounded-full text-[10px]">
                    {piRuntimeCard?.available
                      ? (isZh ? "可用" : "Ready")
                      : piRuntimeCard?.statusMessage || (isZh ? "未检测" : "Not detected")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isZh
                    ? "使用 Pi 原生 RPC、模型目录和会话文件；NoonFlow 可保存 provider/model 默认值。"
                    : "Uses Pi's native RPC, model catalog, and session files; NoonFlow can save a provider/model default."}
                </p>
              </div>
              <Switch checked={piEnabled} onCheckedChange={setPiEnabled} />
            </div>

            <div className="rounded-xl border border-border-subtle bg-background/70 p-3 text-[11px] text-muted-foreground">
              <p>
                {isZh ? "安装：" : "Install: "}
                <code className="select-all text-foreground">npm install -g --ignore-scripts @earendil-works/pi-coding-agent</code>
              </p>
              <p className="mt-1">
                {isZh
                  ? "安装后运行 `pi`，再用 `/login` 配置认证；也可使用 Pi 支持的 API Key 环境变量。"
                  : "After installation, run `pi`, then use `/login` to configure authentication; Pi-supported API-key environment variables also work."}
              </p>
              <p className="mt-1">
                {isZh
                  ? "项目内扩展、Skills 和 AGENTS.md 仅在 Pi 已信任该项目时加载；写文件和 shell 工具受 NoonFlow 的危险权限开关控制。"
                  : "Project extensions, skills, and AGENTS.md load only after Pi trusts the project; write and shell tools follow NoonFlow's dangerous-permissions toggle."}
              </p>
            </div>

            {hasNativeInstallBridge && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setInstallTarget("pi");
                    setInstallWizardOpen(true);
                  }}
                  className="h-8 text-xs"
                >
                  <HugeiconsIcon icon={piRuntimeCard?.installed ? RefreshIcon : Download04Icon} className="h-3 w-3" />
                  {piRuntimeCard?.installed
                    ? (isZh ? "初始化或更新 Pi" : "Initialize or update Pi")
                    : (isZh ? "安装 Pi" : "Install Pi")}
                </Button>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {isZh ? "默认模型（provider/model）" : "Default model (provider/model)"}
              </label>
              <select
                value={piDefaultModel}
                onChange={(event) => setPiDefaultModel(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="">{isZh ? "跟随 Pi 原生设置" : "Use Pi native setting"}</option>
                {piModelsQuery.data?.models.map((model) => (
                  <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                    {model.provider}/{model.id}{model.reasoning ? " · reasoning" : ""}{model.images ? " · images" : ""}
                  </option>
                ))}
              </select>
              {piModelsQuery.data?.error && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{piModelsQuery.data.error}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                {defaultAssistantRuntime === "pi"
                  ? (isZh ? "当前默认运行时" : "Current default runtime")
                  : (isZh ? "新建会话时可直接选择 Pi" : "Pi can be selected directly when creating a session")}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDefaultAssistantRuntime("pi")}
                  className="h-8 rounded-full text-xs"
                >
                  {isZh ? "设为默认" : "Set as default"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void saveRuntimeSettings()}
                  disabled={runtimeSaving}
                  className="h-8 rounded-full text-xs"
                >
                  {isZh ? "保存运行时" : "Save runtime"}
                </Button>
              </div>
            </div>
          </div>
        </div>
        </div>
        )}

        {mode === "providers" && (
        <>
        {/* Quick Connect */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {isZh ? "快速连接" : "Quick Connect"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchProviders()}
              disabled={providersLoading}
              className="h-7 text-xs gap-1"
            >
              <HugeiconsIcon
                icon={providersLoading ? Loading02Icon : RefreshIcon}
                className={cn("h-3 w-3", providersLoading && "animate-spin")}
              />
              {isZh ? "刷新" : "Refresh"}
            </Button>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {isZh ? "国内常用" : "China Providers"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isZh ? "把常见国内厂商和它们的常用模型直接摆出来。" : "Common mainland providers with their usual models."}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full text-xs">
                  {domesticPresets.length}
                </Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {domesticPresets.map(renderPresetCard)}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {isZh ? "国际与基础设施" : "Global & Infra"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isZh ? "官方 API、聚合入口和基础代理放在这里。" : "Official APIs, aggregators, and infra-oriented providers."}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full text-xs">
                  {globalPresets.length}
                </Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {globalPresets.map(renderPresetCard)}
              </div>
            </div>
          </div>

          {envKeyEntries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {envKeyEntries.map(([key, value]) => (
                <span
                  key={key}
                  className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
                >
                  {key}: {value}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Connected Providers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {isZh ? "已连接服务商" : "Connected Providers"}
            </p>
            <span className="text-[11px] text-muted-foreground">
              {isZh ? "拖动调整顺序" : "Drag to reorder"}
            </span>
          </div>

          {sortedProviders.length > 0 ? (
            <div className="space-y-2">
              {sortedProviders.map((provider, index) => {
                const providerModels =
                  provider.provider_type === "gemini-image"
                    ? [{ value: getGeminiImageModel(provider), label: resolveGeminiImageModelLabel(provider) }]
                    : providerModelMap.get(provider.id) || [];
                const isDefaultProvider = provider.id === defaultProviderId;

                return (
                  <div
                    key={provider.id}
                    className={cn(
                      "rounded-xl border px-4 py-3 transition-colors",
                      dragOverProviderId === provider.id
                        ? "border-primary/30 bg-primary/5"
                        : "border-border-subtle bg-background/60",
                      draggedProviderId === provider.id && "opacity-60",
                    )}
                    onDragOver={(event) => {
                      if (!draggedProviderId || draggedProviderId === provider.id) return;
                      event.preventDefault();
                      setDragOverProviderId(provider.id);
                    }}
                    onDrop={async (event) => {
                      event.preventDefault();
                      const sourceId = draggedProviderId || event.dataTransfer.getData("text/plain");
                      setDraggedProviderId(null);
                      setDragOverProviderId(null);
                      if (!sourceId || sourceId === provider.id) return;
                      await handleReorder(sourceId, provider.id);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          draggable={sortedProviders.length > 1 && !reordering}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", provider.id);
                            setDraggedProviderId(provider.id);
                          }}
                          onDragEnd={() => {
                            setDraggedProviderId(null);
                            setDragOverProviderId(null);
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-subtle text-muted-foreground hover:bg-muted/50"
                          title={isZh ? "拖动调整顺序" : "Drag to reorder"}
                        >
                          ⋮⋮
                        </button>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-muted/50">
                          {getProviderIcon(provider.name, provider.base_url)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{provider.name}</p>
                            <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              #{index + 1}
                            </span>
                            <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {formatProviderTypeLabel(provider.provider_type)}
                            </span>
                            {isDefaultProvider && (
                              <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                {isZh ? "默认" : "Default"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {summarizeProviderEndpoint(provider, isZh)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingProvider(provider);
                            setFormOpen(true);
                          }}
                          className="h-7 text-xs gap-1 px-2"
                        >
                          <HugeiconsIcon icon={PencilEdit01Icon} className="h-3 w-3" />
                          {isZh ? "编辑" : "Edit"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(provider)}
                          disabled={deletingId === provider.id}
                          className="h-7 text-xs text-destructive hover:text-destructive gap-1 px-2"
                        >
                          {deletingId === provider.id
                            ? isZh
                              ? "删除中..."
                              : "Removing..."
                            : isZh
                              ? "删除"
                              : "Remove"}
                        </Button>
                      </div>
                    </div>

                    {providerModels.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[52px]">
                        {providerModels.map((model) => (
                          <button
                            key={`${provider.id}-${model.value}`}
                            type="button"
                            onClick={() => {
                              if (provider.provider_type === "gemini-image") return;
                              setSelectedRuntime("claude");
                              setDefaultModel(model.value);
                            }}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                              defaultModel === model.value
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border-subtle bg-background text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {model.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-muted-foreground">
              {isZh ? "还没有服务商" : "No providers yet"}
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* ══ DIALOGS ══ */}
      <ProviderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="edit"
        provider={editingProvider}
        onSave={handleEditSave}
        initialPreset={null}
      />

      <PresetConnectDialog
        preset={connectPreset}
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
        onAdd={handlePresetAdd}
      />

      <InstallWizard
        open={installWizardOpen}
        onOpenChange={setInstallWizardOpen}
        target={installTarget}
        onInstallComplete={() => {
          void refreshEnvironment();
          void runtimesQuery.refetch();
        }}
      />

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-destructive">
                {isZh ? `确认删除 ${deleteTarget.name}？` : `Remove ${deleteTarget.name}?`}
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                {isZh ? "删除后，这个提供商会从当前列表中移除。" : "This removes the provider from the current list."}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                className="h-8 text-xs"
              >
                {isZh ? "取消" : "Cancel"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete(deleteTarget)}
                disabled={deletingId === deleteTarget.id}
                className="h-8 text-xs"
              >
                {deletingId === deleteTarget.id
                  ? isZh
                    ? "删除中..."
                    : "Removing..."
                  : isZh
                    ? "确认删除"
                    : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

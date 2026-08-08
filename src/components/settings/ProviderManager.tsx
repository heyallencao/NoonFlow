"use client";

import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  PencilEdit01Icon,
  ServerStack01Icon,
  Download04Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";

import type { ApiProvider } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import { publishProviderChanged } from '@/lib/events/app-event-bus';
import { InstallWizard } from "@/components/layout/InstallWizard";

import { ProviderForm } from "./ProviderForm";
import type { ProviderFormData } from "./ProviderForm";
import { PresetConnectDialog } from "./provider-manager/PresetConnectDialog";
import {
  GEMINI_IMAGE_MODELS,
  QUICK_PRESETS,
  getGeminiImageModel,
  getProviderIcon,
  reorderProviders,
  type QuickPreset,
} from "./provider-manager/constants";

type InstallerTarget = "claude" | "codex";

interface InstallPrereqSnapshot {
  hasNode: boolean;
  nodeVersion?: string;
  hasClaude: boolean;
  claudeVersion?: string;
  hasCodex: boolean;
  codexVersion?: string;
  claudeInitialized: boolean;
  codexInitialized: boolean;
}

export function ProviderManager() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [envDetected, setEnvDetected] = useState<Record<string, string>>({});
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  // Edit dialog state (reuse existing ProviderForm for full editing)
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);

  // Preset connect dialog state
  const [connectPreset, setConnectPreset] = useState<QuickPreset | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(QUICK_PRESETS[0]?.key ?? "");

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draggedProviderId, setDraggedProviderId] = useState<string | null>(null);
  const [dragOverProviderId, setDragOverProviderId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [installWizardOpen, setInstallWizardOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState<InstallerTarget>("claude");
  const [installPrereqs, setInstallPrereqs] = useState<InstallPrereqSnapshot | null>(null);

  const hasNativeInstallBridge =
    typeof window !== "undefined" && !!window.electronAPI?.install;

  const fetchProviders = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed to load providers");
      const data = await res.json();
      setProviders(data.providers || []);
      setEnvDetected(data.env_detected || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const fetchInstallPrereqs = useCallback(async () => {
    if (!window.electronAPI?.install) return;
    try {
      const data = await window.electronAPI.install.checkPrerequisites();
      setInstallPrereqs({
        hasNode: data.hasNode,
        nodeVersion: data.nodeVersion,
        hasClaude: data.hasClaude,
        claudeVersion: data.claudeVersion,
        hasCodex: data.hasCodex,
        codexVersion: data.codexVersion,
        claudeInitialized: data.claudeInitialized,
        codexInitialized: data.codexInitialized,
      });
    } catch {
      // ignore bridge errors, installation section is best-effort
    }
  }, []);

  useEffect(() => {
    if (!hasNativeInstallBridge) return;
    void fetchInstallPrereqs();
  }, [fetchInstallPrereqs, hasNativeInstallBridge]);

  const handleEdit = (provider: ApiProvider) => {
    setEditingProvider(provider);
    setFormOpen(true);
  };

  const handleEditSave = async (data: ProviderFormData) => {
    if (!editingProvider) return;
    const res = await fetch(`/api/providers/${editingProvider.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to update provider");
    }
    const result = await res.json();
    setProviders((prev) => prev.map((p) => (p.id === editingProvider.id ? result.provider : p)));
    publishProviderChanged();
  };

  const handlePresetAdd = async (data: ProviderFormData) => {
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to create provider");
    }
    const result = await res.json();
    setProviders((prev) => [...prev, result.provider]);
    publishProviderChanged();
  };

  const handleOpenPresetDialog = (preset: QuickPreset) => {
    setConnectPreset(preset);
    setConnectDialogOpen(true);
  };

  const selectedPreset = QUICK_PRESETS.find((preset) => preset.key === selectedPresetKey) ?? QUICK_PRESETS[0];
  const chatPresetOptions = QUICK_PRESETS.filter((preset) => preset.category !== "media");
  const mediaPresetOptions = QUICK_PRESETS.filter((preset) => preset.category === "media");

  const openInstaller = useCallback((targetRuntime: InstallerTarget) => {
    setInstallTarget(targetRuntime);
    setInstallWizardOpen(true);
  }, []);

  const handleDisconnect = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setProviders((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        publishProviderChanged();
      }
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleImageModelChange = useCallback(async (provider: ApiProvider, model: string) => {
    try {
      const env = JSON.parse(provider.extra_env || '{}');
      env.GEMINI_IMAGE_MODEL = model;
      const newExtraEnv = JSON.stringify(env);
      const res = await fetch(`/api/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key,
          extra_env: newExtraEnv,
          notes: provider.notes,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setProviders(prev => prev.map(p => p.id === provider.id ? result.provider : p));
        publishProviderChanged();
      }
    } catch { /* ignore */ }
  }, []);

  const handleReorder = useCallback(async (draggedId: string, targetId: string) => {
    const sortedProviders = [...providers].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    const reordered = reorderProviders(sortedProviders, draggedId, targetId);
    if (reordered === sortedProviders) {
      return;
    }

    setProviders(reordered);
    setReordering(true);
    setError(null);

    try {
      await Promise.all(
        reordered.map((provider, index) =>
          fetch(`/api/providers/${provider.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: index }),
          }).then(async (res) => {
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error || 'Failed to reorder providers');
            }
          })
        )
      );
      publishProviderChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder providers');
      await fetchProviders();
    } finally {
      setReordering(false);
    }
  }, [fetchProviders, providers]);

  const sorted = [...providers].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

  return (
    <div className="space-y-8">
      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      )}

      {/* ─── Section 1: Connected Providers ─── */}
      {!loading && (
        <div className="space-y-8 p-2">
          {hasNativeInstallBridge && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">
                  {isZh ? "运行时 CLI 安装" : "Runtime CLI Setup"}
                </h3>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {isZh
                    ? "提供 Claude / Codex 独立一键安装与初始化入口。"
                    : "Install and initialize Claude/Codex separately with one click."}
                </p>
              </div>

              <div className="rounded-xl bg-bg-secondary/25 p-2">
                <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    Node.js
                  </span>
                  <span className={installPrereqs?.hasNode ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                    {installPrereqs?.hasNode
                      ? `${isZh ? "已安装" : "Installed"} (${installPrereqs.nodeVersion || "-"})`
                      : (isZh ? "未安装" : "Not installed")}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-3 rounded-lg bg-background/75 px-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Claude Code CLI</p>
                    <p className="text-xs text-muted-foreground">
                      {installPrereqs?.hasClaude
                        ? `${isZh ? "已安装" : "Installed"} ${installPrereqs.claudeVersion || ""}`.trim()
                        : (isZh ? "未安装" : "Not installed")}
                      {" · "}
                      {installPrereqs?.claudeInitialized
                        ? (isZh ? "已初始化" : "Initialized")
                        : (isZh ? "未初始化" : "Not initialized")}
                    </p>
                  </div>
                  {installPrereqs?.hasClaude && installPrereqs?.claudeInitialized ? (
                    <Badge variant="default" className="shrink-0">
                      {isZh ? "已就绪" : "Ready"}
                    </Badge>
                  ) : (
                    <Button size="xs" variant="outline" className="shrink-0 gap-1" onClick={() => openInstaller("claude")}>
                      <HugeiconsIcon
                        icon={installPrereqs?.hasClaude ? Tick01Icon : Download04Icon}
                        className="h-3.5 w-3.5"
                      />
                      {installPrereqs?.hasClaude
                        ? (isZh ? "初始化 Claude" : "Initialize Claude")
                        : (isZh ? "安装 Claude" : "Install Claude")}
                    </Button>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-3 rounded-lg bg-background/75 px-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Codex CLI</p>
                    <p className="text-xs text-muted-foreground">
                      {installPrereqs?.hasCodex
                        ? `${isZh ? "已安装" : "Installed"} ${installPrereqs.codexVersion || ""}`.trim()
                        : (isZh ? "未安装" : "Not installed")}
                      {" · "}
                      {installPrereqs?.codexInitialized
                        ? (isZh ? "已初始化" : "Initialized")
                        : (isZh ? "未初始化" : "Not initialized")}
                    </p>
                  </div>
                  {installPrereqs?.hasCodex && installPrereqs?.codexInitialized ? (
                    <Badge variant="default" className="shrink-0">
                      {isZh ? "已就绪" : "Ready"}
                    </Badge>
                  ) : (
                    <Button size="xs" variant="outline" className="shrink-0 gap-1" onClick={() => openInstaller("codex")}>
                      <HugeiconsIcon
                        icon={installPrereqs?.hasCodex ? Tick01Icon : Download04Icon}
                        className="h-3.5 w-3.5"
                      />
                      {installPrereqs?.hasCodex
                        ? (isZh ? "初始化 Codex" : "Initialize Codex")
                        : (isZh ? "安装 Codex" : "Install Codex")}
                    </Button>
                  )}
                </div>
              </div>
            </section>
          )}

          <div className="mb-1">
            <h3 className="text-sm font-medium">{t('provider.connectedProviders')}</h3>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {isZh ? '拖拽已连接 provider 调整顺序，越靠前优先级越高。' : 'Drag connected providers to reorder them. Higher items have higher priority.'}
            </p>
          </div>

          {/* Claude Code default config */}
          <div className="mb-4 rounded-lg bg-background/65 px-2 py-3">
            <div className="flex items-center gap-3 py-2.5 px-1">
              <div className="shrink-0 w-[22px] flex justify-center">
                <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Claude Code</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {t('provider.default')}
                  </Badge>
                  {Object.keys(envDetected).length > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 dark:text-green-400 border-green-500/30">
                      ENV
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground ml-[34px] leading-relaxed">
              {t('provider.ccSwitchHint')}
            </p>
          </div>

          {/* Connected provider list */}
          {sorted.length > 0 ? (
            sorted.map((provider) => (
              <div
                key={provider.id}
                data-provider-id={provider.id}
                className={[
                  'mb-1 py-2.5 px-2 rounded-lg bg-background/65 transition-colors last:mb-0',
                  dragOverProviderId === provider.id ? 'bg-accent/40' : '',
                  draggedProviderId === provider.id ? 'opacity-60' : '',
                  reordering ? 'pointer-events-none' : '',
                ].filter(Boolean).join(' ')}
                onDragOver={(event) => {
                  if (!draggedProviderId || draggedProviderId === provider.id) return;
                  event.preventDefault();
                  setDragOverProviderId(provider.id);
                }}
                onDragEnter={() => {
                  if (!draggedProviderId || draggedProviderId === provider.id) return;
                  setDragOverProviderId(provider.id);
                }}
                onDrop={async (event) => {
                  event.preventDefault();
                  const sourceId = draggedProviderId || event.dataTransfer.getData('text/plain');
                  setDragOverProviderId(null);
                  setDraggedProviderId(null);
                  if (!sourceId || sourceId === provider.id) return;
                  await handleReorder(sourceId, provider.id);
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      data-provider-drag-handle={provider.id}
                      draggable={sorted.length > 1 && !reordering}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', provider.id);
                        setDraggedProviderId(provider.id);
                      }}
                      onDragEnd={() => {
                        setDraggedProviderId(null);
                        setDragOverProviderId(null);
                      }}
                      className="flex h-6 w-4 cursor-grab items-center justify-center text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed"
                      disabled={sorted.length <= 1 || reordering}
                      title={isZh ? '拖拽调整顺序' : 'Drag to reorder'}
                    >
                      <span className="text-[14px] tracking-[-0.2em]">⋮⋮</span>
                    </button>
                    <div className="w-[22px] flex justify-center">
                    {getProviderIcon(provider.name, provider.base_url)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{provider.name}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {provider.api_key ? "API Key" : t('provider.configured')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Edit"
                      onClick={() => handleEdit(provider)}
                      disabled={reordering}
                    >
                      <HugeiconsIcon icon={PencilEdit01Icon} className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(provider)}
                      disabled={reordering}
                    >
                      {t('provider.disconnect')}
                    </Button>
                  </div>
                </div>
                {/* Gemini Image model selector — capsule buttons */}
                {provider.provider_type === 'gemini-image' && (
                  <div className="ml-[34px] mt-2 flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground mr-1">{isZh ? '模型' : 'Model'}:</span>
                    {GEMINI_IMAGE_MODELS.map((m) => {
                      const isActive = getGeminiImageModel(provider) === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => handleImageModelChange(provider, m.value)}
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-all ${
                            isActive
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-white/[0.04]'
                          }`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          ) : (
            Object.keys(envDetected).length === 0 && (
              <p className="text-[14px] text-muted-foreground py-8 text-center">
                {t('provider.noConnected')}
              </p>
            )
          )}
        </div>
      )}

      {/* ─── Section 2: Add Provider (Quick Presets) ─── */}
      {!loading && (
        <div className="p-2 pt-6">
          <section className="rounded-2xl bg-gradient-to-br from-bg-secondary/60 via-background to-info/5 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold tracking-tight">{t('provider.addProviderSection')}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {isZh
                    ? "选择一个预设后直接连接，不再平铺显示全部服务商。"
                    : "Pick one preset and connect directly without listing every provider inline."}
                </p>
              </div>

              <div className="w-full sm:w-[340px]">
                <Select value={selectedPresetKey} onValueChange={setSelectedPresetKey}>
                  <SelectTrigger className="h-10 rounded-xl border-border/70 bg-background/80">
                    <SelectValue placeholder={isZh ? "请选择服务商预设" : "Choose a provider preset"} />
                  </SelectTrigger>
                  <SelectContent>
                    {chatPresetOptions.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{isZh ? "对话服务商" : "Chat Providers"}</SelectLabel>
                        {chatPresetOptions.map((preset) => (
                          <SelectItem key={preset.key} value={preset.key}>
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {chatPresetOptions.length > 0 && mediaPresetOptions.length > 0 && <SelectSeparator />}
                    {mediaPresetOptions.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{isZh ? "媒体服务商" : "Media Providers"}</SelectLabel>
                        {mediaPresetOptions.map((preset) => (
                          <SelectItem key={preset.key} value={preset.key}>
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedPreset && (
              <div className="mt-4 flex flex-col gap-3 rounded-xl bg-background/80 p-3 shadow-sm sm:flex-row sm:items-center">
                <div className="shrink-0 w-[22px] sm:w-[26px] flex justify-center">
                  {selectedPreset.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{selectedPreset.name}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {isZh ? selectedPreset.descriptionZh : selectedPreset.description}
                  </p>
                </div>
                <Button
                  className="h-9 shrink-0 rounded-full px-4 sm:px-5"
                  onClick={() => handleOpenPresetDialog(selectedPreset)}
                >
                  + {t('provider.connect')}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Edit dialog (full form for editing existing providers) */}
      <ProviderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="edit"
        provider={editingProvider}
        onSave={handleEditSave}
        initialPreset={null}
      />

      {/* Preset connect dialog */}
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
          void fetchInstallPrereqs();
        }}
      />

      {/* Disconnect confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('provider.disconnectProvider')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('provider.disconnectConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? t('provider.disconnecting') : t('provider.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

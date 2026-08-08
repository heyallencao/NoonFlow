"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { ReloadIcon, Loading02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";
import { queryKeys } from '@/lib/queries/query-keys';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import { isDangerouslySkipPermissionsEnabled, serializeDangerouslySkipPermissions } from "@/lib/assistant-permissions";
import { openExternalLink } from "@/lib/external-links";
import { SETTING_KEYS } from "@/types";

function UpdateCard() {
  const { updateInfo, checking, checkForUpdates, downloadUpdate, quitAndInstall, setShowDialog } = useUpdate();
  const { t } = useTranslation();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

  const isDownloading = updateInfo?.isNativeUpdate && !updateInfo.readyToInstall
    && updateInfo.downloadProgress != null;

  return (
    <div className="border-b border-border-subtle pb-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium">{t('settings.monolith')}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('settings.version', { version: currentVersion })}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Show install/restart button when update available */}
          {updateInfo?.updateAvailable && !checking && (
            updateInfo.readyToInstall ? (
              <Button onClick={quitAndInstall} size="sm" className="h-7 text-[11px]">
                {t('update.restartToUpdate')}
              </Button>
            ) : updateInfo.isNativeUpdate && !isDownloading ? (
              <Button onClick={downloadUpdate} size="sm" className="h-7 text-[11px]">
                {t('update.installUpdate')}
              </Button>
            ) : !updateInfo.isNativeUpdate ? (
              <Button variant="outline" size="sm" onClick={() => void openExternalLink(updateInfo.releaseUrl)} className="h-7 text-[11px]">
                {t('settings.viewRelease')}
              </Button>
            ) : null
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={checkForUpdates}
            disabled={checking}
            className="gap-1.5 h-7 text-[11px]"
          >
            {checking ? (
              <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />
            ) : (
              <HugeiconsIcon icon={ReloadIcon} className="h-3 w-3" />
            )}
            {checking ? t('settings.checking') : t('settings.checkForUpdates')}
          </Button>
        </div>
      </div>

      {updateInfo && !checking && (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          {updateInfo.updateAvailable ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium">
                  {updateInfo.readyToInstall
                    ? t('update.readyToInstall', { version: updateInfo.latestVersion })
                    : isDownloading
                      ? `${t('update.downloading')} ${Math.round(updateInfo.downloadProgress!)}%`
                      : t('settings.updateAvailable', { version: updateInfo.latestVersion })}
                </span>
                {updateInfo.releaseNotes && (
                  <Button
                    variant="link"
                    className="h-auto p-0 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setShowDialog(true)}
                  >
                    {t('gallery.viewDetails')}
                  </Button>
                )}
              </div>
              {/* Download progress bar */}
              {isDownloading && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.min(updateInfo.downloadProgress!, 100)}%` }}
                  />
                </div>
              )}
              {updateInfo.lastError && (
                <div className="flex items-start gap-1.5 text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
                  <HugeiconsIcon icon={InformationCircleIcon} className="h-3 w-3 mt-0.5 shrink-0" />
                  <p className="text-[11px] leading-relaxed">{updateInfo.lastError}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {t('settings.latestVersion')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function GeneralSection() {
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [showSkipPermWarning, setShowSkipPermWarning] = useState(false);
  const [skipPermSaving, setSkipPermSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [reasoningSaving, setReasoningSaving] = useState(false);
  const [generativeUIEnabled, setGenerativeUIEnabled] = useState(true);
  const [generativeUISaving, setGenerativeUISaving] = useState(false);
  const [contextUsageBarEnabled, setContextUsageBarEnabled] = useState(true);
  const [contextUsageBarSaving, setContextUsageBarSaving] = useState(false);

  const { t } = useTranslation();
  const appSettingsQuery = useAppSettingsQuery();
  const queryClient = useQueryClient();

  useEffect(() => {
    const appSettings = appSettingsQuery.data?.settings;
    if (!appSettings) return;

    setSkipPermissions(isDangerouslySkipPermissionsEnabled(appSettings.dangerously_skip_permissions));
    setReasoningEnabled(appSettings.chat_reasoning_enabled === "true");
    setGenerativeUIEnabled(appSettings[SETTING_KEYS.GENERATIVE_UI_ENABLED] !== "false");
    setContextUsageBarEnabled(appSettings[SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED] !== "false");
  }, [appSettingsQuery.data]);

  const handleSkipPermToggle = (checked: boolean) => {
    if (checked) {
      setShowSkipPermWarning(true);
    } else {
      saveSkipPermissions(false);
    }
  };

  const saveSkipPermissions = async (enabled: boolean) => {
    setSkipPermSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { dangerously_skip_permissions: serializeDangerouslySkipPermissions(enabled) },
        }),
      });
      if (res.ok) {
        setSkipPermissions(enabled);
        queryClient.setQueryData(
          queryKeys.appSettings(),
          (current: { settings?: Record<string, string> } | undefined) => ({
            settings: {
              ...(current?.settings || {}),
              dangerously_skip_permissions: serializeDangerouslySkipPermissions(enabled),
            },
          }),
        );
      }
    } catch {
      // ignore
    } finally {
      setSkipPermSaving(false);
      setShowSkipPermWarning(false);
    }
  };

  const saveReasoningEnabled = async (enabled: boolean) => {
    setReasoningSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { chat_reasoning_enabled: enabled ? "true" : "" },
        }),
      });
      if (res.ok) {
        setReasoningEnabled(enabled);
        queryClient.setQueryData(
          queryKeys.appSettings(),
          (current: { settings?: Record<string, string> } | undefined) => ({
            settings: {
              ...(current?.settings || {}),
              chat_reasoning_enabled: enabled ? "true" : "",
            },
          }),
        );
      }
    } catch {
      // ignore
    } finally {
      setReasoningSaving(false);
    }
  };

  const saveGenerativeUIEnabled = async (enabled: boolean) => {
    setGenerativeUISaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { [SETTING_KEYS.GENERATIVE_UI_ENABLED]: enabled ? "true" : "false" },
        }),
      });
      if (res.ok) {
        setGenerativeUIEnabled(enabled);
        queryClient.setQueryData(
          queryKeys.appSettings(),
          (current: { settings?: Record<string, string> } | undefined) => ({
            settings: {
              ...(current?.settings || {}),
              [SETTING_KEYS.GENERATIVE_UI_ENABLED]: enabled ? "true" : "false",
            },
          }),
        );
      }
    } catch {
      // ignore
    } finally {
      setGenerativeUISaving(false);
    }
  };

  const saveContextUsageBarEnabled = async (enabled: boolean) => {
    setContextUsageBarSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { [SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED]: enabled ? "true" : "false" },
        }),
      });
      if (res.ok) {
        setContextUsageBarEnabled(enabled);
        queryClient.setQueryData(
          queryKeys.appSettings(),
          (current: { settings?: Record<string, string> } | undefined) => ({
            settings: {
              ...(current?.settings || {}),
              [SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED]: enabled ? "true" : "false",
            },
          }),
        );
      }
    } catch {
      // ignore
    } finally {
      setContextUsageBarSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[15px] font-semibold mb-1.5">{t('settings.general')}</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Core application configuration. Update the client, manage automation permissions, and toggle advanced workspace features.
        </p>
      </div>

      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Application</h3>
          <UpdateCard />
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Behavior</h3>

          <div className="space-y-5">
            {/* Auto-approve toggle */}
            <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-border-subtle ${skipPermissions ? "bg-warning/5 -mx-3 px-3 py-3 rounded-md" : ""}`}>
              <div className="space-y-1 flex-1">
                <h4 className="text-[13px] font-medium">{t('settings.autoApproveTitle')}</h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t('settings.autoApproveDesc')}
                </p>
                {skipPermissions && (
                  <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 text-[10px] font-medium text-warning-foreground bg-warning/10 rounded border border-warning/20">
                    {t('settings.autoApproveWarning')}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                <Switch
                  checked={skipPermissions}
                  onCheckedChange={handleSkipPermToggle}
                  disabled={skipPermSaving}
                />
              </div>
            </div>

            {/* Reasoning toggle */}
            <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-border-subtle ${reasoningEnabled ? "bg-info/5 -mx-3 px-3 py-3 rounded-md" : ""}`}>
              <div className="space-y-1 flex-1">
                <h4 className="text-[13px] font-medium">{t('settings.reasoningTitle')}</h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t('settings.reasoningDesc')}
                </p>
                {reasoningEnabled && (
                  <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 text-[10px] font-medium text-info-foreground bg-info/10 rounded border border-info/20">
                    {t('settings.reasoningNotice')}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                <Switch
                  checked={reasoningEnabled}
                  onCheckedChange={saveReasoningEnabled}
                  disabled={reasoningSaving}
                />
              </div>
            </div>

            {/* Generative UI toggle */}
            <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-border-subtle ${generativeUIEnabled ? "bg-primary/5 -mx-3 px-3 py-3 rounded-md" : ""}`}>
              <div className="space-y-1 flex-1">
                <h4 className="text-[13px] font-medium">{t('settings.generativeUITitle')}</h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t('settings.generativeUIDesc')}
                </p>
              </div>
              <div className="shrink-0">
                <Switch
                  checked={generativeUIEnabled}
                  onCheckedChange={saveGenerativeUIEnabled}
                  disabled={generativeUISaving}
                />
              </div>
            </div>

            {/* Context Usage Bar toggle */}
            <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${contextUsageBarEnabled ? "bg-primary/5 -mx-3 px-3 py-3 rounded-md" : ""}`}>
              <div className="space-y-1 flex-1">
                <h4 className="text-[13px] font-medium">{t('settings.contextUsageBarTitle')}</h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t('settings.contextUsageBarDesc')}
                </p>
              </div>
              <div className="shrink-0">
                <Switch
                  checked={contextUsageBarEnabled}
                  onCheckedChange={saveContextUsageBarEnabled}
                  disabled={contextUsageBarSaving}
                />
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* Skip-permissions warning dialog */}
      <AlertDialog open={showSkipPermWarning} onOpenChange={setShowSkipPermWarning}>
        <AlertDialogContent className="sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">{t('settings.autoApproveDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 mt-3">
                <p className="text-[15px] leading-relaxed text-foreground/80">
                  {t('settings.autoApproveDialogDesc')}
                </p>
                <ul className="list-disc pl-5 space-y-2 text-[14px] text-foreground/70">
                  <li>{t('settings.autoApproveShellCommands')}</li>
                  <li>{t('settings.autoApproveFileOps')}</li>
                  <li>{t('settings.autoApproveNetwork')}</li>
                </ul>
                <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 p-3 mt-4 border border-orange-200 dark:border-orange-900/30">
                  <p className="text-[14px] font-medium text-orange-800 dark:text-orange-400">
                    {t('settings.autoApproveTrustWarning')}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6">
            <AlertDialogCancel className="h-10">{t('settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => saveSkipPermissions(true)}
              className="h-10 bg-orange-600 hover:bg-orange-700 text-white shadow-sm"
            >
              {t('settings.enableAutoApprove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

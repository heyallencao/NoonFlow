"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings02Icon, TextFontIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
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
import { useTranslation } from "@/hooks/useTranslation";
import { useFontSize } from "@/components/layout/FontSizeProvider";
import {
  isDangerouslySkipPermissionsEnabled,
  serializeDangerouslySkipPermissions,
} from "@/lib/assistant-permissions";
import { queryKeys } from "@/lib/queries/query-keys";
import { useAppSettingsQuery } from "@/lib/queries/settings-queries";
import { SETTING_KEYS } from "@/types";
import { cn } from "@/lib/utils";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";

export function GeneralSettings() {
  const { t, locale, setLocale } = useTranslation();
  const isZh = locale === "zh";
  const queryClient = useQueryClient();
  const appSettingsQuery = useAppSettingsQuery();
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [showSkipPermWarning, setShowSkipPermWarning] = useState(false);
  const [skipPermSaving, setSkipPermSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [generativeUIEnabled, setGenerativeUIEnabled] = useState(true);
  const [contextUsageBarEnabled, setContextUsageBarEnabled] = useState(true);
  const {
    fontScale,
    fontScalePercent,
    defaultFontScale,
    minFontScale,
    maxFontScale,
    setFontScale,
    increaseFontScale,
    decreaseFontScale,
    resetFontScale,
  } = useFontSize();

  useEffect(() => {
    const settings = appSettingsQuery.data?.settings;
    if (!settings) return;
    // Local controls intentionally mirror the latest asynchronous settings snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSkipPermissions(isDangerouslySkipPermissionsEnabled(settings.dangerously_skip_permissions));
    setReasoningEnabled(settings.chat_reasoning_enabled === "true");
    setGenerativeUIEnabled(settings[SETTING_KEYS.GENERATIVE_UI_ENABLED] !== "false");
    setContextUsageBarEnabled(settings[SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED] !== "false");
  }, [appSettingsQuery.data]);

  const save = async (key: string, value: string) => {
    await fetch("/api/settings/app", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { [key]: value } }),
    });
    queryClient.setQueryData(
      queryKeys.appSettings(),
      (current: { settings?: Record<string, string> } | undefined) => ({
        settings: { ...(current?.settings || {}), [key]: value },
      }),
    );
  };

  const toggleSkipPermissions = (checked: boolean) => {
    if (checked) {
      setShowSkipPermWarning(true);
      return;
    }
    setSkipPermSaving(true);
    void save("dangerously_skip_permissions", serializeDangerouslySkipPermissions(false))
      .then(() => setSkipPermissions(false))
      .finally(() => setSkipPermSaving(false));
  };

  const confirmSkipPermissions = () => {
    setSkipPermSaving(true);
    void save("dangerously_skip_permissions", serializeDangerouslySkipPermissions(true))
      .then(() => setSkipPermissions(true))
      .finally(() => {
        setSkipPermSaving(false);
        setShowSkipPermWarning(false);
      });
  };

  const fontScalePresets = Array.from(
    new Set([0.95, 1, defaultFontScale, 1.1, 1.15].map((scale) => Number(scale.toFixed(4)))),
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <HugeiconsIcon icon={Settings02Icon} className="h-3.5 w-3.5" />
          {isZh ? "应用" : "Application"}
        </h3>
        <div className="grid grid-cols-[180px_1fr] gap-6 py-3">
          <div>
            <h4 className="text-sm font-medium">{t("settings.language")}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.languageDesc")}
            </p>
          </div>
          <div className="w-48">
            <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="text-xs">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {isZh ? "对话行为" : "Chat behavior"}
        </h3>
        <SettingToggle
          title={t("settings.autoApproveTitle")}
          description={t("settings.autoApproveDesc")}
          checked={skipPermissions}
          disabled={skipPermSaving}
          onCheckedChange={toggleSkipPermissions}
        />
        <SettingToggle
          title={t("settings.reasoningTitle")}
          description={t("settings.reasoningDesc")}
          checked={reasoningEnabled}
          onCheckedChange={(checked) => {
            setReasoningEnabled(checked);
            void save("chat_reasoning_enabled", checked ? "true" : "");
          }}
        />
        <SettingToggle
          title={t("settings.generativeUITitle")}
          description={t("settings.generativeUIDesc")}
          checked={generativeUIEnabled}
          onCheckedChange={(checked) => {
            setGenerativeUIEnabled(checked);
            void save(SETTING_KEYS.GENERATIVE_UI_ENABLED, checked ? "true" : "false");
          }}
        />
        <SettingToggle
          title={t("settings.contextUsageBarTitle")}
          description={t("settings.contextUsageBarDesc")}
          checked={contextUsageBarEnabled}
          onCheckedChange={(checked) => {
            setContextUsageBarEnabled(checked);
            void save(SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED, checked ? "true" : "false");
          }}
        />
      </section>

      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <HugeiconsIcon icon={TextFontIcon} className="h-3.5 w-3.5" />
          {isZh ? "外观" : "Appearance"}
        </h3>
        <div className="grid grid-cols-[180px_1fr] gap-6 py-3">
          <div>
            <h4 className="text-sm font-medium">{t("settings.fontSizeTitle")}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.fontSizeDesc")}
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={decreaseFontScale} disabled={fontScale <= minFontScale} className="h-7 w-7 p-0">−</Button>
              <div className="w-14 text-center font-mono text-sm font-medium text-primary">{fontScalePercent}</div>
              <Button variant="outline" size="sm" onClick={increaseFontScale} disabled={fontScale >= maxFontScale} className="h-7 w-7 p-0">+</Button>
              <Button variant="ghost" size="sm" onClick={resetFontScale} className="ml-1 h-7 text-xs">{t("settings.fontSizeReset")}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {fontScalePresets.map((scale) => (
                <button
                  key={scale}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-xs font-medium transition-all",
                    Math.abs(fontScale - scale) < 0.001
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border-subtle bg-background text-muted-foreground hover:border-primary/40 hover:text-primary",
                  )}
                  onClick={() => setFontScale(scale)}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <AlertDialog open={showSkipPermWarning} onOpenChange={setShowSkipPermWarning}>
        <AlertDialogContent className="sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.autoApproveDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.autoApproveDialogDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSkipPermissions}>
              {t("settings.enableAutoApprove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-b-0">
      <div className="flex-1">
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

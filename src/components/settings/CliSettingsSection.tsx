"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { CodeMirrorSourceEditor } from "@/components/layout/CodeMirrorSourceEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  FloppyDiskIcon,
  ReloadIcon,
  CodeIcon,
  SlidersHorizontalIcon,
  Loading02Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { queryKeys } from '@/lib/queries/query-keys';
import { useSettingsQuery } from '@/lib/queries/settings-queries';

interface SettingsData {
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  {
    key: "permissions",
    label: "Permissions",
    description: "Configure permission settings for Claude CLI",
    type: "object" as const,
  },
  {
    key: "env",
    label: "Environment Variables",
    description: "Environment variables passed to Claude",
    type: "object" as const,
  },
] as const;

export function CliSettingsSection() {
  const [settings, setSettings] = useState<SettingsData>({});
  const [originalSettings, setOriginalSettings] = useState<SettingsData>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonEditorVersion, setJsonEditorVersion] = useState(0);
  const [objectEditorVersion, setObjectEditorVersion] = useState(0);
  const [jsonError, setJsonError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<"form" | "json" | null>(null);
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const settingsQuery = useSettingsQuery();
  const queryClient = useQueryClient();

  const knownFieldKeys: Record<string, { label: TranslationKey; description: TranslationKey }> = {
    permissions: { label: 'cli.permissions', description: 'cli.permissionsDesc' },
    env: { label: 'cli.envVars', description: 'cli.envVarsDesc' },
  };

  // Map dynamic CLI settings keys to translation keys (for fields not in KNOWN_FIELDS)
  const dynamicFieldLabels: Record<string, TranslationKey> = {
    skipDangerousModePermissionPrompt: 'cli.field.skipDangerousModePermissionPrompt',
    verbose: 'cli.field.verbose',
    theme: 'cli.field.theme',
  };

  useEffect(() => {
    if (!loading || !settingsQuery.data) {
      return;
    }

    const nextSettings = settingsQuery.data.settings || {};
    setSettings(nextSettings);
    setOriginalSettings(nextSettings);
    setJsonText(JSON.stringify(nextSettings, null, 2));
    setJsonEditorVersion((current) => current + 1);
    setObjectEditorVersion((current) => current + 1);
    setLoading(false);
  }, [loading, settingsQuery.data]);

  useEffect(() => {
    if (!loading || !settingsQuery.isError) {
      return;
    }

    setSettings({});
    setOriginalSettings({});
    setJsonText("{}");
    setJsonEditorVersion((current) => current + 1);
    setObjectEditorVersion((current) => current + 1);
    setLoading(false);
  }, [loading, settingsQuery.isError]);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  const handleSave = async (source: "form" | "json") => {
    let dataToSave: SettingsData;

    if (source === "json") {
      try {
        dataToSave = JSON.parse(jsonText);
        setJsonError("");
      } catch {
        setJsonError("Invalid JSON format");
        return;
      }
    } else {
      dataToSave = settings;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: dataToSave }),
      });

      if (res.ok) {
        setSettings(dataToSave);
        setOriginalSettings(dataToSave);
        setJsonText(JSON.stringify(dataToSave, null, 2));
        setJsonEditorVersion((current) => current + 1);
        setObjectEditorVersion((current) => current + 1);
        queryClient.setQueryData(queryKeys.settings(), { settings: dataToSave });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch {
      // Handle error silently
    } finally {
      setSaving(false);
      setShowConfirmDialog(false);
      setPendingSaveAction(null);
    }
  };

  const handleReset = () => {
    setSettings(originalSettings);
    setJsonText(JSON.stringify(originalSettings, null, 2));
    setJsonEditorVersion((current) => current + 1);
    setObjectEditorVersion((current) => current + 1);
    setJsonError("");
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonEditorVersion((current) => current + 1);
      setJsonError("");
    } catch {
      setJsonError(t('cli.formatError'));
    }
  };

  const confirmSave = (source: "form" | "json") => {
    setPendingSaveAction(source);
    setShowConfirmDialog(true);
  };

  const updateField = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-[11px] text-muted-foreground">{t('cli.loadingSettings')}</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Tabs defaultValue="form">
        <TabsList className="mb-6">
          <TabsTrigger value="form" className="gap-2">
            <HugeiconsIcon icon={SlidersHorizontalIcon} className="h-4 w-4" />
            {t('cli.form')}
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-2">
            <HugeiconsIcon icon={CodeIcon} className="h-4 w-4" />
            {t('cli.json')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <div className="space-y-8">
            {KNOWN_FIELDS.map((field) => (
              <div
                key={field.key}
                className="pb-8 border-b last:border-b-0"
              >
                <Label className="text-[13px] font-semibold">{t(knownFieldKeys[field.key]?.label ?? field.label as TranslationKey)}</Label>
                <p className="mb-3 text-[11px] text-muted-foreground">{t(knownFieldKeys[field.key]?.description ?? field.description as TranslationKey)}</p>
                <CodeMirrorSourceEditor
                  value={
                    typeof settings[field.key] === "object"
                      ? JSON.stringify(settings[field.key], null, 2)
                      : String(settings[field.key] ?? "")
                  }
                  valueVersion={objectEditorVersion}
                  isDark={isDark}
                  language={field.type === "object" ? "json" : "text"}
                  readOnly={false}
                  onChange={(nextValue) => {
                    try {
                      const parsed = JSON.parse(nextValue);
                      updateField(field.key, parsed);
                    } catch {
                      updateField(field.key, nextValue);
                    }
                  }}
                  className="min-h-[112px] rounded-md border"
                />
              </div>
            ))}

            {Object.entries(settings)
              .filter(([key]) => !KNOWN_FIELDS.some((f) => f.key === key))
              .map(([key, value]) => (
                <div
                  key={key}
                  className="pb-8 border-b last:border-b-0"
                >
                  <Label className="text-[13px] font-semibold">{dynamicFieldLabels[key] ? t(dynamicFieldLabels[key]) : key}</Label>
                  {typeof value === "boolean" ? (
                    <div className="mt-3 flex items-center gap-2">
                      <Switch
                        checked={value}
                        onCheckedChange={(checked) => updateField(key, checked)}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {value ? t('common.enabled') : t('common.disabled')}
                      </span>
                    </div>
                  ) : typeof value === "string" ? (
                    <Input
                      value={value}
                      onChange={(e) => updateField(key, e.target.value)}
                      className="mt-3"
                    />
                  ) : (
                    <div className="mt-3">
                      <CodeMirrorSourceEditor
                        value={JSON.stringify(value, null, 2)}
                        valueVersion={objectEditorVersion}
                        isDark={isDark}
                        language="json"
                        readOnly={false}
                        onChange={(nextValue) => {
                          try {
                            updateField(key, JSON.parse(nextValue));
                          } catch {
                            updateField(key, nextValue);
                          }
                        }}
                        className="min-h-[112px] rounded-md border"
                      />
                    </div>
                  )}
                </div>
              ))}

            <div className="flex items-center gap-3 pt-4">
              <Button onClick={() => confirmSave("form")} disabled={!hasChanges || saving} className="gap-2">
                {saving ? (
                  <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={FloppyDiskIcon} className="h-4 w-4" />
                )}
                {saving ? t('provider.saving') : t('cli.save')}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={!hasChanges} className="gap-2">
                <HugeiconsIcon icon={ReloadIcon} className="h-4 w-4" />
                {t('cli.reset')}
              </Button>
              {saveSuccess && (
                <span className="text-[11px] text-green-600 dark:text-green-400">
                  {t('cli.settingsSaved')}
                </span>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="json">
          <div className="space-y-4">
            <CodeMirrorSourceEditor
              value={jsonText}
              valueVersion={jsonEditorVersion}
              isDark={isDark}
              language="json"
              readOnly={false}
              onChange={(nextValue) => {
                setJsonText(nextValue);
                setJsonError("");
              }}
              onSaveShortcut={() => confirmSave("json")}
              className="min-h-[400px] rounded-md border"
            />
            {jsonError && <p className="text-[11px] text-destructive">{jsonError}</p>}

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={() => confirmSave("json")} disabled={saving} className="gap-2">
                {saving ? (
                  <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={FloppyDiskIcon} className="h-4 w-4" />
                )}
                {saving ? t('provider.saving') : t('cli.save')}
              </Button>
              <Button variant="outline" onClick={handleFormatJson} className="gap-2">
                <HugeiconsIcon icon={CodeIcon} className="h-4 w-4" />
                {t('cli.format')}
              </Button>
              <Button variant="outline" onClick={handleReset} className="gap-2">
                <HugeiconsIcon icon={ReloadIcon} className="h-4 w-4" />
                {t('cli.reset')}
              </Button>
              {saveSuccess && (
                <span className="text-[11px] text-green-600 dark:text-green-400">
                  {t('cli.settingsSaved')}
                </span>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cli.confirmSaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cli.confirmSaveDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingSaveAction && handleSave(pendingSaveAction)}>
              {t('common.save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

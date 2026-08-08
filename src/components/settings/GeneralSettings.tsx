"use client";

import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  FloppyDiskIcon,
  Globe02Icon,
  InformationCircleIcon,
  Loading02Icon,
  PencilEdit01Icon,
  ReloadIcon,
  Settings02Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TextFontIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";
import { useFontSize } from "@/components/layout/FontSizeProvider";
import { isDangerouslySkipPermissionsEnabled, serializeDangerouslySkipPermissions } from "@/lib/assistant-permissions";
import { queryKeys } from "@/lib/queries/query-keys";
import { useAppSettingsQuery } from "@/lib/queries/settings-queries";
import { openExternalLink } from "@/lib/external-links";
import { SETTING_KEYS } from "@/types";
import { cn } from "@/lib/utils";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import {
  createOverviewRecommendationConfig,
  normalizeOverviewRecommendationConfig,
  OVERVIEW_RECOMMENDATION_TEMPLATES,
  parseOverviewRecommendationConfig,
  serializeOverviewRecommendationConfig,
  type OverviewRecommendationConfig,
  type OverviewRecommendationTemplate,
} from "@/lib/dashboard/recommendation-settings";

// ─── Update Card ─────────────────────────────────────────────────────────────

function UpdateCard() {
  const { updateInfo, checking, checkForUpdates, downloadUpdate, quitAndInstall, setShowDialog } = useUpdate();
  const { t } = useTranslation();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

  const isDownloading =
    updateInfo?.isNativeUpdate &&
    !updateInfo.readyToInstall &&
    updateInfo.downloadProgress != null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t("settings.monolith")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings.version", { version: currentVersion })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {updateInfo?.updateAvailable && !checking && (
            updateInfo.readyToInstall ? (
              <Button onClick={quitAndInstall} size="sm" className="h-8 text-xs">
                {t("update.restartToUpdate")}
              </Button>
            ) : updateInfo.isNativeUpdate && !isDownloading ? (
              <Button onClick={downloadUpdate} size="sm" className="h-8 text-xs">
                {t("update.installUpdate")}
              </Button>
            ) : !updateInfo.isNativeUpdate ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openExternalLink(updateInfo.releaseUrl)}
                className="h-8 text-xs"
              >
                {t("settings.viewRelease")}
              </Button>
            ) : null
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={checkForUpdates}
            disabled={checking}
            className="h-8 gap-1.5 text-xs"
          >
            {checking ? (
              <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />
            ) : (
              <HugeiconsIcon icon={ReloadIcon} className="h-3 w-3" />
            )}
            {checking ? t("settings.checking") : t("settings.checkForUpdates")}
          </Button>
        </div>
      </div>

      {updateInfo && !checking && (
        <div className="pt-3 border-t border-border-subtle space-y-2">
          {updateInfo.updateAvailable ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  {updateInfo.readyToInstall
                    ? t("update.readyToInstall", { version: updateInfo.latestVersion })
                    : isDownloading
                      ? `${t("update.downloading")} ${Math.round(updateInfo.downloadProgress!)}%`
                      : t("settings.updateAvailable", { version: updateInfo.latestVersion })}
                </span>
                {updateInfo.releaseNotes && (
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowDialog(true)}
                  >
                    {t("gallery.viewDetails")}
                  </Button>
                )}
              </div>
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
                  <p className="text-xs leading-relaxed">{updateInfo.lastError}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("settings.latestVersion")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Overview Rules ────────────────────────────────────────────────────────────

type RuleKey = keyof OverviewRecommendationConfig["rules"];
type TemplateCardKey = Exclude<OverviewRecommendationTemplate, "custom"> | "custom";

const TEMPLATE_META: Record<
  TemplateCardKey,
  { zh: { name: string; desc: string }; en: { name: string; desc: string } }
> = {
  focused: {
    zh: { name: "聚焦", desc: "只在明显异常时提醒，适合低打扰工作流。" },
    en: { name: "Focused", desc: "Only flags stronger signals for a quieter dashboard." },
  },
  balanced: {
    zh: { name: "平衡", desc: "覆盖常见治理问题，适合作为默认配置。" },
    en: { name: "Balanced", desc: "Covers common hygiene and cost drift. Good default." },
  },
  strict: {
    zh: { name: "严格", desc: "更早触发提醒，适合重治理、重规范团队。" },
    en: { name: "Strict", desc: "Triggers sooner for tighter repo and spend governance." },
  },
  custom: {
    zh: { name: "自定义", desc: "保留你当前这一组规则；手动改阈值后会自动归到这里。" },
    en: { name: "Custom", desc: "Keeps your current mix. Manual edits automatically land here." },
  },
};

const RULE_META: Record<
  RuleKey,
  {
    zh: { title: string; desc: string; unit: string };
    en: { title: string; desc: string; unit: string };
  }
> = {
  largeInstructionFile: {
    zh: { title: "规则文件过大", desc: "当仓库根目录的 CLAUDE.md / AGENTS.md 超过阈值时提醒。", unit: "行" },
    en: { title: "Large guide file", desc: "Alert when a repo root CLAUDE.md or AGENTS.md exceeds this size.", unit: "lines" },
  },
  monthlyCost: {
    zh: { title: "月度模型成本", desc: "最近 30 天模型成本超过阈值时提醒。", unit: "USD" },
    en: { title: "Monthly model spend", desc: "Alert when model spend in the last 30 days crosses the threshold.", unit: "USD" },
  },
  missingProjectGuide: {
    zh: { title: "缺少项目规则文件", desc: "缺少 CLAUDE.md / AGENTS.md 的仓库数量达到阈值时提醒。", unit: "仓库" },
    en: { title: "Missing project guide", desc: "Alert when this many repos are missing CLAUDE.md or AGENTS.md.", unit: "repos" },
  },
  dirtyRepo: {
    zh: { title: "仓库改动过多", desc: "单个仓库未提交文件过多时提醒，适合防止分支积压。", unit: "文件" },
    en: { title: "Dirty repo load", desc: "Alert when one repo accumulates too many pending file changes.", unit: "files" },
  },
  staleBranches: {
    zh: { title: "陈旧分支积压", desc: "单个仓库长期未更新的本地分支数量达到阈值时提醒。", unit: "分支" },
    en: { title: "Stale branches", desc: "Alert when one repo accumulates too many stale local branches.", unit: "branches" },
  },
};

function getRuleNumericValue(config: OverviewRecommendationConfig, key: RuleKey): number {
  if (key === "largeInstructionFile") return config.rules.largeInstructionFile.lineThreshold;
  if (key === "monthlyCost") return config.rules.monthlyCost.amountThresholdUsd;
  if (key === "missingProjectGuide") return config.rules.missingProjectGuide.minMissingRepos;
  if (key === "dirtyRepo") return config.rules.dirtyRepo.dirtyFilesThreshold;
  return config.rules.staleBranches.staleBranchThreshold;
}

function setRuleNumericValue(
  config: OverviewRecommendationConfig,
  key: RuleKey,
  value: number,
): OverviewRecommendationConfig {
  if (key === "largeInstructionFile") {
    return normalizeOverviewRecommendationConfig({
      ...config,
      template: "custom",
      rules: { ...config.rules, largeInstructionFile: { ...config.rules.largeInstructionFile, lineThreshold: value } },
    });
  }
  if (key === "monthlyCost") {
    return normalizeOverviewRecommendationConfig({
      ...config,
      template: "custom",
      rules: { ...config.rules, monthlyCost: { ...config.rules.monthlyCost, amountThresholdUsd: value } },
    });
  }
  if (key === "missingProjectGuide") {
    return normalizeOverviewRecommendationConfig({
      ...config,
      template: "custom",
      rules: { ...config.rules, missingProjectGuide: { ...config.rules.missingProjectGuide, minMissingRepos: value } },
    });
  }
  if (key === "dirtyRepo") {
    return normalizeOverviewRecommendationConfig({
      ...config,
      template: "custom",
      rules: { ...config.rules, dirtyRepo: { ...config.rules.dirtyRepo, dirtyFilesThreshold: value } },
    });
  }
  return normalizeOverviewRecommendationConfig({
    ...config,
    template: "custom",
    rules: { ...config.rules, staleBranches: { ...config.rules.staleBranches, staleBranchThreshold: value } },
  });
}

function setRuleEnabled(
  config: OverviewRecommendationConfig,
  key: RuleKey,
  enabled: boolean,
): OverviewRecommendationConfig {
  return normalizeOverviewRecommendationConfig({
    ...config,
    template: "custom",
    rules: {
      ...config.rules,
      [key]: { ...config.rules[key], enabled },
    },
  });
}

function OverviewRulesForm() {
  const { locale } = useTranslation();
  const isZh = locale === "zh";
  const appSettingsQuery = useAppSettingsQuery();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<OverviewRecommendationConfig>(
    createOverviewRecommendationConfig("balanced"),
  );
  const [originalSerialized, setOriginalSerialized] = useState(
    serializeOverviewRecommendationConfig(createOverviewRecommendationConfig("balanced")),
  );
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (initialized) return;
    const raw = appSettingsQuery.data?.settings?.[SETTING_KEYS.OVERVIEW_RECOMMENDATION_RULES];
    const nextConfig = raw
      ? parseOverviewRecommendationConfig(raw)
      : createOverviewRecommendationConfig("balanced");
    setConfig(nextConfig);
    setOriginalSerialized(serializeOverviewRecommendationConfig(nextConfig));
    setInitialized(true);
  }, [appSettingsQuery.data, initialized]);

  const currentSerialized = serializeOverviewRecommendationConfig(config);
  const hasChanges = currentSerialized !== originalSerialized;
  const enabledRuleCount = Object.values(config.rules).filter((rule) => rule.enabled).length;

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            [SETTING_KEYS.OVERVIEW_RECOMMENDATION_RULES]: currentSerialized,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setOriginalSerialized(currentSerialized);
      await queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-recommendations"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (template: Exclude<OverviewRecommendationTemplate, "custom">) => {
    setConfig(createOverviewRecommendationConfig(template));
  };

  const activeTemplate = config.template;
  const templateCards: TemplateCardKey[] = ["focused", "balanced", "strict", "custom"];

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {activeTemplate === "custom"
              ? isZh
                ? "当前：自定义"
                : "Current: Custom"
              : `${isZh ? "当前：" : "Current: "}${TEMPLATE_META[activeTemplate][isZh ? "zh" : "en"].name}`}
          </span>
          <span className="text-xs text-muted-foreground">
            {isZh
              ? `启用 ${enabledRuleCount} / ${Object.keys(config.rules).length}`
              : `${enabledRuleCount} / ${Object.keys(config.rules).length} enabled`}
          </span>
          {hasChanges && (
            <span className="rounded-full border border-warning/20 bg-warning/8 px-2 py-0.5 text-xs text-warning">
              {isZh ? "有未保存修改" : "Unsaved changes"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
              {isZh ? "已保存" : "Saved"}
            </span>
          )}
          <Button
            size="sm"
            variant={hasChanges ? "default" : "outline"}
            onClick={saveSettings}
            disabled={saving || !hasChanges || appSettingsQuery.isLoading}
            className="h-8 gap-1.5 text-xs"
          >
            <HugeiconsIcon icon={FloppyDiskIcon} className="h-3.5 w-3.5" />
            {saving
              ? isZh
                ? "保存中..."
                : "Saving..."
              : isZh
                ? "保存策略"
                : "Save rules"}
          </Button>
        </div>
      </div>

      {/* Templates */}
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground mb-3">
          {isZh ? "模板" : "Templates"}
        </p>
        <div className="grid grid-cols-4 gap-3">
          {templateCards.map((templateKey) => {
            const meta = TEMPLATE_META[templateKey][isZh ? "zh" : "en"];
            const active = activeTemplate === templateKey;
            return (
              <button
                key={templateKey}
                type="button"
                onClick={() => {
                  if (templateKey === "custom") {
                    setConfig((c) => normalizeOverviewRecommendationConfig({ ...c, template: "custom" }));
                    return;
                  }
                  applyTemplate(templateKey);
                }}
                className={cn(
                  "rounded-xl border p-3.5 text-left transition-colors",
                  active
                    ? "border-foreground/20 bg-muted/50"
                    : "border-border-subtle bg-background hover:border-foreground/10 hover:bg-muted/30",
                  templateKey === "custom" && !active && "border-dashed",
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-foreground">{meta.name}</span>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                      <HugeiconsIcon icon={SparklesIcon} className="h-2.5 w-2.5" />
                      {isZh ? "当前" : "Active"}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{meta.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rules */}
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground mb-3">
          {isZh ? "逐条规则" : "Rules"}
        </p>
        <div className="space-y-2">
          {(Object.keys(RULE_META) as RuleKey[]).map((ruleKey) => {
            const meta = RULE_META[ruleKey][isZh ? "zh" : "en"];
            const enabled = config.rules[ruleKey].enabled;
            const numericValue = getRuleNumericValue(config, ruleKey);
            const inputStep = ruleKey === "monthlyCost" ? "0.5" : "1";
            const isInternalBeta = ruleKey === "monthlyCost";

            return (
              <div
                key={ruleKey}
                className={cn(
                  "grid grid-cols-[1fr_200px] gap-4 rounded-xl border px-4 py-3.5 transition-colors",
                  enabled && !isInternalBeta
                    ? "border-border-subtle bg-background/80"
                    : "border-border-subtle/50 bg-background/40",
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-foreground">{meta.title}</h4>
                    {isInternalBeta && (
                      <span className="inline-flex items-center rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {isZh ? "内测中" : "Internal Beta"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {meta.desc}
                  </p>
                </div>
                <div className="flex flex-col gap-2 self-center">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {isZh ? "启用" : "Enable"}
                    </span>
                    <Switch
                      size="sm"
                      checked={isInternalBeta ? false : enabled}
                      onCheckedChange={
                        isInternalBeta
                          ? undefined
                          : (checked) =>
                              setConfig((c) => setRuleEnabled(c, ruleKey, checked))
                      }
                      disabled={isInternalBeta}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step={inputStep}
                      min={0}
                      value={String(numericValue)}
                      disabled={!enabled || isInternalBeta}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setConfig((c) => setRuleNumericValue(c, ruleKey, next));
                      }}
                      className="h-7 text-xs bg-background"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">{meta.unit}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main GeneralSettings ──────────────────────────────────────────────────────

export function GeneralSettings() {
  const { t, locale, setLocale } = useTranslation();
  const isZh = locale === "zh";
  const queryClient = useQueryClient();
  const appSettingsQuery = useAppSettingsQuery();

  // Behavior state
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [showSkipPermWarning, setShowSkipPermWarning] = useState(false);
  const [skipPermSaving, setSkipPermSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [reasoningSaving, setReasoningSaving] = useState(false);
  const [generativeUIEnabled, setGenerativeUIEnabled] = useState(true);
  const [generativeUISaving, setGenerativeUISaving] = useState(false);
  const [contextUsageBarEnabled, setContextUsageBarEnabled] = useState(true);
  const [contextUsageBarSaving, setContextUsageBarSaving] = useState(false);

  // Font scale
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

  const fontScalePresets = Array.from(
    new Set([0.95, 1, defaultFontScale, 1.1, 1.15].map((scale) => Number(scale.toFixed(4)))),
  );

  useEffect(() => {
    const appSettings = appSettingsQuery.data?.settings;
    if (!appSettings) return;
    setSkipPermissions(isDangerouslySkipPermissionsEnabled(appSettings.dangerously_skip_permissions));
    setReasoningEnabled(appSettings.chat_reasoning_enabled === "true");
    setGenerativeUIEnabled(appSettings[SETTING_KEYS.GENERATIVE_UI_ENABLED] !== "false");
    setContextUsageBarEnabled(appSettings[SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED] !== "false");
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

  const handleSkipPermToggle = (checked: boolean) => {
    if (checked) {
      setShowSkipPermWarning(true);
    } else {
      setSkipPermSaving(true);
      save("dangerously_skip_permissions", serializeDangerouslySkipPermissions(false))
        .then(() => setSkipPermissions(false))
        .finally(() => setSkipPermSaving(false));
    }
  };

  const confirmSkipPerm = () => {
    setSkipPermSaving(true);
    save("dangerously_skip_permissions", serializeDangerouslySkipPermissions(true))
      .then(() => setSkipPermissions(true))
      .finally(() => {
        setSkipPermSaving(false);
        setShowSkipPermWarning(false);
      });
  };

  const handleReasoningToggle = (checked: boolean) => {
    setReasoningSaving(true);
    save("chat_reasoning_enabled", checked ? "true" : "")
      .then(() => setReasoningEnabled(checked))
      .finally(() => setReasoningSaving(false));
  };

  const handleGenerativeUIToggle = (checked: boolean) => {
    setGenerativeUISaving(true);
    save(SETTING_KEYS.GENERATIVE_UI_ENABLED, checked ? "true" : "false")
      .then(() => setGenerativeUIEnabled(checked))
      .finally(() => setGenerativeUISaving(false));
  };

  const handleContextUsageBarToggle = (checked: boolean) => {
    setContextUsageBarSaving(true);
    save(SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED, checked ? "true" : "false")
      .then(() => setContextUsageBarEnabled(checked))
      .finally(() => setContextUsageBarSaving(false));
  };

  return (
    <div className="space-y-5">
      {/* ── Application ── */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
          <HugeiconsIcon icon={Settings02Icon} className="h-3.5 w-3.5" />
          {isZh ? "应用" : "Application"}
        </h3>
        <UpdateCard />
      </section>

      {/* ── Language ── */}
      <section>
        <div className="grid grid-cols-[180px_1fr] gap-6 py-3">
          <div>
            <h4 className="text-sm font-medium">{t("settings.language")}</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.languageDesc")}
            </p>
          </div>
          <div className="w-48">
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((l) => (
                  <SelectItem key={l.value} value={l.value} className="text-xs">
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* ── Behavior ── */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {isZh ? "行为" : "Behavior"}
        </h3>

        {/* Auto-approve */}
        <div className="flex items-start justify-between gap-6 py-3 border-b border-border-subtle">
          <div className="flex-1">
            <h4 className="text-sm font-medium">{t("settings.autoApproveTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.autoApproveDesc")}
            </p>
            {skipPermissions && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-warning bg-warning/10 rounded border border-warning/20">
                {t("settings.autoApproveWarning")}
              </div>
            )}
          </div>
          <Switch
            checked={skipPermissions}
            onCheckedChange={handleSkipPermToggle}
            disabled={skipPermSaving}
          />
        </div>

        {/* Reasoning */}
        <div className="flex items-start justify-between gap-6 py-3 border-b border-border-subtle">
          <div className="flex-1">
            <h4 className="text-sm font-medium">{t("settings.reasoningTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.reasoningDesc")}
            </p>
            {reasoningEnabled && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-info bg-info/10 rounded border border-info/20">
                {t("settings.reasoningNotice")}
              </div>
            )}
          </div>
          <Switch
            checked={reasoningEnabled}
            onCheckedChange={handleReasoningToggle}
            disabled={reasoningSaving}
          />
        </div>

        {/* Generative UI */}
        <div className="flex items-start justify-between gap-6 py-3">
          <div className="flex-1">
            <h4 className="text-sm font-medium">{t("settings.generativeUITitle")}</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.generativeUIDesc")}
            </p>
          </div>
          <Switch
            checked={generativeUIEnabled}
            onCheckedChange={handleGenerativeUIToggle}
            disabled={generativeUISaving}
          />
        </div>

        {/* Context usage bar */}
        <div className="flex items-start justify-between gap-6 py-3 border-t border-border-subtle">
          <div className="flex-1">
            <h4 className="text-sm font-medium">{t("settings.contextUsageBarTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.contextUsageBarDesc")}
            </p>
          </div>
          <Switch
            checked={contextUsageBarEnabled}
            onCheckedChange={handleContextUsageBarToggle}
            disabled={contextUsageBarSaving}
          />
        </div>
      </section>

      {/* ── Appearance ── */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <HugeiconsIcon icon={TextFontIcon} className="h-3.5 w-3.5" />
          {isZh ? "外观" : "Appearance"}
        </h3>

        {/* Font size */}
        <div className="grid grid-cols-[180px_1fr] gap-6 py-3">
          <div>
            <h4 className="text-sm font-medium">{t("settings.fontSizeTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("settings.fontSizeDesc")}
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={decreaseFontScale}
                disabled={fontScale <= minFontScale}
                className="h-7 w-7 p-0"
              >
                −
              </Button>
              <div className="w-14 text-center text-sm font-mono font-medium text-primary">
                {fontScalePercent}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={increaseFontScale}
                disabled={fontScale >= maxFontScale}
                className="h-7 w-7 p-0"
              >
                +
              </Button>
              <Button variant="ghost" size="sm" onClick={resetFontScale} className="h-7 text-xs ml-1">
                {t("settings.fontSizeReset")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {fontScalePresets.map((scale) => {
                const scalePercent = Math.round(scale * 100);
                const isActive = Math.abs(fontScale - scale) < 0.001;
                return (
                  <button
                    key={scale}
                    className={cn(
                      "h-7 px-2.5 text-xs font-medium rounded-md transition-all",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-background border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-primary",
                    )}
                    onClick={() => setFontScale(scale)}
                  >
                    {scalePercent}%
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Home Rules ── */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <HugeiconsIcon icon={SlidersHorizontalIcon} className="h-3.5 w-3.5" />
          {isZh ? "首页建议策略" : "Home Rules"}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isZh
            ? "控制 dashboard 里建议模块的触发方式。可以先套模板，再按你的工作流单独调阈值和开关。"
            : "Control how the dashboard recommendation panel behaves. Start with a template, then tune each rule to fit your workflow."}
        </p>
        <OverviewRulesForm />
      </section>

      {/* Skip-permissions warning dialog */}
      <AlertDialog open={showSkipPermWarning} onOpenChange={setShowSkipPermWarning}>
        <AlertDialogContent className="sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">
              {t("settings.autoApproveDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 mt-3">
                <p className="text-sm leading-relaxed text-foreground/80">
                  {t("settings.autoApproveDialogDesc")}
                </p>
                <ul className="list-disc pl-5 space-y-2 text-sm text-foreground/70">
                  <li>{t("settings.autoApproveShellCommands")}</li>
                  <li>{t("settings.autoApproveFileOps")}</li>
                  <li>{t("settings.autoApproveNetwork")}</li>
                </ul>
                <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 p-3 mt-4 border border-orange-200 dark:border-orange-900/30">
                  <p className="text-sm font-medium text-orange-800 dark:text-orange-400">
                    {t("settings.autoApproveTrustWarning")}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6">
            <AlertDialogCancel className="h-9">{t("settings.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSkipPerm}
              className="h-9 bg-orange-600 hover:bg-orange-700 text-white shadow-sm"
            >
              {t("settings.enableAutoApprove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

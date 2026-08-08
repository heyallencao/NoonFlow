"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  FloppyDiskIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/queries/query-keys";
import { useAppSettingsQuery } from "@/lib/queries/settings-queries";
import {
  createOverviewRecommendationConfig,
  normalizeOverviewRecommendationConfig,
  OVERVIEW_RECOMMENDATION_TEMPLATES,
  parseOverviewRecommendationConfig,
  serializeOverviewRecommendationConfig,
  type OverviewRecommendationConfig,
  type OverviewRecommendationTemplate,
} from "@/lib/dashboard/recommendation-settings";
import { SETTING_KEYS } from "@/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

type RuleKey = keyof OverviewRecommendationConfig["rules"];
type TemplateCardKey = Exclude<OverviewRecommendationTemplate, "custom"> | "custom";
interface OverviewRulesSectionProps {
  integrated?: boolean;
}

const TEMPLATE_META: Record<
  TemplateCardKey,
  { zh: { name: string; desc: string }; en: { name: string; desc: string } }
> = {
  focused: {
    zh: { name: "聚焦模板", desc: "只在明显异常时提醒，适合低打扰工作流。" },
    en: { name: "Focused", desc: "Only flags stronger signals for a quieter dashboard." },
  },
  balanced: {
    zh: { name: "平衡模板", desc: "覆盖常见治理问题，适合作为默认配置。" },
    en: { name: "Balanced", desc: "Covers common hygiene and cost drift. Good default." },
  },
  strict: {
    zh: { name: "严格模板", desc: "更早触发提醒，适合重治理、重规范团队。" },
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

function setRuleNumericValue(config: OverviewRecommendationConfig, key: RuleKey, value: number): OverviewRecommendationConfig {
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

function setRuleEnabled(config: OverviewRecommendationConfig, key: RuleKey, enabled: boolean): OverviewRecommendationConfig {
  return normalizeOverviewRecommendationConfig({
    ...config,
    template: "custom",
    rules: {
      ...config.rules,
      [key]: {
        ...config.rules[key],
        enabled,
      },
    },
  });
}

export function OverviewRulesSection({ integrated = false }: OverviewRulesSectionProps) {
  const { locale } = useTranslation();
  const isZh = locale === "zh";
  const appSettingsQuery = useAppSettingsQuery();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<OverviewRecommendationConfig>(createOverviewRecommendationConfig("balanced"));
  const [originalSerialized, setOriginalSerialized] = useState(serializeOverviewRecommendationConfig(createOverviewRecommendationConfig("balanced")));
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (initialized) return;
    const raw = appSettingsQuery.data?.settings?.[SETTING_KEYS.OVERVIEW_RECOMMENDATION_RULES];
    const nextConfig = raw ? parseOverviewRecommendationConfig(raw) : createOverviewRecommendationConfig("balanced");
    setConfig(nextConfig);
    setOriginalSerialized(serializeOverviewRecommendationConfig(nextConfig));
    setInitialized(true);
  }, [appSettingsQuery.data, initialized]);

  const currentSerialized = useMemo(() => serializeOverviewRecommendationConfig(config), [config]);
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
      if (!res.ok) {
        throw new Error("Failed to save dashboard recommendation settings");
      }
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

  const activateCustomTemplate = () => {
    setConfig((current) => normalizeOverviewRecommendationConfig({ ...current, template: "custom" }));
  };

  const activeTemplate = config.template;
  const templateCards: TemplateCardKey[] = ["focused", "balanced", "strict", "custom"];

  return (
    <section className={cn(integrated ? "space-y-5" : "rounded-xl border border-border-subtle bg-background/35 p-4 sm:p-5")}>
      <div className={cn(
        "flex flex-col gap-4 border-b border-border-subtle pb-4",
        integrated ? "sm:flex-row sm:items-center sm:justify-between" : "sm:flex-row sm:items-start sm:justify-between",
      )}>
        <div className={cn("space-y-2", integrated && "space-y-0")}>
          {!integrated && (
            <>
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <HugeiconsIcon icon={SlidersHorizontalIcon} className="h-3.5 w-3.5" />
                {isZh ? "Overview Rules" : "Overview Rules"}
              </div>
              <h3 className="text-[15px] font-semibold text-foreground sm:text-base">
                {isZh ? "首页建议策略" : "Home recommendations"}
              </h3>
              <p className="max-w-2xl text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">
                {isZh
                  ? "控制 dashboard 里建议模块的触发方式。可以先套模板，再按你的工作流单独调阈值和开关。"
                  : "Control how the dashboard recommendation panel behaves. Start with a template, then tune each rule to fit your workflow."}
              </p>
            </>
          )}
          <div className={cn("flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground", !integrated && "pt-1")}>
            <span className="rounded-full border border-border-subtle bg-background px-2.5 py-1">
              {activeTemplate === "custom"
                ? (isZh ? "当前：自定义" : "Current: Custom")
                : `${isZh ? "当前：" : "Current: "}${TEMPLATE_META[activeTemplate][isZh ? "zh" : "en"].name}`}
            </span>
            <span className="rounded-full border border-border-subtle bg-background px-2.5 py-1">
              {isZh ? `启用 ${enabledRuleCount} / ${Object.keys(config.rules).length}` : `${enabledRuleCount} / ${Object.keys(config.rules).length} enabled`}
            </span>
            {hasChanges && (
              <span className="rounded-full border border-warning/20 bg-warning/8 px-2.5 py-1 text-warning">
                {isZh ? "有未保存修改" : "Unsaved changes"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
              {isZh ? "已保存" : "Saved"}
            </span>
          )}
          <Button
            size="sm"
            variant={hasChanges ? "default" : "outline"}
            onClick={saveSettings}
            disabled={saving || !hasChanges || appSettingsQuery.isLoading}
            className="h-8"
          >
            <HugeiconsIcon icon={FloppyDiskIcon} className="h-3.5 w-3.5" />
            {saving ? (isZh ? "保存中..." : "Saving...") : (isZh ? "保存策略" : "Save rules")}
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {isZh ? "模板" : "Templates"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {isZh ? "手动改任意规则后会自动切到自定义" : "Manual edits automatically switch to Custom"}
          </p>
        </div>

        <div className="grid gap-3 xl:grid-cols-4 sm:grid-cols-2">
        {templateCards.map((templateKey) => {
          const meta = TEMPLATE_META[templateKey][isZh ? "zh" : "en"];
          const active = activeTemplate === templateKey;
          return (
            <button
              key={templateKey}
              type="button"
              onClick={() => {
                if (templateKey === "custom") {
                  activateCustomTemplate();
                  return;
                }
                applyTemplate(templateKey);
              }}
              className={cn(
                "group min-h-[108px] rounded-xl border p-4 text-left transition-colors",
                active
                  ? "border-foreground/18 bg-muted/45"
                  : "border-border-subtle bg-background/70 hover:border-foreground/12 hover:bg-muted/25",
                templateKey === "custom" && !active && "border-dashed",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">{meta.name}</span>
                {active ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground/6 px-2 py-0.5 text-[10px] font-medium text-foreground/80">
                    <HugeiconsIcon icon={SparklesIcon} className="h-3 w-3" />
                    {isZh ? "当前" : "Active"}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{meta.desc}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {templateKey === "custom" ? (
                  <>
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      {isZh ? "自由阈值" : "Free thresholds"}
                    </span>
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      {isZh ? "独立开关" : "Rule toggles"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      {isZh ? `${Object.values(OVERVIEW_RECOMMENDATION_TEMPLATES[templateKey].rules).filter((rule) => rule.enabled).length} 条规则` : `${Object.values(OVERVIEW_RECOMMENDATION_TEMPLATES[templateKey].rules).filter((rule) => rule.enabled).length} rules`}
                    </span>
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      {templateKey === "focused" ? (isZh ? "低打扰" : "Low-noise") : templateKey === "strict" ? (isZh ? "高敏感" : "Tight") : (isZh ? "默认" : "Default")}
                    </span>
                  </>
                )}
              </div>
            </button>
          );
        })}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {isZh ? "逐条规则" : "Rules"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {isZh ? "关闭后 dashboard 不再展示该类提醒" : "Disabled rules disappear from the dashboard panel"}
          </p>
        </div>
        {(Object.keys(RULE_META) as RuleKey[]).map((ruleKey) => {
          const meta = RULE_META[ruleKey][isZh ? "zh" : "en"];
          const enabled = config.rules[ruleKey].enabled;
          const numericValue = getRuleNumericValue(config, ruleKey);
          const inputStep = ruleKey === "monthlyCost" ? "0.5" : "1";

          return (
            <div
              key={ruleKey}
              className={cn(
                "grid gap-4 rounded-xl border px-4 py-4 transition-colors md:grid-cols-[minmax(0,1fr)_220px]",
                enabled ? "border-border bg-background/85" : "border-border-subtle bg-background/45",
              )}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[13px] font-semibold text-foreground">{meta.title}</h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:text-[12px]">{meta.desc}</p>
                  </div>
                  <span className={cn(
                    "hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex",
                    enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                  )}>
                    {enabled ? (isZh ? "启用" : "On") : (isZh ? "关闭" : "Off")}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 self-center rounded-lg border border-border-subtle bg-background/70 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {isZh ? "启用规则" : "Enable rule"}
                  </span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => setConfig((current) => setRuleEnabled(current, ruleKey, checked))}
                  />
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <Input
                    type="number"
                    step={inputStep}
                    min={0}
                    value={String(numericValue)}
                    disabled={!enabled}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setConfig((current) => setRuleNumericValue(current, ruleKey, next));
                    }}
                    className="h-9 bg-background"
                  />
                  <span className="text-[11px] font-medium text-muted-foreground">{meta.unit}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  BubbleChatIcon,
  DiscordIcon,
  MessageMultiple01Icon,
  MessageUser02Icon,
  QqPlotIcon,
  SlackIcon,
  TelegramIcon,
  WechatIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

interface BridgeProviderOption {
  id: string;
  name: string;
  description: string;
  icon: IconSvgElement;
  tags: string[];
  accentClassName: string;
}

export function TelegramBridgeSection() {
  const { t, locale } = useTranslation();
  const isZh = locale === "zh";

  const providers = useMemo<BridgeProviderOption[]>(
    () => [
      {
        id: "telegram",
        name: "Telegram",
        description: isZh
          ? "适合通知、轻量命令和跨设备远程查看运行状态。"
          : "Best for notifications, lightweight commands, and cross-device status checks.",
        icon: TelegramIcon,
        tags: isZh ? ["Bot", "通知", "远程控制"] : ["Bot", "Notifications", "Remote control"],
        accentClassName: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300",
      },
      {
        id: "feishu",
        name: isZh ? "飞书" : "Feishu",
        description: isZh
          ? "适合团队协作场景，后续可用于消息流转与工作区通知。"
          : "Designed for team collaboration workflows and workspace notifications.",
        icon: BubbleChatIcon,
        tags: isZh ? ["团队", "群消息", "审批"] : ["Teams", "Group chat", "Approvals"],
        accentClassName: "border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
      },
      {
        id: "qq",
        name: "QQ",
        description: isZh
          ? "适合个人设备和国内常用即时通讯场景。"
          : "A practical option for personal devices and China-focused messaging workflows.",
        icon: QqPlotIcon,
        tags: isZh ? ["个人", "即时通讯", "国内"] : ["Personal", "Messaging", "China"],
        accentClassName: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
      },
      {
        id: "wechat",
        name: isZh ? "微信" : "WeChat",
        description: isZh
          ? "更适合高频触达和移动端状态提醒。"
          : "Optimized for high-frequency reach and mobile-first status updates.",
        icon: WechatIcon,
        tags: isZh ? ["移动端", "提醒", "会话"] : ["Mobile", "Alerts", "Threads"],
        accentClassName: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      },
      {
        id: "discord",
        name: "Discord",
        description: isZh
          ? "适合社区协作、频道分流和开发通知订阅。"
          : "A strong fit for community ops, channel routing, and developer notifications.",
        icon: DiscordIcon,
        tags: isZh ? ["社区", "频道", "开发者"] : ["Community", "Channels", "Developers"],
        accentClassName: "border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
      },
      {
        id: "slack",
        name: "Slack",
        description: isZh
          ? "面向团队协作与工作流集成，适合办公室场景。"
          : "Built for workplace collaboration and workflow integrations.",
        icon: SlackIcon,
        tags: isZh ? ["团队", "工作流", "办公"] : ["Teams", "Workflow", "Workplace"],
        accentClassName: "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
      },
      {
        id: "teams",
        name: "Microsoft Teams",
        description: isZh
          ? "适合企业组织内部的通知和受控接入。"
          : "A good enterprise option for internal notifications and controlled access.",
        icon: MessageUser02Icon,
        tags: isZh ? ["企业", "组织", "权限"] : ["Enterprise", "Org", "Permissions"],
        accentClassName: "border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300",
      },
      {
        id: "whatsapp",
        name: "WhatsApp",
        description: isZh
          ? "适合国际移动端沟通和轻量提醒场景。"
          : "Useful for international mobile messaging and lightweight alerts.",
        icon: WhatsappIcon,
        tags: isZh ? ["国际化", "移动端", "提醒"] : ["Global", "Mobile", "Alerts"],
        accentClassName: "border-green-500/25 bg-green-500/10 text-green-600 dark:text-green-300",
      },
    ],
    [isZh],
  );

  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id ?? "telegram");

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];

  return (
    <div className="max-w-3xl space-y-6">
      <section className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/12 via-background to-background p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <HugeiconsIcon icon={Alert02Icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">{t("bridge.telegramSettings")}</h2>
              <Badge variant="warning" className="rounded-full px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.12em]">
                {t("bridge.providerPreviewBadge")}
              </Badge>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("bridge.telegramSettingsDesc")}
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("bridge.providerSelectionHint")}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => {
            const selected = provider.id === selectedProviderId;

            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => setSelectedProviderId(provider.id)}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-all",
                  selected
                    ? "border-primary/35 bg-primary/5 shadow-sm"
                    : "border-border/50 bg-background hover:border-primary/20 hover:bg-bg-secondary/60",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
                      provider.accentClassName,
                    )}
                  >
                    <HugeiconsIcon icon={provider.icon} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{provider.name}</p>
                      <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {t("bridge.providerConfigureSoon")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {provider.description}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {provider.tags.map((tag) => (
                    <Badge
                      key={`${provider.id}-${tag}`}
                      variant="secondary"
                      className="rounded-full bg-bg-secondary/80 px-2 py-0 text-[11px] font-medium text-muted-foreground"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selectedProvider ? (
        <section className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">{selectedProvider.name}</h2>
                <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t("bridge.providerPreviewBadge")}
                </Badge>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {selectedProvider.description}
              </p>
            </div>

            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                selectedProvider.accentClassName,
              )}
            >
              <HugeiconsIcon icon={selectedProvider.icon} className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/40 bg-background/70 p-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {isZh ? "预期能力" : "Planned scope"}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedProvider.tags.map((tag) => (
                  <Badge
                    key={`detail-${selectedProvider.id}-${tag}`}
                    variant="secondary"
                    className="rounded-full bg-bg-secondary/80 px-2 py-0 text-[11px] font-medium text-muted-foreground"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-background/70 p-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {isZh ? "当前状态" : "Current state"}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                {t("bridge.providerReadOnlyHint")}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" disabled className="rounded-full px-4">
              <HugeiconsIcon icon={MessageMultiple01Icon} className="h-4 w-4" />
              {t("bridge.providerConfigureSoon")}
            </Button>
            <p className="text-[13px] text-muted-foreground">
              {isZh ? "这里只展示支持范围，不会写入任何配置。" : "This panel is showcase-only and does not write any configuration."}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

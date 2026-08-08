"use client";

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Info } from "lucide-react";
import { Loading02Icon, Plug01Icon } from "@hugeicons/core-free-icons";
import { AutomationHeader } from "@/components/automation/AutomationHeader";
import { AutomationToolbar, type RuntimeFilter } from "@/components/automation/AutomationToolbar";
import { useTranslation } from "@/hooks/useTranslation";
import { HookDetail } from "@/components/automation/HookDetail";
import { AutomationCatalogListItem } from "@/components/automation/AutomationCatalogListItem";
import type { HookItem } from "@/components/automation/types";

interface HooksResponse {
  hooks: HookItem[];
}

async function fetchHooks(): Promise<HooksResponse> {
  const res = await fetch("/api/hooks");
  if (!res.ok) {
    throw new Error("Failed to load hooks");
  }
  return res.json();
}

export function HooksManager() {
  const { t } = useTranslation();
  const [hooks, setHooks] = useState<HookItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");

  useEffect(() => {
    let mounted = true;

    void fetchHooks()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setHooks(data.hooks ?? []);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredHooks = useMemo(() => {
    return hooks.filter((hook) => {
      if (runtimeFilter !== "all" && hook.runtime !== runtimeFilter) {
        return false;
      }

      if (!searchQuery.trim()) {
        return true;
      }

      const query = searchQuery.trim().toLowerCase();
      return [
        hook.event,
        hook.matcher ?? "",
        hook.description,
        hook.filePath,
        ...hook.commands,
        ...hook.scripts.map((script) => script.scriptPath ?? ""),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [hooks, runtimeFilter, searchQuery]);

  const selectedHook = filteredHooks.find((hook) => hook.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm font-medium text-muted-foreground">{t("hooks.loading")}</span>
      </div>
    );
  }

  if (selectedHook) {
    return (
      <div className="flex h-full flex-col bg-background">
        <HookDetail hook={selectedHook} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  const runtimeGroups = [
    {
      key: "claude" as const,
      title: t("automation.runtime.claude"),
      items: filteredHooks.filter((hook) => hook.runtime === "claude"),
    },
    {
      key: "codex" as const,
      title: t("automation.runtime.codex"),
      items: filteredHooks.filter((hook) => hook.runtime === "codex"),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <AutomationHeader title={t("extensions.hooks")} description={t("hooks.description")} />

      <AutomationToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        runtimeFilter={runtimeFilter}
        onRuntimeFilterChange={setRuntimeFilter}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
        {runtimeGroups.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-16 text-center">
            <HugeiconsIcon icon={Plug01Icon} className="mb-4 h-12 w-12 text-muted-foreground/20" />
            <p className="text-[14px] font-bold text-foreground">{t("hooks.emptyTitle")}</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
              {t("hooks.empty")}
            </p>
          </div>
        ) : (
          <div className="space-y-10 pb-12">
            {runtimeGroups.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--info)]/10 text-[var(--info)]">
                    <HugeiconsIcon icon={Plug01Icon} className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-bold text-foreground">{group.title}</h2>
                  <span className="rounded-md bg-muted/20 px-1.5 py-0.5 text-xs text-muted-foreground/60">
                    {group.items.length}
                  </span>
                  <Info className="ml-1 h-3.5 w-3.5 cursor-help text-muted-foreground/40 transition-colors hover:text-muted-foreground" />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {group.items.map((hook) => (
                    <div key={hook.id}>
                      <AutomationCatalogListItem
                        title={hook.event}
                        description={hook.description}
                        icon={Plug01Icon}
                        iconClassName="bg-[var(--info)]/10 text-[var(--info)]"
                        badge={hook.matcher}
                        metaBadge={t("hooks.commandCount", { n: hook.commandCount })}
                        onClick={() => setSelectedId(hook.id)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

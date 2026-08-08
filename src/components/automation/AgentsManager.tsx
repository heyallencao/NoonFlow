"use client";

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Info } from "lucide-react";
import { CommandLineIcon, Loading02Icon } from "@hugeicons/core-free-icons";
import { AutomationHeader } from "@/components/automation/AutomationHeader";
import { AutomationToolbar, type RuntimeFilter } from "@/components/automation/AutomationToolbar";
import { useTranslation } from "@/hooks/useTranslation";
import { AgentDetail } from "@/components/automation/AgentDetail";
import { AutomationCatalogListItem } from "@/components/automation/AutomationCatalogListItem";
import type { AgentItem } from "@/components/automation/types";

interface AgentsResponse {
  agents: AgentItem[];
}

async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch("/api/agents");
  if (!res.ok) {
    throw new Error("Failed to load agents");
  }
  return res.json();
}

export function AgentsManager() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");

  useEffect(() => {
    let mounted = true;

    void fetchAgents()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setAgents(data.agents ?? []);
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

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      if (runtimeFilter !== "all" && agent.runtime !== runtimeFilter) {
        return false;
      }

      if (!searchQuery.trim()) {
        return true;
      }

      const query = searchQuery.trim().toLowerCase();
      return [
        agent.name,
        agent.description,
        agent.sourceName ?? "",
        agent.defaultPrompt ?? "",
        agent.filePath,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [agents, runtimeFilter, searchQuery]);

  const selectedAgent = filteredAgents.find((agent) => agent.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm font-medium text-muted-foreground">{t("agents.loading")}</span>
      </div>
    );
  }

  if (selectedAgent) {
    return (
      <div className="flex h-full flex-col bg-background">
        <AgentDetail agent={selectedAgent} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  const runtimeGroups = [
    {
      key: "claude" as const,
      title: t("automation.runtime.claude"),
      items: filteredAgents.filter((agent) => agent.runtime === "claude"),
    },
    {
      key: "codex" as const,
      title: t("automation.runtime.codex"),
      items: filteredAgents.filter((agent) => agent.runtime === "codex"),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <AutomationHeader title={t("extensions.agents")} description={t("agents.description")} />

      <AutomationToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        runtimeFilter={runtimeFilter}
        onRuntimeFilterChange={setRuntimeFilter}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
        {runtimeGroups.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-16 text-center">
            <HugeiconsIcon icon={CommandLineIcon} className="mb-4 h-12 w-12 text-muted-foreground/20" />
            <p className="text-[14px] font-bold text-foreground">{t("agents.emptyTitle")}</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
              {t("agents.empty")}
            </p>
          </div>
        ) : (
          <div className="space-y-10 pb-12">
            {runtimeGroups.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <HugeiconsIcon icon={CommandLineIcon} className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-bold text-foreground">{group.title}</h2>
                  <span className="rounded-md bg-muted/20 px-1.5 py-0.5 text-xs text-muted-foreground/60">
                    {group.items.length}
                  </span>
                  <Info className="ml-1 h-3.5 w-3.5 cursor-help text-muted-foreground/40 transition-colors hover:text-muted-foreground" />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {group.items.map((agent) => (
                    <div key={agent.id}>
                      <AutomationCatalogListItem
                        title={agent.name}
                        description={agent.description}
                        icon={CommandLineIcon}
                        iconClassName="bg-primary/10 text-primary"
                        badge={agent.sourceName}
                        metaBadge={agent.format.toUpperCase()}
                        onClick={() => setSelectedId(agent.id)}
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

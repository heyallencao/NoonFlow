"use client";

import { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

export type RuntimeFilter = "all" | "claude" | "codex";

interface AutomationToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  runtimeFilter: RuntimeFilter;
  onRuntimeFilterChange: (filter: RuntimeFilter) => void;
  extraFilters?: ReactNode;
}

export function AutomationToolbar({
  searchQuery,
  onSearchChange,
  runtimeFilter,
  onRuntimeFilterChange,
  extraFilters,
}: AutomationToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-bg-secondary/30 shrink-0">
      <div className="relative flex-1 max-w-sm">
        <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
        <Input 
          placeholder={t("automation.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 pl-9 text-[13px] bg-bg-primary border-border-subtle rounded-lg shadow-sm"
        />
      </div>

      <div className="flex items-center rounded-lg border border-border-subtle bg-bg-primary p-1 shadow-sm">
        {(["all", "claude", "codex"] as const).map(rt => (
          <button
            key={rt}
            onClick={() => onRuntimeFilterChange(rt)}
            className={cn(
              "px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all duration-200",
              runtimeFilter === rt 
                ? "bg-bg-hover text-foreground shadow-sm" 
                : "text-muted-foreground/70 hover:text-foreground hover:bg-bg-hover/50"
            )}
          >
            {rt === "all"
              ? t("automation.runtime.all")
              : rt === "claude"
                ? t("automation.runtime.claude")
                : t("automation.runtime.codex")}
          </button>
        ))}
      </div>

      {extraFilters && (
        <div className="flex items-center rounded-lg border border-border-subtle bg-bg-primary p-1 shadow-sm">
          {extraFilters}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import { MemoryRecentSessionsCard } from "@/components/memory/MemoryRecentSessionsCard";
import { Button } from "@/components/ui/button";

export default function MemoryPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["memory-recent-sessions"] });
    await queryClient.invalidateQueries({ queryKey: ["session-replays"] });
  }, [queryClient]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 sm:p-4 lg:p-6">
      <div className="mb-4 flex items-center justify-between sm:mb-5 lg:mb-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t("memory.title") || "Memory"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {t("memory.description") || "Review recent sessions and replay past automation context."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-transparent bg-bg-tertiary text-sidebar-foreground"
          onClick={() => {
            void refreshAll();
          }}
        >
          {t("memory.refresh") || "Refresh"}
        </Button>
      </div>

      <MemoryRecentSessionsCard />
    </div>
  );
}

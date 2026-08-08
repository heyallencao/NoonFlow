"use client";

import { AgentsManager } from "@/components/automation/AgentsManager";

export default function AgentsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <AgentsManager />
      </div>
    </div>
  );
}

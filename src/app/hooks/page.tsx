"use client";

import { HooksManager } from "@/components/automation/HooksManager";

export default function HooksPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <HooksManager />
      </div>
    </div>
  );
}

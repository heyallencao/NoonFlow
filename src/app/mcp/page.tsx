"use client";

import { McpManager } from "@/components/plugins/McpManager";

export default function McpPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
        <McpManager />
      </div>
    </div>
  );
}

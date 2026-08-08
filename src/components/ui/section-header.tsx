import * as React from "react";

import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, count, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-3 flex items-center justify-between", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
        {title}
        {typeof count === "number" ? (
          <span className="ml-1 text-sidebar-foreground/40">{count}</span>
        ) : null}
      </h3>
      {action}
    </div>
  );
}

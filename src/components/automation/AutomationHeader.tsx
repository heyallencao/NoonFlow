"use client";

import { ReactNode } from "react";

interface AutomationHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function AutomationHeader({ title, description, action }: AutomationHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 px-6 border-b border-border-subtle bg-bg-primary shrink-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {description}
        </p>
      </div>
      {action && (
        <div className="flex items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}

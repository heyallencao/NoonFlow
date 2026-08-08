import * as React from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type MetricCardVariant = "default" | "compact";

interface MetricCardProps {
  icon?: IconSvgElement;
  label: string;
  value: string | number;
  description?: string;
  loading?: boolean;
  trend?: React.ReactNode;
  className?: string;
  variant?: MetricCardVariant;
  indicatorClassName?: string;
}

export function MetricCard({
  icon,
  label,
  value,
  description,
  loading = false,
  trend,
  className,
  variant = "default",
  indicatorClassName,
}: MetricCardProps) {
  const isCompact = variant === "compact";

  if (isCompact) {
    return (
      <div
        className={cn(
          "relative flex min-h-[74px] sm:min-h-[78px] lg:min-h-[82px] flex-col items-center justify-center rounded-lg bg-bg-tertiary px-3 py-2 text-center shadow-[var(--shadow-xl)]",
          className,
        )}
      >
        {trend ? <div className="absolute right-3 top-2.5 shrink-0">{trend}</div> : null}

        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-[1.5rem] font-semibold leading-none tracking-[-0.03em] text-sidebar-foreground sm:text-[1.65rem]">
            {value}
          </div>
        )}

        <div className="mt-1.5 flex min-w-0 items-center justify-center gap-1.5 text-center">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-foreground/35",
              indicatorClassName,
            )}
          />
          <span className="line-clamp-1 text-[10px] font-medium text-sidebar-foreground/52 sm:text-[11px]">
            {label}
          </span>
        </div>

        {description ? (
          <span className="mt-0.5 line-clamp-1 text-[10px] text-sidebar-foreground/34">
            {description}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-24 flex-col rounded-md bg-bg-tertiary p-3 sm:min-h-28 sm:p-4 lg:min-h-32 lg:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <HugeiconsIcon icon={icon} className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60 sm:h-4 sm:w-4" />
          ) : null}
          <span className="truncate text-xs font-medium text-sidebar-foreground/60 sm:text-sm">{label}</span>
        </div>
        {trend ? <div className="shrink-0">{trend}</div> : null}
      </div>

      <div className="mt-2 min-h-11 text-3xl font-bold leading-none text-sidebar-foreground sm:text-4xl lg:text-5xl">
        {loading ? <Skeleton className="h-9 w-24" /> : value}
      </div>

      {description ? (
        <span className="mt-1 text-[10px] text-sidebar-foreground/50 sm:text-xs">{description}</span>
      ) : null}
    </div>
  );
}

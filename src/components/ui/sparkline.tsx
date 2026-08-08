import * as React from "react";

import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

function buildPath(data: number[], width: number, height: number): string {
  if (data.length === 0) return "";
  if (data.length === 1) return `M0 ${height / 2} L${width} ${height / 2}`;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);

  return data
    .map((value, index) => {
      const x = index * stepX;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({
  data,
  width = 70,
  height = 22,
  color = "currentColor",
  className,
}: SparklineProps) {
  const path = buildPath(data, width, height);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" />
    </svg>
  );
}

import { cn } from "@/lib/utils";

interface ProgressRingProps {
  value: number;  // 0-100
  max?: number;   // 默认 100
  size?: number;  // 默认 120
  strokeWidth?: number;  // 默认 8
  label?: string;
  className?: string;
}

export function ProgressRing({
  value,
  max = 100,
  size = 120,
  strokeWidth = 8,
  label,
  className
}: ProgressRingProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // 根据分数动态变化颜色
  const getColor = () => {
    if (percentage <= 40) return "#ef4444"; // red
    if (percentage <= 70) return "#fbbf24"; // yellow
    return "#10b981"; // green
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* 背景圆环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-default)"
          strokeWidth={strokeWidth}
        />
        {/* 进度圆环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
        {/* 中心文字 */}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-5xl font-bold fill-current transform rotate-90"
          style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          {Math.round(value)}
        </text>
      </svg>
      {label && (
        <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      )}
    </div>
  );
}

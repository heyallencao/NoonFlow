import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  variant: 'dirty' | 'unpushed' | 'feature' | 'stale' | 'success' | 'warning' | 'error' | 'info';
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  dirty: "bg-yellow-500/20 text-yellow-400",
  unpushed: "bg-red-500/20 text-red-400",
  feature: "bg-blue-500/20 text-blue-400",
  stale: "bg-gray-500/20 text-gray-400",
  success: "bg-green-500/20 text-green-400",
  warning: "bg-orange-500/20 text-orange-400",
  error: "bg-red-500/20 text-red-400",
  info: "bg-blue-500/20 text-blue-400",
};

export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-1 text-[10px] font-medium rounded leading-none",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

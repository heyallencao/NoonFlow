import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-6", className)}>
      <div className="h-12 w-12 text-muted-foreground">
        {icon}
      </div>

      <h3 className="mt-4 text-base font-semibold text-foreground">
        {title}
      </h3>

      {description && (
        <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
          {description}
        </p>
      )}

      {action && (
        <Button
          onClick={action.onClick}
          className="mt-4"
          size="sm"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

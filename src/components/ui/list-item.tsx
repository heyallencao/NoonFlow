import * as React from "react"
import { cn } from "@/lib/utils"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

export interface ListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  title: string
  subtitle?: string
  statusBadge?: React.ReactNode
  badges?: React.ReactNode[]
  onClick?: () => void
  showArrow?: boolean
}

export function ListItem({
  className,
  icon,
  title,
  subtitle,
  statusBadge,
  badges,
  onClick,
  showArrow = true,
  ...props
}: ListItemProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center px-3 py-1.5 hover:bg-bg-hover rounded-md transition-colors cursor-pointer group",
        className
      )}
      {...props}
    >
      {icon && <div className="mr-3 text-muted-foreground flex-shrink-0">{icon}</div>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 pl-2">
        {statusBadge}
        {badges && badges.length > 0 && (
          <div className="flex items-center gap-1.5">
            {badges.map((badge, index) => (
              <div key={index}>{badge}</div>
            ))}
          </div>
        )}
        {showArrow && (
          <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>
  )
}

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_4px_12px_var(--shadow-primary)] active:translate-y-0",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 hover:shadow-[0_4px_12px_var(--shadow-error)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        success:
          "bg-success text-success-foreground hover:bg-success/90 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_var(--shadow-success)] active:translate-y-0",
        warning:
          "bg-warning text-warning-foreground hover:bg-warning/90 hover:-translate-y-0.5 active:translate-y-0",
        info:
          "bg-info text-info-foreground hover:bg-info/90 hover:-translate-y-0.5 active:translate-y-0",
        outline:
          "border border-border bg-card/70 hover:bg-white/[0.06] hover:text-accent-foreground hover:-translate-y-0.5 hover:border-primary/30 active:translate-y-0",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        ghost:
          "hover:bg-white/[0.04] hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline hover:text-[var(--link-hover)]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const actionButtonVariants = cva(
  "h-7 rounded px-3 py-1 text-xs",
  {
    variants: {
      variant: {
        default: "border border-border-subtle bg-transparent hover:bg-white/[0.04]",
        destructive: "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        success: "border border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface ActionButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "variant">,
    VariantProps<typeof actionButtonVariants> {}

export function ActionButton({ className, variant, ...props }: ActionButtonProps) {
  return <Button variant="ghost" className={cn(actionButtonVariants({ variant }), className)} {...props} />;
}

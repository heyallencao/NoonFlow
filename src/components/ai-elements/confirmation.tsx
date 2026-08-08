"use client";

import type { ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContext, useContext } from "react";

type ToolUIPartApproval =
  | {
      id: string;
      approved?: never;
      reason?: never;
    }
  | {
      id: string;
      approved: boolean;
      reason?: string;
    }
  | {
      id: string;
      approved: true;
      reason?: string;
    }
  | {
      id: string;
      approved: true;
      reason?: string;
    }
  | {
      id: string;
      approved: false;
      reason?: string;
    }
  | undefined;

interface ConfirmationContextValue {
  approval: ToolUIPartApproval;
  state: ToolUIPart["state"];
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null
);

const useConfirmation = () => {
  const context = useContext(ConfirmationContext);

  if (!context) {
    throw new Error("Confirmation components must be used within Confirmation");
  }

  return context;
};

export type ConfirmationProps = ComponentProps<"div"> & {
  approval?: ToolUIPartApproval;
  state: ToolUIPart["state"];
};

export const Confirmation = ({
  className,
  approval,
  state,
  ...props
}: ConfirmationProps) => {
  if (!approval || state === "input-streaming" || state === "input-available") {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={{ approval, state }}>
      <div
        className={cn(
          "space-y-3 rounded-2xl border border-border-subtle/80 bg-bg-secondary/55 p-4 backdrop-blur-md shadow-[0_14px_34px_rgba(6,10,24,0.18)]",
          className
        )}
        {...props}
      />
    </ConfirmationContext.Provider>
  );
};

export type ConfirmationTitleProps = ComponentProps<"div">;

export const ConfirmationTitle = ({
  className,
  ...props
}: ConfirmationTitleProps) => (
  <div className={cn("text-[15px] font-semibold leading-6 text-foreground/95", className)} {...props} />
);

export interface ConfirmationRequestProps {
  children?: ReactNode;
}

export const ConfirmationRequest = ({ children }: ConfirmationRequestProps) => {
  const { state } = useConfirmation();

  // Only show when approval is requested
  if (state !== "approval-requested") {
    return null;
  }

  return children;
};

export interface ConfirmationAcceptedProps {
  children?: ReactNode;
}

export const ConfirmationAccepted = ({
  children,
}: ConfirmationAcceptedProps) => {
  const { approval, state } = useConfirmation();

  // Only show when approved and in response states
  if (
    !approval?.approved ||
    (state !== "approval-responded" &&
      state !== "output-denied" &&
      state !== "output-available")
  ) {
    return null;
  }

  return children;
};

export interface ConfirmationRejectedProps {
  children?: ReactNode;
}

export const ConfirmationRejected = ({
  children,
}: ConfirmationRejectedProps) => {
  const { approval, state } = useConfirmation();

  // Only show when rejected and in response states
  if (
    approval?.approved !== false ||
    (state !== "approval-responded" &&
      state !== "output-denied" &&
      state !== "output-available")
  ) {
    return null;
  }

  return children;
};

export type ConfirmationActionsProps = ComponentProps<"div">;

export const ConfirmationActions = ({
  className,
  ...props
}: ConfirmationActionsProps) => {
  const { state } = useConfirmation();

  // Only show when approval is requested
  if (state !== "approval-requested") {
    return null;
  }

  return (
    <div
      className={cn("flex items-center justify-end gap-2 self-end border-t border-border-subtle pt-3 mt-1", className)}
      {...props}
    />
  );
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = ({ className, variant, ...props }: ConfirmationActionProps) => (
  <Button
    className={cn(
      "h-9 rounded-lg px-4 text-xs font-medium transition-all duration-200",
      variant === "outline"
        ? "border-border-default bg-bg-primary/45 text-foreground/82 hover:bg-bg-tertiary"
        : "bg-primary/92 text-primary-foreground hover:bg-primary/84",
      className
    )}
    type="button"
    variant={variant}
    {...props}
  />
);

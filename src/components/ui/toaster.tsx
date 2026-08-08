'use client';

import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        classNames: {
          toast: 'bg-bg-secondary border-border-default text-sidebar-foreground',
          title: 'text-sidebar-foreground',
          description: 'text-sidebar-foreground/70',
          actionButton: 'bg-sidebar-primary text-sidebar-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          error: 'bg-destructive/10 border-destructive/30 text-destructive',
          success: 'bg-green-500/10 border-green-500/30 text-green-400',
          warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
        },
      }}
    />
  );
}

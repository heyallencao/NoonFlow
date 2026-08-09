'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import { Loading02Icon } from '@hugeicons/core-free-icons';
import type { AssistantRuntime } from '@/types';
import { useAssistantRuntimesQuery } from '@/lib/queries/assistant-runtime-queries';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface AssistantRuntimeSelectorProps {
  value: AssistantRuntime;
  disabled?: boolean;
  switchingRuntime?: AssistantRuntime | null;
  onChange: (runtime: AssistantRuntime) => void | Promise<void>;
}

export function AssistantRuntimeSelector({
  value,
  disabled = false,
  switchingRuntime = null,
  onChange,
}: AssistantRuntimeSelectorProps) {
  const runtimesQuery = useAssistantRuntimesQuery();
  const runtimes = runtimesQuery.data?.runtimes ?? [];
  const visibleRuntimes = runtimes.filter((runtime) => runtime.enabled || runtime.id === value);
  const currentRuntime = runtimes.find((runtime) => runtime.id === value);
  const claudeRuntime = runtimes.find((runtime) => runtime.id === 'claude_code');
  const canSwitchToClaude = Boolean(claudeRuntime?.enabled && claudeRuntime?.available);

  return (
    <div className="border-b border-border/50 px-4 py-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Assistant Runtime
          </p>
          <p className="mt-1 text-sm text-foreground">
            Switch the coding engine for this conversation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {visibleRuntimes.map((runtime) => {
            const isActive = runtime.id === value;
            const isSwitching = switchingRuntime === runtime.id;
            const canSelect = runtime.available || runtime.launchable;
            return (
              <button
                key={runtime.id}
                type="button"
                disabled={disabled || isSwitching || (!canSelect && !isActive)}
                onClick={() => onChange(runtime.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'border-foreground/20 bg-foreground text-background'
                    : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
                  (disabled || isSwitching || (!canSelect && !isActive)) && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    runtime.available ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                <span>{runtime.label}</span>
                {isSwitching && <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />}
              </button>
            );
          })}
        </div>
      </div>

      {currentRuntime && !currentRuntime.available && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {currentRuntime.label} is unavailable
            </p>
            <p className="text-sm text-muted-foreground">
              {currentRuntime.status_message || 'Check the runtime installation and settings.'}
            </p>
          </div>
          {value !== 'claude_code' && canSwitchToClaude && (
            <Button size="sm" variant="outline" onClick={() => onChange('claude_code')}>
              Switch to Claude Code
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

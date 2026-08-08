import type { AssistantRuntime } from '@/types';

export function getRuntimeLabel(runtime: string | AssistantRuntime): string {
  return runtime === 'codex' ? 'Codex' : 'Claude Code';
}

export function getRuntimeBadgeClassName(runtime: string | AssistantRuntime): string {
  return runtime === 'codex'
    ? 'bg-emerald-500/12 text-emerald-500'
    : 'bg-blue-500/12 text-blue-500';
}

export function getRuntimeBarClassName(runtime: string | AssistantRuntime): string {
  return runtime === 'codex' ? 'bg-emerald-500' : 'bg-blue-500';
}

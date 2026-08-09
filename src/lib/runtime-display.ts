import type { AssistantRuntime } from '@/types';

export function getRuntimeLabel(runtime: string | AssistantRuntime): string {
  if (runtime === 'codex') return 'Codex';
  if (runtime === 'pi') return 'Pi';
  return 'Claude Code';
}

export function getRuntimeBadgeClassName(runtime: string | AssistantRuntime): string {
  if (runtime === 'codex') return 'bg-emerald-500/12 text-emerald-500';
  if (runtime === 'pi') return 'bg-violet-500/12 text-violet-500';
  return 'bg-blue-500/12 text-blue-500';
}

export function getRuntimeBarClassName(runtime: string | AssistantRuntime): string {
  if (runtime === 'codex') return 'bg-emerald-500';
  if (runtime === 'pi') return 'bg-violet-500';
  return 'bg-blue-500';
}

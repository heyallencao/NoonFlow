'use client';

import { useMemo } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { useTranslation } from '@/hooks/useTranslation';
import { Activity01Icon } from '@hugeicons/core-free-icons';
import { ToolCallBlock } from '@/components/chat/ToolCallBlock';
import { buildToolExecutionSummaries, useRuntimeStore } from '@/stores/runtime-store';

interface ToolExecutionPanelProps {
  sessionId: string;
}

export function ToolExecutionPanel({ sessionId }: ToolExecutionPanelProps) {
  const { t } = useTranslation();
  const snapshot = useRuntimeStore((state) => state.snapshots[sessionId] ?? null);
  const tools = useMemo(() => buildToolExecutionSummaries(snapshot), [snapshot]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/55">
        <HugeiconsIcon icon={Activity01Icon} className="h-4 w-4 text-sidebar-foreground/75" />
        <span>{t('panel.tool')}</span>
      </div>

      {tools.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No tool executions yet.
        </p>
      ) : (
        <div className="space-y-2">
          {tools.map((tool) => (
            <ToolCallBlock
              key={`${tool.toolUseId}:${tool.status}`}
              name={tool.toolName}
              input={tool.input}
              result={tool.output || tool.streamingOutput}
              isError={tool.isError}
              status={tool.status === 'pending' ? 'running' : tool.status}
              duration={tool.durationMs}
            />
          ))}
        </div>
      )}
    </section>
  );
}

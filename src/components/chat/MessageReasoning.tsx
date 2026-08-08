'use client';

import { useMemo, useState } from 'react';

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { useTranslation } from '@/hooks/useTranslation';

const MAX_VISIBLE_REASONING_CHARS = 300;
const REASONING_CONTENT_CLASS_NAME = 'mt-2.5 text-[11px] leading-6 text-muted-foreground/80 [&_pre]:text-[10px] [&_pre_code]:text-[10px]';

export function shouldReasoningStartCollapsed(content: string, isStreaming: boolean): boolean {
  return !isStreaming && Array.from(content.trim()).length > MAX_VISIBLE_REASONING_CHARS;
}

interface MessageReasoningProps {
  content: string;
  isStreaming?: boolean;
}

export function MessageReasoning({
  content,
  isStreaming = false,
}: MessageReasoningProps) {
  const { t } = useTranslation();
  const trimmedContent = content.trim();
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const autoCollapsed = useMemo(
    () => shouldReasoningStartCollapsed(trimmedContent, isStreaming),
    [trimmedContent, isStreaming],
  );

  if (!trimmedContent) {
    return null;
  }

  // Let live reasoning stay open while streaming, then re-evaluate once the message
  // is persisted so long traces can collapse by default after completion.
  const isOpen = manualOpen ?? !autoCollapsed;

  return (
    <div className="relative">
      <Reasoning
        className="px-2 py-1.5"
        data-auto-collapsed={autoCollapsed ? 'true' : 'false'}
        data-testid="message-reasoning"
        defaultOpen={false}
        isStreaming={isStreaming}
        onOpenChange={setManualOpen}
        open={isOpen}
      >
        <ReasoningTrigger
          className="gap-2 text-[11px] text-muted-foreground/70 hover:text-muted-foreground/90"
          data-testid="message-reasoning-trigger"
          getThinkingMessage={(streaming, duration) => {
            if (streaming) {
              return t('reasoning.streaming');
            }
            if (typeof duration === 'number' && duration > 0) {
              return t('reasoning.duration', { seconds: duration });
            }
            return t('reasoning.summary');
          }}
        />
        <ReasoningContent
          className={REASONING_CONTENT_CLASS_NAME}
          data-testid="message-reasoning-content"
        >
          {trimmedContent}
        </ReasoningContent>
      </Reasoning>
    </div>
  );
}

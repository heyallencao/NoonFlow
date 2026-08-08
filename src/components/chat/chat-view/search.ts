import type { Message } from '@/types';
import { parseAssistantMessageContent } from '@/lib/message-content';

export const TERMINAL_DRAG_INPUT_CLEARANCE_PX = 8;
export const TERMINAL_PANEL_LAYOUT_OVERHEAD_PX = 14;
export const TERMINAL_PANEL_STACK_OVERHEAD_PX = 12;

function getSearchableMessageText(content: string): string {
  const withoutFileMeta = content.replace(/^<!--files:(.*?)-->\n?/, '');
  return withoutFileMeta
    .replace(/\[__IMAGE_GEN_NOTICE__[\s\S]*?\]/g, '')
    .trim();
}

function stripHiddenAssistantBlocks(text: string): string {
  return text
    .replace(/```image-gen-request[\s\S]*?```/g, '')
    .replace(/```image-gen-result[\s\S]*?```/g, '')
    .replace(/```batch-plan[\s\S]*?```/g, '')
    .trim();
}

export function getVisibleSearchTextForMessage(message: Message): string {
  const baseText = getSearchableMessageText(message.content);
  if (message.role !== 'assistant') {
    return baseText;
  }
  const { text } = parseAssistantMessageContent(baseText);
  return stripHiddenAssistantBlocks(text);
}

export function countSearchMatches(text: string, queryLower: string): number {
  if (!queryLower) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  const queryLength = queryLower.length;
  if (queryLength === 0 || normalizedText.length < queryLength) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor <= normalizedText.length - queryLength) {
    const foundIndex = normalizedText.indexOf(queryLower, cursor);
    if (foundIndex === -1) {
      break;
    }
    count += 1;
    cursor = foundIndex + queryLength;
  }
  return count;
}

export type SearchTarget =
  | { kind: 'chat'; messageId: string; occurrenceIndex: number }
  | { kind: 'streaming'; occurrenceIndex: number }
  | { kind: 'terminal'; matchIndex: number };

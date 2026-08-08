import {
  parseMessageContent,
  type MessageContentBlock,
  type StreamingMessageBlock,
  type ToolResultInfo,
  type ToolUseInfo,
} from '@/types';
import type { MessagePartInput, MessagePartRecord } from './db-core';

export interface ParsedToolBlock {
  type: 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  is_error?: boolean;
}

export interface ParsedAssistantMessageContent {
  reasoning: string;
  text: string;
  tools: ParsedToolBlock[];
  blocks: MessageContentBlock[]; // 保留原始顺序的 blocks
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parsePartMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function inferPartId(partKey: string | null, prefix: string): string | null {
  if (!partKey?.startsWith(prefix)) {
    return null;
  }

  const inferred = partKey.slice(prefix.length);
  return inferred.length > 0 ? inferred : null;
}

function toMessageContentBlock(part: MessagePartRecord): MessageContentBlock | null {
  const metadata = parsePartMetadata(part.metadata);

  if (part.part_type === 'text') {
    return { type: 'text', text: part.content };
  }

  if (part.part_type === 'reasoning') {
    return { type: 'reasoning', text: part.content };
  }

  if (part.part_type === 'tool_use') {
    const id = typeof metadata?.id === 'string'
      ? metadata.id
      : inferPartId(part.part_key, 'tool_use:');
    const name = typeof metadata?.name === 'string' ? metadata.name : 'unknown_tool';
    if (!id) {
      return null;
    }

    return {
      type: 'tool_use',
      id,
      name,
      input: parseJsonValue(part.content),
    };
  }

  if (part.part_type === 'tool_result') {
    const toolUseId = typeof metadata?.tool_use_id === 'string'
      ? metadata.tool_use_id
      : inferPartId(part.part_key, 'tool_result:');
    if (!toolUseId) {
      return null;
    }

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: part.content,
      is_error: metadata?.is_error === true,
    };
  }

  return null;
}

export function hasV2MessageParts(parts: Array<Pick<MessagePartRecord, 'part_key'>>): boolean {
  return parts.some((part) => typeof part.part_key === 'string' && part.part_key.trim().length > 0);
}

export function replayMessageContentFromParts(parts: MessagePartRecord[]): string | null {
  if (parts.length === 0) {
    return null;
  }

  const blocks: MessageContentBlock[] = [];
  const orderedParts = [...parts].sort((left, right) => {
    const leftIndex = Number.isInteger(left.part_index) ? left.part_index! : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isInteger(right.part_index) ? right.part_index! : Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    // Stable tiebreaker: insertion order via autoincrement id, then created_at
    if (left.id !== right.id) {
      return left.id - right.id;
    }
    return (left.created_at ?? 0) - (right.created_at ?? 0);
  });

  for (const part of orderedParts) {
    const block = toMessageContentBlock(part);
    if (!block) {
      return null;
    }
    blocks.push(block);
  }

  return serializeMessageContentBlocks(blocks);
}

export function resolveMessageContentFromParts({
  content,
  status,
  parts,
}: {
  content: string;
  status?: string | null;
  parts: MessagePartRecord[];
}): string {
  if (parts.length === 0) {
    return content;
  }

  const v2Parts = parts.filter((part) => typeof part.part_key === 'string' && part.part_key.trim().length > 0);
  const legacyParts = v2Parts.length > 0
    ? parts.filter((part) => !(typeof part.part_key === 'string' && part.part_key.trim().length > 0))
    : parts;

  const shouldPreferLegacyFallback = status === 'streaming'
    && v2Parts.length > 0
    && (legacyParts.length > 0 || content.trim().length > 0);

  if (v2Parts.length > 0 && !shouldPreferLegacyFallback && hasV2MessageParts(v2Parts)) {
    const replayed = replayMessageContentFromParts(v2Parts);
    if (replayed !== null) {
      return replayed;
    }
  }

  if (legacyParts.length > 0) {
    const replayed = replayMessageContentFromParts(legacyParts);
    if (replayed !== null) {
      return replayed;
    }
  }

  if (v2Parts.length > 0) {
    const replayed = replayMessageContentFromParts(v2Parts);
    if (replayed !== null) {
      return replayed;
    }
  }

  return content;
}

export function buildMessagePartInputs(
  contentBlocks: MessageContentBlock[],
  options?: {
    includeStableKeys?: boolean;
    revision?: number | null;
    isFinal?: boolean | null;
    updatedAt?: number | null;
  },
): MessagePartInput[] {
  const includeStableKeys = options?.includeStableKeys === true;
  const revision = options?.revision ?? null;
  const isFinal = options?.isFinal ?? null;
  const updatedAt = options?.updatedAt ?? null;
  let textIndex = 0;
  let reasoningIndex = 0;

  return contentBlocks.map((block, partIndex) => {
    if (block.type === 'text') {
      return {
        partType: 'text',
        content: block.text,
        metadata: null,
        partKey: includeStableKeys ? `text:${textIndex++}` : null,
        partIndex: includeStableKeys ? partIndex : null,
        revision,
        isFinal,
        updatedAt,
      };
    }

    if (block.type === 'reasoning') {
      return {
        partType: 'reasoning',
        content: block.text,
        metadata: null,
        partKey: includeStableKeys ? `reasoning:${reasoningIndex++}` : null,
        partIndex: includeStableKeys ? partIndex : null,
        revision,
        isFinal,
        updatedAt,
      };
    }

    if (block.type === 'tool_use') {
      return {
        partType: 'tool_use',
        content: JSON.stringify(block.input ?? null),
        metadata: { id: block.id, name: block.name },
        partKey: includeStableKeys ? `tool_use:${block.id}` : null,
        partIndex: includeStableKeys ? partIndex : null,
        revision,
        isFinal,
        updatedAt,
      };
    }

    if (block.type === 'tool_result') {
      return {
        partType: 'tool_result',
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        metadata: { tool_use_id: block.tool_use_id, is_error: block.is_error ?? false },
        partKey: includeStableKeys ? `tool_result:${block.tool_use_id}` : null,
        partIndex: includeStableKeys ? partIndex : null,
        revision,
        isFinal,
        updatedAt,
      };
    }

    return {
      partType: 'text',
      content: block.code,
      metadata: { language: block.language },
      partKey: includeStableKeys ? `text:${textIndex++}` : null,
      partIndex: includeStableKeys ? partIndex : null,
      revision,
      isFinal,
      updatedAt,
    };
  });
}

export function serializeMessageContentBlocks(contentBlocks: MessageContentBlock[]): string {
  const normalizedBlocks = contentBlocks.filter((block) => {
    if (block.type === 'text' || block.type === 'reasoning') {
      return block.text.trim().length > 0;
    }
    return true;
  });

  if (normalizedBlocks.length === 0) {
    return '';
  }

  const hasStructuredBlocks = normalizedBlocks.some((block) => block.type !== 'text');
  if (!hasStructuredBlocks) {
    return normalizedBlocks
      .filter((block): block is Extract<MessageContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  }

  return JSON.stringify(normalizedBlocks);
}

export function buildAssistantMessageContent({
  reasoning,
  text,
  toolUses = [],
  toolResults = [],
  streamingBlocks = [],
}: {
  reasoning?: string;
  text?: string;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingBlocks?: StreamingMessageBlock[];
}): string | null {
  if (streamingBlocks.length > 0) {
    const toolUseMap = new Map(toolUses.map((toolUse) => [toolUse.id, toolUse]));
    const toolResultMap = new Map(toolResults.map((toolResult) => [toolResult.tool_use_id, toolResult]));
    const seenToolUses = new Set<string>();
    const seenToolResults = new Set<string>();
    const contentBlocks: MessageContentBlock[] = [];

    for (const block of streamingBlocks) {
      if (block.type === 'text') {
        contentBlocks.push({ type: 'text', text: block.text });
        continue;
      }

      if (block.type === 'reasoning') {
        contentBlocks.push({ type: 'reasoning', text: block.text });
        continue;
      }

      const toolUse = toolUseMap.get(block.tool_use_id);
      if (toolUse && !seenToolUses.has(toolUse.id)) {
        seenToolUses.add(toolUse.id);
        contentBlocks.push({
          type: 'tool_use',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        });
      }

      const toolResult = toolResultMap.get(block.tool_use_id);
      if (toolResult && !seenToolResults.has(toolResult.tool_use_id)) {
        seenToolResults.add(toolResult.tool_use_id);
        contentBlocks.push({
          type: 'tool_result',
          tool_use_id: toolResult.tool_use_id,
          content: toolResult.content,
          is_error: toolResult.is_error,
        });
      }
    }

    for (const toolUse of toolUses) {
      if (seenToolUses.has(toolUse.id)) {
        continue;
      }
      seenToolUses.add(toolUse.id);
      contentBlocks.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
      });
    }

    for (const toolResult of toolResults) {
      if (seenToolResults.has(toolResult.tool_use_id)) {
        continue;
      }
      seenToolResults.add(toolResult.tool_use_id);
      contentBlocks.push({
        type: 'tool_result',
        tool_use_id: toolResult.tool_use_id,
        content: toolResult.content,
        is_error: toolResult.is_error,
      });
    }

    const content = serializeMessageContentBlocks(contentBlocks);
    return content || null;
  }

  const contentBlocks: MessageContentBlock[] = [];
  const trimmedReasoning = reasoning?.trim();
  const trimmedText = text?.trim();

  if (trimmedReasoning) {
    contentBlocks.push({ type: 'reasoning', text: trimmedReasoning });
  }

  if (trimmedText) {
    contentBlocks.push({ type: 'text', text: trimmedText });
  }

  const usedToolResultIds = new Set<string>();
  for (const toolUse of toolUses) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
    });

    const toolResult = toolResults.find((result) => result.tool_use_id === toolUse.id);
    if (toolResult) {
      usedToolResultIds.add(toolResult.tool_use_id);
      contentBlocks.push({
        type: 'tool_result',
        tool_use_id: toolResult.tool_use_id,
        content: toolResult.content,
        is_error: toolResult.is_error,
      });
    }
  }

  for (const toolResult of toolResults) {
    if (usedToolResultIds.has(toolResult.tool_use_id)) {
      continue;
    }
    contentBlocks.push({
      type: 'tool_result',
      tool_use_id: toolResult.tool_use_id,
      content: toolResult.content,
      is_error: toolResult.is_error,
    });
  }

  const content = serializeMessageContentBlocks(contentBlocks);
  return content || null;
}

export function parseAssistantMessageContent(content: string): ParsedAssistantMessageContent {
  const structuredBlocks = parseMessageContent(content);
  const isPlainTextFallback = structuredBlocks.length === 1
    && structuredBlocks[0].type === 'text'
    && structuredBlocks[0].text === content;

  if (!isPlainTextFallback) {
    let text = '';
    let reasoning = '';
    const tools: ParsedToolBlock[] = [];

    for (const block of structuredBlocks) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'reasoning') {
        reasoning += block.text;
      } else if (block.type === 'tool_use') {
        tools.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      } else if (block.type === 'tool_result') {
        tools.push({
          type: 'tool_result',
          id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        });
      }
    }

    return {
      reasoning: reasoning.trim(),
      text: text.trim(),
      tools,
      blocks: structuredBlocks, // 保留原始顺序
    };
  }

  const tools: ParsedToolBlock[] = [];
  let text = content;

  const toolUseRegex = /<!--tool_use:([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = toolUseRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        id?: string;
        name?: string;
        input?: unknown;
      };
      tools.push({ type: 'tool_use', ...parsed });
    } catch {
      // Ignore malformed legacy tool blocks.
    }
    text = text.replace(match[0], '');
  }

  const toolResultRegex = /<!--tool_result:([\s\S]*?)-->/g;
  while ((match = toolResultRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        id?: string;
        content?: string;
        is_error?: boolean;
      };
      tools.push({ type: 'tool_result', ...parsed });
    } catch {
      // Ignore malformed legacy tool blocks.
    }
    text = text.replace(match[0], '');
  }

  return {
    reasoning: '',
    text: text.trim(),
    tools,
    blocks: [{ type: 'text', text: text.trim() }], // fallback 情况
  };
}

export function pairToolBlocks(tools: ParsedToolBlock[]): Array<{
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
}> {
  const paired: Array<{
    name: string;
    input: unknown;
    result?: string;
    isError?: boolean;
  }> = [];

  const resultMap = new Map<string, ParsedToolBlock>();
  for (const tool of tools) {
    if (tool.type === 'tool_result' && tool.id) {
      resultMap.set(tool.id, tool);
    }
  }

  for (const tool of tools) {
    if (tool.type === 'tool_use' && tool.name) {
      const result = tool.id ? resultMap.get(tool.id) : undefined;
      paired.push({
        name: tool.name,
        input: tool.input,
        result: result?.content,
        isError: result?.is_error,
      });
    }
  }

  for (const tool of tools) {
    if (tool.type === 'tool_result' && !tools.some((entry) => entry.type === 'tool_use' && entry.id === tool.id)) {
      paired.push({
        name: 'tool_result',
        input: {},
        result: tool.content,
        isError: tool.is_error,
      });
    }
  }

  return paired;
}

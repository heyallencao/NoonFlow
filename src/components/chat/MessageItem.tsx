'use client';

import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import type {
  Message,
  TokenUsage,
  FileAttachment,
  MessageContentBlock,
  PermissionRequestEvent,
  ToolResultInfo,
  ToolUseInfo,
} from '@/types';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import { FileChangesSummary } from '@/components/ai-elements/file-changes-summary';
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick01Icon, ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { ImageGenConfirmation } from './ImageGenConfirmation';
import { ImageGenCard } from './ImageGenCard';
import { BatchPlanInlinePreview } from './batch-image-gen/BatchPlanInlinePreview';
import { WidgetRenderer } from './WidgetRenderer';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { buildReferenceImages } from '@/lib/image-ref-store';
import { pairToolBlocks, parseAssistantMessageContent } from '@/lib/message-content';
import { parseDBDate } from '@/lib/utils';
import { MessageReasoning } from './MessageReasoning';
import { buildDiffHunks } from '@/components/ai-elements/file-diff-utils';
import type { PlannerOutput } from '@/types';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useTranslation } from '@/hooks/useTranslation';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { StreamingAssistantSupplemental } from './StreamingMessage';
import { createWidgetTraceId } from '@/lib/widget-telemetry';
import { getTurnContextUsageTokens } from '@/lib/context-usage';
import {
  buildShowWidgetRenderPlan,
  hasWidgetProtocolCandidate,
  stripCompletedWidgetProtocolBlocks,
  stripTrailingWidgetProtocolBlocks,
} from '@/lib/widget-sanitizer';

interface FileChangeOperation {
  toolName: string;
  toolInput: unknown;
}

function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return '';
  const segments = normalized.split(/[./:]/).filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function getPatchTextFromToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (!input || typeof input !== 'object') {
    return '';
  }
  const payload = input as Record<string, unknown>;
  return String(payload.patch || payload.diff || payload.content || '');
}

function extractFilePathsFromPatch(patchText: string): string[] {
  if (!patchText) return [];
  const matches = patchText.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to):\s+(.+)$/gm);
  const files = new Set<string>();
  for (const match of matches) {
    const filePath = match[1]?.trim();
    if (filePath) {
      files.add(filePath);
    }
  }
  return Array.from(files);
}

function getFilePathsFromToolInput(input: unknown): string[] {
  if (!input || typeof input !== 'object') {
    if (typeof input === 'string') {
      return extractFilePathsFromPatch(input);
    }
    return [];
  }

  const payload = input as Record<string, unknown>;
  const changePaths = new Set<string>();
  const rawChanges = Array.isArray(payload.changes) ? payload.changes : [];
  for (const change of rawChanges) {
    if (!change || typeof change !== 'object') {
      continue;
    }
    const entry = change as Record<string, unknown>;
    const candidate = String(entry.path || entry.file_path || entry.filePath || entry.new_path || '').trim();
    if (candidate) {
      changePaths.add(candidate);
    }
  }
  if (changePaths.size > 0) {
    return Array.from(changePaths);
  }

  const direct = String(
    payload.file_path
      || payload.path
      || payload.filePath
      || payload.target_file
      || payload.targetFile
      || ''
  ).trim();
  if (direct) return [direct];
  return extractFilePathsFromPatch(getPatchTextFromToolInput(payload));
}

interface StructuredToolResultPayload {
  __noonflow_tool_result?: true;
  __monolith_tool_result?: true;
  output?: unknown;
  changed_files?: unknown;
}

function parseStructuredToolResult(result?: string): { output?: string; changedFiles: string[] } | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as StructuredToolResultPayload;
    if (!parsed || (parsed.__noonflow_tool_result !== true && parsed.__monolith_tool_result !== true)) {
      return null;
    }
    const changedFiles = new Set<string>();
    const source = parsed.changed_files;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item !== 'string') continue;
        const normalized = item.trim();
        if (normalized) changedFiles.add(normalized);
      }
    }
    return {
      output: typeof parsed.output === 'string' ? parsed.output : undefined,
      changedFiles: Array.from(changedFiles),
    };
  } catch {
    return null;
  }
}

function countUnifiedPatchStats(patch: string): { additions: number; deletions: number } {
  if (!patch) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (!line) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('***')) continue;
    if (line.startsWith('@@')) continue;
    if (line[0] === '+') additions += 1;
    if (line[0] === '-') deletions += 1;
  }
  return { additions, deletions };
}

function applyEditToContent(content: string, input: Record<string, unknown>): { applied: boolean; content: string } {
  const oldString = String(input.old_string || '');
  const newString = String(input.new_string || '');
  const replaceAll = Boolean(input.replace_all);

  if (!oldString) {
    return { applied: false, content };
  }

  if (!content.includes(oldString)) {
    return { applied: false, content };
  }

  if (replaceAll) {
    return {
      applied: true,
      content: content.split(oldString).join(newString),
    };
  }

  return {
    applied: true,
    content: content.replace(oldString, newString),
  };
}

function mergeDiffFragment(existing: string, next: string): string {
  if (!existing) return next;
  if (!next) return existing;
  if (existing.includes(next)) return existing;
  if (next.includes(existing)) return next;
  return `${existing}\n...\n${next}`;
}

interface ImageGenRequest {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  referenceImages?: string[];
  useLastGenerated?: boolean;
}

function parseImageGenRequest(text: string): { beforeText: string; request: ImageGenRequest; afterText: string } | null {
  const regex = /```image-gen-request\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    let raw = match[1].trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      // Attempt to fix common model output issues: unescaped quotes in values
      raw = raw.replace(/"prompt"\s*:\s*"([\s\S]*?)"\s*([,}])/g, (_m, val, tail) => {
        const escaped = val.replace(/(?<!\\)"/g, '\\"');
        return `"prompt": "${escaped}"${tail}`;
      });
      json = JSON.parse(raw);
    }
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      request: {
        prompt: String(json.prompt || ''),
        aspectRatio: String(json.aspectRatio || '1:1'),
        resolution: String(json.resolution || '1K'),
        referenceImages: Array.isArray(json.referenceImages) ? json.referenceImages : undefined,
        useLastGenerated: json.useLastGenerated === true,
      },
      afterText,
    };
  } catch {
    return null;
  }
}

interface ImageGenResultData {
  status: 'generating' | 'completed' | 'error';
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  model?: string;
  images?: Array<{ mimeType: string; localPath?: string; data?: string }>;
  error?: string;
}

function parseImageGenResult(text: string): { beforeText: string; result: ImageGenResultData; afterText: string } | null {
  const regex = /```image-gen-result\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      result: {
        status: json.status || 'completed',
        prompt: String(json.prompt || ''),
        aspectRatio: json.aspectRatio,
        resolution: json.resolution,
        model: json.model,
        images: Array.isArray(json.images) ? json.images : undefined,
        error: json.error,
      },
      afterText,
    };
  } catch {
    return null;
  }
}

function parseBatchPlan(text: string): { beforeText: string; plan: PlannerOutput; afterText: string } | null {
  const regex = /```batch-plan\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      plan: {
        summary: json.summary || '',
        items: Array.isArray(json.items) ? json.items.map((item: Record<string, unknown>) => ({
          prompt: String(item.prompt || ''),
          aspectRatio: String(item.aspectRatio || '1:1'),
          resolution: String(item.resolution || '1K'),
          tags: Array.isArray(item.tags) ? item.tags : [],
          sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
        })) : [],
      },
      afterText,
    };
  } catch {
    return null;
  }
}

interface MessageItemProps {
  message: Message;
  showReasoning?: boolean;
  generativeUIEnabled?: boolean;
  searchQuery?: string;
  activeSearchOccurrenceIndex?: number | null;
  streamingState?: MessageItemStreamingState;
}

interface MessageItemStreamingState {
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  statusText?: string;
  startedAt?: number;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => void;
  permissionResolved?: 'allow' | 'deny' | null;
  onForceStop?: () => void;
}

const CHAT_SEARCH_MARK_SELECTOR = 'mark[data-chat-search-highlight="true"]';

function clearSearchMarks(root: HTMLElement) {
  const marks = root.querySelectorAll<HTMLElement>(CHAT_SEARCH_MARK_SELECTOR);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  }
}

function highlightTextNode(
  node: Text,
  queryLower: string,
  queryLength: number,
  matchCursorRef: { value: number },
  activeOccurrenceIndex: number | null
) {
  const original = node.nodeValue || '';
  const lower = original.toLowerCase();
  let index = lower.indexOf(queryLower);
  if (index === -1) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  while (index !== -1) {
    if (index > cursor) {
      fragment.appendChild(document.createTextNode(original.slice(cursor, index)));
    }

    const mark = document.createElement('mark');
    mark.dataset.chatSearchHighlight = 'true';
    mark.dataset.chatSearchOccurrence = String(matchCursorRef.value);
    mark.className = 'chat-search-highlight';
    if (activeOccurrenceIndex !== null && matchCursorRef.value === activeOccurrenceIndex) {
      mark.classList.add('chat-search-highlight-active');
    }
    mark.textContent = original.slice(index, index + queryLength);
    fragment.appendChild(mark);
    matchCursorRef.value += 1;

    cursor = index + queryLength;
    index = lower.indexOf(queryLower, cursor);
  }

  if (cursor < original.length) {
    fragment.appendChild(document.createTextNode(original.slice(cursor)));
  }

  node.parentNode?.replaceChild(fragment, node);
}

function highlightSearchText(
  root: HTMLElement,
  searchQuery: string,
  activeOccurrenceIndex: number | null
) {
  clearSearchMarks(root);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return;
  }

  const queryLength = normalizedQuery.length;
  if (queryLength === 0) {
    return;
  }

  const showTextMask = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
  const walker = document.createTreeWalker(root, showTextMask);
  const textNodes: Text[] = [];
  const matchCursorRef = { value: 0 };
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (currentNode instanceof Text) {
      const parent = currentNode.parentElement;
      const shouldSkip = !parent
        || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)
        || Boolean(parent.closest('[data-chat-search-skip="true"]'));
      if (!shouldSkip && currentNode.nodeValue) {
        textNodes.push(currentNode);
      }
    }
    currentNode = walker.nextNode();
  }

  for (const node of textNodes) {
    highlightTextNode(node, normalizedQuery, queryLength, matchCursorRef, activeOccurrenceIndex);
  }
}

function parseUserMessageMetadata(content: string): {
  files: FileAttachment[];
  skillName: string | null;
  skillDescription: string | null;
  text: string;
} {
  let remaining = content;
  let files: FileAttachment[] = [];
  let skillName: string | null = null;
  let skillDescription: string | null = null;

  const filesMatch = remaining.match(/^<!--files:(.*?)-->\n?/);
  if (filesMatch) {
    try {
      files = JSON.parse(filesMatch[1]);
      remaining = remaining.slice(filesMatch[0].length);
    } catch {
      files = [];
    }
  }

  const skillMatch = remaining.match(/^<!--skill:(.*?)-->\n?/);
  if (skillMatch) {
    try {
      const skill = JSON.parse(skillMatch[1]) as { name?: string; description?: string };
      skillName = typeof skill.name === 'string' && skill.name.trim()
        ? skill.name.trim()
        : null;
      skillDescription = typeof skill.description === 'string' && skill.description.trim()
        ? skill.description.trim()
        : null;
      remaining = remaining.slice(skillMatch[0].length);
    } catch {
      skillName = null;
      skillDescription = null;
    }
  }

  return { files, skillName, skillDescription, text: remaining };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
      title="Copy"
    >
      {copied ? (
        <HugeiconsIcon icon={Tick01Icon} className="h-3 w-3 text-green-500" />
      ) : (
        <HugeiconsIcon icon={Copy01Icon} className="h-3 w-3" />
      )}
    </button>
  );
}

function TokenUsageDisplay({ usage }: { usage: TokenUsage }) {
  const totalTokens = getTurnContextUsageTokens(usage);
  const costStr = usage.cost_usd !== undefined && usage.cost_usd !== null
    ? ` · $${usage.cost_usd.toFixed(4)}`
    : '';

  return (
    <span className="group/tokens relative cursor-default text-xs text-muted-foreground/50">
      <span>{totalTokens.toLocaleString()} tokens{costStr}</span>
      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md border border-border/50 opacity-0 group-hover/tokens:opacity-100 transition-opacity duration-150 z-50">
        In: {usage.input_tokens.toLocaleString()} · Out: {usage.output_tokens.toLocaleString()}
        {usage.cache_read_input_tokens ? ` · Cache Read: ${usage.cache_read_input_tokens.toLocaleString()}` : ''}
        {usage.cache_creation_input_tokens ? ` · Cache Write: ${usage.cache_creation_input_tokens.toLocaleString()}` : ''}
        {costStr}
      </span>
    </span>
  );
}

const COLLAPSE_HEIGHT = 300;

export const MessageItem = memo(function MessageItem({
  message,
  showReasoning = false,
  generativeUIEnabled = true,
  searchQuery = '',
  activeSearchOccurrenceIndex = null,
  streamingState,
}: MessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';

  // Collapse/expand state for long user messages (hooks must be called unconditionally)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const assistantContentRef = useRef<HTMLDivElement>(null);

  // Memoize expensive parsing: structured message blocks + tool pairing
  const { reasoning, text, pairedTools, blocks } = useMemo(() => {
    const { reasoning, text, tools, blocks } = parseAssistantMessageContent(message.content);
    const pairedTools = pairToolBlocks(tools);
    return { reasoning, text, pairedTools, blocks };
  }, [message.content]);

  // Extract file changes from write/edit/patch and command tools
  const fileChanges = useMemo(() => {
    if (isUser) return [];

    const changeMap = new Map<string, {
      filePath: string;
      toolName: string;
      toolInput: unknown;
      operations: FileChangeOperation[];
      beforeContent: string;
      afterContent: string;
      diffNote?: string;
      patchText?: string;
    }>();

    for (const tool of pairedTools) {
      const name = normalizeToolName(tool.name);
      const isWriteTool = name === 'write' || name === 'create_file' || name === 'createfile';
      const isEditTool = name === 'edit' || name === 'multi_edit' || name === 'multiedit' || name === 'str_replace_editor';
      const isPatchTool = name === 'apply_patch' || name === 'applypatch';
      const isCommandTool = name === 'exec_command' || name === 'execute_command' || name === 'bash' || name === 'shell' || name === 'run';
      if ((!isWriteTool && !isEditTool && !isPatchTool && !isCommandTool) || tool.isError) {
        continue;
      }

      const rawInput = tool.input;
      const input = (rawInput && typeof rawInput === 'object') ? (rawInput as Record<string, unknown>) : {};
      const structuredResult = parseStructuredToolResult(tool.result);
      const filePaths = isCommandTool
        ? (structuredResult?.changedFiles || [])
        : getFilePathsFromToolInput(rawInput);
      if (filePaths.length === 0) {
        continue;
      }

      const patchText = getPatchTextFromToolInput(rawInput);
      for (const filePath of filePaths) {
        const operation = {
          toolName: tool.name,
          toolInput: tool.input,
        };

        const existing = changeMap.get(filePath);
        if (!existing) {
          if (isWriteTool) {
            changeMap.set(filePath, {
              filePath,
              toolName: tool.name,
              toolInput: tool.input,
              operations: [operation],
              beforeContent: '',
              afterContent: String(input.content || ''),
              patchText,
            });
          } else if (isCommandTool) {
            changeMap.set(filePath, {
              filePath,
              toolName: tool.name,
              toolInput: tool.input,
              operations: [operation],
              beforeContent: '',
              afterContent: '',
              patchText,
            });
          } else if (isPatchTool) {
            changeMap.set(filePath, {
              filePath,
              toolName: tool.name,
              toolInput: tool.input,
              operations: [operation],
              beforeContent: '',
              afterContent: '',
              patchText,
            });
          } else {
            changeMap.set(filePath, {
              filePath,
              toolName: tool.name,
              toolInput: tool.input,
              operations: [operation],
              beforeContent: String(input.old_string || ''),
              afterContent: String(input.new_string || ''),
              patchText,
            });
          }
          continue;
        }

        existing.toolName = tool.name;
        existing.toolInput = tool.input;
        existing.operations.push(operation);

        if (isCommandTool) {
          continue;
        }

        if (isWriteTool) {
          existing.afterContent = String(input.content || '');
          existing.diffNote = undefined;
          existing.patchText = patchText || existing.patchText || '';
          continue;
        }

        if (isPatchTool) {
          existing.patchText = patchText || existing.patchText || '';
          continue;
        }

        const applied = applyEditToContent(existing.afterContent, input);
        if (applied.applied) {
          existing.afterContent = applied.content;
          continue;
        }

        existing.beforeContent = mergeDiffFragment(existing.beforeContent, String(input.old_string || ''));
        existing.afterContent = mergeDiffFragment(existing.afterContent, String(input.new_string || ''));
        existing.diffNote = '当前展示本条回复的净变化片段';
      }
    }

    return Array.from(changeMap.values())
      .map((change) => {
        const { stats } = buildDiffHunks(change.beforeContent, change.afterContent);
        const patchText = change.patchText || '';
        const patchStats = countUnifiedPatchStats(patchText);
        const additions = stats.additions > 0 || stats.deletions > 0 ? stats.additions : patchStats.additions;
        const deletions = stats.additions > 0 || stats.deletions > 0 ? stats.deletions : patchStats.deletions;
        const hasPatchEvidence = patchText.trim().length > 0;
        const hasBeforeAfterEvidence = change.beforeContent !== change.afterContent;
        return {
          ...change,
          additions,
          deletions,
          hasPatchEvidence,
          hasBeforeAfterEvidence,
        };
      })
      .filter((change) => (
        change.additions > 0
        || change.deletions > 0
        || change.hasPatchEvidence
        || change.hasBeforeAfterEvidence
      ));
  }, [pairedTools, isUser]);

  // Memoize file attachment parsing
  const { files, skillName, skillDescription, displayText } = useMemo(() => {
    if (isUser) {
      const {
        files,
        skillName,
        skillDescription,
        text: textWithoutMetadata,
      } = parseUserMessageMetadata(text);
      return { files, skillName, skillDescription, displayText: textWithoutMetadata };
    }
    return { files: [] as FileAttachment[], skillName: null, skillDescription: null, displayText: text };
  }, [text, isUser]);

  const shouldHideImageGenNotice =
    isUser && message.content.startsWith('[__IMAGE_GEN_NOTICE__');
  const persistedMessageId = message.db_message_id || message.id;

  useEffect(() => {
    if (isUser && contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > COLLAPSE_HEIGHT);
    }
  }, [isUser, displayText]);

  useEffect(() => {
    const target = isUser ? contentRef.current : assistantContentRef.current;
    if (!target) {
      return;
    }

    highlightSearchText(target, searchQuery, activeSearchOccurrenceIndex);

    return () => {
      clearSearchMarks(target);
    };
  }, [isUser, searchQuery, activeSearchOccurrenceIndex, displayText, reasoning, message.id]);

  // Memoize token usage JSON parsing
  const tokenUsage = useMemo<TokenUsage | null>(() => {
    if (!message.token_usage) return null;
    try {
      return JSON.parse(message.token_usage);
    } catch {
      return null;
    }
  }, [message.token_usage]);

  const timestamp = parseDBDate(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleQuickCopy = useCallback(async () => {
    if (!displayText) return;
    try {
      await navigator.clipboard.writeText(displayText);
      setQuickCopied(true);
      setTimeout(() => setQuickCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  }, [displayText]);

  // Hide image-gen system notices — they exist in DB for Claude's context but shouldn't render
  if (shouldHideImageGenNotice) {
    return null;
  }

  return (
    <AIMessage from={isUser ? 'user' : 'assistant'}>
      <MessageContent>
        {/* File attachments for user messages */}
        {isUser && files.length > 0 && (
          <FileAttachmentDisplay files={files} />
        )}

        {isUser && skillName && (
          skillDescription ? (
            <HoverCard openDelay={100} closeDelay={700}>
              <HoverCardTrigger asChild>
                <div className="mb-2 inline-flex cursor-help items-center gap-2 rounded-lg border border-sky-500/35 bg-gradient-to-r from-sky-500/18 via-blue-500/14 to-indigo-500/12 px-2.5 py-1 text-xs text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_0_1px_rgba(56,189,248,0.12)] dark:text-sky-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(56,189,248,0.18)]">
                  <span className="rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                    Skill
                  </span>
                  <span className="font-mono">{skillName}</span>
                </div>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="start"
                className="z-[120] w-[min(36rem,calc(100vw-2rem))] max-w-[36rem] whitespace-pre-wrap break-words p-3 text-[11px] leading-relaxed"
              >
                {skillDescription}
              </HoverCardContent>
            </HoverCard>
          ) : (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-sky-500/35 bg-gradient-to-r from-sky-500/18 via-blue-500/14 to-indigo-500/12 px-2.5 py-1 text-xs text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_0_1px_rgba(56,189,248,0.12)] dark:text-sky-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(56,189,248,0.18)]">
              <span className="rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                Skill
              </span>
              <span className="font-mono">{skillName}</span>
            </div>
          )
        )}

        {/* User message text */}
        {isUser && displayText && (
          <div
            className="relative inline-block max-w-full"
            onDoubleClick={handleQuickCopy}
            title="Double click to copy"
          >
            <div
              ref={contentRef}
              className="text-sm whitespace-pre-wrap break-words transition-[max-height] duration-300 ease-in-out overflow-hidden"
              style={
                isOverflowing && !isExpanded
                  ? { maxHeight: `${COLLAPSE_HEIGHT}px` }
                  : undefined
              }
            >
              {displayText}
            </div>
            {isOverflowing && !isExpanded && (
              <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-foreground/[0.05] to-transparent pointer-events-none" />
            )}
            {isOverflowing && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="relative z-10 flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-[11px] font-medium bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-all duration-200"
              >
                {isExpanded ? (
                  <>
                    <HugeiconsIcon icon={ArrowUp01Icon} className="h-3 w-3" />
                    <span>收起消息</span>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3" />
                    <span>展开完整消息</span>
                  </>
                )}
              </button>
            )}
            {quickCopied && (
              <span className="pointer-events-none absolute -top-5 right-0 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm">
                Copied
              </span>
            )}
          </div>
        )}

        {/* Assistant message - render blocks in order */}
        {!isUser && (
            <MessageBlocksRenderer
              blocks={blocks}
              pairedTools={pairedTools}
              showReasoning={showReasoning}
              generativeUIEnabled={generativeUIEnabled}
              sessionId={message.session_id}
              messageId={message.id}
              persistedMessageId={persistedMessageId}
              assistantContentRef={assistantContentRef}
            streamingState={streamingState}
            thinkingLabel={t('streaming.thinking')}
          />
        )}

        {!isUser && streamingState && (
          <StreamingAssistantSupplemental
            isStreaming={streamingState.isStreaming}
            toolUses={streamingState.toolUses}
            toolResults={streamingState.toolResults}
            streamingToolOutput={streamingState.streamingToolOutput}
            statusText={streamingState.statusText}
            startedAt={streamingState.startedAt}
            pendingPermission={streamingState.pendingPermission}
            onPermissionResponse={streamingState.onPermissionResponse}
            permissionResolved={streamingState.permissionResolved}
            onForceStop={streamingState.onForceStop}
          />
        )}

        {/* File changes summary - shown after text content for assistant messages */}
        {!isUser && fileChanges.length > 0 && (
          <FileChangesSummary messageId={message.id} changes={fileChanges} />
        )}
      </MessageContent>

      {/* Footer with copy, timestamp and token usage */}
      <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}>
        {!isUser && <span className="text-xs text-muted-foreground/50">{timestamp}</span>}
        {!isUser && tokenUsage && <TokenUsageDisplay usage={tokenUsage} />}
        {displayText && <CopyButton text={displayText} />}
      </div>
    </AIMessage>
  );
});

/**
 * 按照原始顺序渲染消息块
 */
const MessageBlocksRenderer = memo(function MessageBlocksRenderer({
  blocks,
  pairedTools,
  showReasoning,
  generativeUIEnabled,
  sessionId,
  messageId,
  persistedMessageId,
  assistantContentRef,
  streamingState,
  thinkingLabel,
}: {
  blocks: MessageContentBlock[];
  pairedTools: Array<{ name: string; input: unknown; result?: string; isError?: boolean }>;
  showReasoning: boolean;
  generativeUIEnabled: boolean;
  sessionId: string;
  messageId: string;
  persistedMessageId: string;
  assistantContentRef: React.RefObject<HTMLDivElement | null>;
  streamingState?: MessageItemStreamingState;
  thinkingLabel: string;
}) {
  const isStreaming = streamingState?.isStreaming ?? false;

  // 创建 tool_use_id 到 paired tool 的映射
  const toolMap = useMemo(() => {
    const map = new Map<string, { name: string; input: unknown; result?: string; isError?: boolean }>();
    let toolIndex = 0;
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        if (toolIndex < pairedTools.length) {
          map.set(block.id, pairedTools[toolIndex]);
          toolIndex++;
        }
      }
    }
    return map;
  }, [blocks, pairedTools]);

  // 按照原始顺序渲染，不合并连续的 tools
  const renderBlocks = useMemo(() => {
    const result: Array<{ type: 'tool' | 'text' | 'reasoning'; content: unknown; id?: string }> = [];

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const tool = toolMap.get(block.id);
        if (tool) {
          result.push({
            type: 'tool',
            id: block.id,
            content: {
              id: block.id,
              name: tool.name,
              input: tool.input,
              result: tool.result,
              isError: tool.isError,
            },
          });
        }
      } else if (block.type === 'text') {
        result.push({ type: 'text', content: block.text });
      } else if (block.type === 'reasoning') {
        result.push({ type: 'reasoning', content: block.text });
      }
    }

    return result;
  }, [blocks, toolMap]);

  const getBlockWrapperClass = useCallback(
    (
      type: 'tool' | 'text' | 'reasoning',
      prevType: 'tool' | 'text' | 'reasoning' | null
    ) => {
      const spacing = !prevType
        ? ''
        : type === 'reasoning'
          ? (prevType === 'text' ? 'mt-4' : 'mt-3')
          : type === 'tool'
            ? (prevType === 'text' ? 'mt-2.5' : 'mt-1.5')
            : (prevType === 'reasoning' ? 'mt-4' : 'mt-3');

      const inset = type === 'text' ? 'pl-[1.35rem]' : '';
      const rail = type === 'tool' || type === 'reasoning'
        ? 'border-l border-border/35 pl-3'
        : '';

      return `${spacing} ${rail} ${inset}`.trim();
    },
    []
  );

  return (
    <div ref={assistantContentRef}>
      {renderBlocks.map((item, index) => {
        const prevType = index > 0 ? renderBlocks[index - 1]?.type ?? null : null;
        const wrapperClass = getBlockWrapperClass(item.type, prevType);

        if (item.type === 'reasoning' && showReasoning) {
          return (
            <div key={`reasoning-${index}`} className={wrapperClass}>
              <MessageReasoning
                content={item.content as string}
                isStreaming={isStreaming && index === renderBlocks.length - 1}
              />
            </div>
          );
        }
        if (item.type === 'tool') {
          const tool = item.content as { id: string; name: string; input: unknown; result?: string; isError?: boolean };
          return (
            <div key={item.id || `tool-${index}`} className={wrapperClass}>
              <ToolActionsGroup
                tools={[tool]}
                isStreaming={isStreaming}
                streamingToolOutput={streamingState?.streamingToolOutput}
              />
            </div>
          );
        }
        if (item.type === 'text') {
          return (
            <div key={`text-${index}`} className={wrapperClass}>
              <AssistantContent
                displayText={item.content as string}
                generativeUIEnabled={generativeUIEnabled}
                sessionId={sessionId}
                messageId={messageId}
                persistedMessageId={persistedMessageId}
                liveStreaming={isStreaming && index === renderBlocks.length - 1}
                thinkingLabel={thinkingLabel}
              />
            </div>
          );
        }
        return null;
      })}

      {isStreaming && renderBlocks.length === 0 && !streamingState?.pendingPermission && (
        <div className="py-2">
          <Shimmer>{thinkingLabel}</Shimmer>
        </div>
      )}
    </div>
  );
});

/**
 * Memoized assistant message content — avoids re-running parseBatchPlan / parseImageGenResult /
 * parseImageGenRequest on every render when only unrelated props change.
 */
const AssistantContent = memo(function AssistantContent({
  displayText,
  generativeUIEnabled,
  sessionId,
  messageId,
  persistedMessageId,
  liveStreaming = false,
  thinkingLabel,
}: {
  displayText: string;
  generativeUIEnabled: boolean;
  sessionId: string;
  messageId: string;
  persistedMessageId: string;
  liveStreaming?: boolean;
  thinkingLabel: string;
}) {
  const { t } = useTranslation();

  return useMemo(() => {
    const hasShowWidget = generativeUIEnabled && hasWidgetProtocolCandidate(displayText);
    if (hasShowWidget) {
      const traceId = createWidgetTraceId(`${sessionId}:${messageId}`);
      const widgetPlan = buildShowWidgetRenderPlan(displayText, {
        liveStreaming,
        telemetry: {
          sessionId,
          messageId,
          traceId,
        },
      });

      if (widgetPlan.widgetCount > 0 || widgetPlan.hasIncompleteWidget || widgetPlan.hasMalformedWidget) {
        return (
          <>
            {widgetPlan.hasMalformedWidget && (
              <div
                className="my-2 rounded-lg border border-amber-300/80 bg-amber-50/85 px-3 py-2 text-xs text-amber-900 dark:border-amber-600/60 dark:bg-amber-950/35 dark:text-amber-200"
                data-widget-invalid="true"
              >
                {t('widget.invalid')}
              </div>
            )}
            {widgetPlan.parts.map((part, index) => (
              part.type === 'text'
                ? (
                    /\S/.test(part.text)
                      ? <MessageResponse key={`widget-text-${index}`}>{part.text}</MessageResponse>
                      : null
                  )
                : (
                    <WidgetErrorBoundary
                      key={`${part.key}-${index}`}
                      fallbackLabel={t('widget.fallback')}
                      sessionId={sessionId}
                      messageId={messageId}
                      traceId={traceId}
                    >
                      <WidgetRenderer
                        widgetKey={part.key}
                        title={part.title}
                        widgetCode={part.widgetCode}
                        isStreaming={liveStreaming}
                        sessionId={sessionId}
                        messageId={messageId}
                        traceId={traceId}
                        className="my-2"
                      />
                    </WidgetErrorBoundary>
                  )
            ))}
            {widgetPlan.hasIncompleteWidget && (
              <Shimmer>{thinkingLabel}</Shimmer>
            )}
          </>
        );
      }
    }

    // Try batch-plan first (Image Agent batch mode)
    const batchPlanResult = parseBatchPlan(displayText);
    if (batchPlanResult) {
      return (
        <>
          {batchPlanResult.beforeText && <MessageResponse>{batchPlanResult.beforeText}</MessageResponse>}
          <BatchPlanInlinePreview plan={batchPlanResult.plan} messageId={messageId} />
          {batchPlanResult.afterText && <MessageResponse>{batchPlanResult.afterText}</MessageResponse>}
        </>
      );
    }

    // Try image-gen-result first (new direct-call format)
    const genResult = parseImageGenResult(displayText);
    if (genResult) {
      const { result } = genResult;
      if (result.status === 'generating') {
        return (
          <>
            {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
            <div className="flex items-center gap-2 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm text-muted-foreground">Generating image...</span>
            </div>
            {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
          </>
        );
      }
      if (result.status === 'error') {
        return (
          <>
            {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
            <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
              <p className="text-sm text-red-600 dark:text-red-400">{result.error || 'Image generation failed'}</p>
            </div>
            {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
          </>
        );
      }
      if (result.status === 'completed' && result.images && result.images.length > 0) {
        return (
          <>
            {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
            <ImageGenCard
              images={result.images.map(img => ({
                data: img.data || '',
                mimeType: img.mimeType,
                localPath: img.localPath,
              }))}
              prompt={result.prompt}
              aspectRatio={result.aspectRatio}
              imageSize={result.resolution}
              model={result.model}
            />
            {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
          </>
        );
      }
    }

    // Legacy: image-gen-request (model-dependent format, for old messages)
    const parsed = parseImageGenRequest(displayText);
    if (parsed) {
      const refs = buildReferenceImages(
        messageId,
        parsed.request.useLastGenerated || false,
        parsed.request.referenceImages,
      );
      return (
        <>
          {parsed.beforeText && <MessageResponse>{parsed.beforeText}</MessageResponse>}
          <ImageGenConfirmation
            messageId={persistedMessageId}
            initialPrompt={parsed.request.prompt}
            initialAspectRatio={parsed.request.aspectRatio}
            initialResolution={parsed.request.resolution}
            referenceImages={refs.length > 0 ? refs : undefined}
          />
          {parsed.afterText && <MessageResponse>{parsed.afterText}</MessageResponse>}
        </>
      );
    }

    if (liveStreaming) {
      const hasImageGenBlock = /```image-gen-request/.test(displayText);
      const hasBatchPlanBlock = /```batch-plan/.test(displayText);
      const hasWidgetBlock = generativeUIEnabled && hasWidgetProtocolCandidate(displayText);
      let stripped = displayText
        .replace(/```image-gen-request[\s\S]*$/, '')
        .replace(/```batch-plan[\s\S]*$/, '')
        .trim();
      if (generativeUIEnabled) {
        stripped = stripTrailingWidgetProtocolBlocks(stripped).trim();
      }
      if (stripped) {
        return <MessageResponse>{stripped}</MessageResponse>;
      }
      if (hasImageGenBlock || hasBatchPlanBlock || hasWidgetBlock) {
        return <Shimmer>{thinkingLabel}</Shimmer>;
      }
      return null;
    }

    const stripped = displayText
      .replace(/```image-gen-request[\s\S]*?```/g, '')
      .replace(/```image-gen-result[\s\S]*?```/g, '')
      .replace(/```batch-plan[\s\S]*?```/g, '')
      .trim();
    const finalStripped = generativeUIEnabled
      ? stripCompletedWidgetProtocolBlocks(stripped).trim()
      : stripped;
    return finalStripped ? <MessageResponse>{finalStripped}</MessageResponse> : null;
  }, [displayText, generativeUIEnabled, liveStreaming, messageId, persistedMessageId, sessionId, t, thinkingLabel]);
});

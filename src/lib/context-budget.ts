import { parseMessageContent, type FileAttachment } from '@/types';

export interface ContextBudgetLimits {
  warningLimit: number;
  softLimit: number;
  hardLimit: number;
}

export interface ConversationHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextBudgetBreakdown {
  total: number;
  system: number;
  history: number;
  tools: number;
  user: number;
  metadata: number;
  bytes: number;
  utilizationPct: number;
  warningLimit: number;
  softLimit: number;
  hardLimit: number;
  stage: 'green' | 'warning' | 'soft' | 'hard';
}

export interface ContextBudgetNotice {
  title: string;
  message: string;
}

export interface PreparedConversationContext {
  conversationHistory: ConversationHistoryEntry[];
  initialBreakdown: ContextBudgetBreakdown;
  breakdown: ContextBudgetBreakdown;
  limits: ContextBudgetLimits;
  statusNotice: ContextBudgetNotice | null;
  nativeResumeActive: boolean;
  officialCompactAttempted: boolean;
  localCompactionAttempted: boolean;
  compactionApplied: boolean;
  hardTrimApplied: boolean;
}

interface RenderVariant {
  content: string;
  historyChars: number;
  toolChars: number;
}

interface RenderPreset {
  userTextMaxChars: number;
  assistantTextMaxChars: number;
  codeBlockMaxChars: number;
  toolResultMaxChars: number;
  attachmentNameLimit: number;
  includeToolUse: boolean;
  includeCodePlaceholder: boolean;
  fallbackPlaceholder: string;
}

type VariantName = 'full' | 'soft' | 'hard' | 'minimal' | 'drop';

interface HistoryMessageState {
  role: 'user' | 'assistant';
  selectedVariant: VariantName;
  protected: boolean;
  variants: Record<VariantName, RenderVariant>;
}

interface ComputeBreakdownParams {
  limits: ContextBudgetLimits;
  selectedHistory: HistoryMessageState[];
  prompt: string;
  systemPrompt?: string;
  files?: FileAttachment[];
  useConversationHistory: boolean;
  includeSystemPrompt: boolean;
  runtime: 'claude' | 'codex';
}

interface PrepareConversationContextParams {
  runtime: 'claude' | 'codex';
  prompt: string;
  systemPrompt?: string;
  conversationHistory?: ConversationHistoryEntry[];
  files?: FileAttachment[];
  useConversationHistory: boolean;
  includeSystemPrompt: boolean;
  nativeResumeActive?: boolean;
  limits?: Partial<ContextBudgetLimits>;
}

const FILE_METADATA_COMMENT = /^<!--files:(.*?)-->\n?/;
const RECENT_USER_CONTEXT_WINDOW = 6;
const TOOL_ERROR_LINE = /(error|exception|failed|failure|traceback|enoent|eacces|econn|timeout|429|403|401)/i;

const DEFAULT_CONTEXT_BUDGET_LIMITS: ContextBudgetLimits = Object.freeze({
  warningLimit: 700_000,
  softLimit: 850_000,
  hardLimit: 1_048_576,
});

const VARIANT_PRESETS: Record<Exclude<VariantName, 'drop'>, RenderPreset> = {
  full: {
    userTextMaxChars: 3_200,
    assistantTextMaxChars: 2_800,
    codeBlockMaxChars: 1_600,
    toolResultMaxChars: 500,
    attachmentNameLimit: 6,
    includeToolUse: true,
    includeCodePlaceholder: false,
    fallbackPlaceholder: '[Earlier message omitted]',
  },
  soft: {
    userTextMaxChars: 1_400,
    assistantTextMaxChars: 1_000,
    codeBlockMaxChars: 560,
    toolResultMaxChars: 220,
    attachmentNameLimit: 4,
    includeToolUse: true,
    includeCodePlaceholder: true,
    fallbackPlaceholder: '[Earlier message summarized for context budget]',
  },
  hard: {
    userTextMaxChars: 700,
    assistantTextMaxChars: 420,
    codeBlockMaxChars: 220,
    toolResultMaxChars: 120,
    attachmentNameLimit: 3,
    includeToolUse: true,
    includeCodePlaceholder: true,
    fallbackPlaceholder: '[Earlier message heavily summarized for context budget]',
  },
  minimal: {
    userTextMaxChars: 140,
    assistantTextMaxChars: 120,
    codeBlockMaxChars: 0,
    toolResultMaxChars: 40,
    attachmentNameLimit: 2,
    includeToolUse: false,
    includeCodePlaceholder: false,
    fallbackPlaceholder: '[Earlier message trimmed]',
  },
};

const DROPPED_VARIANT: RenderVariant = Object.freeze({
  content: '',
  historyChars: 0,
  toolChars: 0,
});

function parseLimitOverride(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getContextBudgetLimits(
  overrides?: Partial<ContextBudgetLimits>,
): ContextBudgetLimits {
  const warningLimit = overrides?.warningLimit
    ?? parseLimitOverride(process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT, DEFAULT_CONTEXT_BUDGET_LIMITS.warningLimit)
    ?? parseLimitOverride(process.env.MONOLITH_CONTEXT_BUDGET_WARNING_LIMIT, DEFAULT_CONTEXT_BUDGET_LIMITS.warningLimit);
  const softLimit = overrides?.softLimit
    ?? parseLimitOverride(process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT, DEFAULT_CONTEXT_BUDGET_LIMITS.softLimit)
    ?? parseLimitOverride(process.env.MONOLITH_CONTEXT_BUDGET_SOFT_LIMIT, DEFAULT_CONTEXT_BUDGET_LIMITS.softLimit);
  const hardLimit = overrides?.hardLimit
    ?? parseLimitOverride(process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT, DEFAULT_CONTEXT_BUDGET_LIMITS.hardLimit)
    ?? parseLimitOverride(process.env.MONOLITH_CONTEXT_BUDGET_HARD_LIMIT, DEFAULT_CONTEXT_BUDGET_LIMITS.hardLimit);

  const normalizedWarning = Math.min(warningLimit, hardLimit);
  const normalizedSoft = Math.min(Math.max(softLimit, normalizedWarning), hardLimit);

  return {
    warningLimit: normalizedWarning,
    softLimit: normalizedSoft,
    hardLimit,
  };
}

export function estimateChars(value: string): number {
  return value.length;
}

function estimateBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function stageFromTotal(
  total: number,
  limits: ContextBudgetLimits,
): ContextBudgetBreakdown['stage'] {
  if (total >= limits.hardLimit) return 'hard';
  if (total >= limits.softLimit) return 'soft';
  if (total >= limits.warningLimit) return 'warning';
  return 'green';
}

function truncateMiddle(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (maxChars <= 0 || !normalized) {
    return '';
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 24) {
    return normalized.slice(0, maxChars);
  }

  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head - 17;
  return `${normalized.slice(0, head)}\n...[trimmed]...\n${normalized.slice(-tail)}`;
}

function extractAttachmentSummary(
  rawContent: string,
  attachmentNameLimit: number,
): { remaining: string; summary: string } {
  const match = rawContent.match(FILE_METADATA_COMMENT);
  if (!match) {
    return { remaining: rawContent, summary: '' };
  }

  const remaining = rawContent.slice(match[0].length);
  try {
    const files = JSON.parse(match[1]) as Array<{ name?: string }>;
    const names = files
      .map((file) => file?.name?.trim())
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) {
      return { remaining, summary: '' };
    }

    const visibleNames = names.slice(0, attachmentNameLimit);
    const suffix = names.length > attachmentNameLimit
      ? `, +${names.length - attachmentNameLimit} more`
      : '';
    return {
      remaining,
      summary: `[Attached files: ${visibleNames.join(', ')}${suffix}]`,
    };
  } catch {
    return { remaining, summary: '[Attached files]' };
  }
}

function unwrapStructuredToolResult(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      __noonflow_tool_result?: boolean;
      __monolith_tool_result?: boolean;
      output?: unknown;
      changed_files?: unknown;
    };
    if (!parsed || (parsed.__noonflow_tool_result !== true && parsed.__monolith_tool_result !== true)) {
      return content;
    }

    const parts: string[] = [];
    if (parsed.output !== undefined) {
      if (typeof parsed.output === 'string') {
        parts.push(parsed.output);
      } else {
        parts.push(JSON.stringify(parsed.output));
      }
    }
    if (Array.isArray(parsed.changed_files) && parsed.changed_files.length > 0) {
      const files = parsed.changed_files
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(0, 8);
      if (files.length > 0) {
        parts.push(`Changed files: ${files.join(', ')}`);
      }
    }

    return parts.join('\n').trim() || content;
  } catch {
    return content;
  }
}

function summarizeToolResult(content: string, maxChars: number): string {
  const normalized = unwrapStructuredToolResult(content).trim();
  if (!normalized) {
    return '[empty]';
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const importantLines = lines
    .filter((line) => TOOL_ERROR_LINE.test(line))
    .slice(0, 3)
    .join('\n');

  if (!importantLines) {
    return truncateMiddle(normalized, maxChars);
  }

  const reserved = Math.min(Math.max(importantLines.length + 18, 64), Math.floor(maxChars * 0.55));
  const headBudget = Math.max(48, maxChars - reserved);
  const head = truncateMiddle(normalized, headBudget);
  return truncateMiddle(`${head}\n[important]\n${importantLines}`, maxChars);
}

function buildCodeBlock(language: string, code: string): string {
  const normalizedLanguage = language.trim() || 'text';
  return `\`\`\`${normalizedLanguage}\n${code}\n\`\`\``;
}

function renderMessageVariant(
  role: 'user' | 'assistant',
  rawContent: string,
  preset: RenderPreset,
): RenderVariant {
  const { remaining, summary } = extractAttachmentSummary(rawContent, preset.attachmentNameLimit);
  const segments: Array<{ kind: 'history' | 'tool'; text: string }> = [];

  if (summary) {
    segments.push({ kind: 'history', text: summary });
  }

  const contentBlocks = parseMessageContent(remaining);
  for (const block of contentBlocks) {
    switch (block.type) {
      case 'text': {
        const maxChars = role === 'assistant'
          ? preset.assistantTextMaxChars
          : preset.userTextMaxChars;
        const text = truncateMiddle(block.text, maxChars);
        if (text) {
          segments.push({ kind: 'history', text });
        }
        break;
      }
      case 'reasoning':
        break;
      case 'code': {
        if (preset.codeBlockMaxChars > 0) {
          const codeBlock = buildCodeBlock(block.language, block.code);
          const text = truncateMiddle(codeBlock, preset.codeBlockMaxChars);
          if (text) {
            segments.push({ kind: 'history', text });
          }
        } else if (preset.includeCodePlaceholder) {
          segments.push({ kind: 'history', text: '[Code block omitted]' });
        }
        break;
      }
      case 'tool_use':
        if (preset.includeToolUse) {
          segments.push({
            kind: 'history',
            text: `[Used tool: ${block.name}]`,
          });
        }
        break;
      case 'tool_result': {
        const result = summarizeToolResult(block.content, preset.toolResultMaxChars);
        if (result) {
          segments.push({
            kind: 'tool',
            text: block.is_error
              ? `[Tool error: ${result}]`
              : `[Tool result: ${result}]`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  if (segments.length === 0) {
    const fallback = truncateMiddle(remaining, role === 'assistant'
      ? preset.assistantTextMaxChars
      : preset.userTextMaxChars);
    const fallbackText = fallback || preset.fallbackPlaceholder;
    segments.push({ kind: 'history', text: fallbackText });
  }

  const toolText = segments
    .filter((segment) => segment.kind === 'tool')
    .map((segment) => segment.text)
    .join('\n');
  const content = segments.map((segment) => segment.text).join('\n').trim();
  const toolChars = toolText.length;

  return {
    content,
    historyChars: Math.max(content.length - toolChars, 0),
    toolChars,
  };
}

function buildMessageStates(
  history: ConversationHistoryEntry[],
): HistoryMessageState[] {
  const userIndexes = history.reduce<number[]>((indexes, message, index) => {
    if (message.role === 'user') {
      indexes.push(index);
    }
    return indexes;
  }, []);

  const protectedStartIndex = userIndexes.length > RECENT_USER_CONTEXT_WINDOW
    ? userIndexes[userIndexes.length - RECENT_USER_CONTEXT_WINDOW] ?? history.length
    : 0;

  return history.map((message, index) => ({
    role: message.role,
    selectedVariant: 'full',
    protected: index >= protectedStartIndex,
    variants: {
      full: renderMessageVariant(message.role, message.content, VARIANT_PRESETS.full),
      soft: renderMessageVariant(message.role, message.content, VARIANT_PRESETS.soft),
      hard: renderMessageVariant(message.role, message.content, VARIANT_PRESETS.hard),
      minimal: renderMessageVariant(message.role, message.content, VARIANT_PRESETS.minimal),
      drop: DROPPED_VARIANT,
    },
  }));
}

function getFileReferenceMetadata(
  runtime: 'claude' | 'codex',
  files?: FileAttachment[],
): string {
  if (!files || files.length === 0) {
    return '';
  }

  if (runtime === 'codex') {
    const refs = files
      .map((file) => file.filePath || file.name)
      .filter(Boolean);
    if (refs.length === 0) {
      return '';
    }
    return `<attached_files>\n${refs.join('\n')}\n</attached_files>`;
  }

  const refs = files
    .map((file) => file.filePath || file.name)
    .filter(Boolean)
    .map((ref) => `[Attached file: ${ref}]`);
  return refs.join('\n');
}

function buildHistoryPayload(
  selectedHistory: HistoryMessageState[],
): string {
  const rendered = selectedHistory
    .map((message) => {
      const selected = message.variants[message.selectedVariant].content.trim();
      if (!selected) {
        return '';
      }
      const speaker = message.role === 'user' ? 'Human' : 'Assistant';
      return `${speaker}: ${selected}`;
    })
    .filter(Boolean);

  if (rendered.length === 0) {
    return '';
  }

  return `<conversation_history>\n${rendered.join('\n')}\n</conversation_history>`;
}

function computeBreakdown(
  params: ComputeBreakdownParams,
): ContextBudgetBreakdown {
  const {
    limits,
    selectedHistory,
    prompt,
    systemPrompt,
    files,
    useConversationHistory,
    includeSystemPrompt,
    runtime,
  } = params;

  let history = 0;
  let tools = 0;
  if (useConversationHistory) {
    for (const message of selectedHistory) {
      const variant = message.variants[message.selectedVariant];
      if (!variant.content) {
        continue;
      }
      const rolePrefix = message.role === 'user' ? 'Human: ' : 'Assistant: ';
      history += rolePrefix.length + variant.historyChars + 1;
      tools += variant.toolChars;
    }
  }

  const system = includeSystemPrompt ? estimateChars(systemPrompt || '') : 0;
  const user = estimateChars(prompt);
  const historyPayload = useConversationHistory ? buildHistoryPayload(selectedHistory) : '';
  const fileMetadata = getFileReferenceMetadata(runtime, files);
  // Count only the XML wrapper tags as overhead; the rendered content chars are already
  // accumulated into the `history` / `system` variables above, so we avoid double-counting.
  const metadata = estimateChars(fileMetadata)
    + (historyPayload ? '<conversation_history>\n\n</conversation_history>'.length : 0)
    + (includeSystemPrompt && runtime === 'codex' && system > 0 ? '<system_prompt>\n\n</system_prompt>'.length : 0);

  const serializedPayload = [
    includeSystemPrompt ? systemPrompt || '' : '',
    historyPayload,
    fileMetadata,
    prompt,
  ].filter(Boolean).join('\n\n');

  const total = system + history + tools + user + metadata;
  const utilizationPct = Math.min(
    999,
    Math.round((total / limits.hardLimit) * 100),
  );

  return {
    total,
    system,
    history,
    tools,
    user,
    metadata,
    bytes: estimateBytes(serializedPayload),
    utilizationPct,
    warningLimit: limits.warningLimit,
    softLimit: limits.softLimit,
    hardLimit: limits.hardLimit,
    stage: stageFromTotal(total, limits),
  };
}

function downgradeStates(
  states: HistoryMessageState[],
  nextVariant: VariantName,
  limit: number,
  breakdownFactory: () => ContextBudgetBreakdown,
  predicate: (state: HistoryMessageState) => boolean,
): boolean {
  let changed = false;

  for (const state of states) {
    if (!predicate(state) || state.selectedVariant === nextVariant) {
      continue;
    }

    const currentVariant = state.variants[state.selectedVariant];
    const candidateVariant = state.variants[nextVariant];
    if (candidateVariant.content === currentVariant.content) {
      state.selectedVariant = nextVariant;
      continue;
    }

    state.selectedVariant = nextVariant;
    changed = true;
    if (breakdownFactory().total <= limit) {
      break;
    }
  }

  return changed;
}

function buildStatusNotice(
  initialBreakdown: ContextBudgetBreakdown,
  compactionAttempted: boolean,
): ContextBudgetNotice | null {
  if (compactionAttempted) {
    return {
      title: '正在压缩上下文',
      message: `上下文接近限制（${initialBreakdown.utilizationPct}%），系统正在自动压缩并继续当前请求。`,
    };
  }

  if (initialBreakdown.stage === 'warning') {
    return {
      title: '上下文占比偏高',
      message: `上下文占比偏高（${initialBreakdown.utilizationPct}%），系统将自动优化后续上下文。`,
    };
  }

  return null;
}

export function prepareConversationContext(
  params: PrepareConversationContextParams,
): PreparedConversationContext {
  const limits = getContextBudgetLimits(params.limits);
  const selectedHistory = buildMessageStates(params.conversationHistory || []);
  const hasHistoryToCompact = selectedHistory.some((message) => message.variants.full.content.length > 0);
  const computeCurrentBreakdown = () => computeBreakdown({
    limits,
    selectedHistory,
    prompt: params.prompt,
    systemPrompt: params.systemPrompt,
    files: params.files,
    useConversationHistory: params.useConversationHistory,
    includeSystemPrompt: params.includeSystemPrompt,
    runtime: params.runtime,
  });

  const initialBreakdown = computeCurrentBreakdown();
  let compactionApplied = false;
  let hardTrimApplied = false;
  const localCompactionAttempted = params.useConversationHistory
    && hasHistoryToCompact
    && initialBreakdown.total >= limits.softLimit;

  if (localCompactionAttempted) {
    compactionApplied = downgradeStates(
      selectedHistory,
      'soft',
      limits.softLimit,
      computeCurrentBreakdown,
      (state) => !state.protected && (state.role === 'assistant' || state.variants.full.toolChars > 0),
    ) || compactionApplied;

    if (computeCurrentBreakdown().total > limits.softLimit) {
      compactionApplied = downgradeStates(
        selectedHistory,
        'soft',
        limits.softLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'user',
      ) || compactionApplied;
    }

    if (computeCurrentBreakdown().total > limits.softLimit) {
      compactionApplied = downgradeStates(
        selectedHistory,
        'soft',
        limits.softLimit,
        computeCurrentBreakdown,
        (state) => state.protected && state.role === 'assistant',
      ) || compactionApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'hard',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'assistant',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'hard',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'user',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'hard',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => state.protected && state.role === 'assistant',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'hard',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => state.protected && state.role === 'user',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'minimal',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'assistant',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'minimal',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'user',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'minimal',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => state.protected && state.role === 'assistant',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'minimal',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => state.protected && state.role === 'user',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'drop',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'assistant',
      ) || hardTrimApplied;
    }

    if (computeCurrentBreakdown().total > limits.hardLimit) {
      hardTrimApplied = downgradeStates(
        selectedHistory,
        'drop',
        limits.hardLimit,
        computeCurrentBreakdown,
        (state) => !state.protected && state.role === 'user',
      ) || hardTrimApplied;
    }
  }

  const breakdown = computeCurrentBreakdown();
  const conversationHistory = params.useConversationHistory
    ? selectedHistory
        .map((message) => {
          const content = message.variants[message.selectedVariant].content.trim();
          if (!content) {
            return null;
          }
          return {
            role: message.role,
            content,
          } satisfies ConversationHistoryEntry;
        })
        .filter((message): message is ConversationHistoryEntry => Boolean(message))
    : [];

  return {
    conversationHistory,
    initialBreakdown,
    breakdown,
    limits,
    statusNotice: buildStatusNotice(initialBreakdown, localCompactionAttempted),
    nativeResumeActive: params.nativeResumeActive === true,
    officialCompactAttempted: false,
    localCompactionAttempted,
    compactionApplied,
    hardTrimApplied,
  };
}

export function buildContextBudgetLogFields(
  context: PreparedConversationContext,
  historyBeforeCount: number,
): Record<string, number | string | boolean> {
  return {
    compiled_input_chars: context.breakdown.total,
    system_chars: context.breakdown.system,
    history_chars: context.breakdown.history,
    tool_output_chars: context.breakdown.tools,
    user_chars: context.breakdown.user,
    metadata_chars: context.breakdown.metadata,
    compiled_input_bytes: context.breakdown.bytes,
    budget_utilization_pct: context.breakdown.utilizationPct,
    warning_limit: context.breakdown.warningLimit,
    soft_limit: context.breakdown.softLimit,
    hard_limit: context.breakdown.hardLimit,
    // warning/soft_limit_hit use the *pre-compaction* breakdown to reflect whether
    // local compaction was triggered (the intent is "did this request hit the limit?").
    // hard_limit_hit uses the *post-compaction* breakdown to reflect whether the
    // request actually failed to fit within the hard limit after all recovery attempts.
    warning_limit_hit: context.initialBreakdown.total >= context.limits.warningLimit,
    soft_limit_hit: context.initialBreakdown.total >= context.limits.softLimit,
    hard_limit_hit: context.breakdown.total >= context.limits.hardLimit,
    native_resume_active: context.nativeResumeActive,
    official_compact_attempted: context.officialCompactAttempted,
    local_compaction_attempted: context.localCompactionAttempted,
    local_compaction_applied: context.compactionApplied,
    hard_trim_applied: context.hardTrimApplied,
    history_messages_before: historyBeforeCount,
    history_messages_after: context.conversationHistory.length,
    budget_stage_before: context.initialBreakdown.stage,
    budget_stage_after: context.breakdown.stage,
  };
}

export function isContextLimitExceededError(message: string): boolean {
  return /Input exceeds the maximum length of 1048576 characters/i.test(message)
    || /turn\/start failed: Input exceeds the maximum length/i.test(message);
}

export function formatContextLimitExceededMessage(params: {
  breakdown: ContextBudgetBreakdown;
  nativeResumeActive?: boolean;
  officialCompactAttempted?: boolean;
  localCompactionAttempted?: boolean;
}): string {
  const {
    breakdown,
    nativeResumeActive = false,
    officialCompactAttempted = false,
    localCompactionAttempted = false,
  } = params;

  return [
    `本轮上下文超出限制（compiled_input_chars=${breakdown.total}，hard_limit=${breakdown.hardLimit}）。`,
    localCompactionAttempted
      ? '系统已自动尝试压缩上下文，但仍未降到安全范围。'
      : '当前请求在发送前已命中硬限制，且没有足够的可压缩历史。', // The exact failure mode matters for user recovery.
    `预算明细：system=${breakdown.system}，history=${breakdown.history}，tool_output=${breakdown.tools}，user=${breakdown.user}，metadata=${breakdown.metadata}，utilization=${breakdown.utilizationPct}%。`,
    `自动策略：native_resume_active=${nativeResumeActive}，official_compact_attempted=${officialCompactAttempted}，local_compaction_attempted=${localCompactionAttempted}。`,
    '建议：精简输入为“目标 + 文件路径 + 必要片段（<=200 行）”；如仍失败，可先执行 `/compact` 或新开会话继续。',
  ].join('\n');
}

export function normalizeContextLimitErrorMessage(
  message: string,
  breakdown?: ContextBudgetBreakdown,
): string {
  if (!isContextLimitExceededError(message)) {
    return message;
  }

  if (!breakdown) {
    return [
      '本轮上下文超出限制（hard_limit=1048576 chars）。',
      '建议：精简输入为“目标 + 文件路径 + 必要片段（<=200 行）”，必要时先执行 `/compact` 或新开会话继续。',
    ].join('\n');
  }

  return formatContextLimitExceededMessage({ breakdown });
}

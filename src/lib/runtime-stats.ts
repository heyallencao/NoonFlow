import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { decodeProjectPath, getClaudeProjectsDir } from '@/lib/claude-session-parser';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CACHE_TTL_MS = 30_000;

type AssistantRuntime = 'claude_code' | 'codex';

interface SessionStatsRecord {
  runtime: AssistantRuntime;
  sessionId: string;
  title: string;
  workingDirectory: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  userMessageCount: number;
  assistantMessageCount: number;
  messageCount: number;
}

interface UsageStatsRecord {
  runtime: AssistantRuntime;
  sessionId: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number | null;
}

type CostSource = 'actual' | 'estimated';
type CostMode = 'actual' | 'estimated' | 'mixed' | 'none';

interface ModelTokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreationPerMillion: number;
}

interface CostAccumulator {
  totalCost: number;
  actualCost: number;
  estimatedCost: number;
  actualRecords: number;
  estimatedRecords: number;
}

interface PricingReferenceRule {
  name: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreationPerMillion: number;
}

interface ToolCallStatsRecord {
  runtime: AssistantRuntime;
  sessionId: string;
  timestamp: string;
  toolName: string;
  input: unknown;
  isError: boolean;
  error: string | null;
}

interface RuntimeStatsDataset {
  sessions: SessionStatsRecord[];
  usage: UsageStatsRecord[];
  toolCalls: ToolCallStatsRecord[];
}

interface CachedDataset {
  expiresAt: number;
  dataset: RuntimeStatsDataset;
}

interface ClaudeSessionFile {
  sessionId: string;
  projectPath: string;
  filePath: string;
}

interface CodexThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  model_provider: string;
  model: string | null;
  cwd: string;
  title: string;
  tokens_used: number;
}

interface MutableToolCall {
  runtime: AssistantRuntime;
  sessionId: string;
  timestamp: string;
  toolName: string;
  input: unknown;
  isError: boolean;
  error: string | null;
}

interface CodexTokenTotals {
  input: number;
  output: number;
  cached: number;
}

let cachedDataset: CachedDataset | null = null;

const DEFAULT_CLAUDE_PRICING: ModelTokenPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,
  cacheCreationPerMillion: 3,
};

const DEFAULT_CODEX_PRICING: ModelTokenPricing = {
  inputPerMillion: 5,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.5,
  cacheCreationPerMillion: 5,
};

const MODEL_PRICING_RULES: Array<{ pattern: RegExp; pricing: Partial<ModelTokenPricing> }> = [
  {
    pattern: /(claude[-_ ]*)?opus/i,
    pricing: {
      inputPerMillion: 15,
      outputPerMillion: 75,
      cacheReadPerMillion: 1.5,
      cacheCreationPerMillion: 15,
    },
  },
  {
    pattern: /(claude[-_ ]*)?haiku/i,
    pricing: {
      inputPerMillion: 0.8,
      outputPerMillion: 4,
      cacheReadPerMillion: 0.08,
      cacheCreationPerMillion: 0.8,
    },
  },
  {
    pattern: /(claude[-_ ]*)?sonnet/i,
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.3,
      cacheCreationPerMillion: 3,
    },
  },
  {
    pattern: /gpt-5|codex|gpt-4o|gpt-4\.1|o4-mini|o3/i,
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.5,
      cacheCreationPerMillion: 5,
    },
  },
  {
    pattern: /minimax|qwen|glm|kimi|deepseek|moonshot/i,
    pricing: {
      inputPerMillion: 2,
      outputPerMillion: 8,
      cacheReadPerMillion: 0.2,
      cacheCreationPerMillion: 2,
    },
  },
];

const PRICING_REFERENCE_RULES: PricingReferenceRule[] = [
  {
    name: 'Claude Sonnet (估算)',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheCreationPerMillion: 3,
  },
  {
    name: 'Claude Opus (估算)',
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheCreationPerMillion: 15,
  },
  {
    name: 'Claude Haiku (估算)',
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheCreationPerMillion: 0.8,
  },
  {
    name: 'OpenAI / Codex 系列(估算)',
    inputPerMillion: 5,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.5,
    cacheCreationPerMillion: 5,
  },
  {
    name: '其他兼容模型(估算)',
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.2,
    cacheCreationPerMillion: 2,
  },
];

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function toIsoDateTime(value: string | number | Date): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }
  return parsed.toISOString();
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfLocalWeek(date: Date): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  return start;
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function buildLocalDateRange(length: number, endDate: Date): string[] {
  return Array.from({ length }, (_, index) => {
    const date = startOfLocalDay(endDate);
    date.setDate(date.getDate() - (length - index - 1));
    return toLocalDateKey(date);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function resolveModelPricing(model: string, runtime: AssistantRuntime): ModelTokenPricing {
  const fallback = runtime === 'codex' ? DEFAULT_CODEX_PRICING : DEFAULT_CLAUDE_PRICING;
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    return fallback;
  }

  for (const rule of MODEL_PRICING_RULES) {
    if (!rule.pattern.test(normalizedModel)) {
      continue;
    }
    return {
      inputPerMillion: rule.pricing.inputPerMillion ?? fallback.inputPerMillion,
      outputPerMillion: rule.pricing.outputPerMillion ?? fallback.outputPerMillion,
      cacheReadPerMillion: rule.pricing.cacheReadPerMillion ?? fallback.cacheReadPerMillion,
      cacheCreationPerMillion: rule.pricing.cacheCreationPerMillion ?? fallback.cacheCreationPerMillion,
    };
  }

  return fallback;
}

function estimateCostUsd(record: UsageStatsRecord): number {
  const pricing = resolveModelPricing(record.model, record.runtime);
  const tokenToMillion = 1_000_000;
  const inputCost = (record.inputTokens / tokenToMillion) * pricing.inputPerMillion;
  const outputCost = (record.outputTokens / tokenToMillion) * pricing.outputPerMillion;
  const cacheReadCost = (record.cacheReadInputTokens / tokenToMillion) * pricing.cacheReadPerMillion;
  const cacheCreationCost = (record.cacheCreationInputTokens / tokenToMillion) * pricing.cacheCreationPerMillion;

  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

function resolveCost(record: UsageStatsRecord): { cost: number; source: CostSource } {
  if (record.costUsd !== null && Number.isFinite(record.costUsd) && record.costUsd >= 0) {
    return { cost: record.costUsd, source: 'actual' };
  }
  return { cost: estimateCostUsd(record), source: 'estimated' };
}

function createCostAccumulator(): CostAccumulator {
  return {
    totalCost: 0,
    actualCost: 0,
    estimatedCost: 0,
    actualRecords: 0,
    estimatedRecords: 0,
  };
}

function accumulateCost(accumulator: CostAccumulator, resolution: { cost: number; source: CostSource }): void {
  accumulator.totalCost += resolution.cost;
  if (resolution.source === 'actual') {
    accumulator.actualCost += resolution.cost;
    accumulator.actualRecords += 1;
  } else {
    accumulator.estimatedCost += resolution.cost;
    accumulator.estimatedRecords += 1;
  }
}

function getCostMode(accumulator: CostAccumulator): CostMode {
  if (accumulator.actualRecords === 0 && accumulator.estimatedRecords === 0) {
    return 'none';
  }
  if (accumulator.actualRecords > 0 && accumulator.estimatedRecords > 0) {
    return 'mixed';
  }
  return accumulator.actualRecords > 0 ? 'actual' : 'estimated';
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  const raw = getString(value);
  if (!raw) {
    return fallback;
  }
  const normalized = toIsoDateTime(raw);
  if (normalized === new Date(0).toISOString()) {
    return fallback;
  }
  return normalized;
}

function truncate(text: string, maxLength: number = 120): string {
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function shouldSkipCodexUserMessage(text: string): boolean {
  return text.startsWith('# AGENTS.md instructions for ')
    || text.startsWith('<environment_context>')
    || text.includes('\n<INSTRUCTIONS>\n');
}

function readJsonlLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter((line) => line.trim());
}

function listClaudeSessionFiles(): ClaudeSessionFile[] {
  const projectsDir = getClaudeProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const result: ClaudeSessionFile[] = [];
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsDir, entry.name);
    const decodedPath = decodeProjectPath(entry.name);
    let files: string[] = [];
    try {
      files = fs.readdirSync(projectDir);
    } catch {
      continue;
    }

    for (const fileName of files) {
      if (!fileName.endsWith('.jsonl')) {
        continue;
      }
      result.push({
        sessionId: fileName.slice(0, -'.jsonl'.length),
        projectPath: decodedPath,
        filePath: path.join(projectDir, fileName),
      });
    }
  }

  return result;
}

function resolveCodexStateDbPath(): string | null {
  const codexDir = path.join(os.homedir(), '.codex');
  if (!fs.existsSync(codexDir)) {
    return null;
  }

  try {
    const candidates = fs.readdirSync(codexDir)
      .filter((name) => /^state_\d+\.sqlite$/.test(name))
      .map((name) => {
        const filePath = path.join(codexDir, name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    return candidates[0]?.filePath ?? null;
  } catch {
    return null;
  }
}

function getCodexRolloutRoots(): string[] {
  const codexDir = path.join(os.homedir(), '.codex');
  return [
    path.join(codexDir, 'sessions'),
    path.join(codexDir, 'archived_sessions'),
  ];
}

function extractCodexSessionIdFromRolloutPath(filePath: string): string | null {
  const match = path.basename(filePath).match(/-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
}

function listCodexRolloutFiles(): string[] {
  const roots = getCodexRolloutRoots();
  const files = new Set<string>();

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    const stack = [root];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
          files.add(fullPath);
        }
      }
    }
  }

  return Array.from(files).sort((left, right) => {
    try {
      return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function readCodexThreads(): CodexThreadRow[] {
  const dbPath = resolveCodexStateDbPath();
  if (!dbPath) {
    return [];
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db.prepare(`
      SELECT
        id,
        rollout_path,
        created_at,
        updated_at,
        model_provider,
        model,
        cwd,
        title,
        tokens_used
      FROM threads
      WHERE rollout_path != ''
         OR tokens_used > 0
      ORDER BY updated_at DESC
    `).all() as CodexThreadRow[];
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function extractClaudeTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  const texts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) {
      continue;
    }
    if (getString(block.type) !== 'text') {
      continue;
    }
    const text = getString(block.text);
    if (text) {
      texts.push(text);
    }
  }
  return texts.join('\n').trim();
}

function extractCodexTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  const texts: string[] = [];
  for (const item of content) {
    if (!isObject(item)) {
      continue;
    }
    const text = getString(item.text);
    if (text) {
      texts.push(text);
    }
  }
  return texts.join('\n').trim();
}

function createEmptyCodexTokenTotals(): CodexTokenTotals {
  return {
    input: 0,
    output: 0,
    cached: 0,
  };
}

function totalCodexTokens(totals: CodexTokenTotals): number {
  return totals.input + totals.output + totals.cached;
}

function allocateFallbackCodexTokens(missingTokens: number, observedTotals: CodexTokenTotals): CodexTokenTotals {
  if (missingTokens <= 0) {
    return createEmptyCodexTokenTotals();
  }

  const observedTotal = totalCodexTokens(observedTotals);
  const allocation = createEmptyCodexTokenTotals();

  if (observedTotal > 0) {
    allocation.input = Math.round((missingTokens * observedTotals.input) / observedTotal);
    allocation.cached = Math.round((missingTokens * observedTotals.cached) / observedTotal);
    allocation.output = Math.max(0, missingTokens - allocation.input - allocation.cached);
    return allocation;
  }

  allocation.input = Math.round(missingTokens * 0.88);
  allocation.output = Math.max(0, missingTokens - allocation.input);
  return allocation;
}

function parseToolErrorFromOutput(output: string): boolean {
  const exitMatch = output.match(/Process exited with code (\d+)/);
  if (exitMatch) {
    return exitMatch[1] !== '0';
  }
  return false;
}

function normalizeToolName(toolName: string): string {
  const aliases: Record<string, string> = {
    bash_20241022: 'Bash',
    bash: 'Bash',
    Bash: 'Bash',
    exec_command: 'Bash',
    write_stdin: 'Bash',
    Read: 'Read',
    read: 'Read',
    Edit: 'Edit',
    edit: 'Edit',
    Write: 'Write',
    write: 'Write',
    apply_patch: 'Edit',
    Grep: 'Grep',
    grep: 'Grep',
    Glob: 'Glob',
    glob: 'Glob',
    WebFetch: 'WebFetch',
    web_fetch: 'WebFetch',
    WebSearch: 'WebSearch',
    web_search: 'WebSearch',
  };
  return aliases[toolName] ?? (toolName || 'unknown');
}

function extractCommandName(input: unknown): string | null {
  if (!isObject(input)) {
    return null;
  }
  const raw = getString(input.command) || getString(input.cmd);
  if (!raw) {
    return null;
  }
  const command = raw.trim().split(/\s+/)[0];
  return command || null;
}

function extractApplyPatchFilePaths(input: string): string[] {
  const matches = input.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm);
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const match of matches) {
    const filePath = match[1]?.trim();
    if (!filePath || seen.has(filePath)) {
      continue;
    }
    seen.add(filePath);
    paths.push(filePath);
  }

  return paths;
}

function extractFilePaths(toolName: string, input: unknown): string[] {
  if (toolName === 'Edit' && typeof input === 'string') {
    return extractApplyPatchFilePaths(input);
  }

  if (!isObject(input)) {
    return [];
  }
  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    const filePath = getString(input.file_path) || getString(input.path);
    return filePath ? [filePath] : [];
  }
  return [];
}

function parseClaudeSessions(): RuntimeStatsDataset {
  const sessions: SessionStatsRecord[] = [];
  const usage: UsageStatsRecord[] = [];
  const toolCalls: ToolCallStatsRecord[] = [];

  const sessionFiles = listClaudeSessionFiles();
  for (const file of sessionFiles) {
    const lines = readJsonlLines(file.filePath);
    if (lines.length === 0) {
      continue;
    }
    const fileStat = fs.statSync(file.filePath);
    const fileModifiedAt = toIsoDateTime(fileStat.mtimeMs);

    const usageMessageIds = new Set<string>();
    const seenUserKeys = new Set<string>();
    const seenAssistantKeys = new Set<string>();
    const pendingTools = new Map<string, MutableToolCall>();

    let title = '';
    let model = '';
    let workingDirectory = '';
    let createdAt = '';
    let updatedAt = '';
    let userMessageCount = 0;
    let assistantMessageCount = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const entry = parseJsonLine(lines[lineIndex]);
      if (!entry) {
        continue;
      }
      const timestamp = normalizeIsoTimestamp(entry.timestamp, updatedAt || createdAt || fileModifiedAt);
      if (!createdAt) {
        createdAt = timestamp;
      }
      updatedAt = timestamp;

      const entryCwd = getString(entry.cwd);
      if (!workingDirectory && entryCwd) {
        workingDirectory = entryCwd;
      }

      const entryType = getString(entry.type);
      const message = isObject(entry.message) ? entry.message : null;

      if (entryType === 'assistant' && message) {
        const messageId = getString(message.id) || getString(entry.uuid) || `${file.sessionId}-assistant-${lineIndex}`;
        if (!seenAssistantKeys.has(messageId)) {
          seenAssistantKeys.add(messageId);
          assistantMessageCount += 1;
        }

        const messageModel = getString(message.model);
        if (messageModel) {
          model = messageModel;
        }

        const usageObject = isObject(message.usage) ? message.usage : null;
        if (usageObject && !usageMessageIds.has(messageId)) {
          usageMessageIds.add(messageId);
          const inputTokens = getNumber(usageObject.input_tokens);
          const outputTokens = getNumber(usageObject.output_tokens);
          const cacheReadInputTokens = getNumber(usageObject.cache_read_input_tokens);
          const cacheCreationInputTokens = getNumber(usageObject.cache_creation_input_tokens);
          const costUsdRaw = usageObject.cost_usd;
          const costUsd = typeof costUsdRaw === 'number'
            ? costUsdRaw
            : typeof costUsdRaw === 'string'
            ? Number(costUsdRaw)
            : null;

          usage.push({
            runtime: 'claude_code',
            sessionId: file.sessionId,
            timestamp,
            model: messageModel || model || 'unknown',
            inputTokens,
            outputTokens,
            cacheReadInputTokens,
            cacheCreationInputTokens,
            costUsd: Number.isFinite(costUsd ?? Number.NaN) ? costUsd : null,
          });
        }

        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
          if (!isObject(block)) {
            continue;
          }
          const blockType = getString(block.type);
          if (!title && blockType === 'text') {
            const preview = truncate(getString(block.text) || '');
            if (preview) {
              title = preview;
            }
          }

          if (blockType === 'tool_use') {
            const toolUseId = getString(block.id);
            if (!toolUseId) {
              continue;
            }
            pendingTools.set(toolUseId, {
              runtime: 'claude_code',
              sessionId: file.sessionId,
              timestamp,
              toolName: normalizeToolName(getString(block.name) || 'unknown'),
              input: block.input,
              isError: false,
              error: null,
            });
          } else if (blockType === 'tool_result') {
            const toolUseId = getString(block.tool_use_id);
            if (!toolUseId) {
              continue;
            }
            const pending = pendingTools.get(toolUseId);
            if (!pending) {
              continue;
            }
            const isError = Boolean(block.is_error);
            pending.isError = isError;
            if (isError) {
              pending.error = getString(block.content) || JSON.stringify(block.content ?? '');
            }
          }
        }
      }

      if (entryType === 'user' && message) {
        const userKey = getString(message.id) || getString(entry.uuid) || `${file.sessionId}-user-${lineIndex}`;
        if (!seenUserKeys.has(userKey)) {
          seenUserKeys.add(userKey);
          userMessageCount += 1;
        }

        if (!title) {
          const preview = truncate(extractClaudeTextContent(message.content));
          if (preview) {
            title = preview;
          }
        }

        const content = message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!isObject(block)) {
              continue;
            }
            if (getString(block.type) !== 'tool_result') {
              continue;
            }
            const toolUseId = getString(block.tool_use_id);
            if (!toolUseId) {
              continue;
            }
            const pending = pendingTools.get(toolUseId);
            if (!pending) {
              continue;
            }
            const isError = Boolean(block.is_error);
            pending.isError = isError;
            if (isError) {
              pending.error = getString(block.content) || JSON.stringify(block.content ?? '');
            }
          }
        }
      }
    }

    const normalizedCreatedAt = createdAt || fileModifiedAt;
    const normalizedUpdatedAt = updatedAt || normalizedCreatedAt;
    const sessionTitle = title || truncate(path.basename(workingDirectory || file.projectPath || file.sessionId)) || `Session ${file.sessionId.slice(0, 8)}`;

    sessions.push({
      runtime: 'claude_code',
      sessionId: file.sessionId,
      title: sessionTitle,
      workingDirectory: workingDirectory || file.projectPath || '',
      model: model || 'unknown',
      createdAt: normalizedCreatedAt,
      updatedAt: normalizedUpdatedAt,
      userMessageCount,
      assistantMessageCount,
      messageCount: userMessageCount + assistantMessageCount,
    });

    for (const toolCall of pendingTools.values()) {
      toolCalls.push({
        runtime: toolCall.runtime,
        sessionId: toolCall.sessionId,
        timestamp: toolCall.timestamp,
        toolName: toolCall.toolName,
        input: toolCall.input,
        isError: toolCall.isError,
        error: toolCall.error,
      });
    }
  }

  return { sessions, usage, toolCalls };
}

function parseCodexSessions(): RuntimeStatsDataset {
  const sessions: SessionStatsRecord[] = [];
  const usage: UsageStatsRecord[] = [];
  const toolCalls: ToolCallStatsRecord[] = [];

  const threads = readCodexThreads();
  const threadsBySessionId = new Map(threads.map((thread) => [thread.id, thread]));
  const rolloutPathsBySessionId = new Map<string, string>();

  for (const thread of threads) {
    const sessionId = thread.id || extractCodexSessionIdFromRolloutPath(thread.rollout_path || '');
    if (!sessionId || !thread.rollout_path || !fs.existsSync(thread.rollout_path)) {
      continue;
    }
    rolloutPathsBySessionId.set(sessionId, thread.rollout_path);
  }

  for (const rolloutPath of listCodexRolloutFiles()) {
    const sessionId = extractCodexSessionIdFromRolloutPath(rolloutPath);
    if (!sessionId || rolloutPathsBySessionId.has(sessionId)) {
      continue;
    }
    rolloutPathsBySessionId.set(sessionId, rolloutPath);
  }

  const sessionIds = Array.from(new Set([
    ...threadsBySessionId.keys(),
    ...rolloutPathsBySessionId.keys(),
  ]));

  for (const sessionId of sessionIds) {
    const thread = threadsBySessionId.get(sessionId);
    const rolloutPath = rolloutPathsBySessionId.get(sessionId) || thread?.rollout_path || '';
    const lines = rolloutPath ? readJsonlLines(rolloutPath) : [];
    const fallbackTimestamp = thread
      ? toIsoDateTime(thread.updated_at * 1000)
      : new Date().toISOString();

    const pendingTools = new Map<string, MutableToolCall>();
    const seenMessageKeys = new Set<string>();

    let title = truncate(thread?.title || '');
    let model = thread?.model || thread?.model_provider || 'Codex';
    let workingDirectory = thread?.cwd || '';
    let createdAt = thread ? toIsoDateTime(thread.created_at * 1000) : fallbackTimestamp;
    let updatedAt = thread ? toIsoDateTime(thread.updated_at * 1000) : fallbackTimestamp;
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    let previousTotals: CodexTokenTotals | null = null;
    const observedTotals = createEmptyCodexTokenTotals();

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const entry = parseJsonLine(lines[lineIndex]);
      if (!entry) {
        continue;
      }

      const timestamp = normalizeIsoTimestamp(entry.timestamp, updatedAt || createdAt);
      if (!createdAt || createdAt === new Date(0).toISOString()) {
        createdAt = timestamp;
      }
      updatedAt = timestamp;

      const type = getString(entry.type);
      const payload = isObject(entry.payload) ? entry.payload : null;

      if (type === 'session_meta' && payload) {
        const payloadTimestamp = normalizeIsoTimestamp(payload.timestamp, timestamp);
        if (payloadTimestamp) {
          createdAt = payloadTimestamp;
        }
        const payloadCwd = getString(payload.cwd);
        if (payloadCwd) {
          workingDirectory = payloadCwd;
        }
        const payloadModel = getString(payload.model) || getString(payload.model_provider);
        if (payloadModel) {
          model = payloadModel;
        }
      }

      if (type === 'turn_context' && payload) {
        const turnModel = getString(payload.model);
        if (turnModel) {
          model = turnModel;
        }
      }

      if (type === 'response_item' && payload) {
        const payloadType = getString(payload.type);
        if (payloadType === 'message') {
          const role = getString(payload.role);
          const text = extractCodexTextContent(payload.content);
          if (!text) {
            continue;
          }

          const key = `${role || 'unknown'}:${timestamp}:${text}`;
          if (seenMessageKeys.has(key)) {
            continue;
          }
          seenMessageKeys.add(key);

          if (role === 'user') {
            if (!shouldSkipCodexUserMessage(text)) {
              userMessageCount += 1;
              if (!title) {
                title = truncate(text);
              }
            }
          } else if (role === 'assistant') {
            assistantMessageCount += 1;
          }
        }

        if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
          const callId = getString(payload.call_id);
          if (!callId) {
            continue;
          }
          const toolName = normalizeToolName(getString(payload.name) || 'tool');
          const rawInput = payloadType === 'custom_tool_call' ? payload.input : payload.arguments;
          let parsedInput: unknown = rawInput;
          if (typeof rawInput === 'string') {
            try {
              parsedInput = JSON.parse(rawInput);
            } catch {
              parsedInput = rawInput;
            }
          }
          pendingTools.set(callId, {
            runtime: 'codex',
            sessionId,
            timestamp,
            toolName,
            input: parsedInput,
            isError: false,
            error: null,
          });
        }

        if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
          const callId = getString(payload.call_id);
          if (!callId) {
            continue;
          }
          const pending = pendingTools.get(callId);
          if (!pending) {
            continue;
          }
          const output = getString(payload.output) || JSON.stringify(payload.output ?? '');
          const isError = parseToolErrorFromOutput(output);
          pending.isError = isError;
          if (isError) {
            pending.error = output;
          }
        }
      }

      if (type === 'event_msg' && payload) {
        const payloadType = getString(payload.type);
        if (payloadType !== 'token_count') {
          continue;
        }
        const info = isObject(payload.info) ? payload.info : null;
        if (!info) {
          continue;
        }
        const lastUsage = isObject(info.last_token_usage) ? info.last_token_usage : null;
        const totalUsage = isObject(info.total_token_usage) ? info.total_token_usage : null;

        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadInputTokens = 0;

        // Prefer cumulative totals and compute per-event deltas to avoid
        // double-counting repeated last_token_usage snapshots.
        if (totalUsage) {
          const totalInput = getNumber(totalUsage.input_tokens);
          const totalOutput = getNumber(totalUsage.output_tokens) + getNumber(totalUsage.reasoning_output_tokens);
          const totalCached = getNumber(totalUsage.cached_input_tokens);
          if (previousTotals) {
            inputTokens = Math.max(0, totalInput - previousTotals.input);
            outputTokens = Math.max(0, totalOutput - previousTotals.output);
            cacheReadInputTokens = Math.max(0, totalCached - previousTotals.cached);
          } else {
            inputTokens = totalInput;
            outputTokens = totalOutput;
            cacheReadInputTokens = totalCached;
          }
        } else if (lastUsage) {
          inputTokens = getNumber(lastUsage.input_tokens);
          outputTokens = getNumber(lastUsage.output_tokens) + getNumber(lastUsage.reasoning_output_tokens);
          cacheReadInputTokens = getNumber(lastUsage.cached_input_tokens);
        }

        if (totalUsage) {
          previousTotals = {
            input: getNumber(totalUsage.input_tokens),
            output: getNumber(totalUsage.output_tokens) + getNumber(totalUsage.reasoning_output_tokens),
            cached: getNumber(totalUsage.cached_input_tokens),
          };
        }

        if (inputTokens > 0 || outputTokens > 0 || cacheReadInputTokens > 0) {
          observedTotals.input += inputTokens;
          observedTotals.output += outputTokens;
          observedTotals.cached += cacheReadInputTokens;
          usage.push({
            runtime: 'codex',
            sessionId,
            timestamp,
            model: model || thread?.model_provider || 'Codex',
            inputTokens,
            outputTokens,
            cacheReadInputTokens,
            cacheCreationInputTokens: 0,
            costUsd: null,
          });
        }
      }
    }

    const observedTokenTotal = totalCodexTokens(observedTotals);
    const threadTokenTotal = Math.max(0, thread?.tokens_used ?? 0);
    if (threadTokenTotal > observedTokenTotal) {
      const fallbackTokens = allocateFallbackCodexTokens(threadTokenTotal - observedTokenTotal, observedTotals);
      if (totalCodexTokens(fallbackTokens) > 0) {
        usage.push({
          runtime: 'codex',
          sessionId,
          timestamp: updatedAt,
          model: model || thread?.model_provider || 'Codex',
          inputTokens: fallbackTokens.input,
          outputTokens: fallbackTokens.output,
          cacheReadInputTokens: fallbackTokens.cached,
          cacheCreationInputTokens: 0,
          costUsd: null,
        });
      }
    }

    sessions.push({
      runtime: 'codex',
      sessionId,
      title: title || `Session ${sessionId.slice(0, 8)}`,
      workingDirectory: workingDirectory || '',
      model: model || 'Codex',
      createdAt,
      updatedAt,
      userMessageCount,
      assistantMessageCount,
      messageCount: userMessageCount + assistantMessageCount,
    });

    for (const toolCall of pendingTools.values()) {
      toolCalls.push({
        runtime: toolCall.runtime,
        sessionId: toolCall.sessionId,
        timestamp: toolCall.timestamp,
        toolName: toolCall.toolName,
        input: toolCall.input,
        isError: toolCall.isError,
        error: toolCall.error,
      });
    }
  }

  return { sessions, usage, toolCalls };
}

function getRuntimeStatsDataset(): RuntimeStatsDataset {
  if (cachedDataset && cachedDataset.expiresAt > Date.now()) {
    return cachedDataset.dataset;
  }

  const claudeDataset = parseClaudeSessions();
  const codexDataset = parseCodexSessions();
  const dataset: RuntimeStatsDataset = {
    sessions: [...claudeDataset.sessions, ...codexDataset.sessions],
    usage: [...claudeDataset.usage, ...codexDataset.usage],
    toolCalls: [...claudeDataset.toolCalls, ...codexDataset.toolCalls],
  };

  cachedDataset = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    dataset,
  };
  return dataset;
}

function sessionKey(runtime: AssistantRuntime, sessionId: string): string {
  return `${runtime}:${sessionId}`;
}

function isWithinRange(timestamp: string, fromTime: number): boolean {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) {
    return false;
  }
  return time >= fromTime;
}

export function getRuntimeTokenUsageStats(days: number = 30): {
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  costMeta: {
    mode: CostMode;
    actualCost: number;
    estimatedCost: number;
    actualRecords: number;
    estimatedRecords: number;
  };
  pricingReference: {
    unit: 'USD / 1M tokens';
    rules: PricingReferenceRule[];
  };
  daily: Array<{
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;
  periods: {
    todayCost: number;
    weekCost: number;
    monthCost: number;
    totalCost: number;
  };
  byModel: Array<{
    model: string;
    cost: number;
  }>;
  byRuntime: Array<{
    runtime: string;
    cost: number;
    sessions: number;
  }>;
  dailyCosts: Array<{
    date: string;
    cost: number;
  }>;
  weeklyTrend: Array<{
    date: string;
    cost: number;
  }>;
} {
  const dataset = getRuntimeStatsDataset();
  const now = new Date();
  const rollingStartTime = now.getTime() - (days * DAY_MS);

  const usageInRange = dataset.usage.filter((record) => isWithinRange(record.timestamp, rollingStartTime));

  const sessionKeys = new Set<string>();
  let totalInput = 0;
  let totalOutput = 0;
  const costAccumulator = createCostAccumulator();
  let cacheRead = 0;
  let cacheCreation = 0;
  for (const record of usageInRange) {
    sessionKeys.add(sessionKey(record.runtime, record.sessionId));
    totalInput += record.inputTokens;
    totalOutput += record.outputTokens;
    cacheRead += record.cacheReadInputTokens;
    cacheCreation += record.cacheCreationInputTokens;
    accumulateCost(costAccumulator, resolveCost(record));
  }

  const summary = {
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cost: costAccumulator.totalCost,
    total_sessions: sessionKeys.size,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
  };

  const costMeta = {
    mode: getCostMode(costAccumulator),
    actualCost: costAccumulator.actualCost,
    estimatedCost: costAccumulator.estimatedCost,
    actualRecords: costAccumulator.actualRecords,
    estimatedRecords: costAccumulator.estimatedRecords,
  };
  const pricingReference = {
    unit: 'USD / 1M tokens' as const,
    rules: PRICING_REFERENCE_RULES,
  };

  const dailyMap = new Map<string, {
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>();
  for (const record of usageInRange) {
    const date = toLocalDateKey(new Date(record.timestamp));
    const model = record.model || 'unknown';
    const key = `${date}::${model}`;
    const { cost } = resolveCost(record);
    const existing = dailyMap.get(key) ?? {
      date,
      model,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
    };
    existing.input_tokens += record.inputTokens;
    existing.output_tokens += record.outputTokens;
    existing.cost += cost;
    dailyMap.set(key, existing);
  }
  const daily = Array.from(dailyMap.values()).sort((a, b) => {
    if (a.date === b.date) {
      return a.model.localeCompare(b.model);
    }
    return a.date.localeCompare(b.date);
  });

  const todayStart = startOfLocalDay(now).getTime();
  const weekStart = startOfLocalWeek(now).getTime();
  const monthStart = startOfLocalMonth(now).getTime();

  let todayCost = 0;
  let weekCost = 0;
  let monthCost = 0;
  let overallCost = 0;
  for (const record of dataset.usage) {
    const ts = new Date(record.timestamp).getTime();
    const { cost } = resolveCost(record);
    overallCost += cost;
    if (ts >= todayStart) {
      todayCost += cost;
    }
    if (ts >= weekStart) {
      weekCost += cost;
    }
    if (ts >= monthStart) {
      monthCost += cost;
    }
  }

  const periods = {
    todayCost,
    weekCost,
    monthCost,
    totalCost: overallCost,
  };

  const modelCostMap = new Map<string, number>();
  for (const record of usageInRange) {
    const model = record.model || 'unknown';
    const { cost } = resolveCost(record);
    modelCostMap.set(model, (modelCostMap.get(model) ?? 0) + cost);
  }
  const byModel = Array.from(modelCostMap.entries())
    .map(([model, cost]) => ({ model, cost }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));

  const runtimeCostMap = new Map<string, { cost: number; sessions: Set<string> }>();
  for (const record of usageInRange) {
    const runtime = record.runtime;
    const { cost } = resolveCost(record);
    const runtimeData = runtimeCostMap.get(runtime) ?? { cost: 0, sessions: new Set<string>() };
    runtimeData.cost += cost;
    runtimeData.sessions.add(sessionKey(record.runtime, record.sessionId));
    runtimeCostMap.set(runtime, runtimeData);
  }
  const byRuntime = Array.from(runtimeCostMap.entries())
    .map(([runtime, value]) => ({
      runtime,
      cost: value.cost,
      sessions: value.sessions.size,
    }))
    .sort((a, b) => b.cost - a.cost || a.runtime.localeCompare(b.runtime));

  const dailyCostMap = new Map<string, number>();
  for (const record of usageInRange) {
    const date = toLocalDateKey(new Date(record.timestamp));
    const { cost } = resolveCost(record);
    dailyCostMap.set(date, (dailyCostMap.get(date) ?? 0) + cost);
  }
  const dailyCosts = buildLocalDateRange(days, now).map((date) => ({
    date,
    cost: dailyCostMap.get(date) ?? 0,
  }));

  const weeklyTrend = buildLocalDateRange(7, now).map((date) => ({
    date,
    cost: dailyCostMap.get(date) ?? 0,
  }));

  return {
    summary,
    costMeta,
    pricingReference,
    daily,
    periods,
    byModel,
    byRuntime,
    dailyCosts,
    weeklyTrend,
  };
}

export function getRuntimeSessionsStats(days: number = 30): {
  summary: {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    totalCost: number;
  };
  costMeta: {
    mode: CostMode;
    actualCost: number;
    estimatedCost: number;
    actualRecords: number;
    estimatedRecords: number;
  };
  byWorkspace: Array<{
    workspacePath: string;
    count: number;
    messageCount: number;
    lastUpdated: string;
  }>;
  byModel: Array<{
    model: string;
    tokens: number;
    count: number;
  }>;
  byRuntime: Array<{
    runtime: string;
    count: number;
    messageCount: number;
    tokens: number;
    totalCost: number;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    sessionType: string;
    workingDirectory: string;
    updatedAt: string;
    messageCount: number;
    assistantRuntime: string;
  }>;
  activityHeatmap: Array<{
    date: string;
    count: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
  rollingHourlyDistribution: Array<{
    hourStart: string;
    count: number;
  }>;
} {
  const dataset = getRuntimeStatsDataset();
  const now = new Date();
  const rollingStartTime = now.getTime() - (days * DAY_MS);
  const usageInRange = dataset.usage.filter((usage) => isWithinRange(usage.timestamp, rollingStartTime));

  const usageBySession = new Map<string, {
    tokens: number;
    cost: number;
    actualCost: number;
    estimatedCost: number;
    actualRecords: number;
    estimatedRecords: number;
  }>();
  for (const usage of usageInRange) {
    const key = sessionKey(usage.runtime, usage.sessionId);
    const existing = usageBySession.get(key) ?? {
      tokens: 0,
      cost: 0,
      actualCost: 0,
      estimatedCost: 0,
      actualRecords: 0,
      estimatedRecords: 0,
    };
    const resolution = resolveCost(usage);
    existing.tokens += usage.inputTokens + usage.outputTokens;
    existing.cost += resolution.cost;
    if (resolution.source === 'actual') {
      existing.actualCost += resolution.cost;
      existing.actualRecords += 1;
    } else {
      existing.estimatedCost += resolution.cost;
      existing.estimatedRecords += 1;
    }
    usageBySession.set(key, existing);
  }

  const sessionsInRange = dataset.sessions.filter((session) => isWithinRange(session.updatedAt, rollingStartTime));

  let totalMessages = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const costAccumulator = createCostAccumulator();
  for (const session of sessionsInRange) {
    totalMessages += session.messageCount;
    const key = sessionKey(session.runtime, session.sessionId);
    const usage = usageBySession.get(key);
    totalTokens += usage?.tokens ?? 0;
    totalCost += usage?.cost ?? 0;
    if (usage) {
      costAccumulator.totalCost += usage.cost;
      costAccumulator.actualCost += usage.actualCost;
      costAccumulator.estimatedCost += usage.estimatedCost;
      costAccumulator.actualRecords += usage.actualRecords;
      costAccumulator.estimatedRecords += usage.estimatedRecords;
    }
  }

  const summary = {
    totalSessions: sessionsInRange.length,
    totalMessages,
    totalTokens,
    totalCost,
  };

  const costMeta = {
    mode: getCostMode(costAccumulator),
    actualCost: costAccumulator.actualCost,
    estimatedCost: costAccumulator.estimatedCost,
    actualRecords: costAccumulator.actualRecords,
    estimatedRecords: costAccumulator.estimatedRecords,
  };

  const workspaceMap = new Map<string, {
    workspacePath: string;
    count: number;
    messageCount: number;
    lastUpdatedAtMs: number;
    lastUpdated: string;
  }>();
  for (const session of sessionsInRange) {
    if (!session.workingDirectory) {
      continue;
    }
    const key = session.workingDirectory;
    const existing = workspaceMap.get(key) ?? {
      workspacePath: key,
      count: 0,
      messageCount: 0,
      lastUpdatedAtMs: 0,
      lastUpdated: session.updatedAt,
    };
    existing.count += 1;
    existing.messageCount += session.messageCount;
    const sessionUpdatedAtMs = new Date(session.updatedAt).getTime();
    if (sessionUpdatedAtMs > existing.lastUpdatedAtMs) {
      existing.lastUpdatedAtMs = sessionUpdatedAtMs;
      existing.lastUpdated = session.updatedAt;
    }
    workspaceMap.set(key, existing);
  }
  const byWorkspace = Array.from(workspaceMap.values())
    .sort((a, b) => b.count - a.count || b.lastUpdatedAtMs - a.lastUpdatedAtMs)
    .slice(0, 20)
    .map((item) => ({
      workspacePath: item.workspacePath,
      count: item.count,
      messageCount: item.messageCount,
      lastUpdated: item.lastUpdated,
    }));

  const modelMap = new Map<string, { model: string; tokens: number; count: number }>();
  for (const session of sessionsInRange) {
    const model = session.model || 'Legacy Sessions';
    const usage = usageBySession.get(sessionKey(session.runtime, session.sessionId));
    const existing = modelMap.get(model) ?? { model, tokens: 0, count: 0 };
    existing.count += 1;
    existing.tokens += usage?.tokens ?? 0;
    modelMap.set(model, existing);
  }
  const byModel = Array.from(modelMap.values()).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));

  const runtimeMap = new Map<string, {
    runtime: string;
    count: number;
    messageCount: number;
    tokens: number;
    totalCost: number;
  }>();
  for (const session of sessionsInRange) {
    const runtime = session.runtime;
    const usage = usageBySession.get(sessionKey(session.runtime, session.sessionId));
    const existing = runtimeMap.get(runtime) ?? {
      runtime,
      count: 0,
      messageCount: 0,
      tokens: 0,
      totalCost: 0,
    };
    existing.count += 1;
    existing.messageCount += session.messageCount;
    existing.tokens += usage?.tokens ?? 0;
    existing.totalCost += usage?.cost ?? 0;
    runtimeMap.set(runtime, existing);
  }
  const byRuntime = Array.from(runtimeMap.values()).sort((a, b) => b.count - a.count || a.runtime.localeCompare(b.runtime));

  const recentSessions = [...sessionsInRange]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 80)
    .map((session) => ({
      id: session.sessionId,
      title: session.title,
      sessionType: 'chat',
      workingDirectory: session.workingDirectory,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      assistantRuntime: session.runtime,
    }));

  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);
  const rollingStartMs = currentHourStart.getTime() - (23 * HOUR_MS);
  const rollingEndExclusiveMs = currentHourStart.getTime() + HOUR_MS;
  const sessionsSeenInUsageRange = new Set<string>();
  const activityMap = new Map<string, Set<string>>();
  const hourMap = new Map<number, Set<string>>();
  const rollingHourMap = new Map<number, Set<string>>();

  function addToBucket<T>(map: Map<T, Set<string>>, bucket: T, key: string) {
    const existing = map.get(bucket) ?? new Set<string>();
    existing.add(key);
    map.set(bucket, existing);
  }

  for (const usage of usageInRange) {
    const key = sessionKey(usage.runtime, usage.sessionId);
    const usageDate = new Date(usage.timestamp);
    sessionsSeenInUsageRange.add(key);
    addToBucket(activityMap, toLocalDateKey(usageDate), key);
    addToBucket(hourMap, usageDate.getHours(), key);
  }

  for (const session of sessionsInRange) {
    const key = sessionKey(session.runtime, session.sessionId);
    if (sessionsSeenInUsageRange.has(key)) {
      continue;
    }

    const updatedAt = new Date(session.updatedAt);
    const updatedAtMs = updatedAt.getTime();
    if (!Number.isFinite(updatedAtMs)) {
      continue;
    }

    addToBucket(activityMap, toLocalDateKey(updatedAt), key);
    addToBucket(hourMap, updatedAt.getHours(), key);

    if (updatedAtMs >= rollingStartMs && updatedAtMs < rollingEndExclusiveMs) {
      const bucket = Math.floor((updatedAtMs - rollingStartMs) / HOUR_MS);
      if (bucket >= 0 && bucket <= 23) {
        addToBucket(rollingHourMap, bucket, key);
      }
    }
  }

  const activityHeatmap = Array.from(activityMap.entries())
    .map(([date, sessions]) => ({ date, count: sessions.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hourMap.get(hour)?.size ?? 0,
  }));

  for (const usage of dataset.usage) {
    const ts = new Date(usage.timestamp).getTime();
    if (!Number.isFinite(ts) || ts < rollingStartMs || ts >= rollingEndExclusiveMs) {
      continue;
    }
    const bucket = Math.floor((ts - rollingStartMs) / HOUR_MS);
    if (bucket < 0 || bucket > 23) {
      continue;
    }
    addToBucket(rollingHourMap, bucket, sessionKey(usage.runtime, usage.sessionId));
  }

  const rollingHourlyDistribution = Array.from({ length: 24 }, (_, index) => ({
    hourStart: new Date(rollingStartMs + (index * HOUR_MS)).toISOString(),
    count: rollingHourMap.get(index)?.size ?? 0,
  }));

  return {
    summary,
    costMeta,
    byWorkspace,
    byModel,
    byRuntime,
    recentSessions,
    activityHeatmap,
    hourlyDistribution,
    rollingHourlyDistribution,
  };
}

export function getRuntimeToolsStats(days: number = 30): {
  summary: {
    totalToolCalls: number;
    errorRate: number;
    distinctTools: number;
    errorCount: number;
    totalFilesTouched: number;
    totalSessions: number;
    avgCallsPerSession: number;
    previousPeriodToolCalls: number;
    busiestDay: {
      date: string;
      count: number;
    } | null;
  };
  byTool: Array<{
    toolName: string;
    count: number;
    errorRate: number;
    errorCount: number;
  }>;
  dailyUsage: Array<{
    date: string;
    count: number;
  }>;
  commonSequences: Array<{
    sequence: string;
    count: number;
  }>;
  errorProneTools: Array<{
    toolName: string;
    errorCount: number;
    errorRate: number;
  }>;
  recentFailures: Array<{
    sessionId: string;
    toolName: string;
    updatedAt: string;
    error: string;
  }>;
  topCommands: Array<{
    command: string;
    count: number;
  }>;
  topFiles: Array<{
    path: string;
    count: number;
  }>;
} {
  const dataset = getRuntimeStatsDataset();
  const now = Date.now();
  const currentPeriodStart = now - (days * DAY_MS);
  const previousPeriodStart = now - (days * 2 * DAY_MS);

  const sortedToolCalls = [...dataset.toolCalls].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const currentToolCalls = sortedToolCalls.filter((call) => isWithinRange(call.timestamp, currentPeriodStart));
  const previousToolCalls = sortedToolCalls.filter((call) => {
    const ts = new Date(call.timestamp).getTime();
    return Number.isFinite(ts) && ts >= previousPeriodStart && ts < currentPeriodStart;
  });

  const totalToolCalls = currentToolCalls.length;
  const errorCount = currentToolCalls.filter((call) => call.isError).length;
  const errorRate = totalToolCalls > 0 ? errorCount / totalToolCalls : 0;
  const distinctTools = new Set(currentToolCalls.map((call) => call.toolName)).size;
  const totalSessions = new Set(currentToolCalls.map((call) => sessionKey(call.runtime, call.sessionId))).size;
  const avgCallsPerSession = totalSessions > 0 ? totalToolCalls / totalSessions : 0;

  const toolMap = new Map<string, { count: number; errors: number }>();
  for (const call of currentToolCalls) {
    const existing = toolMap.get(call.toolName) ?? { count: 0, errors: 0 };
    existing.count += 1;
    if (call.isError) {
      existing.errors += 1;
    }
    toolMap.set(call.toolName, existing);
  }

  const allToolStats = Array.from(toolMap.entries())
    .map(([toolName, stats]) => ({
      toolName,
      count: stats.count,
      errorRate: stats.count > 0 ? stats.errors / stats.count : 0,
      errorCount: stats.errors,
    }));
  const byTool = allToolStats
    .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName))
    .slice(0, 20);

  const errorProneTools = allToolStats
    .filter((item) => item.errorCount > 0)
    .sort((a, b) => b.errorCount - a.errorCount || b.errorRate - a.errorRate)
    .slice(0, 8)
    .map((item) => ({
      toolName: item.toolName,
      errorCount: item.errorCount,
      errorRate: item.errorRate,
    }));

  const dailyUsageMap = new Map<string, number>();
  for (const call of currentToolCalls) {
    const dateKey = toLocalDateKey(new Date(call.timestamp));
    dailyUsageMap.set(dateKey, (dailyUsageMap.get(dateKey) ?? 0) + 1);
  }
  const dailyUsage = buildLocalDateRange(days, new Date()).map((date) => ({
    date,
    count: dailyUsageMap.get(date) ?? 0,
  }));
  const busiestDay = totalToolCalls === 0
    ? null
    : dailyUsage.reduce<{ date: string; count: number } | null>((current, day) => {
      if (!current || day.count > current.count) {
        return day;
      }
      return current;
    }, null);

  const recentFailures = currentToolCalls
    .filter((call) => call.isError)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
    .map((call) => ({
      sessionId: call.sessionId,
      toolName: call.toolName,
      updatedAt: call.timestamp,
      error: call.error || 'Unknown error',
    }));

  const commandMap = new Map<string, number>();
  for (const call of currentToolCalls) {
    const command = extractCommandName(call.input);
    if (!command) {
      continue;
    }
    commandMap.set(command, (commandMap.get(command) ?? 0) + 1);
  }
  const topCommands = Array.from(commandMap.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count || a.command.localeCompare(b.command))
    .slice(0, 10);

  const fileMap = new Map<string, number>();
  for (const call of currentToolCalls) {
    for (const filePath of extractFilePaths(call.toolName, call.input)) {
      fileMap.set(filePath, (fileMap.get(filePath) ?? 0) + 1);
    }
  }
  const topFiles = Array.from(fileMap.entries())
    .map(([pathValue, count]) => ({ path: pathValue, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 10);

  const sequenceMap = new Map<string, number>();
  for (let index = 1; index < currentToolCalls.length; index += 1) {
    const previous = currentToolCalls[index - 1];
    const current = currentToolCalls[index];
    if (previous.runtime !== current.runtime || previous.sessionId !== current.sessionId) {
      continue;
    }
    const sequence = `${previous.toolName} -> ${current.toolName}`;
    sequenceMap.set(sequence, (sequenceMap.get(sequence) ?? 0) + 1);
  }
  const commonSequences = Array.from(sequenceMap.entries())
    .map(([sequence, count]) => ({ sequence, count }))
    .sort((a, b) => b.count - a.count || a.sequence.localeCompare(b.sequence))
    .slice(0, 8);

  const summary = {
    totalToolCalls,
    errorRate,
    distinctTools,
    errorCount,
    totalFilesTouched: fileMap.size,
    totalSessions,
    avgCallsPerSession,
    previousPeriodToolCalls: previousToolCalls.length,
    busiestDay,
  };

  return {
    summary,
    byTool,
    dailyUsage,
    commonSequences,
    errorProneTools,
    recentFailures,
    topCommands,
    topFiles,
  };
}

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MessageContentBlock } from '@/types';
import { summarizeSessionPreview, type SessionPreviewTag } from '@/lib/session-preview';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export interface CodexSessionInfo {
  sessionId: string;
  title: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  version: string;
  model: string;
  preview: string;
  previewTags: SessionPreviewTag[];
  userMessageCount: number;
  assistantMessageCount: number;
  createdAt: string;
  updatedAt: string;
  fileSize: number;
}

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  contentBlocks: MessageContentBlock[];
  hasToolBlocks: boolean;
  timestamp: string;
}

export interface ParsedSession {
  info: CodexSessionInfo;
  messages: ParsedMessage[];
}

interface CodexThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  model: string | null;
  model_provider: string;
  cwd: string;
  title: string;
  git_branch: string | null;
  cli_version: string;
  first_user_message: string;
  has_user_event: number;
}

interface CodexRolloutEntry {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

interface PendingToolCall {
  name: string;
  input: unknown;
  timestamp: string;
}

function toIsoString(value: number): string {
  return new Date(value * 1000).toISOString();
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getCodexDir(): string {
  return path.join(os.homedir(), '.codex');
}

function getCodexSessionsDir(): string {
  return path.join(getCodexDir(), 'sessions');
}

function resolveCodexStateDbPath(): string | null {
  const codexDir = getCodexDir();
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

function readJsonlLines(filePath: string): { lines: string[]; stat: fs.Stats } | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`[codex-session-parser] Skipping ${filePath}: file too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  return { lines, stat };
}

function readCodexHistoryPreviewMap(): Map<string, string> {
  const historyPath = path.join(getCodexDir(), 'history.jsonl');
  if (!fs.existsSync(historyPath)) {
    return new Map();
  }

  try {
    const content = fs.readFileSync(historyPath, 'utf-8');
    const previews = new Map<string, string>();

    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as { session_id?: unknown; text?: unknown };
        if (typeof entry.session_id !== 'string' || typeof entry.text !== 'string') {
          continue;
        }

        const text = entry.text.trim();
        if (!text) {
          continue;
        }

        previews.set(entry.session_id, text);
      } catch {
        continue;
      }
    }

    return previews;
  } catch {
    return new Map();
  }
}

function listCodexRolloutFiles(): string[] {
  const sessionsDir = getCodexSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const files: string[] = [];
  const stack = [sessionsDir];

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
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => {
    try {
      return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function extractSessionIdFromRolloutPath(filePath: string): string | null {
  const match = path.basename(filePath).match(/-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
}

function findRolloutPathForSession(sessionId: string): string | null {
  for (const filePath of listCodexRolloutFiles()) {
    if (filePath.includes(sessionId)) {
      return filePath;
    }
  }
  return null;
}

function readThreads(): CodexThreadRow[] {
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
        model,
        model_provider,
        cwd,
        title,
        git_branch,
        cli_version,
        first_user_message,
        has_user_event
      FROM threads
      WHERE rollout_path != ''
      ORDER BY updated_at DESC
    `).all() as CodexThreadRow[];
  } catch (error) {
    console.error('[codex-session-parser] Failed to query threads:', error);
    return [];
  } finally {
    db?.close();
  }
}

function readThread(sessionId: string): CodexThreadRow | null {
  const dbPath = resolveCodexStateDbPath();
  if (!dbPath) {
    return null;
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
        model,
        model_provider,
        cwd,
        title,
        git_branch,
        cli_version,
        first_user_message,
        has_user_event
      FROM threads
      WHERE id = ?
        AND rollout_path != ''
      LIMIT 1
    `).get(sessionId) as CodexThreadRow | null;
  } catch (error) {
    console.error('[codex-session-parser] Failed to query thread:', error);
    return null;
  } finally {
    db?.close();
  }
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as { text?: unknown };
      return typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function shouldSkipUserMessage(text: string): boolean {
  return text.startsWith('# AGENTS.md instructions for ')
    || text.startsWith('<environment_context>')
    || text.includes('\n<INSTRUCTIONS>\n');
}

function buildToolResultContent(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function buildMessage(role: 'user' | 'assistant', text: string, timestamp: string): ParsedMessage | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  return {
    role,
    content: normalized,
    contentBlocks: [{ type: 'text', text: normalized }],
    hasToolBlocks: false,
    timestamp,
  };
}

function isToolCallType(type: unknown): boolean {
  return type === 'function_call' || type === 'custom_tool_call';
}

function isToolCallOutputType(type: unknown): boolean {
  return type === 'function_call_output' || type === 'custom_tool_call_output';
}

function buildCodexInfo(
  thread: CodexThreadRow | null,
  stat: fs.Stats,
  lines: string[],
  rolloutPath: string,
  historyPreviewMap?: Map<string, string>,
): CodexSessionInfo {
  const fallbackSessionId = extractSessionIdFromRolloutPath(rolloutPath) || path.basename(rolloutPath);
  let sessionId = thread?.id || fallbackSessionId;
  let projectPath = thread?.cwd || '';
  let gitBranch = thread?.git_branch || '';
  const title = thread?.title || '';
  let createdAt = thread ? toIsoString(thread.created_at) : '';
  let updatedAt = thread ? toIsoString(thread.updated_at) : '';
  let version = thread?.cli_version || '';
  let model = thread?.model || thread?.model_provider || 'Codex';
  let hasResolvedConcreteModel = false;
  const previewSources: string[] = [];
  if (thread?.first_user_message) {
    previewSources.push(thread.first_user_message);
  }
  if (thread?.title) {
    previewSources.push(thread.title);
  }
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CodexRolloutEntry;
      if (entry.timestamp) {
        if (!createdAt) {
          createdAt = entry.timestamp;
        }
        updatedAt = entry.timestamp;
      }

      if (entry.type === 'session_meta' && entry.payload) {
        const payload = entry.payload as {
          id?: unknown;
          timestamp?: unknown;
          cwd?: unknown;
          cli_version?: unknown;
          model?: unknown;
          model_provider?: unknown;
        };
        if (typeof payload.id === 'string' && payload.id) {
          sessionId = payload.id;
        }
        if (typeof payload.timestamp === 'string') {
          createdAt = payload.timestamp;
        }
        if (typeof payload.cwd === 'string' && payload.cwd) {
          projectPath = payload.cwd;
        }
        if (typeof payload.cli_version === 'string' && payload.cli_version) {
          version = payload.cli_version;
        }
        if (typeof payload.model === 'string' && payload.model) {
          model = payload.model;
          hasResolvedConcreteModel = true;
        } else if (!hasResolvedConcreteModel && typeof payload.model_provider === 'string' && payload.model_provider) {
          model = payload.model_provider;
        }
        continue;
      }

      if (entry.type === 'turn_context' && entry.payload) {
        const payload = entry.payload as {
          cwd?: unknown;
          model?: unknown;
          git_branch?: unknown;
        };
        if (typeof payload.cwd === 'string' && payload.cwd) {
          projectPath = payload.cwd;
        }
        if (typeof payload.model === 'string' && payload.model) {
          model = payload.model;
          hasResolvedConcreteModel = true;
        }
        if (typeof payload.git_branch === 'string' && payload.git_branch) {
          gitBranch = payload.git_branch;
        }
        continue;
      }

      if (entry.type !== 'response_item' || !entry.payload) {
        continue;
      }

      const payload = entry.payload as {
        type?: unknown;
        role?: unknown;
        content?: unknown;
      };

      if (payload.type === 'message') {
        if (payload.role === 'user') {
          const text = extractTextBlocks(payload.content);
          if (!text || shouldSkipUserMessage(text)) {
            continue;
          }
          userMessageCount += 1;
          if (previewSources.length === 0) {
            previewSources.push(text);
          }
        }

        if (payload.role === 'assistant') {
          const text = extractTextBlocks(payload.content);
          if (!text) {
            continue;
          }
          assistantMessageCount += 1;
        }
      }

      if (isToolCallOutputType(payload.type)) {
        assistantMessageCount += 1;
      }
    } catch {
      continue;
    }
  }

  if (historyPreviewMap?.has(sessionId)) {
    previewSources.push(historyPreviewMap.get(sessionId) || '');
  }

  const previewSummary = summarizeSessionPreview(...previewSources);
  const preview = previewSummary.preview;

  return {
    sessionId,
    title: (title || preview || `Session ${sessionId.slice(0, 8)}`).trim(),
    projectPath,
    projectName: path.basename(projectPath || title || 'unknown'),
    cwd: projectPath,
    gitBranch,
    version,
    model,
    preview,
    previewTags: previewSummary.tags,
    userMessageCount,
    assistantMessageCount,
    createdAt: createdAt || stat.birthtime.toISOString(),
    updatedAt: updatedAt || stat.mtime.toISOString(),
    fileSize: stat.size,
  };
}

export function listCodexSessions(): CodexSessionInfo[] {
  const threads = readThreads();
  const historyPreviewMap = readCodexHistoryPreviewMap();
  const sessionsById = new Map<string, CodexSessionInfo>();

  for (const thread of threads) {
    try {
      const result = readJsonlLines(thread.rollout_path);
      if (!result) {
        continue;
      }

      const info = buildCodexInfo(thread, result.stat, result.lines, thread.rollout_path, historyPreviewMap);
      sessionsById.set(info.sessionId, info);
    } catch {
      continue;
    }
  }

  for (const rolloutPath of listCodexRolloutFiles()) {
    try {
      const sessionId = extractSessionIdFromRolloutPath(rolloutPath);
      if (sessionId && sessionsById.has(sessionId)) {
        continue;
      }

      const result = readJsonlLines(rolloutPath);
      if (!result) {
        continue;
      }

      const info = buildCodexInfo(null, result.stat, result.lines, rolloutPath, historyPreviewMap);
      sessionsById.set(info.sessionId, info);
    } catch {
      continue;
    }
  }

  const sessions = Array.from(sessionsById.values());
  sessions.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return sessions;
}

export function parseCodexSession(sessionId: string): ParsedSession | null {
  const thread = readThread(sessionId);
  const rolloutPath = thread?.rollout_path || findRolloutPathForSession(sessionId);
  if (!rolloutPath) {
    return null;
  }

  const result = readJsonlLines(rolloutPath);
  if (!result) {
    return null;
  }

  const { lines, stat } = result;
  const info = buildCodexInfo(thread, stat, lines, rolloutPath, readCodexHistoryPreviewMap());
  const messages: ParsedMessage[] = [];
  const pendingToolCalls = new Map<string, PendingToolCall>();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CodexRolloutEntry;
      const timestamp = entry.timestamp || info.updatedAt;

      if (entry.type !== 'response_item' || !entry.payload) {
        continue;
      }

      const payload = entry.payload as {
        type?: unknown;
        role?: unknown;
        content?: unknown;
        name?: unknown;
        arguments?: unknown;
        input?: unknown;
        call_id?: unknown;
        output?: unknown;
      };

      if (payload.type === 'message') {
        if (payload.role === 'user') {
          const text = extractTextBlocks(payload.content);
          if (!text || shouldSkipUserMessage(text)) {
            continue;
          }

          const message = buildMessage('user', text, timestamp);
          if (message) {
            messages.push(message);
          }
          continue;
        }

        if (payload.role === 'assistant') {
          const text = extractTextBlocks(payload.content);
          const message = buildMessage('assistant', text, timestamp);
          if (message) {
            messages.push(message);
          }
          continue;
        }
      }

      if (isToolCallType(payload.type)) {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        if (!callId) {
          continue;
        }

        const rawInput = payload.type === 'custom_tool_call' ? payload.input : payload.arguments;
        pendingToolCalls.set(callId, {
          name: typeof payload.name === 'string' ? payload.name : 'tool',
          input: typeof rawInput === 'string'
            ? safeJsonParse(rawInput)
            : rawInput,
          timestamp,
        });
        continue;
      }

      if (isToolCallOutputType(payload.type)) {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const pending = callId ? pendingToolCalls.get(callId) : null;
        if (callId) {
          pendingToolCalls.delete(callId);
        }

        const toolName = pending?.name || 'tool';
        const toolInput = pending?.input ?? {};
        const toolTimestamp = pending?.timestamp || timestamp;
        const output = buildToolResultContent(payload.output);

        messages.push({
          role: 'assistant',
          content: output,
          contentBlocks: [
            {
              type: 'tool_use',
              id: callId || `tool-${messages.length}`,
              name: toolName,
              input: toolInput,
            },
            {
              type: 'tool_result',
              tool_use_id: callId || `tool-${messages.length}`,
              content: output,
            },
          ],
          hasToolBlocks: true,
          timestamp: toolTimestamp,
        });
      }
    } catch {
      continue;
    }
  }

  for (const [callId, pending] of pendingToolCalls.entries()) {
    messages.push({
      role: 'assistant',
      content: pending.name,
      contentBlocks: [
        {
          type: 'tool_use',
          id: callId,
          name: pending.name,
          input: pending.input,
        },
      ],
      hasToolBlocks: true,
      timestamp: pending.timestamp,
    });
  }

  messages.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  return { info, messages };
}

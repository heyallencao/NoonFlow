import fs from 'fs';
import os from 'os';
import path from 'path';

import { summarizeSessionPreview, type SessionPreviewTag } from '@/lib/session-preview';
import type { MessageContentBlock } from '@/types';

export interface PiSessionInfo {
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

export interface PiParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  contentBlocks: MessageContentBlock[];
  hasToolBlocks: boolean;
  timestamp: string;
}

export interface PiParsedSession {
  info: PiSessionInfo;
  messages: PiParsedMessage[];
}

export interface PiSessionListOptions {
  projectPaths?: readonly string[];
  limit?: number;
}

export interface PiSessionPage {
  sessions: PiSessionInfo[];
  total: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? value as JsonRecord : null;
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function toIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function getPiSessionsDir(): string {
  const direct = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (direct) return path.resolve(direct.replace(/^~(?=$|\/)/, os.homedir()));
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) return path.join(path.resolve(agentDir.replace(/^~(?=$|\/)/, os.homedir())), 'sessions');
  return path.join(os.homedir(), '.pi', 'agent', 'sessions');
}

function listPiSessionFiles(): string[] {
  const root = getPiSessionsDir();
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
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

function readEntries(filePath: string): JsonRecord[] {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const value = JSON.parse(line);
          const record = asRecord(value);
          return record ? [record] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((rawBlock) => {
    const block = asRecord(rawBlock);
    if (!block) return '';
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
    if (block.type === 'thinking' && typeof block.thinking === 'string') return block.thinking;
    if (block.type === 'thinking' && typeof block.text === 'string') return block.text;
    if (block.type === 'image') return '[Image]';
    return '';
  }).filter(Boolean).join('\n');
}

function blocksFromMessage(message: JsonRecord): MessageContentBlock[] {
  const content = message.content;
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((rawBlock): MessageContentBlock[] => {
    const block = asRecord(rawBlock);
    if (!block) return [];
    if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
    if (block.type === 'thinking' && typeof block.thinking === 'string') return [{ type: 'reasoning', text: block.thinking }];
    if (block.type === 'thinking' && typeof block.text === 'string') return [{ type: 'reasoning', text: block.text }];
    if (block.type === 'toolCall') {
      return [{
        type: 'tool_use',
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : 'tool',
        input: block.arguments ?? {},
      }];
    }
    if (block.type === 'image') return [{ type: 'text', text: '[Image]' }];
    return [];
  });
}

function activeBranch(entries: JsonRecord[]): JsonRecord[] {
  const threaded = entries.filter((entry) => typeof entry.id === 'string');
  if (threaded.length === 0) return entries;
  const byId = new Map(threaded.map((entry) => [entry.id as string, entry]));
  const branch: JsonRecord[] = [];
  let current: JsonRecord | undefined = threaded[threaded.length - 1];
  const seen = new Set<string>();
  while (current && typeof current.id === 'string' && !seen.has(current.id)) {
    seen.add(current.id);
    branch.push(current);
    current = typeof current.parentId === 'string' ? byId.get(current.parentId) : undefined;
  }
  return branch.reverse();
}

const parseCache = new Map<string, { size: number; mtimeMs: number; value: PiParsedSession | null }>();

function scopedModel(provider: unknown, model: unknown): string {
  const providerName = typeof provider === 'string' ? provider.trim() : '';
  const modelName = typeof model === 'string' ? model.trim() : '';
  return providerName && modelName ? `${providerName}/${modelName}` : modelName;
}

function parsePiFileUncached(filePath: string, stat: fs.Stats): PiParsedSession | null {
  const entries = readEntries(filePath);
  const header = entries.find((entry) => entry.type === 'session');
  if (!header || typeof header.id !== 'string') return null;
  const fallbackTimestamp = stat.mtime.toISOString();
  const cwd = typeof header.cwd === 'string' && header.cwd ? header.cwd : path.dirname(filePath);
  const branch = activeBranch(entries.filter((entry) => entry.type !== 'session'));
  const messages: PiParsedMessage[] = [];
  let model = '';
  let title = '';

  for (const entry of branch) {
    if (entry.type === 'model_change') {
      if (typeof entry.modelId === 'string') model = scopedModel(entry.provider, entry.modelId);
      else if (typeof entry.model === 'string') model = entry.model;
      continue;
    }
    if (entry.type === 'session_info' && typeof entry.name === 'string') {
      title = entry.name;
      continue;
    }
    if (entry.type === 'compaction' || entry.type === 'branch_summary') {
      const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
      if (summary) {
        messages.push({
          role: 'assistant',
          content: `[Pi ${entry.type === 'compaction' ? 'compaction' : 'branch'} summary]\n${summary}`,
          contentBlocks: [{ type: 'text', text: `[Pi ${entry.type === 'compaction' ? 'compaction' : 'branch'} summary]\n${summary}` }],
          hasToolBlocks: false,
          timestamp: toIso(entry.timestamp, fallbackTimestamp),
        });
      }
      continue;
    }
    if (entry.type === 'custom_message') {
      const content = textFromContent(entry.content);
      if (content) {
        messages.push({
          role: 'assistant',
          content,
          contentBlocks: [{ type: 'text', text: content }],
          hasToolBlocks: false,
          timestamp: toIso(entry.timestamp, fallbackTimestamp),
        });
      }
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = asRecord(entry.message);
    if (!message || typeof message.role !== 'string') continue;
    if (message.role === 'assistant' && typeof message.model === 'string') {
      model = scopedModel(message.provider, message.model);
    }
    const timestamp = toIso(message.timestamp ?? entry.timestamp, fallbackTimestamp);
    if (message.role === 'user' || message.role === 'assistant') {
      const contentBlocks = blocksFromMessage(message);
      const content = textFromContent(message.content);
      if (contentBlocks.length === 0 && !content) continue;
      messages.push({
        role: message.role,
        content,
        contentBlocks: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: content }],
        hasToolBlocks: contentBlocks.some((block) => block.type === 'tool_use' || block.type === 'tool_result'),
        timestamp,
      });
      continue;
    }
    if (message.role === 'toolResult') {
      const content = textFromContent(message.content);
      messages.push({
        role: 'assistant',
        content,
        contentBlocks: [{
          type: 'tool_result',
          tool_use_id: typeof message.toolCallId === 'string' ? message.toolCallId : '',
          content,
          is_error: Boolean(message.isError),
        }],
        hasToolBlocks: true,
        timestamp,
      });
    }
  }

  const firstUser = messages.find((message) => message.role === 'user')?.content || '';
  const previewSummary = summarizeSessionPreview(title, firstUser);
  const timestamps = messages.map((message) => message.timestamp);
  const createdAt = toIso(header.timestamp, timestamps[0] || fallbackTimestamp);
  const updatedAt = timestamps[timestamps.length - 1] || fallbackTimestamp;
  return {
    info: {
      sessionId: header.id,
      title,
      projectPath: cwd,
      projectName: path.basename(cwd),
      cwd,
      gitBranch: '',
      version: typeof header.version === 'number' ? `session-v${header.version}` : '',
      model,
      preview: previewSummary.preview,
      previewTags: previewSummary.tags,
      userMessageCount: messages.filter((message) => message.role === 'user').length,
      assistantMessageCount: messages.filter((message) => message.role === 'assistant').length,
      createdAt,
      updatedAt,
      fileSize: stat.size,
    },
    messages,
  };
}

function parsePiFile(filePath: string): PiParsedSession | null {
  try {
    const stat = fs.statSync(filePath);
    const cached = parseCache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.value;
    const value = parsePiFileUncached(filePath, stat);
    parseCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, value });
    return value;
  } catch {
    parseCache.delete(filePath);
    return null;
  }
}

export function listPiSessionPage(options: PiSessionListOptions = {}): PiSessionPage {
  const allowed = new Set((options.projectPaths || []).map(normalizePath));
  const infos = listPiSessionFiles().flatMap((filePath) => {
    const parsed = parsePiFile(filePath);
    if (!parsed) return [];
    if (allowed.size > 0 && !allowed.has(normalizePath(parsed.info.cwd))) return [];
    return [parsed.info];
  }).sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return { sessions: options.limit === undefined ? infos : infos.slice(0, Math.max(0, options.limit)), total: infos.length };
}

export function listPiSessions(): PiSessionInfo[] {
  return listPiSessionPage().sessions;
}

export function parsePiSession(sessionId: string): PiParsedSession | null {
  for (const filePath of listPiSessionFiles()) {
    const parsed = parsePiFile(filePath);
    if (parsed?.info.sessionId === sessionId) return parsed;
  }
  return null;
}

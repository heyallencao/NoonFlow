/**
 * Parser for Claude Code CLI session files (.jsonl).
 *
 * Claude Code stores conversation history as JSONL files in:
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *
 * Each line is a JSON object with a `type` field:
 *   - "queue-operation": session lifecycle events (dequeue/enqueue)
 *   - "user": user messages with metadata (cwd, git branch, etc.)
 *   - "assistant": assistant responses with structured content blocks
 *
 * Messages are threaded via parentUuid → uuid chains.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MessageContentBlock } from '@/types';
import { summarizeSessionPreview, type SessionPreviewTag } from '@/lib/session-preview';
import { iterateJsonlLines } from '@/lib/jsonl-reader';

// ==========================================
// Constants
// ==========================================

const SESSION_LIST_SAMPLE_BYTES = 128 * 1024;
const sessionInfoCache = new Map<string, {
  size: number;
  mtimeMs: number;
  info: ClaudeSessionInfo | null;
}>();

// ==========================================
// Types for Claude Code JSONL entries
// ==========================================

export interface ClaudeSessionInfo {
  /** Session UUID (filename without .jsonl) */
  sessionId: string;
  /** Decoded project directory path (best-effort from folder name) */
  projectPath: string;
  /** Project folder name */
  projectName: string;
  /** Working directory from the first user message (authoritative) */
  cwd: string;
  /** Git branch from the first user message */
  gitBranch: string;
  /** Claude Code version used */
  version: string;
  /** AI Model used (extracted from assistant messages) */
  model: string;
  /** First user message preview (truncated) */
  preview: string;
  previewTags: SessionPreviewTag[];
  /** Number of user messages */
  userMessageCount: number;
  /** Number of assistant messages */
  assistantMessageCount: number;
  /** Session start timestamp */
  createdAt: string;
  /** Last message timestamp */
  updatedAt: string;
  /** File size in bytes */
  fileSize: number;
}

export interface ClaudeSessionListOptions {
  projectPaths?: readonly string[];
  limit?: number;
}

export interface ClaudeSessionPage {
  sessions: ClaudeSessionInfo[];
  total: number;
}

export interface ParsedMessage {
  role: 'user' | 'assistant';
  /** Plain text content for display */
  content: string;
  /** Structured content blocks (for assistant messages with tool usage) */
  contentBlocks: MessageContentBlock[];
  /** Whether this message contains tool calls */
  hasToolBlocks: boolean;
  /** Original timestamp from the JSONL entry */
  timestamp: string;
}

export interface ParsedSession {
  info: ClaudeSessionInfo;
  messages: ParsedMessage[];
}

// Raw JSONL entry types
interface JournalEntry {
  type: string;
  timestamp?: string;
  sessionId?: string;
  [key: string]: unknown;
}

interface UserEntry extends JournalEntry {
  type: 'user';
  parentUuid: string | null;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  uuid: string;
  timestamp: string;
}

interface AssistantEntry extends JournalEntry {
  type: 'assistant';
  parentUuid: string;
  cwd: string;
  sessionId: string;
  message: {
    content: ContentBlock[];
    id?: string;
    model?: string;
    role: 'assistant';
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  uuid: string;
  timestamp: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

// ==========================================
// Session Discovery
// ==========================================

/**
 * Get the Claude Code projects directory.
 */
export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Decode a Claude Code project directory name back to a filesystem path.
 *
 * Claude Code encodes absolute paths by replacing each '/' with '-'.
 * e.g., "/root/clawd" → "-root-clawd"
 *
 * NOTE: This is lossy — directory names containing hyphens are ambiguous.
 * e.g., "-root-my-project" could be "/root/my-project" or "/root/my/project".
 * The `cwd` field inside JSONL entries is the authoritative working directory;
 * this function is only used as a fallback for display purposes.
 */
export function decodeProjectPath(encodedName: string): string {
  if (!encodedName.startsWith('-')) {
    return encodedName;
  }
  return encodedName.replace(/^-/, '/').replace(/-/g, '/');
}

/**
 * List all available Claude Code CLI sessions.
 * Scans ~/.claude/projects/ for .jsonl files and extracts metadata.
 */
function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function encodeClaudeProjectPath(projectPath: string): string {
  return normalizeProjectPath(projectPath).replace(/\//g, '-');
}

export function listClaudeSessionPage(options: ClaudeSessionListOptions = {}): ClaudeSessionPage {
  const projectsDir = getClaudeProjectsDir();

  if (!fs.existsSync(projectsDir)) {
    return { sessions: [], total: 0 };
  }

  const allowedProjectPaths = new Set(
    (options.projectPaths || []).map(normalizeProjectPath).filter(Boolean),
  );
  const allowedProjectDirectories = new Set(
    Array.from(allowedProjectPaths, encodeClaudeProjectPath),
  );
  const hasProjectFilter = allowedProjectPaths.size > 0;
  const candidates: Array<{
    filePath: string;
    sessionId: string;
    projectPath: string;
    mtimeMs: number;
  }> = [];
  const sessions: ClaudeSessionInfo[] = [];

  try {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;
      if (hasProjectFilter && !allowedProjectDirectories.has(projectDir.name)) continue;

      const projectPath = path.join(projectsDir, projectDir.name);
      const decodedPath = decodeProjectPath(projectDir.name);

      try {
        const files = fs.readdirSync(projectPath);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        for (const jsonlFile of jsonlFiles) {
          const filePath = path.join(projectPath, jsonlFile);
          const sessionId = jsonlFile.replace('.jsonl', '');
          try {
            candidates.push({
              filePath,
              sessionId,
              projectPath: decodedPath,
              mtimeMs: fs.statSync(filePath).mtimeMs,
            });
          } catch {
            // Skip files that can't be inspected.
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    }
  } catch {
    // Projects directory can't be read
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const normalizedLimit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(0, Math.trunc(options.limit))
    : candidates.length;

  for (const candidate of candidates) {
    if (sessions.length >= normalizedLimit) break;
    try {
      const info = extractSessionInfo(candidate.filePath, candidate.sessionId, candidate.projectPath);
      if (!info) continue;
      if (hasProjectFilter && !allowedProjectPaths.has(normalizeProjectPath(info.cwd || info.projectPath))) {
        continue;
      }
      sessions.push(info);
    } catch {
      // Skip files that can't be parsed.
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return { sessions, total: candidates.length };
}

export function listClaudeSessions(options: ClaudeSessionListOptions = {}): ClaudeSessionInfo[] {
  return listClaudeSessionPage(options).sessions;
}

function readJsonlSampleLines(filePath: string, stat: fs.Stats): string[] {
  if (stat.size <= SESSION_LIST_SAMPLE_BYTES * 2) {
    return fs.readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim());
  }

  const descriptor = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.allocUnsafe(SESSION_LIST_SAMPLE_BYTES);
    const tail = Buffer.allocUnsafe(SESSION_LIST_SAMPLE_BYTES);
    const headBytes = fs.readSync(descriptor, head, 0, head.length, 0);
    const tailStart = Math.max(0, stat.size - tail.length);
    const tailBytes = fs.readSync(descriptor, tail, 0, tail.length, tailStart);
    const headLines = head.subarray(0, headBytes).toString('utf-8').split('\n');
    headLines.pop();
    const tailLines = tail.subarray(0, tailBytes).toString('utf-8').split('\n');
    if (tailStart > 0) tailLines.shift();
    return [...headLines, ...tailLines].filter((line) => line.trim());
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Extract metadata from a session JSONL file without fully parsing all messages.
 */
function extractSessionInfo(
  filePath: string,
  sessionId: string,
  projectPath: string,
): ClaudeSessionInfo | null {
  const stat = fs.statSync(filePath);
  const cached = sessionInfoCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.info;
  }
  const lines = readJsonlSampleLines(filePath, stat);

  if (lines.length === 0) return null;

  let cwd = '';
  let gitBranch = '';
  let version = '';
  let model = '';
  let previewSource = '';
  let previewTags: SessionPreviewTag[] = [];
  let createdAt = '';
  let updatedAt = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JournalEntry;

      if (entry.timestamp) {
        if (!createdAt) createdAt = entry.timestamp as string;
        updatedAt = entry.timestamp as string;
      }

      if (entry.type === 'user') {
        const userEntry = entry as UserEntry;
        userMessageCount++;

        if (!cwd && userEntry.cwd) cwd = userEntry.cwd;
        if (!gitBranch && userEntry.gitBranch) gitBranch = userEntry.gitBranch;
        if (!version && userEntry.version) version = userEntry.version;

        if (!previewSource && userEntry.message?.content) {
          const msgContent = userEntry.message.content;
          if (typeof msgContent === 'string') {
            previewSource = msgContent;
          } else if (Array.isArray(msgContent)) {
            const textBlock = msgContent.find(b => b.type === 'text');
            if (textBlock?.text) {
              previewSource = textBlock.text;
            }
          }
          previewTags = summarizeSessionPreview(previewSource).tags;
        }
      } else if (entry.type === 'assistant') {
        assistantMessageCount++;
        const assistantEntry = entry as AssistantEntry;
        if (!model && assistantEntry.message?.model) {
          model = assistantEntry.message.model;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Skip empty sessions (only queue-operation entries, no actual messages)
  if (userMessageCount === 0 && assistantMessageCount === 0) {
    return null;
  }

  // Use cwd from JSONL (authoritative) for projectName; fall back to decoded folder name
  const effectivePath = cwd || projectPath;

  const info: ClaudeSessionInfo = {
    sessionId,
    projectPath: effectivePath,
    projectName: path.basename(effectivePath),
    cwd: effectivePath,
    gitBranch: gitBranch || '',
    version: version || '',
    model: model || 'claude-3-5-sonnet-20241022', // fallback default
    preview: summarizeSessionPreview(previewSource).preview.slice(0, 120),
    previewTags,
    userMessageCount,
    assistantMessageCount,
    createdAt: createdAt || stat.birthtime.toISOString(),
    updatedAt: updatedAt || stat.mtime.toISOString(),
    fileSize: stat.size,
  };
  sessionInfoCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, info });
  return info;
}

// ==========================================
// Session Parsing
// ==========================================

/**
 * Fully parse a Claude Code session JSONL file into messages.
 * Reads the file once and extracts both metadata and messages in a single pass.
 */
export function parseClaudeSession(sessionId: string): ParsedSession | null {
  const projectsDir = getClaudeProjectsDir();

  if (!fs.existsSync(projectsDir)) return null;

  // Find the session file across all project directories
  let filePath: string | null = null;
  let projectPath = '';

  try {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const candidate = path.join(projectsDir, projectDir.name, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        projectPath = decodeProjectPath(projectDir.name);
        break;
      }
    }
  } catch {
    return null;
  }

  if (!filePath) return null;

  const stat = fs.statSync(filePath);

  // Single pass: extract both metadata and messages
  const messages: ParsedMessage[] = [];
  let cwd = '';
  let gitBranch = '';
  let version = '';
  let model = '';
  let previewSource = '';
  let previewTags: SessionPreviewTag[] = [];
  let createdAt = '';
  let updatedAt = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const line of iterateJsonlLines(filePath)) {
    try {
      const entry = JSON.parse(line) as JournalEntry;

      if (entry.timestamp) {
        if (!createdAt) createdAt = entry.timestamp as string;
        updatedAt = entry.timestamp as string;
      }

      if (entry.type === 'user') {
        const userEntry = entry as UserEntry;
        userMessageCount++;

        if (!cwd && userEntry.cwd) cwd = userEntry.cwd;
        if (!gitBranch && userEntry.gitBranch) gitBranch = userEntry.gitBranch;
        if (!version && userEntry.version) version = userEntry.version;

        if (!previewSource && userEntry.message?.content) {
          const msgContent = userEntry.message.content;
          if (typeof msgContent === 'string') {
            previewSource = msgContent;
          } else if (Array.isArray(msgContent)) {
            const textBlock = msgContent.find(b => b.type === 'text');
            if (textBlock?.text) {
              previewSource = textBlock.text;
            }
          }
          previewTags = summarizeSessionPreview(previewSource).tags;
        }

        const parsed = parseUserMessage(userEntry);
        if (parsed) messages.push(parsed);
      } else if (entry.type === 'assistant') {
        assistantMessageCount++;

        const assistantEntry = entry as AssistantEntry;
        if (!model && assistantEntry.message?.model) {
          model = assistantEntry.message.model;
        }
        
        const parsed = parseAssistantMessage(assistantEntry);
        if (parsed) messages.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Skip empty sessions
  if (userMessageCount === 0 && assistantMessageCount === 0) {
    return null;
  }

  const effectivePath = cwd || projectPath;

  const info: ClaudeSessionInfo = {
    sessionId,
    projectPath: effectivePath,
    projectName: path.basename(effectivePath),
    cwd: effectivePath,
    gitBranch: gitBranch || '',
    version: version || '',
    model: model || 'claude-3-5-sonnet-20241022',
    preview: summarizeSessionPreview(previewSource).preview.slice(0, 120),
    previewTags,
    userMessageCount,
    assistantMessageCount,
    createdAt: createdAt || stat.birthtime.toISOString(),
    updatedAt: updatedAt || stat.mtime.toISOString(),
    fileSize: stat.size,
  };

  return { info, messages };
}

/**
 * Parse a user message entry into a ParsedMessage.
 */
function parseUserMessage(entry: UserEntry): ParsedMessage | null {
  const msgContent = entry.message?.content;
  if (!msgContent) return null;

  let text: string;
  if (typeof msgContent === 'string') {
    text = msgContent;
  } else if (Array.isArray(msgContent)) {
    // User messages can have structured content (e.g., with images)
    text = msgContent
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  } else {
    return null;
  }

  if (!text.trim()) return null;

  return {
    role: 'user',
    content: text,
    contentBlocks: [{ type: 'text', text }],
    hasToolBlocks: false,
    timestamp: entry.timestamp || new Date().toISOString(),
  };
}

/**
 * Parse an assistant message entry into a ParsedMessage.
 * Handles text, tool_use, and tool_result content blocks.
 */
function parseAssistantMessage(entry: AssistantEntry): ParsedMessage | null {
  const msgContent = entry.message?.content;
  if (!msgContent || !Array.isArray(msgContent)) return null;

  const contentBlocks: MessageContentBlock[] = [];
  const textParts: string[] = [];
  let hasToolBlocks = false;

  for (const block of msgContent) {
    switch (block.type) {
      case 'text': {
        if (block.text) {
          contentBlocks.push({ type: 'text', text: block.text });
          textParts.push(block.text);
        }
        break;
      }
      case 'tool_use': {
        hasToolBlocks = true;
        contentBlocks.push({
          type: 'tool_use',
          id: block.id || '',
          name: block.name || '',
          input: block.input,
        });
        break;
      }
      case 'tool_result': {
        hasToolBlocks = true;
        const resultContent = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .filter(c => c.type === 'text')
                .map(c => c.text || '')
                .join('\n')
            : '';
        contentBlocks.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || '',
          content: resultContent,
          is_error: block.is_error || false,
        });
        break;
      }
    }
  }

  if (contentBlocks.length === 0) return null;

  // Plain text content: join all text blocks
  const plainText = textParts.join('\n');

  return {
    role: 'assistant',
    content: plainText,
    contentBlocks,
    hasToolBlocks,
    timestamp: entry.timestamp || new Date().toISOString(),
  };
}

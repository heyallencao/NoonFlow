import { listClaudeSessionPage, listClaudeSessions, parseClaudeSession } from '@/lib/claude-session-parser';
import { listCodexSessionPage, listCodexSessions, parseCodexSession } from '@/lib/codex-session-parser';
import { listPiSessionPage, listPiSessions, parsePiSession } from '@/lib/pi-session-parser';
import type { AssistantRuntime, Message } from '@/types';
import type { SessionPreviewTag } from '@/lib/session-preview';

export interface ReplaySessionInfo {
  runtime: AssistantRuntime;
  sessionId: string;
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
}

export interface ReplaySessionDetail {
  info: {
    id: string;
    runtime: AssistantRuntime;
    title: string;
    projectPath: string;
    projectName: string;
    cwd: string;
    gitBranch: string;
    version: string;
    model: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  };
  messages: Message[];
}

export interface ReplaySessionPageOptions {
  workspaces: readonly string[];
  cursor?: number;
  limit?: number;
  runtime?: AssistantRuntime;
  query?: string;
}

export interface ReplaySessionPage {
  sessions: ReplaySessionInfo[];
  total: number;
  workspaceTotal: number;
  nextCursor: number | null;
}

function toReplayMessages(sessionId: string, messages: Array<{
  role: 'user' | 'assistant';
  contentBlocks: unknown;
  timestamp: string;
}>): Message[] {
  return messages.map((message, index) => ({
    id: `${sessionId}-${index}`,
    session_id: sessionId,
    role: message.role,
    content: JSON.stringify(message.contentBlocks),
    created_at: message.timestamp,
    token_usage: null,
  }));
}

export function listReplaySessions(): ReplaySessionInfo[] {
  const claudeSessions = listClaudeSessions().map(toClaudeReplayInfo);
  const codexSessions = listCodexSessions().map(toCodexReplayInfo);
  const piSessions = listPiSessions().map(toPiReplayInfo);

  return [...claudeSessions, ...codexSessions, ...piSessions].sort(compareReplaySessions);
}

export function listReplaySessionsForWorkspaces(workspaces: readonly string[]): ReplaySessionInfo[] {
  const normalizedWorkspaces = Array.from(new Set(workspaces.map((workspace) => workspace.trim()).filter(Boolean)));
  if (normalizedWorkspaces.length === 0) return [];
  const claudeSessions = listClaudeSessionPage({ projectPaths: normalizedWorkspaces }).sessions.map(toClaudeReplayInfo);
  const codexSessions = listCodexSessionPage({ projectPaths: normalizedWorkspaces }).sessions.map(toCodexReplayInfo);
  const piSessions = listPiSessionPage({ projectPaths: normalizedWorkspaces }).sessions.map(toPiReplayInfo);
  return [...claudeSessions, ...codexSessions, ...piSessions].sort(compareReplaySessions);
}

function toClaudeReplayInfo(session: ReturnType<typeof listClaudeSessions>[number]): ReplaySessionInfo {
  return {
    runtime: 'claude_code' as const,
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    projectName: session.projectName,
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    version: session.version,
    model: session.model,
    preview: session.preview,
    previewTags: session.previewTags,
    userMessageCount: session.userMessageCount,
    assistantMessageCount: session.assistantMessageCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toCodexReplayInfo(session: ReturnType<typeof listCodexSessions>[number]): ReplaySessionInfo {
  return {
    runtime: 'codex' as const,
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    projectName: session.projectName,
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    version: session.version,
    model: session.model,
    preview: session.preview,
    previewTags: session.previewTags,
    userMessageCount: session.userMessageCount,
    assistantMessageCount: session.assistantMessageCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toPiReplayInfo(session: ReturnType<typeof listPiSessions>[number]): ReplaySessionInfo {
  return {
    runtime: 'pi' as const,
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    projectName: session.projectName,
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    version: session.version,
    model: session.model,
    preview: session.preview,
    previewTags: session.previewTags,
    userMessageCount: session.userMessageCount,
    assistantMessageCount: session.assistantMessageCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function compareReplaySessions(left: ReplaySessionInfo, right: ReplaySessionInfo): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function matchesReplayQuery(session: ReplaySessionInfo, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return [
    session.runtime,
    session.sessionId,
    session.projectName,
    session.projectPath,
    session.cwd,
    session.gitBranch,
    session.model,
    session.preview,
  ].some((value) => value?.toLowerCase().includes(query));
}

export function listReplaySessionPage(options: ReplaySessionPageOptions): ReplaySessionPage {
  const workspaces = Array.from(new Set(options.workspaces.map((workspace) => workspace.trim()).filter(Boolean)));
  if (workspaces.length === 0) {
    return { sessions: [], total: 0, workspaceTotal: 0, nextCursor: null };
  }

  const cursor = Math.max(0, Math.trunc(options.cursor || 0));
  const limit = Math.min(50, Math.max(1, Math.trunc(options.limit || 20)));
  const query = options.query?.trim() || '';
  const sourceLimit = query ? undefined : cursor + limit + 1;
  const claudePage = listClaudeSessionPage({
    projectPaths: workspaces,
    limit: options.runtime === 'codex' || options.runtime === 'pi' ? 0 : sourceLimit,
  });
  const codexPage = listCodexSessionPage({
    projectPaths: workspaces,
    limit: options.runtime === 'claude_code' || options.runtime === 'pi' ? 0 : sourceLimit,
  });
  const piPage = listPiSessionPage({
    projectPaths: workspaces,
    limit: options.runtime === 'claude_code' || options.runtime === 'codex' ? 0 : sourceLimit,
  });
  const candidates = [
    ...claudePage.sessions.map(toClaudeReplayInfo),
    ...codexPage.sessions.map(toCodexReplayInfo),
    ...piPage.sessions.map(toPiReplayInfo),
  ]
    .sort(compareReplaySessions)
    .filter((session) => matchesReplayQuery(session, query));
  const workspaceTotal = claudePage.total + codexPage.total + piPage.total;
  const runtimeTotal = options.runtime === 'claude_code'
    ? claudePage.total
    : options.runtime === 'codex'
    ? codexPage.total
    : options.runtime === 'pi'
    ? piPage.total
    : workspaceTotal;
  const total = query ? candidates.length : runtimeTotal;
  const sessions = candidates.slice(cursor, cursor + limit);
  const hasLookahead = candidates.length > cursor + limit;

  return {
    sessions,
    total,
    workspaceTotal,
    nextCursor: hasLookahead ? cursor + limit : null,
  };
}

export function getReplaySessionDetail(
  sessionId: string,
  runtime?: AssistantRuntime,
): ReplaySessionDetail | null {
  const runtimes: AssistantRuntime[] = runtime
    ? [runtime]
    : ['pi', 'codex', 'claude_code'];

  for (const currentRuntime of runtimes) {
    if (currentRuntime === 'claude_code') {
      const session = parseClaudeSession(sessionId);
      if (!session) {
        continue;
      }

      return {
        info: {
          id: session.info.sessionId,
          runtime: 'claude_code',
          title: session.info.preview || `Session ${session.info.sessionId.slice(0, 8)}`,
          projectPath: session.info.projectPath,
          projectName: session.info.projectName,
          cwd: session.info.cwd,
          gitBranch: session.info.gitBranch,
          version: session.info.version,
          model: session.info.model,
          messageCount: session.info.userMessageCount + session.info.assistantMessageCount,
          createdAt: session.info.createdAt,
          updatedAt: session.info.updatedAt,
        },
        messages: toReplayMessages(session.info.sessionId, session.messages),
      };
    }

    if (currentRuntime === 'pi') {
      const session = parsePiSession(sessionId);
      if (!session) continue;
      return {
        info: {
          id: session.info.sessionId,
          runtime: 'pi',
          title: session.info.title || session.info.preview || `Session ${session.info.sessionId.slice(0, 8)}`,
          projectPath: session.info.projectPath,
          projectName: session.info.projectName,
          cwd: session.info.cwd,
          gitBranch: session.info.gitBranch,
          version: session.info.version,
          model: session.info.model,
          messageCount: session.messages.length,
          createdAt: session.info.createdAt,
          updatedAt: session.info.updatedAt,
        },
        messages: toReplayMessages(session.info.sessionId, session.messages),
      };
    }

    const session = parseCodexSession(sessionId);
    if (!session) {
      continue;
    }

    return {
      info: {
        id: session.info.sessionId,
        runtime: 'codex',
        title: session.info.title || session.info.preview || `Session ${session.info.sessionId.slice(0, 8)}`,
        projectPath: session.info.projectPath,
        projectName: session.info.projectName,
        cwd: session.info.cwd,
        gitBranch: session.info.gitBranch,
        version: session.info.version,
        model: session.info.model,
        messageCount: session.messages.length,
        createdAt: session.info.createdAt,
        updatedAt: session.info.updatedAt,
      },
      messages: toReplayMessages(session.info.sessionId, session.messages),
    };
  }

  return null;
}

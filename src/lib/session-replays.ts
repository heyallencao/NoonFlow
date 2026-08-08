import { listClaudeSessions, parseClaudeSession } from '@/lib/claude-session-parser';
import { listCodexSessions, parseCodexSession } from '@/lib/codex-session-parser';
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
  const claudeSessions = listClaudeSessions().map((session) => ({
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
  }));

  const codexSessions = listCodexSessions().map((session) => ({
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
  }));

  return [...claudeSessions, ...codexSessions].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function getReplaySessionDetail(
  sessionId: string,
  runtime?: AssistantRuntime,
): ReplaySessionDetail | null {
  const runtimes: AssistantRuntime[] = runtime
    ? [runtime]
    : ['codex', 'claude_code'];

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

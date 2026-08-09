import path from 'path';

import { getDb } from '@/lib/db-core';
import { getReplaySessionDetail, listReplaySessions, listReplaySessionsForWorkspaces } from '@/lib/session-replays';
import type { AssistantRuntime, ChatSession, Message, SessionListType } from '@/types';

function toChatSession(info: ReturnType<typeof listReplaySessions>[number]): ChatSession {
  return {
    id: info.sessionId,
    title: info.preview || `${info.runtime === 'codex' ? 'Codex' : info.runtime === 'pi' ? 'Pi' : 'Claude'} ${info.sessionId.slice(0, 8)}`,
    created_at: info.createdAt,
    updated_at: info.updatedAt,
    session_type: 'chat',
    model: info.model || '',
    system_prompt: '',
    working_directory: info.cwd || info.projectPath || '',
    sdk_session_id: info.sessionId,
    project_name: info.projectName || path.basename(info.cwd || info.projectPath || ''),
    status: 'active',
    mode: 'code',
    needs_approval: false,
    provider_name: '',
    provider_id: '',
    sdk_cwd: info.cwd || info.projectPath || '',
    runtime_status: 'idle',
    runtime_updated_at: info.updatedAt,
    runtime_error: '',
    assistant_runtime: info.runtime,
    assistant_runtime_version: info.version || '',
  };
}

function replayDetailToChatSession(
  detail: NonNullable<ReturnType<typeof getReplaySessionDetail>>,
): ChatSession {
  return {
    id: detail.info.id,
    title: detail.info.title,
    created_at: detail.info.createdAt,
    updated_at: detail.info.updatedAt,
    session_type: 'chat',
    model: detail.info.model || '',
    system_prompt: '',
    working_directory: detail.info.cwd || detail.info.projectPath || '',
    sdk_session_id: detail.info.id,
    project_name: detail.info.projectName || path.basename(detail.info.cwd || detail.info.projectPath || ''),
    status: 'active',
    mode: 'code',
    needs_approval: false,
    provider_name: '',
    provider_id: '',
    sdk_cwd: detail.info.cwd || detail.info.projectPath || '',
    runtime_status: 'idle',
    runtime_updated_at: detail.info.updatedAt,
    runtime_error: '',
    assistant_runtime: detail.info.runtime,
    assistant_runtime_version: detail.info.version || '',
  };
}

export function listNativeSessions(
  sessionType: SessionListType = 'chat',
  workspace?: string | readonly string[],
): ChatSession[] {
  if (sessionType === 'terminal') {
    return [];
  }

  const workspaces = Array.isArray(workspace) ? workspace : workspace ? [workspace] : [];
  const sessions = workspaces.length > 0
    ? listReplaySessionsForWorkspaces(workspaces)
    : listReplaySessions();
  return sessions.map(toChatSession);
}

export function getNativeSession(
  sessionId: string,
  runtime?: AssistantRuntime,
): ChatSession | null {
  const detail = getReplaySessionDetail(sessionId, runtime);
  if (!detail) {
    return null;
  }
  return replayDetailToChatSession(detail);
}

export function getNativeSessionMessages(
  sessionId: string,
  runtime?: AssistantRuntime,
): Message[] | null {
  return getReplaySessionDetail(sessionId, runtime)?.messages ?? null;
}

/**
 * Materialize native history into the process-local TEMP tables expected by
 * the current streaming pipeline. Nothing written here reaches noonflow.db.
 */
export function ensureNativeSessionRuntime(
  sessionId: string,
  runtime?: AssistantRuntime,
): ChatSession | null {
  const database = getDb();
  const existing = database.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as ChatSession | undefined;
  if (existing) {
    return existing;
  }

  const detail = getReplaySessionDetail(sessionId, runtime);
  if (!detail) {
    return null;
  }
  const session = replayDetailToChatSession(detail);
  const messages = detail.messages;

  database.transaction(() => {
    database.prepare(
      `INSERT INTO chat_sessions (
        id, title, session_type, created_at, updated_at, model, system_prompt,
        working_directory, sdk_session_id, project_name, status, mode, sdk_cwd,
        provider_id, assistant_runtime, assistant_runtime_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      session.title,
      session.session_type,
      session.created_at,
      session.updated_at,
      session.model,
      '',
      session.working_directory,
      session.sdk_session_id,
      session.project_name,
      'active',
      'code',
      session.sdk_cwd,
      '',
      session.assistant_runtime,
      session.assistant_runtime_version,
    );

    const insertMessage = database.prepare(
      `INSERT INTO messages (
        id, session_id, role, content, created_at, token_usage,
        client_message_id, status, content_format_version, completed_at, persisted_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const message of messages) {
      insertMessage.run(
        message.id,
        session.id,
        message.role,
        message.content,
        message.created_at,
        null,
        null,
        'completed',
        2,
        message.created_at,
        1,
      );
    }
  })();

  return database.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as ChatSession;
}

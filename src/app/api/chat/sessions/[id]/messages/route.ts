import { NextRequest } from 'next/server';
import { getMessages, getSession } from '@/lib/db';
import { agentOrchestrator } from '@/lib/agent-runtime/orchestrator';
import type { MessagesResponse } from '@/types';
import { ensureNativeSessionRuntime } from '@/lib/native-session-catalog';

/** Strip base64 `data` fields from <!--files:...--> HTML comments in message content */
function stripFileData(content: string): string {
  const match = content.match(/^<!--files:(.*?)-->/);
  if (!match) return content;
  try {
    const files = JSON.parse(match[1]);
    const cleaned = files.map((f: Record<string, unknown>) => {
      const rest = { ...f };
      delete rest.data;
      return rest;
    });
    return `<!--files:${JSON.stringify(cleaned)}-->${content.slice(match[0].length)}`;
  } catch {
    return content;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existingSession = getSession(id) || ensureNativeSessionRuntime(id);
    if (!existingSession) {
      const empty: MessagesResponse = { messages: [], hasMore: false };
      return Response.json(empty, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    // Ensure interrupted streams are reconciled before reading persisted rows.
    // This avoids dropping visible content when a tab remount races with recovery.
    await agentOrchestrator.recoverSession(id);

    const session = getSession(id) || existingSession;
    if (!session) {
      const empty: MessagesResponse = { messages: [], hasMore: false };
      return Response.json(empty, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }
    if (session.session_type !== 'chat') {
      return Response.json({ error: 'Only chat sessions support messages' }, { status: 400 });
    }

    const searchParams = ('nextUrl' in request && request.nextUrl)
      ? request.nextUrl.searchParams
      : new URL(request.url).searchParams;
    const limitParam = searchParams.get('limit');
    const beforeParam = searchParams.get('before');

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 30, 1), 500) : 30;
    const beforeRowId = beforeParam ? parseInt(beforeParam, 10) || undefined : undefined;

    const { messages, hasMore } = getMessages(id, { limit, beforeRowId });
    // Sanitize: strip base64 data from file attachments in old messages
    const sanitizedMessages = messages.map(m => ({
      ...m,
      content: stripFileData(m.content),
    }));
    const response: MessagesResponse = { messages: sanitizedMessages, hasMore };
    return Response.json(response, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch messages';
    return Response.json({ error: message }, { status: 500 });
  }
}

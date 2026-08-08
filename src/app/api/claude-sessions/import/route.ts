import { NextRequest } from 'next/server';
import { parseClaudeSession } from '@/lib/claude-session-parser';
import { createSession, addMessage, updateSdkSessionId, getAllSessions } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return Response.json(
        { error: 'sessionId is required' },
        { status: 400 },
      );
    }

    // Check for duplicate import: reject if a session with this sdk_session_id already exists
    const existingSessions = getAllSessions();
    const alreadyImported = existingSessions.find(s => s.sdk_session_id === sessionId);
    if (alreadyImported) {
      return Response.json(
        {
          error: 'This session has already been imported',
          existingSessionId: alreadyImported.id,
        },
        { status: 409 },
      );
    }

    const parsed = parseClaudeSession(sessionId);
    if (!parsed) {
      return Response.json(
        { error: `Session "${sessionId}" not found or could not be parsed` },
        { status: 404 },
      );
    }

    const { info, messages } = parsed;

    if (messages.length === 0) {
      return Response.json(
        { error: 'Session has no messages to import' },
        { status: 400 },
      );
    }

    // Generate title from the first user message
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '')
      : `Imported: ${info.projectName}`;

    // Create a new NoonFlow session
    const session = createSession(
      title,
      undefined, // model — will use default
      undefined, // system prompt
      info.cwd || info.projectPath,
      'code',
    );

    // Store the original Claude Code SDK session ID so the conversation can be resumed
    updateSdkSessionId(session.id, sessionId);

    // Import all messages
    for (const msg of messages) {
      // For assistant messages with tool blocks, store as structured JSON
      // For text-only messages, store as plain text (consistent with NoonFlow's convention)
      const content = msg.hasToolBlocks
        ? JSON.stringify(msg.contentBlocks)
        : msg.content;

      if (content.trim()) {
        addMessage(session.id, msg.role, content);
      }
    }

    return Response.json({
      session: {
        id: session.id,
        title,
        messageCount: messages.length,
        projectPath: info.projectPath,
        sdkSessionId: sessionId,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/claude-sessions/import] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

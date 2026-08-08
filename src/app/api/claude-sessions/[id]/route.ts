import { parseClaudeSession } from '@/lib/claude-session-parser';
import type { Message } from '@/types';

/**
 * GET /api/claude-sessions/[id]
 *
 * 获取单个 Claude Code session 的完整信息（包括消息）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = parseClaudeSession(id);

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Convert ParsedMessage to Message format for frontend compatibility
    const messages: Message[] = session.messages.map((msg, index) => ({
      id: `${session.info.sessionId}-${index}`,
      session_id: session.info.sessionId,
      role: msg.role,
      content: JSON.stringify(msg.contentBlocks),
      created_at: msg.timestamp,
      token_usage: null,
    }));

    return Response.json({
      info: {
        id: session.info.sessionId,
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
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/claude-sessions/[id]] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

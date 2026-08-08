import { NextRequest } from 'next/server';
import { listClaudeSessions, parseClaudeSession, ParsedSession } from '@/lib/claude-session-parser';

export const dynamic = 'force-dynamic';

/**
 * GET /api/claude-sessions/tools
 * 获取所有 Claude Code 会话中的 tool 调用历史（每一次调用）
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    // 如果指定了 sessionId，返回单个会话的 tool 调用
    if (sessionId) {
      const session = parseClaudeSession(sessionId);
      if (!session) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }

      const toolCalls = extractToolCalls(session.messages);
      return Response.json({
        sessionId,
        projectPath: session.info.projectPath,
        cwd: session.info.cwd,
        toolCalls: toolCalls.slice(0, limit),
        totalToolCalls: toolCalls.length,
      });
    }

    // 否则返回所有会话的 tool 调用
    const sessions = listClaudeSessions();
    const allToolCalls: Array<{
      sessionId: string;
      projectPath: string;
      timestamp: string;
      toolName: string;
      toolUseId: string;
      input: unknown;
      result?: string;
      isError?: boolean;
    }> = [];

    for (const sessionInfo of sessions.slice(0, 50)) {
      try {
        const session = parseClaudeSession(sessionInfo.sessionId);
        if (!session) continue;

        const toolCalls = extractToolCalls(session.messages);
        for (const tc of toolCalls) {
          allToolCalls.push({
            sessionId: sessionInfo.sessionId,
            projectPath: sessionInfo.projectPath,
            ...tc,
          });
        }
      } catch {
        // Skip sessions that fail to parse
      }
    }

    // 按时间倒序
    allToolCalls.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return Response.json({
      toolCalls: allToolCalls.slice(0, limit),
      totalToolCalls: allToolCalls.length,
      sessionsCount: sessions.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

interface ToolCall {
  timestamp: string;
  toolName: string;
  toolUseId: string;
  input: unknown;
  result?: string;
  isError?: boolean;
}

function extractToolCalls(messages: ParsedSession['messages']): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const msg of messages) {
    if (!msg.contentBlocks) continue;

    for (const block of msg.contentBlocks) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          timestamp: msg.timestamp,
          toolName: block.name || 'unknown',
          toolUseId: block.id || '',
          input: block.input,
        });
      } else if (block.type === 'tool_result') {
        // 找到对应的 tool_use
        const toolUseId = block.tool_use_id;
        const existing = toolCalls.find(tc => tc.toolUseId === toolUseId && !tc.result);
        if (existing) {
          existing.result = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);
          existing.isError = block.is_error;
        }
      }
    }
  }

  return toolCalls;
}

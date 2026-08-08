import { listClaudeSessions } from '@/lib/claude-session-parser';

export async function GET() {
  try {
    const sessions = listClaudeSessions();
    return Response.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/claude-sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

import { listReplaySessions } from '@/lib/session-replays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessions = listReplaySessions();
    return Response.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/session-replays] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

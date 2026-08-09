import type { AssistantRuntime } from '@/types';
import { getReplaySessionDetail } from '@/lib/session-replays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const runtimeParam = url.searchParams.get('runtime');
    const runtime: AssistantRuntime | undefined = runtimeParam === 'codex'
      ? 'codex'
      : runtimeParam === 'claude_code'
      ? 'claude_code'
      : runtimeParam === 'pi'
      ? 'pi'
      : undefined;

    const session = getReplaySessionDetail(id, runtime);

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/session-replays/[id]] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

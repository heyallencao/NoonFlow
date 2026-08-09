import { NextRequest } from 'next/server';
import { listReplaySessionPage } from '@/lib/session-replays';
import type { AssistantRuntime } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBoundedInteger(value: string | null, fallback: number, maximum: number): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('INVALID_PAGINATION');
  return Math.min(maximum, Number.parseInt(value, 10));
}

export async function GET(request: NextRequest) {
  try {
    const workspaces = request.nextUrl.searchParams.getAll('workspace').slice(0, 100);
    const cursor = parseBoundedInteger(request.nextUrl.searchParams.get('cursor'), 0, 100_000);
    const limit = parseBoundedInteger(request.nextUrl.searchParams.get('limit'), 20, 50);
    const runtimeParam = request.nextUrl.searchParams.get('runtime');
    const runtime: AssistantRuntime | undefined = runtimeParam === 'codex' || runtimeParam === 'claude_code' || runtimeParam === 'pi'
      ? runtimeParam
      : undefined;
    const query = (request.nextUrl.searchParams.get('query') || '').slice(0, 200);
    return Response.json(listReplaySessionPage({ workspaces, cursor, limit, runtime, query }));
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PAGINATION') {
      return Response.json({ error: 'Invalid pagination parameters' }, { status: 400 });
    }
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/session-replays] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

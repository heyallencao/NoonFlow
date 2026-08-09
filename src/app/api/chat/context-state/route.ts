import { NextRequest } from 'next/server';
import { getRuntimeContextState } from '@/lib/context-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')?.trim();
  if (!sessionId) {
    return Response.json({ error: 'session_id is required' }, { status: 400 });
  }
  return Response.json({ state: getRuntimeContextState(sessionId) });
}

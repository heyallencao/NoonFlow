import { NextRequest } from 'next/server';
import { getRuntimeToolsStats } from '@/lib/runtime-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;

    const stats = getRuntimeToolsStats(days);
    return Response.json(stats);
  } catch (error) {
    console.error('[tools/stats] Error:', error);
    return Response.json({ error: 'Failed to fetch tools stats' }, { status: 500 });
  }
}

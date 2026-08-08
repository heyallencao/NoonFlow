import { NextRequest } from 'next/server';
import { getContextBudgetStats } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;

    const stats = getContextBudgetStats(days);
    return Response.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch context budget stats';
    return Response.json({ error: message }, { status: 500 });
  }
}

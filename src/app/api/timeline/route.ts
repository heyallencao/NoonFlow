import { NextRequest, NextResponse } from 'next/server';
import { getTimelineEvents } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timeline
 * Returns timeline events for the workspace
 *
 * Query params:
 * - days: number of days to look back (default: 30)
 * - type: filter by event type (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const typeFilter = searchParams.get('type');

    // Get timeline events
    let { events } = getTimelineEvents(days);

    // Filter by type if specified
    if (typeFilter) {
      events = events.filter(e => e.type === typeFilter);
    }

    return NextResponse.json({
      events,
      summary: {
        totalEvents: events.length,
        days,
      },
    });
  } catch (error) {
    console.error('[api/timeline] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline events' },
      { status: 500 }
    );
  }
}

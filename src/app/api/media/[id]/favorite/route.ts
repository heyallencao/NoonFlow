import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();

    const row = db.prepare('SELECT favorited FROM media_generations WHERE id = ?').get(id) as { favorited: number } | undefined;
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const newValue = row.favorited ? 0 : 1;
    db.prepare('UPDATE media_generations SET favorited = ? WHERE id = ?').run(newValue, id);

    return NextResponse.json({ favorited: newValue });
  } catch (error) {
    console.error('[media/favorite] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle favorite' },
      { status: 500 },
    );
  }
}

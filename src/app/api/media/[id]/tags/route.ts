import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!Array.isArray(body.tags)) {
      return NextResponse.json(
        { error: 'Missing required field: tags (must be an array)' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Verify the record exists
    const row = db.prepare('SELECT id FROM media_generations WHERE id = ?').get(id);
    if (!row) {
      return NextResponse.json(
        { error: 'Media generation not found' },
        { status: 404 }
      );
    }

    // Update tags
    db.prepare('UPDATE media_generations SET tags = ? WHERE id = ?').run(
      JSON.stringify(body.tags),
      id
    );

    const updated = db.prepare('SELECT * FROM media_generations WHERE id = ?').get(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[media/[id]/tags] PUT Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update tags' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();

    const result = db.prepare('DELETE FROM media_tags WHERE id = ?').run(id);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Tag not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[media/tags/[id]] DELETE Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete tag' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.prepare('SELECT * FROM media_generations WHERE id = ?').get(id);

    if (!row) {
      return NextResponse.json(
        { error: 'Media generation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    console.error('[media/[id]] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get media generation' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();

    // Get the record first to find the file path
    const row = db.prepare('SELECT * FROM media_generations WHERE id = ?').get(id) as {
      id: string;
      local_path: string;
      thumbnail_path: string;
    } | undefined;

    if (!row) {
      return NextResponse.json(
        { error: 'Media generation not found' },
        { status: 404 }
      );
    }

    // Delete the file from disk
    if (row.local_path && fs.existsSync(row.local_path)) {
      fs.unlinkSync(row.local_path);
    }
    if (row.thumbnail_path && fs.existsSync(row.thumbnail_path)) {
      fs.unlinkSync(row.thumbnail_path);
    }

    // Delete the record
    db.prepare('DELETE FROM media_generations WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[media/[id]] DELETE Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete media generation' },
      { status: 500 }
    );
  }
}

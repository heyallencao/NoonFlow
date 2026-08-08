import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const tags = db.prepare('SELECT * FROM media_tags ORDER BY name ASC').all();
    return NextResponse.json({ tags });
  } catch (error) {
    console.error('[media/tags] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM media_tags WHERE name = ?').get(body.name);
    if (existing) {
      return NextResponse.json(
        { error: 'Tag with this name already exists' },
        { status: 409 }
      );
    }

    const result = db.prepare(
      'INSERT INTO media_tags (name, color) VALUES (?, ?)'
    ).run(body.name.trim(), body.color || '');

    const tag = db.prepare('SELECT * FROM media_tags WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    console.error('[media/tags] POST Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create tag' },
      { status: 500 }
    );
  }
}

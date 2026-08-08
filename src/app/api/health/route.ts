import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    getDb().prepare('SELECT 1').get();
    return NextResponse.json({
      status: 'ok',
      checks: {
        db: 'ok',
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[health] readiness check failed:', error);
    return NextResponse.json({
      status: 'error',
      checks: {
        db: 'error',
      },
    }, { status: 503 });
  }
}

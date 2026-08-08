import { NextRequest, NextResponse } from 'next/server';
import { activateProvider, deactivateAllProviders, getProvider } from '@/lib/db';
import type { ErrorResponse } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    // Parse optional body — { active: boolean }, defaults to true
    let active = true;
    try {
      const body = await request.json();
      if (typeof body.active === 'boolean') {
        active = body.active;
      }
    } catch {
      // No body or invalid JSON — default to activate
    }

    if (!active) {
      deactivateAllProviders();
      return NextResponse.json({ success: true, active: false });
    }

    const existing = getProvider(id);
    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    const activated = activateProvider(id);
    if (!activated) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to activate provider' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, active: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to activate provider' },
      { status: 500 }
    );
  }
}

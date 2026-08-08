import { NextRequest, NextResponse } from 'next/server';
import { getConversation } from '@/lib/conversation-registry';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json({ applied: false, error: 'sessionId and mode are required' }, { status: 400 });
    }

    let payload: { sessionId?: string; mode?: string };
    try {
      payload = JSON.parse(rawBody) as { sessionId?: string; mode?: string };
    } catch {
      return NextResponse.json({ applied: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { sessionId, mode } = payload;

    if (!sessionId || !mode) {
      return NextResponse.json({ applied: false, error: 'sessionId and mode are required' }, { status: 400 });
    }

    const conversation = getConversation(sessionId);
    if (!conversation) {
      return NextResponse.json({ applied: false });
    }

    const permissionMode: PermissionMode = mode === 'code' ? 'acceptEdits' : 'plan';
    await conversation.setPermissionMode(permissionMode);

    return NextResponse.json({ applied: true });
  } catch (error) {
    console.error('[mode] Failed to switch mode:', error);
    return NextResponse.json({ applied: false, error: String(error) });
  }
}

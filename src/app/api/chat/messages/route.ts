import { NextRequest, NextResponse } from 'next/server';
import {
  addMessage,
  getSession,
  MessageIdempotencyConflictError,
  updateMessageBySessionAndHint,
  updateMessageContent,
  upsertAssistantMessage,
  upsertUserMessage,
} from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/chat/messages
 * Persist a message to the DB without triggering the model.
 * Used by image-gen mode to write user/assistant messages directly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, role, content, token_usage, client_message_id } = body as {
      session_id: string;
      role: 'user' | 'assistant';
      content: string;
      token_usage?: string;
      client_message_id?: string | null;
    };

    if (!session_id || !role || !content) {
      return NextResponse.json(
        { error: 'session_id, role, and content are required' },
        { status: 400 },
      );
    }

    const session = getSession(session_id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const sanitizedClientMessageId = (typeof client_message_id === 'string' && client_message_id.length <= 128)
      ? client_message_id
      : null;
    const message = sanitizedClientMessageId
      ? (
        role === 'assistant'
          ? upsertAssistantMessage(session_id, sanitizedClientMessageId, content, token_usage ?? null)
          : upsertUserMessage(session_id, sanitizedClientMessageId, content, token_usage ?? null)
      )
      : addMessage(session_id, role, content, token_usage ?? null, sanitizedClientMessageId);
    return NextResponse.json({ message });
  } catch (error) {
    if (error instanceof MessageIdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const msg = error instanceof Error ? error.message : 'Failed to save message';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/chat/messages
 * Update the content of an existing message.
 * Used to replace image-gen-request with image-gen-result after generation.
 *
 * Tries message_id first. If no rows updated (temp ID), falls back to
 * searching by session_id + prompt_hint for the real DB message.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { message_id, content, session_id, prompt_hint } = body as {
      message_id: string;
      content: string;
      session_id?: string;
      prompt_hint?: string;
    };

    if (!content) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 },
      );
    }

    // Try direct update by message_id
    let changes = 0;
    let updatedMessageId = message_id;
    let fallbackUsed = false;

    if (message_id) {
      changes = updateMessageContent(message_id, content);
    }

    // Fallback: search by session + prompt hint
    if (changes === 0 && session_id && prompt_hint) {
      const result = updateMessageBySessionAndHint(session_id, prompt_hint, content);
      changes = result.changes;
      if (result.messageId) {
        updatedMessageId = result.messageId;
        fallbackUsed = true;
      }
    }

    if (changes === 0) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, updated_message_id: updatedMessageId, fallback_used: fallbackUsed });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to update message';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

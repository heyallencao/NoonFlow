import { NextRequest } from 'next/server';
import {
  clearSessionMessages,
  deleteSession,
  getSession,
  updateSdkSessionId,
  updateSessionMode,
  updateSessionModel,
  updateSessionProviderId,
  updateSessionSystemPrompt,
  updateSessionTitle,
  updateSessionWorkingDirectory,
} from '@/lib/db';
import { agentOrchestrator } from '@/lib/agent-runtime/orchestrator';
import { evaluateCodexResumePatchInvalidation } from '@/lib/codex-resume-contract';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value === 'string') {
    return { ok: true, value };
  }
  return { ok: false, message: `"${fieldName}" must be a string` };
}

function asOptionalBoolean(
  value: unknown,
  fieldName: string,
): { ok: true; value: boolean | undefined } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value === 'boolean') {
    return { ok: true, value };
  }
  return { ok: false, message: `"${fieldName}" must be a boolean` };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = getSession(id);
    if (!existing) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    const { recovery, runtimeState } = await agentOrchestrator.recoverSession(id);
    const session = getSession(id) || existing;
    return Response.json({ session, recovery, runtimeState });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const payload = await request.json();
    if (!isPlainObject(payload)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const workingDirectory = asOptionalString(payload.working_directory, 'working_directory');
    if (!workingDirectory.ok) {
      return Response.json({ error: workingDirectory.message }, { status: 400 });
    }
    const title = asOptionalString(payload.title, 'title');
    if (!title.ok) {
      return Response.json({ error: title.message }, { status: 400 });
    }
    const mode = asOptionalString(payload.mode, 'mode');
    if (!mode.ok) {
      return Response.json({ error: mode.message }, { status: 400 });
    }
    const model = asOptionalString(payload.model, 'model');
    if (!model.ok) {
      return Response.json({ error: model.message }, { status: 400 });
    }
    const providerId = asOptionalString(payload.provider_id, 'provider_id');
    if (!providerId.ok) {
      return Response.json({ error: providerId.message }, { status: 400 });
    }
    const systemPrompt = asOptionalString(payload.system_prompt, 'system_prompt');
    if (!systemPrompt.ok) {
      return Response.json({ error: systemPrompt.message }, { status: 400 });
    }
    const clearMessages = asOptionalBoolean(payload.clear_messages, 'clear_messages');
    if (!clearMessages.ok) {
      return Response.json({ error: clearMessages.message }, { status: 400 });
    }

    const invalidationReasons = evaluateCodexResumePatchInvalidation({
      assistantRuntime: session.assistant_runtime,
      resumeSessionId: session.sdk_session_id,
      currentWorkingDirectory: session.working_directory,
      currentMode: session.mode,
      currentModel: session.model,
      currentProviderId: session.provider_id,
      currentSystemPrompt: session.system_prompt,
      patch: {
        working_directory: workingDirectory.value,
        mode: mode.value,
        model: model.value,
        provider_id: providerId.value,
        system_prompt: systemPrompt.value,
        clear_messages: clearMessages.value,
      },
    });

    if (workingDirectory.value !== undefined) {
      updateSessionWorkingDirectory(id, workingDirectory.value);
    }
    if (title.value) {
      updateSessionTitle(id, title.value);
    }
    if (mode.value) {
      updateSessionMode(id, mode.value);
    }
    if (model.value !== undefined) {
      updateSessionModel(id, model.value);
    }
    if (providerId.value !== undefined) {
      updateSessionProviderId(id, providerId.value);
    }
    if (systemPrompt.value !== undefined) {
      updateSessionSystemPrompt(id, systemPrompt.value);
    }
    // assistant_runtime is now immutable after session creation
    // if (body.assistant_runtime !== undefined) {
    //   updateSessionAssistantRuntime(id, body.assistant_runtime);
    // }
    if (clearMessages.value) {
      clearSessionMessages(id);
    }
    if (invalidationReasons.length > 0) {
      updateSdkSessionId(id, '');
      console.info('[chat sessions PATCH] invalidated codex resume session', {
        sessionId: id,
        reasons: invalidationReasons,
      });
    }

    const updated = getSession(id);
    return Response.json({ session: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    deleteSession(id);
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete session';
    return Response.json({ error: message }, { status: 500 });
  }
}

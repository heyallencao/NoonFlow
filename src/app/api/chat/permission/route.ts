import { NextRequest } from 'next/server';
import { resolvePendingPermission } from '@/lib/permission-registry';
import { getPermissionRequest, resolvePermissionRequest } from '@/lib/db';
import { sessionStateManager } from '@/lib/session-state-manager';
import { agentOrchestrator } from '@/lib/agent-runtime/orchestrator';
import type { PermissionResponseRequest } from '@/types';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body: PermissionResponseRequest = await request.json();
    const { permissionRequestId, decision } = body;

    if (!permissionRequestId || !decision) {
      return new Response(
        JSON.stringify({ error: 'permissionRequestId and decision are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const dbRecord = getPermissionRequest(permissionRequestId);
    if (!dbRecord) {
      return new Response(
        JSON.stringify({ error: 'Permission request not found', code: 'NOT_FOUND' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (dbRecord.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: `Permission request already resolved (status: ${dbRecord.status})`, code: 'ALREADY_RESOLVED' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let result: PermissionResult;
    if (decision.behavior === 'allow') {
      result = {
        behavior: 'allow',
        updatedPermissions: decision.updatedPermissions as unknown as PermissionUpdate[],
        ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
      };
    } else {
      result = {
        behavior: 'deny',
        message: decision.message || 'User denied permission',
      };
    }

    const found = resolvePendingPermission(permissionRequestId, result);

    if (!found) {
      let recoveredInput: Record<string, unknown> | undefined;
      if (result.behavior === 'allow') {
        try {
          recoveredInput = result.updatedInput ?? JSON.parse(dbRecord.tool_input) as Record<string, unknown>;
        } catch {
          recoveredInput = result.updatedInput;
        }
      }

      const recovered = resolvePermissionRequest(
        permissionRequestId,
        result.behavior === 'allow' ? 'allow' : 'deny',
        {
          updatedPermissions: result.behavior === 'allow' ? (result.updatedPermissions as unknown[]) : undefined,
          updatedInput: recoveredInput,
          message: result.behavior === 'deny' ? result.message : 'Recovered after restart',
        },
      );

      if (!recovered) {
        return new Response(
          JSON.stringify({ error: 'Permission request could not be recovered', code: 'RECOVERY_FAILED' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }

      sessionStateManager.markRecoveredPermissionResolved(dbRecord.session_id, result.behavior);
      await agentOrchestrator.resolvePermission({
        sessionId: dbRecord.session_id,
        permissionRequestId,
        approved: result.behavior === 'allow',
        source: 'ui',
        message: result.behavior === 'deny' ? result.message : 'Recovered permission resolved',
        nextStatus: 'idle',
      });

      return new Response(
        JSON.stringify({ success: true, recovered: true, requires_restart: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    await agentOrchestrator.resolvePermission({
      sessionId: dbRecord.session_id,
      permissionRequestId,
      approved: result.behavior === 'allow',
      source: 'ui',
      message: result.behavior === 'deny' ? result.message : 'Permission approved',
      nextStatus: result.behavior === 'allow' ? 'running' : 'idle',
    });

    return new Response(
      JSON.stringify({ success: true, recovered: false, requires_restart: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

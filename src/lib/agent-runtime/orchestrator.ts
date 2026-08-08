import {
  getSessionRuntimeState,
  type SessionRuntimeStateRecord,
  upsertSessionRuntimeState,
} from '@/lib/db';
import { sessionStateManager, type RecoveredSessionState } from '@/lib/session-state-manager';
import { agentEventBus, EventBus } from './event-bus';
import type {
  AgentEvent,
  AgentEventSource,
  PermissionRequiredEvent,
  PermissionResolvedEvent,
  SessionErrorEvent,
} from './event-types';

export interface SessionConfig {
  sessionId: string;
  source: AgentEventSource;
  workingDirectory?: string;
  model?: string;
}

export interface OrchestratorRecovery {
  recovery: RecoveredSessionState | undefined;
  runtimeState: SessionRuntimeStateRecord | undefined;
}

function buildLastEventId(event: AgentEvent): string {
  return event.metadata.eventId || `${event.metadata.sessionId}:${event.type}:${event.metadata.timestamp}`;
}

function parsePendingPermissions(state: SessionRuntimeStateRecord | undefined): Array<Record<string, unknown>> {
  if (!state?.pending_permissions) {
    return [];
  }

  try {
    const parsed = JSON.parse(state.pending_permissions);
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

export class Orchestrator {
  constructor(private eventBus: EventBus = agentEventBus) {}

  async startSession(config: SessionConfig): Promise<void> {
    upsertSessionRuntimeState(config.sessionId, {
      status: 'running',
      pendingPermissions: [],
      generationQueue: [],
      lastEventId: `${config.sessionId}:session.bootstrap:${Date.now()}`,
    });
  }

  handleEvent(event: AgentEvent): AgentEvent {
    this.persistLifecycleState(event);
    this.eventBus.emit(event);
    return event;
  }

  async handlePermissionRequest(params: {
    sessionId: string;
    source: AgentEventSource;
    request: PermissionRequiredEvent['request'];
  }): Promise<PermissionRequiredEvent> {
    const event: PermissionRequiredEvent = {
      type: 'permission.required',
      metadata: {
        sessionId: params.sessionId,
        timestamp: Date.now(),
        source: params.source,
        rawType: 'permission.required',
        eventId: `${params.sessionId}:permission.required:${Date.now()}`,
      },
      request: params.request,
    };

    return this.handleEvent(event) as PermissionRequiredEvent;
  }

  async resolvePermission(params: {
    sessionId: string;
    permissionRequestId: string;
    approved: boolean;
    source?: AgentEventSource;
    message?: string;
    nextStatus?: SessionRuntimeStateRecord['status'];
  }): Promise<PermissionResolvedEvent> {
    const runtimeState = getSessionRuntimeState(params.sessionId);
    const pendingPermissions = parsePendingPermissions(runtimeState).filter((entry) => {
      return entry.permissionRequestId !== params.permissionRequestId;
    });

    upsertSessionRuntimeState(params.sessionId, {
      status: params.nextStatus ?? (params.approved ? 'running' : 'idle'),
      pendingPermissions,
      lastEventId: `${params.sessionId}:permission.resolved:${Date.now()}`,
    });

    const event: PermissionResolvedEvent = {
      type: 'permission.resolved',
      metadata: {
        sessionId: params.sessionId,
        timestamp: Date.now(),
        source: params.source || 'ui',
        rawType: 'permission.resolved',
        eventId: `${params.sessionId}:permission.resolved:${Date.now()}`,
      },
      permissionRequestId: params.permissionRequestId,
      approved: params.approved,
      message: params.message,
    };

    this.eventBus.emit(event);
    return event;
  }

  async recoverSession(sessionId: string): Promise<OrchestratorRecovery> {
    return {
      recovery: sessionStateManager.recoverSession(sessionId),
      runtimeState: getSessionRuntimeState(sessionId),
    };
  }

  markSessionError(sessionId: string, error: string, source: AgentEventSource): SessionErrorEvent {
    const event: SessionErrorEvent = {
      type: 'session.error',
      metadata: {
        sessionId,
        timestamp: Date.now(),
        source,
        rawType: 'session.error',
        eventId: `${sessionId}:session.error:${Date.now()}`,
      },
      error,
    };
    return this.handleEvent(event) as SessionErrorEvent;
  }

  private persistLifecycleState(event: AgentEvent): void {
    const lastEventId = buildLastEventId(event);

    switch (event.type) {
      case 'session.started':
        upsertSessionRuntimeState(event.metadata.sessionId, {
          status: 'running',
          lastEventId,
        });
        break;

      case 'permission.required': {
        const runtimeState = getSessionRuntimeState(event.metadata.sessionId);
        const pendingPermissions = parsePendingPermissions(runtimeState);
        const nextPermissions = [
          ...pendingPermissions.filter((entry) => entry.permissionRequestId !== event.request.permissionRequestId),
          {
            permissionRequestId: event.request.permissionRequestId,
            toolName: event.request.toolName,
            description: event.request.description,
          },
        ];
        upsertSessionRuntimeState(event.metadata.sessionId, {
          status: 'waiting_permission',
          pendingPermissions: nextPermissions,
          lastEventId,
        });
        break;
      }

      case 'session.completed': {
        const currentState = getSessionRuntimeState(event.metadata.sessionId);
        const nextStatus = currentState?.status === 'error' ? 'error' : 'idle';
        upsertSessionRuntimeState(event.metadata.sessionId, {
          status: nextStatus,
          pendingPermissions: nextStatus === 'idle' ? [] : undefined,
          lastEventId,
        });
        if (nextStatus === 'idle') {
          sessionStateManager.updateSessionState(event.metadata.sessionId, {
            runtimeStatus: 'idle',
            runtimeError: '',
          });
        }
        break;
      }

      case 'session.error':
        upsertSessionRuntimeState(event.metadata.sessionId, {
          status: 'error',
          lastEventId,
        });
        sessionStateManager.updateSessionState(event.metadata.sessionId, {
          runtimeStatus: 'error',
          runtimeError: event.error,
        });
        break;

      case 'session.result':
        upsertSessionRuntimeState(event.metadata.sessionId, {
          lastEventId,
        });
        break;

      default:
        break;
    }
  }
}

export const agentOrchestrator = new Orchestrator();

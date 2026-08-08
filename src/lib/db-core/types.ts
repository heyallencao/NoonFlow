export type SessionRuntimeStatus = 'idle' | 'running' | 'waiting_permission' | 'stopping' | 'error';

export interface MessagePartInput {
  partType: 'text' | 'reasoning' | 'tool_use' | 'tool_result';
  content: string;
  metadata?: Record<string, unknown> | null;
  partKey?: string | null;
  partIndex?: number | null;
  revision?: number | null;
  isFinal?: boolean | null;
  updatedAt?: number | null;
}

export interface MessagePartRecord {
  id: number;
  session_id: string;
  message_id: string;
  part_type: MessagePartInput['partType'];
  content: string;
  metadata: string | null;
  created_at: number;
  part_key: string | null;
  part_index: number | null;
  revision: number | null;
  is_final: number | null;
  updated_at: number | null;
}

export interface SessionRuntimeStateRecord {
  session_id: string;
  status: SessionRuntimeStatus;
  pending_permissions: string;
  generation_queue: string;
  last_event_id: string | null;
  updated_at: number;
}

export interface SessionRuntimeStatePatch {
  status?: SessionRuntimeStatus;
  pendingPermissions?: unknown[];
  generationQueue?: unknown[];
  lastEventId?: string | null;
}

export interface SessionRuntimeLockRecord {
  session_id: string;
  lock_id: string;
  owner: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

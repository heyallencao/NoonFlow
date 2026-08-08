type SessionRefreshType = 'created' | 'updated' | 'deleted' | 'refetch';
type SessionType = 'chat' | 'terminal';

export interface SessionRefreshDetail {
  type: SessionRefreshType;
  sessionId?: string;
  sessionIds?: string[];
  title?: string;
  sessionType?: SessionType;
  workingDirectory?: string;
  source?: 'hub' | 'legacy';
}

type SessionRefreshListener = (detail: SessionRefreshDetail) => void;

const GLOBAL_SESSION_REFRESH_BUS_KEY = '__noonflowSessionRefreshBus__' as const;

class SessionRefreshBus {
  private listeners = new Set<SessionRefreshListener>();

  emit(detail: SessionRefreshDetail): void {
    this.listeners.forEach((listener) => listener(detail));
  }

  subscribe(listener: SessionRefreshListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
}

function getSessionRefreshBus(): SessionRefreshBus {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[GLOBAL_SESSION_REFRESH_BUS_KEY]) {
    globalObject[GLOBAL_SESSION_REFRESH_BUS_KEY] = new SessionRefreshBus();
  }
  return globalObject[GLOBAL_SESSION_REFRESH_BUS_KEY] as SessionRefreshBus;
}

export function ensureSessionRefreshCompatibility() {
  return;
}

export function publishSessionRefresh(detail: SessionRefreshDetail) {
  getSessionRefreshBus().emit({
    ...detail,
    source: detail.source ?? 'hub',
  });
}

export function subscribeSessionRefresh(listener: SessionRefreshListener) {
  return getSessionRefreshBus().subscribe(listener);
}

export function publishSessionCreated(detail: Omit<SessionRefreshDetail, 'type'> = {}) {
  publishSessionRefresh({ ...detail, type: 'created' });
}

export function publishSessionUpdated(detail: Omit<SessionRefreshDetail, 'type'> = {}) {
  publishSessionRefresh({ ...detail, type: 'updated' });
}

export function publishSessionDeleted(detail: Omit<SessionRefreshDetail, 'type'> = {}) {
  publishSessionRefresh({ ...detail, type: 'deleted' });
}

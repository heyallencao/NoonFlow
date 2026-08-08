import type { AgentEvent, AgentEventType } from './event-types';

type AgentEventHandler = (event: AgentEvent) => void;

type EventKey = AgentEventType | '*';

const GLOBAL_EVENT_BUS_KEY = '__noonflowAgentEventBus__' as const;

export class EventBus {
  private listeners = new Map<EventKey, Set<AgentEventHandler>>();

  emit(event: AgentEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => handler(event));
    this.listeners.get('*')?.forEach((handler) => handler(event));
  }

  on(eventType: EventKey, handler: AgentEventHandler): () => void {
    const handlers = this.listeners.get(eventType) ?? new Set<AgentEventHandler>();
    handlers.add(handler);
    this.listeners.set(eventType, handlers);

    return () => {
      this.off(eventType, handler);
    };
  }

  off(eventType: EventKey, handler: AgentEventHandler): void {
    const handlers = this.listeners.get(eventType);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(eventType);
    }
  }

  clear(eventType?: EventKey): void {
    if (eventType) {
      this.listeners.delete(eventType);
      return;
    }

    this.listeners.clear();
  }
}

export function getAgentEventBus(): EventBus {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[GLOBAL_EVENT_BUS_KEY]) {
    globalObject[GLOBAL_EVENT_BUS_KEY] = new EventBus();
  }
  return globalObject[GLOBAL_EVENT_BUS_KEY] as EventBus;
}

export const agentEventBus = getAgentEventBus();

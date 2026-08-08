import type { Query } from '@anthropic-ai/claude-agent-sdk';

const globalKey = '__activeConversations__' as const;

function getMap(): Map<string, Query> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, Query>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, Query>;
}

export function registerConversation(sessionId: string, conversation: Query): void {
  getMap().set(sessionId, conversation);
}

export function unregisterConversation(sessionId: string): void {
  getMap().delete(sessionId);
}

export function getConversation(sessionId: string): Query | undefined {
  return getMap().get(sessionId);
}

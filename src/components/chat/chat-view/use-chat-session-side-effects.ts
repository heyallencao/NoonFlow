import { useCallback } from 'react';
import { toast } from 'sonner';
import type { Message } from '@/types';
import { publishSessionUpdated } from '@/lib/events/session-refresh-hub';

interface UseChatSessionSideEffectsParams {
  sessionId: string;
  updateSessionMeta: (sessionId: string, meta: {
    sessionModel?: string;
    sessionProviderId?: string;
    sessionMode?: string;
  }) => void;
  clearMessages: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: Message[], hasMore: boolean) => void;
  mergeMessagesFromServer: (sessionId: string, messages: Message[], hasMore: boolean) => boolean;
}

interface UseChatSessionSideEffectsResult {
  handleModeChange: (newMode: string) => void;
  handleProviderModelChange: (newProviderId: string, model: string) => void;
  handleModelChange: (model: string) => void;
  clearSessionMessages: (previousMessages: Message[]) => void;
}

export function useChatSessionSideEffects(
  params: UseChatSessionSideEffectsParams,
): UseChatSessionSideEffectsResult {
  const {
    sessionId,
    updateSessionMeta,
    clearMessages,
    setMessages,
    mergeMessagesFromServer,
  } = params;

  const handleModeChange = useCallback((newMode: string) => {
    updateSessionMeta(sessionId, { sessionMode: newMode });
    if (!sessionId) {
      return;
    }

    fetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    }).then(() => {
      publishSessionUpdated({ sessionId });
    }).catch(() => { /* silent */ });

    fetch('/api/chat/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, mode: newMode }),
    }).catch(() => { /* silent */ });
  }, [sessionId, updateSessionMeta]);

  const handleProviderModelChange = useCallback((newProviderId: string, model: string) => {
    updateSessionMeta(sessionId, {
      sessionModel: model,
      sessionProviderId: newProviderId,
    });
    fetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider_id: newProviderId }),
    }).catch(() => { /* silent */ });
  }, [sessionId, updateSessionMeta]);

  const handleModelChange = useCallback((model: string) => {
    updateSessionMeta(sessionId, { sessionModel: model });
  }, [sessionId, updateSessionMeta]);

  const clearSessionMessages = useCallback((previousMessages: Message[]) => {
    if (!sessionId) {
      return;
    }

    const restoreMessages = async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=30`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error('Failed to reload messages');
        }

        const data = await res.json() as { messages?: Message[]; hasMore?: boolean };
        if (Array.isArray(data.messages)) {
          mergeMessagesFromServer(sessionId, data.messages, data.hasMore ?? false);
          return;
        }
      } catch {
        setMessages(sessionId, previousMessages, false);
      }
    };

    clearMessages(sessionId);
    fetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_messages: true }),
    }).then((res) => {
      if (!res.ok) {
        void restoreMessages();
        toast.error('Failed to clear messages');
      }
    }).catch(() => {
      void restoreMessages();
      toast.error('Failed to clear messages');
    });
  }, [clearMessages, mergeMessagesFromServer, sessionId, setMessages]);

  return {
    handleModeChange,
    handleProviderModelChange,
    handleModelChange,
    clearSessionMessages,
  };
}

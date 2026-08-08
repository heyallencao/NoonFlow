import { useCallback, useRef, useState } from 'react';
import type { Message, MessagesResponse } from '@/types';

interface UseChatHistoryPaginationParams {
  sessionId: string;
  hasMore: boolean;
  messages: Message[];
  prependMessages: (sessionId: string, messages: Message[], hasMore: boolean) => void;
}

interface UseChatHistoryPaginationResult {
  loadingMore: boolean;
  loadEarlierMessages: () => Promise<void>;
}

export function useChatHistoryPagination(
  params: UseChatHistoryPaginationParams,
): UseChatHistoryPaginationResult {
  const { sessionId, hasMore, messages, prependMessages } = params;
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadEarlierMessages = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || messages.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const earliest = messages[0];
      const earliestRowId = (earliest as Message & { _rowid?: number })._rowid;
      if (!earliestRowId) return;
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=100&before=${earliestRowId}`);
      if (!res.ok) return;
      const data: MessagesResponse = await res.json();
      if (data.messages.length > 0) {
        prependMessages(sessionId, data.messages, data.hasMore ?? false);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, messages, prependMessages, sessionId]);

  return {
    loadingMore,
    loadEarlierMessages,
  };
}

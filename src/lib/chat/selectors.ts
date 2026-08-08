import {
  EMPTY_CHAT_TIMELINE_SESSION,
  type ChatTimelineSessionState,
} from '@/lib/chat/reducer';

interface ChatTimelineSessionsState {
  sessions: Record<string, ChatTimelineSessionState>;
}

export function selectChatTimelineSession(
  state: ChatTimelineSessionsState,
  sessionId: string,
): ChatTimelineSessionState {
  return state.sessions[sessionId] ?? EMPTY_CHAT_TIMELINE_SESSION;
}

export function selectChatTimelineMessages(
  state: ChatTimelineSessionsState,
  sessionId: string,
) {
  return selectChatTimelineSession(state, sessionId).messages;
}

export function selectHasOptimisticTimelineMessages(
  state: ChatTimelineSessionsState,
  sessionId: string,
): boolean {
  return selectChatTimelineSession(state, sessionId).hasOptimisticMessages;
}

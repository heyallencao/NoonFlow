import { useCallback } from 'react';
import type { Message } from '@/types';
import { buildCostCommandMessage, buildHelpCommandMessage } from './command-messages';

interface UseChatCommandHandlerParams {
  sessionId: string;
  messages: Message[];
  onSendMessage: (content: string) => void;
  onClearMessages: (previousMessages: Message[]) => void;
  appendMessage: (sessionId: string, message: Message) => void;
  syncMessagesFromTimeline: (sessionId: string) => void;
}

interface UseChatCommandHandlerResult {
  handleCommand: (command: string) => void;
}

export function useChatCommandHandler(
  params: UseChatCommandHandlerParams,
): UseChatCommandHandlerResult {
  const {
    sessionId,
    messages,
    onSendMessage,
    onClearMessages,
    appendMessage,
    syncMessagesFromTimeline,
  } = params;

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        appendMessage(sessionId, buildHelpCommandMessage(sessionId));
        syncMessagesFromTimeline(sessionId);
        break;
      }
      case '/clear': {
        onClearMessages([...messages]);
        break;
      }
      case '/cost': {
        appendMessage(sessionId, buildCostCommandMessage(sessionId, messages));
        syncMessagesFromTimeline(sessionId);
        break;
      }
      default:
        onSendMessage(command);
    }
  }, [
    appendMessage,
    messages,
    onClearMessages,
    onSendMessage,
    sessionId,
    syncMessagesFromTimeline,
  ]);

  return { handleCommand };
}

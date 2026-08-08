import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { rememberPermissionScope } from '@/lib/permission-memory';
import {
  startStream,
  stopStream,
  respondToPermission,
} from '@/lib/stream-session-manager';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import type {
  AssistantRuntime,
  FileAttachment,
  Message,
  PermissionRequestEvent,
} from '@/types';

function createClientMessageId(): string {
  return `msg-${Date.now()}-${nanoid(12)}`;
}

interface UseChatStreamControllerParams {
  sessionId: string;
  sessionResolved: boolean;
  isStreaming: boolean;
  mode: string;
  currentModel: string;
  currentProviderId: string;
  currentAssistantRuntime: AssistantRuntime;
  pendingPermission: PermissionRequestEvent | null;
  permissionResolved: string | null;
  setPendingApprovalSessionId: (sessionId: string) => void;
  onModeChange: (mode: string) => void;
  consumePendingImageNotices: () => string[] | undefined;
  appendMessage: (sessionId: string, message: Message) => void;
  upsertOptimisticAssistant: (sessionId: string, clientMessageId: string) => string;
  removeMessage: (sessionId: string, messageId: string) => void;
  syncMessagesFromTimeline: (sessionId: string) => void;
  onUserMessageSent?: () => void;
}

interface UseChatStreamControllerResult {
  isSendLocked: boolean;
  isStopping: boolean;
  updateSendLock: (locked: boolean) => void;
  sendMessage: (
    content: string,
    files?: FileAttachment[],
    systemPromptAppend?: string,
    displayOverride?: string,
    clientMessageIdOverride?: string,
  ) => Promise<void>;
  stopStreaming: () => void;
  handlePermissionResponse: (
    decision: 'allow' | 'allow_session' | 'deny',
    updatedInput?: Record<string, unknown>,
  ) => Promise<void>;
}

export function useChatStreamController(
  params: UseChatStreamControllerParams,
): UseChatStreamControllerResult {
  const {
    sessionId,
    sessionResolved,
    isStreaming,
    mode,
    currentModel,
    currentProviderId,
    currentAssistantRuntime,
    pendingPermission,
    permissionResolved,
    setPendingApprovalSessionId,
    onModeChange,
    consumePendingImageNotices,
    appendMessage,
    upsertOptimisticAssistant,
    removeMessage,
    syncMessagesFromTimeline,
    onUserMessageSent,
  } = params;

  const [isSendLocked, setIsSendLocked] = useState(false);
  const sendLockRef = useRef(false);
  const sendMessageRef = useRef<(
    content: string,
    files?: FileAttachment[],
    systemPromptAppend?: string,
    displayOverride?: string,
    clientMessageIdOverride?: string,
  ) => Promise<void>>(undefined);
  const [internalStopping, setInternalStopping] = useState(false);
  const isStopping = internalStopping;

  const updateSendLock = useCallback((locked: boolean) => {
    sendLockRef.current = locked;
    setIsSendLocked((current) => (current === locked ? current : locked));
  }, []);

  const stopStreaming = useCallback(() => {
    const waitForSessionStop = async () => {
      const start = Date.now();
      while (Date.now() - start < 12_000) {
        try {
          const res = await fetch(`/api/chat/sessions/${sessionId}`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json() as { session?: { runtime_status?: string } };
            const runtimeStatus = data.session?.runtime_status || 'idle';
            if (runtimeStatus !== 'running' && runtimeStatus !== 'waiting_permission' && runtimeStatus !== 'stopping') {
              return;
            }
          }
        } catch {
          // best effort polling
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    };

    setInternalStopping(true);
    updateSendLock(true);

    if (pendingPermission && !permissionResolved) {
      void respondToPermission(sessionId, 'deny');
    }
    stopStream(sessionId);

    void waitForSessionStop().finally(() => {
      setInternalStopping(false);
      updateSendLock(false);
    });
  }, [pendingPermission, permissionResolved, sessionId, updateSendLock]);

  const handlePermissionResponse = useCallback(
    async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => {
      setPendingApprovalSessionId('');
      if (pendingPermission) {
        rememberPermissionScope(pendingPermission, decision, updatedInput);
      }
      await respondToPermission(sessionId, decision, updatedInput);
    },
    [pendingPermission, sessionId, setPendingApprovalSessionId]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      files?: FileAttachment[],
      systemPromptAppend?: string,
      displayOverride?: string,
      clientMessageIdOverride?: string,
    ) => {
      if (sendLockRef.current || isStreaming || isStopping) {
        return;
      }

      if (!sessionResolved) {
        return;
      }

      updateSendLock(true);
      const clientMessageId = clientMessageIdOverride ?? createClientMessageId();
      const displayUserContent = displayOverride || content;

      let displayContent = displayUserContent;
      if (files && files.length > 0) {
        const fileMeta = files.map((file) => ({
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
        }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${displayUserContent}`;
      }

      const userMessage: Message = {
        id: `temp-user-${clientMessageId}`,
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
        client_message_id: clientMessageId,
      };
      appendMessage(sessionId, userMessage);

      const optimisticAssistantId = upsertOptimisticAssistant(sessionId, clientMessageId);
      syncMessagesFromTimeline(sessionId);
      onUserMessageSent?.();
      const notices = consumePendingImageNotices();

      try {
        startStream({
          sessionId,
          clientMessageId,
          content,
          displayContent: displayUserContent,
          mode,
          model: currentModel,
          providerId: currentProviderId,
          assistantRuntime: currentAssistantRuntime,
          files,
          systemPromptAppend,
          pendingImageNotices: notices,
          onModeChanged: (sdkMode) => {
            const uiMode = sdkMode === 'plan' ? 'plan' : 'code';
            onModeChange(uiMode);
          },
          sendMessageFn: (
            retryContent: string,
            retryFiles?: FileAttachment[],
            retryClientMessageId?: string,
          ) => {
            sendMessageRef.current?.(
              retryContent,
              retryFiles,
              undefined,
              undefined,
              retryClientMessageId,
            );
          },
        });
      } catch (error) {
        const currentAssistant = useChatTimelineStore
          .getState()
          .sessions[sessionId]
          ?.messages
          .find((message) => message.id === optimisticAssistantId);
        if (currentAssistant && !currentAssistant.content.trim() && !currentAssistant.token_usage) {
          removeMessage(sessionId, optimisticAssistantId);
          syncMessagesFromTimeline(sessionId);
        }
        updateSendLock(false);
        throw error;
      }
    },
    [
      appendMessage,
      consumePendingImageNotices,
      currentAssistantRuntime,
      currentModel,
      currentProviderId,
      isStopping,
      isStreaming,
      mode,
      onModeChange,
      removeMessage,
      sessionId,
      sessionResolved,
      syncMessagesFromTimeline,
      onUserMessageSent,
      updateSendLock,
      upsertOptimisticAssistant,
    ]
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  return {
    isSendLocked,
    isStopping,
    updateSendLock,
    sendMessage,
    stopStreaming,
    handlePermissionResponse,
  };
}

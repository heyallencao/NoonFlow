import type { AssistantPersistedEventData, SSEEvent } from '@/types';

function serializeSSEEvent(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function wrapStreamWithHeartbeat(
  stream: ReadableStream<string>,
  options: { intervalMs: number; signal?: AbortSignal },
): ReadableStream<string> {
  const reader = stream.getReader();

  return new ReadableStream<string>({
    start(controller) {
      let closed = false;
      let heartbeatStopped = false;
      const stopHeartbeat = () => {
        if (heartbeatStopped) return;
        heartbeatStopped = true;
        clearInterval(timer);
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        stopHeartbeat();
        options.signal?.removeEventListener('abort', handleAbort);
        controller.close();
      };
      const handleAbort = () => {
        if (closed) return;
        void reader.cancel('aborted');
        finish();
      };
      const timer = setInterval(() => {
        if (!closed && !heartbeatStopped) {
          controller.enqueue(serializeSSEEvent({ type: 'runtime.heartbeat', data: '' }));
        }
      }, options.intervalMs);

      if (options.signal?.aborted) {
        handleAbort();
        return;
      }
      options.signal?.addEventListener('abort', handleAbort, { once: true });

      void (async () => {
        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            if (/"type"\s*:\s*"(?:done|error)"/.test(value)) {
              stopHeartbeat();
            }
            controller.enqueue(value);
          }
          finish();
        } catch (error) {
          stopHeartbeat();
          if (!closed) {
            closed = true;
            options.signal?.removeEventListener('abort', handleAbort);
            controller.error(error);
          }
        }
      })();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export function wrapStreamWithSSEEvents(
  stream: ReadableStream<string>,
  options: {
    prependEvents?: SSEEvent[];
    appendEventPromises?: Array<Promise<SSEEvent | null>>;
  },
): ReadableStream<string> {
  const reader = stream.getReader();
  const prependEvents = options.prependEvents ?? [];
  const appendEventPromises = options.appendEventPromises ?? [];

  return new ReadableStream<string>({
    start(controller) {
      void (async () => {
        try {
          for (const event of prependEvents) {
            controller.enqueue(serializeSSEEvent(event));
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            controller.enqueue(value);
          }

          for (const pendingEvent of appendEventPromises) {
            const event = await pendingEvent.catch((error) => {
              console.warn('[chat persisted-sse] failed to append lifecycle event', {
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            });
            if (event) {
              controller.enqueue(serializeSSEEvent(event));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export function appendPersistedAckEvent(
  stream: ReadableStream<string>,
  persistedAckPromise: Promise<AssistantPersistedEventData | null>,
): ReadableStream<string> {
  return wrapStreamWithSSEEvents(stream, {
    appendEventPromises: [
      persistedAckPromise.then((persistedAck) => (
        persistedAck
          ? { type: 'persisted', data: JSON.stringify(persistedAck) }
          : null
      )),
    ],
  });
}

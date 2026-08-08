import type { AssistantPersistedEventData, SSEEvent } from '@/types';

function serializeSSEEvent(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
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

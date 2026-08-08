export interface RetryOptions {
  maxRetries: number;
  backoff: 'exponential' | 'linear';
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void | Promise<void>;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export class RetryableError extends Error {
  override cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'RetryableError';
    this.cause = options?.cause;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelayMs(attempt: number, options: RetryOptions): number {
  const baseDelayMs = options.baseDelayMs ?? 300;
  if (options.backoff === 'linear') {
    return baseDelayMs * attempt;
  }
  return baseDelayMs * (2 ** (attempt - 1));
}

export class RetryStrategy {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions,
  ): Promise<T> {
    let retryAttempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        retryAttempt += 1;
        const shouldRetry = retryAttempt <= options.maxRetries
          && (options.shouldRetry ? options.shouldRetry(error, retryAttempt) : error instanceof RetryableError);

        if (!shouldRetry) {
          throw error;
        }

        await options.onRetry?.(retryAttempt, error);
        await sleep(getDelayMs(retryAttempt, options));
      }
    }
  }
}

export const retryStrategy = new RetryStrategy();

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetryStrategy, RetryableError } from '../../lib/retry-strategy';

describe('RetryStrategy', () => {
  it('retries retryable failures until success', async () => {
    const strategy = new RetryStrategy();
    let attempts = 0;

    const result = await strategy.executeWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new RetryableError('temporary');
        }
        return 'ok';
      },
      {
        maxRetries: 2,
        backoff: 'linear',
        baseDelayMs: 1,
        shouldRetry: (error) => error instanceof RetryableError,
      },
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('does not retry non-retryable failures', async () => {
    const strategy = new RetryStrategy();
    let attempts = 0;

    await assert.rejects(
      strategy.executeWithRetry(
        async () => {
          attempts += 1;
          throw new Error('fatal');
        },
        {
          maxRetries: 3,
          backoff: 'exponential',
          baseDelayMs: 1,
          shouldRetry: (error) => error instanceof RetryableError,
        },
      ),
      /fatal/,
    );

    assert.equal(attempts, 1);
  });
});

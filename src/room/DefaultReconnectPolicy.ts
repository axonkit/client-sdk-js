/**
 * Context provided to a reconnect policy when computing the next retry delay.
 */
export interface ReconnectContext {
  retryCount: number;
  elapsedMs: number;
}

/**
 * Default reconnect policy with exponential back-off and jitter.
 *
 * @example
 * ```ts
 * const policy = new DefaultReconnectPolicy(10);
 * const delay = policy.nextRetryDelayInMs({ retryCount: 1, elapsedMs: 0 });
 * ```
 */
export class DefaultReconnectPolicy {
  private readonly maxRetries: number;
  private readonly baseDelay = 300;
  private readonly maxDelay = 10_000;
  private retries = 0;

  constructor(maxRetries = 10) {
    this.maxRetries = maxRetries;
  }

  /**
   * Returns the number of milliseconds to wait before the next reconnect
   * attempt, or `null` if the policy says to stop trying.
   */
  nextRetryDelayInMs(context: ReconnectContext): number | null {
    if (context.retryCount > this.maxRetries) {
      return null;
    }
    this.retries = context.retryCount;

    const delay = Math.min(
      this.baseDelay * Math.pow(2, context.retryCount - 1),
      this.maxDelay,
    );
    const jitter = delay * 0.5 * Math.random();
    return delay + jitter;
  }

  reset(): void {
    this.retries = 0;
  }
}

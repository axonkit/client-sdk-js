/**
 * Context provided to a reconnect policy when computing the next retry delay.
 */
export interface ReconnectContext {
  retryCount: number;
  elapsedMs: number;
}

/**
 * Custom reconnection strategy. Provide an implementation via
 * {@link RoomOptions.reconnectPolicy} to control retry behaviour after a
 * connection interruption.
 */
export interface ReconnectPolicy {
  /**
   * Returns the number of milliseconds to wait before the next reconnect
   * attempt, or `null` if the policy says to stop trying.
   */
  nextRetryDelayInMs(context: ReconnectContext): number | null;

  /**
   * Optional hook invoked after a successful (re)connection.
   */
  reset?(): void;
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
export class DefaultReconnectPolicy implements ReconnectPolicy {
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;

  constructor(maxRetries = 10, baseDelay = 300, maxDelay = 10_000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
  }

  /**
   * Returns the number of milliseconds to wait before the next reconnect
   * attempt, or `null` if the policy says to stop trying.
   */
  nextRetryDelayInMs(context: ReconnectContext): number | null {
    if (context.retryCount > this.maxRetries) {
      return null;
    }

    const delay = Math.min(this.baseDelay * Math.pow(2, context.retryCount - 1), this.maxDelay);
    const jitter = delay * 0.5 * Math.random();
    return delay + jitter;
  }

  reset(): void {
    // no internal state to reset; kept for API compatibility
  }
}

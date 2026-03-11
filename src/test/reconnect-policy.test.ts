import { describe, it, expect, vi, afterEach } from 'vitest';
import { DefaultReconnectPolicy } from '../room/DefaultReconnectPolicy';

describe('DefaultReconnectPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses default parameters', () => {
    const policy = new DefaultReconnectPolicy();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const delay = policy.nextRetryDelayInMs({ retryCount: 1, elapsedMs: 0 });
    expect(delay).toBe(300);
  });

  it('returns null when retries exceed max', () => {
    const policy = new DefaultReconnectPolicy(3);
    const delay = policy.nextRetryDelayInMs({ retryCount: 4, elapsedMs: 5000 });
    expect(delay).toBeNull();
  });

  it('returns a delay within expected range (retryCount=1)', () => {
    const policy = new DefaultReconnectPolicy(10, 300, 10_000);
    const delay = policy.nextRetryDelayInMs({ retryCount: 1, elapsedMs: 0 });
    expect(delay).not.toBeNull();
    // base = min(300 * 2^0, 10000) = 300, jitter = 300 * 0.5 * random ∈ [0, 150]
    expect(delay!).toBeGreaterThanOrEqual(300);
    expect(delay!).toBeLessThanOrEqual(450);
  });

  it('increases delay with retryCount (exponential backoff)', () => {
    const policy = new DefaultReconnectPolicy(10, 300, 10_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const d1 = policy.nextRetryDelayInMs({ retryCount: 1, elapsedMs: 0 })!;
    const d2 = policy.nextRetryDelayInMs({ retryCount: 2, elapsedMs: 300 })!;
    const d3 = policy.nextRetryDelayInMs({ retryCount: 3, elapsedMs: 900 })!;

    expect(d1).toBe(300);
    expect(d2).toBe(600);
    expect(d3).toBe(1200);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  it('caps delay at maxDelay', () => {
    const policy = new DefaultReconnectPolicy(20, 300, 10_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const delay = policy.nextRetryDelayInMs({ retryCount: 15, elapsedMs: 30_000 })!;
    expect(delay).toBe(10_000);
  });

  it('adds jitter to delay', () => {
    const policy = new DefaultReconnectPolicy(10, 1000, 50_000);
    vi.spyOn(Math, 'random').mockReturnValue(1);

    // base = 1000, jitter = 1000 * 0.5 * 1 = 500
    const delay = policy.nextRetryDelayInMs({ retryCount: 1, elapsedMs: 0 })!;
    expect(delay).toBe(1500);
  });

  it('reset does not throw', () => {
    const policy = new DefaultReconnectPolicy();
    expect(() => policy.reset()).not.toThrow();
  });

  it('allows exactly maxRetries attempts', () => {
    const policy = new DefaultReconnectPolicy(5);
    expect(policy.nextRetryDelayInMs({ retryCount: 5, elapsedMs: 10_000 })).not.toBeNull();
    expect(policy.nextRetryDelayInMs({ retryCount: 6, elapsedMs: 15_000 })).toBeNull();
  });
});

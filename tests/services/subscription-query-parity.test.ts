import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSubscriptionCalls } from '../../src/services/subscription-query.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Subscription query result boundaries', () => {
  it('preserves a normally resolved null without inventing a timeout diagnostic', async () => {
    const invoke = vi.fn(async (): Promise<unknown> => null);

    const results = await runSubscriptionCalls([{ api: 'mock-subscription', invoke }], 1000);

    expect(results).toEqual([{ api: 'mock-subscription', data: null, diagnostic: null }]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
  });

  it('freezes the timed-out call and retains completed data when a late request finishes', async () => {
    vi.useFakeTimers();
    let resolveLate: (value: unknown) => void = () => {};
    let markStarted: () => void = () => {};
    let requestSignal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const invoke = vi.fn(async (signal: AbortSignal): Promise<unknown> => {
      requestSignal = signal;
      markStarted();
      return new Promise<unknown>((resolve) => {
        resolveLate = resolve;
      });
    });
    const pending = runSubscriptionCalls(
      [
        { api: 'mock-pending-subscription', invoke },
        { api: 'mock-ready-subscription', invoke: async () => ({ status: 'active' }) },
      ],
      1000,
    );
    await started;
    await vi.advanceTimersByTimeAsync(1000);
    const results = await pending;
    const original = structuredClone(results);

    expect(results).toEqual([
      {
        api: 'mock-pending-subscription',
        data: null,
        diagnostic: {
          api: 'mock-pending-subscription',
          errorCode: 'Timeout',
          errorMessage: 'The service did not respond in time. Try again later.',
        },
      },
      { api: 'mock-ready-subscription', data: { status: 'active' }, diagnostic: null },
    ]);
    expect(requestSignal?.aborted).toBe(true);

    resolveLate({ status: 'not_subscribed' });
    await vi.advanceTimersByTimeAsync(0);

    expect(results).toEqual(original);
  });

  it('propagates explicit caller cancellation instead of manufacturing unknown results', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const invoke = vi.fn(async (signal: AbortSignal): Promise<unknown> => {
      requestSignal = signal;
      markStarted();
      return new Promise<unknown>(() => {});
    });
    const pending = runSubscriptionCalls(
      [{ api: 'mock-subscription', invoke }],
      1000,
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();

    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('keeps diagnostic identity while suppressing untrusted exception details', async () => {
    const results = await runSubscriptionCalls(
      [
        {
          api: 'mock-subscription',
          invoke: async () => {
            throw new Error('Mock Bearer mock-private-marker?token=mock-token-marker');
          },
        },
      ],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBeNull();
    expect(results[0]?.diagnostic?.api).toBe('mock-subscription');
    expect(results[0]?.diagnostic?.errorCode).toMatch(/\S/);
    expect(JSON.stringify(results)).not.toContain('mock-private-marker');
    expect(JSON.stringify(results)).not.toContain('mock-token-marker');
  });
});

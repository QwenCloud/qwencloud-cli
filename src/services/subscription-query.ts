import type { SubscriptionDiagnostic } from '../types/subscription.js';
import { safeSubscriptionDiagnostic } from './subscription-diagnostics.js';

interface SubCallSpec<T> {
  api: string;
  invoke: (signal: AbortSignal) => Promise<T>;
}

interface SubCallResult<T> {
  api: string;
  data: T | null;
  diagnostic: SubscriptionDiagnostic | null;
}

export async function runSubscriptionCalls(
  calls: Array<SubCallSpec<unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  options: { abortCompleted?: boolean } = {},
): Promise<Array<SubCallResult<unknown>>> {
  const controller = new AbortController();
  let active = true;
  const settled = new Set<number>();
  const results: Array<SubCallResult<unknown>> = calls.map((c) => ({
    api: c.api,
    data: null,
    diagnostic: null,
  }));

  const tasks = calls.map(async (c, idx) => {
    try {
      const data = await c.invoke(controller.signal);
      if (active) results[idx]!.data = data;
    } catch (error) {
      if (active) results[idx]!.diagnostic = safeSubscriptionDiagnostic(c.api, error);
    } finally {
      settled.add(idx);
    }
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      const reason = new Error('The service did not respond in time. Try again later.');
      reason.name = 'RequestTimeoutError';
      controller.abort(reason);
      resolve();
    }, timeoutMs);
  });

  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const interrupted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
    if (controller.signal.aborted) reject(controller.signal.reason);
  });
  try {
    await Promise.race([Promise.allSettled(tasks), timeoutPromise, interrupted]);
  } catch (error) {
    if (!(error instanceof Error && error.name === 'RequestTimeoutError')) throw error;
  } finally {
    if (
      timedOut ||
      (signal?.reason instanceof Error && signal.reason.name === 'RequestTimeoutError')
    ) {
      // Allow aborted supplemental reads to return already confirmed subscription fields.
      await new Promise<void>((resolve) => process.nextTick(resolve));
    }
    active = false;
    if (options.abortCompleted !== false || settled.size !== calls.length) controller.abort();
    if (timeoutHandle) clearTimeout(timeoutHandle);
    signal?.removeEventListener('abort', abort);
  }

  for (const [index, result] of results.entries()) {
    if (!settled.has(index)) {
      result.diagnostic = {
        api: result.api,
        errorCode: 'Timeout',
        errorMessage: 'The service did not respond in time. Try again later.',
      };
    }
  }
  return results;
}

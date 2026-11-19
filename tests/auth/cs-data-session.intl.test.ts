import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials, CsDataContext } from '../../src/types/auth.js';
import type { CsDataSession } from '../../src/auth/cs-data-session.js';

const {
  state,
  readEncryptedCredentials,
  writeEncryptedCredentials,
  resolveCredentials,
  unlinkSync,
} = vi.hoisted(() => {
  const state = {
    credentials: null as Credentials | null,
    store: new Map<string, Record<string, unknown>>(),
  };
  return {
    state,
    readEncryptedCredentials: vi.fn((path: string) => state.store.get(path) ?? null),
    writeEncryptedCredentials: vi.fn((data: Record<string, unknown>, path: string) => {
      state.store.set(path, data);
    }),
    resolveCredentials: vi.fn(() =>
      state.credentials
        ? {
            source: 'encrypted_file',
            auth_mode: 'device_flow',
            access_token: state.credentials.access_token,
            credentials: state.credentials,
          }
        : null,
    ),
    unlinkSync: vi.fn((path: string) => {
      state.store.delete(path);
    }),
  };
});

vi.mock('../../src/auth/credentials.js', () => ({
  resolveCredentials,
  clearCredentialsCache: vi.fn(),
  isTokenExpired: vi.fn(() => false),
}));
vi.mock('../../src/auth/crypto-store.js', () => ({
  readEncryptedCredentials,
  writeEncryptedCredentials,
}));
vi.mock('../../src/auth/keychain.js', () => ({ isPlaintextMode: vi.fn(() => false) }));
vi.mock('../../src/config/paths.js', async () => {
  const { resolve } = await import('node:path');
  return { getCredentialsPath: () => resolve('tests/mock-files/session-credentials') };
});
vi.mock('fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mkdirSync: vi.fn(),
  unlinkSync,
  renameSync: vi.fn((source: string, target: string) => {
    const value = state.store.get(source);
    if (value) state.store.set(target, value);
    state.store.delete(source);
  }),
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mkdirSync: vi.fn(),
  unlinkSync,
  renameSync: vi.fn((source: string, target: string) => {
    const value = state.store.get(source);
    if (value) state.store.set(target, value);
    state.store.delete(source);
  }),
}));

const context: CsDataContext = {
  issuer: 'https://mock-issuer.test.qwencloud.com/data/v2/api.json',
  gateway: 'https://mock-gateway.test.qwencloud.com/cli/api.json',
  environment: 'production',
  region: 'ap-southeast-1',
  site: 'qwencloud',
};
function rootCredentials(token = 'mock-root-credential', account = 'mock-account-a'): Credentials {
  return {
    access_token: token,
    expires_at: '2099-01-01T00:00:00Z',
    user: { email: 'mock-user@test.qwencloud.com', aliyunId: account },
  };
}
let sessionApi: typeof import('../../src/auth/cs-data-session.js');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  state.store.clear();
  state.credentials = rootCredentials();
  sessionApi = await import('../../src/auth/cs-data-session.js');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Derived session authentication and cache ownership', () => {
  it('issues once and reuses the matching encrypted cached session', async () => {
    const issue = vi.fn(async () => 'mock-derived-credential');
    const signal = new AbortController().signal;

    const first = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);
    const second = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    expect(first.fresh).toBe(true);
    expect(second.fresh).toBe(false);
    expect(first.session.token).toBe('mock-derived-credential');
    expect(second.session.key).toBe(first.session.key);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(1);
    expect(writeEncryptedCredentials.mock.calls[0]?.[1]).toContain('.console');
  });

  it('merges concurrent issuance while both callers receive the real issued session', async () => {
    let finish: (token: string) => void = () => {};
    let markStarted: () => void = () => {};
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const issue = vi.fn(async () => {
      markStarted();
      return pending;
    });
    const signal = new AbortController().signal;
    const first = sessionApi.acquireCsDataSession(context, issue, signal, 1000);
    await started;
    const second = sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    finish('mock-shared-derived-credential');
    const firstResult = await first;
    const secondResult = await second;

    expect(issue).toHaveBeenCalledTimes(1);
    expect(firstResult.session.token).toBe('mock-shared-derived-credential');
    expect(secondResult.session.token).toBe('mock-shared-derived-credential');
    expect(secondResult.session.key).toBe(firstResult.session.key);
  });

  it('refreshes a rejected cached credential once and returns the new derived token', async () => {
    const issue = vi
      .fn()
      .mockResolvedValueOnce('mock-old-derived')
      .mockResolvedValueOnce('mock-new-derived');
    const signal = new AbortController().signal;
    const first = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    const refreshed = await sessionApi.acquireCsDataSession(
      context,
      issue,
      signal,
      1000,
      first.session,
    );

    expect(refreshed.fresh).toBe(true);
    expect(refreshed.session.token).toBe('mock-new-derived');
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it.each([
    { issuer: 'https://mock-alternate-issuer.test.qwencloud.com/data/v2/api.json' },
    { gateway: 'https://mock-alternate-gateway.test.qwencloud.com/cli/api.json' },
    { environment: 'preproduction' },
    { region: 'mock-region' },
    { site: 'mock-site' },
  ])('does not reuse credentials across a changed routing context: %j', async (change) => {
    const issue = vi
      .fn()
      .mockResolvedValueOnce('mock-first-derived')
      .mockResolvedValueOnce('mock-second-derived');
    const signal = new AbortController().signal;
    const first = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    const changed = await sessionApi.acquireCsDataSession(
      { ...context, ...change },
      issue,
      signal,
      1000,
    );

    expect(changed.session.key).not.toBe(first.session.key);
    expect(changed.session.token).toBe('mock-second-derived');
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['root credential', 'mock-second-root', 'mock-account-a'],
    ['account', 'mock-root-credential', 'mock-account-b'],
  ])('does not reuse a cached session after the %s changes', async (_dimension, token, account) => {
    const issue = vi
      .fn()
      .mockResolvedValueOnce('mock-first-derived')
      .mockResolvedValueOnce('mock-second-derived');
    const signal = new AbortController().signal;
    const first = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);
    state.credentials = rootCredentials(token, account);

    const changed = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    expect(changed.session.credentials.user.aliyunId).toBe(account);
    expect(changed.session.token).toBe('mock-second-derived');
    expect(issue).toHaveBeenCalledTimes(2);
    expect(() => sessionApi.currentCsDataSession(context, first.session, signal)).toThrow();
  });

  it('reuses the encrypted cache after the session module is reloaded', async () => {
    const issue = vi.fn(async () => 'mock-persisted-derived');
    const signal = new AbortController().signal;
    await sessionApi.acquireCsDataSession(context, issue, signal, 1000);
    vi.resetModules();
    const reloaded = await import('../../src/auth/cs-data-session.js');

    const result = await reloaded.acquireCsDataSession(context, issue, signal, 1000);

    expect(result.fresh).toBe(false);
    expect(result.session.token).toBe('mock-persisted-derived');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(readEncryptedCredentials).toHaveBeenCalled();
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid encrypted cache record and replaces it with a newly issued session', async () => {
    const issue = vi
      .fn()
      .mockResolvedValueOnce('mock-first-derived')
      .mockResolvedValueOnce('mock-replacement-derived');
    const signal = new AbortController().signal;
    await sessionApi.acquireCsDataSession(context, issue, signal, 1000);
    const path = state.store.keys().next().value;
    expect(path).toEqual(expect.any(String));
    state.store.set(path!, { malformed: 'mock-untrusted-cache' });
    vi.resetModules();
    const reloaded = await import('../../src/auth/cs-data-session.js');

    const result = await reloaded.acquireCsDataSession(context, issue, signal, 1000);

    expect(result.fresh).toBe(true);
    expect(result.session.token).toBe('mock-replacement-derived');
    expect(issue).toHaveBeenCalledTimes(2);
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(2);
  });

  it('reissues a fresh derived session when the matching cache contains the root token', async () => {
    const signal = new AbortController().signal;
    await sessionApi.acquireCsDataSession(
      context,
      vi.fn(async () => 'mock-original-derived'),
      signal,
      1000,
    );
    const record = state.store.values().next().value;
    expect(record).toMatchObject({ token: 'mock-original-derived' });
    record!.token = state.credentials!.access_token;
    vi.resetModules();
    const reloaded = await import('../../src/auth/cs-data-session.js');
    const issue = vi.fn(async () => 'mock-replacement-derived');

    const result = await reloaded.acquireCsDataSession(context, issue, signal, 1000);

    expect(result.fresh).toBe(true);
    expect(result.session.token).toBe('mock-replacement-derived');
    expect(result.session.token).not.toBe(state.credentials!.access_token);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(reloaded.currentCsDataSession(context, result.session, signal).token).toBe(
      'mock-replacement-derived',
    );
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(2);
  });

  it('rejects an issued token equal to the root credential', async () => {
    const issue = vi.fn(async () => 'mock-root-credential');

    await expect(
      sessionApi.acquireCsDataSession(context, issue, new AbortController().signal, 1000),
    ).rejects.toThrow();
    expect(writeEncryptedCredentials).not.toHaveBeenCalled();
  });

  it('invalidates only the expected derived cache and causes the next request to issue again', async () => {
    const issue = vi
      .fn()
      .mockResolvedValueOnce('mock-first-derived')
      .mockResolvedValueOnce('mock-second-derived');
    const signal = new AbortController().signal;
    const first = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    sessionApi.invalidateCsDataCredential(first.session);
    const second = await sessionApi.acquireCsDataSession(context, issue, signal, 1000);

    expect(second.session.token).toBe('mock-second-derived');
    expect(issue).toHaveBeenCalledTimes(2);
    expect(unlinkSync).toHaveBeenCalled();
  });

  it('does not persist a derived session when the account switches during issuance', async () => {
    let finish: (token: string) => void = () => {};
    let markStarted: () => void = () => {};
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const issue = vi.fn(async () => {
      markStarted();
      return pending;
    });
    const request = sessionApi.acquireCsDataSession(
      context,
      issue,
      new AbortController().signal,
      1000,
    );
    const rejected = expect(request).rejects.toThrow();
    await started;
    state.credentials = rootCredentials('mock-other-root', 'mock-other-account');
    finish('mock-obsolete-derived');

    await rejected;
    expect(writeEncryptedCredentials).not.toHaveBeenCalled();
  });
});

describe('Cs-data shared cancellation and time budget', () => {
  it.each([true, false])(
    'keeps each waiter within its own budget when the short waiter starts first: %s',
    async (shortFirst) => {
      vi.useFakeTimers();
      const issued = deferred<string>();
      const started = deferred<void>();
      const issue = vi.fn((_session: CsDataSession, _signal: AbortSignal) => {
        started.resolve();
        return issued.promise;
      });
      const signal = new AbortController().signal;
      const first = sessionApi.acquireCsDataSession(
        context,
        issue,
        signal,
        shortFirst ? 100 : 5000,
      );
      await started.promise;
      const second = sessionApi.acquireCsDataSession(
        context,
        issue,
        signal,
        shortFirst ? 5000 : 100,
      );
      const results = Promise.allSettled([first, second]);
      const timedOut = expect(shortFirst ? first : second).rejects.toMatchObject({
        name: 'RequestTimeoutError',
        timeoutMs: 100,
      });

      await vi.advanceTimersByTimeAsync(100);
      const issuerAborted = issue.mock.calls[0]?.[1].aborted;
      expect(writeEncryptedCredentials).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      issued.resolve('mock-shared-derived-credential');
      const [, settled] = await Promise.all([timedOut, results]);

      expect(settled[shortFirst ? 1 : 0]).toMatchObject({
        status: 'fulfilled',
        value: { session: { token: 'mock-shared-derived-credential' }, fresh: true },
      });
      expect(issuerAborted).toBe(false);
      expect(signal.aborted).toBe(false);
      expect(issue).toHaveBeenCalledTimes(1);
      expect(writeEncryptedCredentials).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('keeps shared issuance alive when one caller cancels', async () => {
    vi.useFakeTimers();
    const issued = deferred<string>();
    const started = deferred<void>();
    const issue = vi.fn((_session: CsDataSession, _signal: AbortSignal) => {
      started.resolve();
      return issued.promise;
    });
    const cancelledCaller = new AbortController();
    const activeCaller = new AbortController();
    const first = sessionApi.acquireCsDataSession(context, issue, cancelledCaller.signal, 1000);
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    const second = sessionApi.acquireCsDataSession(context, issue, activeCaller.signal, 1000);

    cancelledCaller.abort();
    await cancelled;
    expect(issue.mock.calls[0]?.[1].aborted).toBe(false);
    expect(activeCaller.signal.aborted).toBe(false);
    issued.resolve('mock-active-derived-credential');

    await expect(second).resolves.toMatchObject({
      session: { token: 'mock-active-derived-credential' },
    });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts issuance after the last waiter times out and ignores its late response', async () => {
    vi.useFakeTimers();
    const issued = deferred<string>();
    const started = deferred<void>();
    const issue = vi.fn((_session: CsDataSession, _signal: AbortSignal) => {
      started.resolve();
      return issued.promise;
    });
    const request = sessionApi.acquireCsDataSession(
      context,
      issue,
      new AbortController().signal,
      100,
    );
    const timedOut = expect(request).rejects.toMatchObject({ name: 'RequestTimeoutError' });
    await started.promise;

    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(issue.mock.calls[0]?.[1].aborted).toBe(true);
    issued.resolve('mock-obsolete-derived-credential');
    await vi.advanceTimersByTimeAsync(0);

    expect(writeEncryptedCredentials).not.toHaveBeenCalled();
    expect(state.store.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves replacement issuance when all callers cancel and the old task settles late', async () => {
    vi.useFakeTimers();
    const obsolete = deferred<string>();
    const replacement = deferred<string>();
    const started = deferred<void>();
    const replacementStarted = deferred<void>();
    const replacementIssue = vi.fn((_session: CsDataSession, _signal: AbortSignal) => {
      replacementStarted.resolve();
      return replacement.promise;
    });
    const activeSignal = new AbortController().signal;
    let restarted: ReturnType<typeof sessionApi.acquireCsDataSession> | undefined;
    const issue = vi.fn((_session: CsDataSession, signal: AbortSignal) => {
      signal.addEventListener('abort', () => {
        restarted = sessionApi.acquireCsDataSession(context, replacementIssue, activeSignal, 1000);
      });
      started.resolve();
      return obsolete.promise;
    });
    const firstCaller = new AbortController();
    const secondCaller = new AbortController();
    const first = sessionApi.acquireCsDataSession(context, issue, firstCaller.signal, 1000);
    const firstCancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    const second = sessionApi.acquireCsDataSession(context, issue, secondCaller.signal, 1000);
    const secondCancelled = expect(second).rejects.toMatchObject({ name: 'AbortError' });

    firstCaller.abort();
    await firstCancelled;
    expect(issue.mock.calls[0]?.[1].aborted).toBe(false);
    secondCaller.abort();
    await secondCancelled;
    await replacementStarted.promise;
    expect(issue.mock.calls[0]?.[1].aborted).toBe(true);
    obsolete.resolve('mock-obsolete-derived-credential');
    await vi.advanceTimersByTimeAsync(0);
    expect(writeEncryptedCredentials).not.toHaveBeenCalled();
    const joined = sessionApi.acquireCsDataSession(context, replacementIssue, activeSignal, 1000);
    replacement.resolve('mock-replacement-derived-credential');

    expect(restarted).toBeDefined();
    await expect(restarted).resolves.toMatchObject({
      session: { token: 'mock-replacement-derived-credential' },
    });
    await expect(joined).resolves.toMatchObject({
      session: { token: 'mock-replacement-derived-credential' },
    });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(replacementIssue).toHaveBeenCalledTimes(1);
    expect(writeEncryptedCredentials).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts pending work when the shared budget expires', async () => {
    vi.useFakeTimers();
    const budget = sessionApi.createCsDataBudget(undefined, 1000);
    const pending = sessionApi.awaitCsDataOperation(new Promise<string>(() => {}), budget.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'RequestTimeoutError' });

    expect(budget.remaining()).toBe(1000);
    await vi.advanceTimersByTimeAsync(400);
    expect(budget.remaining()).toBe(600);
    await vi.advanceTimersByTimeAsync(600);
    await rejected;

    expect(budget.signal.aborted).toBe(true);
    expect(() => sessionApi.checkCsDataSignal(budget.signal)).toThrow(
      expect.objectContaining({ name: 'RequestTimeoutError' }),
    );
    budget.dispose();
  });

  it('propagates caller cancellation and prevents issuing a new credential', async () => {
    const controller = new AbortController();
    const budget = sessionApi.createCsDataBudget(controller.signal, 1000);
    controller.abort();
    const issue = vi.fn(async () => 'mock-derived-credential');

    await expect(
      sessionApi.acquireCsDataSession(context, issue, budget.signal, budget.remaining()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(issue).not.toHaveBeenCalled();
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
  });
});

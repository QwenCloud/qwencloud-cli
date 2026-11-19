import { describe, it, expect, vi } from 'vitest';
import * as sdk from '../../src/plugins/sdk.js';
import { createBaseClient, RequestTimeoutError } from '../../src/api/base-client.js';
import { pluginErrors } from '../../src/plugins/runtime.js';

describe('plugin SDK surface — re-exports present (public contract)', () => {
  it('exports CliError, handleError, EXIT_CODES, and error factories', () => {
    expect(typeof sdk.CliError).toBe('function');
    expect(typeof sdk.handleError).toBe('function');
    expect(typeof sdk.invalidArgError).toBe('function');
    expect(sdk.EXIT_CODES.GENERAL_ERROR).toBe(1);
  });

  it('exports outputJSON, formatTextTable, and resolveFormatFromCommand without Ink', () => {
    expect(typeof sdk.outputJSON).toBe('function');
    expect(typeof sdk.formatTextTable).toBe('function');
    expect(typeof sdk.resolveFormatFromCommand).toBe('function');
  });

  it('exports VERSION and isSemVerGreater', () => {
    expect(typeof sdk.VERSION).toBe('string');
    expect(sdk.isSemVerGreater('2.0.0', '1.0.0')).toBe(true);
  });

  it('uses CliError.detail without a cause field', () => {
    const e = new sdk.CliError({ code: 'X', message: 'm', exitCode: 1, detail: 'd' });
    expect(e.code).toBe('X');
    expect(e.detail).toBe('d');
    expect('cause' in e && (e as { cause?: unknown }).cause !== undefined).toBe(false);
  });

  it('classifies transport timeouts and preserves the actual deadline', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    try {
      const error: unknown = await createBaseClient({ timeout: 10 })
        .request({ url: 'https://mock-api.test.qwencloud.com', authMode: 'none' })
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(RequestTimeoutError);
      const normalized = pluginErrors.normalize(error);
      expect(normalized.code).toBe('NETWORK_ERROR');
      expect(normalized.exitCode).toBe(3);
      expect(normalized.message).toBe('Request timed out. Try again later.');
      expect(normalized.detail).toContain('Request timeout after 0.01s');
      expect(normalized.detail).not.toContain('30s');
    } finally {
      fetch.mockRestore();
    }
  });

  it('preserves explicit user cancellation instead of classifying it as a timeout', () => {
    const cancelled = new sdk.CliError({
      code: 'USER_INTERRUPT',
      message: 'Plugin command cancelled.',
      exitCode: 130,
    });
    expect(pluginErrors.normalize(cancelled)).toBe(cancelled);
  });
});

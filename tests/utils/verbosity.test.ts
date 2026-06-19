import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getErrorVerbosity } from '../../src/utils/verbosity.ts';

describe('getErrorVerbosity', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.QWENCLOUD_ERROR_VERBOSITY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.QWENCLOUD_ERROR_VERBOSITY;
    else process.env.QWENCLOUD_ERROR_VERBOSITY = original;
  });

  it('returns "suppress" when env var is set to suppress', () => {
    process.env.QWENCLOUD_ERROR_VERBOSITY = 'suppress';
    expect(getErrorVerbosity()).toBe('suppress');
  });

  it('returns "verbose" when env var is set to verbose', () => {
    process.env.QWENCLOUD_ERROR_VERBOSITY = 'verbose';
    expect(getErrorVerbosity()).toBe('verbose');
  });

  it('returns "graceful" when env var is set to graceful', () => {
    process.env.QWENCLOUD_ERROR_VERBOSITY = 'graceful';
    expect(getErrorVerbosity()).toBe('graceful');
  });

  it('ignores invalid env var value and returns default graceful', () => {
    process.env.QWENCLOUD_ERROR_VERBOSITY = 'invalid-value';
    expect(getErrorVerbosity()).toBe('graceful');
  });
});

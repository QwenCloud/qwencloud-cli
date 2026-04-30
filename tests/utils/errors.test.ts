import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CliError,
  HandledError,
  authRequiredError,
  tokenExpiredError,
  modelNotFoundError,
  networkError,
  configError,
  invalidArgError,
  handleError,
} from '../../src/utils/errors.js';
import { EXIT_CODES } from '../../src/utils/exit-codes.js';

describe('CliError', () => {
  it('creates error with correct properties', () => {
    const err = new CliError({
      code: 'TEST_ERROR',
      message: 'Test error message',
      exitCode: EXIT_CODES.GENERAL_ERROR,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('Test error message');
    expect(err.exitCode).toBe(1);
  });

  it('serializes to JSON correctly', () => {
    const err = new CliError({
      code: 'AUTH_REQUIRED',
      message: 'Not authenticated',
      exitCode: EXIT_CODES.AUTH_FAILURE,
    });

    expect(err.toJSON()).toEqual({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Not authenticated',
        exit_code: 2,
      },
    });
  });
});

describe('Error factory functions', () => {
  it('authRequiredError creates correct error', () => {
    const err = authRequiredError();
    expect(err.code).toBe('AUTH_REQUIRED');
    expect(err.message).toBe('Not authenticated. Run: qwencloud login');
    expect(err.exitCode).toBe(EXIT_CODES.AUTH_FAILURE);
  });

  it('tokenExpiredError creates correct error', () => {
    const err = tokenExpiredError();
    expect(err.code).toBe('TOKEN_EXPIRED');
    expect(err.message).toBe('Token expired. Run: qwencloud login');
    expect(err.exitCode).toBe(EXIT_CODES.AUTH_FAILURE);
  });

  it('modelNotFoundError creates correct error', () => {
    const err = modelNotFoundError('qwen3.6-plus');
    expect(err.code).toBe('MODEL_NOT_FOUND');
    expect(err.message).toBe("Model 'qwen3.6-plus' not found.");
    expect(err.exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
  });

  it('networkError creates correct error with default message', () => {
    const err = networkError();
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toBe('Network error: API unreachable');
    expect(err.exitCode).toBe(EXIT_CODES.NETWORK_ERROR);
  });

  it('networkError creates correct error with custom detail', () => {
    const err = networkError('Connection timeout after 30s');
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toBe('Connection timeout after 30s');
    expect(err.exitCode).toBe(EXIT_CODES.NETWORK_ERROR);
  });

  it('configError creates correct error', () => {
    const err = configError('Invalid config file format');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.message).toBe('Invalid config file format');
    expect(err.exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('invalidArgError creates correct error', () => {
    const err = invalidArgError('Unknown option: --foo');
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.message).toBe('Unknown option: --foo');
    expect(err.exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
  });
});

describe('handleError', () => {
  // Helper: call handleError and return the thrown HandledError
  function catchHandledError(error: unknown, format: 'json' | 'table' | 'text'): HandledError {
    try {
      handleError(error, format);
    } catch (e) {
      if (e instanceof HandledError) return e;
      throw e;
    }
    throw new Error('handleError did not throw');
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles CliError in table format', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new CliError({
      code: 'AUTH_REQUIRED',
      message: 'Not authenticated',
      exitCode: EXIT_CODES.AUTH_FAILURE,
    });

    const thrown = catchHandledError(err, 'table');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Not authenticated');
    expect(thrown).toBeInstanceOf(HandledError);
    expect(thrown.exitCode).toBe(2);
  });

  it('handles CliError in json format', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const err = new CliError({
      code: 'AUTH_REQUIRED',
      message: 'Not authenticated',
      exitCode: EXIT_CODES.AUTH_FAILURE,
    });

    const thrown = catchHandledError(err, 'json');

    // JSON errors must go to stderr so Agent pipelines (`cmd | jq`) don't see
    // them mixed into the data stream.
    expect(stderrSpy).toHaveBeenCalledWith(
      JSON.stringify({
        error: { code: 'AUTH_REQUIRED', message: 'Not authenticated', exit_code: 2 },
      }, null, 2) + '\n'
    );
    expect(thrown.exitCode).toBe(2);
  });

  it('handles CliError in text format', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new CliError({
      code: 'NETWORK_ERROR',
      message: 'API unreachable',
      exitCode: EXIT_CODES.NETWORK_ERROR,
    });

    const thrown = catchHandledError(err, 'text');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: API unreachable');
    expect(thrown.exitCode).toBe(3);
  });

  it('handles unknown Error in table format', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new Error('Something went wrong');

    const thrown = catchHandledError(err, 'table');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Something went wrong');
    expect(thrown.exitCode).toBe(1);
  });

  it('handles unknown Error in json format', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const err = new Error('Something went wrong');

    const thrown = catchHandledError(err, 'json');

    expect(stderrSpy).toHaveBeenCalledWith(
      JSON.stringify({
        error: { code: 'UNKNOWN_ERROR', message: 'Something went wrong', exit_code: 1 },
      }, null, 2) + '\n'
    );
    expect(thrown.exitCode).toBe(1);
  });

  it('handles non-Error unknown value', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const thrown = catchHandledError('string error', 'table');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: string error');
    expect(thrown.exitCode).toBe(1);
  });

  it('includes cause chain for unknown errors in table format', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const cause = new Error('Root cause');
    const err = new Error('Failed to connect', { cause });

    const thrown = catchHandledError(err, 'table');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error: Failed to connect\n  Caused by: Root cause'
    );
    expect(thrown.exitCode).toBe(1);
  });

  it('includes cause chain for unknown errors in json format', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const cause = new Error('Root cause');
    const err = new Error('Failed to connect', { cause });

    const thrown = catchHandledError(err, 'json');

    const output = JSON.parse((stderrSpy.mock.calls[0] as any[])[0]);
    expect(output.error.message).toContain('Failed to connect');
    expect(output.error.message).toContain('Root cause');
    expect(thrown.exitCode).toBe(1);
  });

  it('limits cause chain depth to 5 levels', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create a chain of 7 errors
    let cause: Error = new Error('Level 7');
    for (let i = 6; i >= 1; i--) {
      cause = new Error(`Level ${i}`, { cause });
    }

    const thrown = catchHandledError(cause, 'table');

    const output = (consoleErrorSpy.mock.calls[0] as any[])[0];
    const causeLines = output.split('\n  Caused by: ').length - 1;
    expect(causeLines).toBeLessThanOrEqual(5);
    expect(thrown.exitCode).toBe(1);
  });
});

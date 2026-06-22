import { describe, it, expect } from 'vitest';
import { EXIT_CODES, type ExitCode } from '../../src/utils/exit-codes.js';

// Public CLI contract: exit codes are coarse-grained shell branching signals.
// Fine-grained error categories are communicated via the JSON error envelope's
// `code` field, never via the numeric exit code.

describe('EXIT_CODES contract', () => {
  it('matches the documented numeric contract', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.GENERAL_ERROR).toBe(1);
    expect(EXIT_CODES.AUTH_FAILURE).toBe(2);
    expect(EXIT_CODES.NETWORK_ERROR).toBe(3);
    expect(EXIT_CODES.INVALID_ARGUMENT).toBe(4);
    expect(EXIT_CODES.TASK_NOT_COMPLETED).toBe(8);
    expect(EXIT_CODES.USER_INTERRUPT).toBe(130);
  });

  it('every numeric value is unique (no collisions)', () => {
    const values = Object.values(EXIT_CODES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('exposes exactly the seven known exit codes (no extras silently added)', () => {
    expect(Object.keys(EXIT_CODES).sort()).toEqual(
      [
        'AUTH_FAILURE',
        'GENERAL_ERROR',
        'INVALID_ARGUMENT',
        'NETWORK_ERROR',
        'SUCCESS',
        'TASK_NOT_COMPLETED',
        'USER_INTERRUPT',
      ].sort(),
    );
  });

  it('ExitCode type accepts every EXIT_CODES value', () => {
    const values: ExitCode[] = [
      EXIT_CODES.SUCCESS,
      EXIT_CODES.GENERAL_ERROR,
      EXIT_CODES.AUTH_FAILURE,
      EXIT_CODES.NETWORK_ERROR,
      EXIT_CODES.INVALID_ARGUMENT,
      EXIT_CODES.TASK_NOT_COMPLETED,
      EXIT_CODES.USER_INTERRUPT,
    ];
    expect(values).toHaveLength(7);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock readline before import
const mockQuestion = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();

let rlInstance: EventEmitter;

vi.mock('readline', () => ({
  createInterface: vi.fn(() => {
    rlInstance = new EventEmitter();
    (rlInstance as Record<string, unknown>).close = mockClose;
    (rlInstance as Record<string, unknown>).question = mockQuestion;
    return rlInstance;
  }),
}));

import { confirmPrompt } from '../../src/utils/confirm.js';

describe('confirmPrompt', () => {
  let originalIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;
  let originalIsPaused: (() => boolean) | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    originalIsPaused = process.stdin.isPaused;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, writable: true });
    process.stdin.isPaused = originalIsPaused!;
  });

  it('should return false in non-TTY stdin environment', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should return false in non-TTY stdout environment', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should return true when user answers y', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('y');
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(true);
  });

  it('should return true when user answers Y', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('Y');
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(true);
  });

  it('should return false when user answers n', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('n');
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should return false when user presses enter (empty input)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('');
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should return false when user enters arbitrary text', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('yes');
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should return false on SIGINT', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation(() => {
      // Simulate SIGINT after question is asked
      setTimeout(() => rlInstance.emit('SIGINT'), 0);
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should return false on close event', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation(() => {
      // Simulate close (EOF) after question is asked
      setTimeout(() => rlInstance.emit('close'), 0);
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(false);
  });

  it('should resume stdin if it is paused', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => true;
    const resumeSpy = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('y');
    });

    await confirmPrompt('Continue?');
    expect(resumeSpy).toHaveBeenCalled();
    resumeSpy.mockRestore();
  });

  it('should trim whitespace from user input', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    process.stdin.isPaused = () => false;

    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => {
      cb('  y  ');
    });

    const result = await confirmPrompt('Continue?');
    expect(result).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { suppressStdin } from '../../src/utils/stdin-suppress.js';

describe('suppressStdin', () => {
  let originalIsTTY: boolean | undefined;
  let originalIsRaw: boolean | undefined;
  let originalSetRawMode: ((mode: boolean) => typeof process.stdin) | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    originalIsRaw = process.stdin.isRaw;
    originalSetRawMode = process.stdin.setRawMode;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
    Object.defineProperty(process.stdin, 'isRaw', { value: originalIsRaw, writable: true });
    if (originalSetRawMode) {
      process.stdin.setRawMode = originalSetRawMode;
    }
  });

  describe('non-TTY environment', () => {
    it('should return a noop suppression object', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });

      const result = suppressStdin();

      expect(result.aborted()).toBe(false);
      // restore should be callable without error
      expect(() => result.restore()).not.toThrow();
      // onAbort should be a pending promise (never resolves)
      expect(result.onAbort).toBeInstanceOf(Promise);
    });
  });

  describe('TTY environment', () => {
    let mockSetRawMode: ReturnType<typeof vi.fn>;
    let resumeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
      Object.defineProperty(process.stdin, 'isRaw', { value: false, writable: true });
      mockSetRawMode = vi.fn().mockReturnValue(process.stdin);
      process.stdin.setRawMode = mockSetRawMode;
      resumeSpy = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    });

    afterEach(() => {
      resumeSpy.mockRestore();
    });

    it('should enable raw mode and resume stdin', () => {
      const removeAllSpy = vi.spyOn(process.stdin, 'removeAllListeners');

      suppressStdin();

      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(resumeSpy).toHaveBeenCalled();
      expect(removeAllSpy).toHaveBeenCalledWith('data');
      expect(removeAllSpy).toHaveBeenCalledWith('keypress');
      removeAllSpy.mockRestore();
    });

    it('should remove existing data and keypress listeners', () => {
      const dataListener = vi.fn();
      const keypressListener = vi.fn();
      process.stdin.on('data', dataListener);
      process.stdin.on('keypress', keypressListener);

      suppressStdin();

      // After suppress, original listeners should have been removed
      expect(process.stdin.listenerCount('data')).toBe(1); // Only the temp handler
      expect(process.stdin.listenerCount('keypress')).toBe(0);

      // Cleanup
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('keypress');
    });

    it('should set aborted to true on Ctrl+C (0x03)', () => {
      const result = suppressStdin();

      expect(result.aborted()).toBe(false);

      // Emit Ctrl+C byte
      process.stdin.emit('data', Buffer.from([0x03]));

      expect(result.aborted()).toBe(true);
      result.restore();
      process.stdin.removeAllListeners('data');
    });

    it('should resolve onAbort promise on Ctrl+C', async () => {
      const result = suppressStdin();

      let resolved = false;
      result.onAbort.then(() => {
        resolved = true;
      });

      process.stdin.emit('data', Buffer.from([0x03]));
      await Promise.resolve(); // Let microtask queue flush

      expect(resolved).toBe(true);
      result.restore();
      process.stdin.removeAllListeners('data');
    });

    it('should discard non Ctrl+C bytes silently', () => {
      const result = suppressStdin();

      // Emit random bytes
      process.stdin.emit('data', Buffer.from([0x61])); // 'a'
      process.stdin.emit('data', Buffer.from([0x0d])); // CR

      expect(result.aborted()).toBe(false);
      result.restore();
      process.stdin.removeAllListeners('data');
    });

    it('should restore raw mode to previous state', () => {
      Object.defineProperty(process.stdin, 'isRaw', { value: false, writable: true });

      const result = suppressStdin();
      mockSetRawMode.mockClear();

      result.restore();

      // Should restore to the original wasRaw = false
      expect(mockSetRawMode).toHaveBeenCalledWith(false);
      process.stdin.removeAllListeners('data');
    });

    it('should restore previously saved listeners on restore()', () => {
      const dataListener = vi.fn();
      process.stdin.on('data', dataListener);

      const result = suppressStdin();
      result.restore();

      // Original data listener should be re-attached
      const dataListeners = process.stdin.rawListeners('data');
      expect(dataListeners).toContain(dataListener);

      // Cleanup
      process.stdin.removeAllListeners('data');
    });

    it('should be idempotent on restore()', () => {
      const result = suppressStdin();

      result.restore();
      mockSetRawMode.mockClear();

      // Calling restore again should be a no-op
      result.restore();
      expect(mockSetRawMode).not.toHaveBeenCalled();
      process.stdin.removeAllListeners('data');
    });

    it('should handle setRawMode throwing gracefully', () => {
      mockSetRawMode.mockImplementation(() => {
        throw new Error('Cannot set raw mode');
      });

      // Should not throw during suppress
      expect(() => suppressStdin()).not.toThrow();
    });
  });
});

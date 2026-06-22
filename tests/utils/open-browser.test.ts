import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExec = vi.fn();

vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

import { openBrowser } from '../../src/utils/open-browser.js';

describe('openBrowser', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should use "open" command on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    openBrowser('https://mock-api.test.qwencloud.com');
    expect(mockExec).toHaveBeenCalledTimes(1);
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toMatch(/^open /);
    expect(cmd).toContain('https://mock-api.test.qwencloud.com');
  });

  it('should use "start" command on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    openBrowser('https://mock-api.test.qwencloud.com/login');
    expect(mockExec).toHaveBeenCalledTimes(1);
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toMatch(/^start ""/);
    expect(cmd).toContain('https://mock-api.test.qwencloud.com/login');
  });

  it('should use "xdg-open" command on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    openBrowser('https://mock-api.test.qwencloud.com/docs');
    expect(mockExec).toHaveBeenCalledTimes(1);
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toMatch(/^xdg-open /);
    expect(cmd).toContain('https://mock-api.test.qwencloud.com/docs');
  });

  it('should JSON-stringify the URL in the command', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const url = 'https://mock-api.test.qwencloud.com/path?q=hello world&a=1';
    openBrowser(url);
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain(JSON.stringify(url));
  });

  it('should pass a callback to exec (silent error handling)', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    openBrowser('https://mock-api.test.qwencloud.com');
    expect(mockExec).toHaveBeenCalledTimes(1);
    // Second argument should be a callback function (error is silently ignored)
    const callback = mockExec.mock.calls[0][1];
    expect(typeof callback).toBe('function');
    // Calling the callback with an error should not throw
    expect(() => callback(new Error('command failed'))).not.toThrow();
  });

  it('should handle exec failure silently', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExec.mockImplementation((_cmd: string, cb: (err: Error | null) => void) => {
      cb(new Error('xdg-open not found'));
    });
    // Should not throw
    expect(() => openBrowser('https://mock-api.test.qwencloud.com')).not.toThrow();
  });
});

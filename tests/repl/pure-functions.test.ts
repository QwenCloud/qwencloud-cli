import { describe, it, expect } from 'vitest';
import { parseArgs, displayWidth, truncatePathLeft } from '../../src/repl.js';

describe('parseArgs', () => {
  it('splits by spaces', () => {
    expect(parseArgs('hello world')).toEqual(['hello', 'world']);
  });

  it('handles double-quoted strings', () => {
    expect(parseArgs('say "hello world"')).toEqual(['say', 'hello world']);
  });

  it('handles single-quoted strings', () => {
    expect(parseArgs("say 'hello world'")).toEqual(['say', 'hello world']);
  });

  it('treats backslash as literal inside quotes', () => {
    // parseArgs does not handle escape sequences; backslash is a regular char
    expect(parseArgs('say "hello \\"world\\""')).toEqual(['say', 'hello \\world\\']);
  });

  it('collapses consecutive whitespace', () => {
    expect(parseArgs('a   b')).toEqual(['a', 'b']);
  });

  it('returns empty array for empty string', () => {
    expect(parseArgs('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseArgs('   ')).toEqual([]);
  });
});

describe('displayWidth', () => {
  it('counts pure ASCII as 1 per char', () => {
    expect(displayWidth('hello')).toBe(5);
  });

  it('counts CJK characters as 2 per char', () => {
    expect(displayWidth('你好')).toBe(4);
  });

  it('counts mixed ASCII and CJK correctly', () => {
    expect(displayWidth('hi你好')).toBe(6);
  });

  it('returns 0 for empty string', () => {
    expect(displayWidth('')).toBe(0);
  });
});

describe('truncatePathLeft', () => {
  it('truncates long path from the left, prefixing with ellipsis', () => {
    const longPath = '/Users/someone/very/deep/nested/directory/file.ts';
    const result = truncatePathLeft(longPath, 20);
    expect(displayWidth(result)).toBeLessThanOrEqual(20);
    expect(result.startsWith('…')).toBe(true);
    expect(result.endsWith('file.ts')).toBe(true);
  });

  it('returns original path when shorter than maxW', () => {
    expect(truncatePathLeft('short.ts', 30)).toBe('short.ts');
  });

  it('returns empty string for empty input', () => {
    expect(truncatePathLeft('', 10)).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { stripAnsi, visibleWidth, wrapText, wrapTextWithIndent } from '../../src/ui/textWrap.js';

describe('stripAnsi', () => {
  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('removes bold codes', () => {
    expect(stripAnsi('\x1b[1mBold\x1b[0m')).toBe('Bold');
  });

  it('removes color codes', () => {
    expect(stripAnsi('\x1b[31mRed\x1b[0m')).toBe('Red');
  });

  it('removes multiple codes in sequence', () => {
    expect(stripAnsi('\x1b[1m\x1b[32mGreen Bold\x1b[0m')).toBe('Green Bold');
  });
});

describe('visibleWidth', () => {
  it('returns length of plain text', () => {
    expect(visibleWidth('hello')).toBe(5);
  });

  it('excludes ANSI codes from width', () => {
    expect(visibleWidth('\x1b[1mhello\x1b[0m')).toBe(5);
  });
});

describe('wrapText', () => {
  it('returns single line when text fits', () => {
    expect(wrapText('short', 20)).toEqual(['short']);
  });

  it('wraps long text at word boundaries', () => {
    const result = wrapText('hello world foo bar', 12);
    expect(result).toEqual(['hello world', 'foo bar']);
  });

  it('force-breaks words exceeding width', () => {
    const result = wrapText('superlongword short', 10);
    // After force-breaking 'superlongword' -> 'superlongw' + 'ord',
    // 'ord' and 'short' fit together on one line (9 chars <= 10)
    expect(result).toEqual(['superlongw', 'ord short']);
  });

  it('handles empty string', () => {
    expect(wrapText('', 10)).toEqual(['']);
  });

  it('handles zero maxWidth', () => {
    expect(wrapText('text', 0)).toEqual(['text']);
  });

  it('preserves existing newlines', () => {
    const result = wrapText('line1\nline2', 20);
    expect(result).toEqual(['line1', 'line2']);
  });

  it('wraps each existing newline independently', () => {
    const result = wrapText('first part of sentence\nsecond part', 15);
    expect(result).toEqual(['first part of', 'sentence', 'second part']);
  });

  it('handles ANSI-stripped width measurement', () => {
    const result = wrapText('\x1b[1mhello world foo bar\x1b[0m', 12);
    expect(result).toEqual(['hello world', 'foo bar']);
  });
});

describe('wrapTextWithIndent', () => {
  it('returns unchanged single line', () => {
    expect(wrapTextWithIndent('short', 20)).toEqual(['short']);
  });

  it('indents continuation lines', () => {
    const result = wrapTextWithIndent('hello world foo bar', 12, '  ');
    expect(result).toEqual(['hello world', '  foo bar']);
  });

  it('uses default indent of empty string (left-aligned)', () => {
    const result = wrapTextWithIndent('hello world foo bar', 12);
    expect(result).toEqual(['hello world', 'foo bar']);
  });

  it('indents continuation lines when indent specified', () => {
    const result = wrapTextWithIndent('hello world foo bar', 12, '  ');
    expect(result).toEqual(['hello world', '  foo bar']);
  });
});

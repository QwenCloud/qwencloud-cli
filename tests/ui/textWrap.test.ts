import { describe, it, expect } from 'vitest';
import {
  stripAnsi,
  visibleWidth,
  wrapText,
  wrapTextWithIndent,
  padEndVisible,
  truncateByDisplayWidth,
} from '../../src/ui/textWrap.js';

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

  it('counts CJK characters as width 2', () => {
    expect(visibleWidth('中文')).toBe(4);
    expect(visibleWidth('abc中文')).toBe(7);
  });

  it('counts emoji-presentation symbols as width 2', () => {
    // BMP emoji with Emoji_Presentation property: renders as 2 columns
    expect(visibleWidth('❌')).toBe(2); // U+274C
    expect(visibleWidth('☕')).toBe(2); // U+2615
    // Text-presentation symbols (no Emoji_Presentation): width 1
    expect(visibleWidth('✔')).toBe(1); // U+2714
    expect(visibleWidth('✖')).toBe(1); // U+2716
    // Text symbol + VS16: still width 1 in xterm.js (no emoji glyph in Menlo)
    expect(visibleWidth('\u2716\uFE0F')).toBe(1); // ✖️ U+2716+FE0F
  });

  it('counts classic SMP emoji as width 2', () => {
    // U+1F300–1F64F, U+1F680–1F6FF: terminal renders as 2 columns
    expect(visibleWidth('💻')).toBe(2); // U+1F4BB
    expect(visibleWidth('🍔')).toBe(2); // U+1F354
    expect(visibleWidth('🚀')).toBe(2); // U+1F680
    expect(visibleWidth('😀')).toBe(2); // U+1F600
  });

  it('counts newer SMP emoji (U+1F900+) as width 2', () => {
    // All Emoji_Presentation chars render as 2 columns in modern terminals
    expect(visibleWidth('🧑')).toBe(2); // U+1F9D1
    expect(visibleWidth('🤖')).toBe(2); // U+1F916
    expect(visibleWidth('🦊')).toBe(2); // U+1F98A
  });

  it('counts ZWJ sequences by component emoji width (xterm.js decomposes)', () => {
    // 🧑‍💻 = U+1F9D1 ZWJ U+1F4BB — xterm.js renders as 2 separate glyphs: 2+2=4
    expect(visibleWidth('🧑\u200D💻')).toBe(4);
    // 👨‍👩‍👧‍👦 = family ZWJ — 4 emoji components: 2×4=8
    expect(visibleWidth('👨\u200D👩\u200D👧\u200D👦')).toBe(8);
  });

  it('counts middle dot (U+00B7) as width 1 (xterm.js primary target)', () => {
    expect(visibleWidth('·')).toBe(1);
    // "Role" = 4, " " = 1, "·" = 1, " " = 1, "Name" = 4, total = 11
    expect(visibleWidth('Role · Name')).toBe(11);
  });

  it('counts keycap sequences as width 1 (xterm.js renders text-style)', () => {
    // 2️⃣ = 0032 + FE0F + 20E3 — keycap sequence renders as 1 col in xterm.js
    expect(visibleWidth('2\uFE0F\u20E3')).toBe(1);
  });

  it('counts flag emoji as width 2', () => {
    // 🇨🇳 = U+1F1E8 + U+1F1F3 — regional indicator pair
    expect(visibleWidth('🇨🇳')).toBe(2);
  });

  it('handles mixed content with emoji correctly', () => {
    // "abc" (3) + "❌" (2) + "💻" (2) + "中" (2) = 9
    expect(visibleWidth('abc❌💻中')).toBe(9);
  });
});

describe('padEndVisible', () => {
  it('pads ASCII strings to the requested visible width', () => {
    expect(padEndVisible('abc', 6)).toBe('abc   ');
  });

  it('treats CJK characters as width 2 when computing padding', () => {
    // 中文 occupies 4 columns; padding to width 6 needs 2 trailing spaces.
    expect(padEndVisible('中文', 6)).toBe('中文  ');
  });

  it('returns the input untouched when it already meets the width', () => {
    expect(padEndVisible('abcdef', 6)).toBe('abcdef');
    expect(padEndVisible('abcdef', 3)).toBe('abcdef');
  });

  it('ignores ANSI escape codes in the width calculation', () => {
    expect(padEndVisible('\x1b[1mab\x1b[0m', 5)).toBe('\x1b[1mab\x1b[0m   ');
  });
});

describe('truncateByDisplayWidth', () => {
  it('returns the original string when it fits the budget', () => {
    expect(truncateByDisplayWidth('hello', 10)).toBe('hello');
  });

  it('truncates ASCII strings and appends an ellipsis', () => {
    expect(truncateByDisplayWidth('abcdefghij', 6)).toBe('abcde…');
  });

  it('truncates CJK strings by display width, not by code-unit length', () => {
    // 6 CJK chars = 12 columns; budget 8 leaves room for 3 chars + ellipsis (1).
    expect(truncateByDisplayWidth('一二三四五六', 8)).toBe('一二三…');
  });

  it('preserves emoji surrogate pairs intact when truncating', () => {
    // Classic SMP emoji (U+1F600–U+1F603) each have visibleWidth=2.
    // Budget: maxWidth=5, ellipsis=1 col → body budget=4 → fits 2 emoji (4 cols).
    const input = '😀😁😂😃';
    const out = truncateByDisplayWidth(input, 5);
    expect(out).toBe('😀😁…');
    // Each char in the result (excluding the ellipsis) should be a full code
    // point, i.e. Array.from preserves the same length as code-point count.
    const body = out.slice(0, -1);
    expect(Array.from(body).length).toBe(body.match(/./gu)?.length ?? 0);
  });

  it('returns the input untouched when maxWidth is non-positive', () => {
    expect(truncateByDisplayWidth('abc', 0)).toBe('abc');
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

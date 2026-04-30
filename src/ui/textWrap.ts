/**
 * ANSI-aware text wrapping utilities for terminal UI components.
 *
 * These functions correctly handle ANSI escape codes (colors, bold, etc.)
 * when measuring string width and wrapping text to fit within a given width.
 */

/**
 * ANSI escape code regex pattern.
 * Matches all CSI (Control Sequence Introducer) sequences.
 */
// eslint-disable-next-line no-control-regex -- ANSI escape codes intentionally use \x1b
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Strip ANSI escape codes from a string, returning only visible characters.
 */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

/**
 * Get the visible width of a string (excluding ANSI escape codes).
 * Correctly handles CJK fullwidth characters (width 2) and standard characters (width 1).
 */
export function visibleWidth(str: string): number {
  const plain = stripAnsi(str);
  let width = 0;
  for (const char of plain) {
    const code = char.codePointAt(0) ?? 0;
    // CJK and fullwidth character ranges — each occupies 2 terminal columns
    if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Kangxi, CJK Symbols
      (code >= 0x3040 && code <= 0x33bf) || // Hiragana, Katakana, CJK Compat
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ext A
      (code >= 0x4e00 && code <= 0xa4cf) || // CJK Unified + Yi
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compat Ideographs
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compat Forms
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
      (code >= 0x20000 && code <= 0x2fa1f) // CJK Unified Ext B–F, Compat Supplement
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Wrap a string into multiple lines, each no wider than `maxWidth`.
 * Preserves ANSI escape codes and distributes them appropriately.
 *
 * For simplicity, this implementation strips ANSI codes during wrapping
 * and returns plain text chunks. The caller should re-apply styling
 * via Ink's `<Text>` component if needed.
 *
 * @param text - The text to wrap
 * @param maxWidth - Maximum visible width per line
 * @returns Array of wrapped lines
 */
export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) {
    return text ? [text] : [];
  }

  const plainText = stripAnsi(text);
  const lines: string[] = [];

  // Split on existing newlines first
  const rawLines = plainText.split('\n');

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      lines.push('');
      continue;
    }

    // If line fits, keep as-is
    if (rawLine.length <= maxWidth) {
      lines.push(rawLine);
      continue;
    }

    // Word-aware wrapping: try to break at word boundaries
    const words = rawLine.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      if (word.length === 0) continue;

      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (candidate.length <= maxWidth) {
        currentLine = candidate;
      } else {
        // Current line is full
        if (currentLine) {
          lines.push(currentLine);
        }

        // If single word exceeds width, force-break it
        if (word.length > maxWidth) {
          let remaining = word;
          while (remaining.length > maxWidth) {
            lines.push(remaining.slice(0, maxWidth));
            remaining = remaining.slice(maxWidth);
          }
          currentLine = remaining;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Wrap text with indentation on continuation lines.
 *
 * @param text - The text to wrap
 * @param maxWidth - Maximum visible width per line
 * @param indent - Indentation string for continuation lines (default: '').
 *                 When empty, all lines are left-aligned.
 * @returns Array of wrapped lines
 */
export function wrapTextWithIndent(text: string, maxWidth: number, indent: string = ''): string[] {
  const lines = wrapText(text, maxWidth);
  if (lines.length <= 1) return lines;

  const wrappedLines = [lines[0]!];

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart();
    if (trimmed) {
      wrappedLines.push(`${indent}${trimmed}`);
    } else {
      wrappedLines.push(lines[i]!);
    }
  }

  return wrappedLines;
}

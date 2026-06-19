import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printText, formatKeyValue, formatSectionTitle, formatSectionFooter } from '../../src/output/text.js';

describe('printText', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints text to stdout via console.log', () => {
    printText('hello world');
    expect(consoleLogSpy).toHaveBeenCalledWith('hello world');
  });

  it('prints empty string', () => {
    printText('');
    expect(consoleLogSpy).toHaveBeenCalledWith('');
  });

  it('prints text with special characters', () => {
    const special = 'line1\nline2\ttab "quoted" <angle>';
    printText(special);
    expect(consoleLogSpy).toHaveBeenCalledWith(special);
  });

  it('prints unicode text', () => {
    const cjk = '你好世界 🚀';
    printText(cjk);
    expect(consoleLogSpy).toHaveBeenCalledWith(cjk);
  });
});

describe('formatKeyValue', () => {
  it('formats basic key-value pairs with default indent', () => {
    const entries: Array<[string, string]> = [
      ['Name', 'Alice'],
      ['Age', '30'],
    ];
    const result = formatKeyValue(entries);
    // Default indent = 2, maxKeyLen = 4 ("Name"), padEnd(6)
    expect(result).toBe('  Name  Alice\n  Age   30');
  });

  it('aligns values based on longest key', () => {
    const entries: Array<[string, string]> = [
      ['ID', '1'],
      ['Username', 'bob'],
      ['Email', 'bob@mock-api.test.qwencloud.com'],
    ];
    const result = formatKeyValue(entries);
    // maxKeyLen = 8 ("Username"), padEnd(10)
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('  ID        1');
    expect(lines[1]).toBe('  Username  bob');
    expect(lines[2]).toBe('  Email     bob@mock-api.test.qwencloud.com');
  });

  it('respects custom indent', () => {
    const entries: Array<[string, string]> = [['Key', 'Value']];
    const result = formatKeyValue(entries, 4);
    expect(result).toBe('    Key  Value');
  });

  it('handles indent of 0', () => {
    const entries: Array<[string, string]> = [['A', 'B']];
    const result = formatKeyValue(entries, 0);
    expect(result).toBe('A  B');
  });

  it('handles single entry', () => {
    const entries: Array<[string, string]> = [['Status', 'Active']];
    const result = formatKeyValue(entries);
    expect(result).toBe('  Status  Active');
  });

  it('handles entries with empty values', () => {
    const entries: Array<[string, string]> = [
      ['Key1', ''],
      ['Key2', 'present'],
    ];
    const result = formatKeyValue(entries);
    const lines = result.split('\n');
    expect(lines[0]).toBe('  Key1  ');
    expect(lines[1]).toBe('  Key2  present');
  });

  it('handles entries with long keys', () => {
    const longKey = 'VeryLongKeyName';
    const entries: Array<[string, string]> = [
      [longKey, 'short'],
      ['K', 'v'],
    ];
    const result = formatKeyValue(entries);
    const lines = result.split('\n');
    // maxKeyLen = 15, padEnd(17)
    expect(lines[0]).toBe(`  ${longKey}  short`);
    expect(lines[1]).toBe('  K                v');
  });
});

describe('formatSectionTitle', () => {
  it('formats title without subtitle', () => {
    const result = formatSectionTitle('Models');
    // titlePart = 'Models', dashes = '─'.repeat(max(0, 80 - 6 - 4)) = '─'.repeat(70)
    expect(result).toBe(`  ── Models${'─'.repeat(70)}`);
  });

  it('formats title with subtitle', () => {
    const result = formatSectionTitle('Pricing', 'Standard');
    // titlePart = 'Pricing  ·  Standard' (length = 20), dashes = 80 - 20 - 4 = 56
    const titlePart = 'Pricing  ·  Standard';
    expect(result).toBe(`  ── ${titlePart}${'─'.repeat(80 - titlePart.length - 4)}`);
  });

  it('uses custom width', () => {
    const result = formatSectionTitle('Test', undefined, 40);
    // titlePart = 'Test' (length = 4), dashes = max(0, 40 - 4 - 4) = 32
    expect(result).toBe(`  ── Test${'─'.repeat(32)}`);
  });

  it('handles title longer than width (no negative dashes)', () => {
    const longTitle = 'A'.repeat(100);
    const result = formatSectionTitle(longTitle, undefined, 50);
    // width - titlePart.length - 4 < 0, so dashes = '─'.repeat(0) = ''
    expect(result).toBe(`  ── ${longTitle}`);
  });

  it('handles empty title', () => {
    const result = formatSectionTitle('', undefined, 20);
    // titlePart = '' (length = 0), dashes = max(0, 20 - 0 - 4) = 16
    expect(result).toBe(`  ── ${'─'.repeat(16)}`);
  });

  it('handles title with subtitle exceeding width', () => {
    const result = formatSectionTitle('Long Title', 'Very Long Subtitle Here', 20);
    // titlePart = 'Long Title  ·  Very Long Subtitle Here' (38 chars), 20 - 38 - 4 = negative
    expect(result).toBe('  ── Long Title  ·  Very Long Subtitle Here');
  });
});

describe('formatSectionFooter', () => {
  it('formats footer with default width', () => {
    const result = formatSectionFooter('Page 1 of 3');
    expect(result).toBe(`  ${'─'.repeat(80)}\n  Page 1 of 3`);
  });

  it('formats footer with custom width', () => {
    const result = formatSectionFooter('Done', 40);
    expect(result).toBe(`  ${'─'.repeat(40)}\n  Done`);
  });

  it('handles empty footer text', () => {
    const result = formatSectionFooter('', 20);
    expect(result).toBe(`  ${'─'.repeat(20)}\n  `);
  });

  it('handles footer with special characters', () => {
    const text = '← Previous | Next →';
    const result = formatSectionFooter(text, 50);
    expect(result).toBe(`  ${'─'.repeat(50)}\n  ${text}`);
  });

  it('handles zero width', () => {
    const result = formatSectionFooter('text', 0);
    expect(result).toBe('  \n  text');
  });
});

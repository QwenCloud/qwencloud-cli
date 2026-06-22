import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import chalk from 'chalk';
import { buildProgressBar, progressColor } from '../../src/ui/theme.js';

// Force chalk color level to 3 (truecolor) so color functions produce
// actual ANSI escape sequences regardless of the test runner's TTY state.
let originalLevel: number;
beforeAll(() => {
  originalLevel = chalk.level;
  chalk.level = 3;
});
afterAll(() => {
  chalk.level = originalLevel;
});

describe('buildProgressBar', () => {
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('builds bar with default width (10)', () => {
    const bar = buildProgressBar(100);
    expect(stripAnsi(bar)).toBe('██████████');
  });

  it('builds bar with custom width', () => {
    const bar = buildProgressBar(50, 20);
    expect(stripAnsi(bar)).toBe('██████████░░░░░░░░░░');
  });

  it('builds empty bar for 0%', () => {
    const bar = buildProgressBar(0, 10);
    expect(stripAnsi(bar)).toBe('░░░░░░░░░░');
  });

  it('shows percentage when showPct=true', () => {
    const bar = buildProgressBar(85, 10, undefined, true);
    expect(bar).toMatch(/85%/);
  });

  it('uses custom color function', () => {
    const bar = buildProgressBar(50, 5, (s: string) => `<<${s}>>`);
    expect(bar).toContain('<<');
  });

  it('rounds filled blocks correctly', () => {
    // 33% of 10 = 3.3 → rounds to 3
    const bar = buildProgressBar(33, 10);
    const stripped = stripAnsi(bar);
    const filled = stripped.match(/█/g)?.length ?? 0;
    expect(filled).toBe(3);
  });
});

describe('progressColor', () => {
  const probe = 'X';

  describe('remaining mode — threshold boundary verification', () => {
    it('> 50% produces green (#22C55E)', () => {
      const colored = progressColor(51, 'remaining')(probe);
      // chalk.hex('#22C55E') → ANSI 38;2;34;197;94m (RGB decimal of 0x22, 0xC5, 0x5E)
      expect(colored).toContain('38;2;34;197;94');
      expect(colored).toContain(probe);
      expect(colored).not.toBe(probe);
    });

    it('exactly 50% falls to lime (#84CC16)', () => {
      const colored = progressColor(50, 'remaining')(probe);
      expect(colored).not.toBe(probe);
      // Distinguish from green zone — different ANSI sequence
      const greenColored = progressColor(51, 'remaining')(probe);
      expect(colored).not.toEqual(greenColored);
    });

    it('21% falls to lime (#84CC16), different from amber', () => {
      const colored = progressColor(21, 'remaining')(probe);
      const amberColored = progressColor(20, 'remaining')(probe);
      expect(colored).not.toBe(probe);
      expect(colored).not.toEqual(amberColored);
    });

    it('exactly 20% falls to amber (#F59E0B)', () => {
      const colored = progressColor(20, 'remaining')(probe);
      expect(colored).not.toBe(probe);
      const limeColored = progressColor(21, 'remaining')(probe);
      expect(colored).not.toEqual(limeColored);
    });

    it('11% stays in amber, different from red', () => {
      const colored = progressColor(11, 'remaining')(probe);
      const redColored = progressColor(10, 'remaining')(probe);
      expect(colored).not.toBe(probe);
      expect(colored).not.toEqual(redColored);
    });

    it('<= 10% produces red (#EF4444)', () => {
      const colored = progressColor(10, 'remaining')(probe);
      expect(colored).not.toBe(probe);
      // 0% also red — same color output
      const zeroColored = progressColor(0, 'remaining')(probe);
      expect(zeroColored).toBe(colored);
    });

    it('each threshold boundary maps to a distinct color function', () => {
      const green = progressColor(100, 'remaining');
      const lime = progressColor(50, 'remaining');
      const amber = progressColor(15, 'remaining');
      const red = progressColor(5, 'remaining');
      // All four zones produce different chalk instances
      expect(green).not.toBe(lime);
      expect(lime).not.toBe(amber);
      expect(amber).not.toBe(red);
      expect(green).not.toBe(red);
    });

    it('values within the same zone produce identical color output', () => {
      // chalk.hex() creates new instances per call, so we compare output strings
      expect(progressColor(60, 'remaining')(probe)).toBe(progressColor(99, 'remaining')(probe));
      expect(progressColor(25, 'remaining')(probe)).toBe(progressColor(49, 'remaining')(probe));
      expect(progressColor(11, 'remaining')(probe)).toBe(progressColor(19, 'remaining')(probe));
      expect(progressColor(0, 'remaining')(probe)).toBe(progressColor(10, 'remaining')(probe));
    });
  });

  describe('used mode — threshold boundary verification', () => {
    it('< 50% produces chalk.green coloring', () => {
      const colored = progressColor(0, 'used')(probe);
      expect(colored).not.toBe(probe);
      expect(colored).toContain(probe);
      // chalk.green is a stable reference, so same-zone calls return the same fn
      expect(progressColor(0, 'used')).toBe(progressColor(49, 'used'));
    });

    it('exactly 50% switches to chalk.yellow', () => {
      const fn50 = progressColor(50, 'used');
      const fn49 = progressColor(49, 'used');
      expect(fn50).not.toBe(fn49);
      expect(fn50(probe)).not.toBe(probe);
      // 50% and 80% are in the same zone (yellow)
      expect(fn50).toBe(progressColor(80, 'used'));
    });

    it('80% is still yellow, 81% switches to red', () => {
      const fn80 = progressColor(80, 'used');
      const fn81 = progressColor(81, 'used');
      expect(fn80).not.toBe(fn81);
      // Verify zone membership via referential equality
      expect(progressColor(50, 'used')).toBe(fn80);
      expect(progressColor(100, 'used')).toBe(fn81);
    });

    it('each zone produces visually distinct ANSI output', () => {
      const greenOut = progressColor(30, 'used')(probe);
      const yellowOut = progressColor(65, 'used')(probe);
      const redOut = progressColor(90, 'used')(probe);
      expect(greenOut).not.toEqual(yellowOut);
      expect(yellowOut).not.toEqual(redOut);
      expect(greenOut).not.toEqual(redOut);
    });
  });
});

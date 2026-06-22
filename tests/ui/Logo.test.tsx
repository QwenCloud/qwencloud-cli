import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { Logo } from '../../src/ui/Logo.js';
import { visibleWidth } from '../../src/ui/textWrap.js';

describe('Logo component', () => {
  it('renders the box border characters', () => {
    const { lastFrame } = render(<Logo />);
    const out = lastFrame() ?? '';
    expect(out).toContain('╔');
    expect(out).toContain('╗');
    expect(out).toContain('╚');
    expect(out).toContain('╝');
  });

  it('contains brand name and tagline', () => {
    const { lastFrame } = render(<Logo />);
    const out = lastFrame() ?? '';
    expect(out).toContain('QwenCloud CLI');
    expect(out).toContain('Manage your AI from terminal');
  });

  it('includes a version string in v.. format', () => {
    const { lastFrame } = render(<Logo />);
    const out = lastFrame() ?? '';
    expect(out).toMatch(/v\d/);
  });

  it('border characters are at consistent column positions across all lines', () => {
    const { lastFrame } = render(<Logo />);
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    // The logo box width is 37 inner + 2 border chars = 39 visible chars
    // plus paddingLeft=2 from the Box wrapper
    const expectedBoxWidth = 37 + 2; // inner + ╔╗

    // Top line starts with ╔ and ends with ╗
    const topLine = lines.find((l) => l.includes('╔'));
    expect(topLine).toBeDefined();
    expect(topLine).toContain('╗');

    // Bottom line starts with ╚ and ends with ╝
    const bottomLine = lines.find((l) => l.includes('╚'));
    expect(bottomLine).toBeDefined();
    expect(bottomLine).toContain('╝');

    // All ║ lines: left ║ and right ║ should be at the same column positions
    const pipeLines = lines.filter((l) => l.includes('║'));
    expect(pipeLines.length).toBeGreaterThanOrEqual(3); // empty + brand + tagline + empty

    const leftPipePositions = pipeLines.map((l) => l.indexOf('║'));
    const rightPipePositions = pipeLines.map((l) => l.lastIndexOf('║'));

    // All left ║ at same column
    const firstLeft = leftPipePositions[0];
    for (const pos of leftPipePositions) {
      expect(pos).toBe(firstLeft);
    }

    // All right ║ at same column
    const firstRight = rightPipePositions[0];
    for (const pos of rightPipePositions) {
      expect(pos).toBe(firstRight);
    }

    // The distance between left ║ and right ║ should be boxWidth - 1 (0-indexed)
    expect(firstRight - firstLeft).toBe(expectedBoxWidth - 1);
  });

  it('╔ and ╚ are at the same column; ╗ and ╝ are at the same column', () => {
    const { lastFrame } = render(<Logo />);
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    const topLine = lines.find((l) => l.includes('╔'))!;
    const bottomLine = lines.find((l) => l.includes('╚'))!;

    expect(topLine.indexOf('╔')).toBe(bottomLine.indexOf('╚'));
    expect(topLine.indexOf('╗')).toBe(bottomLine.indexOf('╝'));
  });

  it('all rendered lines have the same visible width (no ragged right edge)', () => {
    const { lastFrame } = render(<Logo />);
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    const widths = lines.map((l) => visibleWidth(l.trimEnd()));
    const maxWidth = Math.max(...widths);

    // All lines should have the same visible width (padded by the box)
    for (const w of widths) {
      expect(w).toBe(maxWidth);
    }
  });

  it('version string appears in full "vX.Y.Z" format on the brand line', () => {
    const { lastFrame } = render(<Logo />);
    const out = stripAnsi(lastFrame() ?? '');
    // Match semantic version pattern: vMAJOR.MINOR.PATCH
    expect(out).toMatch(/v\d+\.\d+\.\d+/);
  });
});

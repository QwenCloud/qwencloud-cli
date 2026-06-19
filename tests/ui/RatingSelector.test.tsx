/**
 * Unit tests for the <RatingSelector /> Ink component.
 *
 * Validates:
 *   - All 5 rating levels rendered with star visuals and labels
 *   - Default selection highlights the correct item (initialIndex)
 *   - Arrow key navigation moves highlight
 *   - j/k vim-style navigation
 *   - Enter selects and calls onSelect with rating number
 *   - Boundary values (1 and 5)
 *   - Esc / Ctrl+C cancels
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';

// ── Mock ink: capture useInput callback + provide stub useApp ───────────
let capturedInputHandler:
  | ((input: string, key: Record<string, boolean>) => void)
  | null = null;
const exitMock = vi.fn();

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    useInput: (handler: (input: string, key: Record<string, boolean>) => void) => {
      capturedInputHandler = handler;
    },
    useApp: () => ({ exit: exitMock }),
  };
});

// Mock useTerminalSize for Section component
vi.mock('../../src/ui/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24 }),
}));

const { RatingSelector } = await import('../../src/ui/RatingSelector.js');

beforeEach(() => {
  capturedInputHandler = null;
  exitMock.mockReset();
});

function pressKey(input: string, key: Partial<Record<string, boolean>> = {}): void {
  expect(capturedInputHandler).toBeTruthy();
  capturedInputHandler!(input, key as Record<string, boolean>);
}

describe('<RatingSelector /> rendering', () => {
  it('renders all 5 rating options', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Very unsatisfied');
    expect(out).toContain('Unsatisfied');
    expect(out).toContain('Neutral');
    expect(out).toContain('Satisfied');
    expect(out).toContain('Very satisfied');
    unmount();
  });

  it('renders star visuals', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('★★★★★');
    expect(out).toContain('★☆☆☆☆');
    unmount();
  });

  it('highlights the default selection (index 4 = 5 stars)', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Very satisfied');
    unmount();
  });

  it('renders section title', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Rate this support experience');
    unmount();
  });

  it('renders footer with navigation hints', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Navigate');
    expect(out).toContain('Select');
    unmount();
  });
});

describe('<RatingSelector /> initialIndex', () => {
  it('custom initialIndex=0 highlights 1 star', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={0} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Very unsatisfied');
    unmount();
  });

  it('custom initialIndex=2 highlights 3 stars', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={2} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Neutral');
    unmount();
  });

  it('out-of-range initialIndex is clamped to valid range', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={99} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Very satisfied');
    unmount();
  });
});

describe('<RatingSelector /> navigation', () => {
  it('down arrow moves highlight down', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={0} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Unsatisfied');
    unmount();
  });

  it('up arrow moves highlight up', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={2} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { upArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Unsatisfied');
    unmount();
  });

  it('"j" moves down like downArrow', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={0} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('j', {});
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Unsatisfied');
    unmount();
  });

  it('"k" moves up like upArrow', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={2} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('k', {});
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Unsatisfied');
    unmount();
  });

  it('up arrow at index 0 stays at 0 (boundary)', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector initialIndex={0} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { upArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    expect(highlightedLine).toContain('Very unsatisfied');
    unmount();
  });

  it('down arrow at index 4 stays at 4 (boundary)', () => {
    const { lastFrame, unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('●'));
    // Default is index 4, pressing down should stay at 4
    expect(highlightedLine).toContain('Very satisfied');
    unmount();
  });
});

describe('<RatingSelector /> selection', () => {
  it('Enter selects the highlighted rating (5 stars default)', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <RatingSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith(5);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Enter selects rating 1 when navigated to first option', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <RatingSelector initialIndex={0} onSelect={onSelect} onCancel={vi.fn()} />,
    );
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Enter selects rating 3 after navigating to Neutral', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <RatingSelector initialIndex={0} onSelect={onSelect} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith(3);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Enter selects rating 2 (boundary between min and mid)', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <RatingSelector initialIndex={1} onSelect={onSelect} onCancel={vi.fn()} />,
    );
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith(2);
    unmount();
  });

  it('Enter selects rating 4', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <RatingSelector initialIndex={3} onSelect={onSelect} onCancel={vi.fn()} />,
    );
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith(4);
    unmount();
  });
});

describe('<RatingSelector /> cancellation', () => {
  it('Esc triggers onCancel', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={onCancel} />,
    );
    pressKey('', { escape: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Ctrl+C triggers onCancel', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <RatingSelector onSelect={vi.fn()} onCancel={onCancel} />,
    );
    pressKey('c', { ctrl: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Cancel does not trigger onSelect', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <RatingSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    pressKey('', { escape: true });
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
  });
});

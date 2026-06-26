/**
 * Unit tests for the <CategorySelector /> Ink component.
 *
 * Validates:
 *   - Renders category items from tree
 *   - Arrow key navigation moves highlight
 *   - Enter on leaf node calls onSelect with path
 *   - Enter on branch node navigates deeper
 *   - Esc pops breadcrumb / cancels at root
 *   - Backspace pops breadcrumb
 *   - Ctrl+C cancels
 *   - Empty children level shows placeholder
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { CategoryNode } from '../../src/types/support.js';

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

const { CategorySelector } = await import('../../src/ui/CategorySelector.js');

beforeEach(() => {
  capturedInputHandler = null;
  exitMock.mockReset();
});

function pressKey(input: string, key: Partial<Record<string, boolean>> = {}): void {
  expect(capturedInputHandler).toBeTruthy();
  capturedInputHandler!(input, key as Record<string, boolean>);
}

const SAMPLE_TREE: CategoryNode[] = [
  { id: 'cat-1', name: 'Billing' },
  { id: 'cat-2', name: 'Technical Support', children: [
    { id: 'cat-2-1', name: 'API Issues' },
    { id: 'cat-2-2', name: 'SDK Problems' },
  ]},
  { id: 'cat-3', name: 'Account' },
];

describe('<CategorySelector /> rendering', () => {
  it('renders all top-level category names', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Billing');
    expect(out).toContain('Technical Support');
    expect(out).toContain('Account');
    unmount();
  });

  it('renders the title "Select a category"', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Select a category');
    unmount();
  });

  it('shows breadcrumb as "/" at root level', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('/');
    unmount();
  });

  it('shows "›" indicator for items with children', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('›');
    unmount();
  });

  it('renders the footer with navigation hints', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Navigate');
    expect(out).toContain('Select');
    unmount();
  });
});

describe('<CategorySelector /> navigation', () => {
  it('down arrow moves highlight to next item', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Technical Support');
    unmount();
  });

  it('up arrow moves highlight up', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { downArrow: true });
    pressKey('', { upArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Technical Support');
    unmount();
  });

  it('up arrow at index 0 stays at 0', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { upArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Billing');
    unmount();
  });

  it('down arrow clamps at last item', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    for (let i = 0; i < 10; i++) pressKey('', { downArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Account');
    unmount();
  });
});

describe('<CategorySelector /> branch navigation', () => {
  it('Enter on branch node shows children', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    // Navigate to "Technical Support" (index 1)
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('API Issues');
    expect(out).toContain('SDK Problems');
    unmount();
  });

  it('breadcrumb updates when navigating deeper', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Technical Support');
    unmount();
  });

  it('Esc pops breadcrumb when inside a branch', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    pressKey('', { escape: true });
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Billing');
    expect(out).toContain('Account');
    unmount();
  });

  it('Backspace pops breadcrumb when inside a branch', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    pressKey('', { backspace: true });
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Billing');
    unmount();
  });
});

describe('<CategorySelector /> selection', () => {
  it('Enter on leaf node calls onSelect with correct path', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={onSelect} onCancel={vi.fn()} />,
    );
    // Select "Billing" (leaf at index 0)
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith({
      id: 'cat-1',
      name: 'Billing',
      path: 'Billing',
    });
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Enter on nested leaf calls onSelect with full path', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={onSelect} onCancel={vi.fn()} />,
    );
    // Navigate to "Technical Support" → "API Issues"
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith({
      id: 'cat-2-1',
      name: 'API Issues',
      path: 'Technical Support > API Issues',
    });
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });
});

describe('<CategorySelector /> cancellation', () => {
  it('Esc at root calls onCancel', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={onCancel} />,
    );
    pressKey('', { escape: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Ctrl+C cancels from anywhere', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <CategorySelector tree={SAMPLE_TREE} onSelect={vi.fn()} onCancel={onCancel} />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    pressKey('c', { ctrl: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });
});

describe('<CategorySelector /> empty state', () => {
  it('shows placeholder when no categories are available', () => {
    const { lastFrame, unmount } = render(
      <CategorySelector tree={[]} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out.toLowerCase()).toContain('no categories');
    unmount();
  });
});

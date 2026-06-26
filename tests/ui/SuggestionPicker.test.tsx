/**
 * Unit tests for the <SuggestionPicker /> Ink component.
 *
 * Validates:
 *   - All suggestions plus the "keep" row are rendered
 *   - Arrow key navigation moves highlight
 *   - Enter selects the highlighted item
 *   - "Keep your selection" choice works correctly
 *   - Esc / Ctrl+C cancels
 *   - Empty suggestions array still renders the keep option
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { CategorySuggestion } from '../../src/types/support.js';

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

const { SuggestionPicker } = await import('../../src/ui/SuggestionPicker.js');

beforeEach(() => {
  capturedInputHandler = null;
  exitMock.mockReset();
});

function pressKey(input: string, key: Partial<Record<string, boolean>> = {}): void {
  expect(capturedInputHandler).toBeTruthy();
  capturedInputHandler!(input, key as Record<string, boolean>);
}

const SAMPLE_SUGGESTIONS: CategorySuggestion[] = [
  { categoryId: 'sug-1', categoryName: 'API Errors', categoryPath: 'Technical > API Errors', score: 0.9 },
  { categoryId: 'sug-2', categoryName: 'Billing Issues', categoryPath: 'Billing > Payment', score: 0.7 },
];

describe('<SuggestionPicker /> rendering', () => {
  it('renders the "Keep your selection" row', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Keep your selection');
    expect(out).toContain('Account > General');
    unmount();
  });

  it('renders all suggestion items', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Technical > API Errors');
    expect(out).toContain('Billing > Payment');
    unmount();
  });

  it('renders the section title', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Suggested categories');
    unmount();
  });

  it('renders the footer with navigation hints', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Navigate');
    expect(out).toContain('Select');
    unmount();
  });
});

describe('<SuggestionPicker /> navigation', () => {
  it('down arrow moves highlight to next item', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    pressKey('', { downArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Technical > API Errors');
    unmount();
  });

  it('up arrow moves highlight up', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { downArrow: true });
    pressKey('', { upArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Technical > API Errors');
    unmount();
  });

  it('up arrow at index 0 stays at 0', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    pressKey('', { upArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Keep your selection');
    unmount();
  });

  it('down arrow clamps at last item', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    for (let i = 0; i < 10; i++) pressKey('', { downArrow: true });
    const out = stripAnsi(lastFrame() ?? '');
    const lines = out.split('\n');
    const highlightedLine = lines.find((l) => l.includes('▶'));
    expect(highlightedLine).toContain('Billing > Payment');
    unmount();
  });
});

describe('<SuggestionPicker /> selection', () => {
  it('Enter on "Keep" row returns keep choice', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'keep',
      categoryId: 'user-cat',
      categoryPath: 'Account > General',
    });
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Enter on a suggestion row returns suggestion choice', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );
    pressKey('', { downArrow: true });
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'suggestion',
      categoryId: 'sug-1',
      categoryPath: 'Technical > API Errors',
    });
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });
});

describe('<SuggestionPicker /> cancellation', () => {
  it('Esc cancels', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );
    pressKey('', { escape: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });

  it('Ctrl+C cancels', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={SAMPLE_SUGGESTIONS}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );
    pressKey('c', { ctrl: true });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalled();
    unmount();
  });
});

describe('<SuggestionPicker /> empty state', () => {
  it('with empty suggestions array, only "Keep" option is shown', () => {
    const { lastFrame, unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Keep your selection');
    unmount();
  });

  it('Enter on keep option works with empty suggestions', () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <SuggestionPicker
        userCategoryId="user-cat"
        userCategoryPath="Account > General"
        suggestions={[]}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );
    pressKey('', { return: true });
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'keep',
      categoryId: 'user-cat',
      categoryPath: 'Account > General',
    });
    unmount();
  });
});

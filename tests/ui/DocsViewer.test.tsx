import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { DocsViewer } from '../../src/ui/DocsViewer.js';
import { AltScreenContext } from '../../src/ui/render.js';
import type { DocContentViewModel } from '../../src/view-models/docs/index.js';

vi.mock('../../src/utils/open-browser.js', () => ({
  openBrowser: vi.fn(),
}));

const ORIGINAL_COLUMNS = process.stdout.columns;
const ORIGINAL_ROWS = process.stdout.rows;

beforeEach(() => {
  Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process.stdout, 'columns', { value: ORIGINAL_COLUMNS, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: ORIGINAL_ROWS, configurable: true });
});

function frame(el: React.ReactElement): string {
  const inst = render(el);
  const f = stripAnsi(inst.lastFrame() ?? '');
  inst.unmount();
  return f;
}

function makeContentVm(overrides: Partial<DocContentViewModel> = {}): DocContentViewModel {
  return {
    url: 'https://mock-docs.test.qwencloud.com/developer-guides/getting-started',
    resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/developer-guides/getting-started.md',
    content: '# Getting Started\n\nWelcome to the docs.',
    renderedLines: ['[H1] Getting Started', '', 'Welcome to the docs.'],
    error: null,
    anchor: null,
    anchorLine: null,
    ...overrides,
  };
}

function docsViewerLineCount(altScreen: boolean, vm?: DocContentViewModel): number {
  const inst = render(
    <AltScreenContext.Provider value={altScreen}>
      <DocsViewer
        vm={vm ?? makeContentVm()}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={() => {}}
        onQuit={() => {}}
      />
    </AltScreenContext.Provider>,
  );
  const count = stripAnsi(inst.lastFrame() ?? '').split('\n').length;
  inst.unmount();
  return count;
}

describe('DocsViewer', () => {
  it('should render markdown content with formatting', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();

    const out = frame(
      <DocsViewer
        vm={makeContentVm()}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toContain('Getting Started');
    expect(out).toContain('Welcome to the docs.');
  });

  it('should fallback to raw content when renderedLines is null', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();

    const out = frame(
      <DocsViewer
        vm={makeContentVm({
          renderedLines: null,
          content: 'Raw markdown text here.\nSecond line.',
        })}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toContain('Raw markdown text here.');
    expect(out).toContain('Second line.');
  });

  it('should display error when content fetch failed', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();

    const out = frame(
      <DocsViewer
        vm={makeContentVm({
          content: null,
          renderedLines: null,
          error: 'Failed to fetch',
        })}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toContain('Failed to load document');
    expect(out).toContain('Failed to fetch');
  });

  it('should show back navigation hint', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();

    const out = frame(
      <DocsViewer
        vm={makeContentVm()}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toContain('Back to results');
  });

  it('should display domain in subtitle', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();

    const out = frame(
      <DocsViewer
        vm={makeContentVm()}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toContain('mock-docs.test.qwencloud.com');
  });

  it('should render empty document placeholder', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();

    const out = frame(
      <DocsViewer
        vm={makeContentVm({
          content: '',
          renderedLines: [],
        })}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toContain('empty document');
  });
});

describe('DocsViewer keyboard pagination', () => {
  function makeLongContentVm(lineCount: number): DocContentViewModel {
    const lines = Array.from({ length: lineCount }, (_, i) => `Line ${i + 1} content`);
    return makeContentVm({
      content: lines.join('\n'),
      renderedLines: lines,
    });
  }

  it('should scroll down one page on Ctrl+F (\\x06)', async () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(100);

    const inst = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    const initialFrame = stripAnsi(inst.lastFrame() ?? '');
    expect(initialFrame).toContain('Line 1 content');

    inst.stdin.write('\x06');
    await new Promise((r) => setTimeout(r, 50));

    const afterPageDown = stripAnsi(inst.lastFrame() ?? '');
    // After page-down, Line 1 should no longer be visible at the top
    expect(afterPageDown).not.toContain('Line 1 content');

    inst.unmount();
  });

  it('should scroll up one page on Ctrl+B (\\x02)', async () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(100);

    const inst = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    // Scroll down first
    inst.stdin.write('\x06');
    await new Promise((r) => setTimeout(r, 50));
    const afterDown = stripAnsi(inst.lastFrame() ?? '');
    expect(afterDown).not.toContain('Line 1 content');

    // Scroll back up
    inst.stdin.write('\x02');
    await new Promise((r) => setTimeout(r, 50));
    const afterUp = stripAnsi(inst.lastFrame() ?? '');
    expect(afterUp).toContain('Line 1 content');

    inst.unmount();
  });

  it('should not scroll below document end on Ctrl+F', async () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    // Use a short document that fits within viewport minus a few lines
    const vm = makeLongContentVm(10);

    const inst = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    // Multiple page-downs should not cause errors
    inst.stdin.write('\x06');
    inst.stdin.write('\x06');
    inst.stdin.write('\x06');
    await new Promise((r) => setTimeout(r, 50));

    const output = stripAnsi(inst.lastFrame() ?? '');
    // Last line should still be visible (clamped at end)
    expect(output).toContain('Line 10 content');

    inst.unmount();
  });

  it('should not scroll above document start on Ctrl+B', async () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(100);

    const inst = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    // Ctrl+B at position 0 should stay at top
    inst.stdin.write('\x02');
    await new Promise((r) => setTimeout(r, 50));

    const output = stripAnsi(inst.lastFrame() ?? '');
    expect(output).toContain('Line 1 content');

    inst.unmount();
  });

  it('Ctrl+F should behave equivalently to PgDn/Space', async () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(100);

    // Render with Ctrl+F
    const inst1 = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );
    inst1.stdin.write('\x06');
    await new Promise((r) => setTimeout(r, 50));
    const ctrlFFrame = stripAnsi(inst1.lastFrame() ?? '');
    inst1.unmount();

    // Render with Space (equivalent page-down)
    const inst2 = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );
    inst2.stdin.write(' ');
    await new Promise((r) => setTimeout(r, 50));
    const spaceFrame = stripAnsi(inst2.lastFrame() ?? '');
    inst2.unmount();

    expect(ctrlFFrame).toEqual(spaceFrame);
  });
});

describe('DocsViewer status bar format', () => {
  function makeLongContentVm(lineCount: number): DocContentViewModel {
    const lines = Array.from({ length: lineCount }, (_, i) => `Line ${i + 1} content`);
    return makeContentVm({
      content: lines.join('\n'),
      renderedLines: lines,
    });
  }

  it('should display status bar in [currentLine/totalLines] format', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(50);

    const out = frame(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    // At initial position, status bar should show [1/50]
    expect(out).toMatch(/\[1\/50\]/);
  });

  it('should update status bar after scrolling', async () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(100);

    const inst = render(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    // Initially should show [1/100]
    const initial = stripAnsi(inst.lastFrame() ?? '');
    expect(initial).toMatch(/\[1\/100\]/);

    // After scrolling down, line number should increase
    inst.stdin.write('\x06');
    await new Promise((r) => setTimeout(r, 50));

    const afterScroll = stripAnsi(inst.lastFrame() ?? '');
    // Should show [N/100] where N > 1
    expect(afterScroll).toMatch(/\[\d+\/100\]/);
    expect(afterScroll).not.toMatch(/\[1\/100\]/);

    inst.unmount();
  });

  it('should show [1/N] format with bracket delimiters', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(25);

    const out = frame(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    // Verify bracket format specifically (not range format like "1-20/25")
    expect(out).toMatch(/\[1\/25\]/);
    // Should NOT contain the old range format
    expect(out).not.toMatch(/\d+–\d+\/\d+/);
  });

  it('should display correct total line count matching renderedLines length', () => {
    const onBack = vi.fn();
    const onQuit = vi.fn();
    const vm = makeLongContentVm(73);

    const out = frame(
      <DocsViewer
        vm={vm}
        url="https://mock-docs.test.qwencloud.com/developer-guides/getting-started"
        onBack={onBack}
        onQuit={onQuit}
      />,
    );

    expect(out).toMatch(/\[1\/73\]/);
  });

  describe('alt-screen scrollback safety', () => {
    // rows is forced to 40 in beforeEach; the default doc is short (a few lines).
    it('pads to full terminal height when NOT on the alt-screen', () => {
      // Off the alt-screen (e.g. ConHost) the full-height padding is retained so
      // the redraw clears residue as before.
      expect(docsViewerLineCount(false)).toBeGreaterThanOrEqual(38);
    });

    it('does NOT pad to full height on the alt-screen (avoids Ink clearTerminal / \\x1b[3J)', () => {
      // On the alt-screen the buffer switch already guarantees a clean exit;
      // padding would push Ink into its clearTerminal path, whose \x1b[3J wipes
      // the terminal scrollback on Terminal.app/iTerm2. So the output stays at
      // chrome + content height only, well below the 40-row terminal.
      expect(docsViewerLineCount(true)).toBeLessThan(20);
    });

    it('renders fewer rows on the alt-screen than off it for the same document', () => {
      const vm = makeContentVm();
      expect(docsViewerLineCount(false, vm)).toBeGreaterThan(docsViewerLineCount(true, vm));
    });

    it('keeps height below the terminal for long docs that fill the viewport', () => {
      // A document taller than the viewport. Off the alt-screen it reaches full
      // terminal height; on the alt-screen one content row is reserved so the
      // total height stays < rows, keeping Ink off its clearTerminal (\x1b[3J) path.
      const longVm = makeContentVm({
        renderedLines: Array.from({ length: 80 }, (_, i) => `paragraph line ${i + 1}`),
        content: 'x',
      });
      expect(docsViewerLineCount(true, longVm)).toBeLessThan(docsViewerLineCount(false, longVm));
    });
  });
});

/**
 * Unit tests for the <SupportViewInk /> Ink component.
 *
 * Validates:
 *   - Ticket metadata fields are rendered (id, title, status, category, date)
 *   - Description section is rendered
 *   - Messages section with multiple messages
 *   - Truncation indicator when truncated=true
 *   - Empty messages section is hidden
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { SupportViewViewModel, SupportMessageViewModel } from '../../src/view-models/support/view.js';

// Mock useTerminalSize for terminal width calculations
vi.mock('../../src/ui/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24 }),
}));

// Mock renderWithInk so it doesn't actually enter interactive mode
vi.mock('../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderInteractive: vi.fn(),
}));

const { SupportViewInk } = await import('../../src/ui/SupportView.js');

function buildMessages(count: number): SupportMessageViewModel[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'customer' : 'engineer',
    displayRole: i % 2 === 0 ? 'Customer' : 'Engineer',
    nickName: i % 2 === 0 ? 'Alice' : 'Bob',
    content: `Message content ${i + 1}`,
    createdAt: '2025-01-15 10:00',
  }));
}

function buildVM(overrides: Partial<SupportViewViewModel> = {}): SupportViewViewModel {
  return {
    available: true,
    ticket: {
      id: 'TK-001',
      title: 'Cannot access API endpoint',
      status: 'Open',
      createdAt: '2025-01-15 09:30',
      category: 'Technical > API',
      description: 'When I call the /models endpoint, I get a 403 error.',
    },
    messages: buildMessages(2),
    messageCount: 2,
    truncated: false,
    ...overrides,
  };
}

describe('<SupportViewInk /> ticket overview', () => {
  it('renders the ticket ID in the card title', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('TK-001');
    unmount();
  });

  it('renders the ticket title', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Cannot access API endpoint');
    unmount();
  });

  it('renders the ticket status', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Open');
    unmount();
  });

  it('renders the ticket category', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Technical > API');
    unmount();
  });

  it('renders the creation date', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('2025-01-15 09:30');
    unmount();
  });

  it('renders field labels', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Title');
    expect(out).toContain('Status');
    expect(out).toContain('Category');
    expect(out).toContain('Created');
    unmount();
  });
});

describe('<SupportViewInk /> description section', () => {
  it('renders the description text', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('403 error');
    unmount();
  });

  it('renders the Description section header', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Description');
    unmount();
  });
});

describe('<SupportViewInk /> messages section', () => {
  it('renders the Messages section header with count', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Messages (2)');
    unmount();
  });

  it('renders message content', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Message content 1');
    expect(out).toContain('Message content 2');
    unmount();
  });

  it('renders message roles and timestamps', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Customer');
    expect(out).toContain('Engineer');
    expect(out).toContain('2025-01-15 10:00');
    unmount();
  });

  it('renders nicknames for messages', () => {
    const vm = buildVM();
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    unmount();
  });

  it('does not render Messages section when messageCount is 0', () => {
    const vm = buildVM({ messages: [], messageCount: 0 });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toContain('Messages (');
    unmount();
  });

  // BUG-8: the view model already masked email nicknames; the card renders the
  // masked value verbatim (no raw email leaks, no double-masking).
  it('renders the already-masked email nickName without leaking the raw address', () => {
    const vm = buildVM({
      messages: [
        {
          role: 'customer',
          displayRole: 'Customer',
          nickName: 'a***@mock-api.test.qwencloud.com',
          content: 'Masked sender test',
          createdAt: '2025-01-15 10:00',
        },
      ],
      messageCount: 1,
    });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('a***@mock-api.test.qwencloud.com');
    expect(out).not.toContain('alice@mock-api.test.qwencloud.com');
    unmount();
  });
});

describe('<SupportViewInk /> truncation', () => {
  it('shows truncation message when truncated=true', () => {
    const vm = buildVM({ truncated: true });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('truncated');
    unmount();
  });

  it('does not show truncation message when truncated=false', () => {
    const vm = buildVM({ truncated: false });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toMatch(/older messages truncated/i);
    unmount();
  });
});

describe('<SupportViewInk /> different statuses', () => {
  it('renders "Closed" status', () => {
    const vm = buildVM({
      ticket: {
        ...buildVM().ticket,
        status: 'Closed',
      },
    });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Closed');
    unmount();
  });

  it('renders "Pending" status', () => {
    const vm = buildVM({
      ticket: {
        ...buildVM().ticket,
        status: 'Pending',
      },
    });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Pending');
    unmount();
  });
});

describe('<SupportViewInk /> edge cases', () => {
  it('handles empty description gracefully', () => {
    const vm = buildVM({
      ticket: {
        ...buildVM().ticket,
        description: '\u2014',
      },
    });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('\u2014');
    unmount();
  });

  it('handles message with empty content', () => {
    const vm = buildVM({
      messages: [{
        role: 'customer',
        displayRole: 'Customer',
        nickName: 'Alice',
        content: '',
        createdAt: '2025-01-15 10:00',
      }],
      messageCount: 1,
    });
    const { lastFrame, unmount } = render(<SupportViewInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    // Empty content should display as em-dash
    expect(out).toContain('\u2014');
    unmount();
  });
});

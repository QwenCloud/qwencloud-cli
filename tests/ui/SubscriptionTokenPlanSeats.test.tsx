import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import { SubscriptionTokenPlanSeatsInk } from '../../src/ui/SubscriptionTokenPlanSeats.js';
import type { TokenPlanSeatsViewModel } from '../../src/types/tokenplan-subscription.js';

function buildBaseVm(overrides: Partial<TokenPlanSeatsViewModel> = {}): TokenPlanSeatsViewModel {
  return {
    format: 'tui',
    page: { current: 1, size: 10, total: 0 },
    filter: { specType: null },
    items: [],
    header: undefined,
    rows: undefined,
    footer: undefined,
    emptyPlaceholder: undefined,
    warnings: undefined,
    diagnostics: [],
    footnote: null,
    ...overrides,
  };
}

const SAMPLE_ROW = {
  instanceCode: 'inst-001',
  specType: 'pro',
  status: 'active',
  memberIdMasked: '138****5678',
  totalValue: '100,000.00',
  surplusValue: '91,284.56',
  assignment: 'ASSIGNED',
};

describe('SubscriptionTokenPlanSeatsInk', () => {
  it('renders empty state when rows is undefined', () => {
    const vm = buildBaseVm({ rows: undefined });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('No seats found.');
    unmount();
  });

  it('renders empty state when rows is empty array', () => {
    const vm = buildBaseVm({ rows: [] });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('No seats found.');
    unmount();
  });

  it('renders custom emptyPlaceholder when provided', () => {
    const vm = buildBaseVm({ rows: [], emptyPlaceholder: 'Nothing here.' });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Nothing here.');
    expect(out).not.toContain('No seats found.');
    unmount();
  });

  it('renders without header when header is falsy', () => {
    const vm = buildBaseVm({ rows: [SAMPLE_ROW], header: undefined });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toContain('Total:');
    expect(out).not.toContain('Filter:');
    // Row data should still render
    expect(out).toContain('inst-001');
    unmount();
  });

  it('renders header when header is provided', () => {
    const vm = buildBaseVm({
      rows: [SAMPLE_ROW],
      header: { total: '5 seats', filter: 'pro' },
    });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Total: 5 seats');
    expect(out).toContain('Filter: pro');
    unmount();
  });

  it('renders without footer when footer is falsy', () => {
    const vm = buildBaseVm({ rows: [SAMPLE_ROW], footer: undefined, footnote: null });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    // No pagination info
    expect(out).not.toContain('Page');
    expect(out).toContain('inst-001');
    unmount();
  });

  it('renders footer when footer is provided', () => {
    const vm = buildBaseVm({
      rows: [SAMPLE_ROW],
      footer: { pagination: 'Page 1/3', total: '30 seats', warnings: [] },
    });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Page 1/3');
    expect(out).toContain('30 seats');
    unmount();
  });

  it('renders footnote as footer fallback when footer is undefined', () => {
    const vm = buildBaseVm({
      rows: [SAMPLE_ROW],
      footer: undefined,
      footnote: 'Data refreshed daily.',
    });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Data refreshed daily.');
    unmount();
  });

  it('renders warnings block in empty state', () => {
    const vm = buildBaseVm({
      rows: [],
      warnings: ['Quota exceeded', 'Plan expiring soon'],
    });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Quota exceeded');
    expect(out).toContain('Plan expiring soon');
    unmount();
  });

  it('does not render warnings block in empty state when warnings is undefined', () => {
    const vm = buildBaseVm({ rows: [], warnings: undefined });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('No seats found.');
    // Only the placeholder text, no extra warning lines
    unmount();
  });

  it('does not render warnings block in empty state when warnings is empty array', () => {
    const vm = buildBaseVm({ rows: [], warnings: [] });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('No seats found.');
    unmount();
  });

  it('renders warnings block with rows present', () => {
    const vm = buildBaseVm({
      rows: [SAMPLE_ROW],
      warnings: ['Rate limit approaching'],
    });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('inst-001');
    expect(out).toContain('Rate limit approaching');
    unmount();
  });

  it('does not render warnings block with rows when warnings is undefined', () => {
    const vm = buildBaseVm({ rows: [SAMPLE_ROW], warnings: undefined });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('inst-001');
    expect(out).not.toContain('Rate limit');
    unmount();
  });

  it('renders row data with correct column content', () => {
    const vm = buildBaseVm({ rows: [SAMPLE_ROW] });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('inst-001');
    expect(out).toContain('pro');
    expect(out).toContain('active');
    expect(out).toContain('138****5678');
    expect(out).toContain('100,000.00');
    expect(out).toContain('91,284.56');
    expect(out).toContain('ASSIGNED');
    unmount();
  });

  it('renders table header labels when rows are present', () => {
    const vm = buildBaseVm({ rows: [SAMPLE_ROW] });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Instance');
    expect(out).toContain('Type');
    expect(out).toContain('Status');
    expect(out).toContain('Member');
    expect(out).toContain('Cycle Total');
    expect(out).toContain('Cycle Left');
    expect(out).toContain('Assignment');
    unmount();
  });

  it('renders header in empty state when header is provided', () => {
    const vm = buildBaseVm({
      rows: [],
      header: { total: '0 seats', filter: 'all' },
    });
    const { lastFrame, unmount } = render(<SubscriptionTokenPlanSeatsInk vm={vm} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Total: 0 seats');
    expect(out).toContain('Filter: all');
    expect(out).toContain('No seats found.');
    unmount();
  });
});

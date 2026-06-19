/**
 * UI render tests for the SubscriptionTokenPlanStatus TUI component.
 *
 * Verifies: full-data table rendering, partial-failure degradation with
 * em-dash placeholders, diagnostics warning display, and correct
 * structure with missing sections.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { SubscriptionTokenPlanStatusInk } from '../../src/ui/SubscriptionTokenPlanStatus.js';
import { buildTokenPlanStatusViewModel } from '../../src/view-models/subscription/tokenplan-status.js';

// ────────────────────────────────────────────────────────────────────
// Type stubs
// ────────────────────────────────────────────────────────────────────

interface SeatGroup {
  specType: string;
  seats: number;
  assigned: number;
  totalValue: string;
  surplusValue: string;
  unit: string;
  nextCycleFlushTime: string;
}

interface TokenPlanStatusResult {
  product: string | null;
  period: { start: string; end: string; remainingDays: number } | null;
  autoRenew: { enabled: boolean; period: number; periodUnit: string } | null;
  renewable: { canRenew: boolean; interceptCode: string } | null;
  seatSummary: {
    groups: SeatGroup[];
    total: { seats: number; totalValue: string; surplusValue: string; unit: string };
  } | null;
  diagnostics: Array<{ api: string; errorCode: string; errorMessage: string }>;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function makeFullResult(): TokenPlanStatusResult {
  return {
    product: 'Token Plan Team Edition',
    period: {
      start: '2026-06-14T00:00:00+08:00',
      end: '2026-07-14T00:00:00+08:00',
      remainingDays: 41,
    },
    autoRenew: { enabled: true, period: 1, periodUnit: 'M' },
    renewable: { canRenew: false, interceptCode: 'PENDING_RENEWAL' },
    seatSummary: {
      groups: [
        {
          specType: 'standard',
          seats: 7,
          assigned: 7,
          totalValue: '175000',
          surplusValue: '174999.75',
          unit: 'Credits',
          nextCycleFlushTime: '2026-06-14T00:00:00+08:00',
        },
        {
          specType: 'pro',
          seats: 4,
          assigned: 4,
          totalValue: '400000',
          surplusValue: '391284.56',
          unit: 'Credits',
          nextCycleFlushTime: '2026-06-14T00:00:00+08:00',
        },
      ],
      total: { seats: 11, totalValue: '575000', surplusValue: '566284.3192002', unit: 'Credits' },
    },
    diagnostics: [],
  };
}

function makeDiag(api: string, msg = 'Service unavailable') {
  return { api, errorCode: 'ServiceError', errorMessage: msg };
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('SubscriptionTokenPlanStatus (rendered)', () => {
  it('renders product name and period information with full data', () => {
    const vm = buildTokenPlanStatusViewModel(makeFullResult(), 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out).toContain('Token Plan');
    expect(out).toContain('41');
  });

  it('renders seat type table with standard and pro rows', () => {
    const vm = buildTokenPlanStatusViewModel(makeFullResult(), 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    // Table should contain seat type identifiers
    expect(out.toLowerCase()).toContain('standard');
    expect(out.toLowerCase()).toContain('pro');
    // Seat counts should be visible
    expect(out).toContain('7');
    expect(out).toContain('4');
  });

  it('renders total row in footer', () => {
    const vm = buildTokenPlanStatusViewModel(makeFullResult(), 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out).toContain('11');
  });

  it('renders auto-renew status in header', () => {
    const vm = buildTokenPlanStatusViewModel(makeFullResult(), 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    // Auto-renew enabled should show as ON or similar
    expect(out.toLowerCase()).toMatch(/on|monthly|auto/);
  });

  it('renders renewable status with intercept code', () => {
    const vm = buildTokenPlanStatusViewModel(makeFullResult(), 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out).toContain('PENDING_RENEWAL');
  });

  it('renders em-dash for null autoRenew (partial failure)', () => {
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out).toContain('—');
  });

  it('renders em-dash for null renewable (partial failure)', () => {
    const result = makeFullResult();
    result.renewable = null;
    result.diagnostics = [makeDiag('CheckInstancesRenewable')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out).toContain('—');
  });

  it('omits seat table when seatSummary is null', () => {
    const result = makeFullResult();
    result.seatSummary = null;
    result.diagnostics = [makeDiag('GetSeatSubscriptionSummary')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    // Should not contain seat type rows (check for seat-specific patterns)
    expect(out.toLowerCase()).not.toMatch(/\bstandard\b.*\bseats?\b|\bseats?\b.*\bstandard\b/);
    expect(out.toLowerCase()).not.toMatch(/\bpro\b.*\bseats?\b|\bseats?\b.*\bpro\b/);
  });

  it('displays diagnostics warning when APIs partially fail', () => {
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal', 'BssOpenApi timeout')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    // Warning indicator should be present
    expect(out).toMatch(/⚠|warning|unavailable/i);
  });

  it('displays multiple diagnostics warnings', () => {
    const result = makeFullResult();
    result.autoRenew = null;
    result.renewable = null;
    result.diagnostics = [
      makeDiag('CheckTokenPlanAutoRenewal'),
      makeDiag('CheckInstancesRenewable'),
    ];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out).toMatch(/CheckTokenPlanAutoRenewal|CheckInstancesRenewable|2.*unavailable/i);
  });

  it('renders unavailable banner when all data is null', () => {
    const result: TokenPlanStatusResult = {
      product: null,
      period: null,
      autoRenew: null,
      renewable: null,
      seatSummary: null,
      diagnostics: [
        makeDiag('GetSeatSubscriptionSummary'),
        makeDiag('GetSubscriptionSummary'),
        makeDiag('CheckTokenPlanAutoRenewal'),
        makeDiag('CheckInstancesRenewable'),
      ],
    };
    const vm = buildTokenPlanStatusViewModel(result, 'tui');
    const out = frame(<SubscriptionTokenPlanStatusInk vm={vm} />);
    expect(out.toLowerCase()).toMatch(/unavailable|error|failed/i);
  });
});

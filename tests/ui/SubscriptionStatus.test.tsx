/**
 * UI render tests for the SubscriptionStatusInk card.
 *
 * Verifies: legacy flat fallback, partial-failure footnote, full-failure top
 * banner, em-dash placeholders, narrow-terminal quota fallback, and the new
 * multi-region dashboard sections (Token Plan / Credit Pack / Coding Plan /
 * Recent Orders).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { SubscriptionStatusInk } from '../../src/ui/SubscriptionStatus.js';
import { buildSubscriptionStatusViewModel } from '../../src/view-models/subscription/index.js';
import type {
  SubscriptionStatus,
  SubscriptionDiagnostic,
} from '../../src/types/subscription.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function makeStatus(overrides: Partial<SubscriptionStatus> = {}): SubscriptionStatus {
  return {
    isGray: false,
    plan: 'Token Plan Team (Monthly)',
    period: { start: '2099-04-01T00:00:00Z', end: '2099-04-30T23:59:59Z' },
    quota: { remaining: 750_000, total: 1_000_000, usedPct: 25 },
    autoRenew: true,
    renewable: true,
    remainingDays: null,
    seatTiers: [],
    creditPacks: [],
    codingPlanStatus: null,
    recentOrders: [],
    ...overrides,
  };
}

function diag(api: string): SubscriptionDiagnostic {
  return { api, errorCode: 'ServiceError', errorMessage: 'failed' };
}

describe('SubscriptionStatusInk (rendered)', () => {
  // ────────────────────────────────────────────────────────────────────
  // Legacy flat-fallback rendering — preserved when no new sections exist
  // ────────────────────────────────────────────────────────────────────

  it('renders the plan name and a graphical quota bar on wide terminals', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], ctx);
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toContain('Token Plan');
    expect(out.length).toBeGreaterThan(50);
  });

  it('shows a bottom-line note for partial degradation', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus(),
      [diag('CheckTokenPlanAutoRenewal'), diag('CheckInstancesRenewable')],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toMatch(/2\s+source\(s\)\s+unavailable|--format json/i);
  });

  it('shows a top banner when data is null (full failure)', () => {
    const vm = buildSubscriptionStatusViewModel(
      null,
      Array.from({ length: 6 }, (_, i) => diag(`api-${i}`)),
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out.toLowerCase()).toMatch(/subscription\s+data\s+unavailable|unavailable/i);
  });

  it('renders em-dash for null fields', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ autoRenew: null, renewable: null }),
      [diag('CheckTokenPlanAutoRenewal'), diag('CheckInstancesRenewable')],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toContain('—');
  });

  it('falls back to a percentage placeholder on narrow terminals', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], { ...ctx, columns: 60 });
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toMatch(/\[\d+(\.\d+)?%\]/);
  });

  it('does not render quota numbers when quota is null', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ quota: null }),
      [diag('DescribeFrInstances')],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).not.toContain('750,000');
    expect(out).not.toContain('1,000,000');
  });

  it('falls back to flat layout when every multi-region section is null', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], ctx);
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    // Flat fallback prints the legacy field labels rather than the dashboard dividers.
    expect(out).toContain('Plan');
    expect(out).toContain('Auto-Renew');
    expect(out).not.toContain('═══ Token Plan');
    expect(out).not.toContain('═══ Credit Pack');
  });

  // ────────────────────────────────────────────────────────────────────
  // Multi-region dashboard rendering
  // ────────────────────────────────────────────────────────────────────

  it('renders the Token Plan section with a divider and per-tier progress bar', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({
        remainingDays: 7,
        seatTiers: [
          {
            specType: 'pro',
            seats: 3,
            totalCredits: 1_000_000,
            remainingCredits: 600_000,
            usedPct: 40,
            nextCycleFlushTime: null,
          },
        ],
      }),
      [],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toMatch(/═══\s+Token Plan/);
    expect(out).toContain('Pro (3 seats)');
    expect(out).toMatch(/600,000\s*\/\s*1,000,000/);
    expect(out).toContain('60%');
  });

  it('renders the Credit Pack section header and pack rows', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({
        creditPacks: [
          {
            instanceId: 'fr-001',
            totalCredits: 1_000_000,
            remainingCredits: 250_000,
            expiresAt: '2099-12-31T00:00:00Z',
          },
        ],
      }),
      [],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toMatch(/═══\s+Credit Pack/);
    expect(out).toContain('fr-001');
    expect(out).toContain('250,000');
    expect(out).toContain('2099-12-31');
  });

  it('renders the Coding Plan section when codingPlanSection is present', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ codingPlanStatus: 'NORMAL' }),
      [],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toMatch(/═══\s+Coding Plan/);
    expect(out).toContain('NORMAL');
  });

  it('renders the Recent Orders section with order rows', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({
        recentOrders: [
          {
            orderId: 'ord-101',
            orderType: 'purchase',
            orderTime: '2026-04-15T10:00:00Z',
            amount: '199.00',
            status: 'PAID',
          },
          {
            orderId: 'ord-102',
            orderType: 'renew',
            orderTime: '2026-04-20T08:30:00Z',
            amount: '99.00',
            status: 'UNPAID',
          },
        ],
      }),
      [],
      ctx,
    );
    const out = frame(<SubscriptionStatusInk vm={vm} />);
    expect(out).toMatch(/═══\s+Recent Orders/);
    expect(out).toContain('ord-101');
    expect(out).toContain('Purchase');
    expect(out).toContain('2026-04-15');
    expect(out).toContain('199.00');
  });
});

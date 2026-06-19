/** View-model unit tests for the subscription status card. */
import { describe, it, expect } from 'vitest';
import { buildSubscriptionStatusViewModel } from '../../../src/view-models/subscription/index.js';
import type {
  SubscriptionStatus,
  SubscriptionDiagnostic,
} from '../../../src/types/subscription.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

// Future-dated default period so isPeriodActive() inside the view-model
// resolves to `Active` regardless of when the test runs.
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

function diag(api: string, errorMessage = 'failed'): SubscriptionDiagnostic {
  return { api, errorCode: 'ServiceError', errorMessage };
}

describe('buildSubscriptionStatusViewModel', () => {
  it('renders all sections without degradation when data is complete', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], ctx);
    expect(vm.banner).toBeNull();
    expect(vm.footnote).toBeNull();
    expect(vm.sections.length).toBeGreaterThan(0);
  });

  it('shows a bottom-line note when 1-5 diagnostics are present', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus(),
      [diag('QuerySubscriptionGray'), diag('CheckTokenPlanAutoRenewal')],
      ctx,
    );
    expect(vm.footnote).toMatch(/2 source\(s\) unavailable/);
  });

  it('shows a red top banner when data is null (full failure)', () => {
    const vm = buildSubscriptionStatusViewModel(
      null,
      Array.from({ length: 6 }, (_, i) => diag(`api-${i}`)),
      ctx,
    );
    expect(vm.banner).toMatch(/subscription data unavailable/i);
  });

  it('renders em-dash for null fields under partial degradation', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ autoRenew: null }),
      [diag('CheckTokenPlanAutoRenewal')],
      ctx,
    );
    const autoRenewField = vm.fields.find((f) => f.label.toLowerCase().includes('renew'));
    expect(autoRenewField?.value).toBe('—');
  });

  it('replaces the quota bar with a percentage placeholder on narrow terminals', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], { ...ctx, columns: 60 });
    expect(vm.quotaBar).toMatch(/\[\d+(\.\d+)?%\]/);
  });

  it('renders a graphical quota bar on wide terminals', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], { ...ctx, columns: 120 });
    expect(vm.quotaBar.length).toBeGreaterThan(10);
  });

  it('replaces the quota section with a placeholder when quota is null', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ quota: null }),
      [diag('DescribeFrInstances')],
      ctx,
    );
    const quotaSection = vm.sections.find((s) => s.id === 'quota');
    expect(quotaSection?.placeholder).toMatch(/unavailable|—/i);
  });

  it('lists all diagnostic entries verbatim for transparency', () => {
    const diagnostics = [
      diag('QuerySubscriptionGray', 'GrayService.Timeout'),
      diag('DescribeFrInstances', 'Quota service unavailable'),
    ];
    const vm = buildSubscriptionStatusViewModel(makeStatus(), diagnostics, ctx);
    expect(vm.diagnostics).toHaveLength(2);
    expect(vm.diagnostics[0].api).toBe('QuerySubscriptionGray');
  });

  it('keeps the footnote concise (no per-API verbatim error in non-JSON output)', () => {
    const diagnostics = [diag('QuerySubscriptionGray', 'long verbose error message')];
    const vm = buildSubscriptionStatusViewModel(makeStatus(), diagnostics, ctx);
    expect(vm.footnote).not.toContain('long verbose error message');
  });

  // ──────────────────────────────────────────────────────────────────
  // Multi-region dashboard: per-section construction
  // ──────────────────────────────────────────────────────────────────

  it('builds tokenPlanSection with per-tier progress bars when seatTiers is populated', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({
        remainingDays: 12,
        seatTiers: [
          {
            specType: 'pro',
            seats: 3,
            totalCredits: 1_000_000,
            remainingCredits: 600_000,
            usedPct: 40,
            nextCycleFlushTime: null,
          },
          {
            specType: 'standard',
            seats: 1,
            totalCredits: 500_000,
            remainingCredits: 500_000,
            usedPct: 0,
            nextCycleFlushTime: null,
          },
        ],
      }),
      [],
      ctx,
    );
    expect(vm.tokenPlanSection).not.toBeNull();
    expect(vm.tokenPlanSection?.status).toBe('Active');
    expect(vm.tokenPlanSection?.autoRenew).toBe('On');
    expect(vm.tokenPlanSection?.expires).toMatch(/12d/);
    expect(vm.tokenPlanSection?.tiers).toHaveLength(2);
    expect(vm.tokenPlanSection?.tiers[0].label).toBe('Pro (3 seats)');
    expect(vm.tokenPlanSection?.tiers[0].bar).toMatch(/600,000\s*\/\s*1,000,000/);
    expect(vm.tokenPlanSection?.tiers[0].bar).toMatch(/60%/);
    expect(vm.tokenPlanSection?.tiers[1].label).toBe('Standard (1 seat)');
  });

  it('builds creditPackSection with count, totalRemaining, and pack list', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({
        creditPacks: [
          {
            instanceId: 'fr-001',
            totalCredits: 1_000_000,
            remainingCredits: 250_000,
            expiresAt: '2099-12-31T00:00:00Z',
          },
          {
            instanceId: 'fr-002',
            totalCredits: 500_000,
            remainingCredits: 500_000,
            expiresAt: null,
          },
        ],
      }),
      [],
      ctx,
    );
    expect(vm.creditPackSection).not.toBeNull();
    expect(vm.creditPackSection?.count).toBe(2);
    expect(vm.creditPackSection?.totalRemaining).toMatch(/750,000/);
    expect(vm.creditPackSection?.packs).toHaveLength(2);
    expect(vm.creditPackSection?.packs[0].id).toBe('fr-001');
    expect(vm.creditPackSection?.packs[0].remaining).toMatch(/250,000\s*\/\s*1,000,000/);
    expect(vm.creditPackSection?.packs[0].bar).toMatch(/25%/);
    expect(vm.creditPackSection?.packs[0].expires).toBe('2099-12-31');
    expect(vm.creditPackSection?.packs[1].bar).toMatch(/100%/);
    expect(vm.creditPackSection?.packs[1].expires).toBe('—');
  });

  it('builds codingPlanSection when codingPlanStatus is non-null', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ codingPlanStatus: 'NORMAL' }),
      [],
      ctx,
    );
    expect(vm.codingPlanSection).not.toBeNull();
    expect(vm.codingPlanSection?.status).toBe('NORMAL');
    expect(vm.codingPlanSection?.credits).toMatch(/750,000\s*\/\s*1,000,000/);
  });

  it('renders coding plan credits placeholder when quota is null', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({ codingPlanStatus: 'NORMAL', quota: null }),
      [],
      ctx,
    );
    expect(vm.codingPlanSection?.credits).toBe('—');
  });

  it('builds recentOrdersSection with formatted entries', () => {
    const vm = buildSubscriptionStatusViewModel(
      makeStatus({
        recentOrders: [
          {
            orderId: 'ord-001',
            orderType: 'purchase',
            orderTime: '2026-04-15T10:00:00Z',
            amount: '199.00',
            status: 'PAID',
          },
          {
            orderId: 'ord-002',
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
    expect(vm.recentOrdersSection).not.toBeNull();
    expect(vm.recentOrdersSection?.orders).toHaveLength(2);
    expect(vm.recentOrdersSection?.orders[0].id).toBe('ord-001');
    expect(vm.recentOrdersSection?.orders[0].type).toBe('purchase');
    expect(vm.recentOrdersSection?.orders[0].typeLabel).toBe('Purchase');
    expect(vm.recentOrdersSection?.orders[0].date).toBe('2026-04-15');
    expect(vm.recentOrdersSection?.orders[0].amount).toContain('199.00');
    expect(vm.recentOrdersSection?.orders[0].statusLabel).toBe('Paid');
    expect(vm.recentOrdersSection?.orders[0].statusColor).toBe('green');
    expect(vm.recentOrdersSection?.orders[1].typeLabel).toBe('Renew');
    expect(vm.recentOrdersSection?.orders[1].statusLabel).toBe('Unpaid');
    expect(vm.recentOrdersSection?.orders[1].statusColor).toBe('orange');
  });

  it('returns null for every multi-region section when only legacy fields are populated', () => {
    const vm = buildSubscriptionStatusViewModel(makeStatus(), [], ctx);
    expect(vm.tokenPlanSection).toBeNull();
    expect(vm.creditPackSection).toBeNull();
    expect(vm.codingPlanSection).toBeNull();
    expect(vm.recentOrdersSection).toBeNull();
    // Legacy flat fields remain populated for downstream fallback rendering.
    expect(vm.fields.some((f) => f.label === 'Plan')).toBe(true);
    expect(vm.quota).not.toBeNull();
    expect(vm.quotaBar).not.toBeNull();
  });
});

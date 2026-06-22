import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderTextSubscriptionStatus,
  renderTextSubscriptionOrders,
} from '../../../src/output/text/subscription.js';
import type {
  SubscriptionStatusViewModel,
  SubscriptionOrdersViewModel,
  SubscriptionOrdersColumn,
  SubscriptionOrderRowViewModel,
  TokenPlanSectionViewModel,
  CreditPackSectionViewModel,
  CodingPlanSectionViewModel,
  RecentOrdersSectionViewModel,
} from '../../../src/view-models/subscription/index.js';
import type { SubscriptionDiagnostic } from '../../../src/types/subscription.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function makeBaseStatusVm(
  overrides: Partial<SubscriptionStatusViewModel> = {},
): SubscriptionStatusViewModel {
  return {
    available: true,
    banner: null,
    footnote: null,
    fields: [
      { label: 'Plan', value: 'Pro' },
      { label: 'Period', value: '2025-01 → 2025-12' },
    ],
    sections: [],
    quota: null,
    quotaBar: null,
    diagnostics: [],
    tokenPlanSection: null,
    creditPackSection: null,
    codingPlanSection: null,
    recentOrdersSection: null,
    errorBanner: null,
    notice: null,
    ...overrides,
  };
}

describe('renderTextSubscriptionStatus', () => {
  it('prints banner and returns early when banner is set', () => {
    const vm = makeBaseStatusVm({ banner: 'Service unavailable' });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Service unavailable'))).toBe(true);
  });

  it('prints diagnostics when banner is set and diagnostics exist', () => {
    const diag: SubscriptionDiagnostic[] = [
      { api: '/status', errorCode: '500', errorMessage: 'Internal error' },
    ];
    const vm = makeBaseStatusVm({ banner: 'Error occurred', diagnostics: diag });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('/status'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Internal error'))).toBe(true);
  });

  it('prints fields in legacy format when no new sections exist', () => {
    const vm = makeBaseStatusVm();
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Plan'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Pro'))).toBe(true);
  });

  it('prints quota bar when quota is present in legacy mode', () => {
    const vm = makeBaseStatusVm({
      quota: { total: 1000, remaining: 500, usedPct: 50, bar: '████░░░░', display: '500 / 1,000 (50%)' },
    });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Quota'))).toBe(true);
    expect(calls.some((c: string) => c.includes('500 / 1,000'))).toBe(true);
  });

  it('prints footnote in legacy mode', () => {
    const vm = makeBaseStatusVm({ footnote: '1 partial failure' });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('1 partial failure'))).toBe(true);
  });

  it('renders token plan section', () => {
    const tokenPlan: TokenPlanSectionViewModel = {
      status: 'Active',
      autoRenew: 'On',
      expires: '2025-12-31 (180d)',
      tiers: [
        { label: 'Standard (2 seats)', bar: '████ 5,000 / 10,000', remaining: 5000, total: 10000, usedPct: 50 },
      ],
    };
    const vm = makeBaseStatusVm({ tokenPlanSection: tokenPlan });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Token Plan'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Active'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Standard (2 seats)'))).toBe(true);
  });

  it('renders credit pack section', () => {
    const creditPack: CreditPackSectionViewModel = {
      count: 2,
      totalRemaining: '3,000 credits',
      packs: [
        { id: 'pack-001', remaining: '2,000 / 5,000', bar: '████', expires: '2025-06-30' },
        { id: 'pack-002', remaining: '1,000 / 3,000', bar: '██', expires: '2025-08-15' },
      ],
    };
    const vm = makeBaseStatusVm({ creditPackSection: creditPack });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Credit Pack'))).toBe(true);
    expect(calls.some((c: string) => c.includes('2 packs'))).toBe(true);
    expect(calls.some((c: string) => c.includes('pack-001'))).toBe(true);
  });

  it('renders single credit pack with singular noun', () => {
    const creditPack: CreditPackSectionViewModel = {
      count: 1,
      totalRemaining: '1,000 credits',
      packs: [{ id: 'pack-001', remaining: '1,000 / 2,000', bar: '████', expires: '2025-06-30' }],
    };
    const vm = makeBaseStatusVm({ creditPackSection: creditPack });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('1 pack'))).toBe(true);
    expect(calls.every((c: string) => !c.includes('1 packs'))).toBe(true);
  });

  it('renders coding plan section', () => {
    const codingPlan: CodingPlanSectionViewModel = { status: 'Active', credits: '800 / 1,000' };
    const vm = makeBaseStatusVm({ codingPlanSection: codingPlan });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Coding Plan'))).toBe(true);
    expect(calls.some((c: string) => c.includes('800 / 1,000'))).toBe(true);
  });

  it('renders recent orders section', () => {
    const orders: RecentOrdersSectionViewModel = {
      orders: [
        { id: 'ORD-001', type: 'BUY', typeLabel: 'Purchase', date: '2025-03-01', amount: '¥100.00', statusLabel: 'Paid', statusColor: 'green' },
        { id: 'ORD-002', type: 'RENEW', typeLabel: 'Renew', date: '2025-04-01', amount: '¥50.00', statusLabel: 'Paid', statusColor: 'green' },
      ],
    };
    const vm = makeBaseStatusVm({ recentOrdersSection: orders });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Recent Orders'))).toBe(true);
    expect(calls.some((c: string) => c.includes('ORD-001'))).toBe(true);
  });

  it('prints footnote in new sections mode', () => {
    const tokenPlan: TokenPlanSectionViewModel = {
      status: 'Active',
      autoRenew: 'On',
      expires: '2025-12-31',
      tiers: [],
    };
    const vm = makeBaseStatusVm({ tokenPlanSection: tokenPlan, footnote: 'Note: partial data' });
    renderTextSubscriptionStatus(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Note: partial data'))).toBe(true);
  });
});

describe('renderTextSubscriptionOrders', () => {
  function makeOrdersVm(overrides: Partial<SubscriptionOrdersViewModel> = {}): SubscriptionOrdersViewModel {
    const columns: SubscriptionOrdersColumn[] = [
      { key: 'orderId', header: 'Order ID' },
      { key: 'orderTypeLabel', header: 'Type' },
      { key: 'orderTime', header: 'Time' },
      { key: 'amountDisplay', header: 'Amount' },
      { key: 'statusLabel', header: 'Status' },
    ];
    return {
      items: [],
      columns,
      pagination: { page: 1, pageSize: 10, total: 0 },
      diagnostics: [],
      isEmpty: true,
      emptyPlaceholder: 'No orders',
      pagingNote: 'No orders',
      summaryLine: 'No orders',
      page: 1,
      pageSize: 10,
      totalCount: 0,
      ...overrides,
    };
  }

  it('prints empty placeholder when isEmpty is true', () => {
    const vm = makeOrdersVm();
    renderTextSubscriptionOrders(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('No orders'))).toBe(true);
  });

  it('renders a table with order rows', () => {
    const row: SubscriptionOrderRowViewModel = {
      orderId: 'ORD-100',
      orderType: 'purchase',
      orderTypeLabel: 'Purchase',
      orderTime: '2025-03-15',
      amountDisplay: '¥200.00',
      amountRaw: '200.00',
      amount: '¥200.00',
      currency: 'CNY',
      status: 'PAID',
      statusLabel: 'Paid',
      statusColor: 'green',
      detailError: null,
    };
    const vm = makeOrdersVm({
      items: [row],
      isEmpty: false,
      pagingNote: 'Page 1 • Showing 1–1 of 1',
    });
    renderTextSubscriptionOrders(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('ORD-100'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Page 1'))).toBe(true);
  });

  it('shows detail error suffix when detailError is set', () => {
    const row: SubscriptionOrderRowViewModel = {
      orderId: 'ORD-200',
      orderType: 'renew',
      orderTypeLabel: 'Renew',
      orderTime: '2025-04-10',
      amountDisplay: '¥300.00',
      amountRaw: '300.00',
      amount: '¥300.00',
      currency: 'CNY',
      status: 'COMPLETED',
      statusLabel: 'Completed',
      statusColor: 'gray',
      detailError: 'timeout',
    };
    const vm = makeOrdersVm({
      items: [row],
      isEmpty: false,
      pagingNote: 'Page 1 • Showing 1–1 of 1',
    });
    renderTextSubscriptionOrders(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('detail err'))).toBe(true);
  });

  it('shows diagnostics count when diagnostics are present', () => {
    const row: SubscriptionOrderRowViewModel = {
      orderId: 'ORD-300',
      orderType: 'purchase',
      orderTypeLabel: 'Purchase',
      orderTime: '2025-05-01',
      amountDisplay: '¥100.00',
      amountRaw: '100.00',
      amount: '¥100.00',
      currency: 'CNY',
      status: 'PAID',
      statusLabel: 'Paid',
      statusColor: 'green',
      detailError: null,
    };
    const diag: SubscriptionDiagnostic[] = [
      { api: '/orders/detail', errorCode: '503', errorMessage: 'unavailable' },
    ];
    const vm = makeOrdersVm({
      items: [row],
      isEmpty: false,
      pagingNote: 'Page 1',
      diagnostics: diag,
    });
    renderTextSubscriptionOrders(vm);
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('1 detail call(s) failed'))).toBe(true);
  });
});

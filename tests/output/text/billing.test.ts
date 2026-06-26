import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderTextBillingLimit,
  renderTextBillingBreakdown,
  renderTextBillingSummary,
} from '../../../src/output/text/billing.js';
import type {
  BillingLimitViewModel,
  BillingLimitFieldViewModel,
  BillingBreakdownViewModel,
  BillingBreakdownRowViewModel,
  BillingBreakdownColumn,
  BillingSummaryViewModel,
  BillingSummaryFieldViewModel,
} from '../../../src/view-models/billing/index.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('renderTextBillingLimit', () => {
  function makeVm(overrides: Partial<BillingLimitViewModel> = {}): BillingLimitViewModel {
    const fields: BillingLimitFieldViewModel[] = [
      { label: 'Status', value: 'Active' },
      { label: 'Limit', value: '$1,000.00' },
      { label: 'Alert threshold', value: '80%' },
    ];
    return {
      fields,
      currency: 'USD',
      statusRaw: 'normal',
      ...overrides,
    };
  }

  it('renders all field labels and values', () => {
    renderTextBillingLimit(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Status') && c.includes('Active'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Limit') && c.includes('$1,000.00'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Alert threshold') && c.includes('80%'))).toBe(true);
  });

  it('renders currency line', () => {
    renderTextBillingLimit(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Currency') && c.includes('USD'))).toBe(true);
  });

  it('renders with different currency', () => {
    renderTextBillingLimit(makeVm({ currency: 'CNY' }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('CNY'))).toBe(true);
  });
});

describe('renderTextBillingBreakdown', () => {
  function makeVm(overrides: Partial<BillingBreakdownViewModel> = {}): BillingBreakdownViewModel {
    const columns: BillingBreakdownColumn[] = [
      { key: 'label', header: 'Model' },
      { key: 'amount', header: 'Amount' },
    ];
    const rows: BillingBreakdownRowViewModel[] = [
      {
        cells: { key: 'qwen-max', label: 'Qwen Max', amount: '$12.50' },
        raw: { amount: '12.50' },
      },
    ];
    return {
      groupBy: 'model',
      period: '2025-03-01 → 2025-03-31',
      chargeType: 'postpay',
      columns,
      items: rows,
      total: { amount: '12.50', raw: '12.50', display: '$12.50' },
      currency: 'USD',
      shown: 1,
      totalRows: 1,
      truncationNotice: null,
      ...overrides,
    };
  }

  it('renders period and charge type', () => {
    renderTextBillingBreakdown(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Period') && c.includes('2025-03-01'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Charge Type') && c.includes('postpay'))).toBe(true);
  });

  it('renders table with row data', () => {
    renderTextBillingBreakdown(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Qwen Max'))).toBe(true);
    expect(calls.some((c: string) => c.includes('$12.50'))).toBe(true);
  });

  it('renders TOTAL row', () => {
    renderTextBillingBreakdown(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('TOTAL'))).toBe(true);
  });

  it('renders truncation notice when present', () => {
    renderTextBillingBreakdown(makeVm({ truncationNotice: 'Showing top 10 / 50' }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Showing top 10 / 50'))).toBe(true);
  });

  it('does not render truncation notice when null', () => {
    renderTextBillingBreakdown(makeVm({ truncationNotice: null }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.every((c: string) => !c.includes('Showing top'))).toBe(true);
  });
});

describe('renderTextBillingSummary', () => {
  function makeVm(overrides: Partial<BillingSummaryViewModel> = {}): BillingSummaryViewModel {
    const fields: BillingSummaryFieldViewModel[] = [
      { label: 'Spend before tax', value: '$100.00', raw: '100.00' },
      { label: 'Tax', value: '$10.00', raw: '10.00' },
      { label: 'Total', value: '$110.00', raw: '110.00' },
    ];
    return {
      cycle: '2025-03',
      chargeType: 'postpay',
      currency: 'USD',
      cycles: [],
      totals: {
        pretaxAmount: '100.00',
        tax: '10.00',
        aftertaxAmount: '110.00',
      },
      fields,
      ...overrides,
    };
  }

  it('renders cycle and currency', () => {
    renderTextBillingSummary(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Cycle') && c.includes('2025-03'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Currency') && c.includes('USD'))).toBe(true);
  });

  it('renders charge type when defined', () => {
    renderTextBillingSummary(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Charge Type') && c.includes('postpay'))).toBe(true);
  });

  it('does not render charge type when undefined', () => {
    renderTextBillingSummary(makeVm({ chargeType: undefined }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.every((c: string) => !c.includes('Charge Type'))).toBe(true);
  });

  it('renders fields', () => {
    renderTextBillingSummary(makeVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Spend before tax'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Tax'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Total') && c.includes('$110.00'))).toBe(true);
  });
});

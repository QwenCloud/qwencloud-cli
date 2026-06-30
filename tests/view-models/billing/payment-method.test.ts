/**
 * View-model unit tests for the billing payment-method list.
 *
 * Pure function tests — no external dependencies, no mocking.
 * Validates: CardBrand merge, Status color mapping, VALID-only filtering.
 */
import { describe, it, expect } from 'vitest';
import { buildPaymentMethodListViewModel } from '../../../src/view-models/billing/payment-method.js';
import type { PaymentMethodsResult } from '../../../src/types/payment-method.js';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeResult(overrides: Partial<PaymentMethodsResult> = {}): PaymentMethodsResult {
  return {
    items: [
      {
        paymentTypeName: 'Credit Card',
        cardBrand: 'CREDIT',
        paymentMethodName: '000000******0001',
        status: 'VALID',
      },
      {
        paymentTypeName: 'Credit Card',
        cardBrand: 'DEBIT',
        paymentMethodName: '000000******0002',
        status: 'EXPIRED',
      },
    ],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CardBrand merge
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPaymentMethodListViewModel — CardBrand merge', () => {
  it('merges CardBrand into type as "PaymentTypeName (CardBrand)"', () => {
    const vm = buildPaymentMethodListViewModel(makeResult({
      items: [
        { paymentTypeName: 'Credit Card', cardBrand: 'CREDIT', paymentMethodName: '****0011', status: 'VALID' },
        { paymentTypeName: 'Credit Card', cardBrand: 'DEBIT', paymentMethodName: '****0022', status: 'VALID' },
      ],
    }));
    expect(vm.rows[0].type).toBe('Credit Card (CREDIT)');
    expect(vm.rows[1].type).toBe('Credit Card (DEBIT)');
  });

  it('uses only PaymentTypeName when CardBrand is undefined', () => {
    const vm = buildPaymentMethodListViewModel(
      makeResult({
        items: [
          {
            paymentTypeName: 'PayTestType',
            paymentMethodName: 'user@mock-api.test.qwencloud.com',
            status: 'VALID',
          },
        ],
      }),
    );
    expect(vm.rows[0].type).toBe('PayTestType');
  });

  it('uses only PaymentTypeName when CardBrand is empty string', () => {
    const vm = buildPaymentMethodListViewModel(
      makeResult({
        items: [
          {
            paymentTypeName: 'Debit Card',
            cardBrand: '',
            paymentMethodName: '0000********0003',
            status: 'VALID',
          },
        ],
      }),
    );
    expect(vm.rows[0].type).toBe('Debit Card');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status color mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPaymentMethodListViewModel — Status color mapping', () => {
  it('maps VALID to green', () => {
    const vm = buildPaymentMethodListViewModel(
      makeResult({
        items: [
          { paymentTypeName: 'Credit Card', cardBrand: 'CREDIT', paymentMethodName: '****0011', status: 'VALID' },
        ],
      }),
    );
    expect(vm.rows[0].statusColor).toBe('green');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VALID-only filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPaymentMethodListViewModel — VALID-only filtering', () => {
  it('filters out non-VALID items', () => {
    const vm = buildPaymentMethodListViewModel(makeResult());
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].status).toBe('VALID');
  });

  it('returns empty rows when no items are VALID', () => {
    const vm = buildPaymentMethodListViewModel(
      makeResult({
        items: [
          { paymentTypeName: 'Credit Card', cardBrand: 'CREDIT', paymentMethodName: '****0033', status: 'EXPIRED' },
          { paymentTypeName: 'Credit Card', cardBrand: 'DEBIT', paymentMethodName: '****0044', status: 'INVALID' },
        ],
      }),
    );
    expect(vm.rows).toEqual([]);
  });

  it('keeps all items when all are VALID', () => {
    const vm = buildPaymentMethodListViewModel(
      makeResult({
        items: [
          { paymentTypeName: 'Credit Card', cardBrand: 'CREDIT', paymentMethodName: '****0011', status: 'VALID' },
          { paymentTypeName: 'PayTestType', paymentMethodName: 'user@mock-api.test.qwencloud.com', status: 'VALID' },
        ],
      }),
    );
    expect(vm.rows).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Row field preservation
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPaymentMethodListViewModel — row fields', () => {
  it('preserves the masked card number in the number field', () => {
    const vm = buildPaymentMethodListViewModel(makeResult({
      items: [
        { paymentTypeName: 'Credit Card', cardBrand: 'CREDIT', paymentMethodName: '000000******0001', status: 'VALID' },
      ],
    }));
    expect(vm.rows[0].number).toBe('000000******0001');
  });

  it('handles empty items array', () => {
    const vm = buildPaymentMethodListViewModel(makeResult({ items: [] }));
    expect(vm.rows).toEqual([]);
  });
});

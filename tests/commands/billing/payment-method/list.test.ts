/**
 * Command-level tests for `billing payment-method list`.
 *
 * Validates: JSON/TEXT output for normal data, empty state, VALID-only filtering,
 * CardBrand merging, static table output, and authentication requirement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../../helpers/run-command.js';

// ─── Service holder ──────────────────────────────────────────────────────────

interface MockBillingService {
  getUsageLimit: ReturnType<typeof vi.fn>;
  getConsumeBreakdown: ReturnType<typeof vi.fn>;
  getCostAnalysis: ReturnType<typeof vi.fn>;
  getSettleBillSummary: ReturnType<typeof vi.fn>;
  getOuterPaymentMethods: ReturnType<typeof vi.fn>;
}

const holder: { billingService: MockBillingService } = {
  billingService: {
    getUsageLimit: vi.fn(),
    getConsumeBreakdown: vi.fn(),
    getCostAnalysis: vi.fn(),
    getSettleBillSummary: vi.fn(),
    getOuterPaymentMethods: vi.fn(),
  },
};

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/services/index.js', () => ({
  createServices: () => ({
    billingService: holder.billingService,
    subscriptionService: { getStatus: vi.fn(), listOrders: vi.fn() },
    apiClient: {},
    authClient: {},
    cache: {},
    freetierService: {},
    codingplanService: {},
    tokenplanService: {},
    modelsService: {},
    usageService: {},
    authService: {},
  }),
}));

const ensureAuthenticatedMock = vi.fn().mockReturnValue({});

vi.mock('../../../../src/auth/credentials.js', () => ({
  ensureAuthenticated: (...args: unknown[]) => ensureAuthenticatedMock(...args),
}));
vi.mock('../../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderInteractive: vi.fn(),
  renderWithInkSync: vi.fn(),
}));

const { billingPaymentMethodListAction } = await import(
  '../../../../src/commands/billing/payment-method/list.js'
);
const { createClient } = await import('../../../../src/api/client.js');

const getClient = () => createClient();

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TWO_VALID_METHODS_RESULT = {
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
      status: 'VALID',
    },
  ],
};

const MIXED_STATUS_RESULT = {
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
    {
      paymentTypeName: 'PayTestType',
      paymentMethodName: 'user@mock-api.test.qwencloud.com',
      status: 'INVALID',
    },
  ],
};

const EMPTY_RESULT = {
  items: [],
};

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.values(holder.billingService).forEach((m) => m.mockReset());
  ensureAuthenticatedMock.mockReset().mockReturnValue({});
});

function buildList(program: import('commander').Command) {
  const billing = program.command('billing');
  const paymentMethod = billing.command('payment-method');
  const list = paymentMethod.command('list');
  list.action(billingPaymentMethodListAction(list, getClient));
}

// ─────────────────────────────────────────────────────────────────────────────
// Normal data (2 VALID payment methods)
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — normal data', () => {
  beforeEach(() => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(TWO_VALID_METHODS_RESULT);
  });

  it('JSON format: outputs items array with all items', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.items).toHaveLength(2);
  });

  it('JSON format: each item contains paymentTypeName, cardBrand, paymentMethodName, status', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload.items[0]).toMatchObject({
      paymentTypeName: 'Credit Card',
      cardBrand: 'CREDIT',
      paymentMethodName: '000000******0001',
      status: 'VALID',
    });
  });

  it('TEXT format: outputs Type column with CardBrand merged', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('Credit Card (CREDIT)');
    expect(r.stdout).toContain('000000******0001');
    expect(r.stdout).toContain('VALID');
  });

  it('TEXT format: outputs total count in footer', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.stdout).toMatch(/TOTAL:\s*2/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VALID-only filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — VALID status filtering', () => {
  beforeEach(() => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(MIXED_STATUS_RESULT);
  });

  it('TEXT format: only shows VALID payment methods', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.stdout).toContain('Credit Card (CREDIT)');
    expect(r.stdout).not.toContain('Credit Card (DEBIT)');
    expect(r.stdout).not.toContain('PayTestType');
  });

  it('TEXT format: total count reflects only VALID items', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.stdout).toMatch(/TOTAL:\s*1/i);
  });

  it('JSON format: only includes VALID payment methods', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].status).toBe('VALID');
    expect(payload.items[0].paymentMethodName).toBe('000000******0001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — empty state', () => {
  beforeEach(() => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(EMPTY_RESULT);
  });

  it('TEXT format: shows empty state prompt', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('No payment methods found');
  });

  it('JSON format: outputs items=[]', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload).toMatchObject({ items: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CardBrand merge display
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — CardBrand merge', () => {
  it('TEXT: merges CardBrand into Type as "PaymentTypeName (CardBrand)"', async () => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(TWO_VALID_METHODS_RESULT);
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.stdout).toContain('Credit Card (CREDIT)');
    expect(r.stdout).toContain('Credit Card (DEBIT)');
  });

  it('TEXT: shows only PaymentTypeName when CardBrand is absent', async () => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue({
      items: [
        {
          paymentTypeName: 'PayTestType',
          paymentMethodName: 'user@mock-api.test.qwencloud.com',
          status: 'VALID',
        },
      ],
    });
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'text',
    ]);
    expect(r.stdout).toContain('PayTestType');
    expect(r.stdout).not.toContain('PayTestType (');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Table format (Ink rendering)
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — table format (Ink)', () => {
  beforeEach(() => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(TWO_VALID_METHODS_RESULT);
  });

  it('TABLE format: calls renderWithInk for styled output', async () => {
    const { renderWithInk } = await import('../../../../src/ui/render.js');
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'table',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(renderWithInk).toHaveBeenCalled();
  });

  it('TABLE format: does not produce console output', async () => {
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'table',
    ]);
    expect(r.stdout).toBe('');
  });

  it('TABLE format: shows empty hint when no methods', async () => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(EMPTY_RESULT);
    const r = await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'table',
    ]);
    expect(r.stdout).toContain('No payment methods found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service call contract
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — service call', () => {
  it('calls getOuterPaymentMethods without arguments', async () => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(EMPTY_RESULT);
    await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'json',
    ]);
    expect(holder.billingService.getOuterPaymentMethods).toHaveBeenCalledTimes(1);
    expect(holder.billingService.getOuterPaymentMethods).toHaveBeenCalledWith();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authentication requirement
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method list — authentication', () => {
  it('calls ensureAuthenticated before fetching data', async () => {
    holder.billingService.getOuterPaymentMethods.mockResolvedValue(EMPTY_RESULT);
    await runCommand(buildList, [
      'billing', 'payment-method', 'list', '--format', 'json',
    ]);
    expect(ensureAuthenticatedMock).toHaveBeenCalled();
  });
});

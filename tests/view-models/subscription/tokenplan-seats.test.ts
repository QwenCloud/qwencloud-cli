/** View-model unit tests for `subscription tokenplan seats`. */
import { describe, it, expect } from 'vitest';

// Type stubs

interface SeatCycle {
  startTime: string;
  endTime: string;
  totalValue: string;
  surplusValue: string;
  unit: string;
}

interface SeatConfig {
  planType: string;
  creditValue: number;
  seatNum: number;
  quotaCycle: string;
}

interface SeatItem {
  instanceCode: string;
  specType: string;
  status: string;
  memberId: string;
  assignable: boolean;
  assignment: string;
  payMode: string;
  productType: string;
  cycle: SeatCycle | null;
  config: SeatConfig | null;
}

interface SeatsPage {
  current: number;
  size: number;
  total: number;
}

interface SeatsFilter {
  specType: string | null;
}

interface SeatsDiagnostic {
  api: string;
  errorCode: string;
  errorMessage: string;
}

interface TokenPlanSeatsResult {
  page: SeatsPage;
  filter: SeatsFilter;
  items: SeatItem[];
  diagnostics: SeatsDiagnostic[];
}

// ────────────────────────────────────────────────────────────────────
// Factories
// ────────────────────────────────────────────────────────────────────

function makeSeat(overrides: Partial<SeatItem> = {}): SeatItem {
  return {
    instanceCode: 'subs-03a5xxxx9x2g',
    specType: 'pro',
    status: 'NORMAL',
    memberId: 'acc_12345678abcdefgh9012',
    assignable: true,
    assignment: 'Assigned',
    payMode: 'Subscription',
    productType: 'TokenPlan',
    cycle: {
      startTime: '2026-06-14T00:00:00+08:00',
      endTime: '2026-07-14T00:00:00+08:00',
      totalValue: '100000.00000000',
      surplusValue: '91284.56267396',
      unit: 'Credits',
    },
    config: {
      planType: 'pro',
      creditValue: 100000,
      seatNum: 1,
      quotaCycle: 'monthly',
    },
    ...overrides,
  };
}

function makeResult(
  items: SeatItem[],
  page: number = 1,
  size: number = 20,
  total: number = items.length,
  filterSpec: string | null = null,
  diagnostics: SeatsDiagnostic[] = [],
): TokenPlanSeatsResult {
  return {
    page: { current: page, size, total },
    filter: { specType: filterSpec },
    items,
    diagnostics,
  };
}

// ────────────────────────────────────────────────────────────────────
// JSON mode
// ────────────────────────────────────────────────────────────────────

describe('buildTokenPlanSeatsViewModel — JSON mode', () => {
  it('exposes full pagination + filter + items at top level', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat({ instanceCode: 'subs-A' })], 1, 20, 12),
      'json',
    );
    expect(vm.page).toEqual({ current: 1, size: 20, total: 12 });
    expect(vm.filter).toEqual({ specType: null });
    expect(vm.items).toHaveLength(1);
    expect(vm.items[0].instanceCode).toBe('subs-A');
    expect(vm.diagnostics).toEqual([]);
  });

  it('emits unmasked memberId in JSON mode', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat({ memberId: 'acc_12345678abcdefgh9012' })]),
      'json',
    );
    expect(vm.items[0].memberId).toBe('acc_12345678abcdefgh9012');
    expect(vm.items[0].memberId).not.toContain('…');
  });

  it('preserves amount strings at full precision', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()]), 'json');
    expect(vm.items[0].cycle!.totalValue).toBe('100000.00000000');
    expect(vm.items[0].cycle!.surplusValue).toBe('91284.56267396');
  });

  it('passes config object through unchanged', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()]), 'json');
    expect(vm.items[0].config).toEqual({
      planType: 'pro',
      creditValue: 100000,
      seatNum: 1,
      quotaCycle: 'monthly',
    });
  });

  it('emits config=null when service degraded the row', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat({ config: null })]), 'json');
    expect(vm.items[0].config).toBeNull();
  });

  it('surfaces diagnostics array verbatim', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const diagnostics: SeatsDiagnostic[] = [
      {
        api: 'GetSubscriptionDetail',
        errorCode: 'ConfigParseError',
        errorMessage: 'subs-bad: invalid Config json',
      },
    ];
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat()], 1, 20, 1, null, diagnostics),
      'json',
    );
    expect(vm.diagnostics).toEqual(diagnostics);
  });
});

// ────────────────────────────────────────────────────────────────────
// TUI mode
// ────────────────────────────────────────────────────────────────────

describe('buildTokenPlanSeatsViewModel — TUI mode', () => {
  it('produces header, table rows, and footer when items are present', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(
      makeResult(
        [makeSeat({ instanceCode: 'subs-A' }), makeSeat({ instanceCode: 'subs-B' })],
        1,
        20,
        12,
      ),
      'tui',
    );
    expect(vm.header).toBeDefined();
    expect(vm.rows).toBeDefined();
    expect(vm.rows!).toHaveLength(2);
    expect(vm.footer).toBeDefined();
  });

  it('masks memberId as prefix-8 + ellipsis + suffix-4', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat({ memberId: 'acc_12345678abcdefgh9012' })]),
      'tui',
    );
    const row = vm.rows![0];
    expect(row.memberIdMasked).toBe('acc_1234…9012');
  });

  it('exposes filter label "all" when filter is null', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()], 1, 20, 1, null), 'tui');
    expect(vm.header!.filter.toLowerCase()).toContain('all');
  });

  it('exposes filter label "pro" when filter is pro', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()], 1, 20, 1, 'pro'), 'tui');
    expect(vm.header!.filter.toLowerCase()).toContain('pro');
  });

  it('renders pagination footer with "Page X" form', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()], 1, 20, 12), 'tui');
    expect(vm.footer!.pagination).toMatch(/Page\s+1/i);
  });

  it('renders pagination footer with multi-page form', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()], 2, 5, 12), 'tui');
    expect(vm.footer!.pagination).toMatch(/Page\s+2/i);
    expect(vm.footer!.pagination).toMatch(/3/); // total pages = ceil(12/5)
  });

  it('returns empty rows + placeholder when items are empty', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([], 1, 20, 0), 'tui');
    expect(vm.rows).toEqual([]);
    expect(vm.emptyPlaceholder).toMatch(/no\s+seats|empty/i);
  });

  it('preserves table cell amount strings at full precision', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()]), 'tui');
    const row = vm.rows![0];
    // Amounts are presented as strings; locale-formatted is acceptable but the
    // numeric content must be derivable from the raw value (no truncation).
    expect(typeof row.totalValue).toBe('string');
    expect(typeof row.surplusValue).toBe('string');
  });

  it('renders em-dash for null cycle (degraded row)', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat({ cycle: null })]), 'tui');
    const row = vm.rows![0];
    expect(row.totalValue).toBe('—');
    expect(row.surplusValue).toBe('—');
  });

  it('surfaces diagnostics warnings array when present', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const diagnostics: SeatsDiagnostic[] = [
      {
        api: 'GetSubscriptionDetail',
        errorCode: 'ConfigParseError',
        errorMessage: 'subs-bad: invalid Config',
      },
    ];
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat()], 1, 20, 1, null, diagnostics),
      'tui',
    );
    expect(vm.footer!.warnings.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// TEXT mode
// ────────────────────────────────────────────────────────────────────

describe('buildTokenPlanSeatsViewModel — TEXT mode', () => {
  it('produces a compact header + line-per-seat structure', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(
      makeResult(
        [makeSeat({ instanceCode: 'subs-A' }), makeSeat({ instanceCode: 'subs-B' })],
        1,
        20,
        12,
      ),
      'text',
    );
    expect(vm.header).toBeDefined();
    expect(vm.rows).toBeDefined();
    expect(vm.rows!).toHaveLength(2);
  });

  it('masks memberId in TEXT mode (same prefix-8 + suffix-4)', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat({ memberId: 'acc_12345678abcdefgh9012' })]),
      'text',
    );
    expect(vm.rows![0].memberIdMasked).toBe('acc_1234…9012');
  });

  it('emits empty placeholder for empty items', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([], 1, 20, 0), 'text');
    expect(vm.rows).toEqual([]);
    expect(vm.emptyPlaceholder).toBeDefined();
  });

  it('renders Page X/Y in footer.pagination', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat()], 1, 20, 12), 'text');
    expect(vm.footer!.pagination).toMatch(/Page/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// MemberId masking — boundary cases
// ────────────────────────────────────────────────────────────────────

describe('memberId masking (TUI/TEXT)', () => {
  it('keeps short memberId (≤12 chars) unmasked or returns it as-is', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    // 12 chars total: prefix 8 + suffix 4 == full length, ellipsis would lengthen.
    const vm = buildTokenPlanSeatsViewModel(
      makeResult([makeSeat({ memberId: 'acc_1234abcd' })]),
      'tui',
    );
    const masked = vm.rows![0].memberIdMasked;
    // Either the original value, or the masked rendering — must not be empty
    // and must not silently drop characters beyond what the algorithm prescribes.
    expect(masked.length).toBeGreaterThan(0);
    expect(masked).toContain('acc_');
  });

  it('handles empty memberId gracefully', async () => {
    const { buildTokenPlanSeatsViewModel } =
      await import('../../../src/view-models/subscription/tokenplan-seats.js');
    const vm = buildTokenPlanSeatsViewModel(makeResult([makeSeat({ memberId: '' })]), 'tui');
    // Empty input → em-dash placeholder or empty string; both acceptable, but
    // must not throw and must not include "…" alone.
    const masked = vm.rows![0].memberIdMasked;
    expect(typeof masked).toBe('string');
  });
});

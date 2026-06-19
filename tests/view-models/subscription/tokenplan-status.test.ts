/** View-model unit tests for subscription tokenplan status. */
import { describe, it, expect } from 'vitest';

// Type stubs

interface SeatGroup {
  specType: string;
  seats: number;
  assigned: number;
  totalValue: string;
  surplusValue: string;
  unit: string;
  nextCycleFlushTime: string;
}

interface SeatTotal {
  seats: number;
  totalValue: string;
  surplusValue: string;
  unit: string;
}

interface SeatSummary {
  groups: SeatGroup[];
  total: SeatTotal;
}

interface TokenPlanPeriod {
  start: string;
  end: string;
  remainingDays: number;
}

interface AutoRenew {
  enabled: boolean;
  period: number;
  periodUnit: string;
}

interface Renewable {
  canRenew: boolean;
  interceptCode: string;
}

interface TokenPlanDiagnostic {
  api: string;
  errorCode: string;
  errorMessage: string;
}

interface TokenPlanStatusResult {
  product: string | null;
  period: TokenPlanPeriod | null;
  autoRenew: AutoRenew | null;
  renewable: Renewable | null;
  seatSummary: SeatSummary | null;
  diagnostics: TokenPlanDiagnostic[];
}

// ────────────────────────────────────────────────────────────────────
// Factories
// ────────────────────────────────────────────────────────────────────

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
      total: {
        seats: 11,
        totalValue: '575000',
        surplusValue: '566284.3192002',
        unit: 'Credits',
      },
    },
    diagnostics: [],
  };
}

function makeDiag(api: string, msg = 'failed'): TokenPlanDiagnostic {
  return { api, errorCode: 'ServiceError', errorMessage: msg };
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('buildTokenPlanStatusViewModel — JSON mode', () => {
  it('produces complete nested object structure with full data', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    const vm = buildTokenPlanStatusViewModel(result, 'json');

    expect(vm.product).toBe('Token Plan Team Edition');
    expect(vm.period).toEqual({
      start: '2026-06-14T00:00:00+08:00',
      end: '2026-07-14T00:00:00+08:00',
      remainingDays: 41,
    });
    expect(vm.autoRenew).toEqual({ enabled: true, period: 1, periodUnit: 'M' });
    expect(vm.renewable).toEqual({ canRenew: false, interceptCode: 'PENDING_RENEWAL' });
    expect(vm.seatSummary.groups).toHaveLength(2);
    expect(vm.seatSummary.total.seats).toBe(11);
    expect(vm.diagnostics).toEqual([]);
  });

  it('preserves amount strings at full precision (no number conversion)', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    const vm = buildTokenPlanStatusViewModel(result, 'json');

    expect(vm.seatSummary.total.surplusValue).toBe('566284.3192002');
    expect(vm.seatSummary.groups[0].totalValue).toBe('175000');
  });

  it('sets null fields when autoRenew is unavailable', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal')];
    const vm = buildTokenPlanStatusViewModel(result, 'json');

    expect(vm.autoRenew).toBeNull();
    expect(vm.diagnostics).toHaveLength(1);
    expect(vm.seatSummary).not.toBeNull();
  });

  it('sets seatSummary null when both seat APIs fail', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.seatSummary = null;
    result.diagnostics = [
      makeDiag('GetSeatSubscriptionSummary'),
      makeDiag('GetSubscriptionSummary'),
    ];
    const vm = buildTokenPlanStatusViewModel(result, 'json');

    expect(vm.seatSummary).toBeNull();
    expect(vm.diagnostics).toHaveLength(2);
  });

  it('includes non-empty diagnostics array on partial failure', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.renewable = null;
    result.diagnostics = [makeDiag('CheckInstancesRenewable', 'Network timeout')];
    const vm = buildTokenPlanStatusViewModel(result, 'json');

    expect(vm.diagnostics).toHaveLength(1);
    expect(vm.diagnostics[0].api).toBe('CheckInstancesRenewable');
    expect(vm.diagnostics[0].errorMessage).toBe('Network timeout');
  });
});

describe('buildTokenPlanStatusViewModel — TUI mode', () => {
  it('produces sections and table structure for full data', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    const vm = buildTokenPlanStatusViewModel(result, 'tui');

    // TUI mode should have header section with product/period/autoRenew/renewable
    expect(vm.header).toBeDefined();
    expect(vm.header.product).toBe('Token Plan Team Edition');
    expect(vm.header.period).toBeDefined();
    expect(vm.header.autoRenew).toBeDefined();
    expect(vm.header.renewable).toBeDefined();
    // Table section with seat groups
    expect(vm.table).toBeDefined();
    expect(vm.table.rows).toHaveLength(2);
    // Footer with total
    expect(vm.footer).toBeDefined();
    expect(vm.footer.total).toBeDefined();
  });

  it('renders em-dash placeholder for null autoRenew', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');

    expect(vm.header.autoRenew).toBe('—');
  });

  it('renders em-dash placeholder for null renewable', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.renewable = null;
    result.diagnostics = [makeDiag('CheckInstancesRenewable')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');

    expect(vm.header.renewable).toBe('—');
  });

  it('omits table section when seatSummary is null', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.seatSummary = null;
    result.diagnostics = [makeDiag('GetSeatSubscriptionSummary')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');

    expect(vm.table).toBeNull();
  });

  it('includes diagnostics warnings when present', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal', 'Service unavailable')];
    const vm = buildTokenPlanStatusViewModel(result, 'tui');

    expect(vm.warnings).toBeDefined();
    expect(vm.warnings.length).toBeGreaterThan(0);
    expect(vm.warnings[0]).toMatch(/CheckTokenPlanAutoRenewal/);
  });
});

describe('buildTokenPlanStatusViewModel — TEXT mode', () => {
  it('produces compact key-value structure', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    const vm = buildTokenPlanStatusViewModel(result, 'text');

    // TEXT mode produces a lines-based or sections-based compact structure
    expect(vm.header).toBeDefined();
    expect(vm.seatLines).toBeDefined();
    expect(vm.seatLines).toHaveLength(2); // standard + pro
    expect(vm.totalLine).toBeDefined();
  });

  it('includes remaining days in period line', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    const vm = buildTokenPlanStatusViewModel(result, 'text');

    const periodStr = JSON.stringify(vm.header.period);
    expect(periodStr).toContain('41');
  });

  it('uses em-dash for null fields in text mode', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.autoRenew = null;
    result.diagnostics = [makeDiag('CheckTokenPlanAutoRenewal')];
    const vm = buildTokenPlanStatusViewModel(result, 'text');

    expect(vm.header.autoRenew).toBe('—');
  });

  it('displays diagnostics warnings in text mode', async () => {
    const { buildTokenPlanStatusViewModel } = await import(
      '../../../src/view-models/subscription/tokenplan-status.js'
    );
    const result = makeFullResult();
    result.renewable = null;
    result.diagnostics = [makeDiag('CheckInstancesRenewable')];
    const vm = buildTokenPlanStatusViewModel(result, 'text');

    expect(vm.warnings).toBeDefined();
    expect(vm.warnings.length).toBeGreaterThan(0);
  });
});

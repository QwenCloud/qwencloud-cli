import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';
import { Table } from '../../src/ui/Table.js';
import { TokenPlanListInk } from '../../src/ui/TokenPlanList.js';
import { TokenPlanDetailTables } from '../../src/ui/TokenPlanDetailTables.js';
import { SubscriptionTokenPlanStatusInk } from '../../src/ui/SubscriptionTokenPlanStatus.js';
import { SubscriptionStatusInk } from '../../src/ui/SubscriptionStatus.js';
import { TokenPlanSeatDetails } from '../../src/ui/TokenPlanSeatDetails.js';
import { formatTokenPlanSeatDetails } from '../../src/output/text/tokenplan-seat-details.js';
import { visibleWidth } from '../../src/ui/textWrap.js';
import {
  buildTokenPlanListViewModel,
  type TokenPlanListJsonResult,
} from '../../src/view-models/subscription/tokenplan-list.js';
import { renderTextTokenPlanList } from '../../src/output/text/tokenplan-list.js';
import type { TokenPlanListResult } from '../../src/types/tokenplan-catalog.js';
import type { TokenPlanStatusViewModel } from '../../src/view-models/subscription/tokenplan-status.js';
import { buildTokenPlanStatusViewModel } from '../../src/view-models/subscription/tokenplan-status.js';
import { buildSubscriptionStatusViewModel } from '../../src/view-models/subscription/status.js';

const terminal = vi.hoisted(() => ({ columns: 60, rows: 25 }));

vi.mock('../../src/ui/useTerminalSize.js', () => ({
  useTerminalSize: () => terminal,
}));

const columns = [
  { key: 'id', header: 'ID', minWidth: 12 },
  { key: 'name', header: 'Name', minWidth: 12 },
  { key: 'credits', header: 'Credits', minWidth: 12 },
];
const data = [
  {
    id: 'mock-seat-00000000000000000000000000000001',
    name: '\u001b[32mMock 个人订阅额度 Window\u001b[0m',
    credits: '9007199254740993.123456789',
  },
];

describe('Recent order responsive layout', () => {
  function orderStatus() {
    const vm = buildSubscriptionStatusViewModel(
      {
        isGray: false,
        plan: null,
        period: null,
        quota: { remaining: 60, total: 100, usedPct: 40 },
        autoRenew: null,
        renewable: null,
        remainingDays: null,
        seatTiers: [],
        creditPacks: [],
        codingPlanStatus: 'VALID',
        recentOrders: [
          {
            orderId: 'mock-order-0101',
            orderType: 'purchase',
            orderTime: '2026-09-20T12:00:01Z',
            amount: '-156.96',
            status: 'PAID',
          },
          {
            orderId: 'mock-order-0102',
            orderType: 'renew',
            orderTime: '2026-09-16T12:09:06Z',
            amount: '52.32',
            status: 'UNPAID',
          },
        ],
      },
      [],
      { currency: 'USD', locale: 'en-US', columns: 120 },
    );
    return vm;
  }

  it.each([60, 78, 79, 80, 120])(
    'keeps all order fields and Coding Plan at %s columns, including the table boundary',
    (width) => {
      terminal.columns = width;
      const vm = orderStatus();
      const before = structuredClone(vm);
      for (const order of vm.recentOrdersSection!.orders) Object.freeze(order);
      Object.freeze(vm.recentOrdersSection!.orders);
      Object.freeze(vm.recentOrdersSection);
      const screen = render(
        createElement(Box, { width }, createElement(SubscriptionStatusInk, { vm })),
      );
      try {
        const output = stripAnsi(screen.lastFrame() ?? '');
        expect(output).toContain('Recent Orders (latest 2)');
        expect(output).toContain('Status: VALID    Credits: 60 / 100');
        for (const value of [
          'mock-order-0101',
          'mock-order-0102',
          'Purchase',
          'Renew',
          '2026-09-20 12:00:01 (UTC)',
          '2026-09-16 12:09:06 (UTC)',
          '$-156.96',
          '$52.32',
          'Paid',
          'Unpaid',
        ]) {
          expect(output).toContain(value);
        }
        if (width >= 79) {
          expect(output).toMatch(/Order ID +│ Type +│ Date +│ Amount +│ Status/);
          expect(output).not.toContain('Order ID:');
        } else {
          expect(output).toContain('Order ID: mock-order-0101');
          expect(output).toContain('Type: Purchase');
          expect(output).toContain('Date: 2026-09-20 12:00:01 (UTC)');
          expect(output).toContain('Amount: $-156.96');
          expect(output).toContain('Status: Paid\n\n    Order ID: mock-order-0102');
          expect(output).not.toContain('│');
        }
        for (const line of output.split('\n')) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
        expect(output).not.toContain('…');
        expect(vm).toEqual(before);
      } finally {
        screen.unmount();
        terminal.columns = 60;
      }
    },
  );

  it('wraps complete long fields and counts colored fullwidth text before selecting a table', async () => {
    const vm = orderStatus();
    const order = vm.recentOrdersSection!.orders[0]!;
    order.id = `mock-order-${'0123456789'.repeat(8)}`;
    order.typeLabel = '\u001b[32m团队订阅\u001b[0m';
    order.statusLabel = '已支付';
    terminal.columns = 40;
    const screen = render(
      createElement(Box, { width: 40 }, createElement(SubscriptionStatusInk, { vm })),
    );
    try {
      const narrow = stripAnsi(screen.lastFrame() ?? '');
      const orders = narrow.slice(narrow.indexOf('Order ID:'));
      expect(orders.replace(/\s/g, '')).toContain(`OrderID:${order.id}`);
      expect(orders).toContain('Type: 团队订阅');
      expect(orders).toContain('Status: 已支付');
      expect(orders).not.toContain('…');
      expect(orders).not.toContain('│');
      for (const line of orders.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(40);

      order.id = 'mock-order-0101';
      vm.recentOrdersSection!.orders = [order];
      for (const width of [78, 79]) {
        terminal.columns = width;
        screen.rerender(
          createElement(Box, { width }, createElement(SubscriptionStatusInk, { vm })),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        const output = stripAnsi(screen.lastFrame() ?? '');
        expect(output).toContain('团队订阅');
        expect(output).toContain('已支付');
        expect(output.includes('Order ID:')).toBe(width === 78);
        for (const line of output.split('\n'))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    } finally {
      screen.unmount();
      terminal.columns = 60;
    }
  });

  it('switches between records and the full table as the terminal is resized', async () => {
    const vm = orderStatus();
    terminal.columns = 60;
    const screen = render(
      createElement(Box, { width: 60 }, createElement(SubscriptionStatusInk, { vm })),
    );
    try {
      expect(stripAnsi(screen.lastFrame() ?? '')).toContain('Order ID: mock-order-0101');
      for (const width of [120, 60]) {
        terminal.columns = width;
        screen.rerender(
          createElement(Box, { width }, createElement(SubscriptionStatusInk, { vm })),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        const output = stripAnsi(screen.lastFrame() ?? '');
        expect(output.includes('Order ID:')).toBe(width === 60);
        expect(output).toContain('mock-order-0101');
        expect(output).toContain('Status: VALID    Credits: 60 / 100');
      }
    } finally {
      screen.unmount();
      terminal.columns = 60;
    }
  });
});

describe('Status detail record spacing', () => {
  it.each([24, 60, 120])('keeps full seat IDs, balances and labels at %s columns', (width) => {
    terminal.columns = width;
    const details = {
      title: 'SEAT DETAILS',
      headers: [
        'SEAT ID',
        'SEAT TYPE',
        'STATUS',
        'ASSIGNMENT',
        'CREDITS (REMAINING / TOTAL)',
        'REMAINING (%)',
      ],
      rows: [
        ['mock-seat-01234567890123456789', 'Pro', 'active', 'assigned', '50.05 / 100', '50.05%'],
      ],
      note: '',
      noteAfterRows: true,
    };
    const screen = render(
      createElement(Box, { width }, createElement(TokenPlanSeatDetails, { details, indent: 0 })),
    );
    try {
      const output = stripAnsi(screen.lastFrame() ?? '');
      const text = formatTokenPlanSeatDetails(details, width);
      expect(output).toContain('SEAT DETAILS');
      const normalized =
        width === 120
          ? output.replace(/[│─┼\s]/g, '')
          : output
              .split('\n')
              .map((line) => (line.includes('│') ? line.slice(line.indexOf('│') + 1) : line))
              .join('')
              .replace(/[│─┼\s]/g, '');
      for (const value of ['mock-seat-01234567890123456789', '50.05/100', '50.05%'])
        expect(normalized).toContain(value);
      for (const line of output.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(output).not.toContain('…');
      expect(text).toContain('mock-seat-01234567890123456789');
      expect(text).not.toMatch(/\x1b/);
      if (width === 120) expect(output).toMatch(/SEAT ID +│ SEAT TYPE +│ STATUS/);
      else expect(text).toContain('SEAT ID:');
    } finally {
      screen.unmount();
      terminal.columns = 60;
    }
  });

  const table = {
    title: 'CREDIT WINDOWS',
    layout: 'records' as const,
    headers: ['TIER', 'WINDOW', 'TOTAL CREDITS', 'REMAINING (%)', 'RESET AT'],
    rows: [
      ['Lite', 'weekly', '100', '50%', '2026-11-02 00:00:00 (UTC)'],
      ['Pro', 'weekly', '200', '0%', '2026-11-02 00:00:00 (UTC)'],
    ],
    emptyMessage: 'No windows.',
  };

  it.each([0, 1])('uses a %s-line title gap and keeps records separated', (recordTitleGap) => {
    const screen = render(
      createElement(TokenPlanDetailTables, {
        tables: [table],
        paddingLeft: 0,
        maxTotalWidth: 56,
        ...(recordTitleGap === 0 ? { recordTitleGap } : {}),
      }),
    );
    try {
      const output = stripAnsi(screen.lastFrame() ?? '');
      expect(output).toContain(`CREDIT WINDOWS${'\n'.repeat(recordTitleGap + 1)}TIER: Lite`);
      expect(output).toContain('RESET AT: 2026-11-02 00:00:00 (UTC)\n\nTIER: Pro');
      expect(output).not.toContain('Note: Widen the terminal');
    } finally {
      screen.unmount();
    }
  });

  it('places the first status record directly below its title and restores the table after resize', async () => {
    const vm: TokenPlanStatusViewModel = buildTokenPlanStatusViewModel(
      {
        product: 'Token Plan',
        period: null,
        autoRenew: null,
        renewable: null,
        seatSummary: null,
        diagnostics: [],
      },
      'tui',
    );
    vm.editionSections = [
      { edition: 'individual', title: 'INDIVIDUAL', fields: [], detailTables: [table] },
    ];
    terminal.columns = 60;
    const screen = render(
      createElement(Box, { width: 60 }, createElement(SubscriptionTokenPlanStatusInk, { vm })),
    );
    try {
      const narrow = stripAnsi(screen.lastFrame() ?? '');
      expect(narrow).toContain('    CREDIT WINDOWS\n    TIER: Lite');
      expect(narrow).toContain('    RESET AT: 2026-11-02 00:00:00 (UTC)\n\n    TIER: Pro');
      terminal.columns = 120;
      screen.rerender(
        createElement(Box, { width: 120 }, createElement(SubscriptionTokenPlanStatusInk, { vm })),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const wide = stripAnsi(screen.lastFrame() ?? '');
      expect(wide).toMatch(/CREDIT WINDOWS\n +TIER +│/);
      expect(wide).not.toContain('TIER: Lite');
      terminal.columns = 60;
      screen.rerender(
        createElement(Box, { width: 60 }, createElement(SubscriptionTokenPlanStatusInk, { vm })),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(stripAnsi(screen.lastFrame() ?? '')).toContain('    CREDIT WINDOWS\n    TIER: Lite');
    } finally {
      screen.unmount();
      terminal.columns = 60;
    }
  });
});

describe('Table total width limit', () => {
  it.each([12, 48, 80])('keeps every rendered line within %s terminal columns', (maxTotalWidth) => {
    const instance = render(
      createElement(Table, {
        columns,
        data,
        truncate: true,
        paddingLeft: 2,
        maxTotalWidth,
      }),
    );
    try {
      const frame = stripAnsi(instance.lastFrame() ?? '');

      expect(frame).toContain('ID');
      expect(frame).toContain('mock');
      expect(frame).toContain('…');
      for (const line of frame.split('\n')) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(maxTotalWidth);
      }
    } finally {
      instance.unmount();
    }
  });

  it('restores full values after a constrained table is rerendered with enough width', async () => {
    const instance = render(
      createElement(Table, {
        columns,
        data,
        truncate: true,
        paddingLeft: 2,
        maxTotalWidth: 48,
      }),
    );
    try {
      expect(stripAnsi(instance.lastFrame() ?? '')).not.toContain(data[0]!.id);

      instance.rerender(
        createElement(Table, {
          columns,
          data,
          truncate: true,
          paddingLeft: 2,
          maxTotalWidth: 160,
        }),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const frame = stripAnsi(instance.lastFrame() ?? '');

      expect(frame).toContain(data[0]!.id);
      expect(frame).toContain('Mock 个人订阅额度 Window');
      expect(frame).toContain('9007199254740993.123456789');
      for (const line of frame.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(160);
    } finally {
      instance.unmount();
    }
  });
});

function modelCatalog(): TokenPlanListResult {
  return {
    authenticated: false,
    edition: 'individual',
    billingCycle: 'monthly',
    completeness: 'complete',
    sections: [
      {
        edition: 'individual',
        billingCycleSupported: true,
        subscriptionStatus: 'not_subscribed',
        currentPlan: null,
        currentBillingCycle: null,
        subscriptionUrl: null,
        diagnostics: [],
        rows: [],
        plans: [
          {
            tier: 'lite',
            billingTerm: 'monthly',
            listPrice: '60',
            promoPrice: null,
            currency: 'USD',
            quotaWindows: [],
            supportedModels: [
              {
                modelId: 'mock-model-00000001',
                modelBrand: 'Qwen',
                modelName: '千问'.repeat(7),
                capabilities: ['TG'],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('Token Plan catalog layout', () => {
  it.each([60, 120, 139])('left-aligns catalog sections at %s columns', (width) => {
    terminal.columns = width;
    const source = modelCatalog();
    source.authenticated = true;
    source.sections[0]!.rows = [
      {
        type: 'token_plan_individual_lite',
        specCode: 'lite',
        seatType: null,
        name: 'Lite',
        price: '60',
        currency: 'USD',
        inventory: true,
        monthlyCredits: null,
        status: 'purchasable',
      },
    ];
    const before = structuredClone(source);
    const vm = buildTokenPlanListViewModel(source);
    const screen = render(createElement(Box, { width }, createElement(TokenPlanListInk, { vm })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      renderTextTokenPlanList(vm);
      const table = stripAnsi(screen.lastFrame() ?? '');
      const text = log.mock.calls.flat().join('\n');
      for (const output of [table, text]) {
        const lines = output.split('\n');
        expect(lines.find((line) => line.includes('TOKEN PLAN CATALOG'))).toMatch(
          /^TOKEN PLAN CATALOG═+$/,
        );
        expect(lines.find((line) => line.includes('INDIVIDUAL TOKEN PLANS'))).toMatch(
          /^INDIVIDUAL TOKEN PLANS─+$/,
        );
        for (const title of ['CURRENT SUBSCRIPTION', 'PRICING', 'SUPPORTED MODELS']) {
          const index = lines.findIndex((line) => line.trim() === title);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(lines[index]).toBe(title);
          expect(lines.slice(index + 1).find((line) => line.trim())).toMatch(/^\S/);
        }
        expect(output).toContain('USD');
        expect(output).toContain('purchasable');
        expect(output).toContain('mock-model-00000001');
        expect(output).toContain('Text Generation');
        expect(output).toContain('TAG');
        expect(output).not.toContain('千问'.repeat(7));
        expect(output).not.toContain('…');
      }
      for (const line of table.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(text).not.toMatch(/\x1b/);
      expect(text).not.toContain('Note: Widen the terminal');
      const expected: TokenPlanListJsonResult = structuredClone(before);
      Reflect.deleteProperty(expected.sections[0]!.rows[0]!, 'monthlyCredits');
      expect(vm.data).toEqual(expected);
      expect(vm.data.sections[0]!.rows[0]).not.toHaveProperty('monthlyCredits');
      expect(source).toEqual(before);
    } finally {
      log.mockRestore();
      screen.unmount();
      terminal.columns = 60;
    }
  });

  it.each([57, 58, 60])('uses all %s columns before switching to model records', (width) => {
    terminal.columns = width;
    const source = modelCatalog();
    const before = structuredClone(source);
    const vm = buildTokenPlanListViewModel(source);
    const screen = render(createElement(Box, { width }, createElement(TokenPlanListInk, { vm })));
    try {
      const output = stripAnsi(screen.lastFrame() ?? '');
      const models = output.slice(output.indexOf('SUPPORTED MODELS'));
      expect(models).toContain('mock-model-00000001');
      expect(models).toContain('Text Generation');
      expect(models).toContain('TAG');
      expect(models).not.toContain('千问'.repeat(7));
      if (width >= 58) {
        expect(models).toContain('│');
        expect(models).not.toContain('MODEL NAME:');
        expect(models).not.toContain('Note: Widen the terminal');
      } else {
        expect(models).toContain('MODEL NAME: mock-model-00000001');
        expect(models).toContain('Note: Widen the terminal to view this section as a table.');
      }
      expect(output).not.toContain('…');
      for (const line of output.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(vm.data).toEqual(before);
      expect(source).toEqual(before);
    } finally {
      screen.unmount();
      terminal.columns = 60;
    }
  });

  it('restores a model table and removes the width hint after widening', async () => {
    terminal.columns = 57;
    const vm = buildTokenPlanListViewModel(modelCatalog());
    const screen = render(
      createElement(Box, { width: 57 }, createElement(TokenPlanListInk, { vm })),
    );
    try {
      expect(stripAnsi(screen.lastFrame() ?? '')).toContain('Note: Widen the terminal');
      terminal.columns = 60;
      screen.rerender(createElement(Box, { width: 60 }, createElement(TokenPlanListInk, { vm })));
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const output = stripAnsi(screen.lastFrame() ?? '');
      const models = output.slice(output.indexOf('SUPPORTED MODELS'));
      expect(models).toContain('│');
      expect(models).toContain('mock-model-00000001');
      expect(models).toContain('Text Generation');
      expect(models).toContain('TAG');
      expect(models).not.toContain('千问'.repeat(7));
      expect(models).not.toContain('MODEL NAME:');
      expect(models).not.toContain('Note: Widen the terminal');
    } finally {
      screen.unmount();
      terminal.columns = 60;
    }
  });

  it('keeps width hints disabled for other consumers and for empty sections', () => {
    const tables = [
      {
        title: 'DETAILS',
        layout: 'records' as const,
        headers: ['MODEL'],
        rows: [['Mock model with a complete long name']],
        emptyMessage: 'No models.',
      },
    ];
    const screen = render(createElement(TokenPlanDetailTables, { tables, maxTotalWidth: 20 }));
    try {
      const output = stripAnsi(screen.lastFrame() ?? '');
      expect(output).toContain('MODEL:');
      expect(output).not.toContain('Note: Widen the terminal');
      const empty = render(
        createElement(TokenPlanDetailTables, {
          tables: [{ ...tables[0]!, rows: [] }],
          maxTotalWidth: 20,
          showNarrowLayoutHint: true,
        }),
      );
      try {
        expect(stripAnsi(empty.lastFrame() ?? '')).toContain('No models.');
        expect(stripAnsi(empty.lastFrame() ?? '')).not.toContain('Note: Widen the terminal');
      } finally {
        empty.unmount();
      }
    } finally {
      screen.unmount();
    }
  });
});

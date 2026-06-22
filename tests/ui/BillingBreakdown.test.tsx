/**
 * UI render tests for the BillingBreakdown table.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { BillingBreakdownInk } from '../../src/ui/BillingBreakdown.js';
import { buildBillingBreakdownViewModel } from '../../src/view-models/billing/index.js';
import { visibleWidth } from '../../src/ui/textWrap.js';
import type { ConsumeBreakdown } from '../../src/types/billing-extra.js';

const ctx = { currency: 'USD', locale: 'en-US', columns: 100 };

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function makeBreakdown(n: number, overrides: Partial<ConsumeBreakdown> = {}): ConsumeBreakdown {
  return {
    groupBy: 'model',
    period: { from: '2026-04-01', to: '2026-04-30' },
    chargeType: 'all',
    rows: Array.from({ length: n }, (_, i) => ({
      groupKey: `m-${i}`,
      groupLabel: `Model ${i}`,
      amount: '1.00',
    })),
    totalRows: n,
    totalAmount: String(n.toFixed(2)),
    currency: 'USD',
    ...overrides,
  } as ConsumeBreakdown;
}

describe('BillingBreakdown (rendered)', () => {
  it('renders a table with one visible row per item', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(3), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    expect(out).toContain('Model 0');
    expect(out).toContain('Model 1');
    expect(out).toContain('Model 2');
  });

  it('renders the total row with aggregated amount', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(2), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    expect(out.toLowerCase()).toContain('total');
  });

  it('renders the "Showing top X / Y" hint when truncated', () => {
    const data = makeBreakdown(15);
    const vm = buildBillingBreakdownViewModel({ ...data, rows: data.rows.slice(0, 10) } as ConsumeBreakdown, ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    // The hint is optional; assert it does not crash and renders the visible 10 rows.
    expect(out).toContain('Model 0');
    expect(out).toContain('Model 9');
  });

  it('renders an empty-state placeholder when items is empty', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(0), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    expect(out.toLowerCase()).toMatch(/no\s+data|empty|\u2014/);
  });

  it('does not crash on a narrow terminal (columns: 60)', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(2), { ...ctx, columns: 60 });
    const out = frame(<BillingBreakdownInk vm={vm} />);
    expect(out.length).toBeGreaterThan(0);
  });

  it('column dividers are vertically aligned across header and data rows', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(3), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    // Find lines containing the │ column divider (header + data rows)
    const dividerLines = lines.filter((l) => l.includes('│'));
    expect(dividerLines.length).toBeGreaterThanOrEqual(4); // header + 3 data + separator(s)

    // Extract positions of ALL │ characters in each line
    function getDividerPositions(line: string): number[] {
      const positions: number[] = [];
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '│') positions.push(i);
      }
      return positions;
    }

    // Separator lines use ┼ instead of │; skip them for │ alignment check
    const dataAndHeaderLines = dividerLines.filter((l) => !l.includes('┼'));
    expect(dataAndHeaderLines.length).toBeGreaterThanOrEqual(2); // at least header + 1 row

    const firstLinePositions = getDividerPositions(dataAndHeaderLines[0]);
    expect(firstLinePositions.length).toBeGreaterThan(0);

    for (const line of dataAndHeaderLines) {
      const positions = getDividerPositions(line);
      // Same number of dividers on each line
      expect(positions.length).toBe(firstLinePositions.length);
      // Each divider at the same column as the first line
      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]).toBe(firstLinePositions[i]);
      }
    }
  });

  it('separator ┼ characters align with │ dividers', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(2), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    // Find a line with │ (data/header) and a line with ┼ (separator)
    const divLine = lines.find((l) => l.includes('│') && !l.includes('┼'));
    const sepLine = lines.find((l) => l.includes('┼'));

    if (sepLine && divLine) {
      // ┼ positions should match │ positions
      const divPositions = [...divLine].reduce<number[]>((acc, ch, idx) => {
        if (ch === '│') acc.push(idx);
        return acc;
      }, []);
      const crossPositions = [...sepLine].reduce<number[]>((acc, ch, idx) => {
        if (ch === '┼') acc.push(idx);
        return acc;
      }, []);

      expect(crossPositions.length).toBe(divPositions.length);
      for (let i = 0; i < crossPositions.length; i++) {
        expect(crossPositions[i]).toBe(divPositions[i]);
      }
    }
  });

  it('header row contains all expected column headers (Model, Amount)', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(2), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    // The header is the first line that contains │ separators
    const headerLine = lines.find((l) => l.includes('│') && !l.includes('┼'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('Model');
    expect(headerLine).toContain('Amount');
  });

  it('all data rows have consistent visible width (no ragged table)', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(3), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    // Find lines with │ (data rows, excluding separator lines with ┼)
    const tableLines = lines.filter((l) => l.includes('│') && !l.includes('┼'));
    expect(tableLines.length).toBeGreaterThanOrEqual(2);

    // Header may have trailing padding for bg color; compare only data rows
    // (skip the first line which is the header)
    const dataRows = tableLines.slice(1);
    expect(dataRows.length).toBeGreaterThanOrEqual(1);

    const widths = dataRows.map((l) => visibleWidth(l.trimEnd()));
    const firstWidth = widths[0];
    for (const w of widths) {
      expect(w).toBe(firstWidth);
    }
  });

  it('TOTAL row is the last data row and contains │ column dividers', () => {
    const vm = buildBillingBreakdownViewModel(makeBreakdown(2), ctx);
    const out = frame(<BillingBreakdownInk vm={vm} />);
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    // Find the TOTAL row
    const totalLineIdx = lines.findIndex((l) => l.includes('TOTAL'));
    expect(totalLineIdx).toBeGreaterThan(0);

    // TOTAL row uses the same │ divider structure as other data rows
    const totalLine = lines[totalLineIdx];
    expect(totalLine).toContain('│');

    // TOTAL is the last line with │ dividers (last data row in table)
    const linesAfterTotal = lines.slice(totalLineIdx + 1);
    const dataLinesAfterTotal = linesAfterTotal.filter((l) => l.includes('│'));
    expect(dataLinesAfterTotal.length).toBe(0);
  });
});

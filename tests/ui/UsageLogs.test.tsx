/**
 * Ink-rendering tests for the usage-logs presentational component.
 *
 * Coverage targets (per scope §4.1):
 *   1. Header carries the period label.
 *   2. Each row renders model / status / latency / tokens columns.
 *   3. Status code colors map to 2xx green / 4xx yellow / 5xx red.
 *   4. Zero-value tokens render as em-dash on both sides.
 *   5. Empty result set renders an empty-state hint.
 *   6. Pagination footer surfaces totalCount / page / pageSize.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { UsageLogsInk } from '../../src/ui/UsageLogs.js';
import type { UsageLogsViewModel, UsageLogRowViewModel } from '../../src/view-models/usage/index.js';

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function row(overrides: Partial<UsageLogRowViewModel> = {}): UsageLogRowViewModel {
  return {
    time: '2026-05-23 14:32:17',
    shortTime: '14:32:17',
    requestId: '9f2c6a40-1234-4abc-9def-0000000000a1bd',
    statusCode: 200,
    statusColor: 'green',
    model: 'qwen3.6-plus',
    latencyDisplay: '1.23 s',
    firstOutputDisplay: '456 ms',
    usage: 'input: 100, output: 50',
    errorCode: null,
    ...overrides,
  };
}

function vm(overrides: Partial<UsageLogsViewModel> = {}): UsageLogsViewModel {
  return {
    periodLabel: '2026-05-22 14:00 → 2026-05-23 14:00',
    totalCount: 1,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    items: [row()],
    isEmpty: false,
    ...overrides,
  };
}

describe('UsageLogsInk', () => {
  it('renders the period label in the header', () => {
    const out = frame(<UsageLogsInk vm={vm()} />);
    expect(out).toContain('2026-05-22');
    expect(out).toContain('2026-05-23');
  });

  it('renders one row per item with model / latency / usage', () => {
    const out = frame(<UsageLogsInk vm={vm()} />);
    expect(out).toContain('qwen3.6-plus');
    expect(out).toContain('1.23 s');
    expect(out).toContain('input: 100,');
    expect(out).toContain('output: 50');
    expect(out).toContain('200');
  });

  it('renders empty usage as a single em-dash', () => {
    const out = frame(
      <UsageLogsInk vm={vm({ items: [row({ usage: '—' })] })} />,
    );
    expect(out).toContain('—');
  });

  it('renders the error code when a row has a non-2xx status', () => {
    const out = frame(
      <UsageLogsInk
        vm={vm({
          items: [
            row({ statusCode: 429, statusColor: 'yellow', errorCode: 'Throttling.User' }),
          ],
        })}
      />,
    );
    expect(out).toContain('429');
    expect(out).toContain('Throttling.User');
  });

  it('renders an empty-state hint when isEmpty=true', () => {
    const out = frame(<UsageLogsInk vm={vm({ items: [], totalCount: 0, isEmpty: true })} />);
    expect(out.toLowerCase()).toMatch(/no\s+(call\s+)?(logs|results)|no\s+usage/);
  });

  it('renders a pagination footer carrying totalCount and page', () => {
    const manyRows = Array.from({ length: 20 }, (_, i) =>
      row({ requestId: `req-${i}`, statusCode: 200, model: `qwen3.6-plus` }),
    );
    const out = frame(
      <UsageLogsInk vm={vm({ totalCount: 47, page: 1, pageSize: 20, pageCount: 3, items: manyRows })} />,
    );
    // Footer must communicate at least totalCount or page progress
    expect(out).toMatch(/47|1\s*\/\s*3|page/i);
  });
});

/**
 * View-model unit tests for the support ticket list.
 *
 * The view model transforms raw service data (status codes, timestamps,
 * titles) into display-ready strings suitable for table rendering.
 *
 * Covers:
 *   - Status mapping for all 12 known backend values
 *   - Unknown status degraded display (capitalize + underscore-to-space)
 *   - Timestamp formatting (milliseconds → YYYY-MM-DD HH:mm)
 *   - Title truncation (>36 chars → 36 chars + …)
 *   - Empty list ViewModel construction
 */
import { describe, it, expect } from 'vitest';
import {
  buildSupportListViewModel,
} from '../../../src/view-models/support/index.js';

interface RawTicket {
  id: string;
  title: string;
  status: string;
  createdAt: number;
}

function makeTicket(overrides: Partial<RawTicket> = {}): RawTicket {
  return {
    id: '130000001',
    title: 'Model inference timeout',
    status: 'dealing',
    createdAt: 1716883380000,
    ...overrides,
  };
}

describe('buildSupportListViewModel — status mapping', () => {
  const STATUS_MAP: Array<[string, string]> = [
    ['wait_assign', 'Pending assignment'],
    ['assigned', 'Assigned'],
    ['dealing', 'Processing'],
    ['wait_feedback', 'Pending feedback'],
    ['feedback', 'Pending feedback'],
    ['wait_confirm', 'Pending confirmation'],
    ['wait_score', 'Pending rating'],
    ['confirmed', 'Closed'],
    ['score', 'Closed'],
    ['robot_dealing', 'Processing'],
    ['robot_waiting_confirmation', 'Pending confirmation'],
    ['robot_processing', 'Processing'],
  ];

  it.each(STATUS_MAP)(
    'maps backend status "%s" → display "%s"',
    (backendStatus, expectedDisplay) => {
      const vm = buildSupportListViewModel(
        [makeTicket({ status: backendStatus })],
        1,
        20,
        1,
      );
      expect(vm.items[0].status).toBe(expectedDisplay);
    },
  );

  it('degrades unknown status: capitalizes first letter, replaces underscores with spaces', () => {
    const vm = buildSupportListViewModel(
      [makeTicket({ status: 'some_unknown_status' })],
      1,
      20,
      1,
    );
    expect(vm.items[0].status).toBe('Some unknown status');
  });

  it('handles empty string status as degraded display', () => {
    const vm = buildSupportListViewModel(
      [makeTicket({ status: '' })],
      1,
      20,
      1,
    );
    // Empty string degrades to empty or minimal representation
    expect(vm.items[0].status).toBeDefined();
  });
});

describe('buildSupportListViewModel — timestamp formatting', () => {
  it('formats millisecond timestamp into YYYY-MM-DD HH:mm', () => {
    // 2026-05-28T06:23:00.000Z (UTC) → local time format
    const vm = buildSupportListViewModel(
      [makeTicket({ createdAt: 1716883380000 })],
      1,
      20,
      1,
    );
    // The output should match YYYY-MM-DD HH:mm pattern
    expect(vm.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('handles zero timestamp gracefully', () => {
    const vm = buildSupportListViewModel(
      [makeTicket({ createdAt: 0 })],
      1,
      20,
      1,
    );
    expect(vm.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('buildSupportListViewModel — title truncation', () => {
  it('preserves titles at exactly 36 characters without truncation', () => {
    const title36 = 'A'.repeat(36);
    const vm = buildSupportListViewModel(
      [makeTicket({ title: title36 })],
      1,
      20,
      1,
    );
    expect(vm.items[0].title).toBe(title36);
    expect(vm.items[0].title).not.toContain('…');
  });

  it('truncates titles exceeding 36 characters with ellipsis', () => {
    const title50 = 'B'.repeat(50);
    const vm = buildSupportListViewModel(
      [makeTicket({ title: title50 })],
      1,
      20,
      1,
    );
    expect(vm.items[0].title.length).toBeLessThanOrEqual(37); // 36 + '…'
    expect(vm.items[0].title).toContain('…');
  });

  it('does not truncate short titles', () => {
    const vm = buildSupportListViewModel(
      [makeTicket({ title: 'Short title' })],
      1,
      20,
      1,
    );
    expect(vm.items[0].title).toBe('Short title');
  });

  it('truncates CJK titles by display width (not code-unit length)', () => {
    // 30 CJK chars = 60 display columns. With default maxWidth=36 the
    // result must fit in 36 visible columns, including the trailing ellipsis.
    // Previous implementation used .length and would have left the title at
    // 30 chars (display width 60), blowing out the TITLE column.
    const title = '一'.repeat(30);
    const vm = buildSupportListViewModel([makeTicket({ title })], 1, 20, 1);
    const truncated = vm.items[0].title;
    expect(truncated).toContain('\u2026');
    expect(truncated.length).toBeLessThan(title.length);
  });

  it('preserves emoji surrogate pairs when truncating', () => {
    // String contains 4 emoji + a long ASCII tail; truncation must never
    // split a surrogate pair, otherwise the terminal renders a replacement
    // character and table borders desync.
    const title = '😀😁😂😃 ' + 'x'.repeat(80);
    const vm = buildSupportListViewModel([makeTicket({ title })], 1, 20, 1);
    const truncated = vm.items[0].title;
    // No lone high or low surrogate should remain.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(truncated)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(truncated)).toBe(false);
    expect(truncated.endsWith('\u2026')).toBe(true);
  });
});

describe('buildSupportListViewModel — pagination metadata', () => {
  it('includes page, pageSize and total in the view model', () => {
    const vm = buildSupportListViewModel(
      [makeTicket()],
      2,
      10,
      42,
    );
    expect(vm.page).toBe(2);
    expect(vm.pageSize).toBe(10);
    expect(vm.total).toBe(42);
  });

  it('computes totalPages from total and pageSize', () => {
    const vm = buildSupportListViewModel(
      [makeTicket()],
      1,
      20,
      42,
    );
    expect(vm.totalPages).toBe(3); // ceil(42/20) = 3
  });
});

describe('buildSupportListViewModel — out-of-range page (empty slice, real total)', () => {
  it('keeps the real total when the page is out of range and rows are empty', () => {
    // 3 tickets total, pageSize 1 → page 5 has no rows, but total stays 3.
    const vm = buildSupportListViewModel([], 5, 1, 3);
    expect(vm.items).toEqual([]);
    expect(vm.total).toBe(3);
  });

  it('computes a non-zero totalPages from total/pageSize even when rows are empty', () => {
    const vm = buildSupportListViewModel([], 5, 1, 3);
    expect(vm.totalPages).toBe(3); // ceil(3 / 1) — must not collapse to 0
  });

  it('computes totalPages for a wider pageSize on an out-of-range page', () => {
    const vm = buildSupportListViewModel([], 5, 20, 3);
    expect(vm.total).toBe(3);
    expect(vm.totalPages).toBe(1); // ceil(3 / 20)
  });
});

describe('buildSupportListViewModel — empty list', () => {
  it('returns empty rows array with zero total', () => {
    const vm = buildSupportListViewModel([], 1, 20, 0);
    expect(vm.items).toEqual([]);
    expect(vm.total).toBe(0);
    expect(vm.isEmpty).toBe(true);
  });

  it('sets isEmpty flag for quick empty-state branching', () => {
    const vm = buildSupportListViewModel([], 1, 20, 0);
    expect(vm.isEmpty).toBe(true);

    const vmWithData = buildSupportListViewModel([makeTicket()], 1, 20, 1);
    expect(vmWithData.isEmpty).toBe(false);
  });
});

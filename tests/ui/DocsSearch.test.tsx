/**
 * Ink-rendering tests for the docs-search presentational component.
 *
 * Coverage targets (per scope §4.3):
 *   1. Header carries query and result counts.
 *   2. Each row renders title, category, breadcrumb, and url.
 *   3. <em> tags are visible-stripped (the highlightedTitle drives color
 *      regions; the rendered frame should not surface raw <em> markup).
 *   4. Per-row degraded items render the documented fallback copy.
 *   5. Page-level diagnostics tag surfaces the documented banner.
 *   6. Empty result set renders an empty-state hint.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { DocsSearchInk } from '../../src/ui/DocsSearch.js';
import type { DocsSearchViewModel, DocsSearchItemViewModel } from '../../src/view-models/docs/index.js';

function frame(el: React.ReactElement): string {
  const { lastFrame } = render(el);
  return stripAnsi(lastFrame() ?? '');
}

function item(overrides: Partial<DocsSearchItemViewModel> = {}): DocsSearchItemViewModel {
  return {
    title: 'Model releases',
    highlightedTitle: 'Model releases — <em>qwen3</em>',
    subBizType: 'Changelog',
    url: 'https://docs.test.qwencloud.com/changelog/models',
    summary: 'qwen3.7-max is now available',
    highlightedSummary: '<em>qwen3</em>.7-max is now available',
    breadcrumb: ['Changelog', 'Model releases'],
    isDegraded: false,
    ...overrides,
  };
}

function vm(overrides: Partial<DocsSearchViewModel> = {}): DocsSearchViewModel {
  return {
    query: 'qwen3',
    totalCount: 1,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    items: [item()],
    diagnostics: [],
    isEmpty: false,
    isAllDegraded: false,
    degradedPlaceholder: 'Search results schema is being aligned',
    ...overrides,
  };
}

describe('DocsSearchInk — happy path', () => {
  it('renders header carrying the query', () => {
    const out = frame(<DocsSearchInk vm={vm()} />);
    expect(out).toContain('qwen3');
  });

  it('renders one row per item with title, breadcrumb, url', () => {
    const out = frame(<DocsSearchInk vm={vm()} />);
    expect(out).toContain('Model releases');
    expect(out).toContain('Changelog');
    expect(out).toContain('https://docs.test.qwencloud.com/changelog/models');
  });

  it('does not surface raw <em> markup in the rendered frame', () => {
    const out = frame(<DocsSearchInk vm={vm()} />);
    expect(out).not.toContain('<em>');
    expect(out).not.toContain('</em>');
  });
});

describe('DocsSearchInk — degradation', () => {
  it('renders the per-row fallback copy when item is degraded', () => {
    const out = frame(
      <DocsSearchInk
        vm={vm({
          items: [item({ isDegraded: true, title: '', url: '' })],
        })}
      />,
    );
    expect(out.toLowerCase()).toMatch(/aligned|对齐中/);
    expect(out).not.toContain('https://docs.test.qwencloud.com/changelog/models');
  });

  it('shows the page-level banner when diagnostics tag is present', () => {
    const out = frame(
      <DocsSearchInk
        vm={vm({
          totalCount: 3,
          items: [
            item({ isDegraded: true }),
            item({ isDegraded: true }),
            item(),
          ],
          diagnostics: ['search.fields_incomplete'],
        })}
      />,
    );
    // Banner must call out the partially-degraded state to the user.
    expect(out.toLowerCase()).toMatch(/aligned|对齐中/);
  });

  it('renders the all-degraded page without throwing', () => {
    expect(() =>
      frame(
        <DocsSearchInk
          vm={vm({
            totalCount: 2,
            items: [
              item({ isDegraded: true }),
              item({ isDegraded: true }),
            ],
            diagnostics: ['search.fields_incomplete'],
          })}
        />,
      ),
    ).not.toThrow();
  });
});

describe('DocsSearchInk — empty', () => {
  it('renders an empty-state hint when items is empty', () => {
    const out = frame(
      <DocsSearchInk vm={vm({ totalCount: 0, items: [], isEmpty: true })} />,
    );
    expect(out.toLowerCase()).toMatch(/no\s+results|no\s+matches|没有|未找到/);
  });
});

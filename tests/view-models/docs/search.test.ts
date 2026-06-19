/**
 * Unit tests for buildDocsSearchViewModel — encodes the degradation matrix
 * documented in scope §4.3 plus the highlight-tag policies.
 *
 * Coverage targets:
 *   1. Complete-fields entries: title / url / breadcrumb passthrough; <em>
 *      tags stripped from `title` & `summary`, preserved on `highlightedTitle`
 *      / `highlightedSummary`.
 *   2. Per-row degradation: missing title OR missing url → isDegraded=true.
 *   3. Top-level diagnostics: ≥50% rows degraded → diagnostics array contains
 *      'search.fields_incomplete'.
 *   4. All-degraded page: diagnostics tag still present; isEmpty=false (rows
 *      preserved for JSON output) but every row is isDegraded.
 *   5. Empty result: isEmpty=true, items=[], diagnostics=[].
 *   6. pagination: pageCount = ceil(totalCount / pageSize).
 *   7. Localized degradation copy is selectable via options.language but never
 *      leaks into JSON-bound fields (those receive the original raw values).
 */
import { describe, it, expect } from 'vitest';
import { buildDocsSearchViewModel, buildDocContentViewModel } from '../../../src/view-models/docs/index.js';
import type { DocsSearchResponse, DocsSearchItem, DocContentResult } from '../../../src/types/docs.js';

function makeItem(overrides: Partial<DocsSearchItem> = {}): DocsSearchItem {
  return {
    title: 'Model releases',
    highlightedTitle: 'Model releases — <em>qwen3</em>',
    subBizType: 'Changelog',
    url: 'https://docs.test.qwencloud.com/changelog/models',
    summary: 'qwen3.7-max …',
    highlightedSummary: '<em>qwen3</em>.7-max …',
    breadcrumb: ['Changelog', 'Model releases'],
    ...overrides,
  };
}

function makeResponse(items: DocsSearchItem[], totalCount = items.length): DocsSearchResponse {
  return { totalCount, page: 1, pageSize: 20, items };
}

describe('buildDocsSearchViewModel — happy path', () => {
  it('passes through all fields when the row is complete', () => {
    const vm = buildDocsSearchViewModel(makeResponse([makeItem()]), {
      query: 'qwen3',
      page: 1,
      pageSize: 20,
    });
    expect(vm.items[0].title).toBe('Model releases');
    expect(vm.items[0].url).toBe('https://docs.test.qwencloud.com/changelog/models');
    expect(vm.items[0].subBizType).toBe('Changelog');
    expect(vm.items[0].breadcrumb).toEqual(['Changelog', 'Model releases']);
    expect(vm.items[0].isDegraded).toBe(false);
  });

  it('strips <em> tags from title/summary while preserving highlighted variants', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([
        makeItem({
          title: 'Model releases — qwen3',
          highlightedTitle: 'Model releases — <em>qwen3</em>',
          summary: 'qwen3.7-max',
          highlightedSummary: '<em>qwen3</em>.7-max',
        }),
      ]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.items[0].title).not.toContain('<em>');
    expect(vm.items[0].summary).not.toContain('<em>');
    expect(vm.items[0].highlightedTitle).toContain('<em>');
    expect(vm.items[0].highlightedSummary).toContain('<em>');
  });

  it('reports diagnostics=[] and isEmpty=false for a fully complete page', () => {
    const vm = buildDocsSearchViewModel(makeResponse([makeItem(), makeItem()]), {
      query: 'qwen3',
      page: 1,
      pageSize: 20,
    });
    expect(vm.diagnostics).toEqual([]);
    expect(vm.isEmpty).toBe(false);
  });
});

describe('buildDocsSearchViewModel — degradation matrix', () => {
  it('flags isDegraded when title is missing', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([makeItem({ title: '', highlightedTitle: '' })]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.items[0].isDegraded).toBe(true);
  });

  it('flags isDegraded when url is missing', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([makeItem({ url: '' })]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.items[0].isDegraded).toBe(true);
  });

  it('flags isDegraded when both title and url are missing', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([makeItem({ title: '', highlightedTitle: '', url: '' })]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.items[0].isDegraded).toBe(true);
  });

  it('appends diagnostics tag when ≥50% rows are degraded', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([
        makeItem({ url: '' }), // degraded
        makeItem({ title: '', highlightedTitle: '' }), // degraded
        makeItem(), // complete
      ]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.diagnostics).toContain('search.fields_incomplete');
  });

  it('does NOT emit diagnostics tag when <50% rows are degraded', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([
        makeItem({ url: '' }), // degraded
        makeItem(), // complete
        makeItem(), // complete
        makeItem(), // complete
      ]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.diagnostics).not.toContain('search.fields_incomplete');
  });

  it('emits diagnostics tag for an entirely degraded page', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([
        makeItem({ url: '' }),
        makeItem({ title: '', highlightedTitle: '' }),
      ]),
      { query: 'qwen3', page: 1, pageSize: 20 },
    );
    expect(vm.diagnostics).toContain('search.fields_incomplete');
    expect(vm.items.every((it) => it.isDegraded)).toBe(true);
  });
});

describe('buildDocsSearchViewModel — empty / pagination', () => {
  it('marks isEmpty=true and diagnostics=[] when items is empty', () => {
    const vm = buildDocsSearchViewModel(makeResponse([], 0), {
      query: 'no-match-qwen3',
      page: 1,
      pageSize: 20,
    });
    expect(vm.isEmpty).toBe(true);
    expect(vm.items).toEqual([]);
    expect(vm.diagnostics).toEqual([]);
  });

  it('computes pageCount = ceil(totalCount / pageSize)', () => {
    const vm = buildDocsSearchViewModel(makeResponse([], 319), {
      query: 'qwen3',
      page: 1,
      pageSize: 20,
    });
    expect(vm.pageCount).toBe(16);
  });
});

describe('buildDocsSearchViewModel — query echo', () => {
  it('echoes the query in the resulting view-model', () => {
    const vm = buildDocsSearchViewModel(makeResponse([makeItem()]), {
      query: 'qwen3',
      page: 1,
      pageSize: 20,
    });
    expect(vm.query).toBe('qwen3');
  });
});

describe('buildDocContentViewModel', () => {
  it('should parse markdown headings into renderedLines', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: '# Title\n## Subtitle\n### SubSubtitle',
      error: null,
      anchor: null,
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.renderedLines).not.toBeNull();
    expect(vm.renderedLines!.some((l) => l.startsWith('[H1]'))).toBe(true);
    expect(vm.renderedLines!.some((l) => l.startsWith('[H2]'))).toBe(true);
    expect(vm.renderedLines!.some((l) => l.startsWith('[H3]'))).toBe(true);
  });

  it('should parse code blocks', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: '```\nconst x = 1;\n```',
      error: null,
      anchor: null,
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.renderedLines).not.toBeNull();
    expect(vm.renderedLines!.some((l) => l.startsWith('[CODE]'))).toBe(true);
    expect(vm.renderedLines!.some((l) => l.includes('const x = 1;'))).toBe(true);
  });

  it('should parse list items', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: '- item1\n* item2',
      error: null,
      anchor: null,
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.renderedLines).not.toBeNull();
    expect(vm.renderedLines!.filter((l) => l.startsWith('[LIST]'))).toHaveLength(2);
    expect(vm.renderedLines!.some((l) => l.includes('item1'))).toBe(true);
    expect(vm.renderedLines!.some((l) => l.includes('item2'))).toBe(true);
  });

  it('should handle inline formatting', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: 'This is **bold** and *italic* text.',
      error: null,
      anchor: null,
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.renderedLines).not.toBeNull();
    expect(vm.renderedLines!.some((l) => l.includes('[BOLD]bold[/BOLD]'))).toBe(true);
    expect(vm.renderedLines!.some((l) => l.includes('[ITALIC]italic[/ITALIC]'))).toBe(true);
  });

  it('should resolve anchor to correct line', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide#installation',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: '# Title\n\nSome text.\n\n## Installation\n\nRun npm install.',
      error: null,
      anchor: 'installation',
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.anchorLine).not.toBeNull();
    const anchoredLine = vm.renderedLines![vm.anchorLine!];
    expect(anchoredLine).toContain('[H2]');
    expect(anchoredLine).toContain('Installation');
  });

  it('should return null anchorLine when anchor does not match', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide#nonexistent',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: '# Title\n## Subtitle',
      error: null,
      anchor: 'nonexistent',
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.anchorLine).toBeNull();
  });

  it('should return error state when content is null', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: null,
      error: 'Network error',
      anchor: null,
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.renderedLines).toBeNull();
    expect(vm.error).toBe('Network error');
    expect(vm.content).toBeNull();
  });

  it('should strip markdown links and preserve text', () => {
    const result: DocContentResult = {
      url: 'https://mock-docs.test.qwencloud.com/guide',
      resolvedMarkdownUrl: 'https://mock-docs.test.qwencloud.com/guide.md',
      content: 'See [the docs](https://example.org) for details.',
      error: null,
      anchor: null,
    };
    const vm = buildDocContentViewModel(result);
    expect(vm.renderedLines).not.toBeNull();
    expect(vm.renderedLines![0]).toContain('the docs');
    expect(vm.renderedLines![0]).not.toContain('https://example.org');
  });
});

describe('DocsSearchItemViewModel index', () => {
  it('should assign 1-based index to items on page 1', () => {
    const vm = buildDocsSearchViewModel(
      makeResponse([makeItem(), makeItem(), makeItem()]),
      { query: 'test', page: 1, pageSize: 20 },
    );
    expect(vm.items[0].index).toBe(1);
    expect(vm.items[1].index).toBe(2);
    expect(vm.items[2].index).toBe(3);
  });

  it('should assign offset index on page 2 with pageSize=20', () => {
    const data: DocsSearchResponse = {
      totalCount: 40,
      page: 2,
      pageSize: 20,
      items: [makeItem(), makeItem()],
    };
    const vm = buildDocsSearchViewModel(data, { query: 'test', page: 2, pageSize: 20 });
    expect(vm.items[0].index).toBe(21);
    expect(vm.items[1].index).toBe(22);
  });
});

/**
 * Command-layer tests for `docs search <query>`.
 *
 * Coverage targets:
 *   1. `--format json` returns the documented payload shape with diagnostics.
 *   2. `--format text` strips <em> tags and prints titles.
 *   3. `--format table` triggers the Ink renderer with a vm prop.
 *   4. flag forwarding: --limit / --page / --language + the
 *      positional <query>.
 *   5. degradation: per-row missing fields → JSON has isDegraded=true; ≥50%
 *      degraded → top-level diagnostics contains 'search.fields_incomplete'.
 *   6. empty result set → items=[], diagnostics=[].
 *   7. error path: network timeout / 5xx → exit 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';
import { renderInkForTest, clearRenderedFrames } from '../../helpers/ink-render-mock.js';

const holder: { client: ApiClient } = { client: makeMockApiClient() };

const { renderWithInkSpy, renderInteractiveSpy } = vi.hoisted(() => ({
  renderWithInkSpy: vi.fn<(el: any) => Promise<void>>(),
  renderInteractiveSpy: vi.fn<(el: any) => Promise<void>>(),
}));

vi.mock('../../../src/api/client.js', () => ({
  createClient: async () => holder.client,
}));
vi.mock('../../../src/auth/credentials.js', () => ({
  // docs search is authOptional — credentials.ensureAuthenticated must NOT
  // be invoked, but we stub it for safety in case the command shares the
  // helper. The Service-layer `authOptional: true` flag is asserted in the
  // dedicated docs-service.test.ts.
  ensureAuthenticated: () => ({}),
}));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: renderWithInkSpy,
  renderInteractive: renderInteractiveSpy,
  renderWithInkSync: renderWithInkSpy,
}));

const { docsSearchAction } = await import('../../../src/commands/docs/search.js');

const getClient = async () => holder.client as any;

beforeEach(() => {
  holder.client = makeMockApiClient();
  renderWithInkSpy.mockReset();
  renderWithInkSpy.mockImplementation(renderInkForTest);
  renderInteractiveSpy.mockReset();
  renderInteractiveSpy.mockImplementation(renderInkForTest);
  clearRenderedFrames();
});

function buildSearch(program: import('commander').Command) {
  const docs = program.command('docs');
  const search = docs
    .command('search <query>')
    .option('--limit <n>', '', (v: string) => parseInt(v, 10))
    .option('--page <n>', '', (v: string) => parseInt(v, 10))
    .option('--language <lang>')
    .option('--view <index>');
  search.action(docsSearchAction(search, getClient));
}

const completeItem = {
  title: 'Model releases',
  highlightedTitle: 'Model releases — <em>qwen3</em>',
  subBizType: 'Changelog',
  url: 'https://docs.test.qwencloud.com/changelog/models',
  summary: 'qwen3.7-max is now available',
  highlightedSummary: '<em>qwen3</em>.7-max is now available',
  breadcrumb: ['Changelog', 'Model releases'],
};

describe('docs search command', () => {
  describe('JSON mode', () => {
    it('happy path → returns documented payload shape, exit 0', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
      });

      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'json']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stderr).toBe('');

      const payload = JSON.parse(r.stdout);
      expect(payload).toHaveProperty('query');
      expect(payload).toHaveProperty('totalCount');
      expect(payload).toHaveProperty('page');
      expect(payload).toHaveProperty('pageSize');
      expect(payload).toHaveProperty('items');
      expect(payload).toHaveProperty('diagnostics');
      expect(payload.query).toBe('qwen3');
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toHaveProperty('title');
      expect(payload.items[0]).toHaveProperty('url');
      expect(payload.items[0]).toHaveProperty('isDegraded');
      expect(payload.items[0].isDegraded).toBe(false);
    });

    it('preserves <em> tags in JSON output (highlightedTitle / highlightedSummary)', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'json']);
      const payload = JSON.parse(r.stdout);
      expect(payload.items[0].highlightedTitle).toContain('<em>');
    });

    it('degraded items → isDegraded=true; ≥50% degraded → top-level diagnostics tag', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 3,
          page: 1,
          pageSize: 20,
          items: [
            { ...completeItem, url: '' },                        // degraded
            { ...completeItem, title: '', highlightedTitle: '' }, // degraded
            completeItem,                                         // complete
          ],
        }),
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'json']);
      const payload = JSON.parse(r.stdout);

      expect(payload.items[0].isDegraded).toBe(true);
      expect(payload.items[1].isDegraded).toBe(true);
      expect(payload.items[2].isDegraded).toBe(false);
      expect(payload.diagnostics).toContain('search.fields_incomplete');
    });

    it('empty results → items=[] and diagnostics=[]', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({ totalCount: 0, page: 1, pageSize: 20, items: [] }),
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'no-match-qwen3', '--format', 'json']);
      const payload = JSON.parse(r.stdout);
      expect(payload.items).toEqual([]);
      expect(payload.diagnostics).toEqual([]);
      expect(payload.totalCount).toBe(0);
    });
  });

  describe('text mode', () => {
    it('strips <em> tags, prints titles to stdout', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'text']);
      expect(r.exitCode).toBeUndefined();
      expect(r.stdout).toContain('Model releases');
      expect(r.stdout).not.toContain('<em>');
      expect(r.stdout).not.toContain('</em>');
    });
  });

  describe('flag forwarding', () => {
    it('forwards --limit / --page / --language and the positional query', async () => {
      let captured: Record<string, unknown> = {};
      holder.client = makeMockApiClient({
        searchDocs: async (opts) => {
          captured = opts as unknown as Record<string, unknown>;
          return { totalCount: 0, page: opts.page ?? 1, pageSize: opts.limit ?? 20, items: [] };
        },
      });
      const r = await runCommand(buildSearch, [
        'docs', 'search', 'qwen3',
        '--limit', '50',
        '--page', '2',
        '--language', 'zh',
        '--format', 'json',
      ]);
      expect(r.exitCode).toBeUndefined();
      expect(captured.query).toBe('qwen3');
      expect(captured.limit).toBe(50);
      expect(captured.page).toBe(2);
      expect(captured.language).toBe('zh');
    });
  });

  describe('Ink rendering (table mode)', () => {
    it('triggers Ink with a vm prop containing items + diagnostics', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'table']);
      expect(r.exitCode).toBeUndefined();
      expect(renderInteractiveSpy).toHaveBeenCalledTimes(1);
      const el = renderInteractiveSpy.mock.calls[0][0];
      expect(el.props.initialVm.items).toHaveLength(1);
      expect(Array.isArray(el.props.initialVm.diagnostics)).toBe(true);
    });
  });

  describe('error path', () => {
    it('network timeout → exit 1, error to stderr', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => {
          throw new Error('Network timeout: connection reset');
        },
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'json']);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('Network timeout');
    });

    it('upstream gateway error → exit 1', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => {
          throw new Error('GatewayError: ApiInternalError');
        },
      });
      const r = await runCommand(buildSearch, ['docs', 'search', 'qwen3', '--format', 'json']);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('ApiInternalError');
    });
  });

  describe('--view flag', () => {
    it('should output document content in JSON format', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
        fetchDocContent: async (url: string) => ({
          url,
          resolvedMarkdownUrl: url + '.md',
          content: '# Getting Started\n\nWelcome.',
          error: null,
          anchor: null,
        }),
      });

      const r = await runCommand(buildSearch, [
        'docs', 'search', 'qwen3', '--view', '1', '--format', 'json',
      ]);
      expect(r.exitCode).toBeUndefined();

      const payload = JSON.parse(r.stdout);
      expect(payload).toHaveProperty('url');
      expect(payload).toHaveProperty('resolvedMarkdownUrl');
      expect(payload).toHaveProperty('content');
      expect(payload).toHaveProperty('contentType', 'markdown');
      expect(payload.content).toContain('Getting Started');
      expect(payload.error).toBeNull();
    });

    it('should output document content in TEXT format', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
        fetchDocContent: async (url: string) => ({
          url,
          resolvedMarkdownUrl: url + '.md',
          content: '# Getting Started\n\nWelcome to the docs.',
          error: null,
          anchor: null,
        }),
      });

      const r = await runCommand(buildSearch, [
        'docs', 'search', 'qwen3', '--view', '1', '--format', 'text',
      ]);
      expect(r.exitCode).toBeUndefined();
      expect(r.stdout).toContain('Source:');
      expect(r.stdout).toContain('Getting Started');
    });

    it('should error on invalid view index (out of range)', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
      });

      const r = await runCommand(buildSearch, [
        'docs', 'search', 'qwen3', '--view', '999', '--format', 'json',
      ]);
      expect(r.stderr).toContain('out of range');
    });

    it('should handle fetch failure in --view mode (JSON)', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
        fetchDocContent: async (url: string) => ({
          url,
          resolvedMarkdownUrl: url + '.md',
          content: null,
          error: 'HTTP 404',
          anchor: null,
        }),
      });

      const r = await runCommand(buildSearch, [
        'docs', 'search', 'qwen3', '--view', '1', '--format', 'json',
      ]);

      const payload = JSON.parse(r.stdout);
      expect(payload.content).toBeNull();
      expect(payload.error).toBe('HTTP 404');
    });

    it('should handle fetch failure in --view mode (TEXT)', async () => {
      holder.client = makeMockApiClient({
        searchDocs: async () => ({
          totalCount: 1,
          page: 1,
          pageSize: 20,
          items: [completeItem],
        }),
        fetchDocContent: async (url: string) => ({
          url,
          resolvedMarkdownUrl: url + '.md',
          content: null,
          error: 'Request timed out',
          anchor: null,
        }),
      });

      const r = await runCommand(buildSearch, [
        'docs', 'search', 'qwen3', '--view', '1', '--format', 'text',
      ]);
      expect(r.stderr).toContain('Request timed out');
    });
  });
});

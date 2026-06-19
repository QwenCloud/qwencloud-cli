/**
 * Unit tests for DocsService — search-only service that calls the public
 * search-maas endpoint.
 *
 * The service is expected to:
 *   1. Issue callFlatApi with product='aliyun-search-maas', action='SearchAll',
 *      and authOptional=true (Bearer attached when logged in, omitted otherwise).
 *   2. Forward QueryWord / Limit / PageNo / Language inside QuerySceneParams.
 *   3. Apply the documented defaults: limit=20, page=1.
 *   4. Tolerate empty result sets without throwing.
 *   5. Propagate upstream errors (network timeout, 5xx) verbatim.
 *   6. Pass the raw envelope content through to the caller; downstream
 *      adaptation (degradation, <em> handling) is the ViewModel's concern.
 *   7. fetchDocContent: resolve markdown URL, parse anchors, handle fetch errors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DocsSearchResponse, DocsIndexEntry } from '../../src/types/docs.js';
import { DocsService } from '../../src/services/docs-service.js';
import type { ApiClient } from '../../src/api/api-client.js';
import { site } from '../../src/site.js';

// Redirect index cache to a per-test temp directory so tests exercise the real
// fs layer without polluting the user's home cache. The `getCacheFilePath`
// indirection is the documented persistence seam shared with FileCache.
const pathsState = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('../../src/config/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/paths.js')>();
  return {
    ...actual,
    getCacheDir: () => pathsState.cacheDir,
    getCacheFilePath: (fileName: string) => join(pathsState.cacheDir, fileName),
  };
});

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
  callEnvelopeApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn(), callEnvelopeApi: vi.fn() };
}

describe('DocsService.searchDocs', () => {
  let apiClient: MockApiClient;
  let service: DocsService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new DocsService(apiClient as unknown as ApiClient);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request shape', () => {
    it('issues callFlatApi with the documented product / action / authOptional', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        totalCount: 0,
        pageNo: 1,
        pageSize: 20,
        items: [],
      });

      await service.searchDocs({ query: 'qwen3' });

      expect(apiClient.callFlatApi).toHaveBeenCalledTimes(1);
      const opts = apiClient.callFlatApi.mock.calls[0][0] as {
        product: string;
        action: string;
        authOptional?: boolean;
        params?: Record<string, unknown>;
      };
      expect(opts.product).toBe('aliyun-search-maas');
      expect(opts.action).toBe('SearchAll');
      expect(opts.authOptional).toBe(true);
    });

    it('forwards QueryWord / Limit / PageNo / Language inside QuerySceneParams', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        totalCount: 0,
        pageNo: 1,
        pageSize: 50,
        items: [],
      });

      await service.searchDocs({
        query: 'qwen3',
        limit: 50,
        page: 3,
        language: 'zh',
      });

      const opts = apiClient.callFlatApi.mock.calls[0][0] as { params: Record<string, unknown> };
      const qsp = opts.params.QuerySceneParams as Record<string, unknown>;
      expect(qsp.QueryWord).toBe('qwen3');
      expect(qsp.Limit).toBe(50);
      expect(qsp.PageNo).toBe(3);
      expect(qsp.Language).toBe('zh');
    });

    it('applies documented defaults (limit=20, page=1) when omitted', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        totalCount: 0,
        pageNo: 1,
        pageSize: 20,
        items: [],
      });

      await service.searchDocs({ query: 'qwen3' });

      const opts = apiClient.callFlatApi.mock.calls[0][0] as { params: Record<string, unknown> };
      const qsp = opts.params.QuerySceneParams as Record<string, unknown>;
      expect(qsp.Limit).toBe(20);
      expect(qsp.PageNo).toBe(1);
    });
  });

  describe('response handling', () => {
    it('passes a complete-fields response through verbatim', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        totalCount: 2,
        pageNo: 1,
        pageSize: 20,
        items: [
          {
            title: 'Model releases',
            highlightedTitle: 'Model releases — <em>qwen3</em>',
            subBizType: 'Changelog',
            url: 'https://docs.test.qwencloud.com/changelog/models',
            summary: 'qwen3.7-max …',
            highlightedSummary: '<em>qwen3</em>.7-max …',
            breadcrumb: ['Changelog', 'Model releases'],
          },
          {
            title: 'Quick Start',
            highlightedTitle: 'Quick Start',
            subBizType: 'Developer Guide',
            url: 'https://docs.test.qwencloud.com/developer-guides/getting-started',
            summary: 'Get started …',
            highlightedSummary: 'Get started …',
            breadcrumb: ['Developer Guide', 'Quick Start'],
          },
        ],
      });

      const r: DocsSearchResponse = await service.searchDocs({ query: 'qwen3' });

      expect(r.totalCount).toBe(2);
      expect(r.items).toHaveLength(2);
      expect(r.items[0].title).toBe('Model releases');
      expect(r.items[0].url).toBe('https://docs.test.qwencloud.com/changelog/models');
    });

    it('returns an empty result set without throwing', async () => {
      apiClient.callFlatApi.mockResolvedValue({
        totalCount: 0,
        pageNo: 1,
        pageSize: 20,
        items: [],
      });

      const r = await service.searchDocs({ query: 'no-match-qwen3' });

      expect(r.totalCount).toBe(0);
      expect(r.items).toEqual([]);
    });

    it('passes incomplete-fields (degraded) responses through unchanged for ViewModel adaptation', async () => {
      // Service must not pre-filter degraded items: that decision lives in the
      // ViewModel layer where the diagnostics tag and per-row isDegraded flag
      // are emitted.
      apiClient.callFlatApi.mockResolvedValue({
        totalCount: 1,
        pageNo: 1,
        pageSize: 20,
        items: [{ subBizType: 'Changelog', summary: 'orphan' }],
      });

      const r = await service.searchDocs({ query: 'qwen3' });

      expect(r.items).toHaveLength(1);
      // Service does NOT decorate isDegraded; that is the ViewModel's job.
    });
  });

  describe('error propagation', () => {
    it('propagates network timeout errors verbatim', async () => {
      apiClient.callFlatApi.mockRejectedValue(new Error('Network timeout: connection reset'));

      await expect(service.searchDocs({ query: 'qwen3' })).rejects.toThrow(/Network timeout/);
    });

    it('propagates upstream gateway errors verbatim', async () => {
      apiClient.callFlatApi.mockRejectedValue(new Error('GatewayError: ApiInternalError'));

      await expect(service.searchDocs({ query: 'qwen3' })).rejects.toThrow(/ApiInternalError/);
    });
  });
});

describe('DocsService.fetchDocContent', () => {
  let apiClient: MockApiClient;
  let service: DocsService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new DocsService(apiClient as unknown as ApiClient);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch markdown content successfully', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '# Getting Started\n\nWelcome to QwenCloud.',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started',
    );

    expect(result.content).toBe('# Getting Started\n\nWelcome to QwenCloud.');
    expect(result.error).toBeNull();
    expect(result.resolvedMarkdownUrl).toBe(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started.md',
    );
  });

  it('should not double-append .md if URL already ends with .md', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '# Doc',
    });

    const result = await service.fetchDocContent('https://mock-docs.test.qwencloud.com/guide.md');

    expect(result.resolvedMarkdownUrl).toBe('https://mock-docs.test.qwencloud.com/guide.md');
  });

  it('should fetch .json URLs verbatim without appending .md', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '{"openapi":"3.0.0"}',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/openapi-wan27-video-editing.json',
    );

    expect(result.resolvedMarkdownUrl).toBe(
      'https://mock-docs.test.qwencloud.com/openapi-wan27-video-editing.json',
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mock-docs.test.qwencloud.com/openapi-wan27-video-editing.json',
      expect.any(Object),
    );
  });

  it('should fetch .txt URLs verbatim without appending .md', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => 'plain text',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/llms.txt',
    );

    expect(result.resolvedMarkdownUrl).toBe('https://mock-docs.test.qwencloud.com/llms.txt');
  });

  it('should append .md when extension is not whitelisted', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '# Doc',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/malicious.exe',
    );

    expect(result.resolvedMarkdownUrl).toBe(
      'https://mock-docs.test.qwencloud.com/malicious.exe.md',
    );
  });

  it('should append .md to slug paths without an extension', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '# Doc',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/guide/quickstart',
    );

    expect(result.resolvedMarkdownUrl).toBe(
      'https://mock-docs.test.qwencloud.com/guide/quickstart.md',
    );
  });

  it('should parse anchor from URL', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '# Title\n\n## Section Name\n\nContent here.',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started#section-name',
    );

    expect(result.anchor).toBe('section-name');
    expect(result.resolvedMarkdownUrl).toBe(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started.md',
    );
    expect(result.content).not.toBeNull();
  });

  it('should handle anchor with empty fragment', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '# Doc',
    });

    const result = await service.fetchDocContent('https://mock-docs.test.qwencloud.com/guide#');

    expect(result.anchor).toBeNull();
  });

  it('should handle fetch failure gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('Network unreachable'));

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('Network unreachable');
  });

  it('should handle non-200 response', async () => {
    fetchSpy.mockResolvedValue({
      status: 404,
      text: async () => 'Not Found',
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/nonexistent',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('HTTP 404');
  });

  it('should handle timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchSpy.mockRejectedValue(abortError);

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('Request timed out');
  });

  it('should handle unknown error type', async () => {
    fetchSpy.mockRejectedValue('string error');

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/getting-started',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('Unknown error');
  });

  it('should follow in-domain redirect to a qwencloud.com subdomain and fetch content', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        status: 301,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location'
              ? 'https://docs.qwencloud.com/developer-guides/moved-page.md'
              : null,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => '# Moved Page\n\nNew content.',
      });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/moved-page',
    );

    expect(result.error).toBeNull();
    expect(result.content).toBe('# Moved Page\n\nNew content.');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://docs.qwencloud.com/developer-guides/moved-page.md',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('should block redirect that targets an off-domain host', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location' ? 'https://evil.example.com/leak' : null,
      },
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/external',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('Cannot open this document.');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should error when redirect response lacks a Location header', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 301,
      headers: { get: () => null },
    });

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/no-location',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('Cannot open this document.');
  });

  it('should error after exceeding the 5-redirect limit', async () => {
    const inDomainRedirect = {
      status: 301,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location'
            ? 'https://docs.qwencloud.com/developer-guides/looping.md'
            : null,
      },
    };
    fetchSpy.mockResolvedValue(inDomainRedirect);

    const result = await service.fetchDocContent(
      'https://mock-docs.test.qwencloud.com/developer-guides/looping',
    );

    expect(result.content).toBeNull();
    expect(result.error).toBe('Cannot open this document.');
    // Initial request + 5 follow-ups = 6 calls before tripping the limit.
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});

describe('DocsService.buildDocsUrl', () => {
  let apiClient: MockApiClient;
  let service: DocsService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new DocsService(apiClient as unknown as ApiClient);
  });

  it('prepends the configured docs base URL to a relative path', () => {
    const result = service.buildDocsUrl('developer-guides/getting-started/pricing');
    expect(result).toBe(`${site.docsBaseUrl}/developer-guides/getting-started/pricing`);
  });

  it('strips a leading slash from the relative path before composing', () => {
    const result = service.buildDocsUrl('/developer-guides/getting-started/pricing');
    expect(result).toBe(`${site.docsBaseUrl}/developer-guides/getting-started/pricing`);
    expect(result).not.toContain('//developer');
  });

  it('passes a fully qualified https:// URL through with .md stripped', () => {
    const direct = 'https://mock-docs.test.qwencloud.com/resources/free-quota.md';
    expect(service.buildDocsUrl(direct)).toBe(
      'https://mock-docs.test.qwencloud.com/resources/free-quota',
    );
  });

  it('passes a fully qualified http:// URL through with .md stripped', () => {
    const direct = 'http://mock-docs.test.qwencloud.com/resources/free-quota.md';
    expect(service.buildDocsUrl(direct)).toBe(
      'http://mock-docs.test.qwencloud.com/resources/free-quota',
    );
  });

  it('passes a fully qualified URL without .md through verbatim', () => {
    const direct = 'https://mock-docs.test.qwencloud.com/resources/free-quota';
    expect(service.buildDocsUrl(direct)).toBe(direct);
  });

  it('preserves the #anchor suffix on the composed URL', () => {
    const result = service.buildDocsUrl('api-reference/chat/openai-chat#streaming');
    expect(result).toBe(`${site.docsBaseUrl}/api-reference/chat/openai-chat#streaming`);
    expect(result.endsWith('#streaming')).toBe(true);
  });

  it('handles an empty path without crashing and stays under the docs base URL', () => {
    const result = service.buildDocsUrl('');
    expect(result.startsWith(site.docsBaseUrl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadDocsIndex — TTL-bounded cache + Markdown-link parsing.
// ---------------------------------------------------------------------------

const SAMPLE_LLMS_TXT = `# QwenCloud Docs

> Documentation index for QwenCloud platform

## Getting Started

- [Pricing](https://docs.qwencloud.com/developer-guides/getting-started/pricing.md): Pay-as-you-go pricing for API usage
- [Quick Start](https://docs.qwencloud.com/developer-guides/getting-started/quick-start.md): Get started with QwenCloud CLI

## Models

- [Model List](https://docs.qwencloud.com/models/list.md): Available models catalog
- [Model Info](https://docs.qwencloud.com/models/info.md): Detailed model information

## Resources

- [Free Quota](https://docs.qwencloud.com/resources/free-quota.md): Free-tier quota details
- [FAQ Billing](https://docs.qwencloud.com/resources/faq-billing.md): Payments and costs Q&A
`;

describe('DocsService.loadDocsIndex', () => {
  let apiClient: MockApiClient;
  let service: DocsService;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let cachePath: string;

  beforeEach(() => {
    pathsState.cacheDir = mkdtempSync(join(tmpdir(), 'qwencloud-llms-index-'));
    cachePath = join(pathsState.cacheDir, 'llms-index.json');
    apiClient = makeMockApiClient();
    service = new DocsService(apiClient as unknown as ApiClient);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(pathsState.cacheDir, { recursive: true, force: true });
    pathsState.cacheDir = '';
  });

  it('reads a fresh local cache and skips the HTTP fetch', async () => {
    const cached: DocsIndexEntry[] = [
      {
        path: 'developer-guides/getting-started/pricing',
        fullUrl: 'https://docs.qwencloud.com/developer-guides/getting-started/pricing.md',
        title: 'Pricing',
        description: 'Pay-as-you-go pricing for API usage',
        section: 'Getting Started',
      },
    ];
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), entries: cached }),
      'utf8',
    );

    const result = await service.loadDocsIndex();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('developer-guides/getting-started/pricing');
    expect(result[0].title).toBe('Pricing');
  });

  it('refreshes the cache and refetches when the on-disk entry is older than 24h', async () => {
    const stale: DocsIndexEntry[] = [
      {
        path: 'old/entry',
        fullUrl: 'https://docs.qwencloud.com/old/entry.md',
        title: 'Old',
        description: 'stale',
        section: 'Old',
      },
    ];
    const staleFetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: staleFetchedAt, entries: stale }),
      'utf8',
    );
    fetchSpy.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => SAMPLE_LLMS_TXT,
    });

    const result = await service.loadDocsIndex();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestedUrl = String(fetchSpy.mock.calls[0][0]);
    expect(requestedUrl).toContain('llms.txt');
    // Returned data must reflect the fresh fetch, not the stale cache.
    expect(result.find((e) => e.path === 'old/entry')).toBeUndefined();
    expect(
      result.find((e) => e.path === 'developer-guides/getting-started/pricing'),
    ).toBeDefined();
    // Cache file must be updated on disk so the next call re-uses the fresh data.
    expect(existsSync(cachePath)).toBe(true);
    const persisted = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      entries: DocsIndexEntry[];
    };
    expect(
      persisted.entries.find((e) => e.path === 'developer-guides/getting-started/pricing'),
    ).toBeDefined();
  });

  it('fetches and persists a fresh cache when no local cache exists', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => SAMPLE_LLMS_TXT,
    });

    const result = await service.loadDocsIndex();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThanOrEqual(6);
    expect(existsSync(cachePath)).toBe(true);
    const persisted = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      entries: DocsIndexEntry[];
    };
    expect(persisted.entries.length).toBe(result.length);
  });

  it('parses each Markdown-link entry into the documented field shape', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => SAMPLE_LLMS_TXT,
    });

    const result = await service.loadDocsIndex();

    const pricing = result.find((e) => e.title === 'Pricing');
    expect(pricing).toBeDefined();
    if (!pricing) return;
    expect(pricing.path).toBe('developer-guides/getting-started/pricing');
    expect(pricing.fullUrl).toBe(
      'https://docs.qwencloud.com/developer-guides/getting-started/pricing.md',
    );
    expect(pricing.description).toBe('Pay-as-you-go pricing for API usage');
    expect(pricing.section).toBe('Getting Started');
  });

  it('returns an empty array when the upstream fetch rejects (silent degradation)', async () => {
    fetchSpy.mockRejectedValue(new Error('Network unreachable'));

    const result = await service.loadDocsIndex();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('returns an empty array when the upstream returns a non-200 status', async () => {
    fetchSpy.mockResolvedValue({
      status: 503,
      ok: false,
      text: async () => 'Service Unavailable',
    });

    const result = await service.loadDocsIndex();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('tolerates malformed llms.txt content without throwing', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => 'not a llms.txt file\nrandom garbage\n###\n',
    });

    const result = await service.loadDocsIndex();

    expect(Array.isArray(result)).toBe(true);
    expect(result.every((e) => typeof e.path === 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveDocPath — pure path → ResolveResult mapper.
// ---------------------------------------------------------------------------

function makeIndex(): DocsIndexEntry[] {
  return [
    {
      path: 'developer-guides/getting-started/pricing',
      fullUrl: 'https://docs.qwencloud.com/developer-guides/getting-started/pricing.md',
      title: 'Pricing',
      description: 'Pay-as-you-go pricing for API usage',
      section: 'Getting Started',
    },
    {
      path: 'developer-guides/getting-started/quick-start',
      fullUrl: 'https://docs.qwencloud.com/developer-guides/getting-started/quick-start.md',
      title: 'Quick Start',
      description: 'Get started with QwenCloud CLI',
      section: 'Getting Started',
    },
    {
      path: 'token-plan/overview',
      fullUrl: 'https://docs.qwencloud.com/token-plan/overview.md',
      title: 'Token Plan Overview',
      description: 'Token Plan subscription overview',
      section: 'Token Plan',
    },
    {
      path: 'coding-plan/overview',
      fullUrl: 'https://docs.qwencloud.com/coding-plan/overview.md',
      title: 'Coding Plan Overview',
      description: 'Coding Plan subscription overview',
      section: 'Coding Plan',
    },
    {
      path: 'resources/faq-billing',
      fullUrl: 'https://docs.qwencloud.com/resources/faq-billing.md',
      title: 'Billing FAQ',
      description: 'Payments and costs Q&A',
      section: 'Resources',
    },
  ];
}

describe('DocsService.resolveDocPath', () => {
  let apiClient: MockApiClient;
  let service: DocsService;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new DocsService(apiClient as unknown as ApiClient);
  });

  it('returns an exact match when input fully equals an indexed path', () => {
    const index = makeIndex();
    const result = service.resolveDocPath('developer-guides/getting-started/pricing', index);

    expect(result.type).toBe('exact');
    if (result.type === 'exact') {
      expect(result.url).toBe(
        'https://docs.qwencloud.com/developer-guides/getting-started/pricing.md',
      );
    }
  });

  it('treats a unique tail-fragment match as an exact resolution', () => {
    const index = makeIndex();
    const result = service.resolveDocPath('pricing', index);

    expect(result.type).toBe('exact');
    if (result.type === 'exact') {
      expect(result.url).toContain('developer-guides/getting-started/pricing');
    }
  });

  it('returns ambiguous when several entries share the same trailing segment', () => {
    const index = makeIndex();
    const result = service.resolveDocPath('overview', index);

    expect(result.type).toBe('ambiguous');
    if (result.type === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      const paths = result.candidates.map((c) => c.path);
      expect(paths).toContain('token-plan/overview');
      expect(paths).toContain('coding-plan/overview');
    }
  });

  it('returns notfound with fuzzy suggestions when input is a near-miss typo', () => {
    const index = makeIndex();
    // 'pricng' has no exact path, no suffix match, but is fuzzily close to 'pricing'.
    const result = service.resolveDocPath('pricng', index);

    expect(result.type).toBe('notfound');
    if (result.type === 'notfound') {
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeLessThanOrEqual(5);
      expect(result.suggestions.some((s) => s.path.includes('pricing'))).toBe(true);
    }
  });

  it('returns notfound with empty suggestions when input has no overlap at all', () => {
    const index = makeIndex();
    const result = service.resolveDocPath('xyzzy-completely-unrelated-keyword', index);

    expect(result.type).toBe('notfound');
    if (result.type === 'notfound') {
      expect(result.suggestions).toEqual([]);
    }
  });

  it('returns notfound when the index itself is empty', () => {
    const result = service.resolveDocPath('developer-guides/getting-started/pricing', []);

    expect(result.type).toBe('notfound');
    if (result.type === 'notfound') {
      expect(result.suggestions).toEqual([]);
    }
  });

  it('caps the suggestion list at five entries when many candidates exist', () => {
    const oversized: DocsIndexEntry[] = [];
    for (let i = 0; i < 12; i++) {
      oversized.push({
        path: `section-${i}/pricing-detail`,
        fullUrl: `https://docs.qwencloud.com/section-${i}/pricing-detail.md`,
        title: `Pricing detail ${i}`,
        description: 'Pricing-related guide',
        section: `Section ${i}`,
      });
    }

    // 'pricing-detail' is the trailing segment of every entry → ambiguous with
    // 12 candidates pre-cap.
    const result = service.resolveDocPath('pricing-detail', oversized);

    expect(result.type).toBe('ambiguous');
    if (result.type === 'ambiguous') {
      expect(result.candidates.length).toBeLessThanOrEqual(5);
      expect(result.candidates.length).toBeGreaterThan(0);
    }
  });
});

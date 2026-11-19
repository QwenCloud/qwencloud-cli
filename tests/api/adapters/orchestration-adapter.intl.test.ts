import { describe, expect, it, vi } from 'vitest';
import {
  buildOrchestrationRequest,
  unwrapOrchestrationResponse,
} from '../../../src/api/adapters/orchestration-adapter.js';

describe('International read-only orchestration requests', () => {
  it.each([
    ['/data/publicCustom.json', 'none', 'GetCommodity'],
    ['/data/publicCustom.json', 'optional', 'GetCommodity'],
    ['/data/custom.json', 'required', 'GetCommodity'],
    ['/data/publicCustom.json', 'optional', 'QueryOrderLight'],
    ['/data/custom.json', 'required', 'QueryInstance'],
  ] as const)('preserves %s and %s authentication for %s', (path, authMode, action) => {
    const params = { commodityCode: 'sfm_tokenplansolo_public_intl', orderType: 'BUY' };
    const request = buildOrchestrationRequest({ action, params, path, authMode });
    const form = new URLSearchParams(request.body);
    const url = new URL(request.url);

    expect(url.pathname).toBe(path);
    expect(url.searchParams.getAll('product')).toEqual(['occa-payment']);
    expect(url.searchParams.getAll('action')).toEqual([action]);
    expect(url.searchParams.has('params')).toBe(false);
    expect(request.method).toBe('POST');
    expect(request.authMode).toBe(authMode);
    expect(request.headers?.['Content-Type']).toContain('application/x-www-form-urlencoded');
    expect(form.get('product')).toBe('occa-payment');
    expect(form.get('action')).toBe(action);
    expect(form.get('region')).toBe('ap-southeast-1');
    expect(JSON.parse(form.get('params') ?? 'null')).toEqual(params);
    expect(params).toEqual({ commodityCode: 'sfm_tokenplansolo_public_intl', orderType: 'BUY' });
  });

  it('carries cancellation outside the serialized business parameters', () => {
    const controller = new AbortController();
    const request = buildOrchestrationRequest({
      action: 'QueryOrderLight',
      params: { quantity: 1, autoRenew: false },
      path: '/data/publicCustom.json',
      authMode: 'none',
      signal: controller.signal,
    });

    expect(request.signal).toBe(controller.signal);
    expect(new URL(request.url).searchParams.getAll('action')).toEqual(['QueryOrderLight']);
    expect(new URLSearchParams(request.body).get('params')).toBe(
      '{"quantity":1,"autoRenew":false}',
    );
    expect(request.body).not.toContain('signal');
  });
});

describe('Orchestration response parsing', () => {
  it.each([true, undefined])(
    'passes the outer data to the supplied parser with successResponse=%s',
    (successResponse) => {
      const data = { price: { order: { standPrice: 20, currency: 'USD' } } };
      const parse = vi.fn((raw: unknown) => ({ parsed: raw }));

      const result = unwrapOrchestrationResponse({ code: '200', successResponse, data }, parse);

      expect(parse).toHaveBeenCalledExactlyOnceWith(data);
      expect(result).toEqual({ parsed: data });
    },
  );

  it.each([
    { code: '500', successResponse: true, data: {} },
    { code: '200', successResponse: false, data: {} },
    { code: '200', successResponse: true },
    null,
    {},
  ])('rejects an unsuccessful or missing envelope before parsing: %j', (raw) => {
    const parse = vi.fn((data: unknown) => data);

    expect(() => unwrapOrchestrationResponse(raw, parse)).toThrow();
    expect(parse).not.toHaveBeenCalled();
  });
});

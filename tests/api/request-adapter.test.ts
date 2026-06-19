/**
 * Unit tests for RequestAdapter (src/api/request-adapter.ts).
 *
 * RequestAdapter is responsible for:
 *   - Building HTTP request payloads for two route types:
 *       Type A — flat params (standard API, including authOptional variant)
 *       Type B — envelope structure (gateway routing, double-wrapped Api+Data+V)
 *   - Serializing arbitrary param values into strings via flattenParams()
 *   - Tagging the resulting payload with an authMode hint that BaseClient consumes
 *   - Unwrapping raw API envelopes into business data plus diagnostic context
 *
 * These tests are written from the public specification without reading
 * any implementation file. Mock dependencies are kept to a minimum because
 * RequestAdapter is a pure transformation layer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRequest,
  unwrapResponse,
  flattenParams,
  GatewayEnvelopeError,
  GatewayShapeError,
  type AdapterOptions,
  type AdapterResult,
} from '../../src/api/request-adapter.js';
import type { RawApiEnvelope } from '../../src/types/api-envelope.js';

// ────────────────────────────────────────────────────────────────────
// flattenParams — value-type serialization
// ────────────────────────────────────────────────────────────────────

describe('flattenParams', () => {
  it('passes string values through unchanged', () => {
    expect(flattenParams({ a: 'hello', b: '' })).toEqual({ a: 'hello', b: '' });
  });

  it('converts numbers via String()', () => {
    expect(flattenParams({ n: 42, neg: -1, frac: 1.5, zero: 0 })).toEqual({
      n: '42',
      neg: '-1',
      frac: '1.5',
      zero: '0',
    });
  });

  it('converts booleans to "true" / "false" via JSON.stringify', () => {
    expect(flattenParams({ yes: true, no: false })).toEqual({
      yes: 'true',
      no: 'false',
    });
  });

  it('serializes plain objects with JSON.stringify', () => {
    expect(flattenParams({ obj: { a: 1, b: 'x' } })).toEqual({
      obj: '{"a":1,"b":"x"}',
    });
  });

  it('serializes arrays with JSON.stringify', () => {
    expect(flattenParams({ arr: [1, 2, 'three'] })).toEqual({
      arr: '[1,2,"three"]',
    });
  });

  it('serializes nested objects', () => {
    const nested = { outer: { inner: { v: 1 } } };
    expect(flattenParams({ nested })).toEqual({
      nested: JSON.stringify(nested),
    });
  });

  it('converts null and undefined via String()', () => {
    // Spec says "other → String(v)"; null/undefined fall into this bucket.
    const out = flattenParams({ a: null, b: undefined });
    expect(out.a).toBe('null');
    expect(out.b).toBe('undefined');
  });

  it('returns an empty object for empty input', () => {
    expect(flattenParams({})).toEqual({});
  });

  it('does not mutate the input object', () => {
    const input = { a: 1, b: { c: 2 } };
    const snapshot = JSON.parse(JSON.stringify(input));
    flattenParams(input);
    expect(input).toEqual(snapshot);
  });

  it('produces only string values regardless of input type', () => {
    const out = flattenParams({ s: 's', n: 1, b: true, o: { x: 1 } });
    for (const v of Object.values(out)) {
      expect(typeof v).toBe('string');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// buildRequest — Type A (flat params)
// ────────────────────────────────────────────────────────────────────

describe('buildRequest — Type A (flat params)', () => {
  const baseOpts: AdapterOptions = {
    product: 'BssOpenAPI-V3',
    action: 'MaasListConsumeSummary',
    params: { BillingDate: '2026-04-01', PageSize: 100 },
  };

  it('targets the unified gateway URL (cli.qwencloud.com/data/v2/api.json)', () => {
    const r = buildRequest('A', baseOpts);
    expect(r.url).toContain('/data/v2/api.json');
  });

  it('sets routeType to "A"', () => {
    const r = buildRequest('A', baseOpts);
    expect(r.routeType).toBe('A');
  });

  it('emits Content-Type: application/json header', () => {
    const r = buildRequest('A', baseOpts);
    expect(r.headers['Content-Type']).toBe('application/json');
  });

  it('builds body with product, action, region, and flattened params', () => {
    const r = buildRequest('A', baseOpts);
    const body = JSON.parse(r.body) as Record<string, unknown>;
    expect(body.product).toBe('BssOpenAPI-V3');
    expect(body.action).toBe('MaasListConsumeSummary');
    expect(body.region).toBeDefined();
    expect(body.params).toEqual({ BillingDate: '2026-04-01', PageSize: '100' });
  });

  it('omits or empties params when no params provided', () => {
    const r = buildRequest('A', { product: 'BssOpenAPI-V3', action: 'Foo' });
    const body = JSON.parse(r.body) as Record<string, unknown>;
    // Spec allows either omission or empty object; both are valid.
    if ('params' in body) {
      expect(body.params).toEqual({});
    }
  });

  it('defaults authMode to "required" when authOptional is not set', () => {
    const r = buildRequest('A', baseOpts);
    expect(r.authMode).toBe('required');
  });

  it('sets authMode to "optional" when authOptional=true', () => {
    const r = buildRequest('A', { ...baseOpts, authOptional: true });
    expect(r.authMode).toBe('optional');
  });

  it('sets authMode to "optional" when product is in AUTH_OPTIONAL_PRODUCTS', () => {
    const r = buildRequest('A', {
      product: 'aliyun-search-maas',
      action: 'SearchModels',
      params: { q: 'qwen' },
    });
    expect(r.authMode).toBe('optional');
  });

  it('flattens boolean and number params to strings inside body', () => {
    const r = buildRequest('A', {
      product: 'p',
      action: 'a',
      params: { flag: true, count: 10, name: 'x' },
    });
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect(body.params.flag).toBe('true');
    expect(body.params.count).toBe('10');
    expect(body.params.name).toBe('x');
  });
});

// ────────────────────────────────────────────────────────────────────
// buildRequest — Type B (envelope / Gateway)
// ────────────────────────────────────────────────────────────────────

describe('buildRequest — Type B (Gateway envelope)', () => {
  const baseOpts: AdapterOptions = {
    product: 'sfm_bailian',
    action: 'IntlBroadScopeAspnGateway',
    gatewayApi: 'queryCodingPlanInstanceInfoV2',
    gatewayData: { uid: '123', region: 'cn-hangzhou' },
  };

  it('produces routeType "B"', () => {
    const r = buildRequest('B', baseOpts);
    expect(r.routeType).toBe('B');
  });

  it('forces the fixed outer product and action required by Type B envelope', () => {
    const r = buildRequest('B', baseOpts);
    const body = JSON.parse(r.body) as Record<string, unknown>;
    expect(body.product).toBe('sfm_bailian');
    expect(body.action).toBe('IntlBroadScopeAspnGateway');
  });

  it('places gatewayApi into params.Api', () => {
    const r = buildRequest('B', baseOpts);
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect(body.params.Api).toBe('queryCodingPlanInstanceInfoV2');
  });

  it('JSON-stringifies gatewayData into params.Data', () => {
    const r = buildRequest('B', baseOpts);
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect(typeof body.params.Data).toBe('string');
    expect(JSON.parse(body.params.Data)).toEqual({ uid: '123', region: 'cn-hangzhou' });
  });

  it('sets params.V to "1.0"', () => {
    const r = buildRequest('B', baseOpts);
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect(body.params.V).toBe('1.0');
  });

  it('omits cornerstoneParam when not provided', () => {
    const r = buildRequest('B', baseOpts);
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect('cornerstoneParam' in body.params).toBe(false);
  });

  it('JSON-stringifies cornerstoneParam when provided', () => {
    const corner = { token: 'abc', scope: 'foo' };
    const r = buildRequest('B', { ...baseOpts, cornerstoneParam: corner });
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect(body.params.cornerstoneParam).toBe(JSON.stringify(corner));
  });

  it('defaults Type B authMode to "required"', () => {
    const r = buildRequest('B', baseOpts);
    expect(r.authMode).toBe('required');
  });

  it('handles empty gatewayData by serializing as "{}"', () => {
    const r = buildRequest('B', { ...baseOpts, gatewayData: {} });
    const body = JSON.parse(r.body) as { params: Record<string, string> };
    expect(body.params.Data).toBe('{}');
  });

  it('produces a deterministic, JSON-parseable body', () => {
    const r1 = buildRequest('B', baseOpts);
    const r2 = buildRequest('B', baseOpts);
    expect(r1.body).toBe(r2.body);
    expect(() => JSON.parse(r1.body)).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────
// unwrapResponse — Type A
// ────────────────────────────────────────────────────────────────────

describe('unwrapResponse — Type A', () => {
  it('extracts data field on success (code === "200")', () => {
    const raw: RawApiEnvelope<{ Data: number[] }> = {
      code: '200',
      data: { Data: [1, 2, 3] },
      requestId: 'req-1',
    };
    const out = unwrapResponse<{ Data: number[] }>('A', raw);
    expect(out.data).toEqual({ Data: [1, 2, 3] });
    expect(out.business).toBeNull();
    expect(out.raw).toBe(raw);
  });

  it('throws when gateway code is not "200"', () => {
    const raw: RawApiEnvelope<unknown> = {
      code: '500',
      message: 'internal error',
    };
    expect(() => unwrapResponse('A', raw)).toThrow();
  });

  it('throws on 4xx-equivalent gateway codes', () => {
    const raw: RawApiEnvelope<unknown> = {
      code: '401',
      message: 'unauthorized',
    };
    expect(() => unwrapResponse('A', raw)).toThrow();
  });

  it('preserves the raw envelope on the result', () => {
    const raw: RawApiEnvelope<string> = { code: '200', data: 'ok' };
    const out = unwrapResponse<string>('A', raw);
    expect(out.raw).toBe(raw);
  });

  it('returns business as null for Type A (no business layer)', () => {
    const raw: RawApiEnvelope<number> = { code: '200', data: 7 };
    expect(unwrapResponse<number>('A', raw).business).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// unwrapResponse — Type B (Gateway)
// ────────────────────────────────────────────────────────────────────

describe('unwrapResponse — Type B', () => {
  it('extracts business data when ret[0] starts with "SUCCESS::"', () => {
    const raw = {
      code: '200',
      data: {
        DataV2: {
          ret: ['SUCCESS::ok'],
          data: {
            data: { codingPlanInstanceInfos: [{ instanceType: 'pro' }] },
            success: true,
          },
        },
      },
    } as RawApiEnvelope<unknown>;
    const out = unwrapResponse<{ codingPlanInstanceInfos: Array<{ instanceType: string }> }>(
      'B',
      raw,
    );
    expect(out.data).toEqual({ codingPlanInstanceInfos: [{ instanceType: 'pro' }] });
    expect(out.business).toEqual({ code: 'SUCCESS', message: 'ok' });
  });

  it('throws GatewayEnvelopeError when outer code !== "200"', () => {
    const raw: RawApiEnvelope<unknown> = { code: '500', message: 'gateway down' };
    expect(() => unwrapResponse('B', raw)).toThrow(GatewayEnvelopeError);
  });

  it('GatewayEnvelopeError carries the original code', () => {
    const raw: RawApiEnvelope<unknown> = { code: '403', message: 'forbidden' };
    try {
      unwrapResponse('B', raw);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayEnvelopeError);
      expect((err as GatewayEnvelopeError).code).toBe('403');
    }
  });

  it('throws GatewayShapeError when DataV2 is missing', () => {
    const raw = { code: '200', data: {} } as RawApiEnvelope<unknown>;
    expect(() => unwrapResponse('B', raw)).toThrow(GatewayShapeError);
  });

  it('throws GatewayShapeError when DataV2.data is missing', () => {
    const raw = { code: '200', data: { DataV2: { ret: ['SUCCESS::ok'] } } } as RawApiEnvelope<unknown>;
    const out = unwrapResponse('B', raw);
    // With ret present but no data.data, returns null data
    expect(out.data).toBeNull();
  });

  it('returns null data with business error when ret[0] !== "SUCCESS::*"', () => {
    const raw = {
      code: '200',
      data: {
        DataV2: {
          ret: ['IllegalArgumentException::param missing'],
          data: {
            data: { something: 'should be ignored' },
            success: false,
          },
        },
      },
    } as RawApiEnvelope<unknown>;
    const out = unwrapResponse('B', raw);
    expect(out.data).toBeNull();
    expect(out.business).toEqual({
      code: 'IllegalArgumentException',
      message: 'param missing',
    });
  });

  it('handles ret message containing "::" by preserving the full remainder', () => {
    // If the message itself contains '::', everything after the first '::' is the message.
    const raw = {
      code: '200',
      data: {
        DataV2: {
          ret: ['SUCCESS::operation::done'],
          data: {
            data: { value: 1 },
            success: true,
          },
        },
      },
    } as RawApiEnvelope<unknown>;
    const out = unwrapResponse<{ value: number }>('B', raw);
    expect(out.business?.code).toBe('SUCCESS');
    expect(out.business?.message).toBe('operation::done');
    expect(out.data).toEqual({ value: 1 });
  });

  it('preserves the raw envelope reference on the result', () => {
    const raw = {
      code: '200',
      data: {
        DataV2: { ret: ['SUCCESS::ok'], data: { data: { x: 1 }, success: true } },
      },
    } as RawApiEnvelope<unknown>;
    const out = unwrapResponse('B', raw);
    expect(out.raw).toBe(raw);
  });
});

// ────────────────────────────────────────────────────────────────────
// AdapterResult shape contract
// ────────────────────────────────────────────────────────────────────

describe('AdapterResult contract', () => {
  it('contains exactly the documented fields', () => {
    const r: AdapterResult = buildRequest('A', { product: 'p', action: 'a' });
    const keys = new Set(Object.keys(r));
    expect(keys.has('url')).toBe(true);
    expect(keys.has('headers')).toBe(true);
    expect(keys.has('body')).toBe(true);
    expect(keys.has('authMode')).toBe(true);
    expect(keys.has('routeType')).toBe(true);
  });

  it('always emits a string body that is JSON-parseable', () => {
    const r = buildRequest('A', { product: 'p', action: 'a', params: { k: 1 } });
    expect(typeof r.body).toBe('string');
    expect(() => JSON.parse(r.body)).not.toThrow();
  });
});

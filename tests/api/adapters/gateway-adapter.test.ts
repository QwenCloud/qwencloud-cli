/**
 * Pure function tests for GatewayAdapter (src/api/adapters/gateway-adapter.ts).
 *
 * GatewayAdapter handles:
 *   - Type B envelope request body construction
 *   - cornerstoneParam automatic injection based on api path
 *   - Business branch routing (namespace → config derivation)
 *   - ret error parsing from the envelope response
 *
 * All functions are pure transformations — no HTTP, no mocks, just data in/out.
 */
import { describe, it, expect } from 'vitest';

// ────────────────────────────────────────────────────────────────────
// cornerstoneParam injection
// ────────────────────────────────────────────────────────────────────

describe('GatewayAdapter — cornerstoneParam injection', () => {
  it('injects standard cornerstoneParam with required 6 fields', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'zeldaEasy.bailian-dash-workspace.space.listWorkspaces4Agent',
      data: { pageNo: 1, pageSize: 20 },
    });
    expect(result.cornerstoneParam).toBeDefined();
    const corner = result.cornerstoneParam!;
    // Must contain the documented 6 fields
    expect(corner).toHaveProperty('domain');
    expect(corner).toHaveProperty('consoleSite');
    expect(corner).toHaveProperty('console');
    expect(corner).toHaveProperty('xsp_lang');
    expect(corner).toHaveProperty('protocol');
    expect(corner).toHaveProperty('productCode');
  });

  it('does NOT inject switchAgent or sec_token in cornerstoneParam', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'zeldaEasy.bailian-telemetry.alertRule.listAlertRules',
      data: {},
    });
    const corner = result.cornerstoneParam!;
    expect(corner).not.toHaveProperty('switchAgent');
    expect(corner).not.toHaveProperty('sec_token');
  });

  it('allows explicit cornerstoneParam to override the auto-injected values', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const customCorner = {
      domain: 'custom-domain.test.qwencloud.com',
      consoleSite: 'custom',
      console: 'custom-console',
      xsp_lang: 'zh',
      protocol: 'https',
      productCode: 'custom-product',
    };
    const result = buildEnvelopePayload({
      api: 'test.api',
      data: {},
      cornerstoneParam: customCorner,
    });
    expect(result.cornerstoneParam?.domain).toBe('custom-domain.test.qwencloud.com');
    expect(result.cornerstoneParam?.productCode).toBe('custom-product');
  });
});

// ────────────────────────────────────────────────────────────────────
// Business branch routing
// ────────────────────────────────────────────────────────────────────

describe('GatewayAdapter — business branch routing', () => {
  it('derives productCode as p_efm (bailian-dash-workspace)', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'zeldaEasy.bailian-dash-workspace.api-key.listApiKeys4Agent',
      data: { description: '' },
    });
    expect(result.cornerstoneParam?.productCode).toBe('p_efm');
  });

  it('derives productCode as p_efm (bailian-telemetry)', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'zeldaEasy.bailian-telemetry.platform-model.listModelLogs',
      data: {},
    });
    expect(result.cornerstoneParam?.productCode).toBe('p_efm');
  });

  it('constructs Data field as a reqDTO + cornerstoneParam structure', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'zeldaEasy.bailian-dash-workspace.space.listWorkspaces4Agent',
      data: { pageNo: 1, pageSize: 20 },
    });
    expect(result.data).toBeDefined();
    expect(result.data.reqDTO).toBeDefined();
    expect(result.data.reqDTO.pageNo).toBe(1);
    expect(result.data.cornerstoneParam).toBeDefined();
  });

  it('wraps business data into reqDTO within Data', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'test.api.path',
      data: { bizSource: 'test', resourceType: 'model' },
    });
    expect(result.data.reqDTO.bizSource).toBe('test');
    expect(result.data.reqDTO.resourceType).toBe('model');
  });
});

// ────────────────────────────────────────────────────────────────────
// ret error parsing
// ────────────────────────────────────────────────────────────────────

describe('GatewayAdapter — ret error parsing', () => {
  it('parses "ErrorCode::message" into { code, message }', async () => {
    const { parseRetError } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = parseRetError('IllegalArgumentException::param xyz is required');
    expect(result.code).toBe('IllegalArgumentException');
    expect(result.message).toBe('param xyz is required');
  });

  it('handles message containing :: (preserves full remainder)', async () => {
    const { parseRetError } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = parseRetError('ServiceError::connection::timeout::retry');
    expect(result.code).toBe('ServiceError');
    expect(result.message).toBe('connection::timeout::retry');
  });

  it('returns code as full string and empty message when no :: present', async () => {
    const { parseRetError } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = parseRetError('UnknownError');
    expect(result.code).toBe('UnknownError');
    expect(result.message).toBe('');
  });

  it('returns empty code and message for empty string', async () => {
    const { parseRetError } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = parseRetError('');
    expect(result.code).toBe('');
    expect(result.message).toBe('');
  });

  it('identifies SUCCESS:: prefix as non-error', async () => {
    const { isSuccessRet } = await import('../../../src/api/adapters/gateway-adapter.js');
    expect(isSuccessRet('SUCCESS::ok')).toBe(true);
    expect(isSuccessRet('SUCCESS::operation completed')).toBe(true);
    expect(isSuccessRet('IllegalArgumentException::error')).toBe(false);
    expect(isSuccessRet('')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Envelope payload structure validation
// ────────────────────────────────────────────────────────────────────

describe('GatewayAdapter — envelope payload structure', () => {
  it('produces a serializable payload (no circular references)', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'test.api',
      data: { nested: { deep: { value: 42 } } },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('api field is preserved in the output', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({
      api: 'zeldaEasy.bailian-telemetry.platform-model.getModelStatistic',
      data: {},
    });
    expect(result.api).toBe('zeldaEasy.bailian-telemetry.platform-model.getModelStatistic');
  });

  it('handles empty data object', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const result = buildEnvelopePayload({ api: 'test.api', data: {} });
    expect(result.data.reqDTO).toEqual({});
  });

  it('does not mutate the input data object', async () => {
    const { buildEnvelopePayload } = await import('../../../src/api/adapters/gateway-adapter.js');
    const input = { key: 'value', nested: { a: 1 } };
    const snapshot = JSON.parse(JSON.stringify(input));
    buildEnvelopePayload({ api: 'test.api', data: input });
    expect(input).toEqual(snapshot);
  });
});

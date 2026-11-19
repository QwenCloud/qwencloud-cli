import { describe, expect, it } from 'vitest';
import {
  buildCsDataRequest,
  unwrapCsDataResponse,
} from '../../../src/api/adapters/cs-data-adapter.js';

const SUBSCRIPTION = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription';
const QUOTA = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config';
const USAGE = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';
const MODELS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listTokenPlanModels';
const PROVIDERS = 'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listModelProviders';

function successEnvelope(code: string | number, payload: unknown = { marker: 'business-result' }) {
  return {
    code: '200',
    successResponse: true,
    data: {
      success: true,
      errorCode: '',
      DataV2: {
        ret: ['SUCCESS::ok'],
        data: { code, success: true, data: payload },
      },
    },
  };
}

describe('International cs-data request contract', () => {
  it.each([
    [SUBSCRIPTION, { commodityCode: 'sfm_tokenplansolo_public_intl' }],
    [QUOTA, {}],
    [USAGE, {}],
    [MODELS, { input: { pageNo: 1, pageSize: 20, edition: 'PERSONAL' } }],
    [PROVIDERS, {}],
  ])('constructs the allowed API %s with international routing', (api, data) => {
    const request = buildCsDataRequest({ api, data });
    const url = new URL(request.url);
    const form = new URLSearchParams(request.body);
    const params = JSON.parse(form.get('params') ?? 'null') as {
      Api: string;
      V: string;
      Data: Record<string, unknown>;
    };

    expect(url.origin).toBe('https://ap-southeast-1-cs-data.qwencloud.com');
    expect(url.pathname).toBe('/cli/api.json');
    expect(url.searchParams.get('action')).toBe('IntlBroadScopeAspnGateway');
    expect(url.searchParams.get('product')).toBe('sfm_bailian');
    expect(url.searchParams.get('api')).toBe(api);
    expect(request.method).toBe('POST');
    expect(request.headers?.['Content-Type']).toContain('application/x-www-form-urlencoded');
    expect(form.get('region')).toBe('ap-southeast-1');
    expect(params.Api).toBe(api);
    expect(params.V).toBeTruthy();
    expect(params.Data).toEqual({
      ...data,
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        xsp_lang: 'en-US',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'QWENCLOUD',
      },
    });
  });

  it.each([
    [QUOTA, {}],
    [MODELS, { input: { pageNo: 2, pageSize: 20, edition: 'TEAM' } }],
    [PROVIDERS, {}],
  ])('allows anonymous access only to the public API %s', (api, data) => {
    const request = buildCsDataRequest({ api, data, authMode: 'none' });

    expect(request.authMode).toBe('none');
  });

  it.each([
    [SUBSCRIPTION, { commodityCode: 'sfm_tokenplansolo_public_intl' }],
    [USAGE, {}],
  ])('rejects anonymous account access to %s', (api, data) => {
    expect(() => buildCsDataRequest({ api, data, authMode: 'none' })).toThrow();
  });

  it.each([
    'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/addon/list',
    'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/purchase',
    'zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/unlisted',
  ])('rejects an API outside this read-only allowlist: %s', (api) => {
    expect(() => buildCsDataRequest({ api, data: {} })).toThrow();
  });

  it.each([
    { input: { pageNo: 0, pageSize: 20, edition: 'PERSONAL' } },
    { input: { pageNo: 1.5, pageSize: 20, edition: 'PERSONAL' } },
    { input: { pageNo: 1, pageSize: 0, edition: 'PERSONAL' } },
    { input: { pageNo: 1, pageSize: 20, edition: 'all' } },
    { pageNo: 1, pageSize: 20, edition: 'PERSONAL' },
  ])('rejects invalid model pagination or edition: %j', (data) => {
    expect(() => buildCsDataRequest({ api: MODELS, data, authMode: 'none' })).toThrow();
  });

  it('does not mutate caller data when adding protocol context', () => {
    const data = { input: { pageNo: 1, pageSize: 20, edition: 'PERSONAL' } };

    buildCsDataRequest({ api: MODELS, data, authMode: 'none' });

    expect(data).toEqual({ input: { pageNo: 1, pageSize: 20, edition: 'PERSONAL' } });
    expect(data).not.toHaveProperty('cornerstoneParam');
  });

  it('uses the explicit gateway without adding the protocol path twice', () => {
    const request = buildCsDataRequest({
      api: QUOTA,
      data: {},
      authMode: 'none',
      endpoint: 'https://mock-gateway.test.qwencloud.com/cli/api.json',
    });

    expect(new URL(request.url).pathname).toBe('/cli/api.json');
    expect(new URL(request.url).origin).toBe('https://mock-gateway.test.qwencloud.com');
  });
});

describe('cs-data layered success contract', () => {
  it.each([SUBSCRIPTION, QUOTA, USAGE])('accepts SUCCESS only for the personal API %s', (api) => {
    const payload = { marker: 'personal-business' };

    expect(unwrapCsDataResponse(successEnvelope('SUCCESS', payload), api)).toEqual({
      code: 'SUCCESS',
      success: true,
      data: payload,
    });
    expect(() => unwrapCsDataResponse(successEnvelope('200', payload), api)).toThrow();
  });

  it.each([MODELS, PROVIDERS])('accepts 200 only for the model API %s', (api) => {
    const payload = { marker: 'model-business' };

    expect(unwrapCsDataResponse(successEnvelope('200', payload), api)).toEqual({
      code: '200',
      success: true,
      data: payload,
    });
    expect(() => unwrapCsDataResponse(successEnvelope('SUCCESS', payload), api)).toThrow();
  });

  it('keeps legacy personal decoding when no API is supplied', () => {
    expect(unwrapCsDataResponse(successEnvelope('SUCCESS'))).toEqual({
      code: 'SUCCESS',
      success: true,
      data: { marker: 'business-result' },
    });
    expect(() => unwrapCsDataResponse(successEnvelope('200'))).toThrow();
  });

  it.each(['0', 'OK', '201', '', 'FAILED'])(
    'rejects unrelated business success codes: %s',
    (code) => {
      expect(() => unwrapCsDataResponse(successEnvelope(code), MODELS)).toThrow();
    },
  );

  it('does not accept a business success code for an unlisted API', () => {
    expect(() => unwrapCsDataResponse(successEnvelope('200'), 'unlisted')).toThrow();
  });

  it.each(['outer-code', 'outer-success', 'gateway', 'ret', 'business-success'])(
    'rejects a failed %s layer despite successful business data',
    (layer) => {
      const raw = successEnvelope('SUCCESS');
      if (layer === 'outer-code') raw.code = '500';
      if (layer === 'outer-success') raw.successResponse = false;
      if (layer === 'gateway') raw.data.success = false;
      if (layer === 'ret') raw.data.DataV2.ret = ['FAILED::rejected'];
      if (layer === 'business-success') raw.data.DataV2.data.success = false;

      expect(() => unwrapCsDataResponse(raw, QUOTA)).toThrow();
    },
  );

  it.each([null, undefined, {}, { code: '200', successResponse: true, data: {} }])(
    'rejects an incomplete response rather than converting it to an empty business result',
    (raw) => {
      expect(() => unwrapCsDataResponse(raw, QUOTA)).toThrow();
    },
  );
});

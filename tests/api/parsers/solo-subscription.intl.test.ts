import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayShapeError } from '../../../src/api/request-adapter.js';
import {
  parseSoloQuotaConfig,
  parseSoloStatusUsage,
  parseSoloSubscription,
  parseSoloSubscriptionCore,
  parseSoloUsage,
} from '../../../src/api/parsers/solo-subscription.js';

const START = Date.parse('2026-10-01T00:00:00Z');
const END = Date.parse('2026-11-01T00:00:00Z');
const WEEK_RESET = Date.parse('2026-10-29T12:00:00Z');
const MONTH_RESET = Date.parse('2026-10-31T12:00:00Z');

function business(data: unknown) {
  return { code: 'SUCCESS', success: true, data };
}

function validSubscription(overrides: Record<string, unknown> = {}) {
  return {
    commodityCode: 'sfm_tokenplansolo_public_intl',
    instanceCode: 'mock-personal-instance',
    specCode: 'lite',
    remainingDays: 10,
    startTime: START,
    endTime: END,
    autoRenewFlag: true,
    status: 'VALID',
    ...overrides,
  };
}

describe('Personal subscription response parsing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each([START - 1, END])('keeps a subscription outside its active period unknown: %s', (now) => {
    vi.setSystemTime(now);
    expect(parseSoloSubscription(business(validSubscription()))).toEqual({
      status: 'unknown',
      subscription: null,
      reason: 'inconsistent_period',
    });
  });
  it('parses a complete VALID subscription without renaming its instance identity', () => {
    const result = parseSoloSubscription(business(validSubscription()));

    expect(result).toEqual({
      status: 'active',
      subscription: {
        instanceCode: 'mock-personal-instance',
        specCode: 'lite',
        remainingDays: 10,
        startTime: START,
        endTime: END,
        autoRenewFlag: true,
        status: 'VALID',
      },
    });
    expect(result.subscription).not.toHaveProperty('subscriptionId');
  });

  it('recognizes only successful absence of data as no subscription', () => {
    expect(parseSoloSubscription({ code: 'SUCCESS', success: true })).toEqual({
      status: 'none',
      subscription: null,
    });
  });

  it.each([null, {}, { status: 'INVALID' }, validSubscription({ status: 'FUTURE_STATE' })])(
    'keeps unconfirmed subscription data unknown: %j',
    (payload) => {
      const result = parseSoloSubscription(business(payload));

      expect(result.status).toBe('unknown');
      expect(result.subscription).toBeNull();
      expect(result.reason).toEqual(expect.any(String));
    },
  );

  it.each([
    { instanceCode: '' },
    { specCode: 'unrecognized-tier' },
    { startTime: -1 },
    { endTime: Number.NaN },
    { remainingDays: -1 },
    { autoRenewFlag: 'yes' },
  ])('does not label an invalid VALID record as active: %j', (overrides) => {
    expect(() => parseSoloSubscription(business(validSubscription(overrides)))).toThrow(
      GatewayShapeError,
    );
  });
});

describe('Personal subscription display identity', () => {
  it('maps the original subscription instance code without changing the source record', () => {
    const input = Object.freeze(
      validSubscription({
        instanceCode: 'mock-personal-parent',
        subscriptionId: 'mock-other-parent',
      }),
    );
    expect(parseSoloSubscriptionCore(input)).toEqual({
      subscriptionId: 'mock-personal-parent',
      endAt: '2026-11-01T00:00:00.000Z',
    });
    expect(input.instanceCode).toBe('mock-personal-parent');
    expect(input).toHaveProperty('subscriptionId', 'mock-other-parent');
  });

  it.each([undefined, null, '', '   ', 123, false, {}, []])(
    'keeps missing or invalid instance identity unknown: %j',
    (instanceCode) => {
      expect(parseSoloSubscriptionCore({ instanceCode, endTime: END })).toEqual({
        subscriptionId: null,
        endAt: '2026-11-01T00:00:00.000Z',
      });
    },
  );
});

describe('Personal catalog quota parsing', () => {
  it('preserves tier and window identity, including exact zero', () => {
    const result = parseSoloQuotaConfig(
      business({
        lite: { five_hour: 0, weekly: 200, monthly: 500 },
        pro: { five_hour: 100, weekly: 1000, monthly: 4000 },
      }),
    );

    expect(result).toEqual({
      lite: { five_hour: 0, weekly: 200, monthly: 500 },
      pro: { five_hour: 100, weekly: 1000, monthly: 4000 },
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '200', null])(
    'preserves an invalid declared weekly window %s as unknown',
    (weekly) => {
      const result = parseSoloQuotaConfig(business({ lite: { weekly, monthly: 500 } }));

      expect(result.lite).toEqual({ weekly: null, monthly: 500 });
    },
  );

  it('does not invent an unreported window', () => {
    const result = parseSoloQuotaConfig(business({ lite: { monthly: 500 } }));

    expect(result.lite).toEqual({ monthly: 500 });
    expect(result.lite).not.toHaveProperty('weekly');
    expect(result.lite).not.toHaveProperty('five_hour');
  });

  it.each([{}, { lite: {} }, { lite: { weekly: -1, monthly: '500' } }])(
    'rejects a response without any trustworthy quota: %j',
    (payload) => {
      expect(() => parseSoloQuotaConfig(business(payload))).toThrow();
    },
  );
});

describe.each([
  ['summary usage', parseSoloUsage],
  ['status usage', parseSoloStatusUsage],
] as const)('%s window selection', (_label, parse) => {
  it('prefers a non-null weekly ratio over a monthly ratio', () => {
    const result = parse(
      business({
        per1WeekPercentage: 0.25,
        per1WeekResetTime: WEEK_RESET,
        per1MonthPercentage: 0.5,
        per1MonthResetTime: MONTH_RESET,
      }),
    );

    expect(result).toEqual({ cycle: 'weekly', usedRatio: 0.25, resetTime: WEEK_RESET });
  });

  it('uses the monthly window when the weekly ratio is explicitly null', () => {
    const result = parse(
      business({
        per1WeekPercentage: null,
        per1MonthPercentage: 0.5,
        per1MonthResetTime: MONTH_RESET,
      }),
    );

    expect(result).toEqual({ cycle: 'monthly', usedRatio: 0.5, resetTime: MONTH_RESET });
  });

  it.each([0, 1])('preserves the inclusive ratio boundary %s', (usedRatio) => {
    expect(parse(business({ per1WeekPercentage: usedRatio }))).toEqual({
      cycle: 'weekly',
      usedRatio,
    });
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.25'])(
    'rejects invalid non-null weekly ratio %s instead of falling back to monthly',
    (ratio) => {
      expect(() =>
        parse(
          business({
            per1WeekPercentage: ratio,
            per1MonthPercentage: 0.5,
            per1MonthResetTime: MONTH_RESET,
          }),
        ),
      ).toThrow(GatewayShapeError);
    },
  );

  it.each([-1, Number.NaN, 'invalid-time'])(
    'rejects a malformed selected reset time %s',
    (resetTime) => {
      expect(() =>
        parse(
          business({
            per1WeekPercentage: 0.25,
            per1WeekResetTime: resetTime,
          }),
        ),
      ).toThrow(GatewayShapeError);
    },
  );

  it('returns no active quota window when neither ratio is reported', () => {
    expect(parse(business({}))).toBeNull();
  });
});

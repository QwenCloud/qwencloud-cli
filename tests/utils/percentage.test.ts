import { describe, expect, it } from 'vitest';
import { percentagePair, ratioPercentages } from '../../src/utils/percentage.js';

describe('Decimal percentage pairs', () => {
  it.each([
    { ratio: 0.07, usedPct: 7, remainingPct: 93 },
    { ratio: 0.0004, usedPct: 0.04, remainingPct: 99.96 },
    { ratio: 0.00005, usedPct: 0.005, remainingPct: 99.995 },
    { ratio: 0.1234567890123456, usedPct: 12.34567890123456, remainingPct: 87.65432109876544 },
    { ratio: 1e-12, usedPct: 1e-10, remainingPct: 99.9999999999 },
    { ratio: Number.MIN_VALUE, usedPct: 5e-322, remainingPct: 100 },
    { ratio: 0, usedPct: 0, remainingPct: 100 },
    { ratio: 1, usedPct: 100, remainingPct: 0 },
  ])('converts the API ratio without display rounding: %j', ({ ratio, usedPct, remainingPct }) => {
    expect(ratioPercentages(ratio)).toEqual({ usedPct, remainingPct });
    expect(percentagePair(usedPct)).toEqual({ usedPct, remainingPct });
  });

  it.each([undefined, null, NaN, Infinity, -1, 1.01, '0.07'])(
    'keeps an invalid ratio unknown: %s',
    (ratio) => {
      expect(ratioPercentages(ratio)).toEqual({ usedPct: null, remainingPct: null });
    },
  );

  it.each([undefined, null, NaN, Infinity, -1, 101, '7'])(
    'keeps an invalid percentage unknown: %s',
    (usedPct) => {
      expect(percentagePair(usedPct)).toEqual({ usedPct: null, remainingPct: null });
    },
  );
});

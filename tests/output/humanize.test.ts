import { describe, it, expect } from 'vitest';
import {
  humanizeNumber,
  humanizeWithUnit,
  formatPrice,
  formatCost,
  formatAmount,
  humanizeCurrency,
  humanizePercentage,
  humanizeDuration,
} from '../../src/output/humanize.js';

describe('humanizeNumber', () => {
  it('returns raw number for values < 1000', () => {
    expect(humanizeNumber(0)).toBe('0');
    expect(humanizeNumber(50)).toBe('50');
    expect(humanizeNumber(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(humanizeNumber(1000)).toBe('1K');
    expect(humanizeNumber(1500)).toBe('1.5K');
    expect(humanizeNumber(65536)).toBe('65.5K');
    expect(humanizeNumber(15000)).toBe('15K');
  });

  it('formats millions with M suffix', () => {
    expect(humanizeNumber(1000000)).toBe('1M');
    expect(humanizeNumber(1500000)).toBe('1.5M');
    expect(humanizeNumber(2480000)).toBe('2.5M');
    expect(humanizeNumber(991800)).toBe('991.8K'); // just under 1M
  });

  it('handles edge cases', () => {
    expect(humanizeNumber(100000)).toBe('100K');
    expect(humanizeNumber(55160)).toBe('55.2K');
    expect(humanizeNumber(850000)).toBe('850K');
  });

});

describe('humanizeWithUnit', () => {
  it('abbreviates unit names correctly', () => {
    expect(humanizeWithUnit(850000, 'tokens')).toBe('850K tok');
    expect(humanizeWithUnit(1000000, 'tokens')).toBe('1M tok');
    expect(humanizeWithUnit(50, 'images')).toBe('50 img');
    expect(humanizeWithUnit(10000, 'characters')).toBe('10K char');
    expect(humanizeWithUnit(1200, 'seconds')).toBe('1.2K sec');
  });

  it('handles singular unit forms', () => {
    expect(humanizeWithUnit(1, 'token')).toBe('1 tok');
    expect(humanizeWithUnit(1, 'image')).toBe('1 img');
    expect(humanizeWithUnit(1, 'piece')).toBe('1 img');
    expect(humanizeWithUnit(5, 'pieces')).toBe('5 img');
    expect(humanizeWithUnit(1, 'character')).toBe('1 char');
    expect(humanizeWithUnit(1, 'second')).toBe('1 sec');
  });

  it('handles unknown units', () => {
    expect(humanizeWithUnit(500, 'requests')).toBe('500 requests');
  });
});

describe('formatAmount', () => {
  it('in full mode (default), shows cleaned number without trailing zeros', () => {
    expect(formatAmount(0.112)).toBe('0.112');
    expect(formatAmount(0.5)).toBe('0.5');
    expect(formatAmount(1.0)).toBe('1');
    expect(formatAmount(0.00345)).toBe('0.00345');
  });

  it('cleans floating-point artifacts', () => {
    // Simulates 0.14 * 0.8 that might still carry residual noise
    // eslint-disable-next-line no-loss-of-precision
    const artifact = 0.11200000000000001;
    expect(formatAmount(artifact)).toBe('0.112');
  });

  it('preserves significant digits for small prices', () => {
    expect(formatAmount(0.000003)).toBe('0.000003');
    expect(formatAmount(0.0025)).toBe('0.0025');
  });
});

describe('formatPrice / formatCost', () => {
  it('formats prices in full mode (default, no trailing zeros)', () => {
    expect(formatPrice(0.50)).toBe('$0.5');
    expect(formatPrice(2.00)).toBe('$2');
    expect(formatPrice(0.14)).toBe('$0.14');
  });

  it('formats costs consistently in full mode', () => {
    expect(formatCost(0.38)).toBe('$0.38');
    expect(formatCost(2.07)).toBe('$2.07');
    expect(formatCost(0.000035)).toBe('$0.000035');
  });
});

describe('humanizeCurrency', () => {
  it('formats USD correctly', () => {
    expect(humanizeCurrency(0.38)).toBe('$0.38');
    expect(humanizeCurrency(2.07)).toBe('$2.07');
    expect(humanizeCurrency(100)).toBe('$100.00');
  });

  it('shows more precision for very small amounts', () => {
    expect(humanizeCurrency(0.000035)).toBe('$0.00003'); // IEEE 754: 0.000035.toFixed(5) = '0.00003'
    expect(humanizeCurrency(0.005)).toBe('$0.00500');
  });

  it('uses space for non-USD currency', () => {
    expect(humanizeCurrency(100, 'CNY')).toBe(' 100.00');
  });
});

describe('humanizePercentage', () => {
  it('rounds to integer', () => {
    expect(humanizePercentage(85)).toBe('85%');
    expect(humanizePercentage(100)).toBe('100%');
    expect(humanizePercentage(0)).toBe('0%');
    expect(humanizePercentage(50.5)).toBe('51%'); // Math.round(50.5) = 51 (rounds half up)
    expect(humanizePercentage(50.6)).toBe('51%');
  });
});

describe('humanizeDuration', () => {
  it('returns "now" for zero or negative', () => {
    expect(humanizeDuration(0)).toBe('now');
    expect(humanizeDuration(-1000)).toBe('now');
  });

  it('formats minutes', () => {
    expect(humanizeDuration(45 * 60 * 1000)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(humanizeDuration((3 * 60 + 24) * 60 * 1000)).toBe('3h 24m');
  });

  it('formats days and hours', () => {
    expect(humanizeDuration((5 * 24 + 8) * 60 * 60 * 1000)).toBe('5d 8h');
  });

  it('supports prefix', () => {
    expect(humanizeDuration(3 * 60 * 60 * 1000, 'in ')).toBe('in 3h');
    expect(humanizeDuration(0, 'in ')).toBe('in now');
  });
});

export interface Percentages {
  usedPct: number | null;
  remainingPct: number | null;
}

export function percentagePair(value: unknown): Percentages {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    return { usedPct: null, remainingPct: null };

  // Subtract the serialized decimal so complementary fields share the same precision.
  const [coefficient, exponent = '0'] = String(value).split('e');
  const [integer, fraction = ''] = coefficient.split('.');
  const power = Number(exponent) - fraction.length;
  const scale = Math.max(0, -power);
  const units = BigInt(integer + fraction) * 10n ** BigInt(Math.max(0, power));
  const remaining = 100n * 10n ** BigInt(scale) - units;
  return { usedPct: value, remainingPct: Number(`${remaining}e-${scale}`) };
}

export function ratioPercentages(value: unknown): Percentages {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    return percentagePair(null);
  const [coefficient, exponent = '0'] = String(value).split('e');
  return percentagePair(Number(`${coefficient}e${Number(exponent) + 2}`));
}

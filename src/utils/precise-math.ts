/**
 * Precision-safe arithmetic for credits/amounts.
 * Avoids IEEE 754 floating-point accumulation errors by scaling operands
 * to integers before summing, then restoring the decimal position.
 */

function getDecimalPlaces(n: number): number {
  const s = String(n);
  const dotIndex = s.indexOf('.');
  if (dotIndex === -1) return 0;
  // Ignore scientific notation trailing — rare for credits values
  const eIndex = s.indexOf('e');
  if (eIndex !== -1) return Math.max(0, eIndex - dotIndex - 1);
  return s.length - dotIndex - 1;
}

/**
 * Sum numbers without floating-point precision loss.
 * Handles the common case where `0.1 + 0.2` must equal `0.3`
 * rather than `0.30000000000000004`.
 */
export function preciseAdd(...nums: number[]): number {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];

  const maxDp = nums.reduce((max, n) => Math.max(max, getDecimalPlaces(n)), 0);
  if (maxDp === 0) {
    // All integers — direct sum is safe
    return nums.reduce((a, b) => a + b, 0);
  }

  const factor = Math.pow(10, maxDp);
  const intSum = nums.reduce((acc, n) => acc + Math.round(n * factor), 0);
  return intSum / factor;
}

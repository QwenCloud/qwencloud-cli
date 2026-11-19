const UNIT_FIELDS = ['Unit', 'UnitName', 'EquityUnit'] as const;

/** Missing units are compatible; every explicit unit must identify Credits. */
export function hasConsistentCreditUnits(
  ...records: Array<Record<string, unknown> | null | undefined>
): boolean {
  return records.every((record) =>
    UNIT_FIELDS.every((field) => {
      const unit = record?.[field];
      return (
        unit == null || (typeof unit === 'string' && /^(?:credit|credits)$/i.test(unit.trim()))
      );
    }),
  );
}

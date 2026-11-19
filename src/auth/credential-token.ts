export function isCredentialToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/\s/u.test(value) &&
    !/^(?:\[REDACTED\]|<REDACTED>|REDACTED|<omitted>|omitted|\*+)$/iu.test(value)
  );
}

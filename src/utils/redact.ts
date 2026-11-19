/** Redact a token for debug output, exposing minimal prefix/suffix based on length. */
export function redactToken(value: string): string {
  if (!value) return '***';
  const len = value.length;
  if (len <= 8) return '***';
  if (len <= 16) return value.slice(0, 4) + '****';
  const prefixLen = value[7] === '.' || value[7] === '-' ? 8 : 7;
  return value.slice(0, prefixLen) + '****' + value.slice(-4);
}

const SECRET_KEY =
  /^(?:authorization|access[_-]?token|cliAccessToken|refresh[_-]?token|api[_-]?key|password|secret|token)$/i;

/** Sanitize a detached diagnostic value, including repeated credentials in free text. */
export function redactSensitiveValue(value: unknown, knownSecrets: string[] = []): unknown {
  const secrets = new Set(knownSecrets.filter(Boolean));
  const collect = (input: unknown): void => {
    if (typeof input === 'string') {
      try {
        const decoded: unknown = JSON.parse(input);
        if (decoded !== input) collect(decoded);
      } catch {
        /* Free text is sanitized below. */
      }
      return;
    }
    if (!input || typeof input !== 'object') return;
    for (const [key, item] of Object.entries(input)) {
      if (SECRET_KEY.test(key) && typeof item === 'string') {
        secrets.add(item);
        if (/^Bearer /i.test(item)) secrets.add(item.slice(7));
      } else collect(item);
    }
  };
  collect(value);
  const clean = (input: unknown): unknown => {
    if (typeof input === 'string') {
      let result = input;
      for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
        result = result.split(secret).join('[REDACTED]');
      }
      return result
        .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
        .replace(
          /((?:cliAccessToken|access_token|refresh_token|api_key|password|secret|token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
          '$1[REDACTED]',
        );
    }
    if (Array.isArray(input)) return input.map(clean);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          SECRET_KEY.test(key) ? '[REDACTED]' : clean(item),
        ]),
      );
    }
    return input;
  };
  return clean(value);
}

/** Remove secrets from errors before they reach command diagnostics. */
export function redactProtocolError(error: unknown, context: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const seen = new Set<Error>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const sanitized = redactSensitiveValue({
      context,
      message: current.message,
      stack: current.stack,
    }) as { message: string; stack?: string };
    current.message = sanitized.message;
    current.stack = sanitized.stack;
    current = current.cause;
  }
  return error;
}

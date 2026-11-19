import type { SubscriptionDiagnostic } from '../types/subscription.js';
import { CliError } from '../utils/errors.js';

const MESSAGES = {
  AUTH_REQUIRED: 'Authentication failed. Run: qwencloud auth login',
  NETWORK_ERROR: 'The service could not be reached. Check your network connection.',
  PROTOCOL_ERROR: 'The response could not be verified. Try again later.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Try again later.',
} as const;

function classify(error: unknown): keyof typeof MESSAGES {
  const item = error as {
    name?: string;
    code?: string;
    exitCode?: number;
    status?: number;
    message?: string;
  } | null;
  if (
    item?.exitCode === 2 ||
    item?.status === 401 ||
    item?.status === 403 ||
    /AUTH|TOKEN_EXPIRED|Login.NotLogined/.test(item?.code ?? '')
  )
    return 'AUTH_REQUIRED';
  if (
    item?.exitCode === 3 ||
    item?.name === 'RequestTimeoutError' ||
    /Network request failed|timeout/i.test(item?.message ?? '')
  )
    return 'NETWORK_ERROR';
  if (
    item?.exitCode === 4 ||
    ['GatewayShapeError', 'GatewayEnvelopeError', 'ResponseParseError', 'SyntaxError'].includes(
      item?.name ?? '',
    )
  )
    return 'PROTOCOL_ERROR';
  return 'SERVICE_UNAVAILABLE';
}

export function safeSubscriptionDiagnostic(api: string, error: unknown): SubscriptionDiagnostic {
  const errorCode = classify(error);
  return { api, errorCode, errorMessage: MESSAGES[errorCode] };
}

export function subscriptionProtocolDiagnostic(
  api: string,
  errorCode: string,
  message: string = MESSAGES.PROTOCOL_ERROR,
): SubscriptionDiagnostic {
  return { api, errorCode, errorMessage: message };
}

export function subscriptionFailureExitCode(diagnostics: SubscriptionDiagnostic[]): 1 | 2 | 3 | 4 {
  if (
    diagnostics.some(
      (d) =>
        ['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'CS_DATA_AUTH_REQUIRED'].includes(d.errorCode) ||
        /authentication|not authenticated|HTTP (401|403)/i.test(d.errorMessage),
    )
  )
    return 2;
  if (
    diagnostics.some(
      (d) =>
        ['NETWORK_ERROR', 'Timeout', 'TIMEOUT'].includes(d.errorCode) ||
        /Network request failed|timeout/i.test(d.errorMessage),
    )
  )
    return 3;
  if (
    diagnostics.some(
      (d) =>
        ['PROTOCOL_ERROR', 'UnconfirmedState', 'CONFIG_ERROR', 'SHAPE_ERROR'].includes(
          d.errorCode,
        ) || d.errorMessage === MESSAGES.PROTOCOL_ERROR,
    )
  )
    return 4;
  return 1;
}

export function safeSubscriptionError(error: unknown, fallbackMessage: string): CliError {
  if (error instanceof Error && error.name === 'AbortError')
    return new CliError({ code: 'USER_INTERRUPT', message: 'Query cancelled.', exitCode: 130 });
  const diagnostic = safeSubscriptionDiagnostic('subscription', error);
  return new CliError({
    code: diagnostic.errorCode,
    message:
      diagnostic.errorCode === 'SERVICE_UNAVAILABLE' ? fallbackMessage : diagnostic.errorMessage,
    exitCode: subscriptionFailureExitCode([diagnostic]),
  });
}

export function collectTokenPlanDiagnostics(
  result: import('../types/tokenplan-subscription.js').TokenPlanStatusResult,
): SubscriptionDiagnostic[] {
  const records = [
    ...result.diagnostics,
    ...(result.individual?.diagnostics ?? []),
    ...(result.team?.diagnostics ?? []),
    ...(result.team?.seatDetails?.diagnostics ?? []),
  ];
  return [
    ...new Map(
      records.map((record) => [
        JSON.stringify([record.api, record.errorCode, record.errorMessage]),
        record,
      ]),
    ).values(),
  ];
}

import { EXIT_CODES, type ExitCode } from './exit-codes.js';
import { flushDebugReport } from '../api/debug-buffer.js';
import { loginCommand } from './runtime-mode.js';
import { resetGlobalCache } from './cache.js';
import {
  GatewayEnvelopeError,
  GatewayShapeError,
  GatewayBusinessError,
} from '../api/request-adapter.js';

export interface CliErrorOptions {
  code: string; // e.g., 'AUTH_REQUIRED', 'MODEL_NOT_FOUND'
  message: string; // Human-readable message
  exitCode: ExitCode;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;

  constructor(options: CliErrorOptions) {
    super(options.message);
    this.name = 'CliError';
    this.code = options.code;
    this.exitCode = options.exitCode;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        exitCode: this.exitCode,
      },
    };
  }
}

/** Sentinel error indicating the message was already printed; only exitCode matters. */
export class HandledError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super('');
    this.name = 'HandledError';
    this.exitCode = exitCode;
  }
}

// Pre-defined error factories
export function authRequiredError(): CliError {
  return new CliError({
    code: 'AUTH_REQUIRED',
    message: `Not authenticated. Run: ${loginCommand()}`,
    exitCode: EXIT_CODES.AUTH_FAILURE,
  });
}

export function tokenExpiredError(): CliError {
  return new CliError({
    code: 'TOKEN_EXPIRED',
    message: `Token expired. Run: ${loginCommand()}`,
    exitCode: EXIT_CODES.AUTH_FAILURE,
  });
}

export function modelNotFoundError(id: string): CliError {
  return new CliError({
    code: 'MODEL_NOT_FOUND',
    message: `Model '${id}' not found.`,
    exitCode: EXIT_CODES.GENERAL_ERROR,
  });
}

export function networkError(detail?: string): CliError {
  return new CliError({
    code: 'NETWORK_ERROR',
    message: detail || 'Network error: API unreachable',
    exitCode: EXIT_CODES.NETWORK_ERROR,
  });
}

export function configError(detail: string): CliError {
  return new CliError({
    code: 'CONFIG_ERROR',
    message: detail,
    exitCode: EXIT_CODES.INVALID_ARGUMENT,
  });
}

export function invalidArgError(message: string): CliError {
  return new CliError({
    code: 'INVALID_ARGUMENT',
    message,
    exitCode: EXIT_CODES.INVALID_ARGUMENT,
  });
}

export function ticketNotFoundError(ticketId: string): CliError {
  return new CliError({
    code: 'NOT_FOUND',
    message: `Ticket not found: ${ticketId}`,
    exitCode: EXIT_CODES.GENERAL_ERROR,
  });
}

export function invalidDateRangeError(from: string, to: string): CliError {
  return new CliError({
    code: 'INVALID_RANGE',
    message: `Invalid date range: from (${from}) is after to (${to})`,
    exitCode: EXIT_CODES.INVALID_ARGUMENT,
  });
}

/**
 * Extract the full error cause chain as a readable string.
 */
function formatErrorCauseChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err instanceof Error ? err.cause : undefined;
  let depth = 0;
  while (current && depth < 5) {
    if (current instanceof Error) {
      parts.push(`  Caused by: ${current.message}`);
      current = current.cause;
    } else {
      parts.push(`  Caused by: ${String(current)}`);
      break;
    }
    depth++;
  }
  return parts.join('\n');
}

// ────────────────────────────────────────────────────────────────────
// Error routing helpers — classify gateway / business / auth errors
// ────────────────────────────────────────────────────────────────────

const BUSINESS_HINTS: Record<string, string> = {
  '10041495': 'Verify that the account is bound to an active workspace.',
  'Workspace.Error.Internal':
    'The account is not bound to a workspace, or the workspace is in an abnormal state.',
  IllegalArgumentException:
    'A required parameter is missing — confirm the command flags match the upstream contract.',
};

function lookupHint(code: string, message: string): string | undefined {
  if (BUSINESS_HINTS[code]) return BUSINESS_HINTS[code];
  for (const key of Object.keys(BUSINESS_HINTS)) {
    if (message.includes(key)) return BUSINESS_HINTS[key];
  }
  return undefined;
}

type NamedErrorShape = { name?: string; code?: string; message?: string; hint?: string };

function nameOf(error: unknown): string {
  return (error as NamedErrorShape | null)?.name ?? '';
}

function isBusiness(error: unknown): boolean {
  return error instanceof GatewayBusinessError || nameOf(error) === 'GatewayBusinessError';
}

function isGateway(error: unknown): boolean {
  if (error instanceof GatewayEnvelopeError || error instanceof GatewayShapeError) return true;
  const n = nameOf(error);
  return n === 'GatewayEnvelopeError' || n === 'GatewayShapeError';
}

function isAuth(error: unknown): boolean {
  return nameOf(error) === 'AuthenticationRequiredError';
}

// ────────────────────────────────────────────────────────────────────
// Unified error handler
// ────────────────────────────────────────────────────────────────────

/**
 * Single entry point for command-layer error handling.
 *
 * Classifies the error into gateway / business / auth / CliError / unknown
 * buckets, renders it according to the active output format, then throws
 * HandledError so the bin entry point can set process.exitCode without
 * duplicating output.
 */
export function handleError(error: unknown, format: 'json' | 'table' | 'text'): never {
  flushDebugReport();

  if ((error as { code?: string })?.code === 'repl.exit.intercepted') throw error;

  // Gateway business error
  if (isBusiness(error)) {
    const shape = error as NamedErrorShape;
    const code = shape.code ?? '';
    const message = shape.message ?? '';
    const hint = shape.hint ?? lookupHint(code, message);
    if (format === 'json') {
      const payload: Record<string, unknown> = { type: 'business', code, message };
      if (hint) payload.hint = hint;
      process.stderr.write(JSON.stringify({ error: payload }, null, 2) + '\n');
    } else {
      process.stderr.write(`Notice: ${message}\n`);
      if (hint) process.stderr.write(`Hint: ${hint}\n`);
    }
    resetGlobalCache();
    throw new HandledError(EXIT_CODES.GENERAL_ERROR);
  }

  // Gateway envelope / shape error
  if (isGateway(error)) {
    const shape = error as NamedErrorShape;
    const code =
      shape.code ?? (nameOf(error) === 'GatewayShapeError' ? 'SHAPE_ERROR' : 'GATEWAY_ERROR');
    const message = shape.message ?? '';
    if (format === 'json') {
      process.stderr.write(
        JSON.stringify({ error: { type: 'gateway', code, message } }, null, 2) + '\n',
      );
    } else {
      process.stderr.write(`Gateway error: ${message}\n`);
    }
    resetGlobalCache();
    throw new HandledError(EXIT_CODES.GENERAL_ERROR);
  }

  // Authentication error
  if (isAuth(error)) {
    const shape = error as NamedErrorShape;
    const message = shape.message ?? 'not authenticated';
    if (format === 'json') {
      process.stderr.write(
        JSON.stringify({ error: { type: 'auth', code: 'AUTH_REQUIRED', message } }, null, 2) + '\n',
      );
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    resetGlobalCache();
    throw new HandledError(EXIT_CODES.AUTH_FAILURE);
  }

  // CliError — typed application error
  if (error instanceof CliError) {
    if (format === 'json') {
      process.stderr.write(JSON.stringify(error.toJSON(), null, 2) + '\n');
    } else {
      console.error(`Error: ${error.message}`);
    }
    resetGlobalCache();
    throw new HandledError(error.exitCode);
  }

  // Plain Error carrying a numeric `.exitCode` hint — used by Service-layer
  // errors that surface a contract-defined exit code without coupling to
  // the command layer's error type.
  if (error instanceof Error && typeof (error as { exitCode?: unknown }).exitCode === 'number') {
    const e = error as Error & { exitCode: number; code?: string };
    const code = typeof e.code === 'string' ? e.code : 'ERROR';
    if (format === 'json') {
      process.stderr.write(
        JSON.stringify({ error: { code, message: e.message, exitCode: e.exitCode } }, null, 2) +
          '\n',
      );
    } else {
      console.error(`Error: ${e.message}`);
    }
    resetGlobalCache();
    throw new HandledError(e.exitCode);
  }

  // Unknown error — include full diagnostic info
  const message = error instanceof Error ? error.message : String(error);
  const causeChain = error instanceof Error ? formatErrorCauseChain(error) : '';
  const fullMessage = causeChain ? `${message}\n${causeChain}` : message;

  if (format === 'json') {
    process.stderr.write(
      JSON.stringify(
        {
          error: { code: 'UNKNOWN_ERROR', message: fullMessage, exitCode: 1 },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    console.error(`Error: ${fullMessage}`);
  }
  resetGlobalCache();
  throw new HandledError(EXIT_CODES.GENERAL_ERROR);
}

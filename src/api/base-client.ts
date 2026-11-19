/**
 * HTTP transport layer — wraps global fetch with timeout, auth injection,
 * error normalization, and debug redaction.
 */

declare const __VERSION__: string;
declare const __ALLOW_PROXY__: boolean;

import { resolveCredentials } from '../auth/credentials.js';
import { site } from '../site.js';
import { redactSensitiveValue } from '../utils/redact.js';
import { startRequest, endRequest, isEnabled } from './debug-buffer.js';

let proxyInit: Promise<void> | undefined;
if (typeof __ALLOW_PROXY__ !== 'undefined' && __ALLOW_PROXY__) {
  proxyInit = import('undici').then(({ setGlobalDispatcher, EnvHttpProxyAgent }) => {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  });
}

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export interface BaseClientOptions {
  baseUrl?: string;
  timeout?: number;
}

export interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  authMode?: 'required' | 'optional' | 'none';
  context?: string;
  signal?: AbortSignal;
  onRequestStart?: () => void;
}

export interface BaseClient {
  request<T>(options: RequestOptions): Promise<T>;
}

export class HttpResponseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpResponseError';
  }
}
export class RequestTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    url: string,
  ) {
    super(`Request timeout after ${timeoutMs / 1000}s\n  URL: ${url}`);
    this.name = 'RequestTimeoutError';
  }
}
export class ResponseParseError extends Error {
  constructor() {
    super('Invalid JSON response from server');
    this.name = 'ResponseParseError';
  }
}
export function isResponseParseError(error: unknown): boolean {
  return error instanceof ResponseParseError;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;

function getUserAgent(): string {
  const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';
  return `${site.userAgentPrefix}/${version}`;
}

export function createBaseClient(opts?: BaseClientOptions): BaseClient {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;

  return {
    async request<T>(options: RequestOptions): Promise<T> {
      const method = options.method ?? 'POST';
      const authMode = options.authMode ?? 'none';
      const context = options.context ?? 'api';

      // Build headers
      const headers: Record<string, string> = {
        'User-Agent': getUserAgent(),
        ...(options.headers ?? {}),
      };

      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('Request aborted', 'AbortError');
      }
      const hasExplicitAuthorization = Object.keys(headers).some(
        (key) => key.toLowerCase() === 'authorization',
      );
      // Caller-provided credentials belong to the selected transport channel.
      if (authMode === 'required' && !hasExplicitAuthorization) {
        const creds = resolveCredentials();
        if (!creds) {
          throw new Error('Not authenticated. Please login first.');
        }
        headers.Authorization = `Bearer ${creds.access_token}`;
      } else if (authMode === 'optional' && !hasExplicitAuthorization) {
        const creds = resolveCredentials();
        if (creds) {
          headers.Authorization = `Bearer ${creds.access_token}`;
        }
      }
      // 'none' — no auth header

      const secrets = Object.entries(headers)
        .filter(([key]) => key.toLowerCase() === 'authorization')
        .map(([, value]) => value.replace(/^Bearer /i, ''));
      let debugId: number | undefined;
      if (isEnabled()) {
        debugId = startRequest(
          method,
          options.url,
          redactSensitiveValue(headers, secrets) as Record<string, unknown>,
          String(redactSensitiveValue(options.body ?? '', secrets)),
          context,
        );
      }
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) forwardAbort();
      else options.signal?.addEventListener('abort', forwardAbort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new RequestTimeoutError(timeout, options.url)),
        timeout,
      );
      const checkSignal = () => {
        if (!controller.signal.aborted) return;
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new DOMException('Request aborted', 'AbortError');
      };

      try {
        checkSignal();
        if (proxyInit) await proxyInit;
        checkSignal();
        options.onRequestStart?.();
        const response = await fetch(options.url, {
          method,
          headers,
          body: options.body,
          signal: controller.signal,
          redirect: 'error',
        });

        checkSignal();

        if (!response.ok) {
          const bodyText = String(
            redactSensitiveValue(await response.text().catch(() => ''), secrets),
          );
          const truncated =
            bodyText.length > 500 ? bodyText.slice(0, 500) + '...(truncated)' : bodyText;

          if (debugId !== undefined) {
            endRequest(debugId, response.status, response.statusText, truncated, true);
          }

          const parts = [
            `HTTP ${response.status}: ${response.statusText}`,
            `  URL: ${options.url}`,
          ];
          if (truncated) parts.push(`  Response: ${truncated}`);
          throw new HttpResponseError(response.status, parts.join('\n'));
        }

        let data: T;
        try {
          data = (await response.json()) as T;
        } catch {
          checkSignal();
          throw new ResponseParseError();
        }
        checkSignal();

        if (debugId !== undefined) {
          const bodyStr = JSON.stringify(redactSensitiveValue(data, secrets));
          const truncated = bodyStr.length > 2000 ? bodyStr.slice(0, 2000) : bodyStr;
          endRequest(debugId, response.status, response.statusText, truncated, false);
        }

        return data;
      } catch (err) {
        clearTimeout(timer);

        if (debugId !== undefined && err instanceof Error) {
          endRequest(debugId, null, null, String(redactSensitiveValue(err.message, secrets)), true);
        }

        checkSignal();
        if (err instanceof HttpResponseError || isResponseParseError(err)) throw err;
        if (err instanceof Error && err.name === 'AbortError') throw err;

        // Network-layer failure (DNS, refused, TLS, etc.) — wrap with a
        // stable "Network request failed" prefix for downstream consumers.
        const baseMsg = String(
          redactSensitiveValue(err instanceof Error ? err.message : String(err), secrets),
        );
        const cause = err instanceof Error && err.cause ? err.cause : undefined;
        const causeMsg = String(
          redactSensitiveValue(
            cause instanceof Error ? cause.message : cause ? String(cause) : '',
            secrets,
          ),
        );
        const parts = [`Network request failed: ${baseMsg}`, `  URL: ${options.url}`];
        if (causeMsg) parts.push(`  Cause: ${causeMsg}`);
        const enriched = new Error(parts.join('\n'));
        if (err instanceof Error) enriched.cause = err;
        throw enriched;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', forwardAbort);
      }
    },
  };
}

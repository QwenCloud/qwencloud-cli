/**
 * PKCE (RFC 7636) helpers and login-mode selection.
 *
 * The verifier/challenge primitives are reused by both `auth-client.ts`
 * (transport) and `auth-service.ts` (orchestration). `selectAuthMode`
 * decides between the PKCE-preferred path and the Device Flow fallback
 * based on caller context and the `QWENCLOUD_AUTH_MODE` environment
 * variable, which is read on every call (no module-level caching) so the
 * choice can be flipped from outside without a process restart.
 */
import { createHash, randomBytes } from 'node:crypto';

export type AuthMode = 'pkce' | 'device-flow';

export interface AuthModeContext {
  isInteractiveTty: boolean;
  forcedMode?: AuthMode;
  envOverride?: string;
}

const ENV_VAR = 'QWENCLOUD_AUTH_MODE';

/**
 * Generate a 43-character base64url verifier from 32 random bytes.
 * Sits inside RFC 7636's 43–128 char window using only the unreserved
 * alphabet [A-Z a-z 0-9 -._~] (base64url is a strict subset).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 challenge derivation per RFC 7636 §4.2 (S256). */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Resolve the active auth mode.
 *
 * Priority (highest first):
 *   1. ctx.forcedMode (test seed)
 *   2. ctx.envOverride / process.env[QWENCLOUD_AUTH_MODE] (operator override)
 *   3. default: 'pkce'
 *
 * `isInteractiveTty` is accepted but unused at this stage; it is reserved
 * for a future "non-TTY → device-flow" rule without a signature break.
 */
export function selectAuthMode(ctx?: AuthModeContext): AuthMode {
  if (ctx?.forcedMode === 'pkce' || ctx?.forcedMode === 'device-flow') {
    return ctx.forcedMode;
  }
  const env = ctx?.envOverride ?? process.env[ENV_VAR];
  if (env === 'pkce' || env === 'device-flow') return env;
  return 'pkce';
}

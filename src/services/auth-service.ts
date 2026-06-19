/**
 * AuthService — orchestrates authentication workflows on top of AuthClient.
 *
 * Responsibilities:
 *   - PKCE-preferred login (loginInit / loginPoll) with Device Flow fallback.
 *   - Auth status retrieval (server check + JWT-claim fallback when offline).
 *   - Logout (best-effort server revocation, always-on local cleanup).
 *
 * AuthService talks ONLY to AuthClient. It deliberately does NOT depend on
 * the gateway-facing ApiClient — auth must remain reachable when the data
 * plane is unavailable, and we want to keep the dependency graph acyclic.
 */
import {
  resolveCredentials,
  isTokenExpired,
  tryExtractUserFromToken,
  clearCredentials,
} from '../auth/credentials.js';
import { selectAuthMode, type AuthMode, type AuthModeContext } from '../auth/pkce.js';
import type {
  AuthStatus,
  Credentials,
  DeviceFlowInitResponse,
  DeviceFlowPollResponse,
} from '../types/auth.js';

import type { AuthClient } from '../api/auth-client.js';

export interface LoginInitResult extends DeviceFlowInitResponse {
  auth_mode: AuthMode;
}

export class AuthService {
  /** Code verifier preserved between init and poll for the PKCE branch. */
  private pkceVerifier: string | null = null;

  constructor(private readonly authClient: AuthClient) {}

  async getAuthStatus(): Promise<AuthStatus> {
    const resolved = resolveCredentials();
    if (!resolved) {
      return { authenticated: false, server_verified: false };
    }
    if (resolved.credentials && isTokenExpired(resolved.credentials)) {
      return { authenticated: false, server_verified: false };
    }

    try {
      return await this.authClient.getAuthStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.localFallback(resolved.credentials, `Server unreachable: ${message}`);
    }
  }

  /**
   * Initiate login. Resolves the active mode (PKCE preferred, Device Flow
   * fallback) and dispatches accordingly. The returned init response is
   * extended with the resolved `auth_mode` so persisted pending-state can
   * record it for `--complete` later.
   */
  async loginInit(ctx?: AuthModeContext): Promise<LoginInitResult> {
    const mode = selectAuthMode(ctx ?? defaultContext());
    if (mode === 'pkce') {
      const result = await this.authClient.authorizePKCE();
      this.pkceVerifier = result.code_verifier ?? null;
      return { ...result, auth_mode: 'pkce' };
    }
    const result = await this.authClient.authorizeDeviceFlow();
    this.pkceVerifier = null;
    return { ...result, auth_mode: 'device-flow' };
  }

  /**
   * Poll until the login flow reaches a terminal state. When a verifier is
   * supplied (or one was captured by `loginInit`), the poll is routed
   * through the PKCE endpoint; otherwise it falls back to Device Flow.
   */
  async loginPoll(
    token: string,
    intervalSec = 5,
    verifier?: string,
  ): Promise<DeviceFlowPollResponse> {
    const effectiveVerifier = verifier ?? this.pkceVerifier ?? undefined;
    if (effectiveVerifier) {
      return this.authClient.pollPKCE(token, intervalSec, effectiveVerifier);
    }
    return this.authClient.pollDeviceFlow(token, intervalSec);
  }

  /** @deprecated Use `loginInit`. Retained for backwards compatibility. */
  async deviceFlowInit(): Promise<DeviceFlowInitResponse> {
    const result = await this.authClient.authorizeDeviceFlow();
    this.pkceVerifier = null;
    return result;
  }

  /** @deprecated Use `loginPoll`. Retained for backwards compatibility. */
  async deviceFlowPoll(token: string, intervalSec = 5): Promise<DeviceFlowPollResponse> {
    return this.loginPoll(token, intervalSec);
  }

  /** @deprecated Pass the verifier as the third argument of `loginPoll`. */
  setPkceVerifier(verifier: string): void {
    this.pkceVerifier = verifier;
  }

  async logout(): Promise<void> {
    try {
      await this.authClient.logout();
    } finally {
      clearCredentials();
    }
  }

  private localFallback(credentials: Credentials | null | undefined, warning: string): AuthStatus {
    if (!credentials) {
      return { authenticated: false, server_verified: false, warning };
    }

    let user = credentials.user ?? { email: '', aliyunId: '' };
    if (!user.email?.trim() && !user.aliyunId?.trim()) {
      const jwtUser = tryExtractUserFromToken(credentials.access_token);
      if (jwtUser) user = jwtUser;
    }

    return {
      authenticated: true,
      server_verified: false,
      auth_mode: 'device_flow',
      warning,
      user,
      token: {
        expires_at: credentials.expires_at ?? 'unknown',
        scopes: ['inference:read', 'usage:read', 'config:write'],
      },
    };
  }
}

function defaultContext(): AuthModeContext {
  return {
    isInteractiveTty: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  };
}

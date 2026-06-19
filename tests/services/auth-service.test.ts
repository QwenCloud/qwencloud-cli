/**
 * Unit tests for AuthService.getAuthStatus() and AuthService.logout().
 *
 * This file covers the auth status retrieval logic (server verification,
 * local fallback, token expiry detection) and logout (credential clearing).
 *
 * Login workflows (loginInit / loginPoll) are tested separately in
 * auth-service.login.test.ts and MUST NOT be modified here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthStatus, Credentials } from '../../src/types/auth.js';
import { AuthService } from '../../src/services/auth-service.js';
import type { AuthClient } from '../../src/api/auth-client.js';

// Mock the credentials module (module-level dependency of AuthService)
vi.mock('../../src/auth/credentials.js', () => ({
  resolveCredentials: vi.fn(),
  isTokenExpired: vi.fn(),
  tryExtractUserFromToken: vi.fn(),
  clearCredentials: vi.fn(),
}));

vi.mock('../../src/auth/pkce.js', () => ({
  selectAuthMode: vi.fn(() => 'device-flow'),
}));

import { resolveCredentials, isTokenExpired, tryExtractUserFromToken, clearCredentials } from '../../src/auth/credentials.js';

const mockResolveCredentials = resolveCredentials as ReturnType<typeof vi.fn>;
const mockIsTokenExpired = isTokenExpired as ReturnType<typeof vi.fn>;
const mockTryExtractUserFromToken = tryExtractUserFromToken as ReturnType<typeof vi.fn>;
const mockClearCredentials = clearCredentials as ReturnType<typeof vi.fn>;

// ────────────────────────────────────────────────────────────────────
// Mock factory helpers
// ────────────────────────────────────────────────────────────────────

function makeCredentials(overrides: Partial<Credentials> = {}): Credentials {
  return {
    access_token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1aWQtMTIzIiwiZXhwIjoxNzk1MDAwMDAwLCJlbWFpbCI6ImRldkB0ZXN0LnF3ZW5jbG91ZC5jb20ifQ.sig',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    user: { email: 'dev@test.qwencloud.com', aliyunId: 'uid-123' },
    ...overrides,
  };
}

function makeMockAuthClient() {
  return {
    authorizeDeviceFlow: vi.fn(),
    pollDeviceFlow: vi.fn(),
    authorizePKCE: vi.fn(),
    pollPKCE: vi.fn(),
    getAuthStatus: vi.fn(),
    logout: vi.fn(),
    ping: vi.fn(),
    checkVersion: vi.fn(),
  };
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let authClient: ReturnType<typeof makeMockAuthClient>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authClient = makeMockAuthClient();
    service = new AuthService(authClient as unknown as AuthClient);
  });

  // ──────────────────────────────────────────────────────────────────
  // getAuthStatus
  // ──────────────────────────────────────────────────────────────────

  describe('getAuthStatus', () => {
    it('returns authenticated=false when no credentials exist', async () => {
      mockResolveCredentials.mockReturnValue(null);

      const result = await service.getAuthStatus();

      expect(result.authenticated).toBe(false);
      expect(result.server_verified).toBe(false);
      expect(authClient.getAuthStatus).not.toHaveBeenCalled();
    });

    it('returns authenticated=false when token is expired', async () => {
      const creds = makeCredentials({ expires_at: new Date(Date.now() - 86400000).toISOString() });
      mockResolveCredentials.mockReturnValue({
        source: 'encrypted_file',
        auth_mode: 'device_flow',
        access_token: creds.access_token,
        credentials: creds,
      });
      mockIsTokenExpired.mockReturnValue(true);

      const result = await service.getAuthStatus();

      expect(result.authenticated).toBe(false);
      expect(result.server_verified).toBe(false);
      expect(authClient.getAuthStatus).not.toHaveBeenCalled();
    });

    it('returns server-verified AuthStatus when server responds successfully', async () => {
      const creds = makeCredentials();
      mockResolveCredentials.mockReturnValue({
        source: 'keychain',
        auth_mode: 'device_flow',
        access_token: creds.access_token,
        credentials: creds,
      });
      mockIsTokenExpired.mockReturnValue(false);

      const serverStatus: AuthStatus = {
        authenticated: true,
        server_verified: true,
        auth_mode: 'device_flow',
        user: { email: 'dev@test.qwencloud.com', aliyunId: 'uid-123' },
        token: { expires_at: creds.expires_at, scopes: ['inference:read', 'usage:read'] },
      };
      authClient.getAuthStatus.mockResolvedValue(serverStatus);

      const result = await service.getAuthStatus();

      expect(result.authenticated).toBe(true);
      expect(result.server_verified).toBe(true);
      expect(result.user?.aliyunId).toBe('uid-123');
      expect(authClient.getAuthStatus).toHaveBeenCalledTimes(1);
    });

    it('falls back to local status when server is unreachable', async () => {
      const creds = makeCredentials();
      mockResolveCredentials.mockReturnValue({
        source: 'encrypted_file',
        auth_mode: 'device_flow',
        access_token: creds.access_token,
        credentials: creds,
      });
      mockIsTokenExpired.mockReturnValue(false);
      authClient.getAuthStatus.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.getAuthStatus();

      expect(result.authenticated).toBe(true);
      expect(result.server_verified).toBe(false);
      expect(result.warning).toContain('Server unreachable');
      expect(result.warning).toContain('ECONNREFUSED');
      expect(result.user?.email).toBe('dev@test.qwencloud.com');
    });

    it('extracts user from JWT when credentials have empty user info on fallback', async () => {
      const creds = makeCredentials({ user: { email: '', aliyunId: '' } });
      mockResolveCredentials.mockReturnValue({
        source: 'encrypted_file',
        auth_mode: 'device_flow',
        access_token: creds.access_token,
        credentials: creds,
      });
      mockIsTokenExpired.mockReturnValue(false);
      authClient.getAuthStatus.mockRejectedValue(new Error('timeout'));
      mockTryExtractUserFromToken.mockReturnValue({
        email: 'jwt-user@test.qwencloud.com',
        aliyunId: 'jwt-uid-456',
      });

      const result = await service.getAuthStatus();

      expect(result.authenticated).toBe(true);
      expect(result.server_verified).toBe(false);
      expect(result.user?.email).toBe('jwt-user@test.qwencloud.com');
      expect(result.user?.aliyunId).toBe('jwt-uid-456');
    });

    it('returns unauthenticated with warning when fallback has no credentials', async () => {
      const creds = makeCredentials();
      mockResolveCredentials.mockReturnValue({
        source: 'encrypted_file',
        auth_mode: 'device_flow',
        access_token: creds.access_token,
        credentials: undefined,
      });
      mockIsTokenExpired.mockReturnValue(false);
      authClient.getAuthStatus.mockRejectedValue(new Error('network'));

      const result = await service.getAuthStatus();

      expect(result.authenticated).toBe(false);
      expect(result.server_verified).toBe(false);
      expect(result.warning).toContain('Server unreachable');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // logout
  // ──────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('calls authClient.logout and clears local credentials', async () => {
      authClient.logout.mockResolvedValue(undefined);

      await service.logout();

      expect(authClient.logout).toHaveBeenCalledTimes(1);
      expect(mockClearCredentials).toHaveBeenCalledTimes(1);
    });

    it('clears local credentials even when server logout fails', async () => {
      authClient.logout.mockRejectedValue(new Error('revoke failed'));

      await expect(service.logout()).rejects.toThrow('revoke failed');

      expect(authClient.logout).toHaveBeenCalledTimes(1);
      expect(mockClearCredentials).toHaveBeenCalledTimes(1);
    });
  });
});

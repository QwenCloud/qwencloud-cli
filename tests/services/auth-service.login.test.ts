/**
 * Unit tests for AuthService.loginInit / loginPoll.
 *
 * Scope:
 *   - PKCE-first by default; QWENCLOUD_AUTH_MODE=device-flow falls back.
 *   - loginInit returns auth_mode + (PKCE) code_verifier; loginPoll forwards
 *     the verifier captured at init when none is passed explicitly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Credentials,
  DeviceFlowInitResponse,
  DeviceFlowPollResponse,
} from '../../src/types/auth.js';
import type { AuthModeContext } from '../../src/auth/pkce.js';
import { AuthService } from '../../src/services/auth-service.js';
import type { AuthClient } from '../../src/api/auth-client.js';

// ────────────────────────────────────────────────────────────────────
// Mock factory
// ────────────────────────────────────────────────────────────────────

function makeCredentials(): Credentials {
  return {
    access_token: 'login-test-access-token',
    expires_at: '2099-01-01T00:00:00Z',
    user: { email: 'login@test.qwencloud.com', aliyunId: 'login-uid' },
  };
}

interface MockAuthClient {
  authorizeDeviceFlow: ReturnType<typeof vi.fn>;
  pollDeviceFlow: ReturnType<typeof vi.fn>;
  authorizePKCE: ReturnType<typeof vi.fn>;
  pollPKCE: ReturnType<typeof vi.fn>;
  verifyToken: ReturnType<typeof vi.fn>;
  revokeToken: ReturnType<typeof vi.fn>;
  getStoredCredentials: ReturnType<typeof vi.fn>;
  storeCredentials: ReturnType<typeof vi.fn>;
  clearCredentials: ReturnType<typeof vi.fn>;
}

function makeMockAuthClient(): MockAuthClient {
  return {
    authorizeDeviceFlow: vi.fn(),
    pollDeviceFlow: vi.fn(),
    authorizePKCE: vi.fn(),
    pollPKCE: vi.fn(),
    verifyToken: vi.fn(),
    revokeToken: vi.fn(),
    getStoredCredentials: vi.fn(),
    storeCredentials: vi.fn(),
    clearCredentials: vi.fn(),
  };
}

const PKCE_INIT: DeviceFlowInitResponse = {
  token: 'pkce-encrypt-token',
  verification_url: 'https://mock-auth.test.qwencloud.com/oauth/authorize?code=PKCE',
  expires_in: 600,
  interval: 5,
  code_verifier: 'verifier-fixture-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const DF_INIT: DeviceFlowInitResponse = {
  token: 'df-encrypt-token',
  verification_url: 'https://mock-auth.test.qwencloud.com/device/verify?code=DF1234',
  expires_in: 600,
  interval: 5,
};

const COMPLETE_POLL: DeviceFlowPollResponse = {
  status: 'complete',
  credentials: makeCredentials(),
};

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('AuthService.loginInit', () => {
  let authClient: MockAuthClient;
  let service: AuthService;
  let savedEnv: string | undefined;

  beforeEach(() => {
    authClient = makeMockAuthClient();
    service = new AuthService(authClient as unknown as AuthClient);
    savedEnv = process.env.QWENCLOUD_AUTH_MODE;
    delete process.env.QWENCLOUD_AUTH_MODE;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.QWENCLOUD_AUTH_MODE;
    } else {
      process.env.QWENCLOUD_AUTH_MODE = savedEnv;
    }
  });

  // LI-01
  it('defaults to PKCE: invokes authorizePKCE and returns auth_mode="pkce" with verifier', async () => {
    authClient.authorizePKCE.mockResolvedValue(PKCE_INIT);

    const result = await service.loginInit();

    expect(authClient.authorizePKCE).toHaveBeenCalledTimes(1);
    expect(authClient.authorizeDeviceFlow).not.toHaveBeenCalled();
    expect(result.auth_mode).toBe('pkce');
    expect(result.code_verifier).toBe(PKCE_INIT.code_verifier);
    expect(result.verification_url).toContain('mock-auth.test.qwencloud.com');
  });

  // LI-02
  it('honours forcedMode=device-flow: invokes authorizeDeviceFlow', async () => {
    authClient.authorizeDeviceFlow.mockResolvedValue(DF_INIT);
    const ctx: AuthModeContext = { forcedMode: 'device-flow' };

    const result = await service.loginInit(ctx);

    expect(authClient.authorizeDeviceFlow).toHaveBeenCalledTimes(1);
    expect(authClient.authorizePKCE).not.toHaveBeenCalled();
    expect(result.auth_mode).toBe('device-flow');
  });

  // LI-03
  it('falls back to Device Flow when QWENCLOUD_AUTH_MODE=device-flow', async () => {
    process.env.QWENCLOUD_AUTH_MODE = 'device-flow';
    authClient.authorizeDeviceFlow.mockResolvedValue(DF_INIT);

    const result = await service.loginInit();

    expect(authClient.authorizeDeviceFlow).toHaveBeenCalledTimes(1);
    expect(authClient.authorizePKCE).not.toHaveBeenCalled();
    expect(result.auth_mode).toBe('device-flow');
  });

  // LI-04
  it('propagates errors when authorizePKCE throws', async () => {
    authClient.authorizePKCE.mockRejectedValue(new Error('pkce init unavailable'));

    await expect(service.loginInit()).rejects.toThrow('pkce init unavailable');
    expect(authClient.pollPKCE).not.toHaveBeenCalled();
  });
});

describe('AuthService.loginPoll', () => {
  let authClient: MockAuthClient;
  let service: AuthService;
  let savedEnv: string | undefined;

  beforeEach(() => {
    authClient = makeMockAuthClient();
    service = new AuthService(authClient as unknown as AuthClient);
    savedEnv = process.env.QWENCLOUD_AUTH_MODE;
    delete process.env.QWENCLOUD_AUTH_MODE;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.QWENCLOUD_AUTH_MODE;
    } else {
      process.env.QWENCLOUD_AUTH_MODE = savedEnv;
    }
  });

  // LI-01 (continued): full PKCE flow
  it('forwards the verifier captured by loginInit when none is passed explicitly', async () => {
    authClient.authorizePKCE.mockResolvedValue(PKCE_INIT);
    authClient.pollPKCE.mockResolvedValue(COMPLETE_POLL);

    await service.loginInit();
    const result = await service.loginPoll(PKCE_INIT.token, 5);

    expect(authClient.pollPKCE).toHaveBeenCalledTimes(1);
    const args = authClient.pollPKCE.mock.calls[0];
    expect(args[0]).toBe(PKCE_INIT.token);
    expect(args[2]).toBe(PKCE_INIT.code_verifier);
    expect(result.status).toBe('complete');
    expect(result.credentials?.access_token).toBe('login-test-access-token');
  });

  // LI-05
  it('returns access_denied untouched when PKCE poll reports user rejection', async () => {
    authClient.authorizePKCE.mockResolvedValue(PKCE_INIT);
    authClient.pollPKCE.mockResolvedValue({ status: 'access_denied' } as DeviceFlowPollResponse);

    await service.loginInit();
    const result = await service.loginPoll(PKCE_INIT.token, 5);

    expect(result.status).toBe('access_denied');
    expect(result.credentials).toBeUndefined();
  });

  // LI-06
  it('returns expired_token untouched when PKCE poll reports timeout', async () => {
    authClient.authorizePKCE.mockResolvedValue(PKCE_INIT);
    authClient.pollPKCE.mockResolvedValue({ status: 'expired_token' } as DeviceFlowPollResponse);

    await service.loginInit();
    const result = await service.loginPoll(PKCE_INIT.token, 5);

    expect(result.status).toBe('expired_token');
  });

  // LI-07
  it('uses the explicit verifier argument over any captured one', async () => {
    authClient.authorizePKCE.mockResolvedValue(PKCE_INIT);
    authClient.pollPKCE.mockResolvedValue(COMPLETE_POLL);

    await service.loginInit();
    await service.loginPoll(PKCE_INIT.token, 5, 'explicit-verifier-override');

    const args = authClient.pollPKCE.mock.calls[0];
    expect(args[2]).toBe('explicit-verifier-override');
  });

  // LI-08
  it('routes to pollDeviceFlow when no verifier was captured and none is passed', async () => {
    authClient.pollDeviceFlow.mockResolvedValue(COMPLETE_POLL);

    const result = await service.loginPoll(DF_INIT.token, 5);

    expect(authClient.pollDeviceFlow).toHaveBeenCalledTimes(1);
    expect(authClient.pollPKCE).not.toHaveBeenCalled();
    expect(result.status).toBe('complete');
  });

  // LP-01 — auth_mode/verifier exposed for persistence
  it('loginInit exposes both auth_mode and code_verifier so callers can persist LoginPendingState (PKCE branch)', async () => {
    authClient.authorizePKCE.mockResolvedValue(PKCE_INIT);
    const initResult = await service.loginInit();
    expect(initResult.auth_mode).toBe('pkce');
    expect(initResult.code_verifier).toBeDefined();
    expect(typeof initResult.code_verifier).toBe('string');
  });

  // LP-02
  it('loginInit returns auth_mode="device-flow" with no verifier on Device Flow branch', async () => {
    authClient.authorizeDeviceFlow.mockResolvedValue(DF_INIT);
    const initResult = await service.loginInit({ forcedMode: 'device-flow' });
    expect(initResult.auth_mode).toBe('device-flow');
    expect(initResult.code_verifier).toBeUndefined();
  });
});

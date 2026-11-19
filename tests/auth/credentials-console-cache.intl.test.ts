import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../../src/types/auth.js';

const { files, records, unlinkSync } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const records = new Map<string, Record<string, unknown>>();
  return {
    files,
    records,
    unlinkSync: vi.fn((path: string) => {
      files.delete(path);
      records.delete(path);
    }),
  };
});
const credentialsPath = resolve('tests/mock-files/root-credentials');
vi.mock('../../src/config/paths.js', async () => {
  const { resolve } = await import('node:path');
  return { getCredentialsPath: () => resolve('tests/mock-files/root-credentials') };
});
vi.mock('../../src/auth/keychain.js', () => ({
  isKeychainAvailable: () => false,
  isPlaintextMode: () => false,
  readFromKeychain: () => null,
  writeToKeychain: () => false,
  deleteFromKeychain: () => false,
  clearKeychainAvailableCache: vi.fn(),
  KEYCHAIN_SERVICE: 'mock-keychain-service',
  KEYCHAIN_ACCOUNT: 'mock-keychain-account',
}));
vi.mock('../../src/auth/crypto-store.js', () => ({
  isEncryptedEnvelope: (content: string) => content === 'mock-encrypted-envelope',
  writeEncryptedCredentials: vi.fn((data: Record<string, unknown>, path: string) => {
    records.set(path, data);
    files.set(path, 'mock-encrypted-envelope');
  }),
  readEncryptedCredentials: (path: string) => records.get(path) ?? null,
  writePlaintextCredentials: vi.fn(() => {
    throw new Error('Root credentials must not be stored in plaintext');
  }),
}));
vi.mock('fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => files.get(path) ?? '',
  writeFileSync: (path: string, content: string) => {
    files.set(path, content);
  },
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  unlinkSync,
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => files.get(path) ?? '',
  writeFileSync: (path: string, content: string) => {
    files.set(path, content);
  },
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  unlinkSync,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  files.clear();
  records.clear();
});
function credentials(): Credentials {
  return {
    access_token: 'mock-root-credential',
    expires_at: '2099-01-01T00:00:00Z',
    user: { email: 'mock-user@test.qwencloud.com', aliyunId: 'mock-account' },
  };
}

describe('Root credential lifecycle clears derived credentials', () => {
  it('removes the old console cache when new root credentials are written', async () => {
    const { writeCredentials, readCredentials } = await import('../../src/auth/credentials.js');
    files.set(credentialsPath + '.console', 'mock-stale-console-envelope');

    writeCredentials(credentials());

    expect(unlinkSync).toHaveBeenCalledWith(credentialsPath + '.console');
    expect(files.has(credentialsPath + '.console')).toBe(false);
    expect(readCredentials()).toEqual(credentials());
  });

  it('deletes root and console cache through the real logout credential entry point', async () => {
    const { writeCredentials, deleteCredentials } = await import('../../src/auth/credentials.js');
    writeCredentials(credentials());
    files.set(credentialsPath + '.console', 'mock-console-envelope');
    unlinkSync.mockClear();

    expect(deleteCredentials()).toBe(true);

    expect(unlinkSync).toHaveBeenCalledWith(credentialsPath);
    expect(unlinkSync).toHaveBeenCalledWith(credentialsPath + '.console');
    expect(files.has(credentialsPath)).toBe(false);
    expect(files.has(credentialsPath + '.console')).toBe(false);
  });

  it('persists and resolves a new account when stale cache cleanup is denied', async () => {
    const { writeCredentials, resolveCredentials } = await import('../../src/auth/credentials.js');
    writeCredentials(credentials());
    expect(resolveCredentials()?.access_token).toBe('mock-root-credential');
    files.set(credentialsPath + '.console', 'mock-stale-console-envelope');
    unlinkSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('Mock cache access denied'), { code: 'EACCES' });
    });
    const next = {
      ...credentials(),
      access_token: 'mock-next-root-credential',
      user: { email: 'mock-next@test.qwencloud.com', aliyunId: 'mock-next-account' },
    };

    expect(() => writeCredentials(next)).not.toThrow();

    expect(resolveCredentials()?.access_token).toBe(next.access_token);
    expect(resolveCredentials()?.credentials?.user?.aliyunId).toBe(next.user.aliyunId);
    expect(files.has(credentialsPath + '.console')).toBe(true);
  });

  it('deletes root credentials and clears resolution when cache cleanup is denied', async () => {
    const { writeCredentials, resolveCredentials, deleteCredentials } =
      await import('../../src/auth/credentials.js');
    writeCredentials(credentials());
    expect(resolveCredentials()).not.toBeNull();
    files.set(credentialsPath + '.console', 'mock-stale-console-envelope');
    unlinkSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('Mock cache access denied'), { code: 'EACCES' });
    });

    expect(deleteCredentials()).toBe(true);

    expect(files.has(credentialsPath)).toBe(false);
    expect(resolveCredentials()).toBeNull();
  });

  it('still reports failures to persist root credentials', async () => {
    const { writeCredentials } = await import('../../src/auth/credentials.js');
    const { writeEncryptedCredentials } = await import('../../src/auth/crypto-store.js');
    vi.mocked(writeEncryptedCredentials).mockImplementationOnce(() => {
      throw new Error('Mock root storage unavailable');
    });

    expect(() => writeCredentials(credentials())).toThrow('Mock root storage unavailable');
    expect(files.has(credentialsPath)).toBe(false);
  });

  it('still reports failures to delete root credentials', async () => {
    const { writeCredentials, deleteCredentials } = await import('../../src/auth/credentials.js');
    writeCredentials(credentials());
    unlinkSync
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('Mock root deletion unavailable');
      });

    expect(() => deleteCredentials()).toThrow('Mock root deletion unavailable');
    expect(files.has(credentialsPath)).toBe(true);
  });
});

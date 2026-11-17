import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectTmpdir } from '../fixtures/plugin-temporary-root.js';
import {
  getRegistryPluginMetadata,
  getRegistryVersion,
  installNpmPlugin,
} from '../../src/plugins/installer.js';
import { CliError } from '../../src/utils/errors.js';

vi.mock('../../src/plugins/npm-registry.js', () => ({
  resolveRegistryForPackage: () => ({ registry: 'https://registry.test.qwencloud.com/' }),
}));

const pkg = '@qwencloud/auth-check';
const tarball = 'https://registry.test.qwencloud.com/auth-check/-/auth-check-1.0.1.tgz';
const packument = {
  'dist-tags': { latest: '1.0.1' },
  versions: {
    '1.0.1': {
      name: pkg,
      version: '1.0.1',
      dist: { tarball, integrity: 'sha512-AA==' },
    },
  },
};
let root: string;
let pluginsDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(projectTmpdir(), 'registry-auth-'));
  pluginsDir = path.join(root, 'plugins');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe.each([
  ['version', getRegistryVersion],
  ['metadata', getRegistryPluginMetadata],
] as const)('registry %s lookup', (_name, lookup) => {
  it.each([401, 403])('rejects HTTP %s with an authentication exit code', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('denied', { status }));
    const result = lookup(pkg, { fetchImpl });
    await expect(result).rejects.toBeInstanceOf(CliError);
    await expect(result).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      exitCode: 2,
      message: expect.stringContaining(`HTTP ${status}`),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([404, 429, 500])('keeps HTTP %s as a nullable best-effort result', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('unavailable', { status }));
    expect(await lookup(pkg, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps connection failures nullable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('mock offline'));
    expect(await lookup(pkg, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps missing latest tags nullable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ versions: {} }));
    expect(await lookup(pkg, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

it('preserves valid version and metadata results', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(packument));
  expect(await getRegistryVersion(pkg, { fetchImpl })).toBe('1.0.1');
  expect(await getRegistryPluginMetadata(pkg, { fetchImpl })).toEqual({
    latest: '1.0.1',
    versions: packument.versions,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('keeps metadata nullable when the tagged version record is missing', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    Response.json({ 'dist-tags': { latest: '1.0.1' }, versions: {} }),
  );
  expect(await getRegistryPluginMetadata(pkg, { fetchImpl })).toBeNull();
  expect(fetchImpl).toHaveBeenCalledOnce();
});

describe.each(['metadata', 'tarball'] as const)('installation %s access', (stage) => {
  describe.each([false, true])('with an existing installation: %s', (existing) => {
    it.each([401, 403])(
      'returns HTTP %s as exit 2 without changing installed bytes',
      async (status) => {
        const destination = path.join(pluginsDir, 'node_modules', pkg);
        const oldPackage = JSON.stringify({ name: pkg, version: '1.0.0' });
        if (existing) {
          mkdirSync(destination, { recursive: true });
          writeFileSync(path.join(destination, 'package.json'), oldPackage);
          writeFileSync(path.join(destination, 'index.mjs'), 'export const stable = true;');
        }
        const fetchImpl = vi.fn<typeof fetch>(async (input) => {
          if (stage === 'tarball' && String(input) !== tarball) return Response.json(packument);
          return new Response('denied', { status });
        });

        const result = await installNpmPlugin(pkg, pluginsDir, { fetchImpl });

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected installation rejection');
        expect(result.cliError).toBeInstanceOf(CliError);
        expect(result.cliError).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', exitCode: 2 });
        expect(result.error).toContain(`HTTP ${status}`);
        expect(fetchImpl).toHaveBeenCalledTimes(stage === 'metadata' ? 1 : 2);
        if (stage === 'tarball') expect(fetchImpl.mock.calls[1]?.[0]).toBe(tarball);
        if (existing) {
          expect(readFileSync(path.join(destination, 'package.json'), 'utf8')).toBe(oldPackage);
          expect(readFileSync(path.join(destination, 'index.mjs'), 'utf8')).toBe(
            'export const stable = true;',
          );
        } else {
          expect(existsSync(destination)).toBe(false);
        }
      },
    );
  });

  it.each([404, 429, 500])('preserves HTTP %s network-error classification', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (stage === 'tarball' && String(input) !== tarball) return Response.json(packument);
      return new Response('unavailable', { status });
    });
    const result = await installNpmPlugin(pkg, pluginsDir, { fetchImpl });
    expect(result).toMatchObject({
      ok: false,
      cliError: { code: 'PLUGIN_INSTALL_FAILED', exitCode: 3 },
      error: expect.stringContaining(`HTTP ${status}`),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(stage === 'metadata' ? 1 : 2);
    expect(existsSync(path.join(pluginsDir, 'node_modules', pkg))).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectTmpdir } from '../../fixtures/plugin-temporary-root.js';
import { runCommand } from '../../helpers/run-command.js';
import { registerPluginUpdateCommand } from '../../../src/commands/plugin/update.js';
import { registerPluginInstallCommand } from '../../../src/commands/plugin/install.js';
import type { InstalledManifest } from '../../../src/plugins/manifest.js';

const state = vi.hoisted(() => ({ root: '', fetch: vi.fn<typeof fetch>() }));
vi.mock('../../../src/config/paths.js', async (original) => ({
  ...(await original<typeof import('../../../src/config/paths.js')>()),
  getPluginsDir: () => path.join(state.root, 'plugins'),
  getPluginsManifestPath: () => path.join(state.root, 'plugins.json'),
}));
vi.mock('../../../src/config/manager.js', () => ({ getEffectiveConfig: () => ({}) }));
vi.mock('../../../src/plugins/npm-registry.js', () => ({
  resolveRegistryForPackage: () => ({ registry: 'https://registry.test.qwencloud.com/' }),
}));

const denied = '@qwencloud/denied';
const forbidden = '@qwencloud/forbidden';
const available = '@qwencloud/available';
const offline = '@qwencloud/offline';
const linked = '@qwencloud/linked';
const malformed = '@qwencloud/malformed';
const formats = ['json', 'text', 'table'] as const;
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  state.root = mkdtempSync(path.join(projectTmpdir(), 'plugin-auth-'));
  mkdirSync(path.join(state.root, 'plugins'));
  save([]);
  state.fetch.mockReset().mockRejectedValue(new Error('Unexpected registry request'));
  vi.stubGlobal('fetch', state.fetch);
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  previousExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = previousExitCode;
  rmSync(state.root, { recursive: true, force: true });
});

function save(plugins: InstalledManifest['plugins']): void {
  writeFileSync(path.join(state.root, 'plugins.json'), JSON.stringify({ plugins }));
}

function update(args: string[]) {
  return runCommand(
    (program) => registerPluginUpdateCommand(program.command('plugin')),
    ['plugin', 'update', ...args],
  );
}

describe.each([false, true])('registry update with named target: %s', (named) => {
  describe.each(formats)('%s output', (format) => {
    it.each([401, 403])('reports HTTP %s through authentication failure', async (status) => {
      save([{ name: denied, version: '1.0.0', enabled: true, source: 'npm' }]);
      state.fetch.mockImplementation(async () => new Response('denied', { status }));

      const result = await update([...(named ? [denied] : []), '--format', format]);

      expect(result.exitCode).toBe(2);
      expect(state.fetch).toHaveBeenCalledOnce();
      expect(result.stderr).toContain(`HTTP ${status}`);
      expect(result.stderr).toContain(denied);
      expect(result.stderr).toMatch(/auth|access.*denied|forbidden/i);
      expect(result.stdout + result.stderr).not.toMatch(
        /registry unreachable|all.*latest|all.*up.to.date/i,
      );
      expect(result.stderr).not.toMatch(/\n\s+at\s/);
      if (format === 'json') {
        expect(JSON.parse(result.stdout)).toEqual({
          updates: [],
          incompatible: [],
          invalidMetadata: [],
          uncheckable: [denied],
          unsupported: [],
        });
        expect(JSON.parse(result.stderr).error.code).toBe('PLUGIN_INSTALL_FAILED');
      }
    });

    it('retains an ordinary unavailable result without an authentication exit', async () => {
      save([{ name: offline, version: '1.0.0', enabled: true, source: 'npm' }]);
      state.fetch.mockImplementation(async () => new Response('unavailable', { status: 500 }));

      const result = await update([...(named ? [offline] : []), '--format', format]);

      expect(result.exitCode).toBeUndefined();
      expect(process.exitCode).toBe(0);
      expect(state.fetch).toHaveBeenCalledOnce();
      expect(result.stderr).toBe('');
      if (format === 'json') {
        expect(JSON.parse(result.stdout)).toEqual({
          updates: [],
          incompatible: [],
          invalidMetadata: [],
          uncheckable: [offline],
          unsupported: [],
        });
      } else {
        expect(result.stdout).toContain(offline);
        expect(result.stdout).toMatch(/registry unreachable/i);
        expect(result.stdout).not.toMatch(/all.*latest|all.*up.to.date/i);
      }
    });

    it('retains a successful compatible update', async () => {
      save([{ name: available, version: '1.0.0', enabled: true, source: 'npm' }]);
      state.fetch.mockImplementation(async () =>
        Response.json({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '2.0.0': { qwencloud: { minCliVersion: '99.0.0' } },
            '1.0.1': { qwencloud: { minCliVersion: '0.9.0' } },
          },
        }),
      );

      const result = await update([...(named ? [available] : []), '--format', format]);

      expect(result.exitCode).toBeUndefined();
      expect(process.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(state.fetch).toHaveBeenCalledOnce();
      if (format === 'json') {
        expect(JSON.parse(result.stdout)).toEqual({
          updates: [
            {
              name: available,
              current: '1.0.0',
              latest: '1.0.1',
              command: `qwencloud plugin install ${available}@1.0.1`,
            },
          ],
          incompatible: [{ name: available, version: '2.0.0', minCliVersion: '99.0.0' }],
          invalidMetadata: [],
          uncheckable: [],
          unsupported: [],
        });
      } else {
        expect(result.stdout).toContain(available);
        expect(result.stdout).toContain('1.0.1');
      }
    });
  });
});

it.each(formats)(
  'preserves every aggregate result in %s despite two access denials',
  async (format) => {
    save([
      { name: denied, version: '1.0.0', enabled: true, source: 'npm' },
      { name: available, version: '1.0.0', enabled: true, source: 'npm' },
      { name: offline, version: '1.0.0', enabled: true, source: 'npm' },
      { name: forbidden, version: '1.0.0', enabled: true, source: 'npm' },
      { name: linked, version: '1.0.0', enabled: true, source: 'link' },
      { name: malformed, version: '1.0.0', enabled: true, source: 'npm' },
    ]);
    state.fetch.mockImplementation(async (input) => {
      const url = decodeURIComponent(String(input));
      if (url.endsWith(denied)) return new Response('unauthorized', { status: 401 });
      if (url.endsWith(forbidden)) return new Response('forbidden', { status: 403 });
      if (url.endsWith(offline)) return new Response('unavailable', { status: 500 });
      if (url.endsWith(available)) {
        return Response.json({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '2.0.0': { qwencloud: { minCliVersion: '99.0.0' } },
            '1.0.1': { qwencloud: { minCliVersion: '0.9.0' } },
          },
        });
      }
      if (url.endsWith(malformed)) {
        return Response.json({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '2.0.0': { qwencloud: { minCliVersion: 'not-semver' } },
            '1.0.0': { qwencloud: { minCliVersion: '0.9.0' } },
          },
        });
      }
      throw new Error('Unexpected registry request');
    });

    const result = await update(['--format', format]);

    expect(result.exitCode).toBe(2);
    expect(state.fetch).toHaveBeenCalledTimes(5);
    expect(result.stderr).toContain(denied);
    expect(result.stderr).toContain(forbidden);
    expect(result.stderr).toContain('HTTP 401');
    expect(result.stderr).toContain('HTTP 403');
    expect(result.stderr).not.toContain(offline);
    expect(result.stderr).not.toMatch(/\n\s+at\s/);
    if (format === 'json') {
      expect(JSON.parse(result.stdout)).toEqual({
        updates: [
          {
            name: available,
            current: '1.0.0',
            latest: '1.0.1',
            command: `qwencloud plugin install ${available}@1.0.1`,
          },
        ],
        incompatible: [{ name: available, version: '2.0.0', minCliVersion: '99.0.0' }],
        invalidMetadata: [
          { name: malformed, version: '2.0.0', reason: 'invalid minCliVersion "not-semver"' },
        ],
        uncheckable: [denied, offline, forbidden],
        unsupported: [{ name: linked, source: 'link' }],
      });
      expect(JSON.parse(result.stderr).error.code).toBe('PLUGIN_INSTALL_FAILED');
    } else {
      expect(result.stdout).toContain(available);
      expect(result.stdout).toContain('1.0.1');
      expect(result.stdout).toContain(linked);
      expect(result.stdout).toContain('link');
      expect(result.stdout).toContain('requires CLI >= 99.0.0');
      expect(result.stdout).toContain(malformed);
      expect(result.stdout).toContain('invalid minCliVersion "not-semver"');
      expect(result.stdout).toMatch(/registry unreachable/i);
      const unreachableLine = result.stdout
        .split('\n')
        .find((line) => /registry unreachable/i.test(line));
      expect(unreachableLine).toContain(offline);
      expect(unreachableLine).not.toContain(denied);
      expect(unreachableLine).not.toContain(forbidden);
      expect(result.stdout).not.toMatch(/all.*latest|all.*up.to.date/i);
    }
  },
);

describe.each(formats)('plugin installation in %s', (format) => {
  it.each([401, 403])('returns HTTP %s as exit 2 without committing a record', async (status) => {
    state.fetch.mockImplementation(async () => new Response('denied', { status }));
    const manifestBefore = readFileSync(path.join(state.root, 'plugins.json'), 'utf8');

    const result = await runCommand(
      (program) => registerPluginInstallCommand(program.command('plugin')),
      ['plugin', 'install', denied, '--format', format],
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`HTTP ${status}`);
    expect(result.stderr).not.toMatch(/\n\s+at\s/);
    expect(state.fetch).toHaveBeenCalledOnce();
    if (format === 'json')
      expect(JSON.parse(result.stderr).error.code).toBe('PLUGIN_INSTALL_FAILED');
    expect(readFileSync(path.join(state.root, 'plugins.json'), 'utf8')).toBe(manifestBefore);
    expect(existsSync(path.join(state.root, 'plugins', 'node_modules', denied))).toBe(false);
  });
});

it.each([401, 403])(
  'preserves the installed record and bytes after tarball HTTP %s',
  async (status) => {
    const destination = path.join(state.root, 'plugins', 'node_modules', denied);
    mkdirSync(destination, { recursive: true });
    const oldPackage = JSON.stringify({
      name: denied,
      version: '1.0.0',
      qwencloud: { command: 'denied', entry: './index.mjs', handlerKey: 'run' },
    });
    writeFileSync(path.join(destination, 'package.json'), oldPackage);
    writeFileSync(path.join(destination, 'index.mjs'), 'export const handlers = {};');
    save([{ name: denied, version: '1.0.0', enabled: true, source: 'npm', command: 'denied' }]);
    const manifestBefore = readFileSync(path.join(state.root, 'plugins.json'), 'utf8');
    const tarball = 'https://registry.test.qwencloud.com/denied/-/denied-1.0.1.tgz';
    state.fetch.mockImplementation(async (input) => {
      if (String(input) === tarball) return new Response('denied', { status });
      return Response.json({
        'dist-tags': { latest: '1.0.1' },
        versions: {
          '1.0.1': {
            name: denied,
            version: '1.0.1',
            dist: { tarball, integrity: 'sha512-AA==' },
          },
        },
      });
    });

    const result = await runCommand(
      (program) => registerPluginInstallCommand(program.command('plugin')),
      ['plugin', 'install', denied, '--format', 'json'],
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe('PLUGIN_INSTALL_FAILED');
    expect(result.stderr).toContain(`HTTP ${status}`);
    expect(result.stdout).toBe('');
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(state.fetch.mock.calls[1]?.[0]).toBe(tarball);
    expect(readFileSync(path.join(state.root, 'plugins.json'), 'utf8')).toBe(manifestBefore);
    expect(readFileSync(path.join(destination, 'package.json'), 'utf8')).toBe(oldPackage);
    expect(readFileSync(path.join(destination, 'index.mjs'), 'utf8')).toBe(
      'export const handlers = {};',
    );
  },
);

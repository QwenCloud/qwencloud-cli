import { snapshotDirectory } from '../fixtures/plugin-directory.js';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findConfiguredOpenApiPolicy,
  getConfiguredOpenApiRules,
  type OpenApiPolicyRule,
} from '../../src/config/openapi-policy.js';
import { installManagedPlugin, ensureDefaultPlugin } from '../../src/plugins/default-install.js';
import { installLocalPlugin } from '../../src/plugins/installer.js';
import type { DefaultPlugin } from '../../src/plugins/defaults.js';
import type { InstalledManifest, PluginManifest } from '../../src/plugins/manifest.js';

const state = vi.hoisted(() => ({ root: '', pluginsDir: '', manifestPath: '' }));
vi.mock('../../src/config/paths.js', async (original) => ({
  ...(await original<typeof import('../../src/config/paths.js')>()),
  getConfigDir: () => state.root,
  getPluginsDir: () => state.pluginsDir,
  getPluginsManifestPath: () => state.manifestPath,
}));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  const homedir = () => state.root;
  return { ...actual, homedir, default: { ...actual, homedir } };
});
vi.mock('../../src/plugins/defaults.js', () => ({
  getDefaultPlugins: () => [],
  getDefaultPlugin: () => undefined,
}));
vi.mock('../../plugins.preload.json', () => ({ default: { plugins: [] } }));

const packageName = '@qwencloud/host-regressions';
const currentCliVersion = '1.10.0';
const oldPolicy: OpenApiPolicyRule = {
  product: 'RegressionPortal',
  actions: ['ReadOldEntry'],
  auth: 'required',
};
const newPolicy: OpenApiPolicyRule = {
  product: 'RegressionPortal',
  actions: ['ReadCandidateEntry'],
  auth: 'optional',
};
const declared: PluginManifest = {
  command: 'regression',
  entry: './index.mjs',
  handlerKey: 'run',
  minCliVersion: '1.0.0',
  apiPolicy: [oldPolicy],
};

function context(): Parameters<typeof installManagedPlugin>[1] {
  return {
    pluginsDir: state.pluginsDir,
    manifestPath: state.manifestPath,
    cliVersion: currentCliVersion,
    definitions: [],
  };
}

function destination(): string {
  return path.join(state.pluginsDir, 'node_modules', packageName);
}

function source(id: string, changes: Partial<PluginManifest> = {}, version = '1.0.0'): string {
  const directory = path.join(state.root, 'sources', id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: packageName, version, qwencloud: { ...declared, ...changes } }),
  );
  fs.writeFileSync(path.join(directory, 'index.mjs'), 'export const handlers = { run() {} };');
  fs.writeFileSync(path.join(directory, 'content.txt'), id);
  return directory;
}

function snapshot(directory = state.pluginsDir): Record<string, string> {
  return snapshotDirectory(directory);
}

async function seed(): Promise<string> {
  await installManagedPlugin(source('old'), context());
  return fs.readFileSync(state.manifestPath, 'utf8');
}

function expectOldInstallation(manifestBefore: string): void {
  expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(manifestBefore);
  expect(fs.readFileSync(path.join(destination(), 'content.txt'), 'utf8')).toBe('old');
  expect(
    JSON.parse(fs.readFileSync(path.join(destination(), 'package.json'), 'utf8')).version,
  ).toBe('1.0.0');
  expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
}

beforeEach(() => {
  const temporaryRoot = path.resolve(__dirname, '../../.local-test-tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  state.root = fs.mkdtempSync(path.join(temporaryRoot, 'host-regressions-'));
  state.pluginsDir = path.join(state.root, 'plugins');
  state.manifestPath = path.join(state.root, 'plugins.json');
  fs.writeFileSync(state.manifestPath, JSON.stringify({ plugins: [] }));
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Network is forbidden in plugin host regressions');
    }),
  );
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

describe('API policy follows committed, usable plugin state', () => {
  it('does not expose a same-version pending candidate or recover it during a policy read', async () => {
    const before = await seed();
    const candidate = source('candidate', { apiPolicy: [newPolicy] });
    const result = installLocalPlugin(candidate, state.pluginsDir, { recoverable: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const committed = JSON.parse(before) as InstalledManifest;
    expect(result.tx.installationId).toEqual(expect.any(String));
    expect(result.tx.installationId).not.toBe(committed.plugins[0].installationId);
    const filesBefore = snapshot();

    try {
      expect(getConfiguredOpenApiRules()).toEqual([]);
      expect(findConfiguredOpenApiPolicy(newPolicy.product, newPolicy.actions[0])).toBeUndefined();
      expect(snapshot()).toEqual(filesBefore);
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
      expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
    } finally {
      result.tx.rollback();
    }

    expect(getConfiguredOpenApiRules()).toEqual([oldPolicy]);
    await installManagedPlugin(candidate, context());
    expect(getConfiguredOpenApiRules()).toEqual([newPolicy]);
    expect(findConfiguredOpenApiPolicy(oldPolicy.product, oldPolicy.actions[0])).toBeUndefined();
  });

  it('keeps healthy unrelated policy available while a different plugin has a pending install', async () => {
    await seed();
    const healthyName = '@qwencloud/policy-healthy';
    const healthy = path.join(state.pluginsDir, 'node_modules', healthyName);
    fs.mkdirSync(healthy, { recursive: true });
    fs.writeFileSync(
      path.join(healthy, 'package.json'),
      JSON.stringify({
        name: healthyName,
        version: '1.0.0',
        qwencloud: { ...declared, command: 'healthy', apiPolicy: [oldPolicy] },
      }),
    );
    fs.writeFileSync(path.join(healthy, 'index.mjs'), 'export const handlers = { run() {} };');
    const manifest = JSON.parse(fs.readFileSync(state.manifestPath, 'utf8')) as InstalledManifest;
    manifest.plugins.push({ name: healthyName, version: '1.0.0', source: 'local', enabled: true });
    fs.writeFileSync(state.manifestPath, JSON.stringify(manifest));
    const result = installLocalPlugin(
      source('candidate', { apiPolicy: [newPolicy] }),
      state.pluginsDir,
      {
        recoverable: true,
      },
    );
    if (!result.ok) throw new Error(result.error);

    try {
      expect(getConfiguredOpenApiRules()).toEqual([oldPolicy]);
      expect(findConfiguredOpenApiPolicy(newPolicy.product, newPolicy.actions[0])).toBeUndefined();
    } finally {
      result.tx.rollback();
    }
  });
});

describe('plugin validation retains actionable error categories', () => {
  it.each(['missing', 'missing-parent', 'non-directory-parent', 'directory'] as const)(
    'rejects a %s entry as plugin validation and restores the old package',
    async (kind) => {
      const before = await seed();
      const entry = kind.endsWith('parent')
        ? './parent/unusable-entry.mjs'
        : './unusable-entry.mjs';
      const candidate = source('candidate', { entry }, '2.0.0');
      if (kind === 'directory') fs.mkdirSync(path.join(candidate, 'unusable-entry.mjs'));
      if (kind === 'non-directory-parent') fs.writeFileSync(path.join(candidate, 'parent'), 'file');

      const error: unknown = await installManagedPlugin(candidate, context()).catch(
        (failure: unknown) => failure,
      );
      expect(error).toMatchObject({
        code: 'PLUGIN_ENTRY_INVALID',
        exitCode: 4,
        message: expect.stringContaining(packageName),
      });
      expect(error).toMatchObject({
        message: expect.stringContaining(entry),
      });
      expectOldInstallation(before);
    },
  );

  it('preserves an entry permission error instead of misreporting it as a missing entry', async () => {
    const before = await seed();
    const candidate = source('candidate', {}, '2.0.0');
    const failure = Object.assign(new Error('Fixture entry permission failure'), {
      code: 'EACCES',
    });
    const realpath = fs.realpathSync;
    vi.spyOn(fs, 'realpathSync').mockImplementation(((file: fs.PathLike) => {
      if (String(file) === path.join(destination(), 'index.mjs')) throw failure;
      return realpath(file);
    }) as typeof fs.realpathSync);

    await expect(installManagedPlugin(candidate, context())).rejects.toBe(failure);
    expectOldInstallation(before);
  });

  it('classifies a candidate minimum CLI mismatch without replacing the installed package', async () => {
    const before = await seed();
    const candidate = source('candidate', { minCliVersion: '99.0.0' }, '2.0.0');

    await expect(installManagedPlugin(candidate, context())).rejects.toMatchObject({
      code: 'PLUGIN_CLI_INCOMPATIBLE',
      exitCode: 4,
      minCliVersion: '99.0.0',
      currentCliVersion,
    });
    expectOldInstallation(before);
  });

  it('retains the same structured incompatibility for an installed default without downloading', async () => {
    await seed();
    const packagePath = path.join(destination(), 'package.json');
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
      qwencloud: PluginManifest;
    };
    metadata.qwencloud.minCliVersion = '99.0.0';
    fs.writeFileSync(packagePath, JSON.stringify(metadata));
    const before = snapshot();
    const configured: DefaultPlugin = {
      name: packageName,
      version: '1.0.0',
      command: declared.command,
      source: { type: 'archive', path: path.join(state.root, 'must-not-download.tgz') },
    };

    await expect(
      ensureDefaultPlugin(configured, { ...context(), definitions: [configured] }),
    ).rejects.toMatchObject({
      code: 'PLUGIN_CLI_INCOMPATIBLE',
      exitCode: 4,
      minCliVersion: '99.0.0',
      currentCliVersion,
    });
    expect(snapshot()).toEqual(before);
  });
});

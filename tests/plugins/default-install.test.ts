import { writePluginPackage } from '../fixtures/plugin-package.js';
import { installedRecord } from '../fixtures/plugin-cancellation.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { DefaultPlugin } from '../../src/plugins/defaults.js';
import type { InstallResult } from '../../src/plugins/installer.js';
import type {
  InstalledManifest,
  InstalledPlugin,
  PluginManifest,
} from '../../src/plugins/manifest.js';
import {
  ensureDefaultPlugin,
  installManagedPlugin,
  readUsableDefaultPlugin,
  uninstallManagedPlugin,
} from '../../src/plugins/default-install.js';
import { installLocalPlugin } from '../../src/plugins/installer.js';
import { readInstalledManifest } from '../../src/plugins/manifest.js';
import { buildTarball } from '../fixtures/tar-builder.js';

const registry = vi.hoisted(() => ({
  install: vi.fn<(spec: string, pluginsDir: string) => Promise<InstallResult>>(),
}));

vi.mock('../../src/plugins/installer.js', async (original) => ({
  ...(await original<typeof import('../../src/plugins/installer.js')>()),
  installNpmPlugin: registry.install,
}));

const workspace = path.resolve(__dirname, '../..');
const packageName = '@qwencloud/default-test';
const baseManifest: PluginManifest = {
  command: 'catalog',
  commandAliases: ['catg'],
  entry: './index.mjs',
  handlerKey: 'run',
  minCliVersion: '1.0.0',
};

let root: string;
let pluginsDir: string;
let manifestPath: string;
let packages: Map<string, string>;

function definition(overrides: Partial<DefaultPlugin> = {}): DefaultPlugin {
  return {
    name: packageName,
    version: '1.2.3',
    command: baseManifest.command,
    commandAliases: baseManifest.commandAliases,
    source: { type: 'npm' },
    ...overrides,
  };
}

function context(
  definitions: readonly DefaultPlugin[] = [definition()],
): Parameters<typeof ensureDefaultPlugin>[1] {
  return {
    pluginsDir,
    manifestPath,
    cliVersion: '1.10.0',
    reservedNames: new Set(['models', 'm', 'plugin']),
    definitions,
  };
}

function writePackage(
  directory: string,
  name = packageName,
  version = '1.2.3',
  manifest: PluginManifest = baseManifest,
): string {
  return writePluginPackage(
    directory,
    { name, version, qwencloud: manifest },
    {
      name: 'index.mjs',
      content: `export const handlers = { ${JSON.stringify(manifest.handlerKey ?? 'run')}() {} };`,
    },
  );
}

function providePackage(
  version = '1.2.3',
  manifest: PluginManifest = baseManifest,
  name = packageName,
): string {
  const directory = writePackage(
    path.join(root, 'registry', name, version),
    name,
    version,
    manifest,
  );
  packages.set(`${name}@${version}`, directory);
  return directory;
}

function seedInstalled(
  version = '1.2.3',
  manifest: PluginManifest = baseManifest,
  name = packageName,
): InstalledPlugin {
  writePackage(path.join(pluginsDir, 'node_modules', name), name, version, manifest);
  return {
    ...installedRecord({ name, version }),
    command: manifest.command,
    commandAliases: manifest.commandAliases,
  };
}

function writeInstalled(plugins: InstalledPlugin[], disabledDefaults?: string[]): void {
  writeFileSync(
    manifestPath,
    JSON.stringify({ plugins, ...(disabledDefaults ? { disabledDefaults } : {}) }),
  );
}

function installed(): InstalledManifest {
  return readInstalledManifest(manifestPath);
}

function installedPackage(): { name: string; version: string; qwencloud: PluginManifest } {
  return JSON.parse(
    readFileSync(path.join(pluginsDir, 'node_modules', packageName, 'package.json'), 'utf8'),
  ) as { name: string; version: string; qwencloud: PluginManifest };
}

beforeEach(() => {
  const temporaryRoot = path.join(workspace, '.local-test-tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  root = mkdtempSync(path.join(temporaryRoot, 'default-install-'));
  pluginsDir = path.join(root, 'plugins');
  manifestPath = path.join(root, 'plugins.json');
  packages = new Map();
  registry.install.mockReset();
  registry.install.mockImplementation(async (spec, target) => {
    const source = packages.get(spec);
    if (!source) return { ok: false, error: `No fixture for ${spec}` };
    return installLocalPlugin(source, target);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Network is forbidden in this test');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('default plugin installation', () => {
  it('installs the exact configured npm version and persists its command metadata', async () => {
    providePackage();
    providePackage('9.9.9');

    const result = await ensureDefaultPlugin(definition(), context());

    expect(result).toMatchObject({
      name: packageName,
      version: '1.2.3',
      enabled: true,
      source: 'npm',
    });
    expect(installed().plugins).toEqual([
      expect.objectContaining({
        name: packageName,
        version: '1.2.3',
        command: 'catalog',
        commandAliases: ['catg'],
      }),
    ]);
    expect(installedPackage().version).toBe('1.2.3');
    expect(registry.install.mock.calls.map(([spec]) => spec)).toEqual([`${packageName}@1.2.3`]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('upgrades a usable installed version below the configured minimum', async () => {
    writeInstalled([seedInstalled('1.0.0')]);
    providePackage();

    const result = await ensureDefaultPlugin(definition(), context());

    expect(result.version).toBe('1.2.3');
    expect(installedPackage().version).toBe('1.2.3');
    expect(installed().plugins[0].version).toBe('1.2.3');
    expect(registry.install.mock.calls.map(([spec]) => spec)).toEqual([`${packageName}@1.2.3`]);
  });

  it.each(['1.2.3', '4.5.6'])(
    'preserves compatible installed version %s at or above the minimum without downloading or rewriting',
    async (version) => {
      const record = seedInstalled(version);
      writeInstalled([record]);
      const before = readFileSync(manifestPath, 'utf8');
      const entry = path.join(pluginsDir, 'node_modules', packageName, 'index.mjs');
      writeFileSync(entry, 'export const handlers = { run() { return "user version"; } };');
      const entryBefore = readFileSync(entry, 'utf8');

      const result = await ensureDefaultPlugin(definition(), context());

      expect(result).toMatchObject(record);
      expect(readFileSync(manifestPath, 'utf8')).toBe(before);
      expect(readFileSync(entry, 'utf8')).toBe(entryBefore);
      expect(registry.install).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['missing entry', 'missing package', 'mismatched version'])(
    'repairs an unusable installed record: %s',
    async (fault) => {
      const record = seedInstalled('2.0.0');
      writeInstalled([fault === 'mismatched version' ? { ...record, version: '1.0.0' } : record]);
      if (fault === 'missing entry')
        rmSync(path.join(pluginsDir, 'node_modules', packageName, 'index.mjs'));
      if (fault === 'missing package')
        rmSync(path.join(pluginsDir, 'node_modules', packageName, 'package.json'));
      providePackage();

      await ensureDefaultPlugin(definition(), context());

      expect(installed().plugins).toHaveLength(1);
      expect(installed().plugins[0].version).toBe('1.2.3');
      expect(installedPackage().version).toBe('1.2.3');
      expect(existsSync(path.join(pluginsDir, 'node_modules', packageName, 'index.mjs'))).toBe(
        true,
      );
    },
  );

  it('reports an installed CLI incompatibility without downgrading the package', async () => {
    writeInstalled([seedInstalled('2.0.0', { ...baseManifest, minCliVersion: '99.0.0' })]);
    const before = readFileSync(manifestPath, 'utf8');
    const beforePackage = installedPackage();
    providePackage();

    await expect(ensureDefaultPlugin(definition(), context())).rejects.toMatchObject({
      code: 'PLUGIN_CLI_INCOMPATIBLE',
      exitCode: 4,
    });

    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(installedPackage()).toEqual(beforePackage);
    expect(registry.install).not.toHaveBeenCalled();
  });

  it('does not leave an installed record when its initial download fails', async () => {
    await expect(ensureDefaultPlugin(definition(), context())).rejects.toThrow();

    expect(installed().plugins).toEqual([]);
    expect(existsSync(path.join(pluginsDir, 'node_modules', packageName))).toBe(false);
  });

  it('coalesces concurrent requests for the same default into one install', async () => {
    providePackage();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => ensureDefaultPlugin(definition(), context())),
    );

    expect(results.map((record) => record.version)).toEqual(['1.2.3', '1.2.3', '1.2.3', '1.2.3']);
    expect(installed().plugins).toHaveLength(1);
    expect(registry.install).toHaveBeenCalledTimes(1);
  });

  it('preserves other records when two different defaults are installed concurrently', async () => {
    const otherManifest = { ...baseManifest, command: 'lookup', commandAliases: ['look'] };
    const other = definition({
      name: '@qwencloud/other-default',
      command: otherManifest.command,
      commandAliases: otherManifest.commandAliases,
    });
    const existingManifest = { ...baseManifest, command: 'existing', commandAliases: [] };
    const existing = seedInstalled('3.0.0', existingManifest, '@qwencloud/existing');
    writeInstalled([existing]);
    providePackage();
    providePackage('1.2.3', otherManifest, other.name);
    const shared = context([definition(), other]);

    await Promise.all([
      ensureDefaultPlugin(definition(), shared),
      ensureDefaultPlugin(other, shared),
    ]);

    expect(
      installed()
        .plugins.map((record) => record.name)
        .sort(),
    ).toEqual([packageName, other.name, existing.name].sort());
    expect(installed().plugins.find((record) => record.name === existing.name)).toEqual(existing);
  });
});

describe('manual management of defaults', () => {
  it('keeps a manually upgraded compatible plugin across later CLI default changes', async () => {
    writeInstalled([seedInstalled()]);
    providePackage('3.0.0');

    await installManagedPlugin(`${packageName}@3.0.0`, context());
    const afterUpgrade = readFileSync(manifestPath, 'utf8');
    const nextDefault = definition({ version: '2.0.0' });
    await ensureDefaultPlugin(nextDefault, { ...context([nextDefault]), cliVersion: '2.0.0' });

    expect(installedPackage().version).toBe('3.0.0');
    expect(readFileSync(manifestPath, 'utf8')).toBe(afterUpgrade);
    expect(registry.install.mock.calls.map(([spec]) => spec)).toEqual([`${packageName}@3.0.0`]);
  });

  it('preserves the previous package and manifest when an update download fails', async () => {
    writeInstalled([seedInstalled()]);
    const before = readFileSync(manifestPath, 'utf8');

    await expect(installManagedPlugin(`${packageName}@3.0.0`, context())).rejects.toThrow();

    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(installedPackage().version).toBe('1.2.3');
  });

  it('rolls back an installed update whose manifest fails validation', async () => {
    writeInstalled([seedInstalled()]);
    const before = readFileSync(manifestPath, 'utf8');
    const entry = path.join(pluginsDir, 'node_modules', packageName, 'index.mjs');
    writeFileSync(entry, 'export const handlers = { run() { return "original"; } };');
    const entryBefore = readFileSync(entry, 'utf8');
    providePackage('3.0.0', { ...baseManifest, entry: './missing.mjs' });

    await expect(installManagedPlugin(`${packageName}@3.0.0`, context())).rejects.toThrow();

    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(installedPackage().version).toBe('1.2.3');
    expect(readFileSync(entry, 'utf8')).toBe(entryBefore);
  });

  it('persists explicit uninstall and refuses to silently reinstall the default', async () => {
    writeInstalled([seedInstalled()]);

    await uninstallManagedPlugin(packageName, context());

    expect(installed().plugins).toEqual([]);
    expect(installed().disabledDefaults).toContain(packageName);
    expect(existsSync(path.join(pluginsDir, 'node_modules', packageName))).toBe(false);
    providePackage();
    await expect(ensureDefaultPlugin(definition(), context())).rejects.toThrow();
    expect(registry.install).not.toHaveBeenCalled();
    expect(installed().disabledDefaults).toContain(packageName);
  });

  it('can disable a default before it has ever been downloaded', async () => {
    await uninstallManagedPlugin(packageName, context());

    expect(installed().disabledDefaults).toContain(packageName);
    await expect(ensureDefaultPlugin(definition(), context())).rejects.toThrow();
    expect(registry.install).not.toHaveBeenCalled();
  });

  it('an explicit successful install re-enables only that default', async () => {
    const otherName = '@qwencloud/other-default';
    writeInstalled([], [packageName, otherName]);
    providePackage('3.0.0');

    await installManagedPlugin(`${packageName}@3.0.0`, context());
    const result = await ensureDefaultPlugin(definition(), context());

    expect(result.version).toBe('3.0.0');
    expect(installed().disabledDefaults ?? []).not.toContain(packageName);
    expect(installed().disabledDefaults).toContain(otherName);
    expect(registry.install).toHaveBeenCalledTimes(1);
  });

  it('a failed manual install preserves a previous explicit disable', async () => {
    writeInstalled([], [packageName]);

    await expect(installManagedPlugin(`${packageName}@3.0.0`, context())).rejects.toThrow();

    expect(installed().plugins).toEqual([]);
    expect(installed().disabledDefaults).toContain(packageName);
  });
});

describe('default plugin validation', () => {
  it.each(['apiPolicy', 'auth', 'handlerKey'])(
    'accepts an independently changed valid %s declaration when upgrading a default',
    async (field) => {
      const configuredManifest: PluginManifest = {
        ...baseManifest,
        apiPolicy: [{ product: 'TestPortal', actions: ['ReadEntry'], auth: 'optional' }],
        auth: 'optional',
      };
      const candidate = { ...configuredManifest };
      if (field === 'apiPolicy')
        candidate.apiPolicy = [{ product: 'TestPortal', actions: ['NewEntry'], auth: 'required' }];
      else if (field === 'auth') candidate.auth = 'required';
      else candidate.handlerKey = 'newHandler';
      const configured = definition();
      writeInstalled([seedInstalled('0.5.0', configuredManifest)]);
      providePackage('1.2.3', candidate);

      const result = await ensureDefaultPlugin(configured, context([configured]));

      expect(result.version).toBe('1.2.3');
      expect(installedPackage().qwencloud).toEqual(candidate);
      expect(registry.install).toHaveBeenCalledOnce();
    },
  );

  it('accepts fresh plugin subcommands and options without a bootstrap command snapshot', async () => {
    const configured = definition();
    const manifest = {
      ...baseManifest,
      handlerKey: undefined,
      subcommands: [
        {
          command: 'search [query]',
          handlerKey: 'run',
          options: [{ flag: '--locale <locale>', description: 'Result language' }],
        },
      ],
    };
    providePackage('1.2.3', manifest);

    await ensureDefaultPlugin(configured, context([configured]));

    expect(installed().plugins[0]).toMatchObject({ name: packageName, version: '1.2.3' });
    expect(installedPackage().qwencloud.subcommands).toEqual(manifest.subcommands);
  });

  it('reuses compatible installations with API policy regardless of a default marker', async () => {
    const manifest: PluginManifest = {
      ...baseManifest,
      apiPolicy: [{ product: 'PrivatePortal', actions: ['ReadEntry'], auth: 'required' }],
    };
    writeInstalled([{ ...seedInstalled('3.0.0', manifest), default: true }]);
    providePackage();

    expect(readUsableDefaultPlugin(definition(), context())?.record.version).toBe('3.0.0');
    const result = await ensureDefaultPlugin(definition(), context());

    expect(result.version).toBe('3.0.0');
    expect(installedPackage().version).toBe('3.0.0');
    expect(installedPackage().qwencloud.apiPolicy).toEqual(manifest.apiPolicy);
    expect(registry.install).not.toHaveBeenCalled();
  });

  it('preserves a legacy disabled record without downloading', async () => {
    writeInstalled([{ ...seedInstalled(), enabled: false }]);
    providePackage();
    const before = readFileSync(manifestPath, 'utf8');

    expect(readUsableDefaultPlugin(definition(), context())).toBeNull();
    await expect(ensureDefaultPlugin(definition(), context())).rejects.toMatchObject({
      code: 'PLUGIN_DEFAULT_DISABLED',
      exitCode: 4,
    });

    expect(registry.install).not.toHaveBeenCalled();
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
  });

  it('accepts ordinary plugin API policy independently of preload configuration', async () => {
    const ordinaryName = '@qwencloud/ordinary';
    const configured = definition();
    providePackage(
      '1.2.3',
      {
        ...baseManifest,
        command: 'ordinary',
        commandAliases: [],
        apiPolicy: [{ product: 'PrivatePortal', actions: ['ReadEntry'], auth: 'required' }],
      },
      ordinaryName,
    );

    const result = await installManagedPlugin(`${ordinaryName}@1.2.3`, context([configured]));

    expect(result).toMatchObject({ name: ordinaryName, version: '1.2.3', command: 'ordinary' });
    expect(installed().plugins).toHaveLength(1);
    expect(existsSync(path.join(pluginsDir, 'node_modules', ordinaryName))).toBe(true);
  });

  it('reserves commands of configured defaults before their first installation', async () => {
    const ordinaryName = '@qwencloud/ordinary';
    providePackage('1.2.3', baseManifest, ordinaryName);

    await expect(installManagedPlugin(`${ordinaryName}@1.2.3`, context())).rejects.toThrow(
      'another default plugin',
    );

    expect(installed().plugins).toEqual([]);
  });

  it.each([{ command: 'renamed' }, { commandAliases: [] }])(
    'rejects an upgrade that drops a configured command or alias: %j',
    async (changes) => {
      writeInstalled([seedInstalled()]);
      providePackage('3.0.0', { ...baseManifest, ...changes });

      await expect(installManagedPlugin(`${packageName}@3.0.0`, context())).rejects.toThrow(
        'retain',
      );

      expect(installedPackage().version).toBe('1.2.3');
    },
  );

  it('rejects an entry symlink that escapes the package and restores the previous version', async () => {
    writeInstalled([seedInstalled()]);
    const before = readFileSync(manifestPath, 'utf8');
    const candidate = providePackage('3.0.0');
    const outside = path.join(root, 'outside.mjs');
    writeFileSync(outside, 'export const handlers = {};');
    rmSync(path.join(candidate, 'index.mjs'));
    symlinkSync(outside, path.join(candidate, 'index.mjs'));

    await expect(installManagedPlugin(`${packageName}@3.0.0`, context())).rejects.toThrow(
      'escapes',
    );

    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(installedPackage().version).toBe('1.2.3');
    expect(readFileSync(outside, 'utf8')).toBe('export const handlers = {};');
  });

  it.each(['install', 'uninstall'])(
    'rejects a scoped parent symlink before %s can change another directory',
    async (operation) => {
      const outside = path.join(root, 'outside-scope');
      writePackage(path.join(outside, 'default-test'));
      mkdirSync(path.join(pluginsDir, 'node_modules'), { recursive: true });
      symlinkSync(outside, path.join(pluginsDir, 'node_modules', '@qwencloud'));
      writeInstalled([
        { name: packageName, version: '1.2.3', enabled: true, source: 'npm', command: 'catalog' },
      ]);
      providePackage('3.0.0');
      const before = readFileSync(manifestPath, 'utf8');

      await expect(
        operation === 'install'
          ? installManagedPlugin(`${packageName}@3.0.0`, context())
          : uninstallManagedPlugin(packageName, context()),
      ).rejects.toThrow('escapes');

      expect(readFileSync(manifestPath, 'utf8')).toBe(before);
      expect(
        JSON.parse(readFileSync(path.join(outside, 'default-test', 'package.json'), 'utf8'))
          .version,
      ).toBe('1.2.3');
    },
  );

  it.each([{ command: 'models' }, { commandAliases: ['m'] }])(
    'rejects conflicting commands and aliases: %j',
    async (changes) => {
      const manifest = { ...baseManifest, ...changes };
      const configured = definition({
        command: manifest.command,
        commandAliases: manifest.commandAliases,
      });
      providePackage('1.2.3', manifest);

      await expect(ensureDefaultPlugin(configured, context([configured]))).rejects.toThrow();

      expect(installed().plugins).toEqual([]);
      expect(existsSync(path.join(pluginsDir, 'node_modules', packageName))).toBe(false);
    },
  );

  it('installs and reuses unknown metadata with the same package identity and commands', async () => {
    const source = providePackage();
    const baseline = await ensureDefaultPlugin(definition(), context());
    expect(installed().plugins).toEqual([baseline]);
    const candidateManifest = { ...baseManifest, api: { arbitrary: true } };
    writePluginPackage(
      source,
      { name: packageName, version: '1.2.3', qwencloud: candidateManifest },
      false,
    );

    const candidate = await installManagedPlugin(`${packageName}@1.2.3`, context());

    expect(candidate).toStrictEqual(baseline);
    expect(installed().plugins).toEqual([candidate]);
    expect(installedPackage().qwencloud).toEqual(candidateManifest);
    const beforeReuse = readFileSync(manifestPath, 'utf8');
    const reused = await ensureDefaultPlugin(definition(), context());
    expect(reused).toEqual(candidate);
    expect(readFileSync(manifestPath, 'utf8')).toBe(beforeReuse);
    expect(readUsableDefaultPlugin(definition(), context())?.record).toEqual(candidate);
    expect(registry.install).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(
    [
      { products: ['TestPortal'], actions: ['ReadEntry'] },
      [{ product: 'TestPortal', actions: 'ReadEntry', auth: 'required' }],
      [{ product: 7, actions: ['ReadEntry'], auth: 'required' }],
      [{ product: 'TestPortal', actions: [7], auth: 'required' }],
      [null],
      [{ product: 'TestPortal', actions: ['ReadEntry'], auth: 'none' }],
      [{ product: 'TestPortal', actions: ['ReadEntry'], auth: 'required', response: 'invalid' }],
    ].map((apiPolicy) => ({ apiPolicy })),
  )(
    'rejects malformed API policy and preserves installation state: $apiPolicy',
    async ({ apiPolicy }) => {
      const manifest = { ...baseManifest, apiPolicy } as unknown as PluginManifest;
      const configured = definition();
      providePackage('1.2.3', manifest);

      await expect(ensureDefaultPlugin(configured, context([configured]))).rejects.toThrow(
        'apiPolicy',
      );

      expect(installed().plugins).toEqual([]);
      expect(existsSync(path.join(pluginsDir, 'node_modules', packageName))).toBe(false);

      writeInstalled([seedInstalled()]);
      const before = readFileSync(manifestPath, 'utf8');
      const packagePath = path.join(pluginsDir, 'node_modules', packageName, 'package.json');
      const entryPath = path.join(pluginsDir, 'node_modules', packageName, 'index.mjs');
      const packageBefore = readFileSync(packagePath, 'utf8');
      const entryBefore = readFileSync(entryPath, 'utf8');

      await expect(installManagedPlugin(`${packageName}@1.2.3`, context())).rejects.toThrow(
        'apiPolicy',
      );

      expect(readFileSync(manifestPath, 'utf8')).toBe(before);
      expect(readFileSync(packagePath, 'utf8')).toBe(packageBefore);
      expect(readFileSync(entryPath, 'utf8')).toBe(entryBefore);
      expect(readUsableDefaultPlugin(definition(), context())?.record.version).toBe('1.2.3');
    },
  );

  it('rejects a command already owned by another installed plugin', async () => {
    const existing = seedInstalled('1.0.0', baseManifest, '@qwencloud/owner');
    writeInstalled([existing]);
    providePackage();

    await expect(ensureDefaultPlugin(definition(), context())).rejects.toThrow();

    expect(installed().plugins).toEqual([existing]);
    expect(existsSync(path.join(pluginsDir, 'node_modules', packageName))).toBe(false);
  });

  it('accepts plugin authentication and response policy', async () => {
    const manifest: PluginManifest = {
      ...baseManifest,
      apiPolicy: [
        {
          product: 'TestPortal',
          actions: ['ReadEntry'],
          auth: 'optional',
          response: 'success-code-envelope',
        },
      ],
    };
    const configured = definition();
    providePackage('1.2.3', manifest);

    await ensureDefaultPlugin(configured, context([configured]));

    expect(installed().plugins[0].name).toBe(packageName);
    expect(installedPackage().qwencloud.apiPolicy).toEqual(manifest.apiPolicy);
  });

  it.each(['99.0.0', 'latest'])(
    'rejects a package with incompatible or invalid minCliVersion %s and keeps the installed version',
    async (minCliVersion) => {
      writeInstalled([seedInstalled()]);
      providePackage('3.0.0', { ...baseManifest, minCliVersion });

      await expect(installManagedPlugin(`${packageName}@3.0.0`, context())).rejects.toThrow();

      expect(installedPackage().version).toBe('1.2.3');
      expect(installed().plugins[0].version).toBe('1.2.3');
    },
  );
});

describe('manifest commit rollback', () => {
  it.each(['install', 'uninstall'])(
    'restores package bytes and state after a manifest write failure during %s',
    async (operation) => {
      writeInstalled([seedInstalled()]);
      const before = readFileSync(manifestPath, 'utf8');
      const entry = path.join(pluginsDir, 'node_modules', packageName, 'index.mjs');
      const entryBefore = readFileSync(entry, 'utf8');
      providePackage('3.0.0');
      const rename = fs.renameSync;
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (to === manifestPath) throw new Error('mock manifest write failure');
        return rename(from, to);
      });

      await expect(
        operation === 'install'
          ? installManagedPlugin(`${packageName}@3.0.0`, context())
          : uninstallManagedPlugin(packageName, context()),
      ).rejects.toThrow('mock manifest write failure');

      expect(readFileSync(manifestPath, 'utf8')).toBe(before);
      expect(installedPackage().version).toBe('1.2.3');
      expect(readFileSync(entry, 'utf8')).toBe(entryBefore);
      expect(existsSync(`${manifestPath}.lock`)).toBe(false);
    },
  );
});

describe('local archive default source', () => {
  function archiveDefinition(): DefaultPlugin {
    const tarball = buildTarball([
      {
        name: 'package/package.json',
        data: JSON.stringify({ name: packageName, version: '1.2.3', qwencloud: baseManifest }),
      },
      { name: 'package/index.mjs', data: 'export const handlers = { run() {} };' },
    ]);
    const archive = path.join(root, 'artifacts', 'default.tgz');
    mkdirSync(path.dirname(archive), { recursive: true });
    writeFileSync(archive, tarball);
    return definition({
      source: { type: 'archive', path: 'artifacts/default.tgz' },
      sha256: createHash('sha256').update(tarball).digest('hex'),
    });
  }

  it('resolves relative archives only against the explicit archive root', async () => {
    const configured = archiveDefinition();

    await ensureDefaultPlugin(configured, { ...context([configured]), archiveRoot: root });

    expect(installedPackage().version).toBe('1.2.3');
    expect(installed().plugins).toHaveLength(1);
    expect(registry.install).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a relative archive without an explicit root', async () => {
    const configured = archiveDefinition();

    await expect(ensureDefaultPlugin(configured, context([configured]))).rejects.toThrow();

    expect(installed().plugins).toEqual([]);
    expect(registry.install).not.toHaveBeenCalled();
  });

  it('rejects a digest mismatch without registering the archive', async () => {
    const configured = { ...archiveDefinition(), sha256: '0'.repeat(64) };

    await expect(
      ensureDefaultPlugin(configured, { ...context([configured]), archiveRoot: root }),
    ).rejects.toThrow();

    expect(installed().plugins).toEqual([]);
    expect(existsSync(path.join(pluginsDir, 'node_modules', packageName))).toBe(false);
  });

  it('applies the archive size limit to a symlink target before reading its contents', async () => {
    const archive = path.join(root, 'oversized.tgz');
    writeFileSync(archive, '');
    fs.truncateSync(archive, 64 * 1024 * 1024 + 1);
    const link = path.join(root, 'archive-link.tgz');
    symlinkSync(archive, link);
    const configured = definition({
      source: { type: 'archive', path: link },
      sha256: '0'.repeat(64),
    });
    const read = vi.spyOn(fs, 'readSync');

    await expect(ensureDefaultPlugin(configured, context([configured]))).rejects.toThrow('64 MiB');

    expect(read).not.toHaveBeenCalled();
    expect(installed().plugins).toEqual([]);
  });

  it('rejects a directory as an archive before reading bytes', async () => {
    const configured = definition({
      source: { type: 'archive', path: root },
      sha256: '0'.repeat(64),
    });

    await expect(ensureDefaultPlugin(configured, context([configured]))).rejects.toThrow(
      'regular file',
    );

    expect(installed().plugins).toEqual([]);
  });
});

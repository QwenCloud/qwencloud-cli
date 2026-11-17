import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureDefaultPlugin,
  installManagedPlugin,
  readUsableDefaultPlugin,
} from '../../src/plugins/default-install.js';
import { loadInstalledPlugins, registerPluginCommands } from '../../src/plugins/loader.js';
import type { DefaultPlugin } from '../../src/plugins/defaults.js';
import type { InstalledManifest, PluginManifest } from '../../src/plugins/manifest.js';
import { writePluginPackage } from '../fixtures/plugin-package.js';
import { snapshotDirectory } from '../fixtures/plugin-directory.js';
import { buildTarball } from '../fixtures/tar-builder.js';

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
vi.mock('../../src/config/manager.js', () => ({
  getEffectiveConfig: () => ({ 'output.format': 'json' }),
}));
vi.mock('../../plugins.preload.json', () => ({ default: { plugins: [] } }));

const packageName = '@qwencloud/minimum-version';
const baseManifest: PluginManifest = {
  command: 'minimumversion',
  entry: './index.mjs',
  handlerKey: 'run',
};
type Installation = 'managed install' | 'default preparation';

function manifest(minCliVersion?: string): PluginManifest {
  return { ...baseManifest, ...(minCliVersion === undefined ? {} : { minCliVersion }) };
}

function context(): Parameters<typeof installManagedPlugin>[1] {
  return {
    pluginsDir: state.pluginsDir,
    manifestPath: state.manifestPath,
    cliVersion: '1.10.0',
    definitions: [],
    archiveRoot: state.root,
  };
}

function entry(): string {
  return `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(state.root, 'imported'))}, 'imported');\nexport const handlers = { run() {} };`;
}

function source(id: string, version: string, minCliVersion?: string): string {
  return writePluginPackage(
    path.join(state.root, 'sources', id),
    { name: packageName, version, qwencloud: manifest(minCliVersion) },
    { name: 'index.mjs', content: entry() },
  );
}

function definition(version: string, minCliVersion?: string): DefaultPlugin {
  const bytes = buildTarball([
    {
      name: 'package/package.json',
      data: JSON.stringify({ name: packageName, version, qwencloud: manifest(minCliVersion) }),
    },
    { name: 'package/index.mjs', data: entry() },
  ]);
  const archivePath = path.join(state.root, `candidate-${version}.tgz`);
  fs.writeFileSync(archivePath, bytes);
  return {
    name: packageName,
    version,
    command: baseManifest.command,
    source: { type: 'archive', path: archivePath },
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function install(operation: Installation, minCliVersion?: string) {
  if (operation === 'managed install')
    return installManagedPlugin(source('candidate', '2.0.0', minCliVersion), context());
  const configured = definition('2.0.0', minCliVersion);
  return ensureDefaultPlugin(configured, { ...context(), definitions: [configured] });
}

function installed(): InstalledManifest {
  return JSON.parse(fs.readFileSync(state.manifestPath, 'utf8')) as InstalledManifest;
}

function destination(): string {
  return path.join(state.pluginsDir, 'node_modules', packageName);
}

beforeEach(() => {
  const temporaryRoot = path.resolve(__dirname, '../../.local-test-tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  state.root = fs.mkdtempSync(path.join(temporaryRoot, 'minimum-version-'));
  state.pluginsDir = path.join(state.root, 'plugins');
  state.manifestPath = path.join(state.root, 'plugins.json');
  fs.writeFileSync(state.manifestPath, JSON.stringify({ plugins: [] }));
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Network is forbidden');
    }),
  );
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(state.root, 'imported'))).toBe(false);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

describe.each(['managed install', 'default preparation'] as const)(
  '%s minimum version',
  (operation) => {
    it.each(['', ' \t\n '])(
      'rejects explicit blank metadata %j and preserves the previous installation',
      async (minimum) => {
        await installManagedPlugin(source('old', '1.0.0'), context());
        const before = fs.readFileSync(state.manifestPath, 'utf8');
        const packageBefore = snapshotDirectory(destination());

        await expect(install(operation, minimum)).rejects.toMatchObject({
          code: 'INVALID_ARGUMENT',
          exitCode: 1,
          message: expect.stringMatching(/invalid minCliVersion/i),
        });

        expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
        expect(snapshotDirectory(destination())).toEqual(packageBefore);
        expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
      },
    );

    it.each([undefined, '1', '1.0', '1.0.0'])(
      'accepts absent or valid shorthand metadata %j',
      async (minimum) => {
        const result = await install(operation, minimum);

        expect(result).toMatchObject({ name: packageName, version: '2.0.0', enabled: true });
        expect(installed().plugins).toEqual([result]);
        const metadata = JSON.parse(
          fs.readFileSync(path.join(destination(), 'package.json'), 'utf8'),
        ) as { qwencloud: PluginManifest };
        expect(metadata.qwencloud).toEqual(manifest(minimum));
      },
    );

    it('keeps a valid but incompatible version distinct from malformed metadata', async () => {
      await installManagedPlugin(source('old', '1.0.0'), context());
      const before = fs.readFileSync(state.manifestPath, 'utf8');
      const packageBefore = snapshotDirectory(destination());

      await expect(install(operation, '99')).rejects.toMatchObject({
        code: 'PLUGIN_CLI_INCOMPATIBLE',
        exitCode: 4,
        minCliVersion: '99',
        currentCliVersion: '1.10.0',
      });

      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
      expect(snapshotDirectory(destination())).toEqual(packageBefore);
    });
  },
);

describe('existing default and command registration minimum version', () => {
  it.each(['', ' \t\n '])(
    'repairs invalid installed default metadata %j from a valid configured package',
    async (minimum) => {
      await installManagedPlugin(source('old', '1.0.0'), context());
      const configured = definition('1.0.0');
      const packagePath = path.join(destination(), 'package.json');
      fs.writeFileSync(
        packagePath,
        JSON.stringify({ name: packageName, version: '1.0.0', qwencloud: manifest(minimum) }),
      );
      const result = await ensureDefaultPlugin(configured, {
        ...context(),
        definitions: [configured],
      });

      expect(result).toMatchObject({ name: packageName, version: '1.0.0', enabled: true });
      expect(installed().plugins).toEqual([result]);
      expect(JSON.parse(fs.readFileSync(packagePath, 'utf8')).qwencloud).toEqual(baseManifest);
    },
  );

  it.each(['', ' \t\n '])(
    'excludes installed default metadata %j from read-only inspection without repairing it',
    async (minimum) => {
      await installManagedPlugin(source('old', '1.0.0'), context());
      const configured = definition('1.0.0');
      fs.writeFileSync(
        path.join(destination(), 'package.json'),
        JSON.stringify({ name: packageName, version: '1.0.0', qwencloud: manifest(minimum) }),
      );
      const before = snapshotDirectory(state.root);

      expect(readUsableDefaultPlugin(configured, context())).toBeNull();

      expect(snapshotDirectory(state.root)).toEqual(before);
      expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
    },
  );

  it.each(['', ' \t\n '])(
    'skips a loaded command with invalid minimum metadata %j and names the defect',
    (minimum) => {
      writePluginPackage(
        destination(),
        { name: packageName, version: '1.0.0', qwencloud: manifest(minimum) },
        { name: 'index.mjs', content: entry() },
      );
      fs.writeFileSync(
        state.manifestPath,
        JSON.stringify({
          plugins: [{ name: packageName, version: '1.0.0', source: 'npm', enabled: true }],
        }),
      );
      const program = new Command('qwencloud');

      registerPluginCommands(program, loadInstalledPlugins(state.manifestPath, state.pluginsDir));

      expect(program.commands).toEqual([]);
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/invalid minCliVersion/i),
      );
      expect(process.stderr.write).not.toHaveBeenCalledWith(
        expect.stringMatching(/requires CLI >=/),
      );
    },
  );

  it.each([undefined, '1', '1.0', '1.0.0'])(
    'registers a loaded command with absent or valid shorthand metadata %j',
    (minimum) => {
      writePluginPackage(
        destination(),
        { name: packageName, version: '1.0.0', qwencloud: manifest(minimum) },
        { name: 'index.mjs', content: entry() },
      );
      fs.writeFileSync(
        state.manifestPath,
        JSON.stringify({
          plugins: [{ name: packageName, version: '1.0.0', source: 'npm', enabled: true }],
        }),
      );
      const program = new Command('qwencloud');

      registerPluginCommands(program, loadInstalledPlugins(state.manifestPath, state.pluginsDir));

      expect(program.commands).toHaveLength(1);
      expect(program.commands[0].name()).toBe('minimumversion');
      expect(process.stderr.write).not.toHaveBeenCalled();
    },
  );
});

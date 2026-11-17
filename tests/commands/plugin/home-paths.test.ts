import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { registerPluginInitCommand } from '../../../src/commands/plugin/init.js';
import { registerPluginValidateCommand } from '../../../src/commands/plugin/validate.js';
import { installManagedPlugin } from '../../../src/plugins/default-install.js';
import { readInstalledManifest } from '../../../src/plugins/manifest.js';
import { projectTmpdir } from '../../fixtures/plugin-temporary-root.js';
import { writePluginPackage } from '../../fixtures/plugin-package.js';
import { runCommand } from '../../helpers/run-command.js';

const paths = vi.hoisted(() => ({ root: '', home: '', pluginsDir: '', manifestPath: '' }));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => paths.home,
    default: { ...actual, homedir: () => paths.home },
  };
});
vi.mock('../../../src/config/paths.js', async (original) => ({
  ...(await original<typeof import('../../../src/config/paths.js')>()),
  getConfigDir: () => paths.root,
  getPluginsDir: () => paths.pluginsDir,
  getPluginsManifestPath: () => paths.manifestPath,
}));
vi.mock('../../../src/config/manager.js', () => ({ getEffectiveConfig: () => ({}) }));
vi.mock('../../../src/plugins/defaults.js', () => ({
  getDefaultPlugins: () => [],
  getDefaultPlugin: () => undefined,
}));
vi.mock('../../../src/plugins/npm-registry.js', () => ({
  resolveRegistryForPackage: () => ({ registry: 'https://registry.test.qwencloud.com/' }),
}));

const previousExitCode = process.exitCode;

beforeEach(() => {
  paths.root = mkdtempSync(join(projectTmpdir(), 'plugin-home-'));
  paths.home = join(paths.root, 'home');
  paths.pluginsDir = join(paths.root, 'managed');
  paths.manifestPath = join(paths.root, 'plugins.json');
  mkdirSync(paths.home);
  vi.spyOn(process, 'cwd').mockReturnValue(paths.root);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected fetch')));
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(paths.root, { recursive: true, force: true });
});

function packageAt(directory: string): void {
  writePluginPackage(directory, {
    name: '@qwencloud/home-fixture',
    version: '1.0.0',
    main: './index.mjs',
    qwencloud: { command: 'home-fixture', handlerKey: 'run', auth: 'optional' },
  });
}

describe('literal home paths at plugin entry points', () => {
  it.each(['~', '~/new-plugin'])('initializes %s in the mocked home', async (input) => {
    const target = input === '~' ? paths.home : join(paths.home, 'new-plugin');
    const result = await runCommand(
      (program) => registerPluginInitCommand(program.command('plugin')),
      ['plugin', 'init', input, '--format', 'json'],
    );
    expect(result.exitCode).toBeUndefined();
    expect(JSON.parse(result.stdout).selfCheckOk).toBe(true);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'index.mjs'))).toBe(true);
    expect(existsSync(join(paths.root, '~'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['~', '~/valid-plugin'])('validates %s from the mocked home', async (input) => {
    const target = input === '~' ? paths.home : join(paths.home, 'valid-plugin');
    packageAt(target);
    const result = await runCommand(
      (program) => registerPluginValidateCommand(program.command('plugin')),
      ['plugin', 'validate', input, '--format', 'json'],
    );
    expect(result.exitCode).toBeUndefined();
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.errors).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['~', '~/local-plugin'])('commits a managed local install from %s', async (input) => {
    const target = input === '~' ? paths.home : join(paths.home, 'local-plugin');
    packageAt(target);
    const record = await installManagedPlugin(input, {
      pluginsDir: paths.pluginsDir,
      manifestPath: paths.manifestPath,
      cliVersion: '1.6.0',
      definitions: [],
      reservedNames: new Set(),
    });
    expect(record).toMatchObject({
      name: '@qwencloud/home-fixture',
      version: '1.0.0',
      enabled: true,
      source: 'local',
    });
    expect(readInstalledManifest(paths.manifestPath).plugins).toEqual([record]);
    expect(
      JSON.parse(
        readFileSync(
          join(paths.pluginsDir, 'node_modules', '@qwencloud/home-fixture', 'package.json'),
          'utf8',
        ),
      ).name,
    ).toBe('@qwencloud/home-fixture');
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registerPluginManagementCommands } from '../../src/commands/plugin/index.js';
import { loadInstalledPlugins, registerPluginCommands } from '../../src/plugins/loader.js';
import type { PluginManifest } from '../../src/plugins/manifest.js';
import { runCommand } from '../helpers/run-command.js';

const paths = vi.hoisted(() => ({ root: '', pluginsDir: '', manifestPath: '' }));
vi.mock('../../src/config/paths.js', async (original) => ({
  ...(await original<typeof import('../../src/config/paths.js')>()),
  getConfigDir: () => paths.root,
  getPluginsDir: () => paths.pluginsDir,
  getPluginsManifestPath: () => paths.manifestPath,
}));
vi.mock('../../src/config/manager.js', () => ({ getEffectiveConfig: () => ({}) }));

const originalExitCode = process.exitCode;
const ownName = '@qwencloud/loaded-fixture';
const otherName = '@qwencloud/other-fixture';
let ownDirectory: string;

function packageFixture(
  directory: string,
  name: string,
  command: string,
  aliases: string[] = [],
): void {
  mkdirSync(directory, { recursive: true });
  const manifest: PluginManifest = {
    command,
    commandAliases: aliases,
    entry: './entry.mjs',
    handlerKey: 'run',
    auth: 'optional',
  };
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', qwencloud: manifest }),
  );
  writeFileSync(join(directory, 'entry.mjs'), 'export const handlers = { run() {} };');
}

beforeEach(() => {
  const parent = resolve('.local-test-tmp');
  mkdirSync(parent, { recursive: true });
  paths.root = mkdtempSync(join(parent, 'validate-loaded-'));
  paths.pluginsDir = join(paths.root, 'plugins');
  paths.manifestPath = join(paths.root, 'plugins.json');
  ownDirectory = join(paths.pluginsDir, 'node_modules', ownName);
  packageFixture(ownDirectory, ownName, 'loaded-fixture', ['loaded-alias']);
  packageFixture(join(paths.pluginsDir, 'node_modules', otherName), otherName, 'other-fixture', [
    'other-alias',
  ]);
  writeFileSync(
    paths.manifestPath,
    JSON.stringify({
      plugins: [
        {
          name: ownName,
          version: '1.0.0',
          enabled: true,
          source: 'npm',
          command: 'loaded-fixture',
        },
        {
          name: otherName,
          version: '1.0.0',
          enabled: true,
          source: 'npm',
          command: 'other-fixture',
        },
      ],
    }),
  );
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  rmSync(paths.root, { recursive: true, force: true });
});

async function validate(directory: string) {
  const result = await runCommand(
    (program) => {
      program.command('models').alias('m');
      registerPluginManagementCommands(program);
      const plugins = loadInstalledPlugins(paths.manifestPath, paths.pluginsDir);
      expect(plugins).toHaveLength(2);
      registerPluginCommands(program, plugins);
      expect(program.commands.some((command) => command.name() === 'loaded-fixture')).toBe(true);
      expect(program.commands.some((command) => command.name() === 'other-fixture')).toBe(true);
    },
    ['plugin', 'validate', directory, '--format', 'json'],
  );
  return {
    result,
    report: JSON.parse(result.stdout) as {
      summary: { errors: number };
      checks: Array<{ name: string; status: string; detail?: string }>;
    },
  };
}

describe('validation with already registered plugin commands', () => {
  it('validates the actual loaded package including its own command alias', async () => {
    const { result, report } = await validate(ownDirectory);
    expect(report.summary.errors).toBe(0);
    expect(result.exitCode).toBeUndefined();
    expect(process.exitCode).toBe(0);
  });

  it.each([
    ['models', []],
    ['m', []],
    ['fresh-command', ['m']],
    ['other-fixture', []],
    ['other-alias', []],
    ['fresh-command', ['other-alias']],
  ] as Array<[string, string[]]>)(
    'rejects a same-name candidate conflicting through %s and %j',
    async (command, aliases) => {
      const candidate = join(paths.root, 'candidate');
      packageFixture(candidate, ownName, command, aliases);
      const { report } = await validate(candidate);
      expect(report.summary.errors).toBeGreaterThan(0);
      expect(report.checks).toContainEqual(
        expect.objectContaining({ name: 'command-collision', status: 'fail' }),
      );
      expect(process.exitCode).toBe(1);
    },
  );
});

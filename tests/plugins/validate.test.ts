import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { projectTmpdir as tmpdir } from '../fixtures/plugin-temporary-root.js';
import { writePluginPackage } from '../fixtures/plugin-package.js';
import path from 'node:path';
import { runPluginValidateChecks } from '../../src/plugins/validate.js';
import type { InstalledPlugin } from '../../src/plugins/manifest.js';

function status(checks: ReturnType<typeof runPluginValidateChecks>, name: string): string {
  return checks.find((c) => c.name === name)?.status ?? 'missing';
}

describe('runPluginValidateChecks — static validation', () => {
  let dir: string;
  const reserved = new Set(['models', 'm']);
  const installed: InstalledPlugin[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'qw-validate-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePlugin(pkg: Record<string, unknown>, opts: { entry?: boolean } = {}): void {
    writePluginPackage(dir, pkg, opts.entry === false ? false : undefined);
  }

  it('passes every check for a valid plugin', () => {
    writePlugin({
      name: 'good-plugin',
      version: '1.0.0',
      main: './index.mjs',
      qwencloud: { command: 'good', handlerKey: 'run' },
    });
    const checks = runPluginValidateChecks(dir, reserved, installed);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails and returns early when package.json is absent', () => {
    const checks = runPluginValidateChecks(dir, reserved, installed);
    expect(status(checks, 'package.json')).toBe('fail');
    expect(checks).toHaveLength(1);
  });

  it('fails on invalid JSON', () => {
    writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'package.json')).toBe('fail');
  });

  it('fails and stops validation when the qwencloud field is absent', () => {
    writePlugin({ name: 'x', main: './index.mjs' });
    const checks = runPluginValidateChecks(dir, reserved, installed);
    expect(status(checks, 'qwencloud-manifest')).toBe('fail');
    expect(status(checks, 'manifest-structure')).toBe('missing');
  });

  it('fails schema validation when a leaf handlerKey is missing', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'x', subcommands: [{ command: 'sub' }] },
    });
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'manifest-structure')).toBe(
      'fail',
    );
  });

  it('fails when the entry file does not exist', () => {
    writePlugin(
      { name: 'x', main: './missing.mjs', qwencloud: { command: 'x', handlerKey: 'run' } },
      { entry: false },
    );
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'entry-file')).toBe('fail');
  });

  it('fails when the entry path escapes the package (../)', () => {
    writePlugin({ name: 'x', main: '../evil.mjs', qwencloud: { command: 'x', handlerKey: 'run' } });
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'entry-file')).toBe('fail');
  });

  it('fails on an invalid minCliVersion', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'x', handlerKey: 'run', minCliVersion: 'not-a-version' },
    });
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'minCliVersion')).toBe('fail');
  });

  it('warns on an invalid auth value', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'x', handlerKey: 'run', auth: 'maybe' },
    });
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'auth')).toBe('warn');
  });

  it.each([null, false, 7, 'opaque', { arbitrary: true }, [null]].map((api) => ({ api })))(
    'keeps complete diagnostics identical with unknown api metadata %j',
    ({ api }) => {
      const pkg = {
        name: 'x',
        version: '1.0.0',
        main: './index.mjs',
        qwencloud: { command: 'x', handlerKey: 'run' },
      };
      writePlugin(pkg);
      const baseline = runPluginValidateChecks(dir, reserved, installed);
      expect(baseline.length).toBeGreaterThan(0);
      expect(baseline.every((check) => check.status === 'pass')).toBe(true);
      expect(status(baseline, 'api-shape')).toBe('missing');

      writePlugin({ ...pkg, qwencloud: { ...pkg.qwencloud, api } });
      const checks = runPluginValidateChecks(dir, reserved, installed);

      expect(checks).toEqual(baseline);
      expect(status(checks, 'api-shape')).toBe('missing');
    },
  );

  it('still rejects malformed apiPolicy with otherwise valid unknown metadata', () => {
    writePlugin({
      name: 'x',
      version: '1.0.0',
      main: './index.mjs',
      qwencloud: {
        command: 'x',
        handlerKey: 'run',
        api: { arbitrary: true },
        apiPolicy: [{ product: 'TestPortal', actions: ['ReadEntry'], auth: 'none' }],
      },
    });
    const checks = runPluginValidateChecks(dir, reserved, installed);
    expect(status(checks, 'manifest-structure')).toBe('fail');
    expect(checks.find((check) => check.name === 'manifest-structure')?.detail).toContain(
      'apiPolicy',
    );
    expect(status(checks, 'api-shape')).toBe('missing');
  });

  it('fails when a command name collides with a built-in', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'models', handlerKey: 'run' },
    });
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'command-collision')).toBe(
      'fail',
    );
  });

  it('fails when an alias collides with a built-in', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'brandnew', commandAliases: ['m'], handlerKey: 'run' },
    });
    expect(status(runPluginValidateChecks(dir, reserved, installed), 'command-collision')).toBe(
      'fail',
    );
  });

  it('fails when a command collides with another installed plugin', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'taken', handlerKey: 'run' },
    });
    const other: InstalledPlugin[] = [
      { name: 'owner', version: '1.0.0', enabled: true, source: 'npm', command: 'taken' },
    ];
    expect(status(runPluginValidateChecks(dir, reserved, other), 'command-collision')).toBe('fail');
  });

  it('does not report a collision when reinstalling the same installed plugin', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'mycmd', handlerKey: 'run' },
    });
    const selfInstalled: InstalledPlugin[] = [
      { name: 'x', version: '1.0.0', enabled: true, source: 'local', command: 'mycmd' },
    ];
    expect(status(runPluginValidateChecks(dir, reserved, selfInstalled), 'command-collision')).toBe(
      'pass',
    );
  });

  it('lets validation and reinstallation retain the existing plugin name when a built-in later claims it', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: { command: 'late-builtin', handlerKey: 'run' },
    });
    const selfInstalled: InstalledPlugin[] = [
      {
        name: 'x',
        version: '1.0.0',
        enabled: true,
        source: 'local',
        command: 'late-builtin',
      },
    ];
    const checks = runPluginValidateChecks(dir, new Set(['late-builtin']), selfInstalled);
    expect(status(checks, 'command-collision')).toBe('pass');
  });

  it('exempts only existing names during reinstallation and rejects new aliases colliding with built-ins', () => {
    writePlugin({
      name: 'x',
      main: './index.mjs',
      qwencloud: {
        command: 'mycmd',
        commandAliases: ['models'],
        handlerKey: 'run',
      },
    });
    const selfInstalled: InstalledPlugin[] = [
      { name: 'x', version: '1.0.0', enabled: true, source: 'local', command: 'mycmd' },
    ];
    const checks = runPluginValidateChecks(dir, reserved, selfInstalled);
    expect(status(checks, 'command-collision')).toBe('fail');
  });
});

describe('temporary plugin validation profiles', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'qw-validation-profile-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports errors for a missing handler, missing entry and invalid version, and warns about invalid auth', () => {
    writePluginPackage(
      directory,
      {
        name: '@qwencloud/invalid-fixture',
        version: '1.0.0',
        main: './missing.mjs',
        qwencloud: { command: 'fixture', minCliVersion: 'invalid', auth: 'maybe' },
      },
      false,
    );
    const checks = runPluginValidateChecks(directory, new Set(), []);
    const errors = checks.filter((c) => c.status === 'fail');
    const warns = checks.filter((c) => c.status === 'warn');
    expect(errors.map((c) => c.name).sort()).toEqual([
      'entry-file',
      'manifest-structure',
      'minCliVersion',
    ]);
    expect(warns.map((c) => c.name).sort()).toEqual(['auth']);
  });
  it('passes all checks for a valid plugin', () => {
    writePluginPackage(directory, {
      name: '@qwencloud/valid-fixture',
      version: '1.0.0',
      main: './index.mjs',
      qwencloud: {
        command: 'fixture',
        minCliVersion: '1.4.1',
        subcommands: [{ command: 'models', handlerKey: 'models' }],
        apiPolicy: [{ product: 'TestPortal', actions: ['ReadEntry'], auth: 'required' }],
      },
    });
    const checks = runPluginValidateChecks(directory, new Set(), []);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });
});

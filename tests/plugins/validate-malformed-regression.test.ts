import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { runPluginValidateChecks } from '../../src/plugins/validate.js';
import { registerPluginValidateCommand } from '../../src/commands/plugin/validate.js';
import { projectTmpdir } from '../fixtures/plugin-temporary-root.js';
import { snapshotDirectory } from '../fixtures/plugin-directory.js';
import { runCommand } from '../helpers/run-command.js';

const paths = vi.hoisted(() => ({ root: '', manifest: '' }));
vi.mock('../../src/config/paths.js', async (original) => ({
  ...(await original<typeof import('../../src/config/paths.js')>()),
  getConfigDir: () => paths.root,
  getPluginsDir: () => join(paths.root, 'plugins'),
  getPluginsManifestPath: () => paths.manifest,
}));
vi.mock('../../src/config/manager.js', () => ({ getEffectiveConfig: () => ({}) }));
vi.mock('../../src/plugins/defaults.js', () => ({
  getDefaultPlugins: () => [],
  getDefaultPlugin: () => undefined,
}));

type Checks = ReturnType<typeof runPluginValidateChecks>;
const marker = '__qwencloudStaticValidationImported';
const previousExitCode = process.exitCode;
let directory: string;

beforeEach(() => {
  paths.root = fs.mkdtempSync(join(projectTmpdir(), 'malformed-validation-'));
  paths.manifest = join(paths.root, 'plugins.json');
  directory = join(paths.root, 'candidate');
  fs.mkdirSync(directory);
  fs.writeFileSync(
    join(directory, 'index.mjs'),
    `globalThis.${marker} = true; throw new Error('Static validation imported a handler');`,
  );
  vi.stubGlobal(marker, false);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected fetch')));
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(paths.root, { recursive: true, force: true });
});

function writePackage(value: unknown): void {
  fs.writeFileSync(join(directory, 'package.json'), JSON.stringify(value));
}

function packageWith(metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    name: '@qwencloud/static-fixture',
    version: '1.0.0',
    main: './index.mjs',
    ...extra,
    qwencloud: { command: 'static-fixture', handlerKey: 'run', minCliVersion: '1.0', ...metadata },
  };
}

function status(checks: Checks, name: string): string {
  return checks.find((check) => check.name === name)?.status ?? 'missing';
}

function assertReadOnly() {
  const before = snapshotDirectory(paths.root);
  const writes = [
    vi.spyOn(fs, 'writeFileSync'),
    vi.spyOn(fs, 'appendFileSync'),
    vi.spyOn(fs, 'mkdirSync'),
    vi.spyOn(fs, 'renameSync'),
    vi.spyOn(fs, 'copyFileSync'),
    vi.spyOn(fs, 'cpSync'),
    vi.spyOn(fs, 'unlinkSync'),
    vi.spyOn(fs, 'rmSync'),
  ];
  return () => {
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(snapshotDirectory(paths.root)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, marker)).toBe(false);
  };
}

function validate(): Checks {
  const verify = assertReadOnly();
  const checks = runPluginValidateChecks(directory, new Set(['models']), []);
  expect(checks.length).toBeGreaterThan(0);
  verify();
  return checks;
}

describe('static validation of malformed package metadata', () => {
  it.each([
    { value: null },
    { value: [] },
    { value: 42 },
    { value: 'not-an-object' },
    { value: true },
  ])('rejects package root $value', ({ value }) => {
    writePackage(value);
    expect(validate()).toContainEqual(expect.objectContaining({ status: 'fail' }));
  });

  it.each([
    { value: null },
    { value: [] },
    { value: 42 },
    { value: 'not-an-object' },
    { value: false },
  ])('rejects manifest root $value', ({ value }) => {
    writePackage({ name: '@qwencloud/static-fixture', main: './index.mjs', qwencloud: value });
    expect(status(validate(), 'qwencloud-manifest')).toBe('fail');
  });

  it.each([
    { subcommands: false },
    { subcommands: {} },
    { subcommands: 'nested' },
    { subcommands: [null] },
    { subcommands: [42] },
    { subcommands: [{ command: 'nested', subcommands: {} }] },
    { subcommands: [{ command: 'nested', subcommands: [null] }] },
  ])('reports malformed command structure %j and continues safe checks', (metadata) => {
    writePackage(packageWith(metadata));
    const checks = validate();
    expect(status(checks, 'manifest-structure')).toBe('fail');
    expect(status(checks, 'auth')).toBe('fail');
    expect(status(checks, 'entry-file')).toBe('pass');
    expect(status(checks, 'minCliVersion')).toBe('pass');
  });

  it.each([{ entry: 42 }, { entry: {} }, { entry: [] }, { entry: '' }, { entry: ['index.mjs'] }])(
    'reports invalid entry $entry',
    ({ entry }) => {
      writePackage(packageWith({ entry, minCliVersion: '1.0' }));
      const checks = validate();
      expect(status(checks, 'entry-file')).toBe('fail');
      expect(status(checks, 'minCliVersion')).toBe('pass');
    },
  );

  it('diagnoses a malformed main fallback', () => {
    writePackage(packageWith({}, { main: { path: './index.mjs' } }));
    const checks = validate();
    expect(status(checks, 'entry-file')).toBe('fail');
    expect(status(checks, 'minCliVersion')).toBe('pass');
  });

  it.each([
    { commandAliases: null },
    { commandAliases: 42 },
    { commandAliases: {} },
    { commandAliases: ['alias', null] },
    { commandAliases: [42] },
  ])('reports invalid aliases $commandAliases', ({ commandAliases }) => {
    writePackage(packageWith({ commandAliases }));
    const checks = validate();
    expect(status(checks, 'manifest-structure')).toBe('fail');
    expect(status(checks, 'entry-file')).toBe('pass');
    expect(status(checks, 'minCliVersion')).toBe('pass');
  });

  it.each([{ command: null }, { command: 42 }, { command: {} }])(
    'reports invalid command name $command',
    (metadata) => {
      writePackage(packageWith(metadata));
      const checks = validate();
      expect(status(checks, 'manifest-structure')).toBe('fail');
      expect(status(checks, 'entry-file')).toBe('pass');
      expect(status(checks, 'minCliVersion')).toBe('pass');
    },
  );

  it.each([
    { auth: null },
    { auth: 42 },
    { auth: {} },
    { auth: [] },
    { auth: false },
    { auth: 'maybe' },
  ])('warns safely for invalid auth $auth', ({ auth }) => {
    writePackage(packageWith({ auth }));
    const checks = validate();
    expect(status(checks, 'auth')).toBe('warn');
    expect(status(checks, 'entry-file')).toBe('pass');
    expect(status(checks, 'minCliVersion')).toBe('pass');
  });

  it.each([
    { minCliVersion: null },
    { minCliVersion: 42 },
    { minCliVersion: {} },
    { minCliVersion: [] },
    { minCliVersion: '' },
    { minCliVersion: ' \t' },
    { minCliVersion: 'invalid' },
    { minCliVersion: '01.0.0' },
  ])('reports invalid minimum $minCliVersion separately from other checks', ({ minCliVersion }) => {
    writePackage(packageWith({ minCliVersion }));
    const checks = validate();
    expect(status(checks, 'minCliVersion')).toBe('fail');
    expect(status(checks, 'entry-file')).toBe('pass');
  });

  it.each(['engines', 'peerDependencies'])(
    'diagnoses malformed %s compatibility values',
    (field) => {
      writePackage(
        packageWith({ minCliVersion: undefined }, { [field]: { '@qwencloud/qwencloud-cli': 42 } }),
      );
      const checks = validate();
      expect(status(checks, 'minCliVersion')).toBe('fail');
      expect(status(checks, 'entry-file')).toBe('pass');
    },
  );

  it.each([
    {},
    { minCliVersion: undefined },
    { minCliVersion: '1' },
    { minCliVersion: '1.0' },
    { entry: null },
    { entry: './index.mjs', commandAliases: ['static-alias'], auth: 'optional' },
  ])('retains valid metadata and main fallback %j', (metadata) => {
    writePackage(packageWith(metadata));
    const checks = validate();
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it.each(['engines', 'peerDependencies'])('retains valid %s compatibility fallback', (field) => {
    writePackage(
      packageWith(
        { minCliVersion: undefined },
        { [field]: { '@qwencloud/qwencloud-cli': '^1.0' } },
      ),
    );
    expect(status(validate(), 'minCliVersion')).toBe('pass');
  });

  it.each([{}, { subcommands: [null], minCliVersion: 42 }])(
    'reads the package snapshot once for %j',
    (metadata) => {
      writePackage(packageWith(metadata));
      const read = vi.spyOn(fs, 'readFileSync');
      const checks = runPluginValidateChecks(directory, new Set(), []);
      expect(checks.length).toBeGreaterThan(0);
      expect(
        read.mock.calls.filter(([file]) => file === join(directory, 'package.json')),
      ).toHaveLength(1);
      expect(Reflect.get(globalThis, marker)).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['json', 'text', 'table'])('returns a malformed report in %s format', async (format) => {
    writePackage(
      packageWith({ subcommands: [null], entry: 42, minCliVersion: '', auth: { required: true } }),
    );
    const verify = assertReadOnly();
    const stdout: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const result = await runCommand(
      (program) => registerPluginValidateCommand(program.command('plugin')),
      ['plugin', 'validate', directory, '--format', format],
    );
    write.mockRestore();
    expect(result.exitCode).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(result.stderr).not.toMatch(/TypeError|\n\s+at /);
    if (format === 'json') {
      const report = JSON.parse(result.stdout) as { checks: Checks; summary: { errors: number } };
      expect(report.summary.errors).toBe(4);
      expect(status(report.checks, 'manifest-structure')).toBe('fail');
      expect(status(report.checks, 'entry-file')).toBe('fail');
      expect(status(report.checks, 'minCliVersion')).toBe('fail');
      expect(status(report.checks, 'auth')).toBe('fail');
    } else {
      expect(stdout.join('')).toBe(
        [
          `Validating plugin at ${directory}`,
          '',
          '  ✔  present and valid JSON',
          '  ✔  "@qwencloud/static-fixture" is a valid npm name',
          '  ✔  package.version "1.0.0" is valid',
          '  ✔  qwencloud field present',
          '  ✖  manifest "entry" must be a string',
          '  ✖  entry must be a non-empty string',
          '  ✖  minCliVersion must be a valid version string',
          '  ✖  auth cannot be fully checked: malformed subcommands',
          '  ⚠  invalid auth value(s): {"required":true} (expected required|optional)',
          '  ✔  command and aliases are free',
          '',
          '5 passed, 4 error(s), 1 warning(s).',
          '',
          'Note: validate is static — a pass does not guarantee handlers load/execute.',
          '',
        ].join('\n'),
      );
    }
    verify();
  });
});

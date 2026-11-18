import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findConfiguredOpenApiPolicy,
  getConfiguredOpenApiRules,
  type OpenApiPolicyRule,
} from '../../src/config/openapi-policy.js';
import {
  installManagedPlugin,
  readCommittedInstalledPlugin,
  readUsableDefaultPlugin,
} from '../../src/plugins/default-install.js';
import { installLocalPlugin, type InstallTransaction } from '../../src/plugins/installer.js';
import { loadInstalledPlugins } from '../../src/plugins/loader.js';
import type { InstalledManifest, PluginManifest } from '../../src/plugins/manifest.js';
import { writePluginPackage } from '../fixtures/plugin-package.js';
import { snapshotDirectory as directoryState } from '../fixtures/plugin-directory.js';
import { projectTmpdir } from '../fixtures/plugin-temporary-root.js';

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

type InstalledPlugin = InstalledManifest['plugins'][number];
type ManagedSource = 'npm' | 'local' | 'archive';
type MissingField = 'command' | 'commandAliases';
type MetadataLink = 'external' | 'dangling' | 'sibling' | 'intermediate';

const ownerName = '@qwencloud/owner-fixture';
const healthyName = '@qwencloud/healthy-owner-fixture';
const healthyCommand = 'healthy-owner';
const healthyPolicy: OpenApiPolicyRule = {
  product: 'OwnerMetadataPortal',
  actions: ['ReadHealthy'],
  auth: 'required',
};
const candidatePolicy: OpenApiPolicyRule = {
  product: 'OwnerMetadataPortal',
  actions: ['ReadCandidate'],
  auth: 'optional',
};

function context(): Parameters<typeof installManagedPlugin>[1] {
  return {
    pluginsDir: state.pluginsDir,
    manifestPath: state.manifestPath,
    cliVersion: '1.6.0-alpha.1',
    definitions: [],
  };
}

function destination(name = ownerName): string {
  return path.join(state.pluginsDir, 'node_modules', name);
}

function manifest(command: string, changes: Partial<PluginManifest> = {}): PluginManifest {
  return { command, entry: './index.mjs', handlerKey: 'run', auth: 'optional', ...changes };
}

function packageAt(directory: string, name: string, metadata: PluginManifest): string {
  return writePluginPackage(
    directory,
    { name, version: '1.0.0', type: 'module', qwencloud: metadata },
    {
      name: 'index.mjs',
      content: `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(path.join(state.root, 'handler-imported'))}, 'unexpected');
export const handlers = { run() {} };`,
    },
  );
}

function record(
  name: string,
  source: InstalledPlugin['source'] = 'local',
  changes: Partial<InstalledPlugin> = {},
): InstalledPlugin {
  return { name, version: '1.0.0', enabled: true, source, ...changes };
}

function writeInstalledPlugins(filename: string, plugins: InstalledPlugin[]): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify({ plugins }));
}

function installed(): InstalledManifest {
  return JSON.parse(fs.readFileSync(state.manifestPath, 'utf8')) as InstalledManifest;
}

function collision(command: string): { code: string; message: string } {
  return {
    code: 'INVALID_ARGUMENT',
    message: `command/alias "${command}" is already provided by another plugin`,
  };
}

function expectUnavailableOwner(command: string): void {
  const current = installed();
  const owner = current.plugins.find((plugin) => plugin.name === ownerName);
  if (!owner) throw new Error('Missing owner fixture');
  expect(readCommittedInstalledPlugin(owner, context(), current)).toBeNull();
  expect(
    readUsableDefaultPlugin(
      { name: ownerName, version: '1.0.0', command, source: { type: 'npm' } },
      context(),
    ),
  ).toBeNull();
  expect(getConfiguredOpenApiRules()).toEqual([healthyPolicy]);
}

function installCandidate(command: string): Promise<InstalledPlugin> {
  const name = '@qwencloud/new-owner-fixture';
  const source = packageAt(path.join(state.root, 'candidate'), name, manifest(command));
  return installManagedPlugin(source, context());
}

function seedHealthy(owner: InstalledPlugin): void {
  packageAt(
    destination(healthyName),
    healthyName,
    manifest(healthyCommand, { apiPolicy: [healthyPolicy] }),
  );
  writeInstalledPlugins(state.manifestPath, [
    owner,
    record(healthyName, 'local', { command: healthyCommand }),
  ]);
}

function linkedMetadata(kind: MetadataLink, metadata: PluginManifest): string[] {
  const directory = destination();
  packageAt(directory, ownerName, manifest('discarded'));
  const metadataPath = path.join(directory, 'package.json');
  fs.unlinkSync(metadataPath);
  const externalDirectory =
    kind === 'sibling' ? `${directory}-sibling` : path.join(state.root, 'external-metadata');
  const externalMetadata = path.join(externalDirectory, 'package.json');
  if (kind !== 'dangling') packageAt(externalDirectory, ownerName, metadata);
  if (kind === 'intermediate') {
    fs.symlinkSync(externalDirectory, path.join(directory, 'metadata'), 'dir');
    fs.symlinkSync('./metadata/package.json', metadataPath, 'file');
  } else fs.symlinkSync(externalMetadata, metadataPath, 'file');
  return [metadataPath, externalMetadata, path.join(directory, 'metadata', 'package.json')];
}

function expectHealthyPolicy(): void {
  expect.soft(getConfiguredOpenApiRules()).toContainEqual(healthyPolicy);
  expect
    .soft(findConfiguredOpenApiPolicy(healthyPolicy.product, healthyPolicy.actions[0]))
    .toEqual(healthyPolicy);
}

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(projectTmpdir(), 'owner-metadata-contract-'));
  state.pluginsDir = path.join(state.root, 'plugins');
  state.manifestPath = path.join(state.root, 'plugins.json');
  writeInstalledPlugins(state.manifestPath, []);
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Owner metadata inspection must not access the network');
    }),
  );
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(state.root, 'handler-imported'))).toBe(false);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

async function expectUntrustedMetadataIgnored(
  source: ManagedSource,
  missing: MissingField,
  kind: MetadataLink,
): Promise<void> {
  const claimedCommand = missing === 'command' ? 'untrusted-command' : 'untrusted-alias';
  const deniedPaths = linkedMetadata(
    kind,
    manifest('untrusted-command', { commandAliases: ['untrusted-alias', healthyCommand] }),
  );
  const owner = record(ownerName, source, {
    ...(missing === 'command' ? { commandAliases: ['saved-alias'] } : { command: 'saved-command' }),
  });
  seedHealthy(owner);
  const read = vi.spyOn(fs, 'readFileSync');
  const open = vi.spyOn(fs, 'openSync');

  expectHealthyPolicy();
  const result = await installCandidate(claimedCommand).then(
    (plugin) => ({ plugin }),
    (error: unknown) => ({ error }),
  );

  expect.soft(result).toMatchObject({ plugin: { command: claimedCommand } });
  expect(installed().plugins.find((plugin) => plugin.name === ownerName)).toEqual(owner);
  for (const file of deniedPaths) {
    expect.soft(read.mock.calls.map(([candidate]) => String(candidate))).not.toContain(file);
    expect.soft(open.mock.calls.map(([candidate]) => String(candidate))).not.toContain(file);
  }
}

describe.each(['npm', 'local', 'archive'] as const)('managed %s owner metadata', (source) => {
  it.each([
    { missing: 'command' as const, kind: 'external' as const },
    { missing: 'commandAliases' as const, kind: 'external' as const },
    { missing: 'command' as const, kind: 'dangling' as const },
    { missing: 'commandAliases' as const, kind: 'dangling' as const },
  ])(
    'does not read or reserve $kind metadata while filling missing $missing',
    async ({ missing, kind }) => {
      await expectUntrustedMetadataIgnored(source, missing, kind);
    },
  );

  it.each(['command', 'commandAliases'] as const)(
    'retains the recorded %s reservation when the remaining metadata is untrusted',
    async (preserved) => {
      linkedMetadata('external', manifest('untrusted-command', { commandAliases: ['untrusted'] }));
      const owner = record(ownerName, source, {
        ...(preserved === 'command'
          ? { command: 'committed-reservation' }
          : { commandAliases: ['committed-reservation'] }),
      });
      seedHealthy(owner);
      const before = fs.readFileSync(state.manifestPath, 'utf8');

      await expect(installCandidate('committed-reservation')).rejects.toMatchObject(
        collision('committed-reservation'),
      );

      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
      expectHealthyPolicy();
    },
  );
});

describe('legacy owner metadata compatibility', () => {
  it.each(['sibling', 'intermediate'] as const)(
    'rejects missing aliases obtained through a %s metadata link',
    async (kind) => {
      await expectUntrustedMetadataIgnored('npm', 'commandAliases', kind);
    },
  );

  it.each(['npm', 'local', 'archive'] as const)(
    'fills valid legacy %s commands and aliases without recursive owner validation',
    async (source) => {
      packageAt(
        destination(),
        ownerName,
        manifest('legacy-owner', { commandAliases: ['legacy-alias'] }),
      );
      seedHealthy(record(ownerName, source));
      const healthy = installed().plugins.find((plugin) => plugin.name === healthyName);
      if (!healthy) throw new Error('Missing healthy record');
      delete healthy.command;
      writeInstalledPlugins(state.manifestPath, [record(ownerName, source), healthy]);
      const before = fs.readFileSync(state.manifestPath, 'utf8');

      expectHealthyPolicy();
      await expect(installCandidate('legacy-alias')).rejects.toMatchObject(
        collision('legacy-alias'),
      );
      await expect(installCandidate('legacy-owner')).rejects.toMatchObject(
        collision('legacy-owner'),
      );

      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
      expectHealthyPolicy();
    },
  );

  it('fills aliases through a package.json link contained in the actual package directory', async () => {
    packageAt(
      destination(),
      ownerName,
      manifest('legacy-owner', { commandAliases: ['legacy-alias'] }),
    );
    fs.mkdirSync(path.join(destination(), 'metadata'));
    fs.renameSync(
      path.join(destination(), 'package.json'),
      path.join(destination(), 'metadata', 'package.json'),
    );
    fs.symlinkSync('./metadata/package.json', path.join(destination(), 'package.json'), 'file');
    seedHealthy(record(ownerName, 'npm', { command: 'legacy-owner' }));

    expectHealthyPolicy();
    await expect(installCandidate('legacy-alias')).rejects.toMatchObject(collision('legacy-alias'));
  });

  it.each(['link', 'bundle'] as const)(
    'loads an external %s development package and preserves its recorded reservations',
    async (source) => {
      const directory = packageAt(
        path.join(state.root, 'development-package'),
        ownerName,
        manifest('development-owner', { commandAliases: ['development-alias'] }),
      );
      seedHealthy(
        record(ownerName, source, {
          path: directory,
          command: 'development-owner',
          commandAliases: ['development-alias'],
        }),
      );

      expect(
        loadInstalledPlugins(state.manifestPath, state.pluginsDir).map((plugin) => plugin.name),
      ).toContain(ownerName);
      await expect(installCandidate('development-alias')).rejects.toMatchObject(
        collision('development-alias'),
      );
      await expect(installCandidate('development-owner')).rejects.toMatchObject(
        collision('development-owner'),
      );
    },
  );
});

async function seedCommittedPair(source: ManagedSource = 'local'): Promise<string> {
  await installManagedPlugin(
    packageAt(path.join(state.root, 'old-owner'), ownerName, manifest('committed-owner')),
    context(),
  );
  await installManagedPlugin(
    packageAt(
      path.join(state.root, 'old-healthy'),
      healthyName,
      manifest(healthyCommand, { apiPolicy: [healthyPolicy] }),
    ),
    context(),
  );
  const committed = installed();
  const owner = committed.plugins.find((plugin) => plugin.name === ownerName);
  if (!owner) throw new Error('Missing owner record');
  expect(owner).not.toHaveProperty('commandAliases');
  owner.source = source;
  writeInstalledPlugins(state.manifestPath, committed.plugins);
  expectHealthyPolicy();
  return fs.readFileSync(state.manifestPath, 'utf8');
}

function replacement(): string {
  return packageAt(
    path.join(state.root, 'replacement'),
    ownerName,
    manifest('committed-owner', {
      commandAliases: [healthyCommand],
      apiPolicy: [candidatePolicy],
    }),
  );
}

function beginReplacement(candidate: string): InstallTransaction {
  const result = installLocalPlugin(candidate, state.pluginsDir, { recoverable: true });
  if (!result.ok) throw new Error(result.error);
  return result.tx;
}

describe('uncommitted owner metadata cannot suppress committed API policy', () => {
  it.each(['npm', 'local', 'archive'] as const)(
    'keeps healthy policy visible during and after a same-version pending %s alias change',
    async (source) => {
      const before = await seedCommittedPair(source);
      const transaction = beginReplacement(replacement());
      const pendingFiles = directoryState(state.pluginsDir);
      try {
        expectHealthyPolicy();
        expect(getConfiguredOpenApiRules()).not.toContainEqual(candidatePolicy);
        expect(directoryState(state.pluginsDir)).toEqual(pendingFiles);
        expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
        expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
      } finally {
        transaction.rollback();
      }

      expectHealthyPolicy();
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
    },
  );

  it.each(['command', 'commandAliases'] as const)(
    'retains a committed %s reservation while a replacement is pending',
    async (preserved) => {
      await seedCommittedPair();
      const committed = installed();
      const owner = committed.plugins.find((plugin) => plugin.name === ownerName);
      if (!owner) throw new Error('Missing owner record');
      if (preserved === 'command') owner.command = healthyCommand;
      else {
        delete owner.command;
        owner.commandAliases = [healthyCommand];
      }
      writeInstalledPlugins(state.manifestPath, committed.plugins);
      const transaction = beginReplacement(replacement());
      const before = directoryState(state.root);
      try {
        expect(getConfiguredOpenApiRules()).not.toContainEqual(healthyPolicy);
        expect(directoryState(state.root)).toEqual(before);
      } finally {
        transaction.rollback();
      }
    },
  );

  it.each([
    { reader: 'rules', rollback: false },
    { reader: 'rules', rollback: true },
    { reader: 'lookup', rollback: false },
    { reader: 'lookup', rollback: true },
  ] as const)(
    'rejects candidate ownership when replacement starts during $reader reading (rollback=$rollback)',
    async ({ reader, rollback }) => {
      await seedCommittedPair();
      writeInstalledPlugins(state.manifestPath, [...installed().plugins].reverse());
      const before = fs.readFileSync(state.manifestPath, 'utf8');
      const candidate = replacement();
      const packagePath = path.join(destination(), 'package.json');
      const read = fs.readFileSync;
      const open = fs.openSync;
      const close = fs.closeSync;
      let interleaved = false;
      let fixtureWriter = false;
      let transaction: InstallTransaction | undefined;
      let expectedFiles: ReturnType<typeof directoryState> | undefined;
      const readerMutations: string[] = [];
      const metadataDescriptors = new Set<number>();
      const metadataReads: { via: 'path' | 'descriptor'; bytes: string }[] = [];
      let replacementsStarted = 0;
      const begin = () => {
        interleaved = true;
        replacementsStarted += 1;
        fixtureWriter = true;
        transaction = beginReplacement(candidate);
      };
      const finish = () => {
        if (rollback) {
          transaction?.rollback();
          transaction = undefined;
        }
        expectedFiles = directoryState(state.pluginsDir);
        fixtureWriter = false;
      };
      for (const method of [
        'writeFileSync',
        'mkdirSync',
        'renameSync',
        'rmSync',
        'unlinkSync',
      ] as const) {
        const original = fs[method];
        vi.spyOn(fs, method).mockImplementation((...args: unknown[]) => {
          if (!fixtureWriter) readerMutations.push(method);
          return Reflect.apply(original, fs, args);
        });
      }
      vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
        const writeFlags =
          fs.constants.O_WRONLY |
          fs.constants.O_RDWR |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          fs.constants.O_APPEND;
        const writes = typeof flags === 'string' ? /[wa+]/.test(flags) : (flags & writeFlags) !== 0;
        if (!fixtureWriter && writes) readerMutations.push('openSync for writing');
        if (!interleaved && String(file) === packagePath) {
          begin();
          const descriptor = open(file, flags, mode);
          metadataDescriptors.add(descriptor);
          finish();
          return descriptor;
        }
        return open(file, flags, mode);
      });
      vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: unknown[]) => {
        if (!interleaved && String(args[0]) === packagePath) {
          begin();
          const bytes: unknown = Reflect.apply(read, fs, args);
          metadataReads.push({ via: 'path', bytes: String(bytes) });
          finish();
          return bytes;
        }
        const bytes: unknown = Reflect.apply(read, fs, args);
        if (!fixtureWriter && typeof args[0] === 'number' && metadataDescriptors.has(args[0])) {
          metadataReads.push({ via: 'descriptor', bytes: String(bytes) });
        }
        return bytes;
      }) as typeof fs.readFileSync);
      vi.spyOn(fs, 'closeSync').mockImplementation((descriptor) => {
        try {
          return close(descriptor);
        } finally {
          metadataDescriptors.delete(descriptor);
        }
      });

      try {
        const result =
          reader === 'rules'
            ? getConfiguredOpenApiRules()
            : findConfiguredOpenApiPolicy(healthyPolicy.product, healthyPolicy.actions[0]);

        expect(interleaved).toBe(true);
        expect(replacementsStarted).toBe(1);
        expect.soft(metadataReads[0]?.via).toBe('descriptor');
        expect(JSON.parse(metadataReads[0].bytes).qwencloud).toEqual({
          ...manifest('committed-owner'),
          commandAliases: [healthyCommand],
          apiPolicy: [candidatePolicy],
        });
        if (reader === 'rules') {
          expect.soft(result).toContainEqual(healthyPolicy);
          expect.soft(result).not.toContainEqual(candidatePolicy);
        } else expect.soft(result).toEqual(healthyPolicy);
        expect(directoryState(state.pluginsDir)).toEqual(expectedFiles);
        expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
        expect(readerMutations).toEqual([]);
        expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
      } finally {
        vi.restoreAllMocks();
        transaction?.rollback();
      }

      expectHealthyPolicy();
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
    },
  );
});

const managedDevelopmentCases = [
  { source: 'link', pathKind: 'omitted', preserved: 'command' },
  { source: 'link', pathKind: 'explicit', preserved: 'commandAliases' },
  { source: 'bundle', pathKind: 'omitted', preserved: 'commandAliases' },
  { source: 'bundle', pathKind: 'explicit', preserved: 'command' },
] as const;

describe('managed-root development owner metadata', () => {
  it.each(managedDevelopmentCases)(
    'fills committed $source commands and aliases with $pathKind managed path',
    async ({ source, pathKind }) => {
      packageAt(
        destination(),
        ownerName,
        manifest('managed-legacy-owner', {
          commandAliases: ['managed-legacy-alias'],
          apiPolicy: [candidatePolicy],
        }),
      );
      seedHealthy(
        record(ownerName, source, {
          ...(pathKind === 'explicit' ? { path: destination() } : {}),
        }),
      );
      const before = fs.readFileSync(state.manifestPath, 'utf8');

      expect(
        loadInstalledPlugins(state.manifestPath, state.pluginsDir).map((plugin) => plugin.name),
      ).toContain(ownerName);
      expectHealthyPolicy();
      expectUnavailableOwner('managed-legacy-owner');
      for (const command of ['managed-legacy-owner', 'managed-legacy-alias']) {
        const result = await installCandidate(command).then(
          (plugin) => ({ plugin }),
          (error: unknown) => ({ error }),
        );
        expect.soft(result).toMatchObject({
          error: collision(command),
        });
      }

      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
      expectHealthyPolicy();
    },
  );

  it.each(managedDevelopmentCases)(
    'rejects escaped $source supplements with $pathKind managed path while retaining $preserved',
    async ({ source, pathKind, preserved }) => {
      const deniedPaths = linkedMetadata(
        'external',
        manifest('untrusted-command', { commandAliases: ['untrusted-alias'] }),
      );
      const owner = record(ownerName, source, {
        ...(pathKind === 'explicit' ? { path: destination() } : {}),
        ...(preserved === 'command'
          ? { command: 'saved-reservation' }
          : { commandAliases: ['saved-reservation'] }),
      });
      seedHealthy(owner);
      const read = vi.spyOn(fs, 'readFileSync');
      const open = vi.spyOn(fs, 'openSync');
      const untrusted = preserved === 'command' ? 'untrusted-alias' : 'untrusted-command';

      await expect(installCandidate(untrusted)).resolves.toMatchObject({ command: untrusted });
      const beforeConflict = fs.readFileSync(state.manifestPath, 'utf8');
      await expect(installCandidate('saved-reservation')).rejects.toMatchObject(
        collision('saved-reservation'),
      );

      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(beforeConflict);
      expect(installed().plugins.find((plugin) => plugin.name === ownerName)).toEqual(owner);
      for (const file of deniedPaths) {
        expect.soft(read.mock.calls.map(([candidate]) => String(candidate))).not.toContain(file);
        expect.soft(open.mock.calls.map(([candidate]) => String(candidate))).not.toContain(file);
      }
    },
  );

  it.each(managedDevelopmentCases)(
    'ignores pending $source supplements with $pathKind managed path while retaining $preserved',
    ({ source, pathKind, preserved }) => {
      packageAt(destination(), ownerName, manifest('committed-owner'));
      const owner = record(ownerName, source, {
        ...(pathKind === 'explicit' ? { path: destination() } : {}),
        ...(preserved === 'command'
          ? { command: 'committed-owner' }
          : { commandAliases: ['committed-owner'] }),
      });
      seedHealthy(owner);
      const conflictingName = '@qwencloud/reservation-conflict-fixture';
      const conflictingPolicy: OpenApiPolicyRule = {
        product: healthyPolicy.product,
        actions: ['ReadReservationConflict'],
        auth: 'optional',
      };
      packageAt(
        destination(conflictingName),
        conflictingName,
        manifest('committed-owner', { apiPolicy: [conflictingPolicy] }),
      );
      writeInstalledPlugins(state.manifestPath, [
        ...installed().plugins,
        record(conflictingName, 'local', { command: 'committed-owner' }),
      ]);
      expectHealthyPolicy();
      const before = fs.readFileSync(state.manifestPath, 'utf8');
      const transaction = beginReplacement(replacement());
      const pendingFiles = directoryState(state.pluginsDir);

      try {
        expectHealthyPolicy();
        const rules = getConfiguredOpenApiRules();
        expect.soft(rules).not.toContainEqual(candidatePolicy);
        expect.soft(rules).not.toContainEqual(conflictingPolicy);
        expect(directoryState(state.pluginsDir)).toEqual(pendingFiles);
        expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
        expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
      } finally {
        transaction.rollback();
      }

      expectHealthyPolicy();
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
    },
  );
});

function healthySnapshot(): ReturnType<typeof readCommittedInstalledPlugin> {
  return {
    record: record(healthyName, 'local', { command: healthyCommand }),
    pkgDir: destination(healthyName),
    manifest: manifest(healthyCommand, { apiPolicy: [healthyPolicy] }),
  };
}

function observeHealthyOwnerRead(afterRead?: () => void): {
  result: ReturnType<typeof readCommittedInstalledPlugin> | undefined;
  error: unknown;
  metadataReads: { via: 'path' | 'descriptor'; bytes: string }[];
  injections: number;
} {
  const current = installed();
  const healthy = current.plugins.find((plugin) => plugin.name === healthyName);
  if (!healthy) throw new Error('Missing healthy fixture');
  const metadataPath = path.join(destination(), 'package.json');
  const read = fs.readFileSync;
  const open = fs.openSync;
  const close = fs.closeSync;
  const descriptors = new Set<number>();
  const metadataReads: { via: 'path' | 'descriptor'; bytes: string }[] = [];
  const mutations: string[] = [];
  let fixtureWriter = false;
  let injections = 0;
  const spies = [];
  for (const method of [
    'writeFileSync',
    'writeSync',
    'mkdirSync',
    'renameSync',
    'rmSync',
    'unlinkSync',
    'symlinkSync',
    'utimesSync',
  ] as const) {
    const original = fs[method];
    spies.push(
      vi.spyOn(fs, method).mockImplementation((...args: unknown[]) => {
        if (!fixtureWriter) mutations.push(method);
        return Reflect.apply(original, fs, args);
      }),
    );
  }
  spies.push(
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
      const descriptor = open(file, flags, mode);
      if (!fixtureWriter && String(file) === metadataPath) descriptors.add(descriptor);
      const writeFlags =
        fs.constants.O_WRONLY |
        fs.constants.O_RDWR |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC |
        fs.constants.O_APPEND;
      if (
        !fixtureWriter &&
        (typeof flags === 'string' ? /[wa+]/.test(flags) : (flags & writeFlags) !== 0)
      ) {
        mutations.push('openSync for writing');
      }
      return descriptor;
    }),
  );
  spies.push(
    vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: unknown[]) => {
      const observed =
        !fixtureWriter &&
        (String(args[0]) === metadataPath ||
          (typeof args[0] === 'number' && descriptors.has(args[0])));
      const bytes: unknown = Reflect.apply(read, fs, args);
      if (observed) {
        metadataReads.push({
          via: typeof args[0] === 'number' ? 'descriptor' : 'path',
          bytes: String(bytes),
        });
        if (afterRead && injections === 0) {
          injections += 1;
          fixtureWriter = true;
          try {
            afterRead();
          } finally {
            fixtureWriter = false;
          }
        }
      }
      return bytes;
    }) as typeof fs.readFileSync),
  );
  spies.push(
    vi.spyOn(fs, 'closeSync').mockImplementation((descriptor) => {
      try {
        return close(descriptor);
      } finally {
        descriptors.delete(descriptor);
      }
    }),
  );
  try {
    let result: ReturnType<typeof readCommittedInstalledPlugin> | undefined;
    let error: unknown;
    try {
      result = readCommittedInstalledPlugin(healthy, context(), current);
    } catch (failure) {
      error = failure;
    }
    expect(mutations).toEqual([]);
    expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
    return { result, error, metadataReads, injections };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

describe('owner snapshots and availability eligibility', () => {
  it.each(['disabled record', 'disabled default'] as const)(
    'reserves stable legacy names despite a %s without exposing its API policy',
    async (disabled) => {
      packageAt(
        destination(),
        ownerName,
        manifest('ineligible-owner', {
          commandAliases: ['ineligible-alias'],
          apiPolicy: [candidatePolicy],
        }),
      );
      seedHealthy(record(ownerName, 'local', { enabled: disabled !== 'disabled record' }));
      if (disabled === 'disabled default') {
        fs.writeFileSync(
          state.manifestPath,
          JSON.stringify({ ...installed(), disabledDefaults: [ownerName] }),
        );
      }
      const before = fs.readFileSync(state.manifestPath, 'utf8');

      expectUnavailableOwner('ineligible-owner');
      await expect(installCandidate('ineligible-owner')).rejects.toMatchObject(
        collision('ineligible-owner'),
      );
      await expect(installCandidate('ineligible-alias')).rejects.toMatchObject(
        collision('ineligible-alias'),
      );

      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(before);
      expectUnavailableOwner('ineligible-owner');
    },
  );

  it.each(['link', 'bundle'] as const)(
    'does not inspect an external %s package to supplement a missing alias',
    async (source) => {
      const directory = packageAt(
        path.join(state.root, 'external-development'),
        ownerName,
        manifest('external-owner', { commandAliases: ['external-unrecorded-alias'] }),
      );
      seedHealthy(record(ownerName, source, { path: directory, command: 'external-owner' }));
      const read = vi.spyOn(fs, 'readFileSync');
      const open = vi.spyOn(fs, 'openSync');

      await expect(installCandidate('external-unrecorded-alias')).resolves.toMatchObject({
        command: 'external-unrecorded-alias',
      });
      await expect(installCandidate('external-owner')).rejects.toMatchObject(
        collision('external-owner'),
      );

      const metadataPath = path.join(directory, 'package.json');
      expect(read.mock.calls.map(([file]) => String(file))).not.toContain(metadataPath);
      expect(open.mock.calls.map(([file]) => String(file))).not.toContain(metadataPath);
    },
  );

  it.each(['name', 'version', 'manifest'] as const)(
    'ignores an invalid supplementary %s without discarding recorded names',
    async (invalid) => {
      packageAt(
        destination(),
        ownerName,
        manifest('saved-owner', { commandAliases: [healthyCommand, 'invalid-supplement'] }),
      );
      const metadataPath = path.join(destination(), 'package.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (invalid === 'name') metadata.name = '@qwencloud/different-owner';
      if (invalid === 'version') metadata.version = '2.0.0';
      if (invalid === 'manifest') metadata.qwencloud.commandAliases = [healthyCommand, 7];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata));
      seedHealthy(record(ownerName, 'local', { command: 'saved-owner' }));

      expect(observeHealthyOwnerRead().result).toEqual(healthySnapshot());
      await expect(installCandidate('invalid-supplement')).resolves.toMatchObject({
        command: 'invalid-supplement',
      });
      await expect(installCandidate('saved-owner')).rejects.toMatchObject(collision('saved-owner'));
      expectHealthyPolicy();
    },
  );
});

describe('owner snapshot rechecks', () => {
  it.each([
    'record identity',
    'disabled defaults',
    'metadata inode',
    'metadata timestamp',
  ] as const)('rejects an alias supplement after its %s changes during the read', (changed) => {
    const ownerMetadata = manifest('saved-owner', { commandAliases: [healthyCommand] });
    packageAt(destination(), ownerName, ownerMetadata);
    seedHealthy(record(ownerName, 'local', { command: 'saved-owner' }));
    expect(observeHealthyOwnerRead().error).toMatchObject(collision(healthyCommand));
    let expectedFiles: ReturnType<typeof directoryState> | undefined;

    const observation = observeHealthyOwnerRead(() => {
      const current = installed();
      if (changed === 'record identity') {
        current.plugins[0].installationId = 'replacement-installation';
        fs.writeFileSync(state.manifestPath, JSON.stringify(current));
      } else if (changed === 'disabled defaults') {
        fs.writeFileSync(
          state.manifestPath,
          JSON.stringify({ ...current, disabledDefaults: [ownerName] }),
        );
      } else {
        const metadataPath = path.join(destination(), 'package.json');
        if (changed === 'metadata inode') {
          const replacementPath = path.join(state.root, 'replacement-package.json');
          fs.writeFileSync(replacementPath, fs.readFileSync(metadataPath));
          fs.renameSync(replacementPath, metadataPath);
        } else {
          const before = fs.statSync(metadataPath);
          fs.utimesSync(metadataPath, before.atime, new Date(before.mtimeMs + 10_000));
        }
      }
      expectedFiles = directoryState(state.root);
    });

    expect(observation.injections).toBe(1);
    expect(observation.metadataReads).toHaveLength(1);
    expect.soft(observation.metadataReads[0].via).toBe('descriptor');
    expect(JSON.parse(observation.metadataReads[0].bytes).qwencloud).toEqual(ownerMetadata);
    expect.soft(observation.error).toBeUndefined();
    expect(observation.result).toEqual(healthySnapshot());
    expect(directoryState(state.root)).toEqual(expectedFiles);
  });
});

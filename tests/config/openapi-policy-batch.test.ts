import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findConfiguredOpenApiPolicy,
  getConfiguredOpenApiRules,
  setOpenApiPolicyReservedNames,
  type OpenApiPolicyRule,
} from '../../src/config/openapi-policy.js';
import { installManagedPlugin } from '../../src/plugins/default-install.js';
import { installLocalPlugin, type InstallTransaction } from '../../src/plugins/installer.js';
import type {
  InstalledManifest,
  InstalledPlugin,
  PluginManifest,
} from '../../src/plugins/manifest.js';
import { snapshotDirectory } from '../fixtures/plugin-directory.js';
import { writePluginPackage } from '../fixtures/plugin-package.js';
import { projectTmpdir } from '../fixtures/plugin-temporary-root.js';

const state = vi.hoisted(() => ({
  root: '',
  pluginsDir: '',
  manifestPath: '',
  observing: false,
  external: false,
  descriptors: new Map<number, string>(),
  opened: 0,
  closed: 0,
  stateReads: 0,
  stateDecodes: 0,
  recordVisits: 0,
  stateBytes: new Set<string>(),
  reads: [] as { file: string; via: 'path' | 'descriptor'; bytes: string }[],
  writes: [] as string[],
  hookFile: '',
  hook: undefined as (() => void) | undefined,
  hookBoundary: 'package-read' as 'package-read' | 'state-read' | 'later-stat',
  requiredMetadata: [] as string[],
  stateReadsAfterMetadata: [] as { via: 'path' | 'descriptor'; bytes: string }[],
  statsAfterMetadata: [] as { file: string; method: string; size: number | bigint }[],
  eventsAfterMetadata: [] as { kind: 'state-read' | 'stat'; file: string }[],
  eventsAtInjection: [] as { kind: 'state-read' | 'stat'; file: string }[],
  stateReadsAtInjection: 0,
  firstMetadataRechecked: false,
  injectionEvent: undefined as { boundary: string; file: string; bytes?: string } | undefined,
  injections: 0,
  openAtInjection: [] as string[],
  failFile: '',
  failures: 0,
}));

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  function metadataCollected(): boolean {
    return state.requiredMetadata.every((file) => state.reads.some((read) => read.file === file));
  }
  function inject(boundary: string, file: string, bytes?: string): void {
    if (!state.hook) return;
    const hook = state.hook;
    state.hook = undefined;
    state.openAtInjection = [...state.descriptors.values()];
    state.eventsAtInjection = [...state.eventsAfterMetadata];
    state.stateReadsAtInjection = state.stateReadsAfterMetadata.length;
    state.external = true;
    try {
      hook();
      state.injections += 1;
      state.injectionEvent = { boundary, file, ...(bytes === undefined ? {} : { bytes }) };
    } finally {
      state.external = false;
    }
  }
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const file = typeof args[0] === 'number' ? state.descriptors.get(args[0]) : String(args[0]);
    const observing = state.observing && !state.external;
    const bytes = actual.readFileSync(...args);
    if (observing && file === state.manifestPath) {
      state.stateReads += 1;
      state.stateBytes.add(String(bytes));
      if (metadataCollected()) {
        state.eventsAfterMetadata.push({ kind: 'state-read', file });
        state.firstMetadataRechecked = false;
        state.stateReadsAfterMetadata.push({
          via: typeof args[0] === 'number' ? 'descriptor' : 'path',
          bytes: String(bytes),
        });
        if (state.hookBoundary === 'state-read') inject('state-read', file, String(bytes));
      }
    }
    if (observing && file?.startsWith(state.pluginsDir) && file.endsWith('package.json')) {
      state.reads.push({
        file,
        via: typeof args[0] === 'number' ? 'descriptor' : 'path',
        bytes: String(bytes),
      });
      if (file === state.failFile) {
        state.failures += 1;
        throw new Error('Injected metadata read failure after real bytes were read');
      }
      if (file === state.hookFile && state.hookBoundary === 'package-read')
        inject('package-read', file, String(bytes));
    }
    return bytes;
  }) as typeof actual.readFileSync;
  const openSync: typeof actual.openSync = (...args) => {
    const descriptor = actual.openSync(...args);
    if (state.observing && !state.external) {
      state.descriptors.set(descriptor, String(args[0]));
      state.opened += 1;
      const writeFlags =
        actual.constants.O_WRONLY |
        actual.constants.O_RDWR |
        actual.constants.O_CREAT |
        actual.constants.O_TRUNC |
        actual.constants.O_APPEND;
      if (typeof args[1] === 'string' ? /[wa+]/.test(args[1]) : (args[1] & writeFlags) !== 0)
        state.writes.push('openSync');
    }
    return descriptor;
  };
  const closeSync: typeof actual.closeSync = (descriptor) => {
    try {
      return actual.closeSync(descriptor);
    } finally {
      if (state.descriptors.delete(descriptor)) state.closed += 1;
    }
  };
  function mutation<T extends (...args: never[]) => unknown>(name: string, operation: T): T {
    return ((...args: Parameters<T>) => {
      if (state.observing && !state.external) state.writes.push(name);
      return Reflect.apply(operation, actual, args);
    }) as T;
  }
  function inspectStat<T extends (...args: never[]) => unknown>(method: string, operation: T): T {
    return ((...args: Parameters<T>) => {
      const result = Reflect.apply(operation, actual, args) as
        | fs.Stats
        | fs.BigIntStats
        | undefined;
      const file = typeof args[0] === 'number' ? state.descriptors.get(args[0]) : String(args[0]);
      if (state.observing && !state.external && result && file && metadataCollected()) {
        state.statsAfterMetadata.push({ file, method, size: result.size });
        state.eventsAfterMetadata.push({ kind: 'stat', file });
        if (state.stateReadsAfterMetadata.length > 0 && file === state.requiredMetadata[0])
          state.firstMetadataRechecked = true;
        if (
          state.hookBoundary === 'later-stat' &&
          state.firstMetadataRechecked &&
          file === state.hookFile
        )
          inject('later-stat', file);
      }
      return result;
    }) as T;
  }
  const wrapped = {
    ...actual,
    readFileSync,
    openSync,
    closeSync,
    statSync: inspectStat('statSync', actual.statSync),
    lstatSync: inspectStat('lstatSync', actual.lstatSync),
    fstatSync: inspectStat('fstatSync', actual.fstatSync),
    writeFileSync: mutation('writeFileSync', actual.writeFileSync),
    writeSync: mutation('writeSync', actual.writeSync),
    mkdirSync: mutation('mkdirSync', actual.mkdirSync),
    renameSync: mutation('renameSync', actual.renameSync),
    rmSync: mutation('rmSync', actual.rmSync),
    unlinkSync: mutation('unlinkSync', actual.unlinkSync),
    symlinkSync: mutation('symlinkSync', actual.symlinkSync),
    utimesSync: mutation('utimesSync', actual.utimesSync),
  };
  return { ...wrapped, default: wrapped };
});
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

type Reader = 'rules' | 'lookup';
type AliasShape = 'omitted' | 'empty';
const firstName = '@qwencloud/batch-first';
const lastName = '@qwencloud/batch-last';
const ownerName = '@qwencloud/batch-owner';
const firstPolicy: OpenApiPolicyRule = {
  product: 'BatchPortal',
  actions: ['ReadFirst', 'ListFirst'],
  auth: 'optional',
  response: 'success-code-envelope',
};
const lastPolicy: OpenApiPolicyRule = {
  product: 'BatchPortal',
  actions: ['ReadLast'],
  auth: 'required',
};

function context(): Parameters<typeof installManagedPlugin>[1] {
  return {
    pluginsDir: state.pluginsDir,
    manifestPath: state.manifestPath,
    cliVersion: '1.6.0-alpha.1',
    definitions: [],
  };
}

function destination(name: string): string {
  return path.join(state.pluginsDir, 'node_modules', name);
}

function metadataPath(name: string): string {
  return path.join(destination(name), 'package.json');
}

function manifest(command: string, apiPolicy: OpenApiPolicyRule[] = []): PluginManifest {
  return { command, entry: './index.mjs', handlerKey: 'run', apiPolicy };
}

function packageAt(directory: string, name: string, metadata: PluginManifest): string {
  return writePluginPackage(
    directory,
    { name, version: '1.0.0', type: 'module', qwencloud: metadata },
    {
      name: 'index.mjs',
      content: `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(path.join(state.root, 'entry-imported'))}, 'unexpected');
export const handlers = { run() {} };`,
    },
  );
}

function installed(): InstalledManifest {
  return JSON.parse(fs.readFileSync(state.manifestPath, 'utf8')) as InstalledManifest;
}

function writeInstalled(value: InstalledManifest): void {
  fs.writeFileSync(state.manifestPath, JSON.stringify(value));
}

function record(
  name: string,
  command: string,
  changes: Partial<InstalledPlugin> = {},
): InstalledPlugin {
  return {
    name,
    command,
    commandAliases: [],
    version: '1.0.0',
    enabled: true,
    source: 'local',
    ...changes,
  };
}

function seedPair(): void {
  packageAt(destination(firstName), firstName, manifest('batch-first', [firstPolicy]));
  packageAt(destination(lastName), lastName, manifest('batch-last', [lastPolicy]));
  writeInstalled({
    plugins: [record(firstName, 'batch-first'), record(lastName, 'batch-last')],
  });
}

function read(reader: Reader, policy = firstPolicy): unknown {
  return reader === 'rules'
    ? getConfiguredOpenApiRules()
    : findConfiguredOpenApiPolicy(policy.product, policy.actions[0]);
}

function observe<T>(
  operation: () => T,
  hook?: () => void,
  hookName = lastName,
  boundary: 'package-read' | 'state-read' | 'later-stat' = 'package-read',
): T {
  state.descriptors.clear();
  state.opened = 0;
  state.closed = 0;
  state.stateReads = 0;
  state.stateDecodes = 0;
  state.recordVisits = 0;
  state.stateBytes.clear();
  state.reads = [];
  state.writes = [];
  state.hookFile = metadataPath(hookName);
  state.hook = hook;
  state.hookBoundary = boundary;
  state.requiredMetadata = [metadataPath(firstName), metadataPath(lastName)];
  state.stateReadsAfterMetadata = [];
  state.statsAfterMetadata = [];
  state.eventsAfterMetadata = [];
  state.eventsAtInjection = [];
  state.stateReadsAtInjection = 0;
  state.firstMetadataRechecked = false;
  state.injectionEvent = undefined;
  state.injections = 0;
  state.openAtInjection = [];
  state.failures = 0;
  const parse = JSON.parse;
  const decode = vi
    .spyOn(JSON, 'parse')
    .mockImplementation((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
      const result: unknown = parse(text, reviver);
      if (state.observing && !state.external && state.stateBytes.has(text)) {
        state.stateDecodes += 1;
        const value = result as InstalledManifest;
        for (const plugin of value.plugins) {
          for (const key of ['name', 'command', 'commandAliases'] as const) {
            const property = Object.getOwnPropertyDescriptor(plugin, key);
            if (!property) continue;
            Object.defineProperty(plugin, key, {
              configurable: property.configurable,
              enumerable: property.enumerable,
              get() {
                state.recordVisits += 1;
                return property.value as unknown;
              },
            });
          }
        }
      }
      return result;
    });
  state.observing = true;
  try {
    return operation();
  } finally {
    state.observing = false;
    state.hook = undefined;
    decode.mockRestore();
    expect.soft(state.injections).toBe(hook ? 1 : 0);
    expect.soft(state.writes).toEqual([]);
    expect.soft(state.descriptors.size).toBe(0);
    expect.soft(state.closed).toBe(state.opened);
    expect.soft(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
    for (const descriptor of state.descriptors.keys()) fs.closeSync(descriptor);
  }
}

function expectReadBytes(name: string, bytes: string): void {
  const reads = state.reads.filter((item) => item.file === metadataPath(name));
  expect.soft(reads).toHaveLength(1);
  expect.soft(reads[0]).toEqual({ file: metadataPath(name), via: 'descriptor', bytes });
}

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(projectTmpdir(), 'openapi-policy-batch-'));
  state.pluginsDir = path.join(state.root, 'plugins');
  state.manifestPath = path.join(state.root, 'plugins.json');
  state.failFile = '';
  state.observing = false;
  state.external = false;
  writeInstalled({ plugins: [] });
  setOpenApiPolicyReservedNames(new Set());
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Policy reads must stay offline');
    }),
  );
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(state.root, 'entry-imported'))).toBe(false);
  } finally {
    state.observing = false;
    setOpenApiPolicyReservedNames(new Set());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

describe.each(['omitted', 'empty'] as const)(
  'configured policy with %s aliases',
  (shape: AliasShape) => {
    it.each([4, 12, 24])(
      'bounds package, state and ownership-field work for %i real installations',
      async (size) => {
        const expected: OpenApiPolicyRule[] = [];
        const names: string[] = [];
        for (let index = 0; index < size; index += 1) {
          const name = `@qwencloud/batch-population-${index}`;
          const policy: OpenApiPolicyRule = {
            product: 'PopulationPortal',
            actions: [`Read${index}`, `List${index}`],
            auth: 'required',
            response: 'success-code-envelope',
          };
          const metadata = manifest(`population-${index}`, [policy]);
          if (shape === 'empty') metadata.commandAliases = [];
          const result = await installManagedPlugin(
            packageAt(path.join(state.root, 'sources', String(index)), name, metadata),
            context(),
          );
          if (shape === 'empty') expect(result.commandAliases).toEqual([]);
          else expect(result).not.toHaveProperty('commandAliases');
          expected.push(policy);
          names.push(name);
        }
        const committed = installed();
        expect(committed.plugins).toHaveLength(size);
        for (const plugin of committed.plugins) {
          if (shape === 'empty') expect(plugin.commandAliases).toEqual([]);
          else expect(plugin).not.toHaveProperty('commandAliases');
        }
        const before = snapshotDirectory(state.root);
        const beforeState = fs.readFileSync(state.manifestPath, 'utf8');
        for (const reader of ['rules', 'lookup'] as const) {
          expect(observe(() => read(reader, expected[size - 1]))).toEqual(
            reader === 'rules' ? expected : expected[size - 1],
          );
          for (const name of names) {
            expectReadBytes(name, fs.readFileSync(metadataPath(name), 'utf8'));
          }
          expect.soft(state.stateReads).toBeGreaterThan(0);
          expect.soft(state.stateReads).toBeLessThanOrEqual(4);
          expect.soft(state.stateDecodes).toBeGreaterThan(0);
          expect.soft(state.stateDecodes).toBeLessThanOrEqual(4);
          expect.soft(state.recordVisits).toBeGreaterThan(0);
          expect.soft(state.recordVisits).toBeLessThanOrEqual(80 * size);
          expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(beforeState);
          expect(snapshotDirectory(state.root)).toEqual(before);
        }
      },
    );
  },
);

describe.each(['rules', 'lookup'] as const)('final %s snapshot decisions', (reader: Reader) => {
  it.each([
    'installation identity',
    'record version',
    'record path',
    'record aliases',
    'record source',
    'record removal',
    'disabled record',
    'disabled default',
    'descriptor mutation',
    'metadata replacement',
    'package replacement',
    'metadata escape',
    'ancestor escape',
  ] as const)('revokes an earlier policy after a later metadata read changes its %s', (change) => {
    seedPair();
    const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
    const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
    const result = observe(
      () => read(reader),
      () => {
        const current = installed();
        const first = current.plugins[0];
        if (change === 'installation identity') first.installationId = 'changed-identity';
        else if (change === 'record version') first.version = '2.0.0';
        else if (change === 'record path') first.path = path.join(state.root, 'alternate');
        else if (change === 'record aliases') first.commandAliases = ['replacement-alias'];
        else if (change === 'record source') first.source = 'bundle';
        else if (change === 'record removal') current.plugins.shift();
        else if (change === 'disabled record') first.enabled = false;
        else if (change === 'disabled default') current.disabledDefaults = [firstName];
        else if (change === 'descriptor mutation') {
          fs.writeFileSync(metadataPath(firstName), firstBytes.replace('ReadFirst', 'ReadOther'));
        } else if (change === 'metadata replacement') {
          const replacement = path.join(state.root, 'replacement.json');
          fs.writeFileSync(replacement, firstBytes);
          fs.renameSync(replacement, metadataPath(firstName));
        } else if (change === 'package replacement') {
          fs.renameSync(destination(firstName), path.join(state.root, 'old-package'));
          packageAt(destination(firstName), firstName, manifest('batch-first', [firstPolicy]));
        } else if (change === 'metadata escape') {
          const external = path.join(state.root, 'outside.json');
          fs.writeFileSync(external, firstBytes);
          fs.unlinkSync(metadataPath(firstName));
          fs.symlinkSync(external, metadataPath(firstName));
        } else if (change === 'ancestor escape') {
          const outside = path.join(state.root, 'outside-package');
          fs.renameSync(destination(firstName), outside);
          fs.symlinkSync(outside, destination(firstName), 'dir');
        }
        if (
          ![
            'descriptor mutation',
            'metadata replacement',
            'package replacement',
            'metadata escape',
            'ancestor escape',
          ].includes(change)
        )
          writeInstalled(current);
      },
    );

    expectReadBytes(firstName, firstBytes);
    expectReadBytes(lastName, lastBytes);
    expect.soft(state.openAtInjection).toContain(metadataPath(firstName));
    expect(result).toEqual(reader === 'rules' ? [lastPolicy] : undefined);
    expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
      lastPolicy,
    );
  });

  it('revokes an earlier policy when a same-version transaction starts during a later read', () => {
    seedPair();
    const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
    const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
    const replacement = packageAt(
      path.join(state.root, 'replacement'),
      firstName,
      manifest('batch-first', [firstPolicy]),
    );
    let transaction: InstallTransaction | undefined;
    try {
      const result = observe(
        () => read(reader),
        () => {
          const started = installLocalPlugin(replacement, state.pluginsDir, { recoverable: true });
          if (!started.ok) throw new Error(started.error);
          transaction = started.tx;
        },
      );

      expectReadBytes(firstName, firstBytes);
      expectReadBytes(lastName, lastBytes);
      expect.soft(state.openAtInjection).toContain(metadataPath(firstName));
      expect(result).toEqual(reader === 'rules' ? [lastPolicy] : undefined);
      expect(transaction).toBeDefined();
      expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
        lastPolicy,
      );
    } finally {
      transaction?.rollback();
    }
    expect(read(reader)).toEqual(reader === 'rules' ? [firstPolicy, lastPolicy] : firstPolicy);
  });
});

describe.each(['rules', 'lookup'] as const)('late %s filesystem decisions', (reader: Reader) => {
  it.each(['identity', 'disabled'] as const)(
    'rejects stale state bytes when a post-collection state read changes the earlier record %s',
    (change) => {
      seedPair();
      const before = installed();
      const stateBytes = fs.readFileSync(state.manifestPath, 'utf8');
      const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
      const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
      const changed: InstalledManifest = {
        plugins: [
          {
            ...before.plugins[0],
            ...(change === 'identity'
              ? { installationId: 'late-record-identity' }
              : { enabled: false }),
          },
          before.plugins[1],
        ],
      };

      const result = observe(
        () => read(reader),
        () => writeInstalled(changed),
        lastName,
        'state-read',
      );

      expectReadBytes(firstName, firstBytes);
      expectReadBytes(lastName, lastBytes);
      expect(state.stateReadsAfterMetadata[0]?.bytes).toBe(stateBytes);
      expect(state.injectionEvent).toEqual({
        boundary: 'state-read',
        file: state.manifestPath,
        bytes: stateBytes,
      });
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(JSON.stringify(changed));
      expect(result).toEqual(reader === 'rules' ? [lastPolicy] : undefined);
      expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
        lastPolicy,
      );
    },
  );

  it('rejects earlier metadata changed after post-collection state bytes have been read', () => {
    seedPair();
    const stateBytes = fs.readFileSync(state.manifestPath, 'utf8');
    const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
    const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
    const changed = JSON.parse(firstBytes) as { version: string };
    changed.version = '2.0.0';
    const changedBytes = JSON.stringify(changed);

    const result = observe(
      () => read(reader),
      () => fs.writeFileSync(metadataPath(firstName), changedBytes),
      lastName,
      'state-read',
    );

    expectReadBytes(firstName, firstBytes);
    expectReadBytes(lastName, lastBytes);
    expect(state.stateReadsAfterMetadata[0]?.bytes).toBe(stateBytes);
    expect(state.injectionEvent).toEqual({
      boundary: 'state-read',
      file: state.manifestPath,
      bytes: stateBytes,
    });
    expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(stateBytes);
    expect(fs.readFileSync(metadataPath(firstName), 'utf8')).toBe(changedBytes);
    expect(result).toEqual(reader === 'rules' ? [lastPolicy] : undefined);
    expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
      lastPolicy,
    );
  });

  it.each(['identity', 'disabled'] as const)(
    'rejects a late record %s change during the later package stat recheck',
    (change) => {
      seedPair();
      const before = installed();
      const stateBytes = fs.readFileSync(state.manifestPath, 'utf8');
      const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
      const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
      const changed: InstalledManifest = {
        plugins: [
          {
            ...before.plugins[0],
            ...(change === 'identity'
              ? { installationId: 'late-stat-identity' }
              : { enabled: false }),
          },
          before.plugins[1],
        ],
      };

      const result = observe(
        () => read(reader),
        () => writeInstalled(changed),
        lastName,
        'later-stat',
      );

      expectReadBytes(firstName, firstBytes);
      expectReadBytes(lastName, lastBytes);
      expect(state.stateReadsAfterMetadata[0]?.bytes).toBe(stateBytes);
      expect(state.stateReadsAtInjection).toBeGreaterThan(0);
      expect(state.injectionEvent).toEqual({
        boundary: 'later-stat',
        file: metadataPath(lastName),
      });
      const stateReadEvent = state.eventsAtInjection.findIndex(
        (event) => event.kind === 'state-read',
      );
      const firstStatEvent = state.eventsAtInjection.findIndex(
        (event, index) =>
          index > stateReadEvent && event.kind === 'stat' && event.file === metadataPath(firstName),
      );
      const laterStatEvent = state.eventsAtInjection.findIndex(
        (event, index) =>
          index > firstStatEvent && event.kind === 'stat' && event.file === metadataPath(lastName),
      );
      expect(stateReadEvent).toBeGreaterThanOrEqual(0);
      expect(firstStatEvent).toBeGreaterThan(stateReadEvent);
      expect(laterStatEvent).toBeGreaterThan(firstStatEvent);
      expect(state.eventsAtInjection.at(-1)).toEqual({
        kind: 'stat',
        file: metadataPath(lastName),
      });
      const firstStat = state.statsAfterMetadata.findIndex(
        (event) => event.file === metadataPath(firstName),
      );
      const laterStat = state.statsAfterMetadata.findIndex(
        (event, index) => index > firstStat && event.file === metadataPath(lastName),
      );
      expect(firstStat).toBeGreaterThanOrEqual(0);
      expect(laterStat).toBeGreaterThan(firstStat);
      expect(Number(state.statsAfterMetadata[laterStat].size)).toBe(Buffer.byteLength(lastBytes));
      expect(fs.readFileSync(state.manifestPath, 'utf8')).toBe(JSON.stringify(changed));
      expect(result).toEqual(reader === 'rules' ? [lastPolicy] : undefined);
      expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
        lastPolicy,
      );
    },
  );
});

describe('policy batch freshness and failures', () => {
  it('observes changed reserved commands without modifying installation records', () => {
    seedPair();
    const before = snapshotDirectory(state.root);
    expect(observe(getConfiguredOpenApiRules)).toEqual([firstPolicy, lastPolicy]);
    setOpenApiPolicyReservedNames(new Set(['batch-first']));
    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    setOpenApiPolicyReservedNames(new Set());
    expect(observe(getConfiguredOpenApiRules)).toEqual([firstPolicy, lastPolicy]);
    expect(snapshotDirectory(state.root)).toEqual(before);
  });

  it('refreshes package bytes, installed records, disabled state and journals on every call', () => {
    seedPair();
    const initial = installed();
    expect(observe(getConfiguredOpenApiRules)).toEqual([firstPolicy, lastPolicy]);
    const changed: OpenApiPolicyRule = {
      product: 'BatchPortal',
      actions: ['ReadChanged'],
      auth: 'required',
    };
    packageAt(destination(firstName), firstName, manifest('batch-first', [changed]));
    expect(observe(getConfiguredOpenApiRules)).toEqual([changed, lastPolicy]);
    expect(
      findConfiguredOpenApiPolicy(firstPolicy.product, firstPolicy.actions[0]),
    ).toBeUndefined();
    expect(findConfiguredOpenApiPolicy(changed.product, changed.actions[0])).toEqual(changed);
    writeInstalled({ ...initial, disabledDefaults: [firstName] });
    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    writeInstalled({ plugins: [{ ...initial.plugins[0], enabled: false }, initial.plugins[1]] });
    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    writeInstalled({ plugins: [initial.plugins[1]] });
    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    writeInstalled(initial);
    expect(observe(getConfiguredOpenApiRules)).toEqual([changed, lastPolicy]);
    const replacement = packageAt(
      path.join(state.root, 'replacement'),
      firstName,
      manifest('batch-first', [firstPolicy]),
    );
    const pending = installLocalPlugin(replacement, state.pluginsDir, { recoverable: true });
    if (!pending.ok) throw new Error(pending.error);
    try {
      expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    } finally {
      pending.tx.rollback();
    }
    expect(observe(getConfiguredOpenApiRules)).toEqual([changed, lastPolicy]);
  });

  it('closes every metadata descriptor and retains a healthy sibling after a real read throws', () => {
    seedPair();
    const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
    const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
    state.failFile = metadataPath(firstName);

    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);

    expect(state.failures).toBe(1);
    expectReadBytes(firstName, firstBytes);
    expectReadBytes(lastName, lastBytes);
    expect(state.opened).toBeGreaterThanOrEqual(2);
    state.failFile = '';
    expect(observe(getConfiguredOpenApiRules)).toEqual([firstPolicy, lastPolicy]);
  });
});

function seedOwner(changes: Partial<InstalledPlugin> = {}, version = '1.0.0'): void {
  seedPair();
  packageAt(destination(ownerName), ownerName, {
    ...manifest('batch-owner', [firstPolicy]),
    commandAliases: ['batch-first'],
  });
  if (version !== '1.0.0') {
    const metadata = JSON.parse(fs.readFileSync(metadataPath(ownerName), 'utf8')) as Record<
      string,
      unknown
    >;
    metadata.version = version;
    fs.writeFileSync(metadataPath(ownerName), JSON.stringify(metadata));
  }
  const owner = record(ownerName, 'batch-owner', { enabled: false, version, ...changes });
  delete owner.commandAliases;
  writeInstalled({ plugins: [owner, ...installed().plugins] });
}

describe('safe ownership views across a policy batch', () => {
  it.each(['pending', 'metadata replacement', 'metadata escape', 'record identity'] as const)(
    'restores a policy suppressed only by a supplementary alias invalidated by %s at the final read',
    (change) => {
      seedOwner();
      const ownerBytes = fs.readFileSync(metadataPath(ownerName), 'utf8');
      const firstBytes = fs.readFileSync(metadataPath(firstName), 'utf8');
      const lastBytes = fs.readFileSync(metadataPath(lastName), 'utf8');
      const replacement = packageAt(
        path.join(state.root, 'replacement'),
        ownerName,
        manifest('batch-owner'),
      );
      expect(getConfiguredOpenApiRules()).toEqual([lastPolicy]);
      let transaction: InstallTransaction | undefined;
      try {
        const result = observe(getConfiguredOpenApiRules, () => {
          if (change === 'pending') {
            const started = installLocalPlugin(replacement, state.pluginsDir, {
              recoverable: true,
            });
            if (!started.ok) throw new Error(started.error);
            transaction = started.tx;
          } else if (change === 'record identity') {
            const current = installed();
            current.plugins[0].installationId = 'new-owner-identity';
            writeInstalled(current);
          } else {
            const external = path.join(state.root, 'owner-replacement.json');
            fs.writeFileSync(external, ownerBytes);
            if (change === 'metadata replacement') fs.renameSync(external, metadataPath(ownerName));
            else {
              fs.unlinkSync(metadataPath(ownerName));
              fs.symlinkSync(external, metadataPath(ownerName));
            }
          }
        });

        expectReadBytes(ownerName, ownerBytes);
        expectReadBytes(firstName, firstBytes);
        expectReadBytes(lastName, lastBytes);
        expect.soft(state.openAtInjection).toContain(metadataPath(ownerName));
        expect.soft(state.openAtInjection).toContain(metadataPath(firstName));
        expect(result).toEqual([firstPolicy, lastPolicy]);
      } finally {
        transaction?.rollback();
      }
    },
  );

  it('removes only unsafe supplementary conflicts while preserving genuine conflicts and healthy siblings', () => {
    seedOwner();
    const genuineName = '@qwencloud/batch-genuine';
    const blockedName = '@qwencloud/batch-blocked';
    const blockedPolicy: OpenApiPolicyRule = {
      product: 'BatchPortal',
      actions: ['ReadBlocked'],
      auth: 'optional',
    };
    packageAt(destination(genuineName), genuineName, {
      ...manifest('batch-genuine'),
      commandAliases: ['batch-blocked'],
    });
    packageAt(destination(blockedName), blockedName, manifest('batch-blocked', [blockedPolicy]));
    const genuine = record(genuineName, 'batch-genuine', { enabled: false });
    delete genuine.commandAliases;
    const current = installed();
    writeInstalled({
      plugins: [
        current.plugins[0],
        genuine,
        current.plugins[1],
        record(blockedName, 'batch-blocked'),
        current.plugins[2],
      ],
    });
    expect(getConfiguredOpenApiRules()).toEqual([lastPolicy]);
    const ownerBytes = fs.readFileSync(metadataPath(ownerName), 'utf8');
    const genuineBytes = fs.readFileSync(metadataPath(genuineName), 'utf8');

    const result = observe(getConfiguredOpenApiRules, () => {
      const external = path.join(state.root, 'outside-owner.json');
      fs.writeFileSync(external, ownerBytes);
      fs.unlinkSync(metadataPath(ownerName));
      fs.symlinkSync(external, metadataPath(ownerName));
    });

    expectReadBytes(ownerName, ownerBytes);
    expectReadBytes(genuineName, genuineBytes);
    expect.soft(state.openAtInjection).toContain(metadataPath(ownerName));
    expect.soft(state.openAtInjection).toContain(metadataPath(genuineName));
    expect.soft(state.openAtInjection).toContain(metadataPath(firstName));
    expect(result).toEqual([firstPolicy, lastPolicy]);
    expect(
      findConfiguredOpenApiPolicy(blockedPolicy.product, blockedPolicy.actions[0]),
    ).toBeUndefined();
  });

  it('reserves matching invalid-version ownership without granting its independent policy', () => {
    seedOwner({ enabled: true }, 'not-semver');
    const ownPolicy: OpenApiPolicyRule = {
      product: 'OwnerPortal',
      actions: ['ReadOwner'],
      auth: 'optional',
    };
    const ownerPackage = JSON.parse(fs.readFileSync(metadataPath(ownerName), 'utf8')) as {
      qwencloud: PluginManifest;
    };
    ownerPackage.qwencloud.apiPolicy = [ownPolicy];
    fs.writeFileSync(metadataPath(ownerName), JSON.stringify(ownerPackage));
    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    expect(
      findConfiguredOpenApiPolicy(firstPolicy.product, firstPolicy.actions[0]),
    ).toBeUndefined();
    const current = installed();
    writeInstalled({ plugins: [current.plugins[0], current.plugins[2]] });

    expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
    expect(findConfiguredOpenApiPolicy(ownPolicy.product, ownPolicy.actions[0])).toBeUndefined();
  });

  it.each(['command', 'alias'] as const)(
    'keeps a recorded %s conflict after supplementary metadata becomes unsafe',
    (kind) => {
      seedOwner();
      const current = installed();
      if (kind === 'command') current.plugins[0].command = 'batch-first';
      else {
        delete current.plugins[0].command;
        current.plugins[0].commandAliases = ['batch-first'];
      }
      writeInstalled(current);
      const ownerBytes = fs.readFileSync(metadataPath(ownerName), 'utf8');
      const result = observe(getConfiguredOpenApiRules, () => {
        const external = path.join(state.root, 'owner-outside.json');
        fs.writeFileSync(external, ownerBytes);
        fs.unlinkSync(metadataPath(ownerName));
        fs.symlinkSync(external, metadataPath(ownerName));
      });

      expect(result).toEqual([lastPolicy]);
      expectReadBytes(ownerName, ownerBytes);
      expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
        lastPolicy,
      );
    },
  );

  it.each([
    { source: 'local', pathKind: 'omitted', version: '1.0.0' },
    { source: 'local', pathKind: 'omitted', version: 'not-semver' },
    { source: 'link', pathKind: 'omitted', version: '1.0.0' },
    { source: 'link', pathKind: 'standard', version: '1.0.0' },
    { source: 'bundle', pathKind: 'omitted', version: '1.0.0' },
    { source: 'bundle', pathKind: 'standard', version: '1.0.0' },
  ] as const)(
    'retains genuine $source ownership at $pathKind path with matching $version version',
    ({ source, pathKind, version }) => {
      seedOwner(
        { source, ...(pathKind === 'standard' ? { path: destination(ownerName) } : {}) },
        version,
      );
      const before = snapshotDirectory(state.root);

      expect(observe(getConfiguredOpenApiRules)).toEqual([lastPolicy]);
      expect(
        findConfiguredOpenApiPolicy(firstPolicy.product, firstPolicy.actions[0]),
      ).toBeUndefined();
      expect(findConfiguredOpenApiPolicy(lastPolicy.product, lastPolicy.actions[0])).toEqual(
        lastPolicy,
      );
      expect(snapshotDirectory(state.root)).toEqual(before);
    },
  );

  it.each(['link', 'bundle'] as const)(
    'never reads an external %s location to supplement ownership',
    (source) => {
      seedOwner({ source });
      const outside = path.join(state.root, 'development-owner');
      fs.renameSync(destination(ownerName), outside);
      const current = installed();
      current.plugins[0].path = outside;
      writeInstalled(current);
      const readSpy = vi.spyOn(fs, 'readFileSync');
      const openSpy = vi.spyOn(fs, 'openSync');
      const before = snapshotDirectory(state.root);
      readSpy.mockClear();
      openSpy.mockClear();

      expect(observe(getConfiguredOpenApiRules)).toEqual([firstPolicy, lastPolicy]);

      expect(readSpy.mock.calls).not.toContainEqual([path.join(outside, 'package.json'), 'utf8']);
      for (const [file] of openSpy.mock.calls)
        expect(String(file)).not.toBe(path.join(outside, 'package.json'));
      for (const [file] of readSpy.mock.calls)
        expect(String(file)).not.toBe(path.join(outside, 'package.json'));
      expect(snapshotDirectory(state.root)).toEqual(before);
    },
  );
});

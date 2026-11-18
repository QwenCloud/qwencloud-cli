import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findConfiguredOpenApiPolicy,
  getConfiguredOpenApiRules,
  setOpenApiPolicyReservedNames,
  type OpenApiPolicyRule,
} from '../../src/config/openapi-policy.js';
import { getPluginsDir, getPluginsManifestPath } from '../../src/config/paths.js';
import { readCommittedInstalledPlugin } from '../../src/plugins/default-install.js';
import type {
  InstalledManifest,
  InstalledPlugin,
  PluginManifest,
} from '../../src/plugins/manifest.js';
import { writePluginPackage } from '../fixtures/plugin-package.js';
import { projectTmpdir } from '../fixtures/plugin-temporary-root.js';

const state = vi.hoisted(() => ({
  root: '',
  pluginsDir: '',
  manifestPath: '',
  observing: false,
  external: false,
  descriptors: new Map<number, string>(),
  opened: [] as { fd: number; file: string }[],
  closed: [] as number[],
  initial: [] as { file: string; fd: number | undefined; bytes: Buffer }[],
  verified: [] as {
    file: string;
    fd: number;
    position: number | null;
    bytes: Buffer;
    afterInjection: boolean;
  }[],
  frozenStats: new Map<string, fs.Stats>(),
  frozenBigStats: new Map<string, fs.BigIntStats>(),
  statEvidence: [] as { file: string; afterInjection: boolean; value: fs.Stats | fs.BigIntStats }[],
  events: [] as { kind: string; file: string }[],
  eventAtInjection: undefined as { kind: string; file: string; bytes: Buffer } | undefined,
  openAtInjection: [] as { fd: number; file: string }[],
  hook: undefined as (() => void) | undefined,
  hookFile: '',
  boundary: 'package' as 'package' | 'state',
  requiredMetadata: [] as string[],
  injections: 0,
  fault: 'none' as 'none' | 'partial' | 'error' | 'eof',
  faultFile: '',
  faultCalls: 0,
  faults: 0,
  writes: [] as string[],
}));

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  function inject(kind: string, file: string, bytes: Buffer): void {
    const hook = state.hook;
    if (!hook) return;
    state.hook = undefined;
    state.eventAtInjection = { kind, file, bytes };
    state.openAtInjection = [...state.descriptors].map(([fd, name]) => ({ fd, file: name }));
    state.external = true;
    try {
      hook();
      state.injections += 1;
      state.events.push({ kind: 'injected', file });
    } finally {
      state.external = false;
    }
  }
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const file = typeof args[0] === 'number' ? state.descriptors.get(args[0]) : String(args[0]);
    const observed = state.observing && !state.external;
    const result = actual.readFileSync(...args);
    if (observed && file) {
      const bytes = Buffer.from(result);
      if (file.startsWith(state.pluginsDir) && file.endsWith('package.json')) {
        state.initial.push({ file, fd: typeof args[0] === 'number' ? args[0] : undefined, bytes });
        state.events.push({ kind: 'metadata', file });
        if (state.boundary === 'package' && file === state.hookFile)
          inject('metadata', file, bytes);
      }
      if (
        file === state.manifestPath &&
        state.requiredMetadata.every((name) => state.initial.some((read) => read.file === name))
      ) {
        state.events.push({ kind: 'state', file });
        if (state.boundary === 'state') inject('state', file, bytes);
      }
    }
    return result;
  }) as typeof actual.readFileSync;
  const openSync: typeof actual.openSync = (...args) => {
    const fd = actual.openSync(...args);
    if (state.observing && !state.external) {
      const file = String(args[0]);
      state.descriptors.set(fd, file);
      state.opened.push({ fd, file });
    }
    return fd;
  };
  const closeSync: typeof actual.closeSync = (fd) => {
    try {
      return actual.closeSync(fd);
    } finally {
      if (state.descriptors.delete(fd)) state.closed.push(fd);
    }
  };
  const readSync = ((...args: unknown[]) => {
    const fd = args[0] as number;
    const file = state.descriptors.get(fd);
    if (!state.observing || state.external || !file)
      return Reflect.apply(actual.readSync, actual, args) as number;
    const view = args[1] as NodeJS.ArrayBufferView;
    const options =
      typeof args[2] === 'object' && args[2] !== null
        ? (args[2] as { offset?: number; length?: number; position?: number | null })
        : undefined;
    const offset = options?.offset ?? (typeof args[2] === 'number' ? args[2] : 0);
    const requested = options?.length ?? (typeof args[3] === 'number' ? args[3] : view.byteLength);
    const position = options?.position ?? (typeof args[4] === 'number' ? args[4] : null);
    let length = requested;
    if (file === state.faultFile && state.fault !== 'none') {
      state.faultCalls += 1;
      if (state.fault === 'error' && state.faultCalls === 2) {
        state.faults += 1;
        throw new Error('Injected descriptor read failure');
      }
      if (state.fault === 'eof' && state.faultCalls === 2) {
        state.faults += 1;
        state.verified.push({
          file,
          fd,
          position,
          bytes: Buffer.alloc(0),
          afterInjection: state.injections > 0,
        });
        return 0;
      }
      length = Math.min(requested, 13);
    }
    const count = actual.readSync(fd, view, offset, length, position);
    const bytes = Buffer.from(view.buffer, view.byteOffset + offset, count);
    state.verified.push({
      file,
      fd,
      position,
      bytes: Buffer.from(bytes),
      afterInjection: state.injections > 0,
    });
    state.events.push({ kind: 'verification', file });
    return count;
  }) as typeof actual.readSync;
  function inspectStat<T extends (...args: never[]) => unknown>(operation: T): T {
    return ((...args: Parameters<T>) => {
      const result = Reflect.apply(operation, actual, args) as
        | fs.Stats
        | fs.BigIntStats
        | undefined;
      const file = typeof args[0] === 'number' ? state.descriptors.get(args[0]) : String(args[0]);
      if (!state.observing || state.external || !file || !result) return result;
      const frozen =
        typeof result.size === 'bigint'
          ? state.frozenBigStats.get(file)
          : state.frozenStats.get(file);
      const value = frozen ?? result;
      if (frozen) state.statEvidence.push({ file, afterInjection: state.injections > 0, value });
      return value;
    }) as T;
  }
  function mutation<T extends (...args: never[]) => unknown>(name: string, operation: T): T {
    return ((...args: Parameters<T>) => {
      if (state.observing && !state.external) state.writes.push(name);
      return Reflect.apply(operation, actual, args);
    }) as T;
  }
  const wrapped = {
    ...actual,
    readFileSync,
    readSync,
    openSync,
    closeSync,
    statSync: inspectStat(actual.statSync),
    lstatSync: inspectStat(actual.lstatSync),
    fstatSync: inspectStat(actual.fstatSync),
    writeFileSync: mutation('writeFileSync', actual.writeFileSync),
    writeSync: mutation('writeSync', actual.writeSync),
    mkdirSync: mutation('mkdirSync', actual.mkdirSync),
    renameSync: mutation('renameSync', actual.renameSync),
    rmSync: mutation('rmSync', actual.rmSync),
    unlinkSync: mutation('unlinkSync', actual.unlinkSync),
  };
  return { ...wrapped, default: wrapped };
});

const firstName = '@qwencloud/content-first';
const healthyName = '@qwencloud/content-healthy';
const ownerName = '@qwencloud/content-owner';
const firstPolicy: OpenApiPolicyRule = {
  product: 'ContentPortal',
  actions: ['ReadFirst'],
  auth: 'optional',
};
const healthyPolicy: OpenApiPolicyRule = {
  product: 'ContentPortal',
  actions: ['ReadHealthy'],
  auth: 'required',
};
const firstManifest: PluginManifest = {
  command: 'content-first',
  entry: './index.mjs',
  handlerKey: 'run',
  apiPolicy: [firstPolicy],
};
const healthyManifest: PluginManifest = {
  command: 'content-healthy',
  entry: './index.mjs',
  handlerKey: 'run',
  apiPolicy: [healthyPolicy],
};
type Reader = 'rules' | 'lookup' | 'single';

function destination(name: string): string {
  return path.join(state.pluginsDir, 'node_modules', name);
}

function metadataPath(name: string): string {
  return path.join(destination(name), 'package.json');
}

function record(
  name: string,
  command: string,
  changes: Partial<InstalledPlugin> = {},
): InstalledPlugin {
  return { name, command, version: '1.0.0', enabled: true, source: 'local', ...changes };
}

function packageAt(name: string, manifest: PluginManifest): void {
  writePluginPackage(
    destination(name),
    { name, version: '1.0.0', type: 'module', qwencloud: manifest },
    {
      name: 'index.mjs',
      content: `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(state.root, 'entry-imported'))}, 'unexpected');\nexport const handlers = { run() {} };`,
    },
  );
}

function writeInstalled(plugins: InstalledPlugin[]): void {
  fs.mkdirSync(path.dirname(state.manifestPath), { recursive: true });
  fs.writeFileSync(state.manifestPath, JSON.stringify({ plugins }));
}

function installed(): InstalledManifest {
  return JSON.parse(fs.readFileSync(state.manifestPath, 'utf8')) as InstalledManifest;
}

function seedPair(): void {
  packageAt(firstName, firstManifest);
  packageAt(healthyName, healthyManifest);
  writeInstalled([
    record(firstName, firstManifest.command),
    record(healthyName, healthyManifest.command),
  ]);
}

function read(reader: Reader): unknown {
  if (reader === 'rules') return getConfiguredOpenApiRules();
  if (reader === 'lookup')
    return findConfiguredOpenApiPolicy(firstPolicy.product, firstPolicy.actions[0]);
  const current = installed();
  return readCommittedInstalledPlugin(
    current.plugins[0],
    {
      pluginsDir: state.pluginsDir,
      manifestPath: state.manifestPath,
      cliVersion: '1.6.0-alpha.1',
      definitions: [],
    },
    current,
  );
}

function accepted(reader: Reader): unknown {
  if (reader === 'rules') return [firstPolicy, healthyPolicy];
  if (reader === 'lookup') return firstPolicy;
  return {
    record: installed().plugins[0],
    pkgDir: destination(firstName),
    manifest: firstManifest,
  };
}

function rejected(reader: Reader): unknown {
  return reader === 'rules' ? [healthyPolicy] : reader === 'lookup' ? undefined : null;
}

function observe(
  reader: Reader,
  options: {
    hook?: () => void;
    boundary?: 'package' | 'state';
    target?: string;
    trigger?: string;
    fault?: typeof state.fault;
  } = {},
): unknown {
  const target = metadataPath(options.target ?? firstName);
  state.frozenStats.set(target, fs.statSync(target));
  state.frozenBigStats.set(target, fs.statSync(target, { bigint: true }));
  state.requiredMetadata =
    reader === 'single'
      ? [metadataPath(firstName)]
      : [metadataPath(firstName), metadataPath(healthyName)];
  state.hook = options.hook;
  state.boundary = options.boundary ?? 'package';
  state.hookFile = metadataPath(options.trigger ?? (reader === 'single' ? firstName : healthyName));
  state.fault = options.fault ?? 'none';
  state.faultFile = target;
  const parse = vi.spyOn(JSON, 'parse');
  state.observing = true;
  try {
    return read(reader);
  } finally {
    state.observing = false;
    state.hook = undefined;
    const parsed = parse.mock.calls.map(([text]) => text);
    parse.mockRestore();
    for (const item of state.initial)
      expect.soft(parsed.filter((text) => text === item.bytes.toString('utf8'))).toHaveLength(1);
    expect.soft(state.injections).toBe(options.hook ? 1 : 0);
    expect.soft(state.writes).toEqual([]);
    expect.soft(state.descriptors.size).toBe(0);
    expect.soft(state.closed).toHaveLength(state.opened.length);
    for (const fd of state.descriptors.keys()) fs.closeSync(fd);
  }
}

function verificationRounds(name: string): Array<typeof state.verified> {
  const rounds: Array<typeof state.verified> = [];
  for (const item of state.verified) {
    if (item.file !== metadataPath(name)) continue;
    if (item.position === 0) rounds.push([]);
    const round = rounds.at(-1);
    expect.soft(round).toBeDefined();
    const previous = round?.at(-1);
    if (previous && previous.position !== null)
      expect.soft(item.position).toBe(previous.position + previous.bytes.length);
    round?.push(item);
  }
  return rounds;
}

function expectEvidence(name: string, original: Buffer, changed?: Buffer): void {
  const file = metadataPath(name);
  const initial = state.initial.filter((item) => item.file === file);
  expect.soft(initial).toHaveLength(1);
  expect.soft(initial[0]?.bytes).toEqual(original);
  expect.soft(initial[0]?.fd).toBeTypeOf('number');
  const reads = state.verified.filter((item) => item.file === file);
  expect.soft(reads.length).toBeGreaterThan(0);
  expect.soft(reads[0]?.position).toBe(0);
  expect.soft(state.opened.filter((item) => item.file === file)).toHaveLength(1);
  for (const item of reads) expect.soft(item.fd).toBe(initial[0]?.fd);
  if (changed) {
    expect.soft(state.openAtInjection).toContainEqual({ file, fd: initial[0]?.fd });
    const changedReads = reads.filter((item) => item.afterInjection);
    for (const item of changedReads) {
      expect.soft(item.position).toBeTypeOf('number');
      if (item.position !== null)
        expect
          .soft(item.bytes)
          .toEqual(changed.subarray(item.position, item.position + item.bytes.length));
    }
    expect
      .soft(
        changedReads.some(
          (item) =>
            item.position !== null &&
            !item.bytes.equals(original.subarray(item.position, item.position + item.bytes.length)),
        ),
      )
      .toBe(true);
    expect
      .soft(state.statEvidence.some((item) => item.file === file && item.afterInjection))
      .toBe(true);
  }
  for (const item of state.statEvidence) {
    if (item.file === file)
      expect
        .soft(item.value)
        .toEqual(
          typeof item.value.size === 'bigint'
            ? state.frozenBigStats.get(file)
            : state.frozenStats.get(file),
        );
  }
}

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(projectTmpdir(), 'committed-content-'));
  vi.stubEnv('QWENCLOUD_CONFIG_DIR', state.root);
  state.pluginsDir = getPluginsDir();
  state.manifestPath = getPluginsManifestPath();
  expect(state.pluginsDir.startsWith(`${state.root}${path.sep}`)).toBe(true);
  expect(state.manifestPath.startsWith(`${state.root}${path.sep}`)).toBe(true);
  state.observing = false;
  state.external = false;
  state.descriptors.clear();
  state.opened = [];
  state.closed = [];
  state.initial = [];
  state.verified = [];
  state.frozenStats.clear();
  state.frozenBigStats.clear();
  state.statEvidence = [];
  state.events = [];
  state.eventAtInjection = undefined;
  state.openAtInjection = [];
  state.injections = 0;
  state.faultCalls = 0;
  state.faults = 0;
  state.writes = [];
  setOpenApiPolicyReservedNames(new Set());
  seedPair();
});

afterEach(() => {
  try {
    expect(fs.existsSync(path.join(state.root, 'entry-imported'))).toBe(false);
    expect(fs.existsSync(`${state.manifestPath}.lock`)).toBe(false);
  } finally {
    state.observing = false;
    setOpenApiPolicyReservedNames(new Set());
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

describe.each(['rules', 'lookup', 'single'] as const)(
  'committed %s content verification',
  (reader: Reader) => {
    it('accepts unchanged content after the original descriptor has reached EOF', () => {
      const original = fs.readFileSync(metadataPath(firstName));
      const expected = accepted(reader);
      expect(observe(reader)).toEqual(expected);
      expectEvidence(firstName, original);
      const rounds = verificationRounds(firstName);
      expect(rounds.length).toBeGreaterThan(0);
      for (const round of rounds)
        expect(Buffer.concat(round.map((item) => item.bytes))).toEqual(original);
    });

    it.each(['package', 'state'] as const)(
      'rejects an equal-length change at the %s boundary with unchanged stat evidence',
      (boundary) => {
        const original = fs.readFileSync(metadataPath(firstName));
        const changed = Buffer.from(original.toString().replace('ReadFirst', 'ReadOther'));
        const stateBytes = fs.readFileSync(state.manifestPath);
        expect(changed.length).toBe(original.length);
        expect(changed).not.toEqual(original);
        const result = observe(reader, {
          boundary,
          hook: () => fs.writeFileSync(metadataPath(firstName), changed),
        });
        expectEvidence(firstName, original, changed);
        expect(state.eventAtInjection).toEqual({
          kind: boundary === 'package' ? 'metadata' : 'state',
          file:
            boundary === 'package'
              ? metadataPath(reader === 'single' ? firstName : healthyName)
              : state.manifestPath,
          bytes:
            boundary === 'state'
              ? stateBytes
              : state.initial.find(
                  (item) =>
                    item.file === metadataPath(reader === 'single' ? firstName : healthyName),
                )?.bytes,
        });
        expect(result).toEqual(rejected(reader));
        expect(fs.readFileSync(metadataPath(firstName))).toEqual(changed);
        expect(
          findConfiguredOpenApiPolicy(healthyPolicy.product, healthyPolicy.actions[0]),
        ).toEqual(healthyPolicy);
      },
    );

    it('accepts complete content returned through repeated short reads', () => {
      const original = fs.readFileSync(metadataPath(firstName));
      const expected = accepted(reader);
      expect(observe(reader, { fault: 'partial' })).toEqual(expected);
      expectEvidence(firstName, original);
      const reads = state.verified.filter((item) => item.file === metadataPath(firstName));
      expect(reads[0]?.bytes.length).toBeGreaterThan(0);
      expect(reads[0]?.bytes.length).toBeLessThanOrEqual(13);
      expect(reads[1]?.position).toBe(reads[0]?.bytes.length);
      const rounds = verificationRounds(firstName);
      expect(rounds.length).toBeGreaterThan(0);
      for (const round of rounds)
        expect(Buffer.concat(round.map((item) => item.bytes))).toEqual(original);
    });

    it.each(['error', 'eof'] as const)(
      'rejects affected metadata on a partial-read %s and releases descriptors',
      (fault) => {
        const original = fs.readFileSync(metadataPath(firstName));
        const result = observe(reader, { fault });
        expectEvidence(firstName, original);
        expect(state.faults).toBe(1);
        expect(result).toEqual(rejected(reader));
      },
    );
  },
);

describe('original byte identity', () => {
  it('rejects a whitespace-only equal-length rewrite with identical parsed metadata', () => {
    const file = metadataPath(firstName);
    const packageBytes = fs.readFileSync(file);
    const original = Buffer.concat([packageBytes, Buffer.from(' \n')]);
    const changed = Buffer.concat([packageBytes, Buffer.from('\n ')]);
    fs.writeFileSync(file, original);
    expect(JSON.parse(original.toString())).toEqual(JSON.parse(changed.toString()));
    const result = observe('rules', { hook: () => fs.writeFileSync(file, changed) });
    expectEvidence(firstName, original, changed);
    expect(result).toEqual([healthyPolicy]);
  });

  it('rejects distinct raw bytes that decode to the same text', () => {
    const file = metadataPath(firstName);
    const packageBytes = fs.readFileSync(file);
    const prefix = Buffer.concat([
      packageBytes.subarray(0, packageBytes.length - 1),
      Buffer.from(',"note":"'),
    ]);
    const original = Buffer.concat([prefix, Buffer.from([0x80]), Buffer.from('"}')]);
    const changed = Buffer.concat([prefix, Buffer.from([0x81]), Buffer.from('"}')]);
    fs.writeFileSync(file, original);
    expect(original.toString()).toBe(changed.toString());
    expect(original).not.toEqual(changed);
    const result = observe('rules', { hook: () => fs.writeFileSync(file, changed) });
    expectEvidence(firstName, original, changed);
    expect(result).toEqual([healthyPolicy]);
  });

  it.each(['truncation', 'growth'] as const)(
    'rejects %s even when stat size remains unchanged',
    (kind) => {
      const file = metadataPath(firstName);
      const original = fs.readFileSync(file);
      const changed =
        kind === 'truncation'
          ? original.subarray(0, original.length - 1)
          : Buffer.concat([original, Buffer.from(' ')]);
      const result = observe('rules', { hook: () => fs.writeFileSync(file, changed) });
      expectEvidence(firstName, original);
      expect(state.injections).toBe(1);
      expect(fs.readFileSync(file)).toEqual(changed);
      if (kind === 'growth')
        expect(
          state.verified.some(
            (item) =>
              item.file === file &&
              item.afterInjection &&
              item.position !== null &&
              item.position <= original.length &&
              item.position + item.bytes.length > original.length &&
              item.bytes[original.length - item.position] === 0x20,
          ),
        ).toBe(true);
      expect(result).toEqual([healthyPolicy]);
    },
  );
});

describe('supplementary owner content', () => {
  it.each(['supplementary', 'recorded'] as const)(
    'preserves the %s ownership decision after unsafe owner bytes are discarded',
    (ownership) => {
      packageAt(ownerName, {
        command: 'content-owner',
        commandAliases: ['content-first'],
        entry: './index.mjs',
        handlerKey: 'run',
      });
      writeInstalled([
        record(ownerName, ownership === 'recorded' ? 'content-first' : 'content-owner', {
          enabled: false,
        }),
        record(firstName, firstManifest.command),
        record(healthyName, healthyManifest.command),
      ]);
      expect(getConfiguredOpenApiRules()).toEqual([healthyPolicy]);
      const file = metadataPath(ownerName);
      const original = fs.readFileSync(file);
      const changed = Buffer.from(original.toString().replace('content-first', 'content-other'));
      expect(changed.length).toBe(original.length);
      const result = observe('rules', {
        target: ownerName,
        boundary: 'state',
        hook: () => fs.writeFileSync(file, changed),
      });
      expectEvidence(ownerName, original, changed);
      expect(result).toEqual(
        ownership === 'recorded' ? [healthyPolicy] : [firstPolicy, healthyPolicy],
      );
    },
  );
});

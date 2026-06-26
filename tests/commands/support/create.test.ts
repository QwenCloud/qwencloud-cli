/**
 * Unit tests for the `support create` command (interactive three-stage flow).
 *
 * Validates:
 *   - Full happy path produces a ticket and surfaces the new vid
 *   - Stage 1 cancellation (Ctrl+C on category picker) avoids any write call
 *   - Stage 3 cancellation (user declines summary confirmation) avoids any write call
 *   - AI suggestion failure does not block the flow
 *   - Non-TTY environments fail fast with an INVALID_ARGUMENT error
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';

// ── Module mocks ────────────────────────────────────────────────────────

const holder: { client: ApiClient } = { client: makeMockApiClient() };
const authHolder: { ensureAuthenticated: () => unknown } = {
  ensureAuthenticated: () => ({}),
};
const confirmHolder: { confirmPrompt: (msg: string) => Promise<boolean> } = {
  confirmPrompt: async () => true,
};

type RenderBehavior = (element: React.ReactElement) => Promise<void> | void;
const renderHolder: { behavior: RenderBehavior } = {
  behavior: () => undefined,
};

// Drives the TextArea-backed multilineInput. Each renderInteractive call
// whose element exposes an `onSubmit` prop is treated as a TextArea render
// and resolved with one of these scripted behaviours.
type TextAreaBehavior = 'happy' | 'cancelled' | 'empty';
const textAreaHolder: { behavior: TextAreaBehavior; content: string } = {
  behavior: 'happy',
  content: 'API call timed out at 60s',
};

vi.mock('../../../src/api/client.js', () => ({
  createClient: async () => holder.client,
}));
vi.mock('../../../src/auth/credentials.js', () => ({
  ensureAuthenticated: () => authHolder.ensureAuthenticated(),
}));
vi.mock('../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../src/utils/confirm.js', () => ({
  confirmPrompt: (msg: string) => confirmHolder.confirmPrompt(msg),
}));
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderWithInkSync: vi.fn(),
  renderInteractive: vi.fn(async (element: React.ReactElement) => {
    const props = (element as unknown as { props: Record<string, unknown> }).props;
    if (typeof props.onSubmit === 'function') {
      const onSubmit = props.onSubmit as (text: string) => void;
      const onCancel = props.onCancel as (() => void) | undefined;
      if (textAreaHolder.behavior === 'cancelled') {
        onCancel?.();
        return;
      }
      if (textAreaHolder.behavior === 'empty') {
        onSubmit('');
        return;
      }
      onSubmit(textAreaHolder.content);
      return;
    }
    await renderHolder.behavior(element);
  }),
}));

const { supportCreateAction, registerSupportCreateCommand } = await import(
  '../../../src/commands/support/create.js'
);

const getClient = async () => holder.client as unknown;

// ── Helpers ─────────────────────────────────────────────────────────────

const SAMPLE_TREE = [
  {
    id: 'root-1',
    name: 'Model Service',
    children: [
      { id: 'leaf-1', name: 'Inference timeout' },
      { id: 'leaf-2', name: 'Inference failure' },
    ],
  },
];

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function setTTY(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
}

function restoreTTY(): void {
  if (stdinIsTTYDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
  if (stdoutIsTTYDescriptor) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor);
}

function buildSupportCreate(program: import('commander').Command) {
  const support = program.command('support');
  registerSupportCreateCommand(support, getClient as never);
}

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  confirmHolder.confirmPrompt = async () => true;
  renderHolder.behavior = () => undefined;
  textAreaHolder.behavior = 'happy';
  textAreaHolder.content = 'API call timed out at 60s';
});

afterEach(() => {
  restoreTTY();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('support create — full happy path', () => {
  it('walks Stage 1 → 2 → 3 and creates the ticket', async () => {
    setTTY(true, true);

    const createTicketSpy = vi.fn(async () => ({ vid: 'TICKET-130000999' }));
    const suggestSpy = vi.fn(async () => []);
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        suggestCategory: suggestSpy,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    renderHolder.behavior = (element) => {
      const props = (element as unknown as { props: { onSelect?: (s: unknown) => void } }).props;
      props.onSelect?.({ id: 'leaf-1', path: 'Model Service / Inference timeout' });
    };
    confirmHolder.confirmPrompt = async () => true;

    const r = await runCommand(buildSupportCreate, ['support', 'create', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(r.stdout);
    expect(payload.id).toBe('TICKET-130000999');
    expect(payload.status).toBe('created');
    expect(payload.categoryId).toBe('leaf-1');
  });
});

describe('support create — Stage 1 cancellation', () => {
  it('does not invoke createTicket when category picker is cancelled', async () => {
    setTTY(true, true);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    renderHolder.behavior = (element) => {
      const props = (element as unknown as { props: { onCancel?: () => void } }).props;
      props.onCancel?.();
    };

    const r = await runCommand(buildSupportCreate, ['support', 'create', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout);
    expect(payload.cancelled).toBe(true);
  });
});

describe('support create — Stage 3 cancellation', () => {
  it('does not invoke createTicket when user declines the summary confirmation', async () => {
    setTTY(true, true);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        suggestCategory: async () => [],
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    renderHolder.behavior = (element) => {
      const props = (element as unknown as { props: { onSelect?: (s: unknown) => void } }).props;
      props.onSelect?.({ id: 'leaf-1', path: 'Model Service / Inference timeout' });
    };
    confirmHolder.confirmPrompt = async () => false;

    const r = await runCommand(buildSupportCreate, ['support', 'create', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout);
    expect(payload.cancelled).toBe(true);
  });
});

describe('support create — AI suggestion resilience', () => {
  it('continues to summary stage even when suggestCategory throws', async () => {
    setTTY(true, true);

    const createTicketSpy = vi.fn(async () => ({ vid: 'TICKET-130000111' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        suggestCategory: async () => {
          throw new Error('LLM upstream error');
        },
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    renderHolder.behavior = (element) => {
      const props = (element as unknown as { props: { onSelect?: (s: unknown) => void } }).props;
      props.onSelect?.({ id: 'leaf-1', path: 'Model Service / Inference timeout' });
    };
    confirmHolder.confirmPrompt = async () => true;

    const r = await runCommand(buildSupportCreate, ['support', 'create', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(r.stdout);
    expect(payload.id).toBe('TICKET-130000111');
  });
});

describe('support create — non-TTY guard', () => {
  it('rejects with INVALID_ARGUMENT when stdin is not a TTY and no flags', async () => {
    setTTY(false, true);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, ['support', 'create', '--format', 'json']);

    expect(r.exitCode).toBe(4);
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });
});

// ── --list-categories tests ─────────────────────────────────────────────

describe('support create --list-categories', () => {
  it('outputs categories as JSON when --format json', async () => {
    setTTY(true, true);

    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--list-categories',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(2);
    expect(payload[0].id).toBe('leaf-1');
    expect(payload[0].category).toBe('Inference timeout');
    expect(payload[1].id).toBe('leaf-2');
    expect(payload[1].category).toBe('Inference failure');
  });

  it('works without TTY (non-interactive)', async () => {
    setTTY(false, false);

    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--list-categories',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(2);
  });

  it('takes priority over --category-id and --description', async () => {
    setTTY(true, true);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--list-categories',
      '--category-id',
      'leaf-1',
      '--description',
      'some issue',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout);
    expect(Array.isArray(payload)).toBe(true);
  });

  it('outputs text table format', async () => {
    setTTY(true, true);

    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--list-categories',
      '--format',
      'text',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('leaf-1');
    expect(r.stdout).toContain('Inference timeout');
  });
});

// ── Non-interactive creation tests ──────────────────────────────────────

describe('support create --category-id + --description', () => {
  it('creates ticket non-interactively with both flags', async () => {
    setTTY(false, false);

    const createTicketSpy = vi.fn(async () => ({ vid: 'TICKET-130000555' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--category-id',
      'leaf-1',
      '--description',
      'API call timed out',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).toHaveBeenCalledTimes(1);
    expect(createTicketSpy).toHaveBeenCalledWith({
      categoryId: 'leaf-1',
      description: 'API call timed out',
    });
    const payload = JSON.parse(r.stdout);
    expect(payload.id).toBe('TICKET-130000555');
    expect(payload.status).toBe('created');
    expect(payload.categoryId).toBe('leaf-1');
  });

  it('truncates description exceeding 2000 characters with stderr warning', async () => {
    setTTY(false, false);

    const longDesc = 'x'.repeat(2500);
    const createTicketSpy = vi.fn(async () => ({ vid: 'TICKET-130000666' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--category-id',
      'leaf-1',
      '--description',
      longDesc,
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toContain('2000 characters');
    expect(createTicketSpy).toHaveBeenCalledTimes(1);
    const calledDesc = (createTicketSpy.mock.calls[0][0] as { description: string }).description;
    expect(calledDesc.length).toBe(2000);
  });

  it('rejects when only --category-id is provided (non-TTY)', async () => {
    setTTY(false, false);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--category-id',
      'leaf-1',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects when only --description is provided (non-TTY)', async () => {
    setTTY(false, false);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--description',
      'some issue',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('does not require TTY when both flags are provided', async () => {
    setTTY(false, false);

    const createTicketSpy = vi.fn(async () => ({ vid: 'TICKET-130000777' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--category-id',
      'leaf-2',
      '--description',
      'Timeout error',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createTicketSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(r.stdout);
    expect(payload.id).toBe('TICKET-130000777');
  });

  it('rejects with INVALID_ARGUMENT when category-id is not in the tree', async () => {
    setTTY(false, false);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => SAMPLE_TREE,
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--category-id',
      'nonexistent-id',
      '--description',
      'some issue',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
    expect(payload.error.message).toContain('Invalid category ID: nonexistent-id');
  });

  it('rejects when getCategoryTree fails in non-interactive mode', async () => {
    setTTY(false, false);

    const createTicketSpy = vi.fn(async () => ({ vid: 'should-not-be-called' }));
    holder.client = makeMockApiClient({
      supportService: {
        getCategoryTree: async () => { throw new Error('Network error'); },
        createTicket: createTicketSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportCreate, [
      'support',
      'create',
      '--category-id',
      'leaf-1',
      '--description',
      'some issue',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(createTicketSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
    expect(payload.error.message).toContain('Failed to fetch category list');
  });
});

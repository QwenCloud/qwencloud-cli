/**
 * Unit tests for the `support close <ticket-id>` command (one-shot mode).
 *
 * Validates:
 *   - Existence guard: getTicket runs before any write
 *   - Confirmed close → cancelTicket is invoked
 *   - User declines confirmation → cancelTicket NOT invoked
 *   - --yes bypasses confirmation prompt
 *   - Invalid ticket → NOT_FOUND, cancelTicket NOT invoked
 *   - API errors are surfaced through handleError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import { CliError } from '../../../src/utils/errors.js';
import { EXIT_CODES } from '../../../src/utils/exit-codes.js';
import type { ApiClient } from '../../../src/api/client.js';
import type { SupportTicketDetail } from '../../../src/types/support.js';

const holder: { client: ApiClient } = { client: makeMockApiClient() };
const authHolder: { ensureAuthenticated: () => unknown } = {
  ensureAuthenticated: () => ({}),
};
const confirmHolder: { confirmPrompt: (msg: string) => Promise<boolean> } = {
  confirmPrompt: async () => true,
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

const { supportCloseAction } = await import('../../../src/commands/support/close.js');

const getClient = async () => holder.client as unknown;

/** A valid open ticket the existence guard accepts. */
function openTicket(id: string): SupportTicketDetail {
  return {
    id,
    title: 'Model inference timeout',
    status: 'dealing',
    createdAt: 1716883380000,
    category: 'Model Service / Inference',
    description: 'API timed out',
  };
}

function notFound(ticketId: string): CliError {
  return new CliError({
    code: 'NOT_FOUND',
    message: `Ticket not found: ${ticketId}`,
    exitCode: EXIT_CODES.GENERAL_ERROR,
  });
}

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  confirmHolder.confirmPrompt = async () => true;
});

function buildSupportClose(program: import('commander').Command) {
  const support = program.command('support');
  const close = support
    .command('close')
    .argument('<ticket-id>', 'Ticket ID to close')
    .option('--yes', 'Skip confirmation prompt', false);
  close.action(supportCloseAction(close, getClient as never));
}

describe('support close — confirmation flow', () => {
  it('invokes cancelTicket after user confirms', async () => {
    const cancelSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async (id: string) => openTicket(id),
        cancelTicket: cancelSpy,
      },
    } as unknown as Partial<ApiClient>);
    confirmHolder.confirmPrompt = async () => true;

    const r = await runCommand(buildSupportClose, [
      'support',
      'close',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith('TICKET-130000001');
    const payload = JSON.parse(r.stdout);
    expect(payload.status).toBe('closed');
  });

  it('skips cancelTicket when user declines confirmation', async () => {
    const cancelSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async (id: string) => openTicket(id),
        cancelTicket: cancelSpy,
      },
    } as unknown as Partial<ApiClient>);
    confirmHolder.confirmPrompt = async () => false;

    const r = await runCommand(buildSupportClose, [
      'support',
      'close',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(cancelSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout);
    expect(payload.cancelled).toBe(true);
  });
});

describe('support close — --yes shortcut', () => {
  it('skips confirmation prompt and invokes cancelTicket directly', async () => {
    const cancelSpy = vi.fn(async () => undefined);
    const confirmSpy = vi.fn(async () => true);
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async (id: string) => openTicket(id),
        cancelTicket: cancelSpy,
      },
    } as unknown as Partial<ApiClient>);
    confirmHolder.confirmPrompt = confirmSpy;

    const r = await runCommand(buildSupportClose, [
      'support',
      'close',
      'TICKET-130000001',
      '--yes',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});

describe('support close — existence guard', () => {
  it('invalid ticket with --yes → NOT_FOUND, cancelTicket NOT invoked', async () => {
    const cancelSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async (id: string) => {
          throw notFound(id);
        },
        cancelTicket: cancelSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportClose, [
      'support',
      'close',
      '999999999',
      '--yes',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { code: string } };
    expect(payload.error.code).toBe('NOT_FOUND');
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});

describe('support close — error routing', () => {
  it('forwards API errors through handleError', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async (id: string) => openTicket(id),
        cancelTicket: async () => {
          throw Object.assign(new Error('ticket already closed'), {
            name: 'GatewayBusinessError',
            code: '400',
          });
        },
      },
    } as unknown as Partial<ApiClient>);
    confirmHolder.confirmPrompt = async () => true;

    const r = await runCommand(buildSupportClose, [
      'support',
      'close',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type: string; message: string } };
    expect(payload.error.type).toBe('business');
    expect(payload.error.message).toContain('ticket already closed');
  });
});

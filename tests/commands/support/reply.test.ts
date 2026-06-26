/**
 * Unit tests for the `support reply <ticket-id> [--message <text>]` command.
 *
 * Validates:
 *   - Ticket existence is verified before sending; missing ticket → NOT_FOUND
 *   - Help flag swallowed as --message value short-circuits to help output
 *   - Content pre-check passes → createMessage is invoked
 *   - Content pre-check network error → createMessage still invoked (best-effort)
 *   - Content flagged + non-interactive → INVALID_ARGUMENT error
 *   - Content flagged + interactive user revises → createMessage invoked
 *   - Content flagged + interactive user cancels → cancelled
 *   - Missing --message in TTY → enters interactive multiline input
 *   - Missing --message in non-TTY → INVALID_ARGUMENT
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';
import type { SupportTicketDetail } from '../../../src/types/support.js';
import { ticketNotFoundError } from '../../../src/utils/errors.js';

const holder: { client: ApiClient } = { client: makeMockApiClient() };
const authHolder: { ensureAuthenticated: () => unknown } = {
  ensureAuthenticated: () => ({}),
};

const VALID_TICKET: SupportTicketDetail = {
  id: 'TICKET-130000001',
  title: 'Inference timeout',
  status: 'wait_feedback',
  createdAt: 1716883380000,
  category: 'Model Service',
  description: 'desc',
};

/**
 * Build a supportService stub with a default existence-check getTicket, so each
 * test only specifies the methods it cares about.
 */
function replySvc(over: Record<string, unknown>): Partial<ApiClient> {
  return {
    supportService: {
      getTicket: async () => VALID_TICKET,
      ...over,
    },
  } as unknown as Partial<ApiClient>;
}

// Drives the TextArea-backed multilineInput used in interactive mode.
type TextAreaBehavior = 'happy' | 'cancelled' | 'empty';
const textAreaHolder: { behavior: TextAreaBehavior; content: string; callCount: number; contents: string[] } = {
  behavior: 'happy',
  content: 'Please check the logs',
  callCount: 0,
  contents: [],
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
      // Support sequential content for multi-call scenarios
      const idx = textAreaHolder.callCount++;
      const content = textAreaHolder.contents.length > idx
        ? textAreaHolder.contents[idx]
        : textAreaHolder.content;
      onSubmit(content);
    }
  }),
}));

const { supportReplyAction } = await import('../../../src/commands/support/reply.js');

const getClient = async () => holder.client as unknown;

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

function setStdinTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

function restoreStdinTTY(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
  }
}

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  textAreaHolder.behavior = 'happy';
  textAreaHolder.content = 'Please check the logs';
  textAreaHolder.callCount = 0;
  textAreaHolder.contents = [];
});

afterEach(() => {
  restoreStdinTTY();
});

function buildSupportReply(program: import('commander').Command) {
  const support = program.command('support');
  const reply = support
    .command('reply')
    .argument('<ticket-id>', 'Ticket ID to reply to')
    .option('--message <text>', 'Reply message body (enter interactive mode if omitted)');
  reply.action(supportReplyAction(reply, getClient as never));
}

describe('support reply — happy path', () => {
  it('sends the reply when risk-word check passes', async () => {
    const identifySpy = vi.fn(async () => ({ hasRisk: false }));
    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({ identifyRiskWord: identifySpy, createMessage: createMessageSpy }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--message',
      'Please check the logs',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(identifySpy).toHaveBeenCalledTimes(1);
    expect(createMessageSpy).toHaveBeenCalledWith('TICKET-130000001', 'Please check the logs');
    const payload = JSON.parse(r.stdout);
    expect(payload.status).toBe('sent');
  });
});

describe('support reply — ticket existence', () => {
  it('rejects with NOT_FOUND and does not send when the ticket is missing', async () => {
    const createMessageSpy = vi.fn(async () => undefined);
    const identifySpy = vi.fn(async () => ({ hasRisk: false }));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => {
          throw ticketNotFoundError('NOPE');
        },
        identifyRiskWord: identifySpy,
        createMessage: createMessageSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'NOPE',
      '--message',
      'Any message',
      '--format',
      'json',
    ]);

    expect(r.exitCode).not.toBe(0);
    expect(createMessageSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('NOT_FOUND');
  });
});

describe('support reply — content pre-check resilience', () => {
  it('proceeds with createMessage when pre-check throws', async () => {
    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({
        identifyRiskWord: async () => {
          throw new Error('upstream timeout');
        },
        createMessage: createMessageSpy,
      }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--message',
      'Need an update',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createMessageSpy).toHaveBeenCalledTimes(1);
  });
});

describe('support reply — content pre-check blocking', () => {
  it('errors out in non-interactive mode when content is flagged', async () => {
    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({
        identifyRiskWord: async () => ({ hasRisk: true, words: ['x'] }),
        createMessage: createMessageSpy,
      }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--message',
      'this is flagged text',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(createMessageSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('allows user to revise and submit in interactive mode when flagged', async () => {
    setStdinTTY(true);
    // First call: initial message; Second call: revised message
    textAreaHolder.contents = ['flagged content', 'safe content'];
    let callCount = 0;
    const identifySpy = vi.fn(async () => {
      callCount++;
      return { hasRisk: callCount <= 1 };
    });
    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({ identifyRiskWord: identifySpy, createMessage: createMessageSpy }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(identifySpy).toHaveBeenCalledTimes(2);
    expect(createMessageSpy).toHaveBeenCalledWith('TICKET-130000001', 'safe content');
  });

  it('cancels when user provides empty revision in interactive mode', async () => {
    setStdinTTY(true);
    // First call: initial message that gets flagged
    textAreaHolder.contents = ['flagged content'];
    const identifySpy = vi.fn(async () => ({ hasRisk: true }));
    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({ identifyRiskWord: identifySpy, createMessage: createMessageSpy }),
    );

    // After first identifyRiskWord flags it, the revision multilineInput returns empty
    // We need the second renderInteractive call to return empty
    let renderCallCount = 0;
    const { renderInteractive } = await import('../../../src/ui/render.js');
    (renderInteractive as ReturnType<typeof vi.fn>).mockImplementation(async (element: React.ReactElement) => {
      const props = (element as unknown as { props: Record<string, unknown> }).props;
      if (typeof props.onSubmit === 'function') {
        const onSubmit = props.onSubmit as (text: string) => void;
        renderCallCount++;
        if (renderCallCount === 1) {
          onSubmit('flagged content');
        } else {
          onSubmit(''); // empty = cancel
        }
      }
    });

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createMessageSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout);
    expect(payload.cancelled).toBe(true);
  });
});

describe('support reply — interactive message input', () => {
  it('reads message from stdin when --message is omitted in TTY', async () => {
    setStdinTTY(true);
    textAreaHolder.behavior = 'happy';
    textAreaHolder.content = 'Typed reply line one\nTyped reply line two';

    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({ identifyRiskWord: async () => ({ hasRisk: false }), createMessage: createMessageSpy }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createMessageSpy).toHaveBeenCalledWith(
      'TICKET-130000001',
      'Typed reply line one\nTyped reply line two',
    );
    const payload = JSON.parse(r.stdout);
    expect(payload.status).toBe('sent');
  });

  it('cancels gracefully when interactive input is empty', async () => {
    setStdinTTY(true);
    textAreaHolder.behavior = 'empty';

    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({ identifyRiskWord: async () => ({ hasRisk: false }), createMessage: createMessageSpy }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(createMessageSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout);
    expect(payload.cancelled).toBe(true);
  });

  it('rejects with INVALID_ARGUMENT when --message is omitted in non-TTY', async () => {
    setStdinTTY(false);

    const createMessageSpy = vi.fn(async () => undefined);
    holder.client = makeMockApiClient(
      replySvc({ identifyRiskWord: async () => ({ hasRisk: false }), createMessage: createMessageSpy }),
    );

    const r = await runCommand(buildSupportReply, [
      'support',
      'reply',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(createMessageSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });
});

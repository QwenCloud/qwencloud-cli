/**
 * Unit tests for the `support view <ticket-id>` command (one-shot mode).
 *
 * Validates:
 *   - Normal detail + message timeline rendering (JSON format)
 *   - Ticket not found (401 business error)
 *   - --format json output shape
 *   - Message role mapping (customer→You, agent→Support Engineer, system→System)
 *   - 100-message truncation notice
 *   - Authentication failure handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import { CliError } from '../../../src/utils/errors.js';
import { EXIT_CODES } from '../../../src/utils/exit-codes.js';
import type { ApiClient } from '../../../src/api/client.js';

/**
 * Build a NOT_FOUND CliError that mirrors the `ticketNotFoundError` factory's
 * contract (code 'NOT_FOUND', GENERAL_ERROR exit) so the command-layer routing
 * can be asserted independently of the service implementation.
 */
function notFound(ticketId: string): CliError {
  return new CliError({
    code: 'NOT_FOUND',
    message: `Ticket not found: ${ticketId}`,
    exitCode: EXIT_CODES.GENERAL_ERROR,
  });
}

const holder: { client: ApiClient } = { client: makeMockApiClient() };
const authHolder: { ensureAuthenticated: () => unknown } = {
  ensureAuthenticated: () => ({}),
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
  renderInteractive: vi.fn(),
  renderWithInkSync: vi.fn(),
}));

const { supportViewAction } = await import('../../../src/commands/support/view.js');

const getClient = async () => holder.client as unknown;

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
});

function buildSupportView(program: import('commander').Command) {
  const support = program.command('support');
  const view = support.command('view').argument('<ticket-id>', 'ticket ID');
  view.action(supportViewAction(view, getClient as never));
}

const SAMPLE_DETAIL = {
  detail: {
    id: '130000001',
    title: 'Model inference timeout investigation',
    status: 'wait_feedback',
    createdAt: 1716883380000,
    category: 'Model Service / Inference Issues / Timeout',
    description: 'dashscope API timed out after 60s',
  },
  messages: {
    messages: [
      {
        role: 'customer',
        nickName: 'User',
        content: 'My API calls are timing out after 60 seconds.',
        createdAt: 1716883380000,
      },
      {
        role: 'agent',
        nickName: 'Alice',
        content: 'Please provide the RequestId and the model name.',
        createdAt: 1716886980000,
      },
      {
        role: 'system',
        nickName: 'System',
        content: 'Ticket status changed to Pending feedback.',
        createdAt: 1716887040000,
      },
    ],
    truncated: false,
  },
};

describe('support view (JSON mode)', () => {
  it('renders ticket detail with messages on success', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => SAMPLE_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toBe('');
    const payload = JSON.parse(r.stdout);
    expect(payload.ticket.id).toBe('130000001');
    expect(payload.ticket.status).toBe('Pending feedback');
    expect(payload.messages).toHaveLength(3);
  });

  it('includes ticket metadata fields in JSON output', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => SAMPLE_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    const payload = JSON.parse(r.stdout);
    expect(payload.ticket.title).toBe('Model inference timeout investigation');
    expect(payload.ticket.category).toBe('Model Service / Inference Issues / Timeout');
    expect(payload.ticket.description).toBeDefined();
  });
});

describe('support view — message role mapping', () => {
  it('maps customer role to "You"', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => SAMPLE_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    const payload = JSON.parse(r.stdout);
    expect(payload.messages[0].displayRole).toBe('You');
  });

  it('maps agent role to "Support Engineer"', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => SAMPLE_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    const payload = JSON.parse(r.stdout);
    expect(payload.messages[1].displayRole).toBe('Support Engineer');
  });

  it('maps system role to "System"', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => SAMPLE_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    const payload = JSON.parse(r.stdout);
    expect(payload.messages[2].displayRole).toBe('System');
  });
});

// ── BUG-8: email nickName masking surfaces through the command output ──────

const EMAIL_DETAIL = {
  detail: SAMPLE_DETAIL.detail,
  messages: {
    messages: [
      {
        role: 'customer',
        nickName: 'alice@mock-api.test.qwencloud.com',
        content: 'My API calls are timing out.',
        createdAt: 1716883380000,
      },
      {
        role: 'agent',
        nickName: 'Service Assistant',
        content: 'Please provide the RequestId.',
        createdAt: 1716886980000,
      },
    ],
    truncated: false,
  },
};

describe('support view — email nickName masking (BUG-8)', () => {
  it('masks an email nickName in JSON output and leaves non-email verbatim', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => EMAIL_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout) as {
      messages: { nickName: string }[];
    };
    expect(payload.messages[0].nickName).toBe('a***@mock-api.test.qwencloud.com');
    expect(payload.messages[1].nickName).toBe('Service Assistant');
    // The raw email must not leak anywhere in stdout.
    expect(r.stdout).not.toContain('alice@mock-api.test.qwencloud.com');
  });

  it('masks an email nickName in TEXT output', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => EMAIL_DETAIL,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'text',
    ]);

    expect(r.stdout).toContain('a***@mock-api.test.qwencloud.com');
    expect(r.stdout).not.toContain('alice@mock-api.test.qwencloud.com');
  });
});

describe('support view — truncation notice', () => {
  it('includes truncated=true when 100 messages are returned', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => ({
          detail: SAMPLE_DETAIL.detail,
          messages: {
            messages: Array.from({ length: 100 }, (_, i) => ({
              role: 'customer',
              nickName: 'User',
              content: `Message ${i + 1}`,
              createdAt: 1716883380000 + i * 60000,
            })),
            truncated: true,
          },
        }),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    const payload = JSON.parse(r.stdout);
    expect(payload.truncated).toBe(true);
    expect(payload.messages).toHaveLength(100);
  });

  it('outputs truncation warning in TEXT mode when at 100-message limit', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => ({
          detail: SAMPLE_DETAIL.detail,
          messages: {
            messages: Array.from({ length: 100 }, (_, i) => ({
              role: 'customer',
              nickName: 'User',
              content: `Message ${i + 1}`,
              createdAt: 1716883380000 + i * 60000,
            })),
            truncated: true,
          },
        }),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, ['support', 'view', '130000001', '--format', 'text']);

    expect(r.stdout).toContain('Showing latest 100 messages');
  });
});

describe('support view — error routing', () => {
  it('invalid ticket → non-zero exit + NOT_FOUND, no placeholder detail', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => {
          throw notFound('999999999');
        },
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '999999999',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe('NOT_FOUND');
    // The placeholder ticket (title '—', status 'Unknown') must NOT be emitted.
    expect(r.stdout).toBe('');
  });

  it('ticket not found via upstream business error → exit 1', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => {
          throw Object.assign(new Error('您无权查看该工单'), {
            name: 'GatewayBusinessError',
            code: '401',
          });
        },
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '999999999',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type: string; message: string } };
    expect(payload.error.type).toBe('business');
  });

  it('gateway error → exit 1', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicketDetail: async () => {
          throw Object.assign(new Error('upstream 502'), { name: 'GatewayEnvelopeError' });
        },
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
  });
});

describe('support view — auth failure', () => {
  it('exits 2 when ensureAuthenticated throws', async () => {
    authHolder.ensureAuthenticated = () => {
      throw Object.assign(new Error('not authenticated'), {
        name: 'AuthenticationRequiredError',
      });
    };

    const r = await runCommand(buildSupportView, [
      'support',
      'view',
      '130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not authenticated');
  });
});

/**
 * Unit tests for the `support list` command (one-shot mode).
 *
 * Validates:
 *   - Normal ticket list rendering (JSON format)
 *   - Empty state message
 *   - --page / --page-size forwarding to the service (which owns slicing)
 *   - CLI-layer validation of --page and --page-size (no silent clamp)
 *   - Pagination slice assembly into JSON (items / total / totalPages)
 *   - Authentication failure handling
 *   - Business / gateway error routing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';

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
const mockRenderInteractive = vi.fn();
vi.mock('../../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderInteractive: mockRenderInteractive,
  renderWithInkSync: vi.fn(),
}));

const { supportListAction } = await import('../../../src/commands/support/list.js');

const getClient = async () => holder.client as unknown;

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  mockRenderInteractive.mockReset();
});

/**
 * Register the command WITHOUT a commander parseInt parser — the CLI layer
 * now validates raw string values itself (no silent coercion / clamp).
 */
function buildSupportList(program: import('commander').Command) {
  const support = program.command('support');
  const list = support
    .command('list')
    .option('--page <n>', 'page number')
    .option('--page-size <n>', 'page size');
  list.action(supportListAction(list, getClient as never));
}

const SAMPLE_TICKETS = {
  total: 2,
  page: 1,
  pageSize: 10,
  tickets: [
    {
      id: '130000001',
      title: 'Model inference timeout',
      status: 'Pending feedback',
      createdAt: '2026-05-28 14:23',
    },
    {
      id: '130000002',
      title: 'Billing inquiry',
      status: 'Closed',
      createdAt: '2026-05-20 09:15',
    },
  ],
};

describe('support list (JSON mode)', () => {
  it('renders ticket list shape on success', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => SAMPLE_TICKETS,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, ['support', 'list', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toBe('');
    const payload = JSON.parse(r.stdout);
    expect(payload.total).toBe(2);
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].id).toBe('130000001');
  });

  it('renders empty state when no tickets exist', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => ({
          total: 0,
          page: 1,
          pageSize: 10,
          tickets: [],
        }),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, ['support', 'list', '--format', 'json']);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.total).toBe(0);
    expect(payload.items).toEqual([]);
  });
});

describe('support list — TEXT mode empty state', () => {
  it('outputs guidance message when ticket list is empty', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => ({
          total: 0,
          page: 1,
          pageSize: 10,
          tickets: [],
        }),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, ['support', 'list', '--format', 'text']);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('No support tickets yet');
  });
});

describe('support list — flag parsing', () => {
  it('forwards --page / --page-size to supportService.listTickets', async () => {
    let captured: { page?: number; pageSize?: number } = {};
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async (opts: { page?: number; pageSize?: number }) => {
          captured = { page: opts.page, pageSize: opts.pageSize };
          return {
            total: 0,
            page: opts.page ?? 1,
            pageSize: opts.pageSize ?? 10,
            tickets: [],
          };
        },
      },
    } as unknown as Partial<ApiClient>);

    await runCommand(buildSupportList, [
      'support',
      'list',
      '--page',
      '3',
      '--page-size',
      '10',
      '--format',
      'json',
    ]);

    expect(captured.page).toBe(3);
    expect(captured.pageSize).toBe(10);
  });
});

describe('support list — pagination slice assembly (JSON)', () => {
  it('reflects the service slice + real total + totalPages in JSON output', async () => {
    // Service returns a single-row slice of a 3-ticket set (page 2, pageSize 1).
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => ({
          total: 3,
          page: 2,
          pageSize: 1,
          tickets: [
            {
              id: '130000002',
              title: 'Billing inquiry',
              status: 'Processing',
              createdAt: '2026-05-20 09:15',
            },
          ],
        }),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page',
      '2',
      '--page-size',
      '1',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].id).toBe('130000002');
    expect(payload.total).toBe(3);
    expect(payload.totalPages).toBe(3); // ceil(3 / 1)
  });

  it('keeps real total and non-zero totalPages for an out-of-range page', async () => {
    // page=5 on a 3-ticket set → empty slice, but total/totalPages reflect reality.
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => ({
          total: 3,
          page: 5,
          pageSize: 10,
          tickets: [],
        }),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page',
      '5',
      '--page-size',
      '10',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload.items).toEqual([]);
    expect(payload.total).toBe(3);
    expect(payload.totalPages).toBe(1); // ceil(3 / 10)
  });
});

describe('support list — page-size validation', () => {
  it('rejects --page-size 0 with INVALID_ARGUMENT exit 4', async () => {
    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page-size',
      '0',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('--page-size must be a positive integer between 1 and 10.');
  });

  it('rejects --page-size 11 with INVALID_ARGUMENT exit 4 (no silent clamp)', async () => {
    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page-size',
      '11',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('--page-size must be a positive integer between 1 and 10.');
  });

  it('rejects non-numeric --page-size abc with INVALID_ARGUMENT exit 4', async () => {
    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page-size',
      'abc',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('--page-size must be a positive integer between 1 and 10.');
  });
});

describe('support list — page validation', () => {
  it('rejects --page 0 with INVALID_ARGUMENT exit 4', async () => {
    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page',
      '0',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('page must be a positive integer');
  });

  it('rejects negative --page -1 with INVALID_ARGUMENT exit 4', async () => {
    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page',
      '-1',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('page must be a positive integer');
  });

  it('rejects non-numeric --page abc with INVALID_ARGUMENT exit 4', async () => {
    const r = await runCommand(buildSupportList, [
      'support',
      'list',
      '--page',
      'abc',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain('page must be a positive integer');
  });
});

describe('support list — error routing', () => {
  it('business error → exit 1, JSON includes type=business', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => {
          throw Object.assign(new Error('parameter invalid'), {
            name: 'GatewayBusinessError',
            code: 'InvalidParameter',
          });
        },
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, ['support', 'list', '--format', 'json']);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type: string } };
    expect(payload.error.type).toBe('business');
  });

  it('gateway error → exit 1, JSON includes type=gateway', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => {
          throw Object.assign(new Error('upstream 502'), { name: 'GatewayEnvelopeError' });
        },
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportList, ['support', 'list', '--format', 'json']);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type: string } };
    expect(payload.error.type).toBe('gateway');
  });
});

describe('support list — table format rendering', () => {
  it('calls renderInteractive when format=table and stdout is TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => SAMPLE_TICKETS,
      },
    } as unknown as Partial<ApiClient>);

    await runCommand(buildSupportList, ['support', 'list', '--format', 'table']);

    expect(mockRenderInteractive).toHaveBeenCalledTimes(1);
    const element = mockRenderInteractive.mock.calls[0][0] as {
      props: {
        totalItems: number;
        perPage: number;
        initialPage: number;
        initialRows: Array<{ id: string; title: string }>;
        title: string;
      };
    };
    expect(element.props.totalItems).toBe(2);
    expect(element.props.perPage).toBe(10);
    expect(element.props.initialPage).toBe(1);
    expect(element.props.initialRows).toHaveLength(2);
    expect(element.props.initialRows[0].id).toBe('130000001');
    expect(element.props.initialRows[0].title).toBe('Model inference timeout');
    expect(element.props.title).toBe('Support Tickets');
  });

  it('does not call renderInteractive when ticket list is empty', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
    holder.client = makeMockApiClient({
      supportService: {
        listTickets: async () => ({
          total: 0,
          page: 1,
          pageSize: 20,
          tickets: [],
        }),
      },
    } as unknown as Partial<ApiClient>);

    await runCommand(buildSupportList, ['support', 'list', '--format', 'table']);

    expect(mockRenderInteractive).not.toHaveBeenCalled();
  });
});

describe('support list — auth failure', () => {
  it('exits 2 when ensureAuthenticated throws', async () => {
    authHolder.ensureAuthenticated = () => {
      throw Object.assign(new Error('not authenticated'), {
        name: 'AuthenticationRequiredError',
      });
    };

    const r = await runCommand(buildSupportList, ['support', 'list', '--format', 'json']);

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not authenticated');
  });
});

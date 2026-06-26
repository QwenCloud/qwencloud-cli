/**
 * Unit tests for the `support rate <ticket-id>` command.
 *
 * Validates:
 *   - Non-interactive submission via --rating / --comment flags
 *   - Three-format output (json / text / table)
 *   - Parameter range validation (1-5)
 *   - Non-TTY guard when --rating is omitted
 *   - Eligibility guard via getAssessmentCard (editable=true required)
 *   - Card metadata propagation into rateTicket (without the editable flag)
 *   - Tag argument is undefined in non-interactive mode (no TagSelector run)
 *   - Ticket-not-found and network error routing through handleError
 *   - Comment 500-char truncation with warning
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCommand } from '../../helpers/run-command.js';
import { makeMockApiClient } from '../../helpers/api-client.js';
import type { ApiClient } from '../../../src/api/client.js';
import type {
  SupportTicketDetail,
  AssessmentCardData,
  RateTicketResponse,
} from '../../../src/types/support.js';

// ── Module mocks ────────────────────────────────────────────────────────

const holder: { client: ApiClient } = { client: makeMockApiClient() };
const authHolder: { ensureAuthenticated: () => unknown } = {
  ensureAuthenticated: () => ({}),
};

// Scripts the interactive surfaces rendered by `support rate`:
//   • elements exposing onSubmit  → the comment editor (multilineInput/TextArea
//     after BUG-2). Resolved with `comment` (a string) or cancelled (onCancel).
//   • elements exposing onSelect  → a selector. RatingSelector's onSelect takes
//     a number and TagSelector's takes a string[]; they are dispatched in
//     encounter order (first selector = rating, the rest = tags).
const interactiveHolder: {
  comment: string;
  commentCancelled: boolean;
  rating: number;
  tags: string[];
  selectCount: number;
} = {
  comment: '',
  commentCancelled: false,
  rating: 4,
  tags: [],
  selectCount: 0,
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
      if (interactiveHolder.commentCancelled) {
        onCancel?.();
        return;
      }
      onSubmit(interactiveHolder.comment);
      return;
    }
    if (typeof props.onSelect === 'function') {
      const idx = interactiveHolder.selectCount++;
      if (idx === 0) {
        (props.onSelect as (rating: number) => void)(interactiveHolder.rating);
      } else {
        (props.onSelect as (tags: string[]) => void)(interactiveHolder.tags);
      }
      return;
    }
    return undefined;
  }),
}));

const { supportRateAction } = await import('../../../src/commands/support/rate.js');

const getClient = async () => holder.client as unknown;

// ── Helpers ─────────────────────────────────────────────────────────────

function makeTicketDetail(overrides: Partial<SupportTicketDetail> = {}): SupportTicketDetail {
  return {
    id: 'TICKET-130000001',
    title: 'Inference timeout investigation',
    status: 'wait_score',
    createdAt: 1716883380000,
    category: 'Model Service / Inference Issues / Timeout',
    description: 'API timed out after 60s',
    ...overrides,
  };
}

function makeCard(overrides: Partial<AssessmentCardData> = {}): AssessmentCardData {
  return {
    editable: true,
    hasCard: true,
    alreadyRated: false,
    schemaId: 1001,
    bizType: 'ticket_satisfaction',
    answerType: 'satisfaction_card',
    cardBizId: 'CARD-XYZ',
    dialogId: 9988,
    ticketId: 'TICKET-130000001',
    isStar: false,
    ...overrides,
  };
}

/** A closed + already-rated card: not editable, already rated with a score. */
function makeRatedCard(satisfaction = 5): AssessmentCardData {
  return makeCard({
    editable: false,
    hasCard: true,
    alreadyRated: true,
    satisfaction,
  });
}

/** A not-yet-closed ticket: getAssessmentCard returned no DataInfo. */
function makeNoCard(): AssessmentCardData {
  return makeCard({ editable: false, hasCard: false, alreadyRated: false });
}

function makeRateResponse(rating: number, ticketId = 'TICKET-130000001'): RateTicketResponse {
  return {
    ticketId,
    rating,
    status: 'score',
    timestamp: '2026-04-20T10:00:00.000Z',
  };
}

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

function buildSupportRate(program: import('commander').Command) {
  const support = program.command('support');
  const rate = support
    .command('rate')
    .argument('<ticket-id>', 'Ticket ID to rate')
    .option('--rating <n>', 'Satisfaction rating (1-5)')
    .option('--comment <text>', 'Optional comment');
  rate.action(supportRateAction(rate, getClient as never));
}

beforeEach(() => {
  holder.client = makeMockApiClient();
  authHolder.ensureAuthenticated = () => ({});
  interactiveHolder.comment = '';
  interactiveHolder.commentCancelled = false;
  interactiveHolder.rating = 4;
  interactiveHolder.tags = [];
  interactiveHolder.selectCount = 0;
  // Default: stdin is a TTY but --rating provided will skip interaction.
  setTTY(true, true);
});

afterEach(() => {
  restoreTTY();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('support rate — non-interactive submission', () => {
  it('submits rating with --rating flag (no comment, no tags)', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    const [ticketId, rating, comment, metadata, tags] = rateSpy.mock.calls[0];
    expect(ticketId).toBe('TICKET-130000001');
    expect(rating).toBe(4);
    expect(comment).toBeUndefined();
    // tags must be undefined in non-interactive mode (no TagSelector run).
    expect(tags).toBeUndefined();
    // metadata must contain only the wire-level snapshot fields — every
    // three-state decision field (editable/hasCard/alreadyRated/satisfaction)
    // must be stripped before forwarding to rateTicket (G2).
    expect(metadata).toEqual({
      schemaId: 1001,
      bizType: 'ticket_satisfaction',
      answerType: 'satisfaction_card',
      cardBizId: 'CARD-XYZ',
      dialogId: 9988,
      ticketId: 'TICKET-130000001',
      isStar: false,
    });
    expect(metadata).not.toHaveProperty('editable');
    expect(metadata).not.toHaveProperty('hasCard');
    expect(metadata).not.toHaveProperty('alreadyRated');
    expect(metadata).not.toHaveProperty('satisfaction');
  });

  it('forwards --comment value to rateTicket', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(5));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--comment',
      'Excellent support',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    const [ticketId, rating, comment] = rateSpy.mock.calls[0];
    expect(ticketId).toBe('TICKET-130000001');
    expect(rating).toBe(5);
    expect(comment).toBe('Excellent support');
  });

  it('propagates the full metadata snapshot returned by getAssessmentCard', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(5));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () =>
          makeCard({
            schemaId: 7777,
            cardBizId: 'CARD-ABC-001',
            dialogId: 555_001,
            isStar: true,
          }),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const metadata = rateSpy.mock.calls[0][3];
    expect(metadata).toMatchObject({
      schemaId: 7777,
      cardBizId: 'CARD-ABC-001',
      dialogId: 555_001,
      isStar: true,
    });
  });
});

describe('support rate — output formats', () => {
  it('emits a complete JSON payload with all contract fields', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--comment',
      'Quick and helpful',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout) as {
      ticketId: string;
      rating: number;
      ratingLabel: string;
      comment: string | null;
      status: string;
      statusLabel: string;
      timestamp: string;
    };
    expect(payload.ticketId).toBe('TICKET-130000001');
    expect(payload.rating).toBe(4);
    expect(payload.ratingLabel).toBe('Satisfied');
    expect(payload.comment).toBe('Quick and helpful');
    expect(payload.status).toBe('score');
    expect(payload.statusLabel).toBe('Closed');
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('renders human-readable lines under --format text', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(4),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'text',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('TICKET-130000001');
    expect(r.stdout).toMatch(/Rating:\s*4\/5/);
    expect(r.stdout).toContain('Satisfied');
    expect(r.stdout).toContain('Closed');
  });
});

describe('support rate — parameter validation', () => {
  it('rejects --rating below 1 with INVALID_ARGUMENT', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(1));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '0',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects --rating above 5 with INVALID_ARGUMENT', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(5));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '6',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects non-TTY environments when --rating is omitted', async () => {
    setTTY(false, true);

    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });
});

describe('support rate — eligibility guard (GetAssessmentCard)', () => {
  it('proceeds when getAssessmentCard reports editable=true', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    const cardSpy = vi.fn(async () => makeCard());
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'wait_score' }),
        getAssessmentCard: cardSpy,
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(cardSpy).toHaveBeenCalledWith('TICKET-130000001');
    expect(rateSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects rating with the fallback message when the card exists but is neither editable nor rated', async () => {
    // Defensive bucket: hasCard=true && !editable && !alreadyRated (unexpected
    // Editable value). Must retain the generic "not available for rating" copy.
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'dealing' }),
        getAssessmentCard: async () =>
          makeCard({ editable: false, hasCard: true, alreadyRated: false }),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { message?: string } };
    expect(payload.error.message).toMatch(/not available for rating/i);
    expect(payload.error.message).toMatch(/TICKET-130000001/);
  });

  it('forwards getAssessmentCard failures through handleError', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => {
          throw Object.assign(new Error('connect ETIMEDOUT mock-api.test.qwencloud.com'), {
            name: 'NetworkError',
            code: 'ETIMEDOUT',
          });
        },
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { message?: string } };
    expect(payload.error.message).toMatch(/ETIMEDOUT|timeout/i);
  });

  it('surfaces ticket-not-found error from getTicket through handleError', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => {
          throw Object.assign(new Error('您无权查看该工单'), {
            name: 'GatewayBusinessError',
            code: '401',
          });
        },
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(4),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-999999999',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { type?: string } };
    expect(payload.error.type).toBe('business');
  });
});

describe('support rate — error routing', () => {
  it('forwards network errors from rateTicket through handleError', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => {
          throw Object.assign(new Error('connect ETIMEDOUT mock-api.test.qwencloud.com'), {
            name: 'NetworkError',
            code: 'ETIMEDOUT',
          });
        },
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(1);
    const payload = JSON.parse(r.stderr) as { error: { message?: string } };
    expect(payload.error.message).toMatch(/ETIMEDOUT|timeout/i);
  });
});

describe('support rate — table format output', () => {
  it('renders success message with visual rating in table format', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(5),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--format',
      'table',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('TICKET-130000001');
    expect(r.stdout).toMatch(/rated successfully/i);
    expect(r.stdout).toMatch(/Rating:/i);
    expect(r.stdout).toMatch(/Status:/i);
  });

  it('renders comment in table format when provided', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(4),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--comment',
      'Good job',
      '--format',
      'table',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('Good job');
  });
});

describe('support rate — additional validation cases', () => {
  it('rejects non-numeric --rating value', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(1),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      'abc',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects non-integer --rating value like 3.5', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(3),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '3.5',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects when getTicket returns null id (ticket not found)', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => ({ id: '', title: '', status: '', createdAt: 0 }),
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(4),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-FAKE',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
    expect(payload.error.message).toMatch(/not found/i);
  });

  it('rejects when getTicket returns null object', async () => {
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => null,
        getAssessmentCard: async () => makeCard(),
        rateTicket: async () => makeRateResponse(4),
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-MISSING',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    const payload = JSON.parse(r.stderr) as { error: { code?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
  });

  it('accepts minimum valid rating of 1', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(1));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '1',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy.mock.calls[0][1]).toBe(1);
  });

  it('accepts maximum valid rating of 5', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(5));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy.mock.calls[0][1]).toBe(5);
  });
});

// ── BUG-1: pre-submission three-state branching ──────────────────────────
//
// getTicket existence guard runs first (unchanged). After it, getAssessmentCard
// classifies the ticket into one of three buckets and the command short-circuits
// before rateTicket:
//   • alreadyRated            → friendly info, exit 0, rateTicket NOT called
//   • !hasCard (not closed)   → INVALID_ARGUMENT exit 4, "not awaiting rating"
//   • hasCard && !editable && !alreadyRated → exit 4, "not available for rating"
// Only an editable card proceeds into the submission flow.

describe('support rate — already-rated short-circuit (BUG-1)', () => {
  it('returns exit 0 with a friendly info line and does NOT call rateTicket (text)', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(5));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'score' }),
        getAssessmentCard: async () => makeRatedCard(5),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--format',
      'text',
    ]);

    expect(r.exitCode).toBe(0);
    expect(rateSpy).not.toHaveBeenCalled();
    expect(r.stdout).toMatch(/has already been rated \(5\/5\)/i);
    // It is an info path, not an error — nothing on stderr.
    expect(r.stderr).toBe('');
  });

  it('emits a JSON info envelope with alreadyRated=true + satisfaction, exit 0', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(5));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'score' }),
        getAssessmentCard: async () => makeRatedCard(5),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(0);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stdout) as {
      ticketId: string;
      alreadyRated: boolean;
      satisfaction: number;
    };
    expect(payload.ticketId).toBe('TICKET-130000001');
    expect(payload.alreadyRated).toBe(true);
    expect(payload.satisfaction).toBe(5);
  });

  it('reports the actual prior satisfaction score (3) in the info line', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(3));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'score' }),
        getAssessmentCard: async () => makeRatedCard(3),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '5',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(0);
    const payload = JSON.parse(r.stdout) as { satisfaction: number };
    expect(payload.satisfaction).toBe(3);
    expect(rateSpy).not.toHaveBeenCalled();
  });
});

describe('support rate — not-awaiting-rating guard (BUG-1)', () => {
  it('rejects a not-yet-closed ticket (no card) with exit 4 and "not awaiting rating"', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'dealing' }),
        getAssessmentCard: async () => makeNoCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
    expect(payload.error.message).toMatch(/not awaiting rating/i);
    expect(payload.error.message).toMatch(/TICKET-130000001/);
  });
});

describe('support rate — ticket-not-found precedes card classification (BUG-1)', () => {
  it('keeps the getTicket not-found guard ahead of getAssessmentCard', async () => {
    const cardSpy = vi.fn(async () => makeNoCard());
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => ({ id: '', title: '', status: '', createdAt: 0 }),
        getAssessmentCard: cardSpy,
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-FAKE',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBe(4);
    expect(rateSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(r.stderr) as { error: { code?: string; message?: string } };
    expect(payload.error.message).toMatch(/not found/i);
  });
});

describe('support rate — editable card proceeds to submission (BUG-1)', () => {
  it('submits normally when the card is editable (rateTicket called with rating)', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'wait_score' }),
        getAssessmentCard: async () => makeCard({ editable: true, alreadyRated: false }),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy.mock.calls[0][1]).toBe(4);
  });
});

describe('support rate — comment boundary', () => {
  it('truncates --comment longer than 500 characters and emits a warning', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    holder.client = makeMockApiClient({
      supportService: {
        getTicket: async () => makeTicketDetail(),
        getAssessmentCard: async () => makeCard(),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>);

    const longComment = 'A'.repeat(750);

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--rating',
      '4',
      '--comment',
      longComment,
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    const passedComment = rateSpy.mock.calls[0][2] as string;
    expect(passedComment).toBeDefined();
    expect(passedComment.length).toBe(500);
    // The truncation warning must surface on stderr (advisory channel).
    expect(r.stderr).toMatch(/exceeds 500 characters/i);
  });
});

// ── BUG-2: interactive comment via raw-mode editor (multilineInput) ───────
//
// In full interactive mode (no --rating, no --comment) the comment is read
// through the raw-mode TextArea editor (multilineInput), not canonical
// readline. The editor returns the COMPLETE text, so the command-layer
// slice(0, 500) finally takes effect on over-long input.
//
// Mock boundary: the comment editor is driven via the scripted
// renderInteractive mock (interactiveHolder.comment). The truncation logic
// under test lives in the command and is NOT mocked.

describe('support rate — interactive comment truncation (BUG-2)', () => {
  function ratableClient(rateSpy: ReturnType<typeof vi.fn>): Partial<ApiClient> {
    return {
      supportService: {
        getTicket: async () => makeTicketDetail({ status: 'wait_score' }),
        getAssessmentCard: async () => makeCard({ editable: true, alreadyRated: false }),
        rateTicket: rateSpy,
      },
    } as unknown as Partial<ApiClient>;
  }

  it('truncates an over-500-char interactive comment to exactly 500 and warns on stderr', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    interactiveHolder.rating = 4;
    interactiveHolder.comment = '字'.repeat(800); // 800 JS code units (CJK) → must clip to 500
    holder.client = makeMockApiClient(ratableClient(rateSpy));

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    const passedComment = rateSpy.mock.calls[0][2] as string;
    expect(passedComment).toBeDefined();
    expect(passedComment.length).toBe(500);
    // The advisory truncation warning must go to stderr (advisory channel).
    expect(r.stderr).toMatch(/exceeds 500 characters/i);
  });

  it('does not warn and forwards the full comment when interactive input is within 500', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    interactiveHolder.rating = 4;
    interactiveHolder.comment = 'Resolved quickly, thank you.';
    holder.client = makeMockApiClient(ratableClient(rateSpy));

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy.mock.calls[0][2]).toBe('Resolved quickly, thank you.');
    expect(r.stderr).not.toMatch(/exceeds 500 characters/i);
  });

  it('treats empty interactive comment input as no comment (undefined)', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    interactiveHolder.rating = 4;
    interactiveHolder.comment = '';
    holder.client = makeMockApiClient(ratableClient(rateSpy));

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy.mock.calls[0][2]).toBeUndefined();
  });

  it('treats a cancelled comment editor as no comment (undefined)', async () => {
    const rateSpy = vi.fn(async () => makeRateResponse(4));
    interactiveHolder.rating = 4;
    interactiveHolder.commentCancelled = true;
    holder.client = makeMockApiClient(ratableClient(rateSpy));

    const r = await runCommand(buildSupportRate, [
      'support',
      'rate',
      'TICKET-130000001',
      '--format',
      'json',
    ]);

    expect(r.exitCode).toBeUndefined();
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy.mock.calls[0][2]).toBeUndefined();
  });
});

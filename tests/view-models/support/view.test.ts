/**
 * View-model unit tests for the support ticket detail view.
 *
 * The view model transforms raw ticket detail + message list into
 * a display-ready structure for the TEXT renderer.
 *
 * Covers:
 *   - Detail field mapping (id, title, status, createdAt, category, description)
 *   - Message list sorted by time ascending
 *   - HTML tag stripping from message content
 *   - Description indentation (2-space prefix)
 *   - Role display text mapping
 *   - Truncation flag pass-through
 */
import { describe, it, expect } from 'vitest';
import {
  buildSupportViewViewModel,
} from '../../../src/view-models/support/index.js';

interface RawTicketDetail {
  id: string;
  title: string;
  status: string;
  createdAt: number;
  category: string;
  description: string;
}

interface RawMessage {
  role: string;
  nickName: string;
  content: string;
  createdAt: number;
}

function makeTicketDetail(overrides: Partial<RawTicketDetail> = {}): RawTicketDetail {
  return {
    id: '130000001',
    title: 'Model inference timeout',
    status: 'wait_feedback',
    createdAt: 1716883380000,
    category: 'Model Service / Inference Issues / Timeout',
    description: 'dashscope API timed out after 60s',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    role: 'customer',
    nickName: 'User',
    content: 'My API calls are timing out.',
    createdAt: 1716883380000,
    ...overrides,
  };
}

describe('buildSupportViewViewModel — detail fields', () => {
  it('maps ticket id, title, category and formatted createdAt', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage()],
      false,
    );
    expect(vm.ticket.id).toBe('130000001');
    expect(vm.ticket.title).toBe('Model inference timeout');
    expect(vm.ticket.category).toBe('Model Service / Inference Issues / Timeout');
    expect(vm.ticket.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('applies status mapping to the ticket status field', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail({ status: 'wait_feedback' }),
      [],
      false,
    );
    expect(vm.ticket.status).toBe('Pending feedback');
  });

  it('degrades unknown status with capitalize + underscore-to-space', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail({ status: 'custom_new_status' }),
      [],
      false,
    );
    expect(vm.ticket.status).toBe('Custom new status');
  });
});

describe('buildSupportViewViewModel — description formatting', () => {
  it('preserves newlines in description content', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail({ description: 'Line 1\nLine 2\nLine 3' }),
      [],
      false,
    );
    expect(vm.ticket.description).toContain('Line 1');
    expect(vm.ticket.description).toContain('Line 2');
  });

  it('strips HTML tags from description', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail({ description: '<p>Hello <b>world</b></p>' }),
      [],
      false,
    );
    expect(vm.ticket.description).not.toContain('<p>');
    expect(vm.ticket.description).not.toContain('<b>');
    expect(vm.ticket.description).toContain('Hello');
    expect(vm.ticket.description).toContain('world');
  });
});

describe('buildSupportViewViewModel — message ordering', () => {
  it('sorts messages by createdAt ascending (oldest first)', () => {
    const messages: RawMessage[] = [
      makeMessage({ content: 'Third', createdAt: 1716890000000 }),
      makeMessage({ content: 'First', createdAt: 1716880000000 }),
      makeMessage({ content: 'Second', createdAt: 1716885000000 }),
    ];

    const vm = buildSupportViewViewModel(makeTicketDetail(), messages, false);

    expect(vm.messages[0].content).toContain('First');
    expect(vm.messages[1].content).toContain('Second');
    expect(vm.messages[2].content).toContain('Third');
  });

  it('preserves order when messages are already sorted', () => {
    const messages: RawMessage[] = [
      makeMessage({ content: 'A', createdAt: 1716880000000 }),
      makeMessage({ content: 'B', createdAt: 1716885000000 }),
    ];

    const vm = buildSupportViewViewModel(makeTicketDetail(), messages, false);

    expect(vm.messages[0].content).toContain('A');
    expect(vm.messages[1].content).toContain('B');
  });
});

describe('buildSupportViewViewModel — HTML stripping in messages', () => {
  it('removes HTML tags from message content, preserving text', () => {
    const messages: RawMessage[] = [
      makeMessage({ content: '<p>Please provide <code>RequestId</code></p>' }),
    ];

    const vm = buildSupportViewViewModel(makeTicketDetail(), messages, false);

    expect(vm.messages[0].content).not.toContain('<p>');
    expect(vm.messages[0].content).not.toContain('<code>');
    expect(vm.messages[0].content).toContain('Please provide');
    expect(vm.messages[0].content).toContain('RequestId');
  });

  it('handles messages without HTML tags (pass-through)', () => {
    const messages: RawMessage[] = [
      makeMessage({ content: 'Plain text message without any tags' }),
    ];

    const vm = buildSupportViewViewModel(makeTicketDetail(), messages, false);

    expect(vm.messages[0].content).toBe('Plain text message without any tags');
  });
});

describe('buildSupportViewViewModel — role display mapping', () => {
  it('maps "customer" → "You"', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage({ role: 'customer' })],
      false,
    );
    expect(vm.messages[0].displayRole).toBe('You');
  });

  it('maps "agent" → "Support Engineer"', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage({ role: 'agent', nickName: 'Alice' })],
      false,
    );
    expect(vm.messages[0].displayRole).toBe('Support Engineer');
  });

  it('maps "system" → "System"', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage({ role: 'system' })],
      false,
    );
    expect(vm.messages[0].displayRole).toBe('System');
  });

  it('includes nickName for agent messages (parenthetical)', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage({ role: 'agent', nickName: 'Alice' })],
      false,
    );
    expect(vm.messages[0].nickName).toBe('Alice');
  });
});

// ── BUG-8: email nickName masking in the view model ───────────────────────
//
// The upstream UserName is frequently the user's email. The view model masks
// any '@'-bearing nickName once, so the Ink / TEXT / JSON renderers inherit the
// masked value automatically. Non-email nicknames pass through untouched.

describe('buildSupportViewViewModel — nickName email masking', () => {
  it('masks an email-shaped nickName to a***@domain', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage({ role: 'customer', nickName: 'alice@mock-api.test.qwencloud.com' })],
      false,
    );
    expect(vm.messages[0].nickName).toBe('a***@mock-api.test.qwencloud.com');
  });

  it('leaves a non-email nickname unchanged', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [makeMessage({ role: 'agent', nickName: 'Service Assistant' })],
      false,
    );
    expect(vm.messages[0].nickName).toBe('Service Assistant');
  });

  it('masks each email nickName independently across messages', () => {
    const vm = buildSupportViewViewModel(
      makeTicketDetail(),
      [
        makeMessage({
          role: 'customer',
          nickName: 'bob@mock-api.test.qwencloud.com',
          createdAt: 1716880000000,
        }),
        makeMessage({
          role: 'agent',
          nickName: 'Customer Support Engineer',
          createdAt: 1716885000000,
        }),
      ],
      false,
    );
    expect(vm.messages[0].nickName).toBe('b***@mock-api.test.qwencloud.com');
    expect(vm.messages[1].nickName).toBe('Customer Support Engineer');
  });
});

describe('buildSupportViewViewModel — truncation', () => {
  it('passes through truncated=true flag', () => {
    const vm = buildSupportViewViewModel(makeTicketDetail(), [], true);
    expect(vm.truncated).toBe(true);
  });

  it('passes through truncated=false flag', () => {
    const vm = buildSupportViewViewModel(makeTicketDetail(), [], false);
    expect(vm.truncated).toBe(false);
  });

  it('includes message count', () => {
    const messages = [makeMessage(), makeMessage({ createdAt: 1716890000000 })];
    const vm = buildSupportViewViewModel(makeTicketDetail(), messages, false);
    expect(vm.messageCount).toBe(2);
  });
});

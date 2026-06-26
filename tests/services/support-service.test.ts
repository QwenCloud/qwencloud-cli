/**
 * Unit tests for SupportService.
 *
 * Covers three read-only APIs exposed via Type A protocol (product=Workorder):
 *   - listTickets({ page, pageSize, siteTag })  — server-side pagination
 *   - getTicket(ticketId)                       — not-found detection
 *   - listMessages(ticketId)
 *
 * The listTickets contract is server-side pagination: the service passes
 * page and pageSize directly to the API and returns the response as-is.
 * `total` is taken from the server response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';
import type { RawTicketItem } from '../../src/types/support.js';

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

/** Build a raw server ticket item with deterministic field values. */
function rawTicket(vid: string, title: string): RawTicketItem {
  return {
    vid,
    title,
    statTicketBiz: 'dealing',
    createTime: 1716883380000,
  };
}

const { SupportService, deriveSchemaText } = await import('../../src/services/support-service.js');

describe('SupportService.listTickets — server-side pagination', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('passes page and pageSize directly to the API', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { DataInfo: [], Total: 0 },
      Message: 'successful',
      Code: 0,
      Success: true,
    });

    await service.listTickets({ page: 3, pageSize: 5, siteTag: 'maas' });

    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(1);
    const options = apiClient.callFlatApi.mock.calls[0][0] as {
      product: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(options.product).toBe('Workorder');
    expect(options.action).toBe('ListTickets');
    expect(options.params.Page).toBe(3);
    expect(options.params.PageSize).toBe(5);
  });

  it('returns tickets from the server response directly', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataInfo: [
          rawTicket('130000001', 'Ticket A'),
          rawTicket('130000002', 'Ticket B'),
        ],
        Total: 20,
      },
      Message: 'successful',
      Code: 0,
      Success: true,
    });

    const result = await service.listTickets({ page: 1, pageSize: 2, siteTag: 'maas' });

    expect(result.tickets).toHaveLength(2);
    expect(result.tickets[0].id).toBe('130000001');
    expect(result.tickets[1].id).toBe('130000002');
    expect(result.total).toBe(20);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
  });

  it('returns empty tickets when the server returns empty DataInfo for an out-of-range page', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataInfo: [],
        Total: 3,
      },
      Message: 'successful',
      Code: 0,
      Success: true,
    });

    const result = await service.listTickets({ page: 5, pageSize: 10, siteTag: 'maas' });

    expect(result.tickets).toEqual([]);
    expect(result.total).toBe(3);
  });

  it('normalizes each sliced ticket into a SupportTicket domain object', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataInfo: [
          {
            vid: '130000001',
            title: 'Model inference timeout',
            statTicketBiz: 'wait_feedback',
            createTime: 1716883380000,
          },
          {
            vid: '130000002',
            title: 'Billing inquiry',
            statTicketBiz: 'confirmed',
            createTime: 1716800000000,
          },
        ],
        Total: 2,
      },
      Message: 'successful',
      Code: 0,
      Success: true,
    });

    const result = await service.listTickets({ page: 1, pageSize: 10, siteTag: 'maas' });

    expect(result.total).toBe(2);
    expect(result.tickets).toHaveLength(2);
    expect(result.tickets[0].id).toBe('130000001');
    expect(result.tickets[0].title).toBe('Model inference timeout');
    expect(result.tickets[0].status).toBe('wait_feedback');
    expect(result.tickets[0].createdAt).toBe(1716883380000);
  });

  it('returns empty tickets and total 0 when the server reports no tickets', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { DataInfo: [], Total: 0 },
      Message: 'successful',
      Code: 0,
      Success: true,
    });

    const result = await service.listTickets({ page: 1, pageSize: 10, siteTag: 'maas' });

    expect(result.total).toBe(0);
    expect(result.tickets).toEqual([]);
  });

  it('propagates API errors thrown by callFlatApi', async () => {
    apiClient.callFlatApi.mockRejectedValue(
      Object.assign(new Error('upstream 502'), { name: 'GatewayEnvelopeError' }),
    );

    await expect(
      service.listTickets({ page: 1, pageSize: 10, siteTag: 'maas' }),
    ).rejects.toMatchObject({ name: 'GatewayEnvelopeError' });
  });
});

describe('SupportService.getTicket', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=GetTicket', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        values: {
          vid: '130000001',
          title: 'Test ticket',
          status: { value: 'dealing' },
          gmt_create: 1716883380000,
          description: 'Some description',
          category: 'Model Service / Inference',
        },
      },
    });

    await service.getTicket('130000001');

    const options = apiClient.callFlatApi.mock.calls[0][0] as {
      product: string;
      action: string;
    };
    expect(options.product).toBe('Workorder');
    expect(options.action).toBe('GetTicket');
  });

  it('forwards TicketId and Region=7 in params', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        values: {
          vid: '130000001',
          title: 'Test ticket',
          status: { value: 'dealing' },
          gmt_create: 1716883380000,
          description: '',
          category: '',
        },
      },
    });

    await service.getTicket('130000001');

    const options = apiClient.callFlatApi.mock.calls[0][0] as {
      params: Record<string, unknown>;
    };
    expect(options.params.TicketId).toBe('130000001');
    expect(options.params.Region).toBe('7');
  });

  it('normalizes a GetTicket response with values into SupportTicketDetail', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        values: {
          vid: '130000001',
          title: 'Inference timeout investigation',
          status: { value: 'wait_feedback' },
          gmt_create: 1716883380000,
          description: '<p>dashscope API timed out after 60s</p>',
          category: 'Model Service / Inference Issues / Timeout',
        },
      },
    });

    const result = await service.getTicket('130000001');

    expect(result.id).toBe('130000001');
    expect(result.title).toBe('Inference timeout investigation');
    expect(result.status).toBe('wait_feedback');
    expect(result.createdAt).toBe(1716883380000);
    expect(result.description).toBeDefined();
    expect(result.category).toBe('Model Service / Inference Issues / Timeout');
  });

  it('throws NOT_FOUND when the response has no Data object', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Message: 'successful',
      Code: 0,
      Success: true,
    });

    await expect(service.getTicket('999999999')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND when Data has no parseable ticket values', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {},
    });

    await expect(service.getTicket('999999999')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND when values is present but carries no vid or status', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { values: {} },
    });

    await expect(service.getTicket('999999999')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('propagates upstream errors thrown by callFlatApi', async () => {
    apiClient.callFlatApi.mockRejectedValue(
      Object.assign(new Error('您无权查看该工单'), {
        name: 'GatewayBusinessError',
        code: '401',
      }),
    );

    await expect(service.getTicket('999999999')).rejects.toMatchObject({
      name: 'GatewayBusinessError',
      code: '401',
    });
  });
});

describe('SupportService.listMessages', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=ListEnhancedMessage', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { dataList: [] },
    });

    await service.listMessages('130000001');

    const options = apiClient.callFlatApi.mock.calls[0][0] as {
      product: string;
      action: string;
    };
    expect(options.product).toBe('Workorder');
    expect(options.action).toBe('ListEnhancedMessage');
  });

  it('forwards TicketId and PageLimit=100 in params', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { dataList: [] },
    });

    await service.listMessages('130000001');

    const options = apiClient.callFlatApi.mock.calls[0][0] as {
      params: Record<string, unknown>;
    };
    expect(options.params.TicketId).toBe('130000001');
    expect(options.params.PageLimit).toBe(100);
  });

  it('normalizes message list into SupportMessage array', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        dataList: [
          {
            userInfo: { role: 'customer', nickName: 'User' },
            dataInfo: { content: '<p>My API calls timeout</p>' },
            gmtCreate: 1716883380000,
          },
          {
            userInfo: { role: 'agent', nickName: 'Alice' },
            dataInfo: { content: 'Please provide the RequestId' },
            gmtCreate: 1716886980000,
          },
        ],
      },
    });

    const result = await service.listMessages('130000001');

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('customer');
    expect(result.messages[0].content).toBeDefined();
    expect(result.messages[0].createdAt).toBe(1716883380000);
    expect(result.messages[1].role).toBe('agent');
    expect(result.messages[1].nickName).toBe('Alice');
  });

  it('derives system message content from DataInfo.Schema when Content is absent', async () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: {
        turnToAritificial: {
          'x-component': 'TurnToAritificial',
          'x-component-props': {
            title: 'We have assigned an engineer to you',
            desc: 'Our engineer will reply as soon as possible.',
          },
        },
      },
    });
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        dataList: [
          {
            UserInfo: { Role: 1, UserName: 'Service Assistant' },
            DataInfo: { Schema: schema },
            CreateTime: 1716883380000,
          },
        ],
      },
    });

    const result = await service.listMessages('130000001');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('We have assigned an engineer to you');
    expect(result.messages[0].content).toContain('Our engineer will reply as soon as possible.');
  });

  it('keeps Content verbatim for normal messages (does not derive from schema)', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        dataList: [
          {
            UserInfo: { Role: 2, UserName: 'Agent' },
            DataInfo: {
              Content: 'Hello',
              Schema: '{"properties":{"x":{"x-component-props":{"title":"ignored"}}}}',
            },
            CreateTime: 1,
          },
        ],
      },
    });

    const result = await service.listMessages('130000001');

    expect(result.messages[0].content).toBe('Hello');
  });

  it('returns empty messages array when dataList is empty', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { dataList: [] },
    });

    const result = await service.listMessages('130000001');

    expect(result.messages).toEqual([]);
  });

  it('handles 100-message limit response (full page)', async () => {
    const hundredMessages = Array.from({ length: 100 }, (_, i) => ({
      userInfo: { role: 'customer', nickName: 'User' },
      dataInfo: { content: `Message ${i + 1}` },
      gmtCreate: 1716883380000 + i * 60000,
    }));

    apiClient.callFlatApi.mockResolvedValue({
      Data: { dataList: hundredMessages },
    });

    const result = await service.listMessages('130000001');

    expect(result.messages).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('marks truncated=false when message count is below 100', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        dataList: [
          {
            userInfo: { role: 'customer', nickName: 'User' },
            dataInfo: { content: 'Hello' },
            gmtCreate: 1716883380000,
          },
        ],
      },
    });

    const result = await service.listMessages('130000001');

    expect(result.messages).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });
});

describe('deriveSchemaText', () => {
  it('collects title + desc from x-component-props', () => {
    const schema = JSON.stringify({
      properties: { a: { 'x-component-props': { title: 'T', desc: 'D' } } },
    });
    expect(deriveSchemaText(schema)).toBe('T\nD');
  });

  it('returns empty string for undefined / empty / non-string input', () => {
    expect(deriveSchemaText(undefined)).toBe('');
    expect(deriveSchemaText('')).toBe('');
    expect(deriveSchemaText('   ')).toBe('');
    expect(deriveSchemaText(123)).toBe('');
  });

  it('returns empty string for unparseable JSON', () => {
    expect(deriveSchemaText('{not valid json')).toBe('');
  });

  it('returns empty string when no x-component-props title/desc present', () => {
    const schema = JSON.stringify({ properties: { a: { 'x-component': 'Other' } } });
    expect(deriveSchemaText(schema)).toBe('');
  });

  it('joins title/desc across multiple properties', () => {
    const schema = JSON.stringify({
      properties: {
        a: { 'x-component-props': { title: 'T1' } },
        b: { 'x-component-props': { desc: 'D2' } },
      },
    });
    expect(deriveSchemaText(schema)).toBe('T1\nD2');
  });
});

/**
 * Unit tests for SupportService write operations, mapTicketStatus,
 * and edge-case branches not covered in the read-only test file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/api-client.js';

interface MockApiClient {
  callFlatApi: ReturnType<typeof vi.fn>;
}

function makeMockApiClient(): MockApiClient {
  return { callFlatApi: vi.fn() };
}

const { SupportService, mapTicketStatus } = await import('../../src/services/support-service.js');

// ─────────────────────────────────────────────────────────────────────────
// mapTicketStatus
// ─────────────────────────────────────────────────────────────────────────

describe('mapTicketStatus', () => {
  it('maps known statuses to their display labels', () => {
    expect(mapTicketStatus('wait_assign')).toBe('Pending assignment');
    expect(mapTicketStatus('assigned')).toBe('Assigned');
    expect(mapTicketStatus('dealing')).toBe('Processing');
    expect(mapTicketStatus('wait_feedback')).toBe('Pending feedback');
    expect(mapTicketStatus('feedback')).toBe('Pending feedback');
    expect(mapTicketStatus('wait_confirm')).toBe('Pending confirmation');
    expect(mapTicketStatus('wait_score')).toBe('Pending rating');
    expect(mapTicketStatus('confirmed')).toBe('Closed');
    expect(mapTicketStatus('score')).toBe('Closed');
    expect(mapTicketStatus('robot_dealing')).toBe('Processing');
    expect(mapTicketStatus('robot_waiting_confirmation')).toBe('Pending confirmation');
    expect(mapTicketStatus('robot_processing')).toBe('Processing');
  });

  it('returns "Unknown" for empty string', () => {
    expect(mapTicketStatus('')).toBe('Unknown');
  });

  it('capitalizes and replaces underscores for unmapped statuses', () => {
    expect(mapTicketStatus('new_custom_status')).toBe('New custom status');
  });

  it('capitalizes single-word unmapped status', () => {
    expect(mapTicketStatus('escalated')).toBe('Escalated');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listTickets — boundary / edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.listTickets — boundary cases', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('clamps page to minimum 1 when negative value provided', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: { DataInfo: [], Total: 0 } });
    const result = await service.listTickets({ page: -5, pageSize: 10 });
    expect(result.page).toBe(1);
  });

  it('clamps pageSize to maximum 10', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: { DataInfo: [], Total: 0 } });
    const result = await service.listTickets({ page: 1, pageSize: 500 });
    expect(result.pageSize).toBe(10);
  });

  it('clamps pageSize to minimum 1 when zero provided', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: { DataInfo: [], Total: 0 } });
    const result = await service.listTickets({ page: 1, pageSize: 0 });
    expect(result.pageSize).toBe(1);
  });

  it('handles missing DataInfo gracefully', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: {} });
    const result = await service.listTickets({ page: 1, pageSize: 10 });
    expect(result.tickets).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('handles null Data gracefully', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    const result = await service.listTickets({ page: 1, pageSize: 10 });
    expect(result.tickets).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('defaults to site siteTag when siteTag option is omitted', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: { DataInfo: [], Total: 0 } });
    await service.listTickets({ page: 1, pageSize: 10 });
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(opts.params.IndependentSiteTag).toBe('maas');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getTicket — edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.getTicket — edge cases', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('throws NOT_FOUND when Data carries no parseable ticket values', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: {} });
    await expect(service.getTicket('130000001')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reads Values from capital-case Data.Values field', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        Values: {
          vid: 'T-001',
          title: 'Capital casing',
          status: { value: 'dealing' },
          gmt_create: 1700000000000,
          description: 'test',
          category: 'Billing',
        },
      },
    });
    const result = await service.getTicket('T-001');
    expect(result.title).toBe('Capital casing');
    expect(result.category).toBe('Billing');
  });

  it('falls back to status.label when status.value is empty', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        values: {
          vid: 'T-002',
          title: 'Label test',
          status: { value: '', label: 'In Review' },
          gmt_create: 1700000000000,
        },
      },
    });
    const result = await service.getTicket('T-002');
    expect(result.status).toBe('In Review');
  });

  it('uses process_stage.label as category fallback', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        values: {
          vid: 'T-003',
          title: 'Stage test',
          status: { value: 'dealing' },
          gmt_create: 1700000000000,
          process_stage: { label: 'Model Access' },
        },
      },
    });
    const result = await service.getTicket('T-003');
    expect(result.category).toBe('Model Access');
  });

  it('uses GmtCreate (capital) as createdAt fallback', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        values: {
          vid: 'T-004',
          title: 'GmtCreate test',
          status: { value: 'confirmed' },
          GmtCreate: 1716883380000,
        },
      },
    });
    const result = await service.getTicket('T-004');
    expect(result.createdAt).toBe(1716883380000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listMessages — role normalization edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.listMessages — role normalization', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('normalizes numeric role 1 to "system"', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataList: [{ UserInfo: { Role: 1, NickName: 'Bot' }, DataInfo: { Content: 'Hello' }, CreateTime: 1000 }],
      },
    });
    const result = await service.listMessages('T-001');
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].nickName).toBe('Bot');
    expect(result.messages[0].content).toBe('Hello');
  });

  it('normalizes numeric role 2 to "agent"', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataList: [{ UserInfo: { Role: 2, UserName: 'Alice' }, DataInfo: { Content: 'Hi' }, CreateTime: 2000 }],
      },
    });
    const result = await service.listMessages('T-001');
    expect(result.messages[0].role).toBe('agent');
    expect(result.messages[0].nickName).toBe('Alice');
  });

  it('normalizes numeric role 3 to "customer"', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataList: [{ UserInfo: { Role: 3 }, DataInfo: { Content: 'Help' }, CreateTime: 3000 }],
      },
    });
    const result = await service.listMessages('T-001');
    expect(result.messages[0].role).toBe('customer');
  });

  it('converts unknown numeric role to string', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        DataList: [{ UserInfo: { Role: 99 }, DataInfo: { Content: 'test' }, CreateTime: 4000 }],
      },
    });
    const result = await service.listMessages('T-001');
    expect(result.messages[0].role).toBe('99');
  });

  it('returns empty string for missing role', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { DataList: [{ UserInfo: {}, DataInfo: { Content: 'x' }, CreateTime: 5000 }] },
    });
    const result = await service.listMessages('T-001');
    expect(result.messages[0].role).toBe('');
  });

  it('handles missing DataList/dataList as empty messages', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: {} });
    const result = await service.listMessages('T-001');
    expect(result.messages).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('uses Timestamp as createdAt fallback when other fields are missing', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: {
        dataList: [{ userInfo: { role: 'customer' }, dataInfo: { content: 'msg' }, Timestamp: 9999 }],
      },
    });
    const result = await service.listMessages('T-001');
    expect(result.messages[0].createdAt).toBe(9999);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getTicketDetail — concurrent fetch
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.getTicketDetail', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('fetches ticket detail and messages concurrently', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce({
        Data: { values: { vid: 'T-010', title: 'Concurrent', status: { value: 'dealing' }, gmt_create: 1000 } },
      })
      .mockResolvedValueOnce({
        Data: { dataList: [{ userInfo: { role: 'agent' }, dataInfo: { content: 'Reply' }, gmtCreate: 2000 }] },
      });

    const result = await service.getTicketDetail('T-010');
    expect(result.detail.id).toBe('T-010');
    expect(result.messages.messages).toHaveLength(1);
    expect(result.messages.messages[0].content).toBe('Reply');
    expect(apiClient.callFlatApi).toHaveBeenCalledTimes(2);
  });

  it('propagates errors from either concurrent call', async () => {
    apiClient.callFlatApi
      .mockResolvedValueOnce({ Data: { values: { vid: 'X', title: '', status: {} } } })
      .mockRejectedValueOnce(new Error('Network error'));

    await expect(service.getTicketDetail('X')).rejects.toThrow('Network error');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getCategoryTree
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.getCategoryTree', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=GetCategoryTreeByProductCodes', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    await service.getCategoryTree();
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { product: string; action: string };
    expect(opts.product).toBe('Workorder');
    expect(opts.action).toBe('GetCategoryTreeByProductCodes');
  });

  it('normalizes array Data response with nested children', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: [
        { id: '1', name: 'Model Service', children: [{ id: '1-1', name: 'Inference' }] },
        { id: '2', name: 'Billing' },
      ],
    });
    const result = await service.getCategoryTree();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[0].name).toBe('Model Service');
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].id).toBe('1-1');
    expect(result[1].children).toBeUndefined();
  });

  it('handles Data as object with List field', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { List: [{ Id: 100, Name: 'Support', SubCategoryList: [{ CategoryId: 200, CategoryName: 'Billing' }] }] },
    });
    const result = await service.getCategoryTree();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('100');
    expect(result[0].name).toBe('Support');
    expect(result[0].children![0].id).toBe('200');
    expect(result[0].children![0].name).toBe('Billing');
  });

  it('handles Data as object with list (lowercase) field', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { list: [{ categoryId: 'cat-1', categoryName: 'General' }] },
    });
    const result = await service.getCategoryTree();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cat-1');
    expect(result[0].name).toBe('General');
  });

  it('returns empty array for empty Data', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: {} });
    const result = await service.getCategoryTree();
    expect(result).toEqual([]);
  });

  it('returns empty array for null Data', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    const result = await service.getCategoryTree();
    expect(result).toEqual([]);
  });

  it('stringifies numeric category IDs', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: [{ id: 12345, name: 'Numeric ID' }],
    });
    const result = await service.getCategoryTree();
    expect(result[0].id).toBe('12345');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// suggestCategory
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.suggestCategory', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=SuggestCategoryNew', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    await service.suggestCategory('my API key does not work');
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { product: string; action: string; params: Record<string, unknown> };
    expect(opts.product).toBe('Workorder');
    expect(opts.action).toBe('SuggestCategoryNew');
    expect(opts.params.Content).toBe('my API key does not work');
  });

  it('normalizes array Data response into CategorySuggestion[]', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: [
        { categoryId: '10', categoryName: 'Model Inference', categoryPath: 'Model > Inference', score: 0.95 },
        { categoryId: '20', categoryName: 'Billing', categoryPath: 'Account > Billing', score: 0.8 },
      ],
    });
    const result = await service.suggestCategory('timeout issue');
    expect(result).toHaveLength(2);
    expect(result[0].categoryId).toBe('10');
    expect(result[0].categoryName).toBe('Model Inference');
    expect(result[0].categoryPath).toBe('Model > Inference');
    expect(result[0].score).toBe(0.95);
  });

  it('handles object Data with Suggestions field', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { Suggestions: [{ CategoryId: 5, CategoryName: 'Accounts', CategoryPath: 'General > Accounts' }] },
    });
    const result = await service.suggestCategory('account issue');
    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe('5');
    expect(result[0].categoryName).toBe('Accounts');
  });

  it('slices to maximum 5 suggestions', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      categoryId: String(i),
      categoryName: `Cat ${i}`,
      categoryPath: `Path ${i}`,
      score: 0.9 - i * 0.05,
    }));
    apiClient.callFlatApi.mockResolvedValue({ Data: items });
    const result = await service.suggestCategory('generic');
    expect(result).toHaveLength(5);
  });

  it('returns empty array when Data is empty/missing', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    const result = await service.suggestCategory('anything');
    expect(result).toEqual([]);
  });

  it('uses Path as fallback for categoryPath', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: [{ categoryId: '1', categoryName: 'X', Path: 'A > B' }],
    });
    const result = await service.suggestCategory('test');
    expect(result[0].categoryPath).toBe('A > B');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createTicket
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.createTicket', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=CreateTicketNew', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: 'VID-001' });
    await service.createTicket({ categoryId: '10', description: 'My issue' });
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { product: string; action: string; params: Record<string, unknown> };
    expect(opts.product).toBe('Workorder');
    expect(opts.action).toBe('CreateTicketNew');
    expect(opts.params.CategoryId).toBe('10');
    expect(opts.params.Description).toBe('My issue');
    expect(opts.params.Severity).toBe('1');
  });

  it('returns vid from string Data response', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: 'VID-123' });
    const result = await service.createTicket({ categoryId: '10', description: 'desc' });
    expect(result.vid).toBe('VID-123');
  });

  it('returns vid from object Data response with vid field', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: { vid: 'VID-456' } });
    const result = await service.createTicket({ categoryId: '20', description: 'test' });
    expect(result.vid).toBe('VID-456');
  });

  it('returns vid from object Data response with Vid field', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: { Vid: 'VID-789' } });
    const result = await service.createTicket({ categoryId: '30', description: 'test' });
    expect(result.vid).toBe('VID-789');
  });

  it('returns empty vid when Data is missing', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    const result = await service.createTicket({ categoryId: '1', description: 'test' });
    expect(result.vid).toBe('');
  });

  it('propagates API errors', async () => {
    apiClient.callFlatApi.mockRejectedValue(new Error('rate limit exceeded'));
    await expect(service.createTicket({ categoryId: '1', description: 'test' })).rejects.toThrow('rate limit exceeded');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createMessage
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.createMessage', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=CreateMessage', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    await service.createMessage('T-001', 'Here is more info');
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { product: string; action: string; params: Record<string, unknown> };
    expect(opts.product).toBe('Workorder');
    expect(opts.action).toBe('CreateMessage');
    expect(opts.params.TicketId).toBe('T-001');
    expect(opts.params.Content).toBe('Here is more info');
  });

  it('propagates API errors', async () => {
    apiClient.callFlatApi.mockRejectedValue(new Error('server error'));
    await expect(service.createMessage('T-001', 'msg')).rejects.toThrow('server error');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// identifyRiskWord
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.identifyRiskWord', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=IdentifyCustomerWord', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: false });
    await service.identifyRiskWord('T-001', 'safe text');
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { product: string; action: string; params: Record<string, unknown> };
    expect(opts.product).toBe('Workorder');
    expect(opts.action).toBe('IdentifyCustomerWord');
    expect(opts.params.TicketId).toBe('T-001');
    expect(opts.params.Content).toBe('safe text');
  });

  it('handles boolean Data=true as hasRisk=true', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: true });
    const result = await service.identifyRiskWord('T-001', 'risky text');
    expect(result.hasRisk).toBe(true);
  });

  it('handles boolean Data=false as hasRisk=false', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: false });
    const result = await service.identifyRiskWord('T-001', 'safe text');
    expect(result.hasRisk).toBe(false);
  });

  it('handles array Data response with risk words', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: ['badword1', 'badword2'] });
    const result = await service.identifyRiskWord('T-001', 'badword1 in text');
    expect(result.hasRisk).toBe(true);
    expect(result.words).toEqual(['badword1', 'badword2']);
  });

  it('handles empty array Data response as no risk', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: [] });
    const result = await service.identifyRiskWord('T-001', 'safe text');
    expect(result.hasRisk).toBe(false);
  });

  it('handles object Data with hasRisk and words fields', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { hasRisk: true, words: ['sensitive'] },
    });
    const result = await service.identifyRiskWord('T-001', 'sensitive info');
    expect(result.hasRisk).toBe(true);
    expect(result.words).toEqual(['sensitive']);
  });

  it('handles object Data with Hit field and RiskWords', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { Hit: true, RiskWords: ['forbidden'] },
    });
    const result = await service.identifyRiskWord('T-001', 'forbidden content');
    expect(result.hasRisk).toBe(true);
    expect(result.words).toEqual(['forbidden']);
  });

  it('infers hasRisk from non-empty Words array when hasRisk field is absent', async () => {
    apiClient.callFlatApi.mockResolvedValue({
      Data: { Words: ['warning'] },
    });
    const result = await service.identifyRiskWord('T-001', 'warning text');
    expect(result.hasRisk).toBe(true);
    expect(result.words).toEqual(['warning']);
  });

  it('returns hasRisk=false when object Data is empty', async () => {
    apiClient.callFlatApi.mockResolvedValue({ Data: {} });
    const result = await service.identifyRiskWord('T-001', 'text');
    expect(result.hasRisk).toBe(false);
  });

  it('returns hasRisk=false when Data is undefined', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    const result = await service.identifyRiskWord('T-001', 'text');
    expect(result.hasRisk).toBe(false);
  });

  it('propagates API errors', async () => {
    apiClient.callFlatApi.mockRejectedValue(new Error('timeout'));
    await expect(service.identifyRiskWord('T-001', 'text')).rejects.toThrow('timeout');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// cancelTicket
// ─────────────────────────────────────────────────────────────────────────

describe('SupportService.cancelTicket', () => {
  let apiClient: MockApiClient;
  let service: InstanceType<typeof SupportService>;

  beforeEach(() => {
    apiClient = makeMockApiClient();
    service = new SupportService(apiClient as unknown as ApiClient);
  });

  it('calls Type A with product=Workorder, action=CancelTicket', async () => {
    apiClient.callFlatApi.mockResolvedValue({});
    await service.cancelTicket('T-001');
    const opts = apiClient.callFlatApi.mock.calls[0][0] as { product: string; action: string; params: Record<string, unknown> };
    expect(opts.product).toBe('Workorder');
    expect(opts.action).toBe('CancelTicket');
    expect(opts.params.TicketId).toBe('T-001');
  });

  it('propagates API errors', async () => {
    apiClient.callFlatApi.mockRejectedValue(
      Object.assign(new Error('ticket already closed'), { name: 'GatewayBusinessError' }),
    );
    await expect(service.cancelTicket('T-001')).rejects.toMatchObject({ name: 'GatewayBusinessError' });
  });
});

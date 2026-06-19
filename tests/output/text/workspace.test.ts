import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderTextWorkspaceList,
  renderTextWorkspaceLimit,
} from '../../../src/output/text/workspace.js';
import type {
  WorkspaceListViewModel,
  WorkspaceRowViewModel,
} from '../../../src/view-models/workspace/index.js';
import type { WorkspaceLimitViewModel } from '../../../src/view-models/workspace/index.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function makeRow(overrides: Partial<WorkspaceRowViewModel> = {}): WorkspaceRowViewModel {
  return {
    id: 'ws-001',
    name: 'My Workspace',
    region: 'us-east-1',
    createdAt: '2025-01-01',
    isDefault: false,
    ...overrides,
  };
}

function makeListVm(overrides: Partial<WorkspaceListViewModel> = {}): WorkspaceListViewModel {
  return {
    rows: [makeRow()],
    total: 1,
    limit: 10,
    ...overrides,
  };
}

describe('renderTextWorkspaceList', () => {
  it('renders table headers', () => {
    renderTextWorkspaceList(makeListVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    const headerLine = calls.find((c: string) => c.includes('ID') && c.includes('Name'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('Region');
  });

  it('renders row data', () => {
    renderTextWorkspaceList(makeListVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('ws-001'))).toBe(true);
    expect(calls.some((c: string) => c.includes('My Workspace'))).toBe(true);
    expect(calls.some((c: string) => c.includes('us-east-1'))).toBe(true);
  });

  it('renders isDefault as yes/no', () => {
    renderTextWorkspaceList(makeListVm({ rows: [makeRow({ isDefault: true })] }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('yes'))).toBe(true);
  });

  it('shows workspace count and limit', () => {
    renderTextWorkspaceList(makeListVm({ total: 3, limit: 10 }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('3 workspaces'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Limit 10'))).toBe(true);
  });

  it('hides limit text when limit is 0', () => {
    renderTextWorkspaceList(makeListVm({ total: 2, limit: 0 }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('2 workspaces'))).toBe(true);
    expect(calls.every((c: string) => !c.includes('Limit'))).toBe(true);
  });

  it('renders multiple workspace rows', () => {
    const rows = [
      makeRow({ id: 'ws-a', name: 'Alpha', isDefault: true }),
      makeRow({ id: 'ws-b', name: 'Beta', isDefault: false }),
    ];
    renderTextWorkspaceList(makeListVm({ rows, total: 2 }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('ws-a'))).toBe(true);
    expect(calls.some((c: string) => c.includes('ws-b'))).toBe(true);
  });
});

describe('renderTextWorkspaceLimit', () => {
  function makeLimitVm(overrides: Partial<WorkspaceLimitViewModel> = {}): WorkspaceLimitViewModel {
    return {
      current: 3,
      max: 10,
      remaining: 7,
      utilizationPct: 30,
      ...overrides,
    };
  }

  it('renders Current and Maximum lines', () => {
    renderTextWorkspaceLimit(makeLimitVm());
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Current') && c.includes('3'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Maximum') && c.includes('10'))).toBe(true);
  });

  it('renders zero current usage', () => {
    renderTextWorkspaceLimit(makeLimitVm({ current: 0, max: 5, remaining: 5, utilizationPct: 0 }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Current') && c.includes('0'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Maximum') && c.includes('5'))).toBe(true);
  });

  it('renders fully utilized values', () => {
    renderTextWorkspaceLimit(makeLimitVm({ current: 10, max: 10, remaining: 0, utilizationPct: 100 }));
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat();
    expect(calls.some((c: string) => c.includes('Current') && c.includes('10'))).toBe(true);
    expect(calls.some((c: string) => c.includes('Maximum') && c.includes('10'))).toBe(true);
  });
});

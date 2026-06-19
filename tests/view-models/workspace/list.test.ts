import { describe, it, expect } from 'vitest';
import { buildWorkspaceListViewModel } from '../../../src/view-models/workspace/list.js';
import type { Workspace, WorkspaceListResult } from '../../../src/types/workspace.js';

function makeResult(items: Workspace[]): WorkspaceListResult {
  return { items, total: items.length, limit: 10 };
}

const fullWorkspace: Workspace = {
  id: 'ws-001',
  name: 'production',
  region: 'cn-beijing',
  createdAt: '2026-03-15T12:00:00Z',
  isDefault: true,
  tenantId: 285611,
};

describe('buildWorkspaceListViewModel', () => {
  it('renders fields correctly when all present', () => {
    const vm = buildWorkspaceListViewModel(makeResult([fullWorkspace]));
    const row = vm.rows[0];
    expect(row.name).toBe('production');
    expect(row.region).toBe('cn-beijing');
    expect(row.createdAt).toBe('2026-03-15T12:00:00Z');
    expect(row.isDefault).toBe(true);
    expect(vm.total).toBe(1);
    expect(vm.limit).toBe(10);
  });

  it('falls back to em-dash when string fields are empty', () => {
    const emptyWorkspace: Workspace = {
      id: 'ws-002',
      name: '',
      region: '',
      createdAt: '',
      isDefault: false,
      tenantId: 0,
    };
    const vm = buildWorkspaceListViewModel(makeResult([emptyWorkspace]));
    const row = vm.rows[0];
    expect(row.name).toBe('—');
    expect(row.region).toBe('—');
    expect(row.createdAt).toBe('—');
    expect(row.isDefault).toBe(false);
  });
});

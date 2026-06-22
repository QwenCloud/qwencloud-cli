import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { WorkspaceListInk } from '../../src/ui/WorkspaceList.js';
import type { WorkspaceListViewModel, WorkspaceRowViewModel } from '../../src/view-models/workspace/index.js';

function frame(el: React.ReactElement): string {
  const inst = render(el);
  const f = stripAnsi(inst.lastFrame() ?? '');
  inst.unmount();
  return f;
}

const ORIGINAL_COLUMNS = process.stdout.columns;
beforeEach(() => {
  Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
});
afterEach(() => {
  Object.defineProperty(process.stdout, 'columns', { value: ORIGINAL_COLUMNS, configurable: true });
});

function makeRow(overrides: Partial<WorkspaceRowViewModel> = {}): WorkspaceRowViewModel {
  return {
    id: 'ws-001',
    name: 'default-workspace',
    region: 'cn-hangzhou',
    createdAt: '2026-01-15',
    isDefault: true,
    ...overrides,
  };
}

function vm(overrides: Partial<WorkspaceListViewModel> = {}): WorkspaceListViewModel {
  return {
    rows: [makeRow()],
    total: 1,
    limit: 10,
    ...overrides,
  };
}

describe('WorkspaceListInk', () => {
  it('renders table headers', () => {
    const out = frame(<WorkspaceListInk vm={vm()} />);
    expect(out).toContain('ID');
    expect(out).toContain('Name');
    expect(out).toContain('Region');
    expect(out).toContain('Created');
    expect(out).toContain('Default');
  });

  it('renders workspace row data', () => {
    const out = frame(<WorkspaceListInk vm={vm()} />);
    expect(out).toContain('ws-001');
    expect(out).toContain('default-workspace');
    expect(out).toContain('cn-hangzhou');
    expect(out).toContain('2026-01-15');
    expect(out).toContain('yes');
  });

  it('renders multiple workspace rows', () => {
    const rows: WorkspaceRowViewModel[] = [
      makeRow({ id: 'ws-001', name: 'workspace-a', isDefault: true }),
      makeRow({ id: 'ws-002', name: 'workspace-b', isDefault: false }),
      makeRow({ id: 'ws-003', name: 'workspace-c', isDefault: false }),
    ];
    const out = frame(<WorkspaceListInk vm={vm({ rows, total: 3 })} />);
    expect(out).toContain('ws-001');
    expect(out).toContain('ws-002');
    expect(out).toContain('ws-003');
    expect(out).toContain('workspace-a');
    expect(out).toContain('workspace-b');
    expect(out).toContain('workspace-c');
    expect(out).toContain('3 workspaces');
  });

  it('renders non-default workspace as "no"', () => {
    const out = frame(<WorkspaceListInk vm={vm({ rows: [makeRow({ isDefault: false })] })} />);
    expect(out).toContain('no');
  });

  it('renders footer with total count and limit', () => {
    const out = frame(<WorkspaceListInk vm={vm({ total: 5, limit: 10 })} />);
    expect(out).toContain('5 workspaces');
    expect(out).toContain('Limit 10');
  });

  it('renders footer without limit text when limit is zero', () => {
    const out = frame(<WorkspaceListInk vm={vm({ total: 2, limit: 0 })} />);
    expect(out).toContain('2 workspaces');
    expect(out).not.toContain('Limit');
  });

  it('renders section title', () => {
    const out = frame(<WorkspaceListInk vm={vm()} />);
    expect(out).toContain('Workspaces');
  });

  it('renders empty list with zero total', () => {
    const out = frame(<WorkspaceListInk vm={vm({ rows: [], total: 0 })} />);
    expect(out).toContain('0 workspaces');
  });
});

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { WorkspaceLimitInk } from '../../src/ui/WorkspaceLimit.js';
import type { WorkspaceLimitViewModel } from '../../src/view-models/workspace/index.js';

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

function vm(overrides: Partial<WorkspaceLimitViewModel> = {}): WorkspaceLimitViewModel {
  return {
    current: 3,
    max: 10,
    remaining: 7,
    utilizationPct: 30,
    ...overrides,
  };
}

describe('WorkspaceLimitInk', () => {
  it('renders Current and Maximum with correct values', () => {
    const out = frame(<WorkspaceLimitInk vm={vm()} />);
    expect(out).toContain('Current');
    expect(out).toContain('3');
    expect(out).toContain('Maximum');
    expect(out).toContain('10');
  });

  it('renders zero values when max is zero', () => {
    const out = frame(<WorkspaceLimitInk vm={vm({ current: 0, max: 0, remaining: 0, utilizationPct: 0 })} />);
    expect(out).toContain('Current');
    expect(out).toContain('0');
    expect(out).toContain('Maximum');
  });

  it('renders fully utilized workspace', () => {
    const out = frame(<WorkspaceLimitInk vm={vm({ current: 10, max: 10, remaining: 0, utilizationPct: 100 })} />);
    expect(out).toContain('Current');
    expect(out).toContain('10');
    expect(out).toContain('Maximum');
  });

  it('renders section title', () => {
    const out = frame(<WorkspaceLimitInk vm={vm()} />);
    expect(out).toContain('Workspace Limit');
  });
});

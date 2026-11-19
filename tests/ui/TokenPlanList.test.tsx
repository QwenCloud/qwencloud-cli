import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { renderTokenPlanListInk } from '../../src/ui/TokenPlanList.js';
import { buildTokenPlanListViewModel } from '../../src/view-models/subscription/tokenplan-list.js';

afterEach(() => vi.restoreAllMocks());

describe('Token Plan catalog output', () => {
  it.each([40, 120])(
    'prints copyable commands with one blank row at %s columns',
    async (columns) => {
      const descriptors = new Map(
        ['columns', 'rows', 'isTTY'].map((key) => [
          key,
          Object.getOwnPropertyDescriptor(process.stdout, key),
        ]),
      );
      Object.defineProperties(process.stdout, {
        columns: { value: columns, configurable: true },
        rows: { value: 12, configurable: true },
        isTTY: { value: true, configurable: true },
      });
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(((_chunk: unknown) => true) as typeof process.stdout.write);
      try {
        const vm = buildTokenPlanListViewModel({
          authenticated: false,
          edition: 'individual',
          billingCycle: 'monthly',
          completeness: 'complete',
          sections: [],
        });
        await renderTokenPlanListInk(vm);
        const output = stripVTControlCharacters(
          writeSpy.mock.calls.map((call) => String(call[0])).join(''),
        );
        expect(output).toContain('TOKEN PLAN CATALOG');
        expect(output).toContain('BILLING CYCLE monthly\n\n' + vm.note + '\n');
        expect(output).toContain(
          '\n  qwencloud subscription tokenplan list --edition individual --billing-cycle quarterly\n',
        );
        expect(output).toContain('\n  qwencloud auth login\n');
        expect(output.match(/To view another billing cycle, run:/g)).toHaveLength(1);
        expect(output).not.toContain('subscription tokenplan purchase');
        expect(writeSpy.mock.calls.map((call) => String(call[0])).join('')).not.toMatch(
          /\x1b\[(?:2J|3J|\?1049h)/,
        );
      } finally {
        for (const [key, descriptor] of descriptors) {
          if (descriptor) Object.defineProperty(process.stdout, key, descriptor);
          else Reflect.deleteProperty(process.stdout, key);
        }
      }
    },
  );
});

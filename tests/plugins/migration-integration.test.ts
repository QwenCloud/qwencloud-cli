import { describe, expect, it } from 'vitest';
import { createPluginExecution } from '../../src/plugins/runtime.js';
import { interruptActiveCommand } from '../../src/utils/command-interrupt.js';

describe('plugin command cancellation integration', () => {
  it('aborts an active execution through the command interrupt registry and unregisters on disposal', async () => {
    const execution = createPluginExecution(60_000);
    try {
      expect(execution.signal.aborted).toBe(false);
      const settled = execution.aborted.then(
        () => ({ rejected: false as const }),
        (error: unknown) => ({ rejected: true as const, error }),
      );
      expect(interruptActiveCommand()).toBe(true);
      expect(execution.signal.aborted).toBe(true);
      await expect(settled).resolves.toMatchObject({ rejected: true, error: { exitCode: 130 } });
    } finally {
      execution.dispose();
    }
    expect(interruptActiveCommand()).toBe(false);
  });

  it('unregisters a disposed execution without cancelling it', () => {
    const execution = createPluginExecution(60_000);
    execution.dispose();
    expect(interruptActiveCommand()).toBe(false);
    expect(execution.signal.aborted).toBe(false);
  });
});

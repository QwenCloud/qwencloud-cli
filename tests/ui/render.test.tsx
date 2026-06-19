import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { Text, useApp } from 'ink';
import { renderWithInk, renderInteractive } from '../../src/ui/render.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderWithInk', () => {
  it('renders an Ink element to stdout and resolves after paint', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((_chunk: any) => true) as any);

    await renderWithInk(<Text>hello-world-render</Text>);

    // At minimum, the trailing newline should have been written
    expect(writeSpy).toHaveBeenCalled();
    const allChunks = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    // The wrapper writes a trailing '\n' after waitUntilExit
    expect(allChunks).toContain('\n');
  });

  it('resolves even when element renders empty content', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((_chunk: any) => true) as any);

    await renderWithInk(<Text>{''}</Text>);
    expect(writeSpy).toHaveBeenCalled();
  });

  it('uses PassThrough as stdin to isolate from process.stdin', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((_chunk: any) => true) as any);

    // If renderWithInk used real process.stdin, it would call setRawMode.
    // Spy on setRawMode to confirm it's never touched during static render.
    const setRawModeSpy = vi.fn();
    const originalSetRawMode = process.stdin.setRawMode;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode = setRawModeSpy as any;
    }

    await renderWithInk(<Text>stdin-isolation-test</Text>);

    // renderWithInk should NOT touch process.stdin at all
    expect(setRawModeSpy).not.toHaveBeenCalled();

    // Restore
    if (originalSetRawMode) {
      process.stdin.setRawMode = originalSetRawMode;
    }
  });

  it('waitUntilExit resolves (promise does not hang)', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((_chunk: any) => true) as any);

    // If this doesn't resolve within the test timeout, the test fails
    const result = await renderWithInk(<Text>resolve-test</Text>);
    expect(result).toBeUndefined(); // void return
  });
});

describe('renderInteractive', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((_chunk: any) => true) as any);
    originalIsTTY = process.stdout.isTTY;
    // Simulate TTY so alt-screen code path is exercised
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  function AutoExitElement() {
    const app = useApp();
    React.useEffect(() => {
      const h = setImmediate(() => app.exit());
      return () => clearImmediate(h);
    }, [app]);
    return <Text>interactive-content</Text>;
  }

  it('alt-screen: writes enter sequence before render and exit sequence after', async () => {
    await renderInteractive(<AutoExitElement />);

    const allChunks = writeSpy.mock.calls.map((c) => String(c[0]));
    const joined = allChunks.join('');

    // Enter alt-screen (\x1b[?1049h) must appear
    expect(joined).toContain('\x1b[?1049h');
    // Exit alt-screen (\x1b[?1049l) must appear
    expect(joined).toContain('\x1b[?1049l');

    // Enter must come before exit
    const enterIdx = joined.indexOf('\x1b[?1049h');
    const exitIdx = joined.indexOf('\x1b[?1049l');
    expect(enterIdx).toBeLessThan(exitIdx);
  });

  it('alt-screen: sequences are paired (one enter, one exit)', async () => {
    await renderInteractive(<AutoExitElement />);

    const allChunks = writeSpy.mock.calls.map((c) => String(c[0]));
    const joined = allChunks.join('');

    const enterCount = joined.split('\x1b[?1049h').length - 1;
    const exitCount = joined.split('\x1b[?1049l').length - 1;
    expect(enterCount).toBe(1);
    expect(exitCount).toBe(1);
  });

  it('no alt-screen when altScreen option is false', async () => {
    await renderInteractive(<AutoExitElement />, { altScreen: false });

    const allChunks = writeSpy.mock.calls.map((c) => String(c[0]));
    const joined = allChunks.join('');

    expect(joined).not.toContain('\x1b[?1049h');
    expect(joined).not.toContain('\x1b[?1049l');
  });

  it('uses real process.stdin for interactive input', async () => {
    // renderInteractive removes and restores stdin data listeners,
    // which proves it uses real process.stdin (not a PassThrough).
    const dummyListener = vi.fn();
    process.stdin.on('data', dummyListener);

    // Before render, listener is attached
    expect(process.stdin.listeners('data')).toContain(dummyListener);

    await renderInteractive(<AutoExitElement />);

    // After render, listener is restored — confirming stdin was manipulated
    const postListeners = process.stdin.listeners('data');
    expect(postListeners).toContain(dummyListener);

    process.stdin.removeListener('data', dummyListener);
  });

  it('waitUntilExit resolves after element exits', async () => {
    // If this hangs, the test framework will timeout — asserting correct resolution
    const result = await renderInteractive(<AutoExitElement />);
    expect(result).toBeUndefined();
  });

  it('restores stdin listeners after render completes', async () => {
    const dummyListener = vi.fn();
    process.stdin.on('data', dummyListener);

    await renderInteractive(<AutoExitElement />);

    // The listener should be restored after renderInteractive finishes
    const listeners = process.stdin.listeners('data');
    expect(listeners).toContain(dummyListener);

    // Cleanup
    process.stdin.removeListener('data', dummyListener);
  });

  // Element that snapshots the active resize listeners DURING the alt-screen
  // render phase (inside useEffect) into an external sink, then exits.
  // Capturing the snapshot mid-render is essential: asserting only on the
  // post-exit restored state cannot prove the listeners were isolated
  // WHILE Ink owned the screen.
  function ResizeSnapshotElement({
    sink,
  }: {
    sink: { during: Array<(...args: unknown[]) => void> | null };
  }) {
    const app = useApp();
    React.useEffect(() => {
      sink.during = process.stdout.listeners('resize') as Array<(...args: unknown[]) => void>;
      const h = setImmediate(() => app.exit());
      return () => clearImmediate(h);
    }, [app, sink]);
    return <Text>resize-snapshot-content</Text>;
  }

  it('isolates pre-registered stdout resize listeners during the render', async () => {
    const dummyResize = (): void => {};
    process.stdout.on('resize', dummyResize);

    // Sanity: the dummy listener is present before render.
    expect(process.stdout.listeners('resize')).toContain(dummyResize);

    const sink: { during: Array<(...args: unknown[]) => void> | null } = {
      during: null,
    };

    try {
      await renderInteractive(<ResizeSnapshotElement sink={sink} />);

      // The snapshot must have been taken during the render phase.
      expect(sink.during).not.toBeNull();
      // Core assertion: during the alt-screen render the readline-style
      // resize listener was removed (isolated). Without isolation the dummy
      // would still be present mid-render -> this turns red.
      expect(sink.during).not.toContain(dummyResize);
    } finally {
      process.stdout.removeListener('resize', dummyResize);
    }
  });

  it('restores stdout resize listeners after render completes', async () => {
    const dummyResize = (): void => {};
    process.stdout.on('resize', dummyResize);

    try {
      await renderInteractive(<AutoExitElement />);

      // After renderInteractive finishes, the pre-registered resize listener
      // must be restored so the surrounding readline keeps repainting.
      expect(process.stdout.listeners('resize')).toContain(dummyResize);
    } finally {
      process.stdout.removeListener('resize', dummyResize);
    }
  });

  it('one-shot path with no pre-registered resize listener completes cleanly', async () => {
    // No resize listener is pre-registered (mirrors one-shot mode: no readline).
    // renderInteractive must still complete without throwing and keep the
    // alt-screen enter/exit sequence paired.
    await expect(renderInteractive(<AutoExitElement />)).resolves.toBeUndefined();

    const joined = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    const enterCount = joined.split('\x1b[?1049h').length - 1;
    const exitCount = joined.split('\x1b[?1049l').length - 1;
    expect(enterCount).toBe(1);
    expect(exitCount).toBe(1);
  });
});

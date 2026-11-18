import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function startRecoveryWorker<T>(workerPath: string, configPath: string, root: string) {
  const child = fork(workerPath, [configPath], {
    cwd: root,
    execArgv: ['--import', require.resolve('tsx')],
    env: {
      ...process.env,
      TSX_DISABLE_CACHE: '1',
      QWENCLOUD_CONFIG_DIR: root,
      QWENCLOUD_KEYRING: 'no',
      TMPDIR: root,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let message: T | undefined;
  let diagnostic = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    diagnostic += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostic += chunk.toString();
  });
  child.on('message', (value: T) => {
    message = value;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    exited,
    get message() {
      return message;
    },
    get diagnostic() {
      return diagnostic;
    },
  };
}

export async function stopRecoveryWorkers(
  workers: readonly { child: ChildProcess; exited: Promise<unknown> }[],
): Promise<void> {
  await Promise.all(
    workers.map(async (worker) => {
      if (worker.child.exitCode === null && worker.child.signalCode === null)
        worker.child.kill('SIGKILL');
      await worker.exited;
    }),
  );
}

/**
 * Unit tests for the CosyVoice WebSocket client: the duplex handshake
 * (run-task → task-started → continue/finish-task), binary audio collection,
 * task-finished/task-failed handling and URL derivation.
 */
import { describe, it, expect } from 'vitest';
import {
  TTSWebSocketClient,
  toWebSocketUrl,
  type WebSocketLike,
} from '../../../../src/api/providers/dashscope/tts-ws-client.js';

type Listener = (...args: unknown[]) => void;

class FakeSocket implements WebSocketLike {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Listener>();
  closed = false;

  on(event: string, listener: Listener): void {
    this.listeners.set(event, listener as Listener);
  }

  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.(...args);
  }

  action(index: number): string {
    return (JSON.parse(this.sent[index] as string) as { header: { action: string } }).header.action;
  }
}

function serverEvent(event: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ header: { task_id: 't-1', event, attributes: {} }, payload });
}

describe('toWebSocketUrl', () => {
  it('maps https to wss and appends the inference path', () => {
    expect(toWebSocketUrl('https://dashscope-intl.aliyuncs.com')).toBe(
      'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference',
    );
  });

  it('maps http to ws for local endpoints', () => {
    expect(toWebSocketUrl('http://127.0.0.1:8888')).toBe('ws://127.0.0.1:8888/api-ws/v1/inference');
  });
});

describe('TTSWebSocketClient.synthesize', () => {
  it('runs the duplex handshake and returns concatenated audio', async () => {
    const socket = new FakeSocket();
    const client = new TTSWebSocketClient({
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      token: 'sk-ws-x',
      userAgent: 'qwencloud-cli/test',
      connect: () => socket,
    });

    const promise = client.synthesize({
      model: 'cosyvoice-v2',
      text: 'hi',
      parameters: { voice: 'longxiaochun', format: 'pcm', sample_rate: 24000 },
    });

    socket.emit('open');
    expect(socket.action(0)).toBe('run-task');

    socket.emit('message', serverEvent('task-started'), false);
    expect(socket.action(1)).toBe('continue-task');
    expect(socket.action(2)).toBe('finish-task');

    socket.emit('message', new Uint8Array([1, 2]), true);
    socket.emit('message', new Uint8Array([3, 4]), true);
    socket.emit('message', serverEvent('task-finished', { usage: { characters: 2 } }), false);

    const result = await promise;
    expect(Array.from(result.audio)).toEqual([1, 2, 3, 4]);
    expect(result.events).toEqual(['task-started', 'task-finished']);
    expect(result.usage).toEqual({ characters: 2 });
    expect(socket.closed).toBe(true);
  });

  it('sends the run-task payload with model, parameters and empty input', async () => {
    const socket = new FakeSocket();
    const client = new TTSWebSocketClient({
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      token: 'sk-ws-x',
      userAgent: 'qwencloud-cli/test',
      connect: () => socket,
    });

    const promise = client.synthesize({
      model: 'cosyvoice-v2',
      text: 'hi',
      parameters: { voice: 'longxiaochun' },
    });
    socket.emit('open');
    socket.emit('message', serverEvent('task-started'), false);
    socket.emit('message', serverEvent('task-finished'), false);
    await promise;

    const run = JSON.parse(socket.sent[0] as string) as {
      payload: { model: string; parameters: Record<string, unknown>; input: Record<string, unknown> };
    };
    expect(run.payload.model).toBe('cosyvoice-v2');
    expect(run.payload.parameters.voice).toBe('longxiaochun');
    expect(run.payload.input).toEqual({});

    const cont = JSON.parse(socket.sent[1] as string) as { payload: { input: { text: string } } };
    expect(cont.payload.input.text).toBe('hi');
  });

  it('rejects with the upstream error on task-failed', async () => {
    const socket = new FakeSocket();
    const client = new TTSWebSocketClient({
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      token: 'sk-ws-x',
      userAgent: 'qwencloud-cli/test',
      connect: () => socket,
    });

    const promise = client.synthesize({ model: 'cosyvoice-v2', text: 'hi', parameters: {} });
    socket.emit('open');
    socket.emit(
      'message',
      JSON.stringify({
        header: { event: 'task-failed', error_code: 'InvalidParameter', error_message: 'bad voice' },
        payload: {},
      }),
      false,
    );

    await expect(promise).rejects.toMatchObject({ code: 'InvalidParameter', message: 'bad voice' });
  });

  it('maps a token-plan model rejection to MODEL_NOT_SUPPORTED', async () => {
    const socket = new FakeSocket();
    const client = new TTSWebSocketClient({
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      token: 'sk-sp-team',
      userAgent: 'qwencloud-cli/test',
      connect: () => socket,
    });

    const promise = client.synthesize({ model: 'sambert-zhinan-v1', text: 'hi', parameters: {} });
    socket.emit('open');
    socket.emit(
      'message',
      JSON.stringify({
        header: { event: 'task-failed', error_code: 'InvalidParameter', error_message: 'Model not exist.' },
        payload: {},
      }),
      false,
    );

    await expect(promise).rejects.toMatchObject({
      code: 'MODEL_NOT_SUPPORTED',
      detail: expect.stringContaining('Model not exist'),
    });
  });

  it('rejects when the socket closes before task-started', async () => {
    const socket = new FakeSocket();
    const client = new TTSWebSocketClient({
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      token: 'sk-ws-x',
      userAgent: 'qwencloud-cli/test',
      connect: () => socket,
    });

    const promise = client.synthesize({ model: 'cosyvoice-v2', text: 'hi', parameters: {} });
    socket.emit('open');
    socket.emit('close', 1006, Buffer.from(''));

    await expect(promise).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('carries text inside run-task and skips continue/finish in out mode', async () => {
    const socket = new FakeSocket();
    const client = new TTSWebSocketClient({
      baseUrl: 'https://dashscope-intl.aliyuncs.com',
      token: 'sk-ws-x',
      userAgent: 'qwencloud-cli/test',
      connect: () => socket,
    });

    const promise = client.synthesize({
      model: 'sambert-zhinan-v1',
      text: 'hello',
      parameters: { format: 'mp3' },
      streaming: 'out',
    });

    socket.emit('open');
    const run = JSON.parse(socket.sent[0] as string) as {
      header: { streaming: string };
      payload: { input: { text?: string } };
    };
    expect(run.header.streaming).toBe('out');
    expect(run.payload.input.text).toBe('hello');

    socket.emit('message', serverEvent('task-started'), false);
    expect(socket.sent).toHaveLength(1);

    socket.emit('message', new Uint8Array([7]), true);
    socket.emit('message', serverEvent('task-finished'), false);

    const result = await promise;
    expect(Array.from(result.audio)).toEqual([7]);
  });
});

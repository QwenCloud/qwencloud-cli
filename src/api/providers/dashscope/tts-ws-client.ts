/** CosyVoice/Qwen-Audio-TTS WebSocket synthesis over the DashScope duplex protocol. */

import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { CliError } from '../../../utils/errors.js';
import { EXIT_CODES } from '../../../utils/exit-codes.js';
import { paymentTier } from './transport.js';
import { tokenPlanModelUnsupportedMessage } from '../../../site.js';

const INFERENCE_PATH = '/api-ws/v1/inference';
const DEFAULT_TIMEOUT_MS = 60_000;

/** `duplex` streams text via continue-task; `out` carries it inside run-task. */
export type TTSWebSocketStreamingMode = 'duplex' | 'out';

export interface TTSWebSocketRequest {
  model: string;
  text: string;
  parameters: Record<string, unknown>;
  streaming?: TTSWebSocketStreamingMode;
}

export interface TTSWebSocketResult {
  audio: Uint8Array;
  events: string[];
  usage?: Record<string, unknown>;
}

export interface WebSocketLike {
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void;
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface TTSWebSocketClientDeps {
  baseUrl: string;
  token: string;
  userAgent: string;
  connect?: (url: string, headers: Record<string, string>) => WebSocketLike;
  timeoutMs?: number;
}

/** Derive the `wss://.../api-ws/v1/inference` URL from a http(s) DashScope base URL. */
export function toWebSocketUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const scheme = trimmed.startsWith('https://')
    ? 'wss://'
    : trimmed.startsWith('http://')
      ? 'ws://'
      : 'wss://';
  const host = trimmed.replace(/^https?:\/\//, '');
  return `${scheme}${host}${INFERENCE_PATH}`;
}

function networkError(message: string): CliError {
  return new CliError({
    code: 'NETWORK_ERROR',
    message,
    exitCode: EXIT_CODES.NETWORK_ERROR,
  });
}

/** A token-plan token hitting a model outside its entitlement reports as "model not exist". */
function isTokenPlanModelRejection(token: string, message: string): boolean {
  return paymentTier(token) === 'tokenplan' && /model\s+not\s+exist/i.test(message);
}

export class TTSWebSocketClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;
  private readonly connect: (url: string, headers: Record<string, string>) => WebSocketLike;
  private readonly timeoutMs: number;

  constructor(deps: TTSWebSocketClientDeps) {
    this.baseUrl = deps.baseUrl;
    this.token = deps.token;
    this.userAgent = deps.userAgent;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.connect =
      deps.connect ??
      ((url, headers) => new WebSocket(url, { headers }) as unknown as WebSocketLike);
  }

  /** Run one full synthesis task and resolve with the concatenated audio bytes. */
  synthesize(req: TTSWebSocketRequest): Promise<TTSWebSocketResult> {
    const url = toWebSocketUrl(this.baseUrl);
    const taskId = randomUUID();
    const streaming: TTSWebSocketStreamingMode = req.streaming ?? 'duplex';
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'user-agent': this.userAgent,
    };

    return new Promise<TTSWebSocketResult>((resolve, reject) => {
      const ws = this.connect(url, headers);
      const chunks: Uint8Array[] = [];
      const events: string[] = [];
      let usage: Record<string, unknown> | undefined;
      let settled = false;
      let started = false;

      const timer = setTimeout(() => {
        finish(networkError(`WebSocket synthesis stalled: no response within ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }

      const finish = (error?: CliError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore close failures on an already-broken socket
        }
        if (error) {
          reject(error);
          return;
        }
        resolve({ audio: concat(chunks), events, ...(usage ? { usage } : {}) });
      };

      const runTask = (): void => {
        ws.send(
          JSON.stringify({
            header: { action: 'run-task', task_id: taskId, streaming },
            payload: {
              task_group: 'audio',
              task: 'tts',
              function: 'SpeechSynthesizer',
              model: req.model,
              parameters: req.parameters,
              input: streaming === 'out' ? { text: req.text } : {},
            },
          }),
        );
      };

      const continueTask = (): void => {
        ws.send(
          JSON.stringify({
            header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: { text: req.text } },
          }),
        );
      };

      const finishTask = (): void => {
        ws.send(
          JSON.stringify({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          }),
        );
      };

      ws.on('open', runTask);

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          chunks.push(toBytes(data));
          return;
        }
        let event: TTSServerEvent;
        try {
          event = JSON.parse(toText(data)) as TTSServerEvent;
        } catch {
          return;
        }
        const name = event.header?.event;
        if (typeof name === 'string') events.push(name);

        switch (name) {
          case 'task-started':
            started = true;
            if (streaming === 'duplex') {
              continueTask();
              finishTask();
            }
            break;
          case 'result-generated': {
            const u = event.payload?.usage;
            if (u && typeof u === 'object') usage = u as Record<string, unknown>;
            break;
          }
          case 'task-finished': {
            const u = event.payload?.usage;
            if (u && typeof u === 'object') usage = u as Record<string, unknown>;
            finish();
            break;
          }
          case 'task-failed': {
            const failMessage = event.header?.error_message ?? 'WebSocket synthesis failed';
            if (isTokenPlanModelRejection(this.token, failMessage)) {
              finish(
                new CliError({
                  code: 'MODEL_NOT_SUPPORTED',
                  message: tokenPlanModelUnsupportedMessage(),
                  exitCode: EXIT_CODES.GENERAL_ERROR,
                  detail: failMessage,
                }),
              );
              break;
            }
            finish(
              new CliError({
                code:
                  typeof event.header?.error_code === 'string'
                    ? event.header.error_code
                    : 'UNKNOWN_ERROR',
                message: failMessage,
                exitCode: EXIT_CODES.GENERAL_ERROR,
              }),
            );
            break;
          }
          default:
            break;
        }
      });

      ws.on('error', (err) => {
        finish(networkError(`WebSocket error: ${err.message}\n  URL: ${url}`));
      });

      ws.on('close', () => {
        if (settled) return;
        finish(
          started
            ? networkError('WebSocket closed before task-finished')
            : networkError(`WebSocket closed before task-started\n  URL: ${url}`),
        );
      });
    });
  }
}

interface TTSServerEvent {
  header?: {
    event?: string;
    error_code?: string;
    error_message?: string;
  };
  payload?: {
    usage?: unknown;
  };
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return concat(data.map(toBytes));
  return new Uint8Array(0);
}

function toText(data: unknown): string {
  if (typeof data === 'string') return data;
  return Buffer.from(toBytes(data)).toString('utf-8');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Unit tests for the text-to-speech service — orchestration of tiers 0/1/2/3
 * into a native DashScope synthesis body, plus the synchronous generate path
 * with audio download post-processing.
 *
 * Real base collaborators are injected (request parsing, conflict detection,
 * envelope construction, mapping registry). Only the outermost boundaries are
 * substituted: the model resolver (network), the synthesis client (HTTP) and
 * the downloader (fs/network).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TTSService,
  type TTSServiceDeps,
  registerTTSMappings,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
} from '../../src/services/tts-service.js';
import { RequestPayloadParser } from '../../src/services/request-payload-parser.js';
import { LayerConflictDetector } from '../../src/services/layer-conflict-detector.js';
import { InvocationEnvelope } from '../../src/services/invocation-envelope.js';
import { MappingRegistry } from '../../src/api/providers/mapping-registry.js';
import type { DefaultModelResolver } from '../../src/services/default-model-resolver.js';
import type { TTSClient } from '../../src/api/providers/dashscope/tts-client.js';
import type { TTSWebSocketClient } from '../../src/api/providers/dashscope/tts-ws-client.js';
import type { AudioFileWriter } from '../../src/services/audio-file.js';
import type { ImageDownloader } from '../../src/services/image-downloader.js';
import { CliError } from '../../src/utils/errors.js';
import { EXIT_CODES } from '../../src/utils/exit-codes.js';

function makeRegistry(): MappingRegistry {
  const registry = new MappingRegistry();
  registerTTSMappings(registry);
  return registry;
}

function makeResolver(model: string): DefaultModelResolver {
  return {
    resolve: vi.fn(async (_q: unknown, flag?: string) => flag ?? model),
  } as unknown as DefaultModelResolver;
}

function makeClient(response: Record<string, unknown>): {
  client: TTSClient;
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn().mockResolvedValue(response);
  return { client: { generate } as unknown as TTSClient, generate };
}

function makeDownloader(): { downloader: ImageDownloader; download: ReturnType<typeof vi.fn> } {
  const download = vi.fn(async (_url: string, index: number) => `downloads/speech-${index}.wav`);
  return {
    downloader: {
      download,
      inferFileName: vi.fn(() => 'x.wav'),
      fetchBytes: vi.fn(async () => new Uint8Array([1, 2])),
    } as unknown as ImageDownloader,
    download,
  };
}

function makeWsClient(
  result: { audio: Uint8Array; events: string[]; usage?: Record<string, unknown> } = {
    audio: new Uint8Array([1, 2, 3, 4]),
    events: ['task-started', 'result-generated', 'task-finished'],
    usage: { characters: 6 },
  },
): { wsClient: TTSWebSocketClient; synthesize: ReturnType<typeof vi.fn> } {
  const synthesize = vi.fn().mockResolvedValue(result);
  return { wsClient: { synthesize } as unknown as TTSWebSocketClient, synthesize };
}

function makeAudioWriter(): { audioWriter: AudioFileWriter; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(() => 'downloads/cosyvoice_20260101-000000.mp3');
  return { audioWriter: { save } as unknown as AudioFileWriter, save };
}

const AUDIO_URL = 'https://mock-api.test.qwencloud.com/hello.wav';

function makeDeps(overrides: Partial<TTSServiceDeps> = {}): TTSServiceDeps {
  return {
    parser: new RequestPayloadParser({
      readFile: () => {
        throw new Error('no file');
      },
      readStdin: () => '',
    }),
    conflictDetector: new LayerConflictDetector(),
    modelResolver: makeResolver(DEFAULT_TTS_MODEL),
    registry: makeRegistry(),
    envelope: new InvocationEnvelope(),
    client: makeClient({ request_id: 'r-1', output: { audio: { url: AUDIO_URL } } }).client,
    wsClient: makeWsClient().wsClient,
    audioWriter: makeAudioWriter().audioWriter,
    downloader: makeDownloader().downloader,
    context: () => ({ site: 'qwencloud', account: 'acct-1' }),
    ...overrides,
  };
}

describe('TTSService.buildRequest — tier 0 text', () => {
  it('wraps bare text into a native input.text block', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({ text: '欢迎使用千问云' });

    expect((body.input as Record<string, unknown>).text).toBe('欢迎使用千问云');
  });

  it('resolves the default model and stamps it on the body', async () => {
    const svc = new TTSService(makeDeps());

    const { model, body } = await svc.buildRequest({ text: 'x' });

    expect(model).toBe(DEFAULT_TTS_MODEL);
    expect(body.model).toBe(DEFAULT_TTS_MODEL);
  });

  it('applies the default Qwen3-TTS voice when none is supplied', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({ text: 'x' });

    expect((body.input as Record<string, unknown>).voice).toBe(DEFAULT_TTS_VOICE);
  });

  it('routes qwen-audio models to the SpeechSynthesizer endpoint', async () => {
    const svc = new TTSService(makeDeps());

    const { path } = await svc.buildRequest({ text: 'x' });

    expect(path).toBe('/api/v1/services/audio/tts/SpeechSynthesizer');
  });
});

describe('TTSService.buildRequest — tier 1 model', () => {
  it('honours an explicit --model over the default', async () => {
    const svc = new TTSService(makeDeps({ modelResolver: makeResolver(DEFAULT_TTS_MODEL) }));

    const { model, body } = await svc.buildRequest({ text: 'x', model: 'qwen3-tts' });

    expect(model).toBe('qwen3-tts');
    expect(body.model).toBe('qwen3-tts');
  });

  it('lets a --request self-carried model win when no --model is given', async () => {
    const resolver = makeResolver(DEFAULT_TTS_MODEL);
    const svc = new TTSService(makeDeps({ modelResolver: resolver }));

    const { model } = await svc.buildRequest({
      request: '{"model":"qwen3-tts","input":{"text":"hi"}}',
    });

    expect(model).toBe('qwen3-tts');
  });

  it('overrides a --request model when --model is explicit', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({
      model: 'qwen3-tts-flash',
      request: '{"model":"qwen3-tts","input":{"text":"hi"}}',
    });

    expect(body.model).toBe('qwen3-tts-flash');
  });
});

describe('TTSService.buildRequest — tier 2 voice', () => {
  it('maps --voice onto input.voice', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({ text: 'x', voice: 'Ethan' });

    expect((body.input as Record<string, unknown>).voice).toBe('Ethan');
  });

  it('does not overwrite an explicit --voice with the default', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({ text: 'x', voice: 'Ethan' });

    expect((body.input as Record<string, unknown>).voice).not.toBe(DEFAULT_TTS_VOICE);
  });

  it('writes --voice into a --request body that omits text', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({
      voice: 'Cherry',
      request: '{"input":{"text":"你好"}}',
    });

    const input = body.input as Record<string, unknown>;
    expect(input.voice).toBe('Cherry');
    expect(input.text).toBe('你好');
  });
});

describe('TTSService.buildRequest — tier 3 passthrough', () => {
  it('preserves native language and control fields verbatim', async () => {
    const svc = new TTSService(makeDeps());

    const { body } = await svc.buildRequest({
      request: '{"model":"qwen3-tts-flash","input":{"text":"你好","voice":"Cherry","language_type":"Chinese"}}',
    });

    const input = body.input as Record<string, unknown>;
    expect(input.language_type).toBe('Chinese');
    expect(input.text).toBe('你好');
  });

  it('rejects combining bare text with a request.input block', async () => {
    const svc = new TTSService(makeDeps());

    await expect(
      svc.buildRequest({ text: 'hi', request: '{"input":{"text":"x"}}' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 4 });
  });

  it('rejects an empty invocation with neither text nor --request', async () => {
    const svc = new TTSService(makeDeps());

    await expect(svc.buildRequest({})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      exitCode: 4,
    });
  });
});

describe('TTSService — CosyVoice WebSocket path', () => {
  it('builds parameters.voice and keeps text out of the run-task body', async () => {
    const svc = new TTSService(makeDeps({ modelResolver: makeResolver('cosyvoice-v2') }));

    const { model, text, parameters } = await svc.buildWebSocketRequest({
      text: 'hi',
      model: 'cosyvoice-v2',
      voice: 'longxiaochun',
    });

    expect(model).toBe('cosyvoice-v2');
    expect(text).toBe('hi');
    expect(parameters.voice).toBe('longxiaochun');
    expect(parameters.text_type).toBe('PlainText');
    expect(parameters.format).toBe('mp3');
  });

  it('requires an explicit voice for CosyVoice', async () => {
    const svc = new TTSService(makeDeps({ modelResolver: makeResolver('cosyvoice-v2') }));

    await expect(
      svc.buildWebSocketRequest({ text: 'hi', model: 'cosyvoice-v2' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('synthesizes over WebSocket, saves audio and omits request_id', async () => {
    const ws = makeWsClient();
    const writer = makeAudioWriter();
    const svc = new TTSService(
      makeDeps({
        modelResolver: makeResolver('cosyvoice-v2'),
        wsClient: ws.wsClient,
        audioWriter: writer.audioWriter,
      }),
    );

    const envelope = await svc.generate({ text: 'hi', model: 'cosyvoice-v2', voice: 'longxiaochun' });

    expect(ws.synthesize).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledTimes(1);
    expect(envelope.meta.request_id).toBeUndefined();
    expect(envelope.meta.model).toBe('cosyvoice-v2');
    expect((envelope.data.audio as { path: string }).path).toBe(
      'downloads/cosyvoice_20260101-000000.mp3',
    );
    expect('events' in envelope.data).toBe(false);
  });

  it('does not route a Qwen3-TTS model through WebSocket', async () => {
    const ws = makeWsClient();
    const svc = new TTSService(makeDeps({ wsClient: ws.wsClient }));

    await svc.generate({ text: 'hi' });

    expect(ws.synthesize).not.toHaveBeenCalled();
  });

  it('routes sambert through WebSocket in out mode without requiring a voice', async () => {
    const ws = makeWsClient();
    const svc = new TTSService(
      makeDeps({ modelResolver: makeResolver('sambert-zhinan-v1'), wsClient: ws.wsClient }),
    );

    await svc.generate({ text: 'hi', model: 'sambert-zhinan-v1' });

    expect(ws.synthesize).toHaveBeenCalledTimes(1);
    const req = ws.synthesize.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.streaming).toBe('out');
    expect((req.parameters as Record<string, unknown>).voice).toBeUndefined();
  });

  it('routes cosyvoice-v3.5 through WebSocket in duplex mode', async () => {
    const ws = makeWsClient();
    const svc = new TTSService(
      makeDeps({ modelResolver: makeResolver('cosyvoice-v3.5-flash'), wsClient: ws.wsClient }),
    );

    await svc.generate({ text: 'hi', model: 'cosyvoice-v3.5-flash', voice: 'custom-1' });

    const req = ws.synthesize.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.streaming).toBe('duplex');
  });

  it('adds a custom-voice hint when cosyvoice-v3.5 rejects a system voice', async () => {
    const synthesize = vi.fn().mockRejectedValue(
      new CliError({
        code: 'API_ERROR',
        message: 'Engine return error code: 418 (InvalidParameter)',
        exitCode: EXIT_CODES.GENERAL_ERROR,
      }),
    );
    const wsClient = { synthesize } as unknown as Parameters<typeof makeDeps>[0]['wsClient'];
    const svc = new TTSService(
      makeDeps({ modelResolver: makeResolver('cosyvoice-v3.5-flash'), wsClient }),
    );

    await expect(
      svc.generate({ text: 'hi', model: 'cosyvoice-v3.5-flash', voice: 'longxiaochun_v2' }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('custom voice') });
  });
});

describe('TTSService.extractUrls', () => {
  it('reads output.audio.url', () => {
    const svc = new TTSService(makeDeps());

    const urls = svc.extractUrls({ output: { audio: { url: AUDIO_URL } } });

    expect(urls).toEqual([AUDIO_URL]);
  });

  it('reads a scalar output.audio string url', () => {
    const svc = new TTSService(makeDeps());

    const urls = svc.extractUrls({ output: { audio: AUDIO_URL } });

    expect(urls).toEqual([AUDIO_URL]);
  });

  it('skips base64 audio payloads with no url', () => {
    const svc = new TTSService(makeDeps());

    const urls = svc.extractUrls({ output: { audio: { data: 'AAAA' } } });

    expect(urls).toEqual([]);
  });

  it('returns an empty list when no audio is present', () => {
    const svc = new TTSService(makeDeps());

    expect(svc.extractUrls({ output: {} })).toEqual([]);
  });
});

describe('TTSService.generate — synchronous download path', () => {
  it('downloads the synthesized audio and records the artifact path', async () => {
    const { downloader, download } = makeDownloader();
    const svc = new TTSService(makeDeps({ downloader }));

    const envelope = await svc.generate({ text: 'hi' });

    expect(download).toHaveBeenCalledTimes(1);
    const audio = (envelope.data as Record<string, unknown>).audio as Record<string, unknown>;
    expect(audio.url).toBe(AUDIO_URL);
    expect(audio.path).toBe('downloads/speech-0.wav');
  });

  it('forwards --out to the downloader', async () => {
    const { downloader, download } = makeDownloader();
    const svc = new TTSService(makeDeps({ downloader }));

    await svc.generate({ text: 'hi', out: 'hello.wav' });

    expect(download.mock.calls[0]![2]).toBe('hello.wav');
  });

  it('uses the audio extension from the upstream url as the download fallback', async () => {
    const { downloader, download } = makeDownloader();
    const svc = new TTSService(makeDeps({ downloader }));

    await svc.generate({ text: 'hi', out: 'hello' });

    expect(download.mock.calls[0]![3]).toBe('wav');
  });

  it('skips download when download is false and returns url-only artifacts', async () => {
    const { downloader, download } = makeDownloader();
    const svc = new TTSService(makeDeps({ downloader }));

    const envelope = await svc.generate({ text: 'hi', download: false });

    expect(download).not.toHaveBeenCalled();
    const audio = (envelope.data as Record<string, unknown>).audio as Record<string, unknown>;
    expect(audio.url).toBe(AUDIO_URL);
    expect('path' in audio).toBe(false);
  });

  it('surfaces the upstream request id on the envelope meta', async () => {
    const svc = new TTSService(makeDeps());

    const envelope = await svc.generate({ text: 'hi' });

    expect(envelope.meta.request_id).toBe('r-1');
  });

  it('omits request_id from meta when the upstream did not return one', async () => {
    const client = makeClient({ output: { audio: { url: AUDIO_URL } } }).client;
    const svc = new TTSService(makeDeps({ client }));

    const envelope = await svc.generate({ text: 'hi' });

    expect('request_id' in envelope.meta).toBe(false);
  });
});

describe('TTSService.buildRequest — model routing preflight', () => {
  it.each([
    'qwen3-omni-flash',
    'qwen2.5-omni-7b',
    'qwen3.5-omni-plus',
    'qwen-omni-turbo',
    'qwen3-livetranslate-flash',
    'qwen3.5-livetranslate-flash-realtime',
  ])('rejects multimodal chat model %s with a chat-create hint', async (model) => {
    const svc = new TTSService(makeDeps({ modelResolver: makeResolver(model) }));

    await expect(svc.buildRequest({ text: 'hi', model })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('chat create'),
    });
  });

  it.each([
    'qwen-tts-realtime',
    'qwen3-tts-flash-realtime',
    'qwen3-tts-instruct-flash-realtime',
    'qwen3-tts-vc-realtime-2025-11-27',
  ])('rejects realtime-only TTS model %s with a streaming hint', async (model) => {
    const svc = new TTSService(makeDeps({ modelResolver: makeResolver(model) }));

    await expect(svc.buildRequest({ text: 'hi', model })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('realtime'),
    });
  });

  it('still accepts a non-realtime Qwen TTS model', async () => {
    const svc = new TTSService(makeDeps({ modelResolver: makeResolver('qwen3-tts-flash') }));

    const { model } = await svc.buildRequest({ text: 'hi', model: 'qwen3-tts-flash' });

    expect(model).toBe('qwen3-tts-flash');
  });
});

describe('TTSService.generate — voice-clone/design hint on the HTTP path', () => {
  it.each(['qwen3-tts-vc-2026-01-22', 'qwen3-tts-vd-2026-01-26'])(
    'adds a custom-voice hint when %s rejects a system voice over HTTP',
    async (model) => {
      const generate = vi.fn().mockRejectedValue(
        new CliError({
          code: 'API_ERROR',
          message: 'InvalidParameter: voice not found',
          exitCode: EXIT_CODES.GENERAL_ERROR,
        }),
      );
      const client = { generate } as unknown as Parameters<typeof makeDeps>[0]['client'];
      const svc = new TTSService(makeDeps({ client, modelResolver: makeResolver(model) }));

      await expect(svc.generate({ text: 'hi', model, voice: 'Cherry' })).rejects.toMatchObject({
        hint: expect.stringContaining('custom voice'),
      });
    },
  );
});

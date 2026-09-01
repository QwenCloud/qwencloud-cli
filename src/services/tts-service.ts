/** Orchestrates tiers 0/1/2/3 into a native speech-synthesis body and drives the TTS client. */

import { CliError } from '../utils/errors.js';
import { EXIT_CODES } from '../utils/exit-codes.js';
import { MappingRegistry } from '../api/providers/mapping-registry.js';
import type { RequestPayloadParser } from './request-payload-parser.js';
import type { LayerConflictDetector } from './layer-conflict-detector.js';
import type { DefaultModelResolver } from './default-model-resolver.js';
import type { InvocationEnvelope } from './invocation-envelope.js';
import { withFieldRejectionHint } from './invocation-envelope.js';
import type { TTSClient } from '../api/providers/dashscope/tts-client.js';
import { COSYVOICE_SYNTHESIS_PATH } from '../api/providers/dashscope/tts-client.js';
import type { TTSWebSocketClient } from '../api/providers/dashscope/tts-ws-client.js';
import type { AudioFileWriter } from './audio-file.js';
import type { ImageDownloader } from './image-downloader.js';
import type { Layer2Assignment, SuccessEnvelope } from '../types/invocation-params.js';
import { expiresInFromUrl } from '../utils/expiry.js';

const TTS_COMMAND = 'audio speech';
const TTS_TASK_MODE = 'tts';

export const DEFAULT_TTS_MODEL = 'qwen-audio-3.0-tts-plus';
export const DEFAULT_TTS_VOICE = 'longanhuan_v3.6';

export interface AudioSpeechInput {
  text?: string;
  model?: string;
  voice?: string;
  out?: string;
  request?: string;
  download?: boolean;
}

export interface AudioSpeechArtifact {
  url: string;
  path?: string;
}

export interface TTSServiceDeps {
  parser: RequestPayloadParser;
  conflictDetector: LayerConflictDetector;
  modelResolver: DefaultModelResolver;
  registry: MappingRegistry;
  envelope: InvocationEnvelope;
  client: TTSClient;
  wsClient: TTSWebSocketClient;
  audioWriter: AudioFileWriter;
  downloader: ImageDownloader;
  context: () => { site: string; account: string };
}

/** Register the DashScope-native speech-synthesis entry into a mapping registry. */
export function registerTTSMappings(registry: MappingRegistry): void {
  registry.register({
    key: {
      command: TTS_COMMAND,
      protocol: 'dashscope-native',
      modelFamily: 'qwen',
      taskMode: TTS_TASK_MODE,
    },
    fieldTemplates: { '--voice': 'input.voice' },
    capabilities: { streaming: false, asynchronous: false },
    filePolicy: { allowBase64: false, allowTempUpload: false },
  });
  registry.register({
    key: {
      command: TTS_COMMAND,
      protocol: 'dashscope-ws',
      modelFamily: 'cosyvoice',
      taskMode: TTS_TASK_MODE,
    },
    fieldTemplates: { '--voice': 'parameters.voice' },
    capabilities: { streaming: true, asynchronous: false },
    filePolicy: { allowBase64: false, allowTempUpload: false },
  });
}

function invalidArg(message: string): CliError {
  return new CliError({
    code: 'INVALID_ARGUMENT',
    message,
    exitCode: EXIT_CODES.INVALID_ARGUMENT,
  });
}

/** Models whose qwencloud path is WebSocket-only and cannot use the HTTP body. */
function requiresWebSocket(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return lower.includes('cosyvoice') || lower.startsWith('sambert');
}

/** WebSocket streaming mode: sambert carries text in run-task; cosyvoice streams it. */
function webSocketStreamingMode(model: string): 'duplex' | 'out' {
  return model.trim().toLowerCase().startsWith('sambert') ? 'out' : 'duplex';
}

/** Models that synthesize only with a custom voice from cloning or design. */
function isVoiceDesignModel(model: string): boolean {
  const lower = model.trim().toLowerCase();
  if (lower.startsWith('cosyvoice-v3.5')) return true;
  return /^qwen3(\.\d+)?-tts-v[cd]([-.]|$)/.test(lower);
}

/** Omni and live-translate models are multimodal chat, not speech synthesis. */
function isMultimodalChatModel(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return /(^|[-.])(omni|livetranslate)([-.]|$)/.test(lower);
}

/** TTS models that only run over the realtime WebSocket protocol (no synchronous HTTP). */
function isRealtimeOnlyTtsModel(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return lower.includes('-tts') && lower.includes('-realtime');
}

function usesSpeechSynthesizerEndpoint(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return lower.includes('cosyvoice') || lower.includes('qwen-audio');
}

function audioExtensionFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '';
  const segment = withoutQuery.split('/').pop() ?? '';
  const dot = segment.lastIndexOf('.');
  if (dot <= 0 || dot >= segment.length - 1) return 'mp3';
  return segment.slice(dot + 1).toLowerCase();
}

const DEFAULT_WS_FORMAT = 'mp3';
const DEFAULT_WS_SAMPLE_RATE = 22050;

function isQwenFamily(model: string): boolean {
  return model.trim().toLowerCase().startsWith('qwen');
}

export class TTSService {
  constructor(private readonly deps: TTSServiceDeps) {}

  private layer2Assignments(input: AudioSpeechInput): Layer2Assignment[] {
    const assignments: Layer2Assignment[] = [];
    if (input.voice !== undefined) {
      assignments.push({ flag: '--voice', paths: ['input.voice'] });
    }
    return assignments;
  }

  async buildRequest(
    input: AudioSpeechInput,
  ): Promise<{ model: string; body: Record<string, unknown>; path?: string }> {
    const { body, model } = await this.prepareBody(input);
    const hasText = typeof input.text === 'string' && input.text.length > 0;

    this.deps.conflictDetector.assertNoConflict(this.layer2Assignments(input), body);

    if (hasText) {
      const audioInput: Record<string, unknown> = { text: input.text as string };
      if (input.voice !== undefined) {
        audioInput.voice = input.voice;
      } else if (isQwenFamily(model)) {
        audioInput.voice = DEFAULT_TTS_VOICE;
      }
      body.input = audioInput;
    } else if (input.voice !== undefined) {
      const audioInput =
        body.input && typeof body.input === 'object' ? (body.input as Record<string, unknown>) : {};
      audioInput.voice = input.voice;
      body.input = audioInput;
    }

    const path = usesSpeechSynthesizerEndpoint(model) ? COSYVOICE_SYNTHESIS_PATH : undefined;
    return { model, body, path };
  }

  /**
   * Parse `--request`, apply the `--model` override and resolve the target
   * model. Shared by the HTTP and WebSocket build paths.
   */
  private async prepareBody(
    input: AudioSpeechInput,
  ): Promise<{ body: Record<string, unknown>; model: string; hasText: boolean }> {
    const hasText = typeof input.text === 'string' && input.text.length > 0;
    const hasRequest = typeof input.request === 'string' && input.request.length > 0;

    if (!hasText && !hasRequest) {
      throw invalidArg('Provide text or a --request body for audio speech.');
    }

    let body: Record<string, unknown> = {};
    if (hasRequest) {
      const parsed = this.deps.parser.parse(input.request as string);
      body = { ...parsed.body };
    }

    body = this.deps.conflictDetector.applyModelOverride(body, input.model);

    const requestHasInput = Object.prototype.hasOwnProperty.call(body, 'input');
    if (hasText && requestHasInput) {
      throw invalidArg('Text cannot be combined with request.input. Use one or the other.');
    }

    const existingModel =
      typeof body.model === 'string' && body.model.trim().length > 0
        ? (body.model as string)
        : undefined;
    const model = await this.deps.modelResolver.resolve(
      { command: TTS_COMMAND, taskMode: TTS_TASK_MODE },
      input.model ?? existingModel,
    );
    body.model = model;

    if (isMultimodalChatModel(model)) {
      throw invalidArg(
        `"${model}" is a multimodal chat model, not a speech-synthesis model. ` +
          `Use "chat create --model ${model}" instead of "audio speech".`,
      );
    }
    if (isRealtimeOnlyTtsModel(model)) {
      throw invalidArg(
        `"${model}" only supports the realtime streaming protocol and cannot be called from "audio speech". ` +
          'Choose a non-realtime TTS model (drop the "-realtime" suffix).',
      );
    }

    return { body, model, hasText };
  }

  /**
   * Build the WebSocket synthesis request: `parameters` carry voice/format/
   * sample_rate; `input` carries only the text (sent via continue-task).
   */
  async buildWebSocketRequest(
    input: AudioSpeechInput,
  ): Promise<{ model: string; text: string; parameters: Record<string, unknown> }> {
    const { body, model, hasText } = await this.prepareBody(input);

    this.deps.conflictDetector.assertNoConflict(this.layer2Assignments(input), body);

    const requestParams =
      body.parameters && typeof body.parameters === 'object'
        ? (body.parameters as Record<string, unknown>)
        : {};
    const requestInput =
      body.input && typeof body.input === 'object' ? (body.input as Record<string, unknown>) : {};

    const text = hasText
      ? (input.text as string)
      : ((requestInput.text as string | undefined) ?? '');
    if (text.length === 0) {
      throw invalidArg('Provide text or a --request body with input.text for audio speech.');
    }

    const parameters: Record<string, unknown> = {
      text_type: 'PlainText',
      format: DEFAULT_WS_FORMAT,
      sample_rate: DEFAULT_WS_SAMPLE_RATE,
      ...requestParams,
    };
    if (input.voice !== undefined) parameters.voice = input.voice;
    if (parameters.voice === undefined && !model.trim().toLowerCase().startsWith('sambert')) {
      throw invalidArg(
        'CosyVoice requires an explicit --voice (or parameters.voice in --request).',
      );
    }

    return { model, text, parameters };
  }

  extractUrls(upstream: Record<string, unknown>): string[] {
    const output =
      upstream.output && typeof upstream.output === 'object'
        ? (upstream.output as Record<string, unknown>)
        : undefined;
    if (!output) return [];

    const audio = output.audio;
    if (typeof audio === 'string') {
      return isHttpUrl(audio) ? [audio] : [];
    }
    if (audio && typeof audio === 'object') {
      const url = (audio as Record<string, unknown>).url;
      if (typeof url === 'string' && isHttpUrl(url)) return [url];
      return [];
    }

    const url = output.url;
    if (typeof url === 'string' && isHttpUrl(url)) return [url];
    return [];
  }

  async generate(input: AudioSpeechInput): Promise<SuccessEnvelope> {
    const targetModel = await this.resolveModel(input);
    if (requiresWebSocket(targetModel)) {
      return this.generateViaWebSocket(input);
    }

    const { model, body, path } = await this.buildRequest(input);
    const upstream = await this.withVoiceDesignHint(model, () =>
      withFieldRejectionHint(model, () => this.deps.client.generate(body, undefined, path)),
    );
    const urls = this.extractUrls(upstream);
    const artifacts = await this.buildArtifacts(urls, input);

    const audio = buildAudio(artifacts, input.voice);
    const data = audio !== undefined ? { audio } : {};
    return this.deps.envelope.success(data, this.extractMeta(upstream, model));
  }

  /** Resolve the target model without building a request body. */
  private async resolveModel(input: AudioSpeechInput): Promise<string> {
    let requestModel: string | undefined;
    if (typeof input.request === 'string' && input.request.length > 0) {
      const parsed = this.deps.parser.parse(input.request);
      const candidate = (parsed.body as Record<string, unknown>).model;
      if (typeof candidate === 'string' && candidate.trim().length > 0) requestModel = candidate;
    }
    return this.deps.modelResolver.resolve(
      { command: TTS_COMMAND, taskMode: TTS_TASK_MODE },
      input.model ?? requestModel,
    );
  }

  /**
   * qwencloud CosyVoice path: synthesize over WebSocket, save audio locally
   * (raw PCM wrapped as WAV) and return an envelope without `request_id`.
   */
  private async generateViaWebSocket(input: AudioSpeechInput): Promise<SuccessEnvelope> {
    const { model, text, parameters } = await this.buildWebSocketRequest(input);
    const streaming = webSocketStreamingMode(model);
    const result = await this.synthesizeViaWebSocket(model, text, parameters, streaming);

    const format = typeof parameters.format === 'string' ? parameters.format : DEFAULT_WS_FORMAT;
    const sampleRate =
      typeof parameters.sample_rate === 'number' ? parameters.sample_rate : DEFAULT_WS_SAMPLE_RATE;
    const path = this.deps.audioWriter.save(result.audio, {
      format,
      sampleRate,
      model,
      ...(input.out !== undefined ? { out: input.out } : {}),
    });

    const voice = typeof parameters.voice === 'string' ? parameters.voice : undefined;
    const audio: Record<string, unknown> = { path };
    if (voice !== undefined) audio.voice = voice;
    const data = { audio };
    const meta: { model: string; usage?: Record<string, unknown> } = { model };
    if (result.usage !== undefined) meta.usage = result.usage;
    return this.deps.envelope.success(data, meta);
  }

  private async synthesizeViaWebSocket(
    model: string,
    text: string,
    parameters: Record<string, unknown>,
    streaming: 'duplex' | 'out',
  ): Promise<Awaited<ReturnType<TTSWebSocketClient['synthesize']>>> {
    return this.withVoiceDesignHint(model, () =>
      withFieldRejectionHint(model, () =>
        this.deps.wsClient.synthesize({ model, text, parameters, streaming }),
      ),
    );
  }

  /** Add a custom-voice hint when voice-clone/design models reject a system voice. */
  private async withVoiceDesignHint<T>(model: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isVoiceDesignModel(model) && error instanceof CliError) {
        throw new CliError({
          code: error.code,
          message: error.message,
          exitCode: error.exitCode,
          hint: `${model} synthesizes only with a custom voice from voice cloning or voice design; pass its --voice id (system voices are not supported).`,
          ...(error.detail ? { detail: error.detail } : {}),
        });
      }
      throw error;
    }
  }

  private async buildArtifacts(
    urls: string[],
    input: AudioSpeechInput,
  ): Promise<AudioSpeechArtifact[]> {
    if (input.download === false) {
      return urls.map((url) => ({ url }));
    }

    const artifacts: AudioSpeechArtifact[] = [];
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index] as string;
      const path = await this.deps.downloader.download(
        url,
        index,
        input.out,
        audioExtensionFromUrl(url),
      );
      artifacts.push({ url, path });
    }
    return artifacts;
  }

  private extractMeta(
    upstream: Record<string, unknown>,
    model: string,
  ): { requestId?: string; model?: string; usage?: Record<string, unknown> } {
    const meta: { requestId?: string; model?: string; usage?: Record<string, unknown> } = { model };
    if (typeof upstream.request_id === 'string' && upstream.request_id.length > 0) {
      meta.requestId = upstream.request_id;
    }
    const usage = upstream.usage;
    if (usage && typeof usage === 'object') meta.usage = usage as Record<string, unknown>;
    return meta;
  }
}

/** Fold the single synthesized clip into the PRD `data.audio` object. */
function buildAudio(
  artifacts: AudioSpeechArtifact[],
  voice: string | undefined,
): Record<string, unknown> | undefined {
  const first = artifacts[0];
  if (first === undefined) return undefined;
  const audio: Record<string, unknown> = {};
  if (first.url !== undefined) audio.url = first.url;
  if (first.path !== undefined) audio.path = first.path;
  if (voice !== undefined) audio.voice = voice;
  const expiresIn = first.url !== undefined ? expiresInFromUrl(first.url) : undefined;
  if (expiresIn !== undefined) audio.expires_in = expiresIn;
  return audio;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

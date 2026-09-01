/** Local audio file naming and raw-PCM WAV wrapping for WebSocket synthesis. */

import { join } from 'path';

const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const DEFAULT_SAMPLE_RATE = 22050;

export interface AudioFileDeps {
  writeFile: (path: string, bytes: Uint8Array) => void;
  ensureDir: (dir: string) => void;
  isDirectory: (path: string) => boolean;
}

/** Prepend a 44-byte RIFF/WAVE header to raw mono 16-bit PCM samples. */
export function wrapPcmAsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  const out = new Uint8Array(header.length + pcm.length);
  out.set(header, 0);
  out.set(pcm, header.length);
  return out;
}

export class AudioFileWriter {
  constructor(private readonly deps: AudioFileDeps) {}

  /**
   * Save synthesized audio to disk, wrapping raw PCM in a WAV container.
   * When `out` names a directory (or is omitted), a timestamped file is created.
   */
  save(
    audio: Uint8Array,
    options: { format: string; sampleRate: number; model: string; out?: string },
  ): string {
    const format = options.format.trim().toLowerCase();
    const isPcm = format === 'pcm';
    const extension = isPcm ? 'wav' : format;
    const bytes = isPcm ? wrapPcmAsWav(audio, options.sampleRate || DEFAULT_SAMPLE_RATE) : audio;

    const path = this.resolvePath(options.out, options.model, extension);
    this.deps.writeFile(path, bytes);
    return path;
  }

  private resolvePath(out: string | undefined, model: string, extension: string): string {
    const generated = `${sanitize(model)}_${timestamp()}.${extension}`;
    if (out === undefined || out.length === 0) return generated;
    if (out.endsWith('/') || this.deps.isDirectory(out)) {
      const dir = out.replace(/\/+$/, '') || '.';
      this.deps.ensureDir(dir);
      return join(dir, generated);
    }
    return out;
  }
}

function sanitize(model: string): string {
  return model.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'speech';
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Unit tests for local audio file naming and raw-PCM WAV wrapping.
 */
import { describe, it, expect, vi } from 'vitest';
import { AudioFileWriter, wrapPcmAsWav } from '../../src/services/audio-file.js';

describe('wrapPcmAsWav', () => {
  it('prepends a 44-byte RIFF/WAVE header and preserves samples', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = wrapPcmAsWav(pcm, 24000);

    expect(wav.length).toBe(44 + pcm.length);
    expect(Buffer.from(wav.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(wav.subarray(8, 12)).toString('ascii')).toBe('WAVE');
    expect(Buffer.from(wav).readUInt32LE(24)).toBe(24000);
    expect(Array.from(wav.subarray(44))).toEqual([1, 2, 3, 4]);
  });
});

function makeWriter(isDir = false): {
  writer: AudioFileWriter;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const writeFile = vi.fn();
  const writer = new AudioFileWriter({
    writeFile,
    ensureDir: vi.fn(),
    isDirectory: () => isDir,
  });
  return { writer, writeFile };
}

describe('AudioFileWriter.save', () => {
  it('wraps raw PCM as WAV and names the file .wav', () => {
    const { writer, writeFile } = makeWriter();

    const path = writer.save(new Uint8Array([1, 2]), {
      format: 'pcm',
      sampleRate: 24000,
      model: 'cosyvoice-v2',
    });

    expect(path).toMatch(/^cosyvoice-v2_\d{8}-\d{6}\.wav$/);
    const [, bytes] = writeFile.mock.calls[0] as [string, Uint8Array];
    expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
  });

  it('writes non-PCM formats verbatim with the matching extension', () => {
    const { writer, writeFile } = makeWriter();

    const path = writer.save(new Uint8Array([9, 9]), {
      format: 'mp3',
      sampleRate: 22050,
      model: 'cosyvoice-v2',
    });

    expect(path).toMatch(/\.mp3$/);
    const [, bytes] = writeFile.mock.calls[0] as [string, Uint8Array];
    expect(Array.from(bytes)).toEqual([9, 9]);
  });

  it('honors an explicit output file path', () => {
    const { writer } = makeWriter();

    const path = writer.save(new Uint8Array([1]), {
      format: 'mp3',
      sampleRate: 22050,
      model: 'cosyvoice-v2',
      out: 'hello.mp3',
    });

    expect(path).toBe('hello.mp3');
  });

  it('places a generated file inside an output directory', () => {
    const { writer } = makeWriter(true);

    const path = writer.save(new Uint8Array([1]), {
      format: 'mp3',
      sampleRate: 22050,
      model: 'cosyvoice-v2',
      out: 'out-dir',
    });

    expect(path).toMatch(/^out-dir\/cosyvoice-v2_\d{8}-\d{6}\.mp3$/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseSampleFormat,
  detectSampleFormat,
  resetSampleFormat,
  supportsOggOpus,
} from './sampleFormat';

beforeEach(() => resetSampleFormat());

describe('sample format selection', () => {
  it('prefers Ogg Opus and falls back to AAC when it cannot be decoded', () => {
    expect(chooseSampleFormat(true)).toBe('ogg');
    expect(chooseSampleFormat(false)).toBe('m4a');
  });

  it('feeds the decoder a real Ogg Opus stream', async () => {
    const decode = vi.fn(async (bytes: ArrayBuffer) => {
      const head = new Uint8Array(bytes);
      expect(new TextDecoder().decode(head.subarray(0, 4))).toBe('OggS');
      expect(new TextDecoder().decode(head.subarray(28, 36))).toBe('OpusHead');
      return {};
    });
    expect(await supportsOggOpus(decode)).toBe(true);
    expect(decode).toHaveBeenCalledOnce();
  });

  it('treats a decoding failure as no support', async () => {
    expect(await supportsOggOpus(() => Promise.reject(new Error('EncodingError')))).toBe(false);
  });

  it('detects the format once, then remembers it', async () => {
    const decode = vi.fn(() => Promise.reject(new Error('EncodingError')));
    expect(await detectSampleFormat(decode)).toBe('m4a');
    expect(await detectSampleFormat(decode)).toBe('m4a');
    expect(decode).toHaveBeenCalledOnce();
  });

  it('picks Ogg Opus when the browser decodes it', async () => {
    expect(await detectSampleFormat(() => Promise.resolve({}))).toBe('ogg');
  });

  it('falls back to AAC when there is no Web Audio at all', async () => {
    // jsdom has no OfflineAudioContext.
    expect(await detectSampleFormat()).toBe('m4a');
  });
});

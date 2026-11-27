/**
 * Which file format the samples are fetched in. Ogg Opus is the default (smallest). Browsers whose Web Audio cannot
 * decode it (Safari before 26, see docs/playback.md) get the AAC (`.m4a`) twin of every file instead; only one of
 * the two formats is ever downloaded.
 *
 * Capability is tested by decoding, not by `canPlayType`: Web Audio's `decodeAudioData` and the `<audio>` element
 * do not always support the same formats.
 */

export type SampleFormat = 'ogg' | 'm4a';

/** A 123-byte Ogg Opus file (one 20 ms silent frame). Decoding it proves the browser decodes Ogg Opus. */
const PROBE_BASE64 =
  'T2dnUwACAAAAAAAAAAABAAAAAAAAAByf9dkBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAAEAAAABAAAASPrZ9gERT3B1c1RhZ3MBAAAAcAAAAABPZ2dTAAT4BAAAAAAAAAEAAAACAAAAcdtAPAED+P/+';

export type Decode = (bytes: ArrayBuffer) => Promise<unknown>;

function probeBytes(): ArrayBuffer {
  const binary = atob(PROBE_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The browser's own decoder: a throw-away offline context (no audio device, no autoplay restriction). */
const browserDecode: Decode = (bytes) => {
  const Offline: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext === 'undefined'
      ? (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
      : OfflineAudioContext;
  if (!Offline) return Promise.reject(new Error('No Web Audio'));
  return new Offline(1, 1, 44100).decodeAudioData(bytes);
};

/** Pure choice, so the rule is testable: Ogg Opus when it decodes, AAC otherwise. */
export function chooseSampleFormat(oggOpusDecodes: boolean): SampleFormat {
  return oggOpusDecodes ? 'ogg' : 'm4a';
}

/** Decodes the probe; any failure (unsupported format, no Web Audio) means "not supported". */
export async function supportsOggOpus(decode: Decode = browserDecode): Promise<boolean> {
  try {
    await decode(probeBytes());
    return true;
  } catch {
    return false;
  }
}

let detected: Promise<SampleFormat> | undefined;

/** The format to fetch, decided once per page load. */
export function detectSampleFormat(decode?: Decode): Promise<SampleFormat> {
  detected ??= supportsOggOpus(decode).then(chooseSampleFormat);
  return detected;
}

/** Tests only: forget the decision. */
export function resetSampleFormat(): void {
  detected = undefined;
}

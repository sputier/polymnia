/**
 * Sample files by set and pitch. Vite turns each file into a hashed one under /assets (immutable cache, same
 * origin as the page: the Content-Security-Policy allows nothing else). The glob is eager only to get the URL
 * strings; the audio itself is downloaded on demand. Every pitch exists in Ogg Opus (`.ogg`, the default) and in
 * AAC (`.m4a`, for browsers that cannot decode Ogg Opus, see sampleFormat.ts).
 */
import type { SampleSetId } from './instrumentSets';
import type { SampleFormat } from './sampleFormat';

const files = import.meta.glob<string>('./samples/*/*.{ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true,
});

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "Cs3" -> 49 (C#3). `s` stands for a sharp: a `#` would be a URL fragment in module paths. */
export function midiOfFileName(name: string): number | undefined {
  const m = /^([A-G])(s?)(-?\d)$/.exec(name);
  if (!m) return undefined;
  return (Number(m[3]) + 1) * 12 + STEP[m[1]!]! + (m[2] ? 1 : 0);
}

/** MIDI number -> URL for every recorded pitch of a set, in the given format. */
export function sampleUrls(set: SampleSetId, format: SampleFormat = 'ogg'): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const m = /\.\/samples\/([^/]+)\/([^/]+)\.(ogg|m4a)$/.exec(path);
    if (!m || m[1] !== set || m[3] !== format) continue;
    const midi = midiOfFileName(m[2]!);
    if (midi !== undefined) out[midi] = url;
  }
  return out;
}

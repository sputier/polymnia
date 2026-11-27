/**
 * Sample files by set and pitch. Vite turns each .ogg into a hashed file under /assets (immutable
 * cache, same origin as the page: the Content-Security-Policy allows nothing else). The glob is
 * eager only to get the URL strings; the audio itself is downloaded on demand.
 */
import type { SampleSetId } from './instrumentSets';

const files = import.meta.glob<string>('./samples/*/*.ogg', {
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

/** MIDI number -> URL for every recorded pitch of a set. */
export function sampleUrls(set: SampleSetId): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const m = /\.\/samples\/([^/]+)\/([^/]+)\.ogg$/.exec(path);
    if (!m || m[1] !== set) continue;
    const midi = midiOfFileName(m[2]!);
    if (midi !== undefined) out[midi] = url;
  }
  return out;
}

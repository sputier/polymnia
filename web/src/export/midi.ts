/**
 * Standard MIDI File (type 1) encoder. The timing comes from the playback timeline
 * (`buildTimeline`: sounding pitches, ties merged, tuplet-exact ticks), so playback and the file
 * can never disagree. 960 ticks per quarter note is the score's own resolution: triplets and every
 * duration of the model are exact.
 *
 * Track 0 is the conductor (name, tempo map, time and key signatures); then one track per staff
 * with its General MIDI program, on its own channel. Channel 10 (index 9) is percussion in General
 * MIDI and is never used. The 15 other channels limit a file to 15 staves.
 */
import { buildTimeline } from '../playback/timeline';
import { TICKS_PER_QUARTER, getInstrument, keyFifthsAt, timeSignatureAt } from '../score';
import type { Score } from '../score';

export const MIDI_PPQ = TICKS_PER_QUARTER;
const VELOCITY = 80;
/** Pitched channels: everything but index 9 (channel 10). */
const CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;

export interface MidiFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** What the file cannot hold, by name (feeds the export report). */
  readonly dropped: Record<string, number>;
}

class Bytes {
  readonly data: number[] = [];
  u8(v: number): this {
    this.data.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }
  u32(v: number): this {
    return this.u8(v >>> 24)
      .u8(v >>> 16)
      .u8(v >>> 8)
      .u8(v);
  }
  /** Variable-length quantity (7 bits per byte, high bit = more). */
  vlq(v: number): this {
    let n = Math.max(0, Math.floor(v));
    const parts = [n & 0x7f];
    while ((n >>= 7) > 0) parts.unshift((n & 0x7f) | 0x80);
    for (const p of parts) this.u8(p);
    return this;
  }
  bytes(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.data.push(b[i]! & 0xff);
    return this;
  }
}

interface Ev {
  readonly tick: number;
  /** Sort key at equal ticks: meta first, then note off, then note on. */
  readonly order: number;
  readonly bytes: number[];
}

function track(events: Ev[], end: number): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = new Bytes();
  let last = 0;
  for (const e of events) {
    body.vlq(e.tick - last).bytes(e.bytes);
    last = e.tick;
  }
  body.vlq(Math.max(0, end - last)).bytes([0xff, 0x2f, 0x00]); // end of track, at the end of the music
  const out = new Bytes().bytes([0x4d, 0x54, 0x72, 0x6b]).u32(body.data.length).bytes(body.data);
  return Uint8Array.from(out.data);
}

const text = (type: number, value: string): number[] => {
  const data = Array.from(new TextEncoder().encode(value)).slice(0, 127);
  return [0xff, type, data.length, ...data];
};

/** Track name text must not hold more than a short label; names are clipped by bytes, not chars. */
const clip = (s: string) => (s.length > 40 ? s.slice(0, 40) : s);

/** Encodes `score` as a Standard MIDI File, format 1. */
export function encodeMidi(score: Score, title = score.meta.title): MidiFile {
  const timeline = buildTimeline(score);
  const dropped: Record<string, number> = {};
  const drop = (name: string, n = 1) => (dropped[name] = (dropped[name] ?? 0) + n);
  const tick = (t: number) => Math.round(t);

  // Conductor track.
  const conductor: Ev[] = [];
  if (title.trim() !== '') conductor.push({ tick: 0, order: 0, bytes: text(0x03, clip(title)) });
  for (const seg of timeline.tempo) {
    const mpq = Math.round(60_000_000 / seg.bpm);
    conductor.push({
      tick: tick(seg.tick),
      order: 1,
      bytes: [0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff],
    });
  }
  let prevTime = '';
  let prevKey: number | undefined;
  score.measures.forEach((_, m) => {
    const at = tick(timeline.measureStarts[m] ?? 0);
    const t = timeSignatureAt(score, m);
    const timeKey = `${t.beats}/${t.beatType}`;
    if (timeKey !== prevTime) {
      prevTime = timeKey;
      // nn dd cc bb: numerator, denominator as a power of two, 24 clocks per click, 8 32nds per quarter.
      conductor.push({
        tick: at,
        order: 2,
        bytes: [0xff, 0x58, 0x04, t.beats, Math.log2(t.beatType), 24, 8],
      });
    }
    const fifths = keyFifthsAt(score, m);
    if (fifths !== prevKey) {
      prevKey = fifths;
      conductor.push({ tick: at, order: 3, bytes: [0xff, 0x59, 0x02, fifths & 0xff, 0x00] });
    }
  });
  // The end of the conductor track marks the end of the music even when the last notes are rests.
  const total = tick(timeline.totalTicks);

  const tracks: Uint8Array[] = [track(conductor, total)];
  timeline.staves.forEach((staff, index) => {
    const channel = CHANNELS[index];
    if (channel === undefined) {
      drop('midi-staff-over-15-channels');
      return;
    }
    const part = score.parts[staff.partIndex]!;
    const partStaves = part.staves.length;
    const label = partStaves > 1 ? `${part.name} ${staff.staffIndex + 1}` : part.name;
    const events: Ev[] = [
      { tick: 0, order: 0, bytes: text(0x03, clip(label)) },
      {
        tick: 0,
        order: 1,
        bytes: [0xc0 | channel, getInstrument(part.instrument)?.gmProgram ?? 0],
      },
    ];
    for (const note of timeline.notes) {
      if (note.staffId !== staff.staffId) continue;
      if (note.midi < 0 || note.midi > 127) {
        drop('midi-pitch-out-of-range');
        continue;
      }
      const on = tick(note.startTick);
      const off = Math.max(on + 1, tick(note.endTick));
      events.push({ tick: on, order: 5, bytes: [0x90 | channel, note.midi, VELOCITY] });
      events.push({ tick: off, order: 4, bytes: [0x80 | channel, note.midi, 0] });
    }
    tracks.push(track(events, total));
  });

  const header = new Bytes()
    .bytes([0x4d, 0x54, 0x68, 0x64])
    .u32(6)
    .u16(1)
    .u16(tracks.length)
    .u16(MIDI_PPQ);
  const size = header.data.length + tracks.reduce((s, t) => s + t.length, 0);
  const out = new Uint8Array(size);
  out.set(header.data, 0);
  let at = header.data.length;
  for (const t of tracks) {
    out.set(t, at);
    at += t.length;
  }
  return { bytes: out, dropped };
}

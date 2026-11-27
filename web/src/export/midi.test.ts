import { describe, expect, it } from 'vitest';
import { buildScore } from '../score/fixtures/dsl';
import { benchmarkScore } from '../engraving/previewScores';
import { encodeMidi, MIDI_PPQ } from './midi';

// A tiny Standard MIDI File reader, written independently from the encoder.
interface MidiEvent {
  tick: number;
  type: 'on' | 'off' | 'program' | 'tempo' | 'time' | 'key' | 'name' | 'end';
  channel?: number;
  a?: number;
  b?: number;
  text?: string;
}
interface Parsed {
  format: number;
  division: number;
  tracks: MidiEvent[][];
}

function parse(bytes: Uint8Array): Parsed {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n));
  expect(str(0, 4)).toBe('MThd');
  expect(view.getUint32(4)).toBe(6);
  const format = view.getUint16(8);
  const count = view.getUint16(10);
  const division = view.getUint16(12);
  let at = 14;
  const tracks: MidiEvent[][] = [];
  for (let t = 0; t < count; t++) {
    expect(str(at, 4)).toBe('MTrk');
    const end = at + 8 + view.getUint32(at + 4);
    at += 8;
    const events: MidiEvent[] = [];
    let tick = 0;
    let status = 0;
    const vlq = () => {
      let v = 0;
      for (;;) {
        const b = bytes[at++]!;
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };
    while (at < end) {
      tick += vlq();
      let first = bytes[at++]!;
      if (first < 0x80) {
        at--;
        first = status;
      } else if (first < 0xf0) status = first;
      if (first === 0xff) {
        const type = bytes[at++]!;
        const len = vlq();
        const data = bytes.slice(at, at + len);
        at += len;
        if (type === 0x2f) events.push({ tick, type: 'end' });
        else if (type === 0x51) {
          events.push({ tick, type: 'tempo', a: (data[0]! << 16) | (data[1]! << 8) | data[2]! });
        } else if (type === 0x58)
          events.push({ tick, type: 'time', a: data[0]!, b: 2 ** data[1]! });
        else if (type === 0x59) events.push({ tick, type: 'key', a: (data[0]! << 24) >> 24 });
        else if (type === 0x03)
          events.push({ tick, type: 'name', text: new TextDecoder().decode(data) });
      } else {
        const kind = first & 0xf0;
        const channel = first & 0x0f;
        if (kind === 0xc0) events.push({ tick, type: 'program', channel, a: bytes[at++]! });
        else {
          const a = bytes[at++]!;
          const b = bytes[at++]!;
          if (kind === 0x90 && b > 0) events.push({ tick, type: 'on', channel, a, b });
          else if (kind === 0x80 || kind === 0x90)
            events.push({ tick, type: 'off', channel, a, b });
        }
      }
    }
    expect(at).toBe(end);
    tracks.push(events);
  }
  return { format, division, tracks };
}

/** [pitch, start, end] of every note of a track, in order of start. */
function notes(track: MidiEvent[]): [number, number, number][] {
  const open = new Map<number, number[]>();
  const out: [number, number, number][] = [];
  for (const e of track) {
    if (e.type === 'on') open.set(e.a!, [...(open.get(e.a!) ?? []), e.tick]);
    if (e.type === 'off') {
      const starts = open.get(e.a!);
      const start = starts?.shift();
      expect(start).toBeDefined();
      out.push([e.a!, start!, e.tick]);
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

const one = (measures: string[], instrument = 'flute', extra: Record<string, unknown> = {}) =>
  buildScore({
    title: 'Song',
    parts: [{ name: 'Part', instrument, staves: [{ measures }] }],
    ...extra,
  });

describe('encodeMidi', () => {
  it('writes a format 1 file with 960 ticks per quarter, a conductor track and one track per staff', () => {
    const score = buildScore({
      title: 'Duo',
      parts: [
        {
          name: 'Piano',
          instrument: 'piano',
          staves: [{ measures: ['C5:w'] }, { clef: 'bass', measures: ['C3:w'] }],
        },
        { name: 'Flute', instrument: 'flute', staves: [{ measures: ['E5:w'] }] },
      ],
    });
    const { bytes } = encodeMidi(score);
    const midi = parse(bytes);
    expect(midi.format).toBe(1);
    expect(midi.division).toBe(MIDI_PPQ);
    expect(midi.division).toBe(960);
    expect(midi.tracks).toHaveLength(4);
    expect(midi.tracks[0]!.find((e) => e.type === 'name')?.text).toBe('Duo');
    expect(midi.tracks.slice(1).map((t) => t.find((e) => e.type === 'name')?.text)).toEqual([
      'Piano 1',
      'Piano 2',
      'Flute',
    ]);
    expect(notes(midi.tracks[1]!)).toEqual([[72, 0, 3840]]);
    expect(notes(midi.tracks[2]!)).toEqual([[48, 0, 3840]]);
    for (const t of midi.tracks) expect(t.at(-1)).toMatchObject({ type: 'end', tick: 3840 });
  });

  it('maps instruments to General MIDI programs and never uses channel 10', () => {
    const parts = ['piano', 'voice', 'flute', 'clarinet', 'double-bass', 'violin', 'cello'].map(
      (instrument) => ({ name: instrument, instrument, staves: [{ measures: ['C4:w'] }] }),
    );
    const many = buildScore({ title: 'Many', parts });
    const midi = parse(encodeMidi(many).bytes);
    const programs = midi.tracks.slice(1).map((t) => t.find((e) => e.type === 'program')!);
    expect(programs.map((p) => p.a)).toEqual([0, 52, 73, 71, 43, 40, 42]);
    const used = new Set(
      midi.tracks.slice(1).map((t) => t.find((e) => e.type === 'program')!.channel),
    );
    expect(used.size).toBe(7);

    // 20 staves: channels 0-8 and 10-15 only (15 staves), the others are reported.
    const twenty = buildScore({
      title: 'Twenty',
      parts: Array.from({ length: 20 }, (_, i) => ({
        name: `P${i}`,
        instrument: 'flute',
        staves: [{ measures: ['C5:w'] }],
      })),
    });
    const file = encodeMidi(twenty);
    const parsed = parse(file.bytes);
    expect(parsed.tracks).toHaveLength(16);
    const channels = new Set(
      parsed.tracks.flatMap((t) => t.filter((e) => e.type === 'on').map((e) => e.channel)),
    );
    expect(channels.has(9)).toBe(false);
    expect(channels.size).toBe(15);
    expect(file.dropped).toEqual({ 'midi-staff-over-15-channels': 5 });
  });

  it('writes the sounding pitch: transposing instruments and octave transposition', () => {
    // Written C5 on a clarinet in B-flat sounds B-flat 4; a written C3 on a double bass sounds C2.
    const clarinet = parse(encodeMidi(one(['C5:q'], 'clarinet')).bytes);
    expect(notes(clarinet.tracks[1]!)[0]![0]).toBe(70);
    const bass = parse(encodeMidi(one(['C3:q'], 'double-bass')).bytes);
    expect(notes(bass.tracks[1]!)[0]![0]).toBe(36);
  });

  it('merges ties into one note, also across barlines and chords', () => {
    const score = one(['C4:h C4:h~', 'C4:h E4:h'], 'flute');
    const track = parse(encodeMidi(score).bytes).tracks[1]!;
    expect(notes(track)).toEqual([
      [60, 0, 1920],
      [60, 1920, 5760],
      [64, 5760, 7680],
    ]);
    expect(track.filter((e) => e.type === 'on')).toHaveLength(3);

    const chord = one(['r:h C4+E4:h~', 'C4+G4:h r:h']);
    const merged = notes(parse(encodeMidi(chord).bytes).tracks[1]!);
    expect(merged).toEqual([
      [60, 1920, 5760],
      [64, 1920, 3840],
      [67, 3840, 5760],
    ]);
  });

  it('keeps triplets exact on the 960 grid', () => {
    const score = one(['(3 C5:e D5:e E5:e) F5:q G5:h']);
    const track = parse(encodeMidi(score).bytes).tracks[1]!;
    expect(notes(track)).toEqual([
      [72, 0, 320],
      [74, 320, 640],
      [76, 640, 960],
      [77, 960, 1920],
      [79, 1920, 3840],
    ]);
    const quintuplets = one(['(5 C5:s D5:s E5:s F5:s G5:s) C5:h.']);
    const ends = notes(parse(encodeMidi(quintuplets).bytes).tracks[1]!).map((n) => n[2]);
    expect(ends.slice(0, 5)).toEqual([192, 384, 576, 768, 960]);
  });

  it('writes the tempo map, time signatures and key signatures on the conductor track', () => {
    const score = one(['C4:w', 'C4:h. r:q', 'C4:q D4:q E4:q'], 'flute', {
      tempoBpm: 120,
      keyFifths: 2,
      measureInfo: {
        1: { time: { beats: 3, beatType: 4 }, tempoBpm: 90, keyFifths: -1 },
        2: { time: { beats: 3, beatType: 4 } },
      },
    });
    const conductor = parse(encodeMidi(score).bytes).tracks[0]!;
    expect(conductor.filter((e) => e.type === 'tempo').map((e) => [e.tick, e.a])).toEqual([
      [0, 500000],
      [3840, Math.round(60_000_000 / 90)],
    ]);
    expect(conductor.filter((e) => e.type === 'time').map((e) => [e.tick, e.a, e.b])).toEqual([
      [0, 4, 4],
      [3840, 3, 4],
    ]);
    expect(conductor.filter((e) => e.type === 'key').map((e) => [e.tick, e.a])).toEqual([
      [0, 2],
      [3840, -1],
    ]);
  });

  it('encodes a pickup measure from its real length', () => {
    const score = one(['G4:q', 'C5:h. r:q'], 'flute', { measureInfo: { 0: { length: 960 } } });
    const track = parse(encodeMidi(score).bytes).tracks[1]!;
    expect(notes(track)).toEqual([
      [67, 0, 960],
      [72, 960, 960 + 2880],
    ]);
  });

  it('ends notes before the next one of the same pitch starts and sorts events by time', () => {
    const track = parse(encodeMidi(one(['C4:q C4:q C4:h'])).bytes).tracks[1]!;
    const seq = track
      .filter((e) => e.type === 'on' || e.type === 'off')
      .map((e) => [e.type, e.tick]);
    expect(seq).toEqual([
      ['on', 0],
      ['off', 960],
      ['on', 960],
      ['off', 1920],
      ['on', 1920],
      ['off', 3840],
    ]);
  });

  it('is fast on a 100 measure score', () => {
    const score = benchmarkScore(100);
    encodeMidi(score);
    const start = performance.now();
    const { bytes } = encodeMidi(score);
    const ms = performance.now() - start;
    expect(parse(bytes).tracks).toHaveLength(3);
    expect(ms).toBeLessThan(50);
  });
});

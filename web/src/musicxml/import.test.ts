import { describe, expect, it } from 'vitest';
import { clefAt, validateScore, type Score } from '../score';
import { importMusicXml, packMxl, parseMusicXml } from './index';
import { readFixture as fixture } from './testing';

/** `pitch` helper: "C4" "F#4" "Bb3" -> compact description of every note of a voice. */
function describeVoice(score: Score, part: number, staff: number, measure: number, voice = 0) {
  return score.parts[part]!.staves[staff]!.measures[measure]!.voices[voice]!.events.map((e) =>
    e.kind === 'rest'
      ? `r:${e.duration.base}${'.'.repeat(e.duration.dots)}`
      : `${e.pitches
          .map(
            (p) =>
              `${p.step}${p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)}${p.octave}`,
          )
          .join('+')}:${e.duration.base}${'.'.repeat(e.duration.dots)}`,
  );
}

describe('import: editor-style file (divisions 2, two staves, voices, backup, forward)', () => {
  const { score, report } = parseMusicXml(fixture('ode-to-joy-style.musicxml'));

  it('reads the metadata, the structure and the tempo', () => {
    expect(validateScore(score)).toEqual([]);
    expect(score.meta).toEqual({
      title: 'Ode to Joy',
      composer: 'Ludwig van Beethoven',
      tempoBpm: 108,
    });
    expect(score.measures).toHaveLength(4);
    expect(score.parts).toHaveLength(1);
    const part = score.parts[0]!;
    expect(part.name).toBe('Piano');
    expect(part.instrument).toBe('piano');
    expect(part.staves.map((s) => s.clef)).toEqual(['treble', 'bass']);
  });

  it('reads voices (voice 1 is our voice 0, forward becomes a rest)', () => {
    expect(describeVoice(score, 0, 0, 0)).toEqual([
      'E4:quarter',
      'E4:quarter',
      'F4:quarter',
      'G4:quarter',
    ]);
    expect(describeVoice(score, 0, 0, 0, 1)).toEqual(['C4:half', 'r:half']);
    expect(score.parts[0]!.staves[0]!.measures[1]!.voices).toHaveLength(1);
    // MusicXML voice 5 on the second staff is that staff's first voice.
    expect(describeVoice(score, 0, 1, 0)).toEqual(['C3:whole']);
    expect(describeVoice(score, 0, 0, 3)).toEqual(['E4:quarter.', 'D4:eighth', 'D4:half']);
  });

  it('reads ties and slurs', () => {
    const bass = describeVoice(score, 0, 1, 1);
    expect(bass).toEqual(['C3:half', 'C3:half']);
    expect(score.parts[0]!.staves[1]!.measures[1]!.voices[0]!.events[0]).toMatchObject({
      pitches: [{ tieToNext: true }],
    });
    expect(score.slurs).toHaveLength(1);
  });

  it('reports what it dropped, by element type', () => {
    expect(report.dropped).toEqual({ credit: 1, dynamics: 1, lyric: 1, staccato: 2 });
    expect(report.adjusted).toEqual({});
  });
});

describe('import: pickup, changes, dotted metronome, untagged triplet', () => {
  const { score, report } = parseMusicXml(fixture('susanna-pickup-changes.musicxml'));

  it('is valid with a pickup measure', () => {
    expect(validateScore(score)).toEqual([]);
    expect(score.measures[0]).toMatchObject({
      time: { beats: 2, beatType: 4 },
      keyFifths: 0,
      length: 960,
    });
    expect(describeVoice(score, 0, 0, 0)).toEqual(['C4:eighth', 'D4:eighth']);
  });

  it('reads key, time and tempo changes', () => {
    expect(score.meta.tempoBpm).toBe(100);
    expect(score.measures[2]).toMatchObject({ keyFifths: 1, tempoBpm: 90 });
    expect(score.measures[3]).toMatchObject({ time: { beats: 3, beatType: 4 }, tempoBpm: 120 });
  });

  it('groups the triplet even without tuplet marks', () => {
    const voice = score.parts[0]!.staves[0]!.measures[2]!.voices[0]!;
    expect(voice.tuplets).toHaveLength(1);
    expect(voice.tuplets[0]).toMatchObject({ actual: 3, normal: 2 });
    expect(describeVoice(score, 0, 0, 2)).toEqual([
      'F#4:quarter',
      'G4:eighth',
      'A4:eighth',
      'B4:eighth',
    ]);
  });

  it('reads clef changes, including one written at the end of the previous measure', () => {
    const staff = score.parts[0]!.staves[0]!;
    expect(staff.clef).toBe('treble');
    expect(clefAt(staff, 2)).toBe('treble');
    expect(staff.measures[3]!.clef).toBe('bass');
    expect(staff.measures[4]!.clef).toBe('treble');
  });

  it('has nothing to report', () => {
    expect(report.dropped).toEqual({});
  });
});

describe('import: tablature, tuning, capo, transposition', () => {
  const { score, report } = parseMusicXml(fixture('guitar-tab-drop-d-capo.musicxml'));

  it('maps the instrument, transposition, tuning (high to low) and capo', () => {
    expect(validateScore(score)).toEqual([]);
    const part = score.parts[0]!;
    expect(part.instrument).toBe('guitar-steel');
    expect(part.transposition).toBe(-12);
    expect(part.capo).toBe(2);
    expect(part.tuning!.map((p) => `${p.step}${p.octave}`)).toEqual([
      'E4',
      'B3',
      'G3',
      'D3',
      'A2',
      'D2',
    ]);
  });

  it('reads the tab staff and the string/fret of every note', () => {
    const part = score.parts[0]!;
    expect(part.staves.map((s) => s.type)).toEqual(['standard', 'tab']);
    expect(part.staves[0]!.clef).toBe('treble-8vb');
    const notes = part.staves[1]!.measures[0]!.voices[0]!.events;
    expect(notes.map((e) => (e.kind === 'note' ? e.pitches[0]!.fretting : undefined))).toEqual([
      { string: 5, fret: 1 },
      { string: 5, fret: 3 },
      { string: 4, fret: 0 },
      { string: 5, fret: 1 },
    ]);
    expect(report.dropped).toEqual({});
  });
});

describe('import: unsupported elements', () => {
  const { score, report } = parseMusicXml(fixture('unsupported-elements.musicxml'));

  it('keeps the music and counts every dropped element type', () => {
    expect(validateScore(score)).toEqual([]);
    expect(describeVoice(score, 0, 0, 0)).toEqual([
      'C4:quarter',
      'D4:quarter',
      'E4:quarter',
      'F4:quarter',
    ]);
    // The unpitched note became a rest; the microtone was rounded.
    expect(describeVoice(score, 0, 0, 1)).toEqual([
      'r:quarter',
      'G4:quarter',
      'A#4:quarter',
      'B3:quarter',
    ]);
    expect(describeVoice(score, 0, 0, 2)).toEqual(['r:whole']);
    expect(report.dropped).toEqual({
      grace: 1,
      'trill-mark': 1,
      fermata: 1,
      accent: 1,
      staccato: 1,
      words: 1,
      wedge: 1,
      lyric: 1,
      harmony: 1,
      unpitched: 1,
      repeat: 2,
      ending: 1,
      'clef (mid-measure)': 1,
      'up-bow': 1,
      fingering: 1,
      'part-group': 2,
    });
    expect(report.adjusted).toEqual({ 'alter (microtone)': 1 });
  });
});

describe('import: containers and encodings', () => {
  it('reads a compressed .mxl', () => {
    const xml = fixture('ode-to-joy-style.musicxml');
    const { score } = importMusicXml(packMxl(xml));
    expect(score.meta.title).toBe('Ode to Joy');
    expect(score.measures).toHaveLength(4);
  });

  it('reads UTF-8 bytes with a BOM and a declared ISO-8859-1 encoding', () => {
    const latin = fixture('guitar-tab-drop-d-capo.musicxml')
      .replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
      .replace('Frere Jacques (tab)', 'Frère Jacques');
    const bytes = Uint8Array.from(Array.from(latin, (c) => c.charCodeAt(0) & 0xff));
    expect(importMusicXml(bytes).score.meta.title).toBe('Frère Jacques');
    const utf8 = new TextEncoder().encode('﻿' + fixture('guitar-tab-drop-d-capo.musicxml'));
    expect(importMusicXml(utf8).score.meta.title).toBe('Frere Jacques (tab)');
  });

  it('rejects documents that are not partwise MusicXML', () => {
    expect(() => parseMusicXml('<score-timewise version="4.0"/>')).toThrow(/imewise/);
    expect(() => parseMusicXml('<html/>')).toThrow(/Not a MusicXML/);
    expect(() => parseMusicXml('<score-partwise><part-list/></score-partwise>')).toThrow(/no part/);
  });
});

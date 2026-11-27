import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../score';
import { SAMPLE_SET_IDS, sampleSetFor } from './instrumentSets';
import { midiOfFileName, sampleUrls } from './sampleUrls';

describe('sample sets', () => {
  it('has a recording for every set, covering about two octaves', () => {
    for (const id of SAMPLE_SET_IDS) {
      const midis = Object.keys(sampleUrls(id))
        .map(Number)
        .sort((a, b) => a - b);
      expect(midis.length, id).toBeGreaterThanOrEqual(7);
      expect(midis.at(-1)! - midis[0]!, id).toBeGreaterThanOrEqual(20);
      // No hole wider than an octave: pitch shifting stays moderate.
      for (let i = 1; i < midis.length; i++)
        expect(midis[i]! - midis[i - 1]!, id).toBeLessThanOrEqual(13);
    }
  });

  it('every catalog instrument resolves to a set that exists', () => {
    for (const instrument of INSTRUMENTS) {
      const choice = sampleSetFor(instrument.id);
      expect(SAMPLE_SET_IDS).toContain(choice.set);
    }
  });

  it('has a recording for every catalog instrument: no stand-in left in the catalog', () => {
    const standIns = INSTRUMENTS.filter((i) => sampleSetFor(i.id).standIn).map((i) => i.id);
    expect(standIns).toEqual([]);
    expect(sampleSetFor('guitar-classical')).toEqual({ set: 'guitar-nylon', standIn: false });
    expect(sampleSetFor('guitar-steel')).toEqual({ set: 'guitar-steel', standIn: false });
    expect(sampleSetFor('voice')).toEqual({ set: 'voice', standIn: false });
    expect(sampleSetFor('ukulele-concert').set).toBe('ukulele');
  });

  it('has an AAC twin for every Ogg Opus file, on the same pitches (Safari fallback)', () => {
    for (const id of SAMPLE_SET_IDS) {
      const ogg = Object.keys(sampleUrls(id, 'ogg'));
      const m4a = Object.keys(sampleUrls(id, 'm4a'));
      expect(ogg.length, id).toBeGreaterThan(0);
      expect(m4a, id).toEqual(ogg);
    }
  });

  it('serves a different file per format', () => {
    const [midi] = Object.keys(sampleUrls('voice', 'ogg'));
    expect(sampleUrls('voice', 'ogg')[Number(midi)]).toMatch(/\.ogg$/);
    expect(sampleUrls('voice', 'm4a')[Number(midi)]).toMatch(/\.m4a$/);
    expect(sampleUrls('voice')).toEqual(sampleUrls('voice', 'ogg'));
  });

  it('plays unknown instruments as a piano', () => {
    expect(sampleSetFor('theremin')).toEqual({ set: 'piano', standIn: true });
  });

  it('keeps each instrument within its download budget (250 KB Ogg Opus, 310 KB AAC)', () => {
    const root = resolve(process.cwd(), 'src', 'playback', 'samples');
    for (const id of SAMPLE_SET_IDS) {
      const files = readdirSync(resolve(root, id));
      const kb = (ext: string) =>
        files
          .filter((f) => f.endsWith(ext))
          .reduce((sum, f) => sum + statSync(resolve(root, id, f)).size, 0) / 1000;
      expect(kb('.ogg'), id).toBeLessThanOrEqual(250);
      expect(kb('.m4a'), id).toBeLessThanOrEqual(310);
    }
  });

  it('reads file names as MIDI numbers', () => {
    expect(midiOfFileName('C4')).toBe(60);
    expect(midiOfFileName('Cs4')).toBe(61);
    expect(midiOfFileName('A0')).toBe(21);
    expect(midiOfFileName('Fs1')).toBe(30);
    expect(midiOfFileName('H4')).toBeUndefined();
  });
});

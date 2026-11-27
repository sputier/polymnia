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

  it('flags the stand-ins, and only those', () => {
    const standIns = INSTRUMENTS.filter((i) => sampleSetFor(i.id).standIn).map((i) => i.id);
    expect(standIns.sort()).toEqual(['guitar-steel', 'voice']);
    expect(sampleSetFor('guitar-classical')).toEqual({ set: 'guitar-nylon', standIn: false });
    expect(sampleSetFor('ukulele-concert').set).toBe('ukulele');
  });

  it('plays unknown instruments as a piano', () => {
    expect(sampleSetFor('theremin')).toEqual({ set: 'piano', standIn: true });
  });

  it('reads file names as MIDI numbers', () => {
    expect(midiOfFileName('C4')).toBe(60);
    expect(midiOfFileName('Cs4')).toBe(61);
    expect(midiOfFileName('A0')).toBe(21);
    expect(midiOfFileName('Fs1')).toBe(30);
    expect(midiOfFileName('H4')).toBeUndefined();
  });
});

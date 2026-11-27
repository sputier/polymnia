import { describe, expect, it } from 'vitest';
import { en, type MessageKey } from '../../i18n/en';
import { fr } from '../../i18n/fr';
import { createScore } from '../../score';
import {
  describeMeasure,
  describePlaybackChange,
  MEASURE_DESCRIPTION_LIMIT,
  type PlaybackStatusName,
} from './describe';
import { EditorStore } from './editorStore';

const tEn = (key: MessageKey) => en[key];
const tFr = (key: MessageKey) => fr[key];

function scoreWith(count: number) {
  const store = new EditorStore(createScore({ measures: 4, instruments: ['piano'] }));
  store.toggleInputMode();
  // Sixteenth notes: 16 fit in a 4/4 measure, the description limit is reached with a few more measures' worth.
  store.setDuration('16th');
  for (let i = 0; i < count; i++) store.enterStep('C');
  return store.getState();
}

describe('describeMeasure (text alternative of a measure)', () => {
  it('names the measure and lists its events in order, in English', () => {
    const state = scoreWith(0);
    expect(describeMeasure(state.score, state.staffId, 0, 0, tEn)).toBe('Measure 1: rest whole');
  });

  it('follows the language', () => {
    const state = scoreWith(0);
    expect(describeMeasure(state.score, state.staffId, 0, 0, tFr)).toMatch(/^Mesure 1: /);
  });

  it('describes pitches and durations, rests included', () => {
    const state = scoreWith(2);
    const text = describeMeasure(state.score, state.staffId, 0, 0, tEn);
    expect(text).toBe(
      'Measure 1: C5 sixteenth, C5 sixteenth, rest eighth, rest quarter, rest half',
    );
  });

  it('says "empty" for a voice with no event', () => {
    const state = scoreWith(0);
    expect(describeMeasure(state.score, state.staffId, 1, 0, tEn)).toBe('Measure 1: empty');
  });

  it('summarises what is past the limit ("and N more")', () => {
    const store = new EditorStore(createScore({ measures: 1, instruments: ['piano'] }));
    store.toggleInputMode();
    store.setDuration('32nd');
    for (let i = 0; i < 32; i++) store.enterStep('C');
    const state = store.getState();
    const text = describeMeasure(state.score, state.staffId, 0, 0, tEn);
    expect(text.split(', ')).toHaveLength(MEASURE_DESCRIPTION_LIMIT + 1);
    expect(text.endsWith(', and 8 more')).toBe(true);
  });

  it('returns nothing for an unknown staff or measure', () => {
    const state = scoreWith(0);
    expect(describeMeasure(state.score, 'nope', 0, 0, tEn)).toBe('');
    expect(describeMeasure(state.score, state.staffId, 0, 99, tEn)).toBe('');
  });
});

describe('describePlaybackChange (start, pause and stop only)', () => {
  const cases: [PlaybackStatusName, PlaybackStatusName, string][] = [
    ['stopped', 'playing', 'Playback started'],
    ['playing', 'paused', 'Playback paused'],
    ['paused', 'playing', 'Playback started'],
    ['playing', 'stopped', 'Playback stopped'],
  ];
  it.each(cases)('%s to %s says %s', (from, to, text) => {
    expect(describePlaybackChange(from, to, tEn)).toBe(text);
  });

  it('says nothing when the status did not change, and speaks French', () => {
    expect(describePlaybackChange('playing', 'playing', tEn)).toBe('');
    expect(describePlaybackChange('stopped', 'playing', tFr)).toBe('Lecture démarrée');
  });
});

describe('EditorStore.describeMeasure', () => {
  it('announces the measure of the selection, or of the cursor', () => {
    const store = new EditorStore(createScore({ measures: 4, instruments: ['piano'] }));
    store.goToMeasure(2);
    store.describeMeasure();
    const ann = store.getState().announcement;
    expect(ann && 'measure' in ann ? ann.measure.index : -1).toBe(2);
  });
});

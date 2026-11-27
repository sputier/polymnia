import { expect, test } from 'vitest';
import { buildScore } from './fixtures/dsl';
import { deserialize, History, putEvent, serialize, setPitch } from './index';

/** 500 measures x 4 staves (piano grand staff, violin, cello), about 8000 events. */
function bigScore() {
  const staff = (clef: 'treble' | 'bass', notes: string) => ({
    clef,
    measures: Array.from({ length: 500 }, () => notes),
  });
  return buildScore({
    title: 'Bench',
    parts: [
      {
        name: 'Piano',
        instrument: 'piano',
        staves: [staff('treble', 'C5:q D5:q E5:q F5:q'), staff('bass', 'C3:h G2:h')],
      },
      {
        name: 'Violin',
        instrument: 'violin',
        staves: [staff('treble', 'G4:e A4:e B4:e C5:e D5:q E5:q')],
      },
      { name: 'Cello', instrument: 'cello', staves: [staff('bass', 'C3:q C3:q D3:h')] },
    ],
  });
}

const score = bigScore();
const json = serialize(score);
// An event in the middle of the score, on the last staff.
const target = score.parts[2]!.staves[0]!.measures[250]!.voices[0]!.events[1]!.id;
const edit = setPitch({ eventId: target, pitch: { step: 'E', alter: 0, octave: 3 } });
const insert = putEvent({
  staffId: score.parts[2]!.staves[0]!.id,
  measure: 250,
  tick: 960,
  event: {
    kind: 'note',
    duration: { base: 'quarter', dots: 0 },
    pitches: [{ step: 'F', alter: 0, octave: 3 }],
  },
});

// Budgets from the issue: edit + undo < 1 ms, serialize < 20 ms (means, in milliseconds).
test('500 measures x 4 staves', async ({ bench }) => {
  const history = new History(score);
  const editUndo = await bench('apply + undo of setPitch', () => {
    history.execute(edit);
    history.undo();
  }).run();
  const putUndo = await bench('apply + undo of putEvent (overwrite)', () => {
    history.execute(insert);
    history.undo();
  }).run();
  const ser = await bench('serialize', () => {
    serialize(score);
  }).run();
  const de = await bench('deserialize (decode + validate)', () => {
    deserialize(json);
  }).run();

  console.log(
    [
      `setPitch apply+undo   mean ${editUndo.latency.mean.toFixed(4)} ms`,
      `putEvent apply+undo   mean ${putUndo.latency.mean.toFixed(4)} ms`,
      `serialize             mean ${ser.latency.mean.toFixed(3)} ms (${(json.length / 1e6).toFixed(2)} MB)`,
      `deserialize           mean ${de.latency.mean.toFixed(3)} ms`,
    ].join('\n'),
  );
  expect(editUndo.latency.mean).toBeLessThan(1);
  expect(putUndo.latency.mean).toBeLessThan(1);
  expect(ser.latency.mean).toBeLessThan(20);
});

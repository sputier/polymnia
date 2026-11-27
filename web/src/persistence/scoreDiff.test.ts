import { describe, expect, it } from 'vitest';
import type { ScoreOp } from '../api/scoreOps';
import {
  addPart,
  addSlur,
  CommandError,
  createScore,
  deleteEvent,
  deleteMeasure,
  History,
  insertMeasure,
  movePart,
  removePart,
  renamePart,
  setKeySignature,
  setPitch,
  setTempo,
  transpose,
  validateScore,
  type Command,
  type Score,
} from '../score';
import { FIXTURES, guitarArpeggio, pianoGrandStaff } from '../score/fixtures';
import { diffScores, PATCH_MAX_BYTES, PATCH_MAX_OPS } from './scoreDiff';
import { ScoreSync } from './scoreSync';

/** The server's semantics (docs/api.md, "Incremental updates"), on a copy of the score. */
function applyOps(score: Score, ops: readonly ScoreOp[]): Score {
  const doc = structuredClone(score) as unknown as {
    meta: unknown;
    slurs: unknown;
    measures: unknown[];
    parts: { id: string; staves: { id: string; measures: unknown[] }[] }[];
  };
  const staff = (id: string) => doc.parts.flatMap((p) => p.staves).find((s) => s.id === id)!;
  const m = (id: string) => doc.measures.findIndex((x) => (x as { id: string }).id === id);
  for (const o of ops) {
    switch (o.op) {
      case 'setMeta':
        doc.meta = o.meta;
        break;
      case 'setMeasureInfo':
        doc.measures[m(o.measureId)] = o.value;
        break;
      case 'setStaffMeasure':
        staff(o.staffId).measures[m(o.measureId)] = o.value;
        break;
      case 'insertMeasure':
        doc.measures.splice(o.index, 0, o.info);
        for (const e of o.staffMeasures) staff(e.staffId).measures.splice(o.index, 0, e.value);
        break;
      case 'deleteMeasure': {
        const i = m(o.measureId);
        doc.measures.splice(i, 1);
        for (const s of doc.parts.flatMap((p) => p.staves)) s.measures.splice(i, 1);
        break;
      }
      case 'replacePart':
        doc.parts[doc.parts.findIndex((p) => p.id === o.partId)] = o.value as never;
        break;
      case 'insertPart':
        doc.parts.splice(o.index, 0, o.value as never);
        break;
      case 'deletePart':
        doc.parts.splice(
          doc.parts.findIndex((p) => p.id === o.partId),
          1,
        );
        break;
      case 'setSlurs':
        doc.slurs = o.slurs;
        break;
    }
  }
  return doc as unknown as Score;
}

function run(score: Score, ...commands: Command[]): Score {
  const history = new History(score);
  for (const command of commands) history.execute(command);
  return history.score;
}

function eventIds(score: Score): string[] {
  return score.parts.flatMap((p) =>
    p.staves.flatMap((s) =>
      s.measures.flatMap((sm) => sm.voices.flatMap((v) => v.events.map((e) => e.id))),
    ),
  );
}

const opNames = (patch: ReturnType<typeof diffScores>) => patch?.ops.map((o) => o.op);

describe('diffScores', () => {
  const base = createScore({
    title: 'Diff',
    measures: 40,
    instruments: ['piano', 'guitar-classical'],
  });

  it('has nothing to send when nothing changed', () => {
    expect(diffScores(base, base)?.ops).toEqual([]);
    expect(diffScores(base, { ...base })?.ops).toEqual([]);
  });

  it('sends a changed measure by the ids of its staff and measure, with the new content', () => {
    const next = run(
      pianoGrandStaff,
      setPitch({
        eventId: eventIds(pianoGrandStaff)[1]!,
        pitch: { step: 'A', alter: 0, octave: 4 },
      }),
    );
    const patch = diffScores(pianoGrandStaff, next)!;

    expect(patch.ops).toHaveLength(1);
    const op = patch.ops[0]!;
    expect(op).toMatchObject({
      op: 'setStaffMeasure',
      staffId: pianoGrandStaff.parts[0]!.staves[0]!.id,
      measureId: pianoGrandStaff.measures[0]!.id,
    });
    expect(JSON.parse(patch.text)).toEqual({ ops: [op] });
    expect(applyOps(pianoGrandStaff, patch.ops)).toEqual(next);
  });

  it('sends the title, the composer and the tempo as one setMeta', () => {
    const next = { ...base, meta: { ...base.meta, title: 'Renamed' } };
    const patch = diffScores(base, next)!;
    expect(patch.ops).toEqual([{ op: 'setMeta', meta: next.meta }]);
    expect(applyOps(base, patch.ops)).toEqual(next);
  });

  it('sends the sparse attributes of a measure as a replacement of its MeasureInfo', () => {
    const next = run(
      base,
      setKeySignature({ measure: 5, fifths: 2 }),
      setTempo({ measure: 7, bpm: 90 }),
    );
    const patch = diffScores(base, next)!;
    expect(opNames(patch)?.every((n) => n === 'setMeasureInfo')).toBe(true);
    expect(applyOps(base, patch.ops)).toEqual(next);
  });

  it('inserts and deletes measures by id, in an order the server can follow', () => {
    const inserted = run(base, insertMeasure({ index: 3, count: 2 }), insertMeasure({ index: 0 }));
    const deleted = run(base, deleteMeasure({ index: 4 }), deleteMeasure({ index: 10 }));
    const both = run(base, deleteMeasure({ index: 1 }), insertMeasure({ index: 20, count: 2 }));

    for (const next of [inserted, deleted, both]) {
      const patch = diffScores(base, next)!;
      expect(patch).not.toBeNull();
      expect(applyOps(base, patch.ops)).toEqual(next);
      expect(validateScore(applyOps(base, patch.ops))).toEqual([]);
    }
    const insert = diffScores(base, inserted)!.ops.filter((o) => o.op === 'insertMeasure');
    expect(insert.map((o) => (o as { index: number }).index)).toEqual([0, 4, 5]);
    // One staff measure for every staff of the score.
    expect((insert[0] as { staffMeasures: unknown[] }).staffMeasures).toHaveLength(3);
  });

  it('adds and removes parts, and replaces a part whose header changed', () => {
    const added = run(base, addPart({ instrument: 'flute', index: 1 }));
    const removed = run(base, removePart({ partId: base.parts[0]!.id }));
    const renamed = run(base, renamePart({ partId: base.parts[1]!.id, name: 'Lead' }));

    for (const next of [added, removed, renamed]) {
      const patch = diffScores(base, next)!;
      expect(patch).not.toBeNull();
      expect(applyOps(base, patch.ops)).toEqual(next);
    }
    expect(opNames(diffScores(base, added))).toEqual(['insertPart']);
    expect(opNames(diffScores(base, removed))).toEqual(['deletePart']);
    expect(opNames(diffScores(base, renamed))).toEqual(['replacePart']);
  });

  it('sends the slur list when it changes', () => {
    const ids = eventIds(pianoGrandStaff);
    const next = run(pianoGrandStaff, addSlur({ startEventId: ids[0]!, endEventId: ids[2]! }));
    const patch = diffScores(pianoGrandStaff, next)!;
    expect(opNames(patch)).toContain('setSlurs');
    expect(applyOps(pianoGrandStaff, patch.ops)).toEqual(next);
  });

  it('gives up (sends the whole document) when it cannot say the change simply', () => {
    // A part moved, measures and parts changing shape together, a changed id, an unsupported schema change.
    const moved = run(base, movePart({ partId: base.parts[0]!.id, toIndex: 1 }));
    const shapes = run(run(base, addPart({ instrument: 'flute' })), insertMeasure({ index: 2 }));
    const renamedAndInserted = run(
      base,
      renamePart({ partId: base.parts[0]!.id, name: 'X' }),
      insertMeasure({ index: 2 }),
    );

    expect(diffScores(base, moved)).toBeNull();
    expect(diffScores(base, shapes)).toBeNull();
    expect(diffScores(base, renamedAndInserted)).toBeNull();
    expect(diffScores(base, { ...base, id: 'another' })).toBeNull();
    expect(diffScores(base, { ...base, schemaVersion: 2 as never })).toBeNull();
  });

  it('gives up when ids are not unique, because they would not be addresses', () => {
    const twin = {
      ...base,
      measures: [...base.measures.slice(0, 2), base.measures[1]!, ...base.measures.slice(3)],
    };
    expect(diffScores(twin, { ...twin, meta: { ...twin.meta, title: 'x' } })).toBeNull();
  });

  it('gives up above the operation limit and above the size limit', () => {
    const ids = eventIds(base);
    // Every staff measure of the 40 measures changes: more than PATCH_MAX_OPS operations.
    const many = run(base, transpose({ eventIds: ids, semitones: 0 }));
    const rewritten = {
      ...base,
      parts: base.parts.map((p) => ({
        ...p,
        staves: p.staves.map((s) => ({ ...s, measures: s.measures.map((sm) => ({ ...sm })) })),
      })),
    };
    expect(diffScores(base, many)?.ops).toEqual([]);
    expect(diffScores(base, rewritten)).toBeNull();

    const slurs = Array.from({ length: 3000 }, (_, i) => ({
      id: `s${i}`,
      startEventId: `a${i}`,
      endEventId: `b${i}`,
    }));
    const big = diffScores(base, { ...base, slurs });
    expect(JSON.stringify({ ops: [{ op: 'setSlurs', slurs }] }).length).toBeGreaterThan(
      PATCH_MAX_BYTES,
    );
    expect(big).toBeNull();
    expect(PATCH_MAX_OPS).toBeLessThan(rewritten.measures.length * 3);
  });

  it('only walks what changed: a 500-measure score diffs in well under a millisecond per edit', () => {
    const large = createScore({
      title: 'Large',
      measures: 500,
      instruments: ['piano', 'guitar-classical'],
    });
    const next = run(large, setKeySignature({ measure: 250, fifths: 1 }));
    const started = performance.now();
    let patch = null as ReturnType<typeof diffScores>;
    for (let i = 0; i < 200; i++) patch = diffScores(large, next);
    const perCall = (performance.now() - started) / 200;

    expect(patch?.ops).toHaveLength(1);
    expect(perCall).toBeLessThan(2);
  });

  describe('random edit sequences', () => {
    // A small seeded generator, so a failure names the seed that reproduces it.
    function rng(seed: number) {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
      };
    }

    function randomCommand(score: Score, random: () => number): Command {
      const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
      const ids = eventIds(score);
      switch (Math.floor(random() * 10)) {
        case 0:
          return insertMeasure({ index: Math.floor(random() * (score.measures.length + 1)) });
        case 1:
          return deleteMeasure({ index: Math.floor(random() * score.measures.length) });
        case 2:
          return setKeySignature({
            measure: Math.floor(random() * score.measures.length),
            fifths: Math.floor(random() * 7) - 3,
          });
        case 3:
          return setTempo({
            measure: Math.floor(random() * score.measures.length),
            bpm: 60 + Math.floor(random() * 100),
          });
        case 4:
          return renamePart({
            partId: pick(score.parts).id,
            name: `Part ${Math.floor(random() * 99)}`,
          });
        case 5:
          return addPart({
            instrument: pick(['flute', 'violin', 'piano']),
            index: Math.floor(random() * (score.parts.length + 1)),
          });
        case 6:
          return removePart({ partId: pick(score.parts).id });
        case 7:
          return deleteEvent({ eventId: pick(ids) });
        case 8:
          return addSlur({ startEventId: pick(ids), endEventId: pick(ids) });
        default:
          return setPitch({
            eventId: pick(ids),
            pitch: {
              step: pick(['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const),
              alter: 0,
              octave: 3 + Math.floor(random() * 3),
            },
          });
      }
    }

    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      'applying the ops to the base gives the edited score (seed %i)',
      (seed) => {
        const random = rng(seed);
        const start = Object.values(FIXTURES)[seed % Object.values(FIXTURES).length]!;
        const history = new History(start);
        let server = start; // What the server holds: the score as of the last "save".
        let patches = 0;
        let full = 0;
        for (let round = 0; round < 60; round++) {
          // A batch of 1 to 4 edits, like the ones between two autosaves.
          for (let i = 1 + Math.floor(random() * 4); i > 0; i--) {
            try {
              history.execute(randomCommand(history.score, random));
            } catch (error) {
              if (!(error instanceof CommandError)) throw error;
            }
          }
          const next = history.score;
          const patch = diffScores(server, next);
          if (patch === null) {
            full++;
          } else {
            patches++;
            const rebuilt = applyOps(server, patch.ops);
            expect(rebuilt, `seed ${seed} round ${round}`).toEqual(next);
            expect(validateScore(rebuilt)).toEqual(validateScore(next));
          }
          server = next;
        }
        expect(patches + full).toBe(60);
        expect(patches).toBeGreaterThan(10);
      },
    );
  });
});

describe('ScoreSync', () => {
  const base = createScore({ title: 'Sync', measures: 8 });

  it('plans a patch against the last committed score, and moves the base on commit only', () => {
    const sync = new ScoreSync(base);
    const first = { ...base, meta: { ...base.meta, title: 'One' } };
    const second = { ...base, meta: { ...base.meta, title: 'Two' } };

    const plan = sync.plan(first, false);
    expect(plan.patch).toContain('"One"');
    // Not committed (the request failed): the next plan still starts from the old base.
    expect(sync.plan(second, false).patch).toContain('"Two"');

    plan.commit();
    expect(sync.plan(first, false).nothingToSave).toBe(true);
    expect(sync.plan(second, false).patch).toContain('"Two"');
  });

  it('sends the whole document when asked to, and says when there is nothing to send', () => {
    const sync = new ScoreSync(base);
    const full = sync.plan({ ...base, meta: { ...base.meta, title: 'x' } }, true);
    expect(full.patch).toBeNull();
    expect(full.nothingToSave).toBe(false);
    expect(JSON.parse(full.text()).meta.title).toBe('x');
    expect(sync.plan(base, false).nothingToSave).toBe(true);
  });

  it('follows a rename and a reload', () => {
    const sync = new ScoreSync(base);
    sync.renamed('Renamed');
    expect(
      sync.plan({ ...base, meta: { ...base.meta, title: 'Renamed' } }, false).nothingToSave,
    ).toBe(true);

    const other = createScore({ title: 'Other', measures: 3 });
    sync.reset(other);
    expect(sync.plan(other, false).nothingToSave).toBe(true);
    expect(sync.plan(base, false).patch).toBeNull(); // unrelated documents: everything changed
  });

  it('keeps the guitar score of the fixtures patchable by one staff measure', () => {
    const sync = new ScoreSync(guitarArpeggio);
    const id = eventIds(guitarArpeggio)[0]!;
    const next = run(
      guitarArpeggio,
      setPitch({ eventId: id, pitch: { step: 'E', alter: 0, octave: 3 } }),
    );
    const plan = sync.plan(next, false);
    expect(plan.patch).not.toBeNull();
    expect(JSON.parse(plan.patch!).ops.length).toBeLessThanOrEqual(2);
  });
});

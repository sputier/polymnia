import { describe, expect, it } from 'vitest';
import {
  auClairDeLaLune,
  celloClefChanges,
  guitarArpeggio,
  pianoGrandStaff,
  pickup,
  ukuleleMelody,
} from '../score/fixtures';
import { buildScore } from '../score/fixtures/dsl';
import { setPitch } from '../score';
import { benchmarkScore } from './previewScores';
import { LayoutCache, METRICS, layoutScore, staffSlots, stretchFor } from './layout';
import { accidentalsScore } from './previewScores';

describe('system breaking', () => {
  it('fits a short score on one system when there is room', () => {
    const layout = layoutScore(auClairDeLaLune, { width: 1100 });
    expect(layout.systems).toHaveLength(1);
    expect(layout.systems[0]!.measures.map((m) => m.index)).toEqual([0, 1, 2, 3]);
  });

  it('breaks into several systems on a narrow page, and every measure appears exactly once', () => {
    const layout = layoutScore(auClairDeLaLune, { width: 420 });
    expect(layout.systems.length).toBeGreaterThan(1);
    const all = layout.systems.flatMap((s) => s.measures.map((m) => m.index));
    expect(all).toEqual([0, 1, 2, 3]);
  });

  it('keeps every system inside the page and fills it (justification)', () => {
    for (const width of [700, 900, 1000]) {
      const layout = layoutScore(benchmarkScore(40), { width });
      layout.systems.forEach((s, i) => {
        expect(s.right).toBeLessThanOrEqual(width - METRICS.marginX + 0.01);
        if (i < layout.systems.length - 1) {
          // Justified: every system but the last reaches the right margin.
          expect(s.right).toBeCloseTo(width - METRICS.marginX, 3);
        }
      });
    }
  });

  it('gives each measure a width that holds its content (no overlap, no gap between measures)', () => {
    const layout = layoutScore(benchmarkScore(30), { width: 900 });
    for (const s of layout.systems) {
      let x = s.x;
      for (const m of s.measures) {
        expect(m.x).toBeCloseTo(x, 6);
        expect(m.noteEndX - m.noteStartX).toBeGreaterThanOrEqual(
          METRICS.padLeft + m.shape.fixed + METRICS.padRight - 0.01,
        );
        x += m.width;
      }
    }
  });

  it('gives busier measures more width than empty ones', () => {
    const score = buildScore({
      title: 't',
      parts: [
        {
          name: 'p',
          instrument: 'piano',
          staves: [
            {
              measures: [
                'C4:s D4:s E4:s F4:s G4:s A4:s B4:s C5:s D5:s E5:s F5:s G5:s A5:s B5:s C6:s D6:s',
                'C4:w',
              ],
            },
          ],
        },
      ],
    });
    const [busy, empty] = layoutScore(score, { width: 5000 }).systems[0]!.measures;
    expect(busy!.shape.fixed + busy!.shape.stretch).toBeGreaterThan(
      2 * (empty!.shape.fixed + empty!.shape.stretch),
    );
  });

  it('does not stretch a short last system beyond the limit', () => {
    const layout = layoutScore(auClairDeLaLune, { width: 700 });
    const last = layout.systems[layout.systems.length - 1]!;
    const first = layout.systems[0]!;
    if (layout.systems.length > 1) {
      expect(last.right).toBeLessThan(first.right);
    }
  });
});

describe('start of systems', () => {
  it('puts clef and time signature at the start of the score and only the clef on later systems', () => {
    const layout = layoutScore(benchmarkScore(20), { width: 1000 });
    const [first, second] = layout.systems;
    expect(first!.measures[0]!.start).toMatchObject({ clef: 'full' });
    expect(first!.measures[0]!.start.time).toEqual({ beats: 4, beatType: 4 });
    expect(second!.measures[0]!.start.clef).toBe('full');
    expect(second!.measures[0]!.start.time).toBeNull();
    expect(first!.measures[1]!.start.clef).toBeNull();
  });

  it('shows the full part name on the first system and the short name on the others', () => {
    const layout = layoutScore(benchmarkScore(20), { width: 1000 });
    expect(layout.systems[0]!.names).toBe(true);
    expect(layout.systems[0]!.shortNames).toBe(false);
    expect(layout.systems[1]!.names).toBe(true);
    expect(layout.systems[1]!.shortNames).toBe(true);
    const first = layout.systems[0]!.x;
    const other = layout.systems[1]!.x;
    expect(first).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(METRICS.marginX + METRICS.bracket);
  });

  it('shows the key signature at the start of every system', () => {
    const score = buildScore({
      title: 't',
      keyFifths: 2,
      parts: [
        {
          name: 'p',
          instrument: 'flute',
          staves: [{ measures: Array.from({ length: 12 }, () => 'D5:q E5:q F#5:q G5:q') }],
        },
      ],
    });
    const layout = layoutScore(score, { width: 360 });
    expect(layout.systems.length).toBeGreaterThan(2);
    for (const s of layout.systems) expect(s.measures[0]!.start.key).toBe(2);
  });

  it('adds courtesy changes at the end of a system and the change at the start of the next', () => {
    const score = buildScore({
      title: 't',
      keyFifths: 0,
      measureInfo: { 4: { keyFifths: 3 } },
      parts: [
        {
          name: 'p',
          instrument: 'flute',
          staves: [{ measures: Array.from({ length: 8 }, () => 'D5:q E5:q F#5:q G5:q') }],
        },
      ],
    });
    // Find a width where measure 4 starts a new system.
    let found = false;
    for (let width = 300; width < 900 && !found; width += 10) {
      const layout = layoutScore(score, { width });
      const sys = layout.systems.find((s) => s.firstMeasure === 4);
      if (!sys || sys.index === 0) continue;
      const before = layout.systems[sys.index - 1]!;
      const lastOfBefore = before.measures[before.measures.length - 1]!;
      expect(lastOfBefore.end).not.toBeNull();
      expect(lastOfBefore.end!.key).toBe(3);
      expect(lastOfBefore.end!.width).toBeGreaterThan(0);
      expect(lastOfBefore.noteEndX).toBeCloseTo(
        lastOfBefore.x + lastOfBefore.width - lastOfBefore.end!.width,
        6,
      );
      expect(sys.measures[0]!.start.key).toBe(3);
      found = true;
    }
    expect(found).toBe(true);
  });

  it('adds a cancelling key change mid-system and a small clef change', () => {
    const keyScore = buildScore({
      title: 't',
      keyFifths: 2,
      measureInfo: { 1: { keyFifths: 0 } },
      parts: [{ name: 'p', instrument: 'flute', staves: [{ measures: ['D5:w', 'C5:w'] }] }],
    });
    const m1 = layoutScore(keyScore, { width: 1000 }).systems[0]!.measures[1]!;
    expect(m1.start).toMatchObject({ key: 0, cancelKey: 2 });
    expect(m1.start.width).toBeGreaterThan(0);

    const cello = layoutScore(celloClefChanges, { width: 1500 }).systems[0]!;
    expect(cello.measures.map((m) => m.clefs[0])).toEqual([
      'bass',
      'bass',
      'tenor',
      'tenor',
      'treble',
    ]);
    expect(cello.measures[2]!.start.clef).toBe('small');
    expect(cello.measures[3]!.start.clef).toBeNull();
  });

  it('announces a clef change at a system break with a courtesy clef', () => {
    let found = false;
    for (let width = 250; width < 700 && !found; width += 10) {
      const layout = layoutScore(celloClefChanges, { width });
      const sys = layout.systems.find((s) => s.firstMeasure === 2);
      if (!sys || sys.index === 0) continue;
      const before = layout.systems[sys.index - 1]!;
      expect(before.measures[before.measures.length - 1]!.end?.clef).toBe(true);
      expect(sys.measures[0]!.start.clef).toBe('full');
      found = true;
    }
    expect(found).toBe(true);
  });

  it('marks the final barline and handles a pickup measure', () => {
    const layout = layoutScore(pickup, { width: 900 });
    const measures = layout.systems.flatMap((s) => s.measures);
    expect(measures[measures.length - 1]!.final).toBe(true);
    expect(measures.filter((m) => m.final)).toHaveLength(1);
    // The pickup (one quarter) is narrower than a full 2/4 measure with the same density.
    const [pick, full] = measures;
    expect(pick!.noteEndX - pick!.noteStartX).toBeLessThan(full!.noteEndX - full!.noteStartX);
  });
});

describe('proportional spacing', () => {
  it('places columns left to right with more room after longer notes', () => {
    const score = buildScore({
      title: 't',
      parts: [{ name: 'p', instrument: 'flute', staves: [{ measures: ['C5:h D5:q E5:e F5:e'] }] }],
    });
    const m = layoutScore(score, { width: 600 }).systems[0]!.measures[0]!;
    const gaps = m.colX.slice(1).map((x, i) => x - m.colX[i]!);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]!).toBeGreaterThan(gaps[1]!);
    expect(gaps[1]!).toBeGreaterThan(gaps[2]!);
  });

  it('leaves no empty tail: the last note is close to the barline', () => {
    const layout = layoutScore(benchmarkScore(10), { width: 900 });
    for (const s of layout.systems) {
      for (const m of s.measures) {
        const lastX = m.colX[m.colX.length - 1]!;
        if (m.shape.restOnly) continue;
        const gaps = m.colX.slice(1).map((x, i) => x - m.colX[i]!);
        const widest = gaps.length ? Math.max(...gaps) : 0;
        // The space after the last note is what its duration earns, like any other note.
        expect(m.noteEndX - lastX).toBeLessThanOrEqual(
          widest + METRICS.padRight + METRICS.head + 40,
        );
      }
    }
  });

  it('aligns notes of different staves at the same time', () => {
    const m = layoutScore(pianoGrandStaff, { width: 900 }).systems[0]!.measures[0]!;
    const [treble, bass] = m.shape.staves;
    const x = (list: typeof treble, i: number) => m.colX[list![i]!.col];
    // Beat 3 of the first measure: treble 3rd quarter, bass second half note.
    expect(x(treble, 2)).toBe(x(bass, 1));
  });

  it('reserves room for accidentals before the notehead', () => {
    const plain = buildScore({
      title: 't',
      parts: [{ name: 'p', instrument: 'flute', staves: [{ measures: ['C5:q D5:q E5:q F5:q'] }] }],
    });
    const sharp = buildScore({
      title: 't',
      parts: [
        { name: 'p', instrument: 'flute', staves: [{ measures: ['C#5:q D#5:q E5:q F#5:q'] }] },
      ],
    });
    const a = layoutScore(plain, { width: 600 }).systems[0]!.measures[0]!;
    const b = layoutScore(sharp, { width: 600 }).systems[0]!.measures[0]!;
    expect(b.shape.columns[0]!.lead).toBeGreaterThan(a.shape.columns[0]!.lead);
    expect(b.shape.fixed).toBeGreaterThan(a.shape.fixed);
  });

  it('centers a whole-measure rest', () => {
    const score = buildScore({
      title: 't',
      parts: [{ name: 'p', instrument: 'flute', staves: [{ measures: ['r:w'] }] }],
    });
    const m = layoutScore(score, { width: 600 }).systems[0]!.measures[0]!;
    expect(m.shape.restOnly).toBe(true);
    expect(m.colX[0]! + METRICS.head / 2).toBeCloseTo((m.noteStartX + m.noteEndX) / 2, 6);
  });
});

describe('staves', () => {
  it('stacks staves of a part closer than parts, and sizes tab staves from the tuning', () => {
    const slots = staffSlots(guitarArpeggio);
    expect(slots.map((s) => s.type)).toEqual(['standard', 'tab']);
    expect(slots[1]!.lines).toBe(6);
    expect(slots[1]!.top).toBeGreaterThan(slots[0]!.top + slots[0]!.height);
    expect(staffSlots(ukuleleMelody)[0]!.lines).toBe(5);
    const piano = staffSlots(pianoGrandStaff);
    expect(piano[1]!.top - (piano[0]!.top + piano[0]!.height)).toBe(METRICS.staffGap);
  });
});

describe('cache', () => {
  it('recomputes only the measures an edit touched', () => {
    const score = benchmarkScore(30);
    const cache = new LayoutCache();
    const before = layoutScore(score, { width: 900 }, cache);
    const target = score.parts[0]!.staves[0]!.measures[12]!.voices[0]!.events[1]!.id;
    const edited = setPitch({ eventId: target, pitch: { step: 'D', alter: 0, octave: 6 } }).apply(
      score,
    );
    const after = layoutScore(edited, { width: 900 }, cache);
    const shape = (l: typeof before, i: number) =>
      l.systems.flatMap((s) => s.measures).find((m) => m.index === i)!.shape;
    for (let i = 0; i < 30; i++) {
      if (i === 12 || i === 13) continue; // the edited measure (and the next: ties look at the previous one)
      expect(shape(after, i)).toBe(shape(before, i));
    }
    expect(shape(after, 12)).not.toBe(shape(before, 12));
  });

  it('is deterministic', () => {
    const a = layoutScore(benchmarkScore(20), { width: 800 });
    const b = layoutScore(benchmarkScore(20), { width: 800 });
    expect(
      JSON.stringify(a.systems.map((s) => s.measures.map((m) => [m.x, m.width, m.colX]))),
    ).toBe(JSON.stringify(b.systems.map((s) => s.measures.map((m) => [m.x, m.width, m.colX]))));
  });

  it('lays out 100 measures within the time budget', () => {
    const score = benchmarkScore(100);
    const t0 = performance.now();
    layoutScore(score, { width: 1100 });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('density (#46)', () => {
  const simple = (n: number) =>
    buildScore({
      title: 't',
      parts: [
        {
          name: 'Piano',
          instrument: 'piano',
          staves: [
            { clef: 'treble', measures: Array.from({ length: n }, () => 'C5:q D5:q E5:q F5:q') },
            { clef: 'bass', measures: Array.from({ length: n }, () => 'C3:h G3:h') },
          ],
        },
      ],
    });

  it('fits at least 4 simple 4/4 measures per system at 1000 px, first system included', () => {
    const layout = layoutScore(simple(40), { width: 1000 });
    for (const s of layout.systems.slice(0, -1))
      expect(s.measures.length).toBeGreaterThanOrEqual(4);
  });

  it('spaces notes monotonically with duration', () => {
    const ticks = [120, 240, 480, 960, 1920, 3840];
    const widths = ticks.map(stretchFor);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    // Sub-linear (logarithmic): doubling the duration never doubles the space.
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(2 * widths[i - 1]!);
  });

  it('never lets an accidental run into the previous note', () => {
    for (const width of [300, 420, 600, 900, 1400]) {
      const layout = layoutScore(accidentalsScore(), { width });
      for (const s of layout.systems) {
        for (const m of s.measures) {
          m.shape.columns.forEach((c, i) => {
            if (i === 0 || c.lead === 0) return;
            const prev = m.shape.columns[i - 1]!;
            // Left edge of this column's accidentals vs right edge of the previous glyphs.
            expect(m.colX[i]! - c.lead).toBeGreaterThanOrEqual(m.colX[i - 1]! + prev.glyph - 0.01);
          });
        }
      }
    }
  });

  it('justification only stretches: no measure is narrower than its content', () => {
    const layout = layoutScore(simple(30), { width: 1000 });
    for (const s of layout.systems)
      for (const m of s.measures)
        expect(m.noteEndX - m.noteStartX).toBeGreaterThanOrEqual(
          METRICS.padLeft + m.shape.fixed + METRICS.padRight - 0.01,
        );
  });

  it('leaves a short last system at its natural width, and justifies a fuller one', () => {
    let sawShort = false;
    let sawFull = false;
    for (let n = 6; n <= 16; n++) {
      const layout = layoutScore(simple(n), { width: 1000 });
      const last = layout.systems[layout.systems.length - 1]!;
      if (layout.systems.length < 2) continue;
      const lineWidth = 1000 - METRICS.marginX - last.x;
      const natural = last.measures.reduce(
        (sum, m) =>
          sum +
          m.start.width +
          METRICS.padLeft +
          m.shape.fixed +
          m.shape.stretch +
          METRICS.padRight,
        0,
      );
      if (natural / lineWidth < METRICS.lastSystemFull) {
        sawShort = true;
        expect(last.right - last.x).toBeCloseTo(natural, 3);
      } else {
        sawFull = true;
        expect(last.right).toBeCloseTo(1000 - METRICS.marginX, 3);
      }
    }
    expect(sawShort).toBe(true);
    expect(sawFull).toBe(true);
  });
});

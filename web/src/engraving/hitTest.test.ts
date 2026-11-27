import { describe, expect, it } from 'vitest';
import {
  guitarArpeggio,
  pianoGrandStaff,
  auClairDeLaLune,
  celloClefChanges,
} from '../score/fixtures';
import { yOfStep, stepIndex } from './notation';
import { eventBox, eventBoxes, hitTest } from './hitTest';
import { layoutScore } from './layout';

const layout = layoutScore(pianoGrandStaff, { width: 900 });

function center(id: string) {
  const box = eventBox(layout, id)!;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, box };
}

describe('event boxes', () => {
  it('exposes one box per event of every staff, inside its system', () => {
    const boxes = eventBoxes(layout);
    const count = pianoGrandStaff.parts[0]!.staves.reduce(
      (n, s) =>
        n + s.measures.reduce((k, m) => k + m.voices.reduce((j, v) => j + v.events.length, 0), 0),
      0,
    );
    expect(boxes).toHaveLength(count);
    for (const b of boxes) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown event', () => {
    expect(eventBox(layout, 'nope')).toBeUndefined();
  });

  it('boxes follow the layout positions and the staff of the event', () => {
    const treble = pianoGrandStaff.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events[1]!;
    const bass = pianoGrandStaff.parts[0]!.staves[1]!.measures[0]!.voices[0]!.events[0]!;
    const a = eventBox(layout, treble.id)!;
    const b = eventBox(layout, bass.id)!;
    expect(a.staffId).toBe(pianoGrandStaff.parts[0]!.staves[0]!.id);
    expect(b.staffId).toBe(pianoGrandStaff.parts[0]!.staves[1]!.id);
    expect(b.y).toBeGreaterThan(a.y + a.h);
  });
});

describe('hit testing', () => {
  it('finds the event under the pointer with its staff, part and measure', () => {
    const staff = pianoGrandStaff.parts[0]!.staves[0]!;
    const event = staff.measures[2]!.voices[0]!.events[1]!;
    const { x, y } = center(event.id);
    expect(hitTest(layout, x, y)).toMatchObject({
      partId: pianoGrandStaff.parts[0]!.id,
      staffId: staff.id,
      measureIndex: 2,
      eventId: event.id,
    });
  });

  it('tells the bass staff events from the treble staff ones', () => {
    const staff = pianoGrandStaff.parts[0]!.staves[1]!;
    const event = staff.measures[0]!.voices[0]!.events[1]!;
    const { x, y } = center(event.id);
    const hit = hitTest(layout, x, y)!;
    expect(hit.staffId).toBe(staff.id);
    expect(hit.eventId).toBe(event.id);
  });

  it('returns the pitch under a click on a line or a space, without an event', () => {
    const system = layout.systems[0]!;
    const slot = system.staves[0]!;
    const m = system.measures[0]!;
    // Between two notes of the first measure.
    const x = (m.colX[0]! + m.colX[1]!) / 2;
    const e4 = system.y + slot.top + yOfStep(stepIndex({ step: 'E', octave: 4 }), 'treble');
    const hit = hitTest(layout, x, e4)!;
    expect(hit.eventId).toBeUndefined();
    expect(hit.pitch).toEqual({ step: 'E', alter: 0, octave: 4 });
    const f4 = system.y + slot.top + yOfStep(stepIndex({ step: 'F', octave: 4 }), 'treble');
    expect(hitTest(layout, x, f4)!.pitch).toMatchObject({ step: 'F', octave: 4 });
    // A click on a bass staff uses the bass clef.
    const bassSlot = system.staves[1]!;
    const g2 = system.y + bassSlot.top + yOfStep(stepIndex({ step: 'G', octave: 2 }), 'bass');
    expect(hitTest(layout, x, g2)!.pitch).toMatchObject({ step: 'G', octave: 2 });
  });

  it('returns the tick of the column nearest to the point', () => {
    const system = layout.systems[0]!;
    const slot = system.staves[0]!;
    const m = system.measures[0]!;
    const y = system.y + slot.top + 10;
    m.shape.columns.forEach((col, i) => {
      expect(hitTest(layout, m.colX[i]! + 7, y)!.tick).toBe(col.tick);
    });
  });

  it('gives ledger-line pitches above and below the staff, up to a limit', () => {
    const system = layout.systems[0]!;
    const slot = system.staves[0]!;
    const m = system.measures[1]!;
    const x = m.noteStartX + 2;
    const c4 = system.y + slot.top + yOfStep(stepIndex({ step: 'C', octave: 4 }), 'treble');
    expect(hitTest(layout, x, c4)!.pitch).toMatchObject({ step: 'C', octave: 4 });
    const far = system.y + slot.top - 200;
    expect(hitTest(layout, x, far)?.pitch).toBeUndefined();
  });

  it('uses the clef in force at the measure (cello tenor clef)', () => {
    const l = layoutScore(celloClefChanges, { width: 1200 });
    const system = l.systems[0]!;
    const m = system.measures[2]!;
    const slot = system.staves[0]!;
    const x = m.noteStartX + 3;
    const y = system.y + slot.top + yOfStep(stepIndex({ step: 'C', octave: 4 }), 'tenor');
    expect(hitTest(l, x, y)!.pitch).toMatchObject({ step: 'C', octave: 4 });
  });

  it('returns null outside every system and left of the first measure', () => {
    expect(hitTest(layout, 5, 5)).toBeNull();
    expect(hitTest(layout, 100, layout.height + 500)).toBeNull();
    expect(hitTest(layout, layout.systems[0]!.x - 3, layout.systems[0]!.y + 60)).toBeNull();
  });

  it('picks the nearest staff between two staves', () => {
    const system = layout.systems[0]!;
    const [a, b] = system.staves;
    const x = system.measures[0]!.noteStartX + 4;
    const nearTop = system.y + a!.top + a!.height + 8;
    const nearBottom = system.y + b!.top - 8;
    expect(hitTest(layout, x, nearTop)!.staffId).toBe(a!.staffId);
    expect(hitTest(layout, x, nearBottom)!.staffId).toBe(b!.staffId);
  });

  it('works on the second system too', () => {
    const narrow = layoutScore(auClairDeLaLune, { width: 420 });
    const system = narrow.systems[1]!;
    const first = system.measures[0]!;
    const hit = hitTest(narrow, first.noteStartX + 10, system.y + system.staves[0]!.top + 20)!;
    expect(hit.systemIndex).toBe(1);
    expect(hit.measureIndex).toBe(first.index);
  });

  it('resolves tab staves to events without a pitch', () => {
    const l = layoutScore(guitarArpeggio, { width: 900 });
    const tab = guitarArpeggio.parts[0]!.staves[1]!;
    const event = tab.measures[0]!.voices[0]!.events[2]!;
    const box = eventBox(l, event.id)!;
    const hit = hitTest(l, box.x + box.w / 2, box.y + box.h / 2)!;
    expect(hit.staffId).toBe(tab.id);
    expect(hit.eventId).toBe(event.id);
    expect(hit.pitch).toBeUndefined();
  });

  it('reports the string under the point on a tab staff, 1 = highest', () => {
    const l = layoutScore(guitarArpeggio, { width: 900 });
    const tab = guitarArpeggio.parts[0]!.staves[1]!;
    const system = l.systems[0]!;
    const slot = system.staves.find((s) => s.staffId === tab.id)!;
    const event = tab.measures[0]!.voices[0]!.events[0]!;
    const x = eventBox(l, event.id)!.x + 5;
    for (let string = 1; string <= slot.lines; string++) {
      const y = system.y + slot.top + (string - 1) * slot.space;
      expect(hitTest(l, x, y)!.string, `string ${string}`).toBe(string);
    }
    // Standard staves report no string.
    const std = system.staves.find((s) => s.type === 'standard')!;
    expect(hitTest(l, x, system.y + std.top + 10)!.string).toBeUndefined();
  });
});

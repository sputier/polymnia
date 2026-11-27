import { describe, expect, it } from 'vitest';
import { audibleStaves, legsBetween, lowerBound, scoreSecondsAt } from './clock';

describe('scoreSecondsAt (loop maths)', () => {
  it('advances linearly without a loop', () => {
    expect(scoreSecondsAt(2, 3)).toBe(5);
  });

  it('wraps inside the loop, starting at its beginning after the first pass', () => {
    const loop = { startSec: 2, endSec: 6 };
    expect(scoreSecondsAt(2, 1, loop)).toBe(3);
    expect(scoreSecondsAt(2, 4, loop)).toBe(2); // exactly one pass: back to the start
    expect(scoreSecondsAt(2, 9, loop)).toBe(3);
  });

  it('plays the lead-in before the loop first, then loops', () => {
    const loop = { startSec: 4, endSec: 6 };
    expect(scoreSecondsAt(1, 2, loop)).toBe(3);
    expect(scoreSecondsAt(1, 5, loop)).toBe(4); // reaches 6 at elapsed 5
    expect(scoreSecondsAt(1, 6, loop)).toBe(5);
  });

  it('ignores a degenerate loop', () => {
    expect(scoreSecondsAt(1, 5, { startSec: 3, endSec: 3 })).toBe(6);
  });
});

describe('legsBetween', () => {
  it('is one leg without a loop', () => {
    expect(legsBetween(1, 0, 2)).toEqual([{ elapsed: 0, from: 1, to: 3 }]);
  });

  it('splits a window that crosses the loop end', () => {
    const loop = { startSec: 0, endSec: 4 };
    const legs = legsBetween(3, 0, 3, loop);
    expect(legs).toEqual([
      { elapsed: 0, from: 3, to: 4 },
      { elapsed: 1, from: 0, to: 2 },
    ]);
  });

  it('covers several loop turns in one window', () => {
    const loop = { startSec: 0, endSec: 1 };
    const legs = legsBetween(0, 0, 3.5, loop);
    expect(legs.map((l) => [l.from, l.to])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 0.5],
    ]);
    expect(legs.reduce((t, l) => t + (l.to - l.from), 0)).toBeCloseTo(3.5);
  });

  it('continues a window from where the previous one stopped', () => {
    const loop = { startSec: 0, endSec: 4 };
    const a = legsBetween(0, 0, 5, loop);
    const b = legsBetween(0, 5, 6, loop);
    expect(a.at(-1)).toMatchObject({ from: 0, to: 1 });
    expect(b).toEqual([{ elapsed: 5, from: 1, to: 2 }]);
  });
});

describe('lowerBound', () => {
  it('finds the first element at or after a value', () => {
    const xs = [1, 3, 3, 7];
    expect(lowerBound(xs, 0, (x) => x)).toBe(0);
    expect(lowerBound(xs, 3, (x) => x)).toBe(1);
    expect(lowerBound(xs, 4, (x) => x)).toBe(3);
    expect(lowerBound(xs, 8, (x) => x)).toBe(4);
  });
});

describe('audibleStaves (mute and solo)', () => {
  const ids = ['a', 'b', 'c'];
  it('plays everything by default', () => {
    expect([...audibleStaves(ids, new Set(), new Set())]).toEqual(ids);
  });
  it('drops muted staves', () => {
    expect([...audibleStaves(ids, new Set(['b']), new Set())]).toEqual(['a', 'c']);
  });
  it('solo silences the others, and wins over mute', () => {
    expect([...audibleStaves(ids, new Set(['b']), new Set(['b', 'c']))]).toEqual(['b', 'c']);
  });
  it('several solos are heard together', () => {
    expect([...audibleStaves(ids, new Set(), new Set(['a', 'c']))]).toEqual(['a', 'c']);
  });
});

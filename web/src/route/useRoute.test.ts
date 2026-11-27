import { describe, expect, it } from 'vitest';
import { parseRoute } from './useRoute';

describe('parseRoute', () => {
  it('reads a stored score id, decoded', () => {
    expect(parseRoute('#/scores/abc%2D1')).toEqual({ name: 'score', id: 'abc-1' });
  });

  it.each(['#/scores/%', '#/scores/%E0%A4%A', '#/scores/%zz/'])(
    'falls back to the library on a malformed escape (%s) instead of throwing',
    (hash) => {
      expect(parseRoute(hash)).toEqual({ name: 'library' });
    },
  );

  it('only accepts a well-formed share token', () => {
    expect(parseRoute('#/s/abc_DEF-123')).toEqual({ name: 'shared', token: 'abc_DEF-123' });
    expect(parseRoute('#/s/a%2Fb')).toEqual({ name: 'library' });
    expect(parseRoute(`#/s/${'a'.repeat(129)}`)).toEqual({ name: 'library' });
  });
});

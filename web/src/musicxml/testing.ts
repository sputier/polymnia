/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Score } from '../score';

/** Reads a hand-written fixture of `src/musicxml/fixtures/` (tests run from `web/`). */
export function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'musicxml', 'fixtures', name), 'utf8');
}

/**
 * Test helper: the score with every id replaced by its position, so that two scores that only
 * differ by their (random) ids compare equal. References (tuplets, slurs) are renamed the same way.
 */
export function normalizeScore(score: Score): unknown {
  const names = new Map<string, string>();
  const rename = (id: string, prefix: string): string => {
    let v = names.get(id);
    if (!v) names.set(id, (v = `${prefix}${names.size}`));
    return v;
  };
  const json = JSON.parse(JSON.stringify(score)) as {
    id?: string;
    measures: { id: string }[];
    parts: {
      id: string;
      staves: {
        id: string;
        measures: {
          chords?: { id: string }[];
          voices: {
            id: string;
            events: { id: string }[];
            tuplets: { id: string; eventIds: string[] }[];
          }[];
        }[];
      }[];
    }[];
    slurs: { id: string; startEventId: string; endEventId: string }[];
  };
  delete json.id;
  for (const m of json.measures) m.id = rename(m.id, 'm');
  for (const p of json.parts) {
    p.id = rename(p.id, 'p');
    for (const s of p.staves) {
      s.id = rename(s.id, 's');
      for (const sm of s.measures) {
        for (const c of sm.chords ?? []) c.id = rename(c.id, 'c');
        for (const v of sm.voices) {
          v.id = rename(v.id, 'v');
          for (const e of v.events) e.id = rename(e.id, 'e');
          for (const t of v.tuplets) {
            t.id = rename(t.id, 't');
            t.eventIds = t.eventIds.map((id) => rename(id, 'e'));
          }
        }
      }
    }
  }
  for (const sl of json.slurs) {
    sl.id = rename(sl.id, 'l');
    sl.startEventId = rename(sl.startEventId, 'e');
    sl.endEventId = rename(sl.endEventId, 'e');
  }
  return json;
}

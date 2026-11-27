// What changed between the score the server holds and the score in the editor, as the operations of an
// incremental save (docs/api.md "Incremental updates", server side: ScorePatchPlanner).
//
// The score model is immutable with structural sharing: a command copies only the path from the root to what it
// changed, so an unchanged measure is the same object in both scores. The diff therefore compares references
// (`===`) and only walks into what differs; its cost follows the number of changed measures, not the size of the
// score. The unit of a change is a whole measure (of the score, or of one staff), a part, the metadata or the
// slur list: a measure is replaced, never edited field by field.
//
// Anything the operations cannot say simply, or anything too big to be worth sending, returns `null`: the caller
// then saves the whole document, which is always correct.
import type { ScoreOp } from '../api/scoreOps';
import type { Part, Score, Staff } from '../score';

/** More operations than this and the whole document is sent instead. */
export const PATCH_MAX_OPS = 32;
/** A patch larger than this (JSON characters) is not worth sending: the whole document is. */
export const PATCH_MAX_BYTES = 128 * 1024;

export interface ScorePatch {
  readonly ops: readonly ScoreOp[];
  /** The request body: `{ "ops": [...] }`. */
  readonly text: string;
}

class SendInFull extends Error {}

const bail = (): never => {
  throw new SendInFull();
};

/**
 * The operations that turn `base` (the score the server holds) into `next`, or `null` when the whole document
 * should be sent. No operation at all (`ops` empty) means there is nothing to save.
 */
export function diffScores(base: Score, next: Score): ScorePatch | null {
  try {
    return buildPatch(base, next);
  } catch (error) {
    if (error instanceof SendInFull) return null;
    throw error;
  }
}

function buildPatch(base: Score, next: Score): ScorePatch {
  const ops: ScoreOp[] = [];
  let bytes = 0;
  const add = (op: ScoreOp): void => {
    bytes += JSON.stringify(op).length;
    if (ops.length >= PATCH_MAX_OPS || bytes > PATCH_MAX_BYTES) bail();
    ops.push(op);
  };
  const finish = (): ScorePatch => ({ ops, text: JSON.stringify({ ops }) });

  if (base === next) return finish();
  if (base.schemaVersion !== next.schemaVersion || base.id !== next.id) return bail();

  if (
    base.meta.title !== next.meta.title ||
    base.meta.composer !== next.meta.composer ||
    base.meta.tempoBpm !== next.meta.tempoBpm
  ) {
    add({ op: 'setMeta', meta: next.meta });
  }

  // Ids are the addresses of an operation: if they are not unique the diff cannot be trusted.
  const baseMeasureIds = base.measures.map((m) => m.id);
  const nextMeasureIds = next.measures.map((m) => m.id);
  const measurePlan = planSequence(baseMeasureIds, nextMeasureIds);
  const partPlan = planSequence(
    base.parts.map((p) => p.id),
    next.parts.map((p) => p.id),
  );
  const baseStaffIds = base.parts.flatMap((p) => p.staves.map((s) => s.id));
  const nextStaffIds = next.parts.flatMap((p) => p.staves.map((s) => s.id));
  if (new Set(baseStaffIds).size !== baseStaffIds.length) bail();
  if (new Set(nextStaffIds).size !== nextStaffIds.length) bail();

  const measuresChanged = measurePlan.deleted.length > 0 || measurePlan.inserted.length > 0;
  const partsChanged = partPlan.deleted.length > 0 || partPlan.inserted.length > 0;
  const basePartById = new Map(base.parts.map((p) => [p.id, p]));
  const nextPartById = new Map(next.parts.map((p) => [p.id, p]));
  const replaced = partPlan.kept.filter((id) =>
    needsReplacement(basePartById.get(id)!, nextPartById.get(id)!),
  );
  // Inserting or deleting measures while parts change shape would need operations in an order the server
  // cannot check against one consistent document: send everything.
  if (measuresChanged && (partsChanged || replaced.length > 0)) bail();

  const baseMeasureIndex = new Map(baseMeasureIds.map((id, i) => [id, i]));
  const nextMeasureIndex = new Map(nextMeasureIds.map((id, i) => [id, i]));

  // 1. Replacements of what exists on both sides, addressed by id.
  for (const id of measurePlan.kept) {
    const b = baseMeasureIndex.get(id)!;
    const n = nextMeasureIndex.get(id)!;
    if (base.measures[b] !== next.measures[n]) {
      add({ op: 'setMeasureInfo', measureId: id, value: next.measures[n]! });
    }
  }
  const replacedParts = new Set(replaced);
  for (const partId of partPlan.kept) {
    const before = basePartById.get(partId)!;
    const after = nextPartById.get(partId)!;
    if (before === after) continue;
    if (replacedParts.has(partId)) {
      add({ op: 'replacePart', partId, value: after });
      continue;
    }
    after.staves.forEach((staff, s) => {
      const was = before.staves[s]!;
      if (was === staff || was.measures === staff.measures) return;
      if (staff.measures.length !== next.measures.length) bail();
      for (const measureId of measurePlan.kept) {
        const b = baseMeasureIndex.get(measureId)!;
        const n = nextMeasureIndex.get(measureId)!;
        if (was.measures[b] !== staff.measures[n]) {
          add({ op: 'setStaffMeasure', staffId: staff.id, measureId, value: staff.measures[n]! });
        }
      }
    });
  }

  // 2. Deletions, then insertions in increasing final position (each index is valid once the earlier ones are in).
  for (const measureId of measurePlan.deleted) add({ op: 'deleteMeasure', measureId });
  for (const partId of partPlan.deleted) add({ op: 'deletePart', partId });
  for (const { index } of measurePlan.inserted) {
    add({
      op: 'insertMeasure',
      index,
      info: next.measures[index]!,
      staffMeasures: next.parts.flatMap((part) =>
        part.staves.map((staff) => ({ staffId: staff.id, value: staff.measures[index]! })),
      ),
    });
  }
  for (const { index } of partPlan.inserted) {
    add({ op: 'insertPart', index, value: next.parts[index]! });
  }

  if (!sameItems(base.slurs, next.slurs)) add({ op: 'setSlurs', slurs: next.slurs });
  return finish();
}

interface SequencePlan {
  /** Ids on both sides, in their common order. */
  kept: string[];
  deleted: string[];
  /** Ids only in the new sequence, with their final position, increasing. */
  inserted: { id: string; index: number }[];
}

/**
 * Compares two id sequences. Only insertions and deletions are supported: ids on both sides must be in the same
 * relative order (a moved part makes the diff give up).
 */
function planSequence(before: readonly string[], after: readonly string[]): SequencePlan {
  const inBefore = new Set(before);
  const inAfter = new Set(after);
  if (inBefore.size !== before.length || inAfter.size !== after.length) return bail();
  const kept = before.filter((id) => inAfter.has(id));
  const keptAfter = after.filter((id) => inBefore.has(id));
  if (kept.some((id, i) => id !== keptAfter[i])) return bail();
  return {
    kept,
    deleted: before.filter((id) => !inAfter.has(id)),
    inserted: after.flatMap((id, index) => (inBefore.has(id) ? [] : [{ id, index }])),
  };
}

/** A part whose header or staff layout changed: replaced as a whole (rare edits, and the staves go with it). */
function needsReplacement(before: Part, after: Part): boolean {
  if (before === after) return false;
  if (
    before.name !== after.name ||
    before.instrument !== after.instrument ||
    before.transposition !== after.transposition ||
    before.capo !== after.capo ||
    !samePitches(before.tuning, after.tuning) ||
    before.staves.length !== after.staves.length
  ) {
    return true;
  }
  return after.staves.some((staff, i) => !sameStaffHeader(before.staves[i]!, staff));
}

function sameStaffHeader(a: Staff, b: Staff): boolean {
  return a.id === b.id && a.clef === b.clef && a.type === b.type && a.showRests === b.showRests;
}

function samePitches(a: Part['tuning'], b: Part['tuning']): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (p, i) => p.step === b[i]!.step && p.alter === b[i]!.alter && p.octave === b[i]!.octave,
  );
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((item, i) => item === b[i]));
}

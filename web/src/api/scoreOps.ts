// The operations of an incremental save (`PATCH /api/scores/{id}/content`, docs/api.md "Incremental updates").
// Every operation replaces, inserts or deletes a whole unit addressed by its stable id, so it never depends on a
// position the server could disagree about, and applying the same replacement twice gives the same document.
import type { MeasureInfo, Part, ScoreMeta, Slur, StaffMeasure } from '../score';

export type ScoreOp =
  | { op: 'setMeta'; meta: ScoreMeta }
  | { op: 'setMeasureInfo'; measureId: string; value: MeasureInfo }
  | { op: 'setStaffMeasure'; staffId: string; measureId: string; value: StaffMeasure }
  | {
      op: 'insertMeasure';
      /** Position in the measure list once the earlier operations of the patch are applied. */
      index: number;
      info: MeasureInfo;
      /** One measure for every staff of the score. */
      staffMeasures: { staffId: string; value: StaffMeasure }[];
    }
  | { op: 'deleteMeasure'; measureId: string }
  | { op: 'replacePart'; partId: string; value: Part }
  | { op: 'insertPart'; index: number; value: Part }
  | { op: 'deletePart'; partId: string }
  | { op: 'setSlurs'; slurs: readonly Slur[] };

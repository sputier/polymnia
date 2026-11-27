import type { Score } from '../score';

/** What was lost or approximated while importing, as counts per element type. */
export interface ImportReport {
  /** Elements that were read but have no equivalent in the score model (name -> occurrences). */
  readonly dropped: Readonly<Record<string, number>>;
  /** Content that was kept but changed to fit the model (name -> occurrences). */
  readonly adjusted: Readonly<Record<string, number>>;
}

export interface ImportResult {
  readonly score: Score;
  readonly report: ImportReport;
}

export type ImportErrorCode =
  | 'too-large'
  | 'not-xml'
  | 'unsafe-doctype'
  | 'too-many-elements'
  | 'unsupported-format'
  | 'zip-invalid'
  | 'zip-limits'
  | 'zip-unsafe-path'
  | 'no-rootfile'
  | 'too-many-measures'
  | 'empty'
  | 'invalid-score';

/** Thrown for any file that cannot be imported. The message is for logs; the UI maps the code. */
export class MusicXmlError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'MusicXmlError';
    this.code = code;
  }
}

export function totalCount(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

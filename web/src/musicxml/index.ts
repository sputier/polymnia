/**
 * MusicXML 4.0 (partwise) import and export. Lazy-loaded by the editor (see docs/musicxml.md).
 * Pure functions over the score model; nothing here touches the page.
 */
import type { Score } from '../score';
import { exportWithReport } from './export';
import { packMxl } from './mxl';

export { scoreToMusicXml } from './export';
export { importMusicXml, parseMusicXml } from './import';
export { packMxl, unpackMxl } from './mxl';
export { MUSICXML_LIMITS } from './limits';
export {
  MusicXmlError,
  totalCount,
  type ImportErrorCode,
  type ImportReport,
  type ImportResult,
} from './types';

export type MusicXmlFormat = 'musicxml' | 'mxl';

export interface ExportedFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
  readonly extension: string;
  /** What could not be written (counts per element type). Empty for any score of the usual range. */
  readonly dropped: Readonly<Record<string, number>>;
}

/** Serializes a score as `.musicxml` (UTF-8 text) or `.mxl` (compressed). */
export function exportMusicXml(score: Score, format: MusicXmlFormat): ExportedFile {
  const { xml, dropped } = exportWithReport(score);
  if (format === 'mxl') {
    return {
      bytes: packMxl(xml) as Uint8Array<ArrayBuffer>,
      mime: 'application/vnd.recordare.musicxml',
      extension: 'mxl',
      dropped,
    };
  }
  return {
    bytes: new TextEncoder().encode(xml) as Uint8Array<ArrayBuffer>,
    mime: 'application/vnd.recordare.musicxml+xml',
    extension: 'musicxml',
    dropped,
  };
}

/** Limits applied before and while reading a MusicXML file (see docs/musicxml.md, "Security"). */
export const MUSICXML_LIMITS = {
  /** File as received (plain XML or MXL archive). */
  maxInputBytes: 20_000_000,
  /** Total uncompressed size of an MXL archive, and size of the XML text. */
  maxUncompressedBytes: 20_000_000,
  /** Entries in an MXL archive. */
  maxZipEntries: 100,
  /** Length of an archive entry name. */
  maxEntryNameLength: 260,
  /** Markup tags in a document (counted before the DOM is built). */
  maxElements: 1_500_000,
} as const;

/** `<divisions>` written by the exporter: one tick of the score model per division. */
export const MUSICXML_DIVISIONS = 960;

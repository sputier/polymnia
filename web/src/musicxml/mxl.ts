import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';
import { MUSICXML_LIMITS } from './limits';
import { MusicXmlError } from './types';
import { parseXmlSafely } from './xml';

const CONTAINER_PATH = 'META-INF/container.xml';
const ROOT_PATH = 'score.musicxml';
const FIXED_DATE = Date.UTC(2000, 0, 1);

/** Compressed MusicXML (.mxl): a ZIP with `META-INF/container.xml` pointing at the score. */
export function packMxl(xml: string): Uint8Array {
  const container =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<container><rootfiles>' +
    `<rootfile full-path="${ROOT_PATH}" media-type="application/vnd.recordare.musicxml+xml"/>` +
    '</rootfiles></container>\n';
  return zipSync(
    { [CONTAINER_PATH]: strToU8(container), [ROOT_PATH]: strToU8(xml) },
    { level: 9, mtime: FIXED_DATE },
  );
}

/** True when a path could leave the extraction directory or is not a plain relative name. */
export function isUnsafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > MUSICXML_LIMITS.maxEntryNameLength) return true;
  // eslint-disable-next-line no-control-regex -- NUL and control characters are never legitimate
  if (/[\u0000-\u001F\u007F\\]/.test(name)) return true;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
  return name.split('/').some((part) => part === '..');
}

function failZip(error: unknown): never {
  if (error instanceof MusicXmlError) throw error;
  throw new MusicXmlError('zip-invalid', 'The archive is not a valid ZIP file');
}

/**
 * Reads the score of an MXL archive. Checked before anything is inflated: entry count, entry
 * names (no traversal, no absolute path) and the declared uncompressed sizes. Only the container
 * and the score entry are inflated, into buffers sized from the checked declarations, and the
 * result is checked again.
 */
export function unpackMxl(data: Uint8Array): Uint8Array {
  if (data.length > MUSICXML_LIMITS.maxInputBytes) {
    throw new MusicXmlError('too-large', 'The file is too large');
  }
  const entries: UnzipFileInfo[] = [];
  try {
    unzipSync(data, {
      filter: (info) => {
        entries.push(info);
        // Stop early on a flood of entries: the count is checked right below anyway.
        if (entries.length > MUSICXML_LIMITS.maxZipEntries + 1) throw new RangeError('entries');
        return false;
      },
    });
  } catch (error) {
    if (!(error instanceof RangeError && error.message === 'entries')) failZip(error);
  }
  if (entries.length > MUSICXML_LIMITS.maxZipEntries) {
    throw new MusicXmlError('zip-limits', 'The archive has too many entries');
  }
  let total = 0;
  for (const e of entries) {
    if (isUnsafeEntryName(e.name)) {
      throw new MusicXmlError('zip-unsafe-path', 'The archive contains an unsafe path');
    }
    total += e.originalSize;
    if (e.originalSize > MUSICXML_LIMITS.maxUncompressedBytes) {
      throw new MusicXmlError('zip-limits', 'The archive expands to too much data');
    }
  }
  if (total > MUSICXML_LIMITS.maxUncompressedBytes) {
    throw new MusicXmlError('zip-limits', 'The archive expands to too much data');
  }

  const extract = (name: string): Uint8Array | undefined => {
    let found: Uint8Array | undefined;
    try {
      const files = unzipSync(data, { filter: (info) => info.name === name });
      found = files[name];
    } catch (error) {
      failZip(error);
    }
    if (found && found.length > MUSICXML_LIMITS.maxUncompressedBytes) {
      throw new MusicXmlError('zip-limits', 'The archive expands to too much data');
    }
    return found;
  };

  const names = new Set(entries.map((e) => e.name));
  let rootPath: string | undefined;
  const container = names.has(CONTAINER_PATH) ? extract(CONTAINER_PATH) : undefined;
  if (container) {
    const doc = parseXmlSafely(strFromU8(container));
    for (const rf of Array.from(doc.getElementsByTagName('rootfile'))) {
      const path = rf.getAttribute('full-path');
      if (path && names.has(path) && !isUnsafeEntryName(path)) {
        rootPath = path;
        break;
      }
    }
  }
  // Lenient fallback for archives without a usable container: the first XML entry.
  rootPath ??= entries.find(
    (e) => /\.(musicxml|xml)$/i.test(e.name) && !e.name.startsWith('META-INF/'),
  )?.name;
  if (!rootPath) throw new MusicXmlError('no-rootfile', 'No score found in the archive');
  const xml = extract(rootPath);
  if (!xml) throw new MusicXmlError('no-rootfile', 'No score found in the archive');
  return xml;
}

/** True when the bytes start like a ZIP archive. */
export function looksLikeZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03;
}

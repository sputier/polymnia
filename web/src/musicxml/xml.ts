import { MUSICXML_LIMITS } from './limits';
import { MusicXmlError } from './types';

/** Characters not allowed in XML 1.0 documents. */
// eslint-disable-next-line no-control-regex -- the point is to match control characters
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Text from a file made safe to store: no control characters, bounded length. */
export function cleanText(text: string | null | undefined, max: number): string {
  return (text ?? '').replace(CONTROL_CHARS, ' ').trim().slice(0, max);
}

/** Decodes the bytes of an XML file: UTF-8 (default), UTF-16 with a BOM, or the declared encoding. */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes.length > MUSICXML_LIMITS.maxUncompressedBytes) {
    throw new MusicXmlError('too-large', 'XML document too large');
  }
  let label = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  else {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const declared = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
    if (declared) label = declared.toLowerCase();
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}

/**
 * Rejects what could expand or load other content before the parser sees it: any DOCTYPE with an
 * internal subset (where entities are declared, "billion laughs"), any entity declaration, and
 * documents with too many tags. A DOCTYPE that only names the public DTD is fine: the browser
 * parser never loads it.
 */
export function assertSafeXml(text: string): void {
  if (text.length > MUSICXML_LIMITS.maxUncompressedBytes) {
    throw new MusicXmlError('too-large', 'XML document too large');
  }
  if (/<!ENTITY/i.test(text)) {
    throw new MusicXmlError('unsafe-doctype', 'Entity declarations are not allowed');
  }
  const start = text.search(/<!DOCTYPE/i);
  if (start >= 0) {
    let quote = '';
    for (let i = start + 9; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '[') {
        throw new MusicXmlError('unsafe-doctype', 'DOCTYPE with an internal subset is not allowed');
      } else if (c === '>') break;
    }
  }
  let tags = 0;
  for (let i = text.indexOf('<'); i >= 0; i = text.indexOf('<', i + 1)) {
    if (++tags > MUSICXML_LIMITS.maxElements) {
      throw new MusicXmlError('too-many-elements', 'Too many elements');
    }
  }
}

/** Parses with the browser DOMParser after the safety checks. Never inserts anything in the page. */
export function parseXmlSafely(text: string): Document {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  assertSafeXml(clean);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(clean, 'application/xml');
  } catch {
    throw new MusicXmlError('not-xml', 'The file is not well-formed XML');
  }
  if (
    doc.getElementsByTagName('parsererror').length > 0 ||
    !doc.documentElement ||
    doc.documentElement.localName === 'parsererror'
  ) {
    throw new MusicXmlError('not-xml', 'The file is not well-formed XML');
  }
  return doc;
}

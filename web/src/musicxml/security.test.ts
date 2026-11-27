import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../score';
import { importMusicXml, MUSICXML_LIMITS, MusicXmlError, packMxl, parseMusicXml } from './index';
import { isUnsafeEntryName } from './mxl';
import { readFixture } from './testing';

const SCORE_BODY = `<part-list><score-part id="P1"><part-name>X</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`;

const wrap = (doctype: string, body = SCORE_BODY): string =>
  `<?xml version="1.0"?>\n${doctype}\n<score-partwise version="4.0">${body}</score-partwise>`;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof MusicXmlError ? error.code : `other:${String(error)}`;
  }
  return undefined;
}

describe('DOCTYPE and entities', () => {
  it('rejects entity expansion (billion laughs)', () => {
    const bomb = wrap(`<!DOCTYPE score-partwise [
      <!ENTITY a "aaaaaaaaaa">
      <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
      <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
    ]>`).replace('<part-name>X', '<part-name>&c;');
    expect(codeOf(() => parseMusicXml(bomb))).toBe('unsafe-doctype');
  });

  it('rejects an external entity', () => {
    const xxe = wrap('<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///etc/passwd">]>').replace(
      '<part-name>X',
      '<part-name>&x;',
    );
    expect(codeOf(() => parseMusicXml(xxe))).toBe('unsafe-doctype');
  });

  it('rejects any internal subset, even without an entity', () => {
    expect(codeOf(() => parseMusicXml(wrap('<!DOCTYPE score-partwise [<!ELEMENT a ANY>]>')))).toBe(
      'unsafe-doctype',
    );
  });

  it('rejects entity declarations written outside a DOCTYPE', () => {
    expect(codeOf(() => parseMusicXml(wrap('', `<!ENTITY a "b">${SCORE_BODY}`)))).toBe(
      'unsafe-doctype',
    );
  });

  it('accepts the standard public DOCTYPE and a "[" inside a quoted literal', () => {
    expect(
      parseMusicXml(readFixture('ode-to-joy-style.musicxml')).score.measures.length,
    ).toBeGreaterThan(0);
    const odd = wrap('<!DOCTYPE score-partwise SYSTEM "a[b.dtd">');
    expect(parseMusicXml(odd).score.parts).toHaveLength(1);
  });

  it('does not resolve an undefined entity reference', () => {
    expect(codeOf(() => parseMusicXml(wrap('').replace('<part-name>X', '<part-name>&xxe;')))).toBe(
      'not-xml',
    );
  });
});

describe('size and shape limits', () => {
  it('rejects a file over the input limit before reading it', () => {
    const big = new Uint8Array(MUSICXML_LIMITS.maxInputBytes + 1);
    expect(codeOf(() => importMusicXml(big))).toBe('too-large');
  });

  it('rejects a document with too many elements before building a DOM', () => {
    const flood = '<a/>'.repeat(MUSICXML_LIMITS.maxElements + 1);
    expect(codeOf(() => parseMusicXml(`<score-partwise>${flood}</score-partwise>`))).toBe(
      'too-many-elements',
    );
  });

  it('rejects malformed XML', () => {
    expect(codeOf(() => parseMusicXml('<score-partwise><part></score-partwise>'))).toBe('not-xml');
    expect(codeOf(() => importMusicXml(new TextEncoder().encode('not xml at all')))).toBe(
      'not-xml',
    );
  });

  it('rejects more measures than the model allows', () => {
    const measures = '<measure number="1"/>'.repeat(LIMITS.maxMeasures + 1);
    const xml = wrap(
      '',
      `<part-list><score-part id="P1"/></part-list><part id="P1">${measures}</part>`,
    );
    expect(codeOf(() => parseMusicXml(xml))).toBe('too-many-measures');
  });

  it('keeps at most four voices per staff measure and reports the others', () => {
    const voices = [1, 2, 3, 4, 5, 6]
      .map(
        (v) =>
          `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>${v}</voice><type>whole</type></note><backup><duration>4</duration></backup>`,
      )
      .join('');
    const xml = wrap(
      '',
      `<part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${voices}</measure></part>`,
    );
    const { score, report } = parseMusicXml(xml);
    expect(score.parts[0]!.staves[0]!.measures[0]!.voices).toHaveLength(4);
    expect(report.dropped.voice).toBe(2);
  });

  it('caps text lengths, strips control characters, never keeps markup active', () => {
    const title = `<![CDATA[<img src=x onerror=alert(1)>\t${'x'.repeat(500)}]]>`;
    const xml = wrap('', `<work><work-title>${title}</work-title></work>${SCORE_BODY}`);
    const { score } = parseMusicXml(xml);
    expect(score.meta.title.length).toBeLessThanOrEqual(LIMITS.maxTitleLength);
    // It is plain text: the importer returns a string and never an element.
    expect(score.meta.title.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
    // eslint-disable-next-line no-control-regex -- checking that control characters are gone
    expect(score.meta.title).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe('MXL archives', () => {
  it('rejects a zip bomb by its declared uncompressed size', () => {
    const bomb = zipSync({
      'score.musicxml': new Uint8Array(MUSICXML_LIMITS.maxUncompressedBytes + 1),
    });
    expect(bomb.length).toBeLessThan(100_000);
    expect(codeOf(() => importMusicXml(bomb))).toBe('zip-limits');
  });

  it('rejects many entries that expand to too much together', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.bin`] = new Uint8Array(3_000_000);
    expect(codeOf(() => importMusicXml(zipSync(files)))).toBe('zip-limits');
  });

  it('rejects an archive with too many entries', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MUSICXML_LIMITS.maxZipEntries; i++) files[`f${i}.txt`] = strToU8('x');
    expect(codeOf(() => importMusicXml(zipSync(files)))).toBe('zip-limits');
  });

  it('rejects path traversal and absolute entry names', () => {
    for (const name of ['../evil.xml', 'a/../../evil.xml', '/etc/passwd', 'C:/x.xml', 'a\\b.xml']) {
      expect(isUnsafeEntryName(name)).toBe(true);
      const zip = zipSync({ [name]: strToU8('<a/>'), 'score.musicxml': strToU8('<a/>') });
      expect(codeOf(() => importMusicXml(zip))).toBe('zip-unsafe-path');
    }
    expect(isUnsafeEntryName('META-INF/container.xml')).toBe(false);
    expect(isUnsafeEntryName('sub/score.musicxml')).toBe(false);
  });

  it('survives a lying header: an entry that inflates to more than declared', () => {
    const real = zipSync({ 'score.musicxml': new Uint8Array(5_000_000) }, { level: 9 });
    const patched = real.slice();
    const view = new DataView(patched.buffer);
    for (let i = 0; i < patched.length - 4; i++) {
      // Local header (offset 22) and central directory (offset 24): uncompressed size.
      if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 100, true);
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 100, true);
    }
    expect(codeOf(() => importMusicXml(patched))).toMatch(/^(zip-invalid|not-xml|no-rootfile)$/);
  });

  it('rejects bytes that only look like a zip, and archives without a score', () => {
    expect(
      codeOf(() => importMusicXml(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]))),
    ).toBe('zip-invalid');
    expect(codeOf(() => importMusicXml(zipSync({ 'readme.txt': strToU8('hello') })))).toBe(
      'no-rootfile',
    );
  });

  it('applies the XML checks to the archive content too', () => {
    const evil = wrap('<!DOCTYPE score-partwise [<!ENTITY a "b">]>');
    expect(codeOf(() => importMusicXml(packMxl(evil)))).toBe('unsafe-doctype');
  });

  it('follows container.xml to the score entry', () => {
    const container =
      '<container><rootfiles><rootfile full-path="dir/main.xml"/></rootfiles></container>';
    const zip = zipSync({
      'META-INF/container.xml': strToU8(container),
      'dir/main.xml': strToU8(wrap('')),
    });
    expect(importMusicXml(zip).score.parts).toHaveLength(1);
  });
});

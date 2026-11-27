import { describe, expect, it } from 'vitest';
import {
  chordStaffId,
  createScore,
  formatChord,
  parseChord,
  setChord,
  setChordDiagram,
  setChordDiagramMode,
  setTuning,
  staffChords,
  validateScore,
  type Score,
} from '../score';
import { parseMusicXml, scoreToMusicXml } from './index';
import { exportWithReport } from './export';

/** A one-measure, 4/4 file with the given content inside the measure (divisions 4 = 4 per quarter). */
function file(
  measure: string,
  opts: { staves?: number; part?: string; attributes?: string; misc?: string } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <identification>${opts.misc ? `<miscellaneous>${opts.misc}</miscellaneous>` : ''}</identification>
  <part-list><score-part id="P1"><part-name>${opts.part ?? 'Guitar'}</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${opts.staves ? `<staves>${opts.staves}</staves>` : ''}${opts.attributes ?? ''}</attributes>
      ${measure}
      <note><rest/><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
}

const harmony = (root: string, kind: string, extra = '', rootAlter = '') =>
  `<harmony><root><root-step>${root}</root-step>${rootAlter}</root><kind>${kind}</kind>${extra}</harmony>`;

function chordsOf(score: Score, staff = 0): string[] {
  return (
    score.parts[0]!.staves[staff]!.measures[0]!.chords?.map(
      (c) => `${c.tick}:${formatChord(c)}${c.diagram !== undefined ? `[${c.diagram}]` : ''}`,
    ) ?? []
  );
}

describe('import: harmony', () => {
  it.each([
    ['major', 'C'],
    ['minor', 'Cm'],
    ['augmented', 'Caug'],
    ['diminished', 'Cdim'],
    ['dominant', 'C7'],
    ['major-seventh', 'Cmaj7'],
    ['minor-seventh', 'Cm7'],
    ['diminished-seventh', 'Cdim7'],
    ['augmented-seventh', 'Caug7'],
    ['half-diminished', 'Cm7b5'],
    ['major-minor', 'Cm(maj7)'],
    ['major-sixth', 'C6'],
    ['minor-sixth', 'Cm6'],
    ['dominant-ninth', 'C9'],
    ['major-ninth', 'Cmaj9'],
    ['minor-ninth', 'Cm9'],
    ['dominant-11th', 'C11'],
    ['major-11th', 'Cmaj11'],
    ['minor-11th', 'Cm11'],
    ['dominant-13th', 'C13'],
    ['major-13th', 'Cmaj13'],
    ['minor-13th', 'Cm13'],
    ['suspended-second', 'Csus2'],
    ['suspended-fourth', 'Csus4'],
    ['power', 'C5'],
  ])('reads the kind %s as %s', (kind, expected) => {
    const { score, report } = parseMusicXml(file(harmony('C', kind)));
    expect(chordsOf(score)).toEqual([`0:${expected}`]);
    expect(report.dropped).toEqual({});
    expect(validateScore(score)).toEqual([]);
  });

  it('reads the root, its alteration and the bass', () => {
    const xml = file(
      `<harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>major-seventh</kind><bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass></harmony>`,
    );
    const { score } = parseMusicXml(xml);
    expect(chordsOf(score)).toEqual(['0:Bbmaj7/F#']);
  });

  it('applies degrees: alterations and additions', () => {
    const degree = (value: number, alter: number, type: string) =>
      `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
    const { score } = parseMusicXml(
      file(
        harmony('E', 'dominant', degree(9, 1, 'alter')) +
          harmony('C', 'major', degree(9, 0, 'add') + '<offset>8</offset>') +
          harmony(
            'G',
            'dominant',
            degree(5, -1, 'alter') + degree(9, -1, 'alter') + '<offset>12</offset>',
          ),
      ),
    );
    expect(chordsOf(score)).toEqual(['0:E7#9', '1920:Cadd9', '2880:G7b5b9']);
  });

  it('reads a six-nine chord from a sixth with a ninth', () => {
    const { score } = parseMusicXml(
      file(
        harmony(
          'C',
          'major-sixth',
          '<degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>',
        ),
      ),
    );
    expect(chordsOf(score)).toEqual(['0:C6/9']);
  });

  it('falls back to the text for kind other, and drops what it cannot read', () => {
    const { score, report } = parseMusicXml(
      file(
        `<harmony><root><root-step>C</root-step></root><kind text="sus4">other</kind></harmony>` +
          `<harmony><root><root-step>D</root-step></root><kind text="alt">other</kind><offset>4</offset></harmony>` +
          `<harmony><root><root-step>E</root-step></root><kind>none</kind><offset>8</offset></harmony>` +
          `<harmony><numeral><numeral-root>5</numeral-root></numeral><kind>major</kind><offset>12</offset></harmony>` +
          `<harmony><root><root-step>F</root-step></root><kind>Neapolitan</kind></harmony>`,
      ),
    );
    expect(chordsOf(score)).toEqual(['0:Csus4']);
    expect(report.dropped).toMatchObject({
      'harmony (quality)': 1,
      'harmony (no chord)': 1,
      'harmony (numeral or function)': 1,
      'harmony (kind Neapolitan)': 1,
    });
  });

  it('places chords with the cursor and the offset, and keeps them in order', () => {
    const xml = file(
      harmony('C', 'major') +
        `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>` +
        harmony('G', 'major') +
        harmony('A', 'minor', '<offset>2</offset>') +
        `<note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>`,
    ).replace('<note><rest/><duration>16</duration><voice>1</voice><type>whole</type></note>', '');
    const { score } = parseMusicXml(xml);
    expect(chordsOf(score)).toEqual(['0:C', '1920:G', '2400:Am']);
  });

  it('drops a second chord at the same position and one past the measure', () => {
    const { score, report } = parseMusicXml(
      file(
        harmony('C', 'major') +
          harmony('D', 'major') +
          harmony('E', 'major', '<offset>16</offset>'),
      ),
    );
    expect(chordsOf(score)).toEqual(['0:C']);
    expect(report.dropped).toMatchObject({
      'harmony (same position)': 1,
      'harmony (outside measure)': 1,
    });
  });

  it('puts a chord on the staff it names, or on the first one', () => {
    const { score } = parseMusicXml(
      file(
        harmony('C', 'major', '<staff>2</staff>') +
          harmony('D', 'minor', '<offset>4</offset><staff>9</staff>'),
        {
          staves: 2,
          part: 'Piano',
          attributes:
            '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>',
        },
      ),
    );
    expect(chordsOf(score, 1)).toEqual(['0:C']);
    expect(chordsOf(score, 0)).toEqual(['960:Dm']);
  });

  describe('frames', () => {
    const frame = (strings: number, notes: string, first = '') =>
      `<frame><frame-strings>${strings}</frame-strings><frame-frets>4</frame-frets>${first}${notes}</frame>`;
    const note = (s: number, f: number, barre = '') =>
      `<frame-note><string>${s}</string><fret>${f}</fret>${barre}</frame-note>`;
    // F major barre chord: 133211 (string 6 is the lowest).
    const fMajor = frame(
      6,
      note(6, 1, '<barre type="start"/>') +
        note(5, 3) +
        note(4, 3) +
        note(3, 2) +
        note(2, 1) +
        note(1, 1, '<barre type="stop"/>'),
    );

    it('keeps a custom fingering and shows its diagram', () => {
      const custom = frame(
        6,
        note(6, 3) + note(5, 2) + note(4, 0) + note(3, 0) + note(2, 3) + note(1, 3),
        '<first-fret>1</first-fret>',
      );
      const { score } = parseMusicXml(
        file(harmony('G', 'major', custom), { part: 'Steel guitar' }).replace(
          '<part-name>Steel guitar</part-name>',
          '<part-name>Guitar</part-name>',
        ),
      );
      const chord = score.parts[0]!.staves[0]!.measures[0]!.chords![0]!;
      expect(chord.frame).toEqual({ frets: [3, 3, 0, 0, 2, 3], base: 1 });
      expect(chord.diagram).toBe(true);
    });

    it('drops a diagram that is the library shape, and keeps the diagram visible', () => {
      const { score } = parseMusicXml(file(harmony('F', 'major', fMajor)));
      const chord = score.parts[0]!.staves[0]!.measures[0]!.chords![0]!;
      expect(chord.frame).toBeUndefined();
      expect(chord.diagram).toBe(true);
    });

    it('reads the barre and the first fret', () => {
      const gm = frame(
        6,
        note(6, 3, '<barre type="start"/>') +
          note(5, 5) +
          note(4, 5) +
          note(3, 3) +
          note(2, 3) +
          note(1, 3, '<barre type="stop"/>'),
        '<first-fret>3</first-fret>',
      );
      // Same as the library's G minor but with a changed note, so it stays custom.
      const custom = gm.replace(note(4, 5), note(4, 6));
      const { score } = parseMusicXml(file(harmony('G', 'minor', custom)));
      const chord = score.parts[0]!.staves[0]!.measures[0]!.chords![0]!;
      expect(chord.frame).toEqual({
        frets: [3, 3, 3, 6, 5, 3],
        base: 3,
        barre: { fret: 3, from: 1, to: 6 },
      });
    });

    it('drops a frame that does not fit the string count of the instrument', () => {
      const { score, report } = parseMusicXml(file(harmony('C', 'major', frame(4, note(1, 0)))));
      expect(score.parts[0]!.staves[0]!.measures[0]!.chords![0]!.frame).toBeUndefined();
      expect(report.dropped).toMatchObject({ frame: 1 });
      expect(validateScore(score)).toEqual([]);
    });
  });
});

describe('export: harmony', () => {
  function guitar(): Score {
    return createScore({ measures: 2, instruments: ['guitar-steel'] });
  }
  const put = (s: Score, measure: number, tick: number, text: string): Score =>
    setChord({
      staffId: chordStaffId(s.parts[0]!),
      measure,
      tick,
      chord: parseChord(text)!,
    }).apply(s);

  it('writes root, kind, bass, degrees and offset', () => {
    let s = guitar();
    s = put(s, 0, 0, 'Bbmaj7/F');
    s = put(s, 0, 960, 'E7#9');
    s = put(s, 1, 480, 'Cadd9');
    const xml = scoreToMusicXml(s);
    expect(xml).toContain(
      '<harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind text="maj7">major-seventh</kind><bass><bass-step>F</bass-step></bass></harmony>',
    );
    expect(xml).toContain(
      '<kind text="7#9">dominant</kind><degree><degree-value>9</degree-value><degree-alter>1</degree-alter><degree-type>alter</degree-type></degree><offset>960</offset>',
    );
    expect(xml).toContain(
      '<kind text="add9">major</kind><degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree><offset>480</offset>',
    );
  });

  it('writes the diagrams that are shown as frames, with the library shape', () => {
    let s = guitar();
    s = put(s, 0, 0, 'C');
    s = setChordDiagramMode({ partId: s.parts[0]!.id, mode: 'all' }).apply(s);
    const xml = scoreToMusicXml(s);
    expect(xml).toContain(
      '<frame><frame-strings>6</frame-strings><frame-frets>4</frame-frets>' +
        '<frame-note><string>5</string><fret>3</fret></frame-note>',
    );
    expect(xml).toContain('<frame-note><string>1</string><fret>0</fret></frame-note>');
    expect(xml).not.toContain('<frame-note><string>6</string>');
    expect(xml).toContain('polymnia-chord-diagrams-P1');
  });

  it('writes no frame when no diagram is shown', () => {
    const xml = scoreToMusicXml(put(guitar(), 0, 0, 'C'));
    expect(xml).not.toContain('<frame>');
  });

  it('writes the barre and the first fret', () => {
    let s = guitar();
    s = put(s, 0, 0, 'F#m');
    s = setChordDiagramMode({ partId: s.parts[0]!.id, mode: 'first' }).apply(s);
    const xml = scoreToMusicXml(s);
    expect(xml).toContain('<first-fret>2</first-fret>');
    expect(xml).toContain('<barre type="start"/>');
    expect(xml).toContain('<barre type="stop"/>');
  });

  it('numbers the staff of a chord in a part with two staves', () => {
    let s = createScore({ measures: 1, instruments: ['piano'] });
    s = setChord({
      staffId: s.parts[0]!.staves[1]!.id,
      measure: 0,
      tick: 0,
      chord: parseChord('Dm')!,
    }).apply(s);
    expect(scoreToMusicXml(s)).toContain('<staff>2</staff></harmony>');
  });

  it('reports nothing dropped', () => {
    expect(exportWithReport(put(guitar(), 0, 0, 'Am7')).dropped).toEqual({});
  });
});

describe('round trip: chords', () => {
  const QUALITIES = [
    '',
    'm',
    'dim',
    'aug',
    '5',
    '6',
    'm6',
    '6/9',
    'm6/9',
    '7',
    'maj7',
    'm7',
    'dim7',
    'aug7',
    'm7b5',
    'm(maj7)',
    '9',
    'maj9',
    'm9',
    '11',
    'maj11',
    'm11',
    '13',
    'maj13',
    'm13',
    'sus2',
    'sus4',
    '7sus4',
    '7sus2',
    'add9',
    'madd9',
    'add11',
    'add2',
    'add4',
    '7b5',
    '7#5',
    '7b9',
    '7#9',
    '7#11',
    '7b13',
    '7b9#9',
    '7b5b9',
    'maj7#11',
    'maj7#5',
    '9#11',
    '13b9',
    'm7add11',
    'dim7add9',
    'sus4add9',
  ];

  it('keeps every quality', () => {
    for (const quality of QUALITIES) {
      const parsed = parseChord(`C${quality}`);
      expect(parsed, quality).not.toBeNull();
      let s = createScore({ measures: 1, instruments: ['piano'] });
      s = setChord({
        staffId: chordStaffId(s.parts[0]!),
        measure: 0,
        tick: 0,
        chord: { root: parsed!.root, quality: parsed!.quality },
      }).apply(s);
      const { score, report } = parseMusicXml(scoreToMusicXml(s));
      expect(chordsOf(score), quality).toEqual([`0:C${parsed!.quality}`]);
      expect(report.dropped, quality).toEqual({});
    }
  });

  it('keeps roots, basses and positions', () => {
    let s = createScore({ measures: 3, instruments: ['piano'] });
    const id = chordStaffId(s.parts[0]!);
    const list: [number, number, string][] = [
      [0, 0, 'F#m7b5/C'],
      [0, 480, 'Gb'],
      [1, 960, 'Bbmaj7/D'],
      [2, 3600, 'Ebsus4'],
    ];
    for (const [measure, tick, text] of list) {
      s = setChord({ staffId: id, measure, tick, chord: parseChord(text)! }).apply(s);
    }
    const { score } = parseMusicXml(scoreToMusicXml(s));
    expect(staffChords(score, chordStaffId(score.parts[0]!)).map((x) => x.chord.tick)).toEqual([
      0, 480, 960, 3600,
    ]);
    expect(
      staffChords(score, chordStaffId(score.parts[0]!)).map((x) => formatChord(x.chord)),
    ).toEqual(['F#m7b5/C', 'Gb', 'Bbmaj7/D', 'Ebsus4']);
  });

  it('keeps diagram flags, custom fingerings and part options', () => {
    let s = createScore({ measures: 2, instruments: ['ukulele-concert'] });
    const id = chordStaffId(s.parts[0]!);
    s = setChord({ staffId: id, measure: 0, tick: 0, chord: parseChord('C')! }).apply(s);
    s = setChord({ staffId: id, measure: 0, tick: 960, chord: parseChord('G')! }).apply(s);
    s = setChord({ staffId: id, measure: 1, tick: 0, chord: parseChord('Am')! }).apply(s);
    s = setChordDiagramMode({ partId: s.parts[0]!.id, mode: 'first' }).apply(s);
    s = setChordDiagram({ staffId: id, measure: 1, tick: 0, diagram: false }).apply(s);
    s = setChordDiagram({ staffId: id, measure: 0, tick: 960, diagram: true }).apply(s);
    const { score } = parseMusicXml(scoreToMusicXml(s));
    expect(score.parts[0]!.chordDiagrams).toBe('first');
    expect(chordsOf(score)).toEqual(['0:C', '960:G[true]']);
    expect(score.parts[0]!.staves[0]!.measures[1]!.chords![0]!.diagram).toBe(false);
  });

  it('keeps a diagram on a tuning the library does not know', () => {
    let s = createScore({ measures: 1, instruments: ['guitar-steel'] });
    const id = chordStaffId(s.parts[0]!);
    s = setTuning({
      partId: s.parts[0]!.id,
      tuning: [
        { step: 'D', alter: 0, octave: 4 },
        { step: 'B', alter: 0, octave: 3 },
        { step: 'G', alter: 0, octave: 3 },
        { step: 'D', alter: 0, octave: 3 },
        { step: 'G', alter: 0, octave: 2 },
        { step: 'D', alter: 0, octave: 2 },
      ],
    }).apply(s);
    s = setChord({ staffId: id, measure: 0, tick: 0, chord: parseChord('G')! }).apply(s);
    s = setChordDiagramMode({ partId: s.parts[0]!.id, mode: 'all' }).apply(s);
    const { score } = parseMusicXml(scoreToMusicXml(s));
    expect(validateScore(score)).toEqual([]);
    expect(score.parts[0]!.chordDiagrams).toBe('all');
  });
});

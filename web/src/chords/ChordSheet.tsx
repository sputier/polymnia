import { useEffect, useId, useMemo, useState } from 'react';
import { useChordNaming } from '../engraving/chordNaming';
import { useI18n } from '../i18n/i18n';
import { formatChord, type NoteNaming } from '../score/chords';
import type { ChordSymbol, Part, Score } from '../score/types';
import {
  buildChordSheet,
  capoShapeOf,
  diagramParts,
  shapeFor,
  SHEET_PER_ROW,
  sheetRows,
  usedChords,
  type ShapeLookup,
  type SheetMeasure,
} from './sheet';
import { diagramDescription, diagramGeometry } from './sheetDiagram';
import './chordSheet.css';

export interface ChordSheetProps {
  score: Score;
  /** A measure was chosen: the host goes back to the score at that measure. */
  onMeasure: (index: number) => void;
  /** The part whose diagrams are shown; the host keeps it so the export prints the same part. */
  partId?: string | undefined;
  onPartChange?: ((id: string) => void) | undefined;
}

/** Pixels per diagram unit. */
const DIAGRAM_SCALE = 1.7;

/** Sharps and flats as music signs on screen (chord text only ever has b and # as accidentals). */
const pretty = (text: string): string => text.replace(/#/g, '♯').replace(/b/g, '♭');

/**
 * The chord sheet view: a grid of measures with their chord symbols, then the diagrams of the chords
 * used. A real table (rows of four measures, a row header with the measure numbers), every cell a
 * button that opens that measure in the score. Lazy chunk: only loaded when the view is chosen.
 */
export function ChordSheet({ score, onMeasure, partId, onPartChange }: ChordSheetProps) {
  const { t } = useI18n();
  const naming = useChordNaming();
  const sheet = useMemo(() => buildChordSheet(score), [score]);
  const rows = useMemo(() => sheetRows(sheet), [sheet]);
  const parts = useMemo(() => diagramParts(score), [score]);
  const hasChords = sheet.some((m) => m.chords.length > 0);

  return (
    <div className="chord-sheet">
      {!hasChords && (
        <p className="sheet-empty" role="status">
          {t('sheet.empty')}
        </p>
      )}
      {
        <table className="sheet-grid">
          <caption className="visually-hidden">
            {t('sheet.caption').replace('{count}', String(sheet.length))}
          </caption>
          <colgroup>
            <col className="sheet-col-head" />
            <col span={SHEET_PER_ROW} />
          </colgroup>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]!.index}>
                <th scope="row" className="sheet-rowhead">
                  <span aria-hidden="true">{row[0]!.index + 1}</span>
                  <span className="visually-hidden">
                    {t('sheet.rowLabel')
                      .replace('{from}', String(row[0]!.index + 1))
                      .replace('{to}', String(row[row.length - 1]!.index + 1))}
                  </span>
                </th>
                {row.map((m) => (
                  <td key={m.index}>
                    <Cell measure={m} naming={naming} onMeasure={onMeasure} />
                  </td>
                ))}
                {Array.from({ length: SHEET_PER_ROW - row.length }, (_, i) => (
                  <td key={`pad${i}`} className="sheet-pad" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
      {hasChords && parts.length > 0 && (
        <Diagrams
          sheet={sheet}
          parts={parts}
          naming={naming}
          partId={partId}
          onPartChange={onPartChange}
        />
      )}
    </div>
  );
}

function chordsLabel(measure: SheetMeasure, naming: NoteNaming, beat: string): string {
  const several = measure.chords.length > 1;
  return measure.chords
    .map(({ chord, beat: b }) =>
      several
        ? beat.replace('{chord}', formatChord(chord, naming)).replace('{beat}', String(b))
        : formatChord(chord, naming),
    )
    .join(', ');
}

function Cell({
  measure,
  naming,
  onMeasure,
}: {
  measure: SheetMeasure;
  naming: NoteNaming;
  onMeasure: (index: number) => void;
}) {
  const { t } = useI18n();
  const number = String(measure.index + 1);
  const several = measure.chords.length > 1;
  const names = chordsLabel(measure, naming, t('sheet.beatChord'));
  const label =
    measure.chords.length === 0
      ? t('sheet.measureEmpty').replace('{measure}', number)
      : t(measure.repeat ? 'sheet.measureRepeat' : 'sheet.measure')
          .replace('{measure}', number)
          .replace('{chords}', names);
  return (
    <button
      type="button"
      className="sheet-cell"
      data-measure={measure.index}
      {...(measure.repeat ? { 'data-repeat': '' } : {})}
      aria-label={label}
      onClick={() => onMeasure(measure.index)}
    >
      <span className="sheet-num" aria-hidden="true">
        {number}
      </span>
      {measure.repeat ? (
        <span className="sheet-repeat" aria-hidden="true">
          %
        </span>
      ) : (
        <span className="sheet-chords" aria-hidden="true">
          {measure.chords.map(({ chord, beat }) => (
            <span key={chord.id} className="sheet-chord" data-chord={formatChord(chord, naming)}>
              {pretty(formatChord(chord, naming))}
              {several && <small className="sheet-beat">{beat}</small>}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function Diagrams({
  sheet,
  parts,
  naming,
  partId,
  onPartChange,
}: {
  sheet: readonly SheetMeasure[];
  parts: readonly Part[];
  naming: NoteNaming;
  partId: string | undefined;
  onPartChange: ((id: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const selectId = useId();
  const [own, setOwn] = useState<string | undefined>(undefined);
  const chosen = partId ?? own;
  const setPartId = onPartChange ?? setOwn;
  const part = parts.find((p) => p.id === chosen) ?? parts[0]!;
  // The chord library is a small lazy chunk of its own, fetched once.
  const [lookup, setLookup] = useState<ShapeLookup | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void import('./library').then((m) => {
      if (!cancelled) setLookup(() => m.lookupShape);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const chords = useMemo(() => usedChords(sheet), [sheet]);

  return (
    <section className="sheet-diagrams" aria-labelledby={`${selectId}-h`}>
      <div className="sheet-diagrams-head">
        <h2 id={`${selectId}-h`}>{t('sheet.diagrams')}</h2>
        {parts.length > 1 ? (
          <label className="sheet-part">
            <span>{t('sheet.diagramsPart')}</span>
            <select value={part.id} onChange={(event) => setPartId(event.target.value)}>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="sheet-part-name">{part.name}</span>
        )}
        {part.capo ? (
          <span className="sheet-part-name">
            {t('sheet.capo').replace('{fret}', String(part.capo))}
          </span>
        ) : null}
      </div>
      {lookup === undefined ? (
        <p className="muted" role="status">
          {t('sheet.loading')}
        </p>
      ) : (
        <ul className="sheet-diagram-list">
          {chords.map((chord) => (
            <li key={chord.id}>
              <DiagramFigure chord={chord} part={part} naming={naming} lookup={lookup} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DiagramFigure({
  chord,
  part,
  naming,
  lookup,
}: {
  chord: ChordSymbol;
  part: Part;
  naming: NoteNaming;
  lookup: ShapeLookup;
}) {
  const { t } = useI18n();
  const shape = shapeFor(chord, part, lookup);
  const name = formatChord(chord, naming);
  const played = capoShapeOf(part, chord);
  const caption = played ? `${name} (${formatChord(played, naming)})` : name;
  const strings = shape?.frets.length ?? 0;
  const g = shape ? diagramGeometry(shape, strings) : undefined;
  return (
    <figure className="sheet-diagram" data-chord={name}>
      {g && shape ? (
        <svg
          role="img"
          aria-label={t('sheet.diagramLabel')
            .replace('{chord}', caption)
            .replace('{frets}', diagramDescription(shape))}
          width={g.width * DIAGRAM_SCALE}
          height={g.height * DIAGRAM_SCALE}
          viewBox={`0 0 ${g.width} ${g.height}`}
          data-frets={shape.frets.join(',')}
        >
          {g.lines.map((l, i) => (
            <line
              key={`l${i}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="currentColor"
              strokeWidth={l.w}
              strokeLinecap="round"
            />
          ))}
          {g.rects.map((r, i) => (
            <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="currentColor" />
          ))}
          {g.circles.map((c, i) => (
            <circle
              key={`c${i}`}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              {...(c.fill
                ? { fill: 'currentColor' }
                : { fill: 'none', stroke: 'currentColor', strokeWidth: 0.8 })}
            />
          ))}
          {g.texts.map((x, i) => (
            <text
              key={`t${i}`}
              x={x.x}
              y={x.y}
              fontSize={x.size}
              textAnchor={x.align}
              fill="currentColor"
            >
              {x.text}
            </text>
          ))}
        </svg>
      ) : (
        <span className="sheet-nodiagram muted">{t('sheet.noDiagram')}</span>
      )}
      <figcaption>{pretty(caption)}</figcaption>
    </figure>
  );
}

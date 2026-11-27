import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/i18n';
import {
  clefAt,
  durationTicks,
  findStaff,
  getInstrument,
  keyFifthsAt,
  measureLength,
  nominalMeasureLength,
  outOfRangeEvents,
  tempoAt,
  timeSignatureAt,
  type Clef,
  type Score,
  type TimeSignature,
} from '../score';
import type { EditorState, EditorStore } from './entry/editorStore';
import { instrumentName, keyAccidentals, keyTonic, pitchName } from './instrumentUi';

const CLEF_LABEL = {
  treble: 'clef.treble',
  bass: 'clef.bass',
  alto: 'clef.alto',
  tenor: 'clef.tenor',
  'treble-8vb': 'clef.treble-8vb',
  percussion: 'clef.percussion',
} as const;

const BEAT_TYPES = [2, 4, 8, 16] as const;
const KEYS = Array.from({ length: 15 }, (_, i) => i - 7);
const MAX_WARNINGS_SHOWN = 5;

interface Props {
  store: EditorStore;
  state: EditorState;
}

/** Attributes of the measure under the cursor (key, time, tempo, clef), measure editing and range warnings. */
export function Inspector({ store, state }: Props) {
  const { t, language } = useI18n();
  const { score, cursor } = state;
  const measure = Math.min(cursor.measure, score.measures.length - 1);
  const time = timeSignatureAt(score, measure);
  const fifths = keyFifthsAt(score, measure);
  const bpm = tempoAt(score, measure);
  const loc = findStaff(score, state.staffId);
  const part = loc ? score.parts[loc.partIndex] : undefined;
  const staff = loc && part ? part.staves[loc.staffIndex] : undefined;
  const inst = part ? getInstrument(part.instrument) : undefined;
  const clef = staff ? clefAt(staff, measure) : 'treble';
  const clefs: readonly Clef[] =
    inst?.staves === 2 ? ['treble', 'bass'] : (inst?.clefs ?? ['treble']);
  const allowed = clefs.includes(clef) ? clefs : [clef, ...clefs];

  const beatTicks = durationTicks({ base: beatBase(time.beatType), dots: 0 });
  const length = measureLength(score, measure);
  const pickup = length < nominalMeasureLength(score, measure);
  const pickupBeats = Math.max(1, Math.round(length / beatTicks));

  return (
    <div className="inspector">
      <h3 className="side-h">{t('inspector.measure').replace('{n}', String(measure + 1))}</h3>

      <label className="field">
        <span>{t('inspector.key')}</span>
        <select value={fifths} onChange={(e) => store.setKeySignature(Number(e.target.value))}>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {keyAccidentals(k)} ·{' '}
              {t('inspector.keyMajor').replace('{tonic}', keyTonic(k, language))}
            </option>
          ))}
        </select>
      </label>

      <TimeFields
        key={`${measure}-${time.beats}/${time.beatType}`}
        store={store}
        time={time}
        beatTicks={beatTicks}
        pickup={pickup}
        pickupBeats={pickupBeats}
      />

      <TempoFields
        key={`${measure}-${bpm}`}
        store={store}
        bpm={bpm}
        hasChange={score.measures[measure]?.tempoBpm !== undefined}
      />

      <label className="field">
        <span>{t('inspector.clef')}</span>
        {staff?.type === 'tab' ? (
          <p className="side-hint">{t('inspector.clefTab')}</p>
        ) : (
          <select value={clef} onChange={(e) => store.setClef(e.target.value as Clef)}>
            {allowed.map((c) => (
              <option key={c} value={c}>
                {t(CLEF_LABEL[c])}
              </option>
            ))}
          </select>
        )}
      </label>

      <fieldset className="field">
        <legend>{t('inspector.measures')}</legend>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => store.insertMeasure('before')}>
            {t('inspector.insertBefore')}
          </button>
          <button type="button" className="btn" onClick={() => store.insertMeasure('after')}>
            {t('inspector.insertAfter')}
          </button>
          <button type="button" className="btn" onClick={() => store.insertMeasure('end')}>
            {t('inspector.append')}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={score.measures.length === 1}
            onClick={() => store.deleteMeasure()}
          >
            {t('inspector.deleteMeasure')}
          </button>
        </div>
      </fieldset>

      <RangeWarnings score={score} />
    </div>
  );
}

function TimeFields({
  store,
  time,
  beatTicks,
  pickup,
  pickupBeats,
}: {
  store: EditorStore;
  time: TimeSignature;
  beatTicks: number;
  pickup: boolean;
  pickupBeats: number;
}) {
  const { t } = useI18n();
  const [beats, setBeats] = useState(time.beats);
  const [beatType, setBeatType] = useState<number>(time.beatType);
  return (
    <fieldset className="field">
      <legend>{t('inspector.time')}</legend>
      <div className="row">
        <label className="field small">
          <span>{t('inspector.beats')}</span>
          <input
            type="number"
            min={1}
            max={32}
            value={beats}
            onChange={(e) => setBeats(Number(e.target.value))}
          />
        </label>
        <label className="field small">
          <span>{t('inspector.beatType')}</span>
          <select value={beatType} onChange={(e) => setBeatType(Number(e.target.value))}>
            {BEAT_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={beats === time.beats && beatType === time.beatType}
          onClick={() =>
            store.setTimeSignature({
              beats,
              beatType: beatType as 2 | 4 | 8 | 16,
            })
          }
        >
          {t('inspector.apply')}
        </button>
      </div>
      <label className="radio">
        <input
          type="checkbox"
          checked={pickup}
          onChange={(e) => store.setMeasureLength(e.target.checked ? beatTicks : null)}
        />
        <span>{t('inspector.pickup')}</span>
      </label>
      {pickup && (
        <label className="field small">
          <span>{t('inspector.pickupBeats')}</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, time.beats - 1)}
            value={pickupBeats}
            onChange={(e) => {
              const n = Math.min(Math.max(1, Number(e.target.value) || 1), time.beats);
              store.setMeasureLength(n * beatTicks);
            }}
          />
        </label>
      )}
    </fieldset>
  );
}

function TempoFields({
  store,
  bpm,
  hasChange,
}: {
  store: EditorStore;
  bpm: number;
  hasChange: boolean;
}) {
  const { t } = useI18n();
  const [tempo, setTempo] = useState(bpm);
  return (
    <fieldset className="field">
      <legend>{t('inspector.tempo')}</legend>
      <div className="row">
        <input
          type="number"
          min={20}
          max={400}
          aria-label={t('inspector.tempo')}
          value={tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
        <button
          type="button"
          className="btn"
          disabled={!Number.isInteger(tempo) || tempo < 20 || tempo > 400 || tempo === bpm}
          onClick={() => store.setTempo(tempo)}
        >
          {t('inspector.tempoSet')}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!hasChange}
          onClick={() => store.setTempo(null)}
        >
          {t('inspector.tempoClear')}
        </button>
      </div>
      <p className="side-hint">{t('inspector.tempoHere').replace('{bpm}', String(bpm))}</p>
    </fieldset>
  );
}

function beatBase(beatType: number) {
  return ({ 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' } as const)[
    beatType as 1 | 2 | 4 | 8 | 16 | 32
  ];
}

function RangeWarnings({ score }: { score: Score }) {
  const { t, language } = useI18n();
  const warnings = useMemo(() => describeWarnings(score), [score]);
  return (
    <section className="range-warnings" aria-label={t('inspector.warnings')}>
      <h3 className="side-h">{t('inspector.warnings')}</h3>
      {warnings.length === 0 ? (
        <p className="side-hint">{t('inspector.warnNone')}</p>
      ) : (
        <ul>
          {warnings.slice(0, MAX_WARNINGS_SHOWN).map((w) => (
            <li key={w.eventId}>
              <span aria-hidden="true" className="warn-mark">
                !
              </span>
              {t('inspector.warnItem')
                .replace('{measure}', String(w.measure + 1))
                .replace('{note}', w.note)
                .replace('{instrument}', instrumentName(w.instrument, language))
                .replace('{low}', w.low)
                .replace('{high}', w.high)}
            </li>
          ))}
          {warnings.length > MAX_WARNINGS_SHOWN && (
            <li className="side-hint">
              {t('inspector.warnMore').replace(
                '{count}',
                String(warnings.length - MAX_WARNINGS_SHOWN),
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export interface WarningInfo {
  readonly eventId: string;
  readonly measure: number;
  readonly instrument: string;
  /** Sounding note name, and the sounding range of the part. */
  readonly note: string;
  readonly low: string;
  readonly high: string;
}

/** Out-of-range notes with the data to word the message. */
export function describeWarnings(score: Score): WarningInfo[] {
  return outOfRangeEvents(score).map((w) => ({
    eventId: w.eventId,
    measure: w.measure,
    instrument: w.instrument,
    note: pitchName(w.sounding),
    low: pitchName(w.low),
    high: pitchName(w.high),
  }));
}

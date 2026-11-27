import { useState, type FormEvent } from 'react';
import { Dialog } from '../editor/commands/Dialog';
import { format, useI18n, type Language } from '../i18n/i18n';
import { createScore, INSTRUMENTS, serialize, type TimeSignature } from '../score';
import { createScore as postScore } from '../api/scores';
import { describeFailure, instrumentName } from './text';

export interface NewScoreOptions {
  title: string;
  instruments: string[];
  keyFifths: number;
  time: TimeSignature;
  tempoBpm: number;
}

/** Guitars, ukuleles, cello and piano first (what most users write for), then the rest of the catalog. */
const PRIORITY = [
  'guitar-classical',
  'guitar-steel',
  'ukulele-soprano',
  'ukulele-concert',
  'ukulele-tenor',
  'cello',
  'piano',
];

export function orderedInstruments(): string[] {
  const ids = INSTRUMENTS.map((i) => i.id);
  return [
    ...PRIORITY.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !PRIORITY.includes(id)),
  ];
}

const MAJOR_EN = [
  'C♭',
  'G♭',
  'D♭',
  'A♭',
  'E♭',
  'B♭',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F♯',
  'C♯',
];
const MAJOR_FR = [
  'Do♭',
  'Sol♭',
  'Ré♭',
  'La♭',
  'Mi♭',
  'Si♭',
  'Fa',
  'Do',
  'Sol',
  'Ré',
  'La',
  'Mi',
  'Si',
  'Fa♯',
  'Do♯',
];
const MINOR_EN = [
  'A♭',
  'E♭',
  'B♭',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F♯',
  'C♯',
  'G♯',
  'D♯',
  'A♯',
];
const MINOR_FR = [
  'La♭',
  'Mi♭',
  'Si♭',
  'Fa',
  'Do',
  'Sol',
  'Ré',
  'La',
  'Mi',
  'Si',
  'Fa♯',
  'Do♯',
  'Sol♯',
  'Ré♯',
  'La♯',
];

/** "G major (1♯), relative minor E". */
export function keyLabel(
  fifths: number,
  language: Language,
  t: (key: 'new.major' | 'new.minor') => string,
): string {
  const majors = language === 'fr' ? MAJOR_FR : MAJOR_EN;
  const minors = language === 'fr' ? MINOR_FR : MINOR_EN;
  const accidentals = fifths === 0 ? '' : ` (${Math.abs(fifths)}${fifths > 0 ? '♯' : '♭'})`;
  return `${format(t('new.major'), { note: majors[fifths + 7]! })}${accidentals}, ${format(t('new.minor'), { note: minors[fifths + 7]! })}`;
}

const TIMES: TimeSignature[] = [
  { beats: 4, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 2, beatType: 4 },
  { beats: 6, beatType: 8 },
  { beats: 2, beatType: 2 },
  { beats: 5, beatType: 4 },
  { beats: 3, beatType: 8 },
  { beats: 9, beatType: 8 },
  { beats: 12, beatType: 8 },
  { beats: 7, beatType: 8 },
];

const DEFAULT_MEASURES = 8;

/** The JSON document of a new score for the dialog choices. */
export function newScoreDocument(options: NewScoreOptions): string {
  return serialize(
    createScore({
      title: options.title,
      measures: DEFAULT_MEASURES,
      instruments: options.instruments,
      keyFifths: options.keyFifths,
      time: options.time,
      tempoBpm: options.tempoBpm,
    }),
  );
}

interface NewScoreDialogProps {
  onCreated: (id: string) => void;
  onClose: () => void;
}

export function NewScoreDialog({ onCreated, onClose }: NewScoreDialogProps) {
  const { t, language } = useI18n();
  const [title, setTitle] = useState('');
  const [instruments, setInstruments] = useState<string[]>(['piano']);
  const [keyFifths, setKeyFifths] = useState(0);
  const [time, setTime] = useState(0);
  const [tempo, setTempo] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bpm = Number(tempo);
  const tempoOk = Number.isInteger(bpm) && bpm >= 20 && bpm <= 400;

  const toggle = (id: string) =>
    setInstruments((list) => (list.includes(id) ? list.filter((i) => i !== id) : [...list, id]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (instruments.length === 0) return setError(t('new.noInstrument'));
    if (!tempoOk) return setError(t('new.tempoInvalid'));
    setBusy(true);
    setError(null);
    try {
      const body = newScoreDocument({
        title: title.trim() || t('editor.untitled'),
        // Catalog order, not click order: the first part is the top staff.
        instruments: orderedInstruments().filter((id) => instruments.includes(id)),
        keyFifths,
        time: TIMES[time]!,
        tempoBpm: bpm,
      });
      const created = await postScore(body);
      onCreated(created.id);
    } catch (failure) {
      const { key, seconds } = describeFailure(failure);
      setError(format(t(key), { n: seconds ?? 0 }));
      setBusy(false);
    }
  };

  return (
    <Dialog className="dlg-form dlg-new" labelledBy="new-title" onClose={onClose}>
      <form className="dlg-body" onSubmit={(event) => void submit(event)}>
        <h2 id="new-title">{t('new.title')}</h2>
        <label className="field">
          <span>{t('new.titleLabel')}</span>
          <input
            data-autofocus
            value={title}
            maxLength={200}
            placeholder={t('editor.untitled')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <fieldset className="field">
          <legend>{t('new.instruments')}</legend>
          <p className="muted hint">{t('new.instrumentsHint')}</p>
          <div className="checks">
            {orderedInstruments().map((id) => (
              <label key={id} className="check">
                <input
                  type="checkbox"
                  checked={instruments.includes(id)}
                  onChange={() => toggle(id)}
                />
                <span>{instrumentName(id, language)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <label className="field">
            <span>{t('new.key')}</span>
            <select
              value={keyFifths}
              onChange={(event) => setKeyFifths(Number(event.target.value))}
            >
              {Array.from({ length: 15 }, (_, i) => i - 7).map((fifths) => (
                <option key={fifths} value={fifths}>
                  {keyLabel(fifths, language, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('new.time')}</span>
            <select value={time} onChange={(event) => setTime(Number(event.target.value))}>
              {TIMES.map((signature, i) => (
                <option key={i} value={i}>
                  {signature.beats}/{signature.beatType}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('new.tempo')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={20}
              max={400}
              value={tempo}
              aria-invalid={!tempoOk}
              onChange={(event) => setTempo(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t('new.creating') : t('new.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/i18n';
import { sampleSetFor, type PlaybackController } from '../playback';
import type { ChordPlayback } from '../playback/chordVoicing';
import { getInstrument, type Score } from '../score';

const SET_INSTRUMENT: Record<string, string> = { 'guitar-nylon': 'guitar-classical' };

/** Mute and solo per staff (Advanced mode, in the inspector). */
export function Mixer({ controller, score }: { controller: PlaybackController; score: Score }) {
  const { t, language } = useI18n();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const rows = score.parts.flatMap((part) => {
    // The TAB staff of a standard + TAB part repeats the standard staff and is not played.
    const staves = part.staves.filter(
      (staff) => staff.type !== 'tab' || !part.staves.some((o) => o.type === 'standard'),
    );
    return staves.map((staff, i) => ({
      id: staff.id,
      label: staves.length > 1 ? part.name + ' (' + String(i + 1) + ')' : part.name,
      instrument: part.instrument,
    }));
  });
  if (rows.length === 0) return <p className="panel-empty">{t('mixer.empty')}</p>;

  const standIns = new Map<string, string>();
  for (const part of score.parts) {
    const choice = sampleSetFor(part.instrument);
    if (!choice.standIn) continue;
    const used =
      getInstrument(SET_INSTRUMENT[choice.set] ?? choice.set)?.names[language] ?? choice.set;
    const name = getInstrument(part.instrument)?.names[language] ?? part.instrument;
    standIns.set(part.id, t('mixer.standIn').replace('{instrument}', name).replace('{set}', used));
  }

  const hasChords = score.parts.some((p) =>
    p.staves.some((st) => st.measures.some((m) => m.chords && m.chords.length > 0)),
  );

  return (
    <section className="mixer" aria-label={t('mixer.title')}>
      <h3>{t('mixer.title')}</h3>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span className="mixer-name">{row.label}</span>
            <button
              type="button"
              className="btn icon"
              aria-label={t('mixer.mute').replace('{staff}', row.label)}
              aria-pressed={state.muted.has(row.id)}
              onClick={() => controller.setMuted(row.id, !state.muted.has(row.id))}
            >
              {t('mixer.m')}
            </button>
            <button
              type="button"
              className="btn icon"
              aria-label={t('mixer.solo').replace('{staff}', row.label)}
              aria-pressed={state.solo.has(row.id)}
              onClick={() => controller.setSolo(row.id, !state.solo.has(row.id))}
            >
              {t('mixer.s')}
            </button>
          </li>
        ))}
      </ul>
      {(hasChords || state.chords !== 'off') && (
        <label className="field">
          <span>{t('mixer.chords')}</span>
          <select
            value={state.chords}
            onChange={(e) => void controller.setChordPlayback(e.target.value as ChordPlayback)}
          >
            <option value="off">{t('mixer.chordsOff')}</option>
            <option value="block">{t('mixer.chordsBlock')}</option>
            <option value="strum">{t('mixer.chordsStrum')}</option>
          </select>
        </label>
      )}
      {[...standIns.values()].map((text) => (
        <p key={text} className="mixer-note">
          {text}
        </p>
      ))}
    </section>
  );
}

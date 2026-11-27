import { useState, useSyncExternalStore } from 'react';
import { describePlaybackChange } from './entry/describe';
import { Icon } from '../components/Icon';
import { Kbd } from '../components/Kbd';
import { useI18n } from '../i18n/i18n';
import { TEMPO_SCALE_MAX, TEMPO_SCALE_MIN, type PlaybackController } from '../playback';

interface TransportBarProps {
  controller: PlaybackController;
  /** Selected event ids: what the loop button loops. */
  selection: readonly string[];
}

/** Play/pause, stop, back to start, loop, metronome and tempo. */
export function TransportBar({ controller, selection }: TransportBarProps) {
  const { t } = useI18n();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const playing = state.status === 'playing';
  // Start, pause and stop are announced once each; nothing is said while it plays, and nothing on the first render.
  const [seenStatus, setSeenStatus] = useState(state.status);
  const [said, setSaid] = useState('');
  if (seenStatus !== state.status) {
    setSeenStatus(state.status);
    setSaid(describePlaybackChange(seenStatus, state.status, t));
  }
  const percent = Math.round(state.tempoScale * 100);

  const toggleLoop = () => {
    if (state.loop) controller.setLoop(false);
    else controller.setLoop(true, controller.spanOfEvents(selection));
  };

  return (
    <div className="transport" role="toolbar" aria-label={t('transport.label')}>
      <button type="button" className="btn ghost icon" onClick={() => controller.home()}>
        <Icon name="skipBack" />
        <span className="visually-hidden">{t('transport.home')}</span>
      </button>
      <button
        type="button"
        className="btn primary icon"
        aria-label={playing ? t('transport.pause') : t('transport.play')}
        onClick={() => controller.toggle()}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <button
        type="button"
        className="btn ghost icon"
        aria-label={t('transport.stop')}
        onClick={() => controller.stop()}
      >
        <Icon name="stop" />
      </button>
      <button
        type="button"
        className="btn icon"
        aria-label={t('transport.loop')}
        aria-pressed={state.loop}
        onClick={toggleLoop}
      >
        <Icon name="loop" />
      </button>
      <button
        type="button"
        className="btn icon"
        aria-label={t('transport.metronome')}
        aria-pressed={state.metronome}
        onClick={() => controller.setMetronome(!state.metronome)}
      >
        <Icon name="metronome" />
      </button>
      <label className="transport-tempo">
        <span>{t('transport.tempo')}</span>
        <input
          type="range"
          min={TEMPO_SCALE_MIN * 100}
          max={TEMPO_SCALE_MAX * 100}
          step={5}
          value={percent}
          onChange={(e) => controller.setTempoScale(Number(e.target.value) / 100)}
        />
        <output aria-live="off">
          ♩ = {state.bpm} <span className="hide-sm">({percent} %)</span>
        </output>
      </label>
      <span className="transport-hint hide-sm" aria-hidden="true">
        <Kbd keys="Space" />
      </span>
      <span className="transport-status" role="status">
        {state.loading ? t('transport.loading') : state.error ? t('transport.error') : said}
      </span>
    </div>
  );
}

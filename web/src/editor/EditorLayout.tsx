import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Kbd } from '../components/Kbd';
import type { SaveState } from '../components/SaveStatus';
import { ScoreView } from '../engraving/ScoreView';
import { useI18n } from '../i18n/i18n';
import type { Shortcut } from '../shortcuts/registry';
import { useShortcuts } from '../shortcuts/useShortcuts';
import { ShortcutStrip } from './ShortcutStrip';
import { SidePanel } from './SidePanel';
import { describeDuration, describeEvent, formatNotice, positionLabel } from './entry/describe';
import { EditorStore, newEditorScore } from './entry/editorStore';
import { entryShortcuts } from './entry/entryShortcuts';
import { sequenceOf } from './entry/plan';
import { Palette } from './Palette';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { useMediaQuery } from './useMediaQuery';
import { useUiMode } from './uiMode';

/** Below this width the side panels float over the score. */
export const OVERLAY_QUERY = '(max-width: 1099px)';

interface EditorLayoutProps {
  saveState?: SaveState;
  /** The editor state. Defaults to a new empty score (tests pass their own). */
  store?: EditorStore;
}

/** Preview and test parameters of the hash: `#/editor?new=<measures>` and `?fixture=<name>`. */
function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

export function EditorLayout({ saveState = 'saved', store: given }: EditorLayoutProps) {
  const { t } = useI18n();
  const [store] = useState(() => {
    if (given) return given;
    const measures = Number(hashParams().get('new'));
    return new EditorStore(newEditorScore(measures >= 1 && measures <= 2000 ? measures : 8));
  });
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const fixture = useMemo(() => hashParams().has('fixture'), []);
  // Test hook (docs/editor.md): `window.__polymnia.store` next to the engraver ScoreView exposes.
  useEffect(() => {
    // Fixture preview: the hook only appears once everything is drawn (docs/engraving.md).
    if (fixture) return;
    const w = window as unknown as { __polymnia?: Record<string, unknown> };
    w.__polymnia = { ...w.__polymnia, store };
  }, [store, fixture]);
  const { mode, setMode, toggle: toggleMode } = useUiMode();
  const overlay = useMediaQuery(OVERLAY_QUERY);
  const advanced = mode === 'advanced';
  const [title, setTitle] = useState('');
  // null = "not chosen yet": open on wide screens, closed as an overlay.
  const [leftChoice, setLeftChoice] = useState<boolean | null>(null);
  const [rightChoice, setRightChoice] = useState<boolean | null>(null);

  const leftOpen = leftChoice ?? !overlay;
  const rightOpen = advanced && (rightChoice ?? !overlay);

  const toggleLeft = () => {
    setLeftChoice(!leftOpen);
    if (overlay && !leftOpen) setRightChoice(false);
  };
  const toggleRight = () => {
    if (!advanced) return;
    setRightChoice(!rightOpen);
    if (overlay && !rightOpen) setLeftChoice(false);
  };
  const closeOverlays = () => {
    setLeftChoice(false);
    setRightChoice(false);
  };

  const shortcutList: Shortcut[] = [
    {
      id: 'editor.toggleInstruments',
      keys: 'Mod+B',
      labelKey: 'shortcut.toggleInstruments',
      handler: toggleLeft,
    },
    {
      id: 'editor.toggleInspector',
      keys: 'Mod+I',
      labelKey: 'shortcut.toggleInspector',
      handler: toggleRight,
    },
    {
      id: 'editor.toggleMode',
      keys: 'Alt+A',
      labelKey: 'shortcut.toggleMode',
      handler: toggleMode,
    },
    {
      id: 'editor.closePanels',
      keys: 'Escape',
      labelKey: 'shortcut.closePanels',
      handler: () => {
        if (overlay && (leftOpen || rightOpen)) return closeOverlays();
        // Esc also leaves note input, as in MuseScore.
        if (state.mode === 'note') return store.toggleInputMode();
        return false;
      },
    },
    ...entryShortcuts(store),
  ];
  useShortcuts(shortcutList);

  // Highlight: the selection, or in note input the event the next note will overwrite.
  const highlighted = useMemo(() => {
    if (state.mode === 'select') return state.selection;
    const seq = sequenceOf(state.score, state.staffId, state.voice);
    const at = seq.find(
      (i) =>
        i.measure === state.cursor.measure &&
        i.tick <= state.cursor.tick + 1e-6 &&
        state.cursor.tick < i.tick + i.ticks - 1e-6,
    );
    return at ? [at.id] : [];
  }, [state.mode, state.selection, state.score, state.staffId, state.voice, state.cursor]);

  const ann = state.announcement;
  const liveMessage = ann
    ? 'eventId' in ann
      ? describeEvent(state.score, ann.eventId, t)
      : formatNotice(ann.notice, t)
    : '';
  const notice = ann && 'notice' in ann ? formatNotice(ann.notice, t) : undefined;
  const durationLabel = describeDuration(state.duration, t);

  const showScrim = overlay && (leftOpen || rightOpen);

  return (
    <div className="editor" data-mode={mode}>
      <TopBar
        title={title}
        onTitleChange={setTitle}
        saveState={saveState}
        mode={mode}
        onModeChange={setMode}
        leftOpen={leftOpen}
        onToggleLeft={toggleLeft}
        rightOpen={rightOpen}
        onToggleRight={toggleRight}
      />
      <div className="body">
        <SidePanel
          id="panel-instruments"
          side="left"
          title={t('instruments.title')}
          open={leftOpen}
          overlay={overlay}
          onClose={() => setLeftChoice(false)}
        >
          <p className="panel-empty">{t('instruments.empty')}</p>
          {!advanced && (
            <div className="tip-hint">
              <p>{t('mode.hint')}</p>
              <button type="button" className="btn" onClick={() => setMode('advanced')}>
                {t('mode.hintAction')} <Kbd keys="Alt+A" />
              </button>
            </div>
          )}
        </SidePanel>

        <main className="center">
          <div className="score-area">
            <Palette store={store} state={state} advanced={advanced} />
            <section className="paper" aria-label={t('paper.label')}>
              <h1 className="ptitle">{title || t('editor.untitled')}</h1>
              <ScoreView
                {...(fixture ? {} : { score: state.score })}
                selection={highlighted}
                liveMessage={liveMessage}
                onHit={(hit, event) => store.click(hit, event.shiftKey)}
              />
            </section>
            <ShortcutStrip />
          </div>
        </main>

        {advanced && (
          <SidePanel
            id="panel-inspector"
            side="right"
            title={t('inspector.title')}
            open={rightOpen}
            overlay={overlay}
            onClose={() => setRightChoice(false)}
          >
            <p className="panel-empty">{t('inspector.empty')}</p>
          </SidePanel>
        )}
        {showScrim && <div className="scrim" aria-hidden="true" onClick={closeOverlays} />}
      </div>
      <StatusBar
        inputMode={state.mode}
        duration={durationLabel.charAt(0).toUpperCase() + durationLabel.slice(1)}
        measure={state.cursor.measure + 1}
        beat={positionLabel(state.score, state.cursor.measure, state.cursor.tick)}
        saveState={saveState}
        {...(notice ? { notice } : {})}
        uiMode={mode}
      />
    </div>
  );
}

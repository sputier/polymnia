import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Engraver } from '../engraving/engraver';
import { playback, previewNote } from '../playback';
import { followPlayback } from '../playback/follow';
import { Kbd } from '../components/Kbd';
import type { SaveState } from '../components/SaveStatus';
import { ScoreView } from '../engraving/ScoreView';
import { useI18n } from '../i18n/i18n';
import type { Shortcut } from '../shortcuts/registry';
import { CommandDialogs } from '../route/chunks';
import { useShortcuts } from '../shortcuts/useShortcuts';
// Not lazy: the keys typed right after Alt+K must find the field.
import { ChordEntry } from './ChordEntry';
import { Inspector, describeWarnings } from './Inspector';
import { InstrumentsPanel } from './InstrumentsPanel';
import { instrumentName } from './instrumentUi';
import { Mixer } from './Mixer';
import { ShortcutStrip } from './ShortcutStrip';
import { SidePanel } from './SidePanel';
import type { DialogKind } from './commands/CommandDialogs';
import { describeDuration, describeEvent, formatNotice, positionLabel } from './entry/describe';
import { EditorStore, newEditorScore } from './entry/editorStore';
import { entryShortcuts } from './entry/entryShortcuts';
import { structureShortcuts } from './entry/structureShortcuts';
import { sequenceOf } from './entry/plan';
import { useMusicXmlIO } from './musicXmlIO';
import { ShareDialog } from '../sharing/ShareDialog';
import { Palette } from './Palette';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { TransportBar } from './TransportBar';
import { useMediaQuery } from './useMediaQuery';
import { getChordNaming, setChordNaming } from '../engraving/chordNaming';
import { useUiMode } from './uiMode';

// The on-screen piano and the MIDI input are a lazy chunk, fetched the first time the piano opens.
const Piano = lazy(() => import('./piano/Piano'));

const PIANO_STORAGE_KEY = 'polymnia.piano';
function readPianoPref(): boolean {
  try {
    return localStorage.getItem(PIANO_STORAGE_KEY) === 'open';
  } catch {
    return false;
  }
}

/** Below this width the side panels float over the score. */
export const OVERLAY_QUERY = '(max-width: 1099px)';

interface EditorLayoutProps {
  saveState?: SaveState;
  /** The editor state. Defaults to a new empty score (tests pass their own). */
  store?: EditorStore;
  /** Controlled title (a stored score); without it the title is local to the editor. */
  title?: string;
  onTitleChange?: (title: string) => void;
  /** Ctrl+S: save now (a stored score). */
  onSaveNow?: () => void;
  /** Called before leaving for the library; return false to stay (unsaved work the user keeps). */
  onBeforeLeave?: () => boolean;
  /** The id of the stored score: sharing needs one (the scratch editor cannot be shared). */
  scoreId?: string;
}

/** Preview and test parameters of the hash: `#/editor?new=<measures>` and `?fixture=<name>`. */
function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

/** Hooks the note entry of the store to the audio: each entered note is heard at once. */
function bindNotePreview(store: EditorStore): () => void {
  store.onNoteEntered = (pitch) => {
    const { score, staffId } = store.getState();
    const part = score.parts.find((p) => p.staves.some((s) => s.id === staffId));
    if (part) previewNote(part.id, pitch);
  };
  return () => {
    store.onNoteEntered = undefined;
  };
}

export function EditorLayout({
  saveState = 'saved',
  store: given,
  title: givenTitle,
  onTitleChange,
  onSaveNow,
  onBeforeLeave,
  scoreId,
}: EditorLayoutProps) {
  const { t, language } = useI18n();
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
    w.__polymnia = { ...w.__polymnia, store, playback };
  }, [store, fixture]);
  // Playback: the controller plays the score of the store; it follows it on the engraved score.
  const [engraver, setEngraver] = useState<Engraver | null>(null);
  useEffect(() => {
    playback.setScore(state.score);
  }, [state.score]);
  useEffect(() => (engraver ? followPlayback(playback, engraver) : undefined), [engraver]);
  // Selecting notes moves the playhead there (play from selection) while nothing is playing.
  useEffect(() => {
    if (state.mode !== 'select' || playback.getState().status === 'playing') return;
    const tick = playback.tickOfEvents(state.selection);
    if (tick !== undefined) playback.seekTick(tick);
  }, [state.mode, state.selection, state.score]);
  // Each note entered is heard at once, on the instrument of the staff it was entered in.
  useEffect(() => bindNotePreview(store), [store]);
  // The audio engine is a lazy chunk: start fetching it at the first interaction (a user gesture,
  // which is also what lets the audio context start).
  useEffect(() => {
    const warm = () => playback.warmUp();
    const opts = { once: true, capture: true } as const;
    document.addEventListener('pointerdown', warm, opts);
    document.addEventListener('keydown', warm, opts);
    return () => {
      document.removeEventListener('pointerdown', warm, opts);
      document.removeEventListener('keydown', warm, opts);
    };
  }, []);
  const { mode, setMode, toggle: toggleMode } = useUiMode();
  const overlay = useMediaQuery(OVERLAY_QUERY);
  const advanced = mode === 'advanced';
  const [localTitle, setLocalTitle] = useState('');
  const title = givenTitle ?? localTitle;
  const setTitle = onTitleChange ?? setLocalTitle;
  const io = useMusicXmlIO(store, title, setTitle);
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

  // Command palette and cheat sheet (lazy chunk, fetched in idle time so the first open is instant).
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  useEffect(() => {
    const load = () => void CommandDialogs.preload();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(load);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, []);
  // On-screen piano: stays mounted once opened so a connected MIDI keyboard keeps working.
  const [pianoOpen, setPianoOpen] = useState(readPianoPref);
  const [pianoLoaded, setPianoLoaded] = useState(pianoOpen);
  const togglePiano = () => {
    const next = !pianoOpen;
    setPianoOpen(next);
    if (next) setPianoLoaded(true);
    try {
      localStorage.setItem(PIANO_STORAGE_KEY, next ? 'open' : 'closed');
    } catch {
      // The choice is a convenience.
    }
  };
  // Focus mode: only the score and a pill. Not persisted.
  const [focus, setFocus] = useState(false);
  // "Add an instrument" (palette): opens the instruments panel on the picker.
  const [addRequest, setAddRequest] = useState(0);
  // Share dialog (a stored score only).
  const [sharing, setSharing] = useState(false);
  const openShare = scoreId ? () => setSharing(true) : undefined;

  const shortcutList: Shortcut[] = [
    {
      id: 'app.palette',
      keys: 'Mod+K',
      labelKey: 'shortcut.palette',
      group: 'help',
      palette: false,
      allowInInput: true,
      handler: () => setDialog('palette'),
    },
    {
      id: 'file.import',
      keys: 'Mod+O',
      labelKey: 'io.importLabel',
      group: 'file',
      handler: io.pickFile,
    },
    {
      id: 'file.exportMusicXml',
      keys: 'Mod+Shift+E',
      labelKey: 'command.exportMusicXml',
      group: 'file',
      handler: () => io.exportAs('musicxml'),
    },
    {
      id: 'file.exportMxl',
      keys: 'Mod+Shift+M',
      labelKey: 'command.exportMxl',
      group: 'file',
      handler: () => io.exportAs('mxl'),
    },
    {
      id: 'file.exportMidi',
      keys: 'Mod+Shift+U',
      labelKey: 'command.exportMidi',
      group: 'file',
      handler: () => io.exportAs('midi'),
    },
    {
      id: 'file.exportPdf',
      keys: 'Mod+Shift+F',
      labelKey: 'command.exportPdf',
      group: 'file',
      handler: () => io.exportAs('pdf'),
    },
    {
      id: 'file.exportPng',
      keys: 'Mod+Shift+G',
      labelKey: 'command.exportPng',
      group: 'file',
      handler: () => io.exportAs('png'),
    },
    {
      id: 'file.share',
      keys: 'Mod+Shift+L',
      labelKey: 'shortcut.share',
      group: 'file',
      enabled: () => scoreId !== undefined,
      handler: () => (openShare ? openShare() : false),
    },
    {
      id: 'app.cheatSheet',
      keys: 'Question',
      labelKey: 'shortcut.cheatSheet',
      group: 'help',
      handler: () => setDialog('sheet'),
    },
    {
      id: 'app.credits',
      keys: '',
      labelKey: 'shortcut.credits',
      group: 'help',
      handler: () => setDialog('credits'),
    },
    {
      id: 'view.focus',
      keys: 'Alt+F',
      labelKey: 'shortcut.focusMode',
      group: 'view',
      allowInInput: true,
      handler: () => setFocus(!focus),
    },
    {
      id: 'editor.togglePiano',
      keys: 'P',
      labelKey: 'shortcut.togglePiano',
      group: 'view',
      handler: togglePiano,
    },
    {
      id: 'editor.toggleInstruments',
      keys: 'Mod+B',
      labelKey: 'shortcut.toggleInstruments',
      group: 'view',
      handler: toggleLeft,
    },
    {
      id: 'editor.toggleInspector',
      keys: 'Mod+I',
      labelKey: 'shortcut.toggleInspector',
      group: 'view',
      enabled: () => advanced,
      handler: toggleRight,
    },
    {
      id: 'editor.toggleMode',
      keys: 'Alt+A',
      labelKey: 'shortcut.toggleMode',
      group: 'view',
      handler: toggleMode,
    },
    {
      id: 'editor.toggleChordNames',
      keys: '',
      labelKey: 'shortcut.toggleChordNames',
      group: 'view',
      handler: () => setChordNaming(getChordNaming() === 'solfege' ? 'letters' : 'solfege'),
    },
    {
      id: 'editor.closePanels',
      keys: 'Escape',
      labelKey: 'shortcut.closePanels',
      group: 'view',
      palette: false,
      handler: () => {
        if (focus) return setFocus(false);
        if (overlay && (leftOpen || rightOpen)) return closeOverlays();
        // Esc also leaves note input, as in MuseScore.
        if (state.mode === 'note') return store.toggleInputMode();
        return false;
      },
    },
    {
      id: 'playback.playPause',
      keys: 'Space',
      labelKey: 'shortcut.playPause',
      group: 'playback',
      handler: (event) => {
        // A focused button or link takes Space itself (it activates on its own).
        const target = event?.target;
        if (target instanceof HTMLElement && target.closest('button, a, summary, [role=button]'))
          return false;
        playback.toggle();
      },
    },
    {
      id: 'playback.home',
      keys: 'Home',
      labelKey: 'shortcut.playHome',
      group: 'playback',
      handler: () => playback.home(),
    },
    ...(onSaveNow
      ? [
          {
            id: 'file.save',
            keys: 'Mod+S',
            labelKey: 'shortcut.saveNow',
            group: 'file',
            allowInInput: true,
            handler: onSaveNow,
          } satisfies Shortcut,
        ]
      : []),
    ...(onBeforeLeave
      ? [
          {
            id: 'file.library',
            keys: 'Alt+L',
            labelKey: 'shortcut.backToLibrary',
            group: 'file',
            allowInInput: true,
            handler: () => {
              if (onBeforeLeave()) window.location.hash = '#/';
            },
          } satisfies Shortcut,
        ]
      : []),
    ...entryShortcuts(store),
    ...structureShortcuts(store, () => {
      setLeftChoice(true);
      if (overlay) setRightChoice(false);
      setAddRequest((n) => n + 1);
    }),
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

  // Out-of-range notes: a warning color plus a mark and a tooltip (see docs/editor.md).
  const warnings = useMemo(
    () =>
      describeWarnings(state.score).map((w) => ({
        id: w.eventId,
        text:
          w.kind === 'fretting'
            ? t('score.noFingering').replace('{instrument}', instrumentName(w.instrument, language))
            : t('score.outOfRange')
                .replace('{instrument}', instrumentName(w.instrument, language))
                .replace('{low}', w.low)
                .replace('{high}', w.high),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` changes identity on every render; the language is what matters.
    [state.score, language],
  );

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
    <div
      className="editor"
      data-mode={mode}
      {...(focus ? { 'data-focus': '' } : {})}
      {...io.dropProps}
    >
      <TopBar
        onOpenPalette={() => setDialog('palette')}
        onOpenCredits={() => setDialog('credits')}
        onToggleFocus={() => setFocus(true)}
        title={title}
        onTitleChange={setTitle}
        {...(onBeforeLeave ? { onBeforeLeave } : {})}
        saveState={saveState}
        mode={mode}
        onModeChange={setMode}
        leftOpen={leftOpen}
        onToggleLeft={toggleLeft}
        rightOpen={rightOpen}
        onToggleRight={toggleRight}
        onExport={io.exportAs}
        onImportFile={io.importFile}
        {...(openShare ? { onShare: openShare } : {})}
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
          <InstrumentsPanel store={store} state={state} addRequest={addRequest} />
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
          <TransportBar controller={playback} selection={state.selection} />
          <div className="score-area">
            <Palette store={store} state={state} advanced={advanced} />
            <section className="paper" aria-label={t('paper.label')}>
              <h1 className="ptitle">{title || t('editor.untitled')}</h1>
              <ScoreView
                {...(fixture ? {} : { score: state.score })}
                selection={highlighted}
                warnings={warnings}
                liveMessage={liveMessage}
                onEngraver={setEngraver}
                onHit={(hit, event) => store.click(hit, event.shiftKey)}
                overlay={
                  state.chordEntry && (
                    <ChordEntry
                      key={`${state.chordEntry.staffId}/${state.chordEntry.measure}/${state.chordEntry.tick}`}
                      store={store}
                      entry={state.chordEntry}
                      score={state.score}
                      engraver={engraver}
                    />
                  )
                }
              />
            </section>
            <ShortcutStrip />
          </div>
          {pianoLoaded && (
            <Suspense fallback={null}>
              <Piano store={store} controller={playback} open={pianoOpen} onClose={togglePiano} />
            </Suspense>
          )}
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
            <Inspector store={store} state={state} />
            <Mixer controller={playback} score={state.score} />
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
      {focus && (
        <div className="focus-pill" role="status">
          <span>{t('focus.label')}</span>
          <span>
            <Kbd keys="Escape" /> {t('focus.exit')}
          </span>
        </div>
      )}
      {dialog && (
        <Suspense fallback={null}>
          <CommandDialogs dialog={dialog} onClose={() => setDialog(null)} onOpen={setDialog} />
        </Suspense>
      )}
      {sharing && scoreId && (
        <ShareDialog
          scoreId={scoreId}
          title={title || t('editor.untitled')}
          onClose={() => setSharing(false)}
          onExport={io.exportAs}
        />
      )}
      {io.overlay}
    </div>
  );
}

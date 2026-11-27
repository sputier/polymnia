import { useState } from 'react';
import { Kbd } from '../components/Kbd';
import type { SaveState } from '../components/SaveStatus';
import { ScoreView } from '../engraving/ScoreView';
import { useI18n } from '../i18n/i18n';
import type { Shortcut } from '../shortcuts/registry';
import { useShortcuts } from '../shortcuts/useShortcuts';
import { ShortcutStrip } from './ShortcutStrip';
import { SidePanel } from './SidePanel';
import { StatusBar, type Duration, type InputMode } from './StatusBar';
import { TopBar } from './TopBar';
import { useMediaQuery } from './useMediaQuery';
import { useUiMode } from './uiMode';

/** Below this width the side panels float over the score. */
export const OVERLAY_QUERY = '(max-width: 1099px)';

interface EditorLayoutProps {
  saveState?: SaveState;
  inputMode?: InputMode;
  duration?: Duration;
  measure?: number;
  beat?: number;
}

export function EditorLayout({
  saveState = 'saved',
  inputMode = 'select',
  duration = 'quarter',
  measure = 1,
  beat = 1,
}: EditorLayoutProps) {
  const { t } = useI18n();
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
        if (!overlay || (!leftOpen && !rightOpen)) return false;
        closeOverlays();
      },
    },
  ];
  useShortcuts(shortcutList);

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
            <section className="paper" aria-label={t('paper.label')}>
              <h1 className="ptitle">{title || t('editor.untitled')}</h1>
              <ScoreView />
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
        inputMode={inputMode}
        duration={duration}
        measure={measure}
        beat={beat}
        saveState={saveState}
        uiMode={mode}
      />
    </div>
  );
}

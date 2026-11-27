import type { ReactNode } from 'react';
import { Kbd } from '../components/Kbd';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { NoteBase } from '../score';
import { DURATION_SHORTCUT, keysOf } from './entry/entryShortcuts';
import type { EditorState, EditorStore } from './entry/editorStore';

const DURATIONS: readonly { base: Exclude<NoteBase, '32nd'>; label: MessageKey }[] = [
  { base: '16th', label: 'duration.sixteenth' },
  { base: 'eighth', label: 'duration.eighth' },
  { base: 'quarter', label: 'duration.quarter' },
  { base: 'half', label: 'duration.half' },
  { base: 'whole', label: 'duration.whole' },
];

/** Note value glyphs, drawn so they do not depend on a music font. */
function NoteGlyph({ base }: { base: NoteBase }) {
  const open = base === 'whole' || base === 'half';
  const stem = base !== 'whole';
  const flags = base === 'eighth' ? 1 : base === '16th' ? 2 : 0;
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <ellipse
        cx="9"
        cy="17"
        rx="4.4"
        ry="3.2"
        transform="rotate(-20 9 17)"
        fill={open ? 'none' : 'currentColor'}
      />
      {stem && <path d="M13 16V4" />}
      {Array.from({ length: flags }, (_, i) => (
        <path key={i} d={`M13 ${4 + i * 3.6}c1 4 6 4 5 9`} fill="none" />
      ))}
    </svg>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

interface ButtonProps {
  label: string;
  keys: string;
  pressed?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}

/** Palette button: the accessible name is the label, the tooltip also shows the key. */
function PaletteButton({ label, keys, pressed, disabled, onPress, children }: ButtonProps) {
  return (
    <span className="tip-wrap">
      <button
        type="button"
        className="btn icon pal-btn"
        aria-label={label}
        aria-keyshortcuts={keys.replace('Mod', 'Control')}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onPress();
        }}
      >
        {children}
      </button>
      <span className="tip" aria-hidden="true">
        {label} <Kbd keys={keys} />
      </span>
    </span>
  );
}

interface PaletteProps {
  store: EditorStore;
  state: EditorState;
  /** Triplet is an Advanced mode tool. */
  advanced: boolean;
}

export function Palette({ store, state, advanced }: PaletteProps) {
  const { t } = useI18n();
  const { duration, mode } = state;
  return (
    <div className="palette" role="toolbar" aria-label={t('palette.label')}>
      <PaletteButton
        label={t('palette.input')}
        keys={keysOf('entry.toggleInput')}
        pressed={mode === 'note'}
        onPress={() => store.toggleInputMode()}
      >
        <Glyph>
          <path d="M4 20l1-4 11-11 3 3L8 19z" fill="none" />
          <path d="M14 7l3 3" />
        </Glyph>
      </PaletteButton>
      <span className="pal-sep" aria-hidden="true" />
      {DURATIONS.map(({ base, label }) => (
        <PaletteButton
          key={base}
          label={t(label)}
          keys={keysOf(DURATION_SHORTCUT[base])}
          pressed={duration.base === base}
          onPress={() => store.setDuration(base)}
        >
          <NoteGlyph base={base} />
        </PaletteButton>
      ))}
      <PaletteButton
        label={t('palette.dot')}
        keys={keysOf('entry.dot')}
        pressed={duration.dots > 0}
        onPress={() => store.toggleDot()}
      >
        <Glyph>
          <circle cx="12" cy="12" r="2.6" fill="currentColor" />
        </Glyph>
      </PaletteButton>
      <PaletteButton
        label={t('palette.rest')}
        keys={keysOf('entry.rest')}
        onPress={() => store.enterRest()}
      >
        <Glyph>
          <path d="M9 4h6l-4 6 5 4-4 6" fill="none" />
        </Glyph>
      </PaletteButton>
      <span className="pal-sep" aria-hidden="true" />
      <PaletteButton
        label={t('palette.sharp')}
        keys={keysOf('entry.sharp')}
        pressed={state.pendingAlter === 1}
        onPress={() => store.accidental(1)}
      >
        <span aria-hidden="true">♯</span>
      </PaletteButton>
      <PaletteButton
        label={t('palette.flat')}
        keys={keysOf('entry.flat')}
        pressed={state.pendingAlter === -1}
        onPress={() => store.accidental(-1)}
      >
        <span aria-hidden="true">♭</span>
      </PaletteButton>
      <PaletteButton
        label={t('palette.natural')}
        keys={keysOf('entry.natural')}
        pressed={state.pendingAlter === 0}
        onPress={() => store.accidental(0)}
      >
        <span aria-hidden="true">♮</span>
      </PaletteButton>
      <PaletteButton
        label={t('palette.tie')}
        keys={keysOf('entry.tie')}
        onPress={() => store.toggleTie()}
      >
        <Glyph>
          <path d="M4 10c2 8 14 8 16 0" fill="none" />
        </Glyph>
      </PaletteButton>
      <PaletteButton
        label={t('palette.slur')}
        keys={keysOf('entry.slur')}
        onPress={() => store.toggleSlur()}
      >
        <Glyph>
          <path d="M3 16c3-9 15-9 18 0" fill="none" />
        </Glyph>
      </PaletteButton>
      {advanced && (
        <PaletteButton
          label={t('palette.triplet')}
          keys={keysOf('entry.triplet')}
          onPress={() => store.triplet()}
        >
          <span aria-hidden="true">3</span>
        </PaletteButton>
      )}
      <span className="pal-sep" aria-hidden="true" />
      <PaletteButton
        label={t('palette.undo')}
        keys={keysOf('entry.undo')}
        disabled={!state.canUndo}
        onPress={() => store.undo()}
      >
        <Glyph>
          <path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10" fill="none" />
        </Glyph>
      </PaletteButton>
      <PaletteButton
        label={t('palette.redo')}
        keys={keysOf('entry.redo')}
        disabled={!state.canRedo}
        onPress={() => store.redo()}
      >
        <Glyph>
          <path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10" fill="none" />
        </Glyph>
      </PaletteButton>
    </div>
  );
}

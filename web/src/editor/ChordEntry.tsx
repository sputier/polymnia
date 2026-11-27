import { useEffect, useId, useRef, useState } from 'react';
import type { Engraver } from '../engraving/engraver';
import { chordAnchor } from '../engraving/hitTest';
import { useI18n } from '../i18n/i18n';
import { formatChord, parseChord, type Score } from '../score';
import { positionLabel } from './entry/describe';
import type { ChordEntryPos, EditorStore } from './entry/editorStore';

/** The focus the browser takes away right after a click that opened the field is given back. */
const GRACE_MS = 250;

interface ChordEntryProps {
  store: EditorStore;
  entry: ChordEntryPos;
  score: Score;
  engraver: Engraver | null;
}

/**
 * The inline text field of chord symbols, drawn over the score at the symbol's position. Space
 * moves to the next beat (Shift+Space: previous), Tab to the next measure, Enter confirms and
 * closes, Escape closes without writing. Text that is not a chord keeps the field open.
 */
export function ChordEntry({ store, entry, score, engraver }: ChordEntryProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  // A click on a symbol opens the field, then the browser moves the focus to the page: that first
  // blur is not the user leaving the field.
  const born = useRef(0);
  const hintId = useId();
  const [text, setText] = useState(() => store.chordTextAt(entry));
  // Known from the layout at once when the field opens, so that it can take the focus.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(() =>
    engraver
      ? (chordAnchor(engraver.layout, entry.staffId, entry.measure, entry.tick) ?? null)
      : null,
  );
  const where = `${entry.staffId}/${entry.measure}/${entry.tick}`;

  // Focused and selected for overtyping. A new position remounts the field (the key in the editor).
  useEffect(() => {
    born.current = performance.now();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Placed from the layout once the engraver has drawn the current score (the score view is
  // before this component in the tree, so its effect has already run).
  useEffect(() => {
    if (!engraver) return;
    const place = () => {
      const next = chordAnchor(engraver.layout, entry.staffId, entry.measure, entry.tick) ?? null;
      setAnchor((old) => (old && next && old.x === next.x && old.y === next.y ? old : next));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entry` is identified by `where`.
  }, [engraver, where, score]);

  useEffect(() => {
    if (anchor) inputRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [anchor]);

  const typed = text.trim();
  const parsed = typed ? parseChord(typed) : null;
  const invalid = typed !== '' && parsed === null;
  const shown = parsed ? formatChord(parsed) : '';
  const label = t('chord.entryLabel')
    .replace('{measure}', String(entry.measure + 1))
    .replace('{beat}', positionLabel(score, entry.measure, entry.tick));

  const finish = (write: boolean, then?: () => void) => {
    if (write && !store.commitChord(text)) return false;
    done.current = true;
    if (then) then();
    else store.closeChordEntry();
    return true;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const back = event.shiftKey ? -1 : 1;
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        finish(true);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        break;
      case ' ':
        event.preventDefault();
        finish(true, () => store.moveChordEntry('beat', back));
        break;
      case 'Tab':
        event.preventDefault();
        finish(true, () => store.moveChordEntry('measure', back));
        break;
      default:
    }
  };

  return (
    <div
      className="chord-entry"
      style={anchor ? { left: anchor.x, top: anchor.y } : { visibility: 'hidden' }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        size={Math.max(5, text.length + 1)}
        maxLength={40}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-label={label}
        aria-describedby={hintId}
        aria-invalid={invalid}
        placeholder={t('chord.entryPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Leaving the field keeps what is valid, drops what is not.
          if (done.current || !store.getState().chordEntry) return;
          if (performance.now() - born.current < GRACE_MS) {
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            });
            return;
          }
          if (typed === '' || parsed) store.commitChord(text);
          store.closeChordEntry();
        }}
      />
      <span id={hintId} className="visually-hidden">
        {t('chord.entryHint')}
        {invalid ? ` ${t('chord.entryInvalid')}` : ''}
      </span>
      {parsed && shown !== typed && (
        <span className="chord-entry-preview" aria-hidden="true">
          {t('chord.entryPreview').replace('{chord}', shown)}
        </span>
      )}
    </div>
  );
}

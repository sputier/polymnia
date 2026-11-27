import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Icon } from '../../components/Icon';
import { Kbd } from '../../components/Kbd';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import type { PlaybackController } from '../../playback';
import {
  clefAt,
  findEvent,
  findStaff,
  keyFifthsAt,
  midiToPitch,
  pitchToMidi,
  soundingMidi,
  type Score,
} from '../../score';
import { describePitch } from '../entry/describe';
import type { EditorState, EditorStore } from '../entry/editorStore';
import { referencePitch } from '../entry/pitchInput';
import { MidiInput } from './midi';
import '../../styles/piano.css';

/** The 88 keys of a piano, A0 to C8. */
const LOWEST = 21;
const HIGHEST = 108;
const WHITE_WIDTH = 28;
const BLACK_WIDTH = 18;
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (midi: number) => BLACK.has(midi % 12);

interface KeyDef {
  readonly midi: number;
  readonly black: boolean;
  readonly left: number;
}

const KEYS: readonly KeyDef[] = (() => {
  const keys: KeyDef[] = [];
  let whites = 0;
  for (let midi = LOWEST; midi <= HIGHEST; midi++) {
    if (isBlack(midi)) {
      keys.push({ midi, black: true, left: whites * WHITE_WIDTH - BLACK_WIDTH / 2 });
    } else {
      keys.push({ midi, black: false, left: whites * WHITE_WIDTH });
      whites++;
    }
  }
  return keys;
})();
const KEYBOARD_WIDTH = KEYS.filter((k) => !k.black).length * WHITE_WIDTH;
const keyOf = (midi: number) => KEYS.find((k) => k.midi === midi);

type T = (key: MessageKey) => string;

/** "Do4" / "C4", "Do dièse 4" / "C sharp 4": the spelling follows the key signature. */
export function keyLabel(midi: number, fifths: number, t: T): string {
  const text = describePitch(midiToPitch(midi, fifths), t);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface KeysProps {
  fifths: number;
  language: string;
  initialFocus: number;
  t: T;
}

/** Rendered once (and again when the key signature or the language changes), never per frame. */
const Keys = memo(function Keys({ fifths, initialFocus, t }: KeysProps) {
  return (
    <div className="piano-keys" style={{ width: KEYBOARD_WIDTH }}>
      {KEYS.map((key) => {
        const label = keyLabel(key.midi, fifths, t);
        return (
          <button
            key={key.midi}
            type="button"
            className={key.black ? 'pk pk-black' : 'pk pk-white'}
            data-midi={key.midi}
            aria-label={label}
            title={label}
            tabIndex={key.midi === initialFocus ? 0 : -1}
            style={{ left: key.left, width: key.black ? BLACK_WIDTH : WHITE_WIDTH }}
          >
            {key.midi % 12 === 0 ? (
              <span className="pk-name" aria-hidden="true">
                {label}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
});

/** Sounding pitches (MIDI numbers) of the notes with these ids. At most 64 ids are looked up. */
export function midisOf(score: Score, ids: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const id of ids.slice(0, 64)) {
    const loc = findEvent(score, id);
    if (loc?.event.kind === 'note')
      for (const p of loc.event.pitches)
        out.add(soundingMidi(p, score.parts[loc.partIndex]?.transposition ?? 0));
  }
  return out;
}

/** Keys that show the state of the editor: the selected notes, else the note just entered. */
function editedIds(state: EditorState): readonly string[] {
  if (state.mode === 'select') return state.selection;
  return state.lastEntered ? [state.lastEntered] : [];
}

/** Toggles a class on the keys of `midis`, touching only the keys that change. */
function classToggler(root: HTMLElement, className: string): (midis: ReadonlySet<number>) => void {
  const elements = new Map<number, Element>();
  root.querySelectorAll('[data-midi]').forEach((el) => {
    elements.set(Number((el as HTMLElement).dataset.midi), el);
  });
  let current = new Set<number>();
  return (midis) => {
    for (const midi of current)
      if (!midis.has(midi)) elements.get(midi)?.classList.remove(className);
    for (const midi of midis) if (!current.has(midi)) elements.get(midi)?.classList.add(className);
    current = new Set(midis);
  };
}

function setEquals(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Scrolls so that the key sits in the middle of the visible keyboard. */
function centerOn(scroller: HTMLElement, midi: number): void {
  const key = keyOf(midi);
  if (!key) return;
  scroller.scrollLeft = Math.max(0, key.left + WHITE_WIDTH / 2 - scroller.clientWidth / 2);
}

interface PianoProps {
  store: EditorStore;
  controller: PlaybackController;
  open: boolean;
  onClose: () => void;
}

/** Position of the piano's focus when it opens: the middle line of the clef of the current staff. */
function clefCenter(state: EditorState): number {
  const loc = findStaff(state.score, state.staffId);
  const staff = loc ? state.score.parts[loc.partIndex]?.staves[loc.staffIndex] : undefined;
  return staff ? pitchToMidi(referencePitch(clefAt(staff, state.cursor.measure))) : 71;
}

export default function Piano({ store, controller, open, onClose }: PianoProps) {
  const { t, language } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fifths = useSyncExternalStore(store.subscribe, () => {
    const s = store.getState();
    return keyFifthsAt(s.score, s.cursor.measure);
  });
  const center = useSyncExternalStore(store.subscribe, () => clefCenter(store.getState()));
  const [initialFocus] = useState(() => center);

  const midi = useMemo(() => new MidiInput((note, chord) => store.enterMidi(note, chord)), [store]);
  const midiState = useSyncExternalStore(midi.subscribe, midi.getState);
  useEffect(() => () => midi.disconnect(), [midi]);

  // Default range: around the clef of the staff in use, again when another staff is used.
  useEffect(() => {
    if (open && scroller.current) centerOn(scroller.current, center);
  }, [open, center]);

  // Keys of the edited notes, and keys under the playhead: class toggles, no React render.
  useEffect(() => {
    const el = root.current;
    if (!open || !el) return;
    const setOn = classToggler(el, 'is-on');
    let shown = new Set<number>();
    const update = () => {
      const s = store.getState();
      const next = midisOf(s.score, editedIds(s));
      if (setEquals(next, shown)) return;
      shown = next;
      setOn(next);
    };
    update();
    const offStore = store.subscribe(update);

    const setHit = classToggler(el, 'is-playing');
    let last = '';
    const offFrame = controller.onFrame((frame) => {
      const key = frame.noteIds.join(',');
      if (key === last) return;
      last = key;
      setHit(midisOf(store.getState().score, frame.noteIds));
    });
    const offState = controller.subscribe(() => {
      if (controller.getState().status === 'stopped' && last) {
        last = '';
        setHit(new Set());
      }
    });
    return () => {
      offStore();
      offFrame();
      offState();
      setOn(new Set());
      setHit(new Set());
    };
  }, [open, store, controller]);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-midi]');
    if (!button) return;
    store.enterMidi(Number(button.dataset.midi), event.shiftKey);
  };

  // Roving tab stop: one key is reachable with Tab, the arrows move between keys.
  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-midi]');
    if (!target) return;
    root.current?.querySelector('[data-midi][tabindex="0"]')?.setAttribute('tabindex', '-1');
    target.setAttribute('tabindex', '0');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-midi]');
    if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = Number(target.dataset.midi);
    const next =
      event.key === 'ArrowRight'
        ? current + 1
        : event.key === 'ArrowLeft'
          ? current - 1
          : event.key === 'Home'
            ? LOWEST
            : event.key === 'End'
              ? HIGHEST
              : null;
    if (next === null) return;
    // The editor's own arrows (move the cursor) must not also fire: preventDefault skips them.
    event.preventDefault();
    const to = Math.min(HIGHEST, Math.max(LOWEST, next));
    root.current?.querySelector<HTMLElement>(`[data-midi="${to}"]`)?.focus();
  };

  return (
    <section className="pianobar" ref={root} hidden={!open} aria-label={t('piano.label')}>
      <div className="piano-head">
        <strong>{t('piano.title')}</strong>
        <span className="piano-hint">{t('piano.hint')}</span>
        <MidiControls midi={midi} state={midiState} />
        <button
          type="button"
          className="btn ghost icon"
          aria-label={t('piano.close')}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        <Kbd keys="P" />
      </div>
      <div className="piano-scroll" ref={scroller}>
        <div
          role="group"
          aria-label={t('piano.keys')}
          onClick={onClick}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        >
          <Keys fifths={fifths} language={language} initialFocus={initialFocus} t={t} />
        </div>
      </div>
    </section>
  );
}

function MidiControls({
  midi,
  state,
}: {
  midi: MidiInput;
  state: ReturnType<MidiInput['getState']>;
}) {
  const { t } = useI18n();
  const { status, devices, selected } = state;
  const message: MessageKey | null =
    status === 'unsupported'
      ? 'midi.unsupported'
      : status === 'denied'
        ? 'midi.denied'
        : status === 'error'
          ? 'midi.error'
          : status === 'ready' && devices.length === 0
            ? 'midi.none'
            : null;
  return (
    <div className="midi">
      {(status === 'idle' || status === 'denied' || status === 'error') && (
        <button type="button" className="btn" onClick={() => void midi.connect()}>
          {t('midi.connect')}
        </button>
      )}
      {status === 'requesting' && (
        <button type="button" className="btn" disabled>
          {t('midi.connecting')}
        </button>
      )}
      {status === 'ready' && devices.length > 1 && (
        <label className="midi-device">
          <span>{t('midi.device')}</span>
          <select value={selected} onChange={(e) => midi.select(e.target.value)}>
            <option value="all">{t('midi.all')}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {status === 'ready' && devices.length === 1 && (
        <span className="midi-ok">{t('midi.connected').replace('{name}', devices[0]!.name)}</span>
      )}
      {status === 'ready' && (
        <button type="button" className="btn ghost" onClick={() => midi.disconnect()}>
          {t('midi.disconnect')}
        </button>
      )}
      <p className="midi-msg" role="status">
        {message ? t(message) : ''}
      </p>
    </div>
  );
}

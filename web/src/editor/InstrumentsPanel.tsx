import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import {
  getInstrument,
  matchTuningPreset,
  partTuning,
  staffLayoutOf,
  tuningPresets,
  type Part,
  type Pitch,
  type StaffLayout,
} from '../score';
import type { EditorState, EditorStore } from './entry/editorStore';
import {
  FAMILY_LABEL,
  instrumentName,
  parsePitchName,
  pitchName,
  searchInstruments,
} from './instrumentUi';

type PickerMode = { kind: 'add' } | { kind: 'change'; partId: string } | null;

interface Props {
  store: EditorStore;
  state: EditorState;
  /** Incremented by the "Add an instrument" command: opens the picker. */
  addRequest: number;
}

/** Left panel: the parts of the score, add / reorder / remove, and the settings of the selected part. */
function InstrumentsPanelView({ store, state, addRequest }: Props) {
  const { t, language } = useI18n();
  const parts = state.score.parts;
  const active = parts.find((p) => p.staves.some((s) => s.id === state.staffId)) ?? parts[0]!;
  const [picker, setPicker] = useState<PickerMode>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // The "Add an instrument" command bumps `addRequest`: open the picker (state adjusted while rendering).
  const [seenRequest, setSeenRequest] = useState(addRequest);
  if (seenRequest !== addRequest) {
    setSeenRequest(addRequest);
    setPicker({ kind: 'add' });
  }

  const name = (part: Part) => part.name || instrumentName(part.instrument, language);

  const onRowKey = (event: KeyboardEvent, part: Part, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < parts.length) store.movePart(part.id, to);
  };

  return (
    <div className="instruments">
      <h3 className="side-h">{t('instruments.list')}</h3>
      <ul className="part-list">
        {parts.map((part, index) => {
          const current = part.id === active.id;
          return (
            <li
              key={part.id}
              className="part-row"
              data-current={current ? '' : undefined}
              data-dragging={dragId === part.id ? '' : undefined}
              draggable
              onDragStart={(e) => {
                setDragId(part.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', part.id);
              }}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== part.id) store.movePart(dragId, index);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
            >
              <button
                type="button"
                className="part-main"
                aria-label={t('instruments.select').replace('{name}', name(part))}
                aria-current={current ? 'true' : undefined}
                aria-describedby="part-reorder-hint"
                onClick={() => store.focusPart(index)}
                onKeyDown={(e) => onRowKey(e, part, index)}
              >
                <span className="part-name">{name(part)}</span>
                {name(part) !== instrumentName(part.instrument, language) && (
                  <span className="part-inst">{instrumentName(part.instrument, language)}</span>
                )}
              </button>
              <button
                type="button"
                className="btn ghost icon"
                aria-label={t('instruments.moveUp').replace('{name}', name(part))}
                title={t('instruments.moveUp').replace('{name}', name(part))}
                disabled={index === 0}
                onClick={() => store.movePart(part.id, index - 1)}
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                className="btn ghost icon"
                aria-label={t('instruments.moveDown').replace('{name}', name(part))}
                title={t('instruments.moveDown').replace('{name}', name(part))}
                disabled={index === parts.length - 1}
                onClick={() => store.movePart(part.id, index + 1)}
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button
                type="button"
                className="btn ghost icon"
                aria-label={t('instruments.remove').replace('{name}', name(part))}
                title={t('instruments.remove').replace('{name}', name(part))}
                disabled={parts.length === 1}
                onClick={() => setConfirming(part.id)}
              >
                <Icon name="close" />
              </button>
              {confirming === part.id && (
                <div className="part-confirm" role="alertdialog" aria-label={name(part)}>
                  <span>{t('instruments.removeConfirm').replace('{name}', name(part))}</span>
                  <button
                    type="button"
                    className="btn danger"
                    autoFocus
                    onClick={() => {
                      setConfirming(null);
                      store.removePart(part.id);
                    }}
                  >
                    {t('instruments.removeYes')}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirming(null)}>
                    {t('instruments.cancel')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p id="part-reorder-hint" className="side-hint">
        {t('instruments.reorderHint')}
      </p>
      <button
        type="button"
        className="btn"
        aria-expanded={picker?.kind === 'add'}
        onClick={() => setPicker(picker?.kind === 'add' ? null : { kind: 'add' })}
      >
        {t('instruments.add')}
      </button>
      {picker && (
        <InstrumentPicker
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const inst = getInstrument(id);
            if (!inst) return;
            if (picker.kind === 'add') {
              store.addPart(id, { name: inst.names[language] });
            } else {
              const part = parts.find((p) => p.id === picker.partId);
              const old = part ? getInstrument(part.instrument) : undefined;
              const auto =
                !part || !part.name || part.name === old?.names.en || part.name === old?.names.fr;
              store.changeInstrument(picker.partId, id, auto ? inst.names[language] : undefined);
            }
            setPicker(null);
          }}
        />
      )}
      <PartSettings
        key={active.id}
        part={active}
        store={store}
        onChangeInstrument={() => setPicker({ kind: 'change', partId: active.id })}
      />
    </div>
  );
}

/** What the panel shows: a note edit changes none of it, so typing does not re-render the panel. */
function signature(state: EditorState): string {
  const parts = state.score.parts.map((p) =>
    [
      p.id,
      p.name,
      p.instrument,
      p.capo ?? 0,
      p.chordDiagrams ?? '',
      p.chordCapoShapes ? 1 : 0,
      (p.tuning ?? []).map(pitchName).join(','),
      p.staves.map((s) => `${s.id}:${s.type}`).join(','),
    ].join('/'),
  );
  return `${state.staffId}|${parts.join(';')}`;
}

export const InstrumentsPanel = memo(
  InstrumentsPanelView,
  (a, b) =>
    a.store === b.store &&
    a.addRequest === b.addRequest &&
    signature(a.state) === signature(b.state),
);

function InstrumentPicker({
  onPick,
  onClose,
}: {
  onPick: (instrumentId: string) => void;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const groups = searchInstruments(query);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div
      ref={ref}
      className="picker"
      role="group"
      aria-label={t('instruments.addTitle')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="field">
        <span>{t('instruments.search')}</span>
        <input
          type="search"
          autoFocus
          value={query}
          placeholder={t('instruments.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {groups.length === 0 && <p className="side-hint">{t('instruments.noMatch')}</p>}
      {groups.map((g) => (
        <section key={g.family} aria-label={t(FAMILY_LABEL[g.family])}>
          <h4 className="picker-h">{t(FAMILY_LABEL[g.family])}</h4>
          <ul className="picker-list">
            {g.instruments.map((inst) => (
              <li key={inst.id}>
                <button type="button" className="picker-item" onClick={() => onPick(inst.id)}>
                  {inst.names[language]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="btn ghost" onClick={onClose}>
        {t('instruments.close')}
      </button>
    </div>
  );
}

const LAYOUTS: readonly {
  id: StaffLayout;
  label: 'instruments.layout.standard' | 'instruments.layout.both' | 'instruments.layout.tab';
}[] = [
  { id: 'standard+tab', label: 'instruments.layout.both' },
  { id: 'tab', label: 'instruments.layout.tab' },
  { id: 'standard', label: 'instruments.layout.standard' },
];

function PartSettings({
  part,
  store,
  onChangeInstrument,
}: {
  part: Part;
  store: EditorStore;
  onChangeInstrument: () => void;
}) {
  const { t, language } = useI18n();
  const inst = getInstrument(part.instrument);
  const fretted = !!inst?.strings;
  const presets = tuningPresets(part.instrument);
  const tuning = partTuning(part);
  const matched = tuning ? matchTuningPreset(part.instrument, tuning) : undefined;
  const [custom, setCustom] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(false);
  const layout = staffLayoutOf(part);
  const title = part.name || instrumentName(part.instrument, language);

  const openCustom = () => {
    setValues((tuning ?? []).map(pitchName));
    setInvalid(false);
    setCustom(true);
  };
  const applyCustom = () => {
    const pitches = values.map((v) => parsePitchName(v.replace('♯', '#').replace('♭', 'b')));
    if (pitches.some((p) => !p)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (store.setTuning(part.id, pitches as Pitch[])) setCustom(false);
  };
  const capoMax = Math.min(12, (inst?.frets ?? 13) - 1);

  return (
    <section
      className="part-settings"
      aria-label={t('instruments.settings').replace('{name}', title)}
    >
      <h3 className="side-h">{t('instruments.settings').replace('{name}', title)}</h3>
      <label className="field">
        <span>{t('instruments.name')}</span>
        <input
          key={part.name}
          type="text"
          defaultValue={part.name}
          maxLength={100}
          onBlur={(e) => {
            if (e.target.value.trim() !== part.name) store.renamePart(part.id, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
      <div className="field">
        <span>{t('instruments.instrument')}</span>
        <div className="row wrap">
          <strong className="part-inst-name">{instrumentName(part.instrument, language)}</strong>
          <button type="button" className="btn" onClick={onChangeInstrument}>
            {t('instruments.change')}
          </button>
        </div>
        <p className="side-hint">{t('instruments.changeHint')}</p>
      </div>
      {fretted && inst?.staves === 1 && (
        <fieldset className="field">
          <legend>{t('instruments.layout')}</legend>
          {LAYOUTS.map((l) => (
            <label key={l.id} className="radio">
              <input
                type="radio"
                name={`layout-${part.id}`}
                checked={layout === l.id}
                onChange={() => store.setStaffLayout(part.id, l.id)}
              />
              <span>{t(l.label)}</span>
            </label>
          ))}
          {layout === 'standard+tab' && <p className="side-hint">{t('instruments.layoutHint')}</p>}
          {layout !== 'standard' && (
            <label className="radio">
              <input
                type="checkbox"
                checked={part.staves.some((s) => s.type === 'tab' && s.showRests)}
                onChange={(e) => {
                  const tab = part.staves.find((s) => s.type === 'tab');
                  if (tab) store.setTabRests(tab.id, e.target.checked);
                }}
              />
              <span>{t('instruments.tabRests')}</span>
            </label>
          )}
        </fieldset>
      )}
      {fretted && (
        <>
          <label className="field">
            <span>{t('instruments.tuning')}</span>
            <select
              value={custom || !matched ? 'custom' : matched.id}
              onChange={(e) => {
                if (e.target.value === 'custom') return openCustom();
                const preset = presets.find((x) => x.id === e.target.value);
                setCustom(false);
                if (preset) store.setTuning(part.id, preset.strings);
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.names[language]}
                </option>
              ))}
              <option value="custom">{t('instruments.tuningCustom')}</option>
            </select>
          </label>
          {(custom || (!matched && tuning)) && (
            <TuningEditor
              part={part}
              values={values.length ? values : (tuning ?? []).map(pitchName)}
              invalid={invalid}
              onChange={(v) => {
                setValues(v);
                setCustom(true);
              }}
              onApply={applyCustom}
            />
          )}
          <label className="field">
            <span>{t('instruments.capo')}</span>
            <select
              value={part.capo ?? 0}
              onChange={(e) => store.setCapo(part.id, Number(e.target.value))}
            >
              <option value={0}>{t('instruments.capoNone')}</option>
              {Array.from({ length: capoMax }, (_, i) => i + 1).map((fret) => (
                <option key={fret} value={fret}>
                  {t('instruments.capoFret').replace('{fret}', String(fret))}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('instruments.chordDiagrams')}</span>
            <select
              value={part.chordDiagrams ?? 'none'}
              onChange={(e) =>
                store.setChordDiagramMode(
                  part.id,
                  e.target.value === 'none' ? null : (e.target.value as 'first' | 'all'),
                )
              }
            >
              <option value="none">{t('instruments.chordDiagramsNone')}</option>
              <option value="first">{t('instruments.chordDiagramsFirst')}</option>
              <option value="all">{t('instruments.chordDiagramsAll')}</option>
            </select>
          </label>
          {(part.capo ?? 0) > 0 && (
            <label className="radio">
              <input
                type="checkbox"
                checked={!!part.chordCapoShapes}
                onChange={(e) => store.setChordCapoShapes(part.id, e.target.checked)}
              />
              <span>{t('instruments.chordCapoShapes')}</span>
            </label>
          )}
        </>
      )}
    </section>
  );
}

function TuningEditor({
  part,
  values,
  invalid,
  onChange,
  onApply,
}: {
  part: Part;
  values: string[];
  invalid: boolean;
  onChange: (values: string[]) => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="tuning-editor">
      {values.map((v, i) => (
        <label key={`${part.id}-${i}`} className="field small">
          <span>{t('instruments.tuningString').replace('{n}', String(i + 1))}</span>
          <input
            type="text"
            value={v}
            size={4}
            aria-invalid={invalid && !parsePitchName(v.replace('♯', '#').replace('♭', 'b'))}
            onChange={(e) => onChange(values.map((x, k) => (k === i ? e.target.value : x)))}
          />
        </label>
      ))}
      {invalid && (
        <p className="side-hint warn" role="alert">
          {t('instruments.tuningInvalid')}
        </p>
      )}
      <button type="button" className="btn" onClick={onApply}>
        {t('instruments.tuningApply')}
      </button>
    </div>
  );
}

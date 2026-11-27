import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Kbd } from '../../components/Kbd';
import { useI18n } from '../../i18n/i18n';
import {
  buildCommands,
  GROUP_LABEL,
  GROUP_ORDER,
  searchEntries,
  type Command,
} from '../../shortcuts/commands';
import { loadRecent, pushRecent } from '../../shortcuts/recent';
import { matches, type Shortcut } from '../../shortcuts/registry';
import { rank } from '../../shortcuts/search';
import { Dialog } from './Dialog';

interface Section {
  id: string;
  label?: string;
  items: Command[];
}

interface CommandPaletteProps {
  /** The registry content (`shortcuts.list()`): the palette has no list of its own. */
  list: readonly Shortcut[];
  onClose: () => void;
}

export function CommandPalette({ list, onClose }: CommandPaletteProps) {
  const { t } = useI18n();
  const uid = useId();
  const titleId = `${uid}-title`;
  const listId = `${uid}-list`;
  const commands = useMemo(() => buildCommands(list), [list]);
  const entries = useMemo(() => searchEntries(commands), [commands]);
  const byId = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);
  // Availability is read once: nothing changes behind the dialog while it is open.
  const enabled = useMemo(() => new Map(commands.map((c) => [c.id, c.enabled()])), [commands]);
  const [recent, setRecent] = useState(loadRecent);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<string | null>(null);

  const sections = useMemo((): Section[] => {
    const ids = rank(entries, query, recent);
    const found = ids.map((id) => byId.get(id)).filter((c): c is Command => c !== undefined);
    if (query.trim()) return found.length ? [{ id: 'results', items: found }] : [];
    const recentSet = new Set(recent);
    const recents = found.filter((c) => recentSet.has(c.id));
    const out: Section[] = recents.length
      ? [{ id: 'recent', label: t('cmd.recent'), items: recents }]
      : [];
    for (const group of GROUP_ORDER) {
      const items = found.filter((c) => c.group === group && !recentSet.has(c.id));
      if (items.length) out.push({ id: group, label: t(GROUP_LABEL[group]), items });
    }
    return out;
  }, [entries, byId, query, recent, t]);

  const rows = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const runnable = rows.filter((c) => enabled.get(c.id));
  // The highlighted command: the user's pick while it is still listed, else the first one.
  const active = rows.find((c) => c.id === pick && enabled.get(c.id)) ?? runnable[0];
  const optionId = (c: Command) => `${uid}-o-${c.id.replaceAll('.', '-')}`;

  const run = (command: Command | undefined) => {
    if (!command || !enabled.get(command.id)) return;
    setRecent(pushRecent(command.id));
    onClose();
    // After the dialog is gone and focus is back where it was.
    setTimeout(command.run, 0);
  };

  const step = (delta: 1 | -1) => {
    if (runnable.length === 0) return;
    const at = active ? runnable.indexOf(active) : -1;
    setPick(runnable[(at + delta + runnable.length) % runnable.length]!.id);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') step(1);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'Home' && runnable.length) setPick(runnable[0]!.id);
    else if (event.key === 'End' && runnable.length) setPick(runnable[runnable.length - 1]!.id);
    else if (event.key === 'Enter') run(active);
    else return;
    event.preventDefault();
  };

  const status = rows.length
    ? t('cmd.results').replace('{n}', String(rows.length))
    : t('cmd.empty');

  return (
    <Dialog
      className="cmd"
      labelledBy={titleId}
      onClose={onClose}
      onKey={(event) => {
        if (!matches(event.nativeEvent, 'Mod+K')) return false;
        onClose();
        return true;
      }}
    >
      <h2 id={titleId} className="visually-hidden">
        {t('cmd.title')}
      </h2>
      <input
        data-autofocus
        className="cmd-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={t('cmd.search')}
        aria-activedescendant={active ? optionId(active) : undefined}
        placeholder={t('cmd.placeholder')}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPick(null);
        }}
        onKeyDown={onInputKeyDown}
      />
      <div id={listId} role="listbox" aria-label={t('cmd.title')} className="cmd-list">
        {sections.map((section) => (
          <div
            key={section.id}
            role="group"
            {...(section.label
              ? { 'aria-labelledby': `${uid}-g-${section.id}` }
              : { 'aria-label': t('cmd.title') })}
          >
            {section.label && (
              <div id={`${uid}-g-${section.id}`} className="cmd-group" role="presentation">
                {section.label}
              </div>
            )}
            {section.items.map((command) => {
              const on = enabled.get(command.id) === true;
              return (
                <div
                  key={command.id}
                  id={optionId(command)}
                  role="option"
                  className="cmd-row"
                  aria-selected={command === active}
                  aria-disabled={on ? undefined : true}
                  onMouseMove={() => on && command !== active && setPick(command.id)}
                  onClick={() => run(command)}
                >
                  <span className="cmd-label">
                    {t(command.labelKey)}
                    {!on && <span className="visually-hidden"> ({t('cmd.unavailable')})</span>}
                  </span>
                  {query.trim() && <span className="cmd-tag">{t(GROUP_LABEL[command.group])}</span>}
                  <span className="cmd-keys">
                    {command.keys.slice(0, 2).map((keys) => (
                      <Kbd key={keys} keys={keys} />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {rows.length === 0 && <p className="cmd-empty">{t('cmd.empty')}</p>}
      </div>
      <p className="visually-hidden" role="status">
        {status}
      </p>
      <div className="cmd-foot" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t('cmd.hintNavigate')}
        </span>
        <span>
          <kbd>⏎</kbd> {t('cmd.hintRun')}
        </span>
        <span>
          <kbd>Esc</kbd> {t('cmd.hintClose')}
        </span>
      </div>
    </Dialog>
  );
}

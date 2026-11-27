import { Kbd } from '../components/Kbd';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

// Reminder only: the note-entry shortcuts themselves are registered by the note entry issue.
const ITEMS: { keys: string[]; range?: boolean; labelKey: MessageKey }[] = [
  { keys: ['N'], labelKey: 'strip.input' },
  { keys: ['1', '5'], range: true, labelKey: 'strip.duration' },
  { keys: ['A', 'G'], range: true, labelKey: 'strip.note' },
  { keys: ['ArrowLeft', 'ArrowRight'], labelKey: 'strip.move' },
  { keys: ['ArrowUp', 'ArrowDown'], labelKey: 'strip.pitch' },
  { keys: ['0'], labelKey: 'strip.rest' },
];

export function ShortcutStrip() {
  const { t } = useI18n();
  return (
    <ul className="hintbar" aria-label={t('strip.label')}>
      {ITEMS.map((item) => (
        <li key={item.labelKey}>
          {item.keys.map((k, i) => (
            <span key={k}>
              {i > 0 && item.range ? '–' : null}
              <Kbd keys={k} />
            </span>
          ))}
          <span>{t(item.labelKey)}</span>
        </li>
      ))}
    </ul>
  );
}

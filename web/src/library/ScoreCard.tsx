import { useEffect, useId, useRef, useState } from 'react';
import type { ScoreListItem } from '../api/scores';
import { format, useI18n } from '../i18n/i18n';
import { scoreHref } from '../route/useRoute';
import { fullDate, instrumentName, relativeTime } from './text';

export type CardAction = 'rename' | 'duplicate' | 'share' | 'delete';

interface ScoreCardProps {
  score: ScoreListItem;
  /** The one card in the tab order (roving tabindex). */
  tabbable: boolean;
  onFocusCard: () => void;
  onAction: (action: CardAction, score: ScoreListItem) => void;
}

/** A static staff: a recognizable preview that costs nothing (no engraving in the list). */
function StaffPreview() {
  return (
    <svg viewBox="0 0 200 44" className="thumb-staff" aria-hidden="true" focusable="false">
      {[8, 16, 24, 32, 40].map((y) => (
        <line key={y} x1="6" x2="194" y1={y} y2={y} />
      ))}
      <line x1="6" x2="6" y1="8" y2="40" />
      <line x1="194" x2="194" y1="8" y2="40" />
    </svg>
  );
}

export function ScoreCard({ score, tabbable, onFocusCard, onAction }: ScoreCardProps) {
  const { t, language } = useI18n();
  const measures = format(
    t(score.measureCount === 1 ? 'library.measuresOne' : 'library.measuresMany'),
    {
      n: score.measureCount,
    },
  );
  const when = relativeTime(score.updatedAt, language);

  return (
    <li className="card" data-score-id={score.id}>
      <a
        className="card-open"
        href={scoreHref(score.id)}
        tabIndex={tabbable ? 0 : -1}
        onFocus={onFocusCard}
        aria-label={`${t('library.open')}: ${score.title}`}
      >
        <span className="thumb">
          <StaffPreview />
        </span>
        <h3>{score.title}</h3>
        <span className="chips">
          {score.instruments.map((id, i) => (
            <span className="chip" key={`${id}-${i}`}>
              {instrumentName(id, language)}
            </span>
          ))}
        </span>
        <span className="meta">
          {measures} ·{' '}
          <time dateTime={score.updatedAt} title={fullDate(score.updatedAt, language)}>
            {format(t('library.modified'), { when })}
          </time>
        </span>
      </a>
      <CardMenu score={score} onAction={onAction} />
    </li>
  );
}

function CardMenu({
  score,
  onAction,
}: {
  score: ScoreListItem;
  onAction: ScoreCardProps['onAction'];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  // Focus the first item on open; close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && event.target !== button.current) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items[items.length - 1]?.focus();
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') close(false);
    else return;
    if (event.key !== 'Tab') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const choose = (action: CardAction) => {
    close(action === 'share' ? false : true);
    onAction(action, score);
  };

  return (
    <div className="card-more">
      <button
        ref={button}
        type="button"
        className="btn ghost icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={format(t('library.menu'), { title: score.title })}
        onClick={() => setOpen(!open)}
      >
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          className="menu"
          role="menu"
          aria-label={format(t('library.menu'), { title: score.title })}
          onKeyDown={onKeyDown}
        >
          <a role="menuitem" href={scoreHref(score.id)} onClick={() => setOpen(false)}>
            {t('library.open')}
          </a>
          <button type="button" role="menuitem" onClick={() => choose('rename')}>
            {t('library.rename')}
          </button>
          <button type="button" role="menuitem" onClick={() => choose('duplicate')}>
            {t('library.duplicate')}
          </button>
          <button type="button" role="menuitem" onClick={() => choose('share')}>
            {t('library.share')}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => choose('delete')}>
            {t('library.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

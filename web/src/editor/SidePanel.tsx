import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

interface SidePanelProps {
  id: string;
  side: 'left' | 'right';
  title: string;
  open: boolean;
  /** Narrow screens: the panel floats over the score and shows a close button. */
  overlay: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function SidePanel({ id, side, title, open, overlay, onClose, children }: SidePanelProps) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && overlay) closeRef.current?.focus();
  }, [open, overlay]);

  return (
    <aside id={id} className={`panel ${side}`} aria-label={title} hidden={!open}>
      <div className="panel-head">
        <h2>{title}</h2>
        {overlay && (
          <button
            ref={closeRef}
            type="button"
            className="btn ghost icon"
            aria-label={t('panel.close')}
            title={t('panel.close')}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {children}
    </aside>
  );
}

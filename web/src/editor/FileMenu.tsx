import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { setPaper, usePaper } from './paperPref';

export type ExportFormat = 'musicxml' | 'mxl' | 'midi' | 'pdf' | 'png';

/** Import button: opens the file picker (the same path as a drop on the editor). */
export function ImportButton({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        aria-label={t('io.importLabel')}
        title={t('io.importLabel')}
        onClick={() => input.current?.click()}
      >
        <Icon name="upload" />
        <span className="lbl">{t('io.import')}</span>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".musicxml,.xml,.mxl"
        aria-label={t('io.fileInput')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

/** Export button with a menu (WAI-ARIA menu button): arrows, Home/End, Escape, click outside. */
export function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const paper = usePaper();

  const items = () =>
    Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const close = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(list.length - 1);
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        return closeAndFocus();
      case 'Tab':
        return setOpen(false);
    }
  };

  const choose = (format: ExportFormat) => {
    closeAndFocus();
    onExport(format);
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('editor.export')}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="download" />
        <span className="lbl">{t('editor.export')}</span>
      </button>
      {open && (
        <div
          id={menuId}
          className="menu"
          role="menu"
          aria-label={t('editor.export')}
          onKeyDown={onMenuKey}
        >
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => choose('musicxml')}
          >
            {t('io.exportMusicXml')}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose('mxl')}>
            {t('io.exportMxl')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => choose('midi')}
          >
            {t('io.exportMidi')}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose('pdf')}>
            {t('io.exportPdf')}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose('png')}>
            {t('io.exportPng')}
          </button>
          <div role="separator" className="menu-sep" />
          {(['a4', 'letter'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={paper === p}
              className="menu-item"
              onClick={() => {
                setPaper(p);
                closeAndFocus();
              }}
            >
              {t(p === 'a4' ? 'io.paperA4' : 'io.paperLetter')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

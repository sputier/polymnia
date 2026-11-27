import { useCallback, useState, type DragEvent, type ReactNode } from 'react';
import { Modal } from '../components/Modal';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { ImportErrorCode, ImportReport, ImportResult } from '../musicxml';
import type { EditorStore } from './entry/editorStore';
import type { ExportFormat } from './FileMenu';

/** Same cap as the importer (`MUSICXML_LIMITS.maxInputBytes`), checked before loading the code. */
const MAX_FILE_BYTES = 20_000_000;

type Dialog =
  | { kind: 'confirm'; file: string; result: ImportResult }
  | { kind: 'report'; report: ImportReport }
  | { kind: 'error'; code: ImportErrorCode | 'read' };

function fileSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'score';
}

function download(bytes: Uint8Array<ArrayBuffer>, mime: string, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Runs `fn` and records a User Timing measure (read by the browser performance test). */
function timed<T>(name: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    try {
      performance.measure(name, { start, end: performance.now() });
    } catch {
      // User Timing unavailable: nothing to record.
    }
  }
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export interface MusicXmlIO {
  exportAs: (format: ExportFormat) => void;
  importFile: (file: File) => void;
  /** Props for the element that accepts dropped files. */
  dropProps: {
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
  dragging: boolean;
  /** Dialogs and the live region: render once inside the editor. */
  overlay: ReactNode;
}

/**
 * MusicXML wiring of the editor: export downloads, import (picker or drop) with confirmation,
 * error and report dialogs. The MusicXML code is loaded on first use.
 */
export function useMusicXmlIO(
  store: EditorStore,
  title: string,
  setTitle: (title: string) => void,
): MusicXmlIO {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);

  const exportAs = useCallback(
    (format: ExportFormat) => {
      void (async () => {
        try {
          const { exportMusicXml } = await import('../musicxml');
          const score = store.getState().score;
          const file = timed('musicxml:export', () =>
            exportMusicXml({ ...score, meta: { ...score.meta, title } }, format),
          );
          const name = `${fileSlug(title)}.${file.extension}`;
          download(file.bytes, file.mime, name);
          setMessage(t('io.exported').replace('{name}', name));
        } catch {
          setDialog({ kind: 'error', code: 'invalid-score' });
        }
      })();
    },
    [store, title, t],
  );

  const importFile = useCallback(
    (file: File) => {
      void (async () => {
        if (file.size > MAX_FILE_BYTES) return setDialog({ kind: 'error', code: 'too-large' });
        setMessage(t('io.working'));
        try {
          const [{ importMusicXml, MusicXmlError }, buffer] = await Promise.all([
            import('../musicxml'),
            file.arrayBuffer(),
          ]);
          try {
            const result = timed('musicxml:import', () => importMusicXml(new Uint8Array(buffer)));
            setMessage('');
            setDialog({ kind: 'confirm', file: file.name.slice(0, 80), result });
          } catch (error) {
            setMessage('');
            setDialog({
              kind: 'error',
              code: error instanceof MusicXmlError ? error.code : 'invalid-score',
            });
          }
        } catch {
          setMessage('');
          setDialog({ kind: 'error', code: 'read' });
        }
      })();
    },
    [t],
  );

  const confirm = (file: string, result: ImportResult) => {
    store.loadScore(result.score);
    setTitle(result.score.meta.title);
    const name = result.score.meta.title || file;
    setMessage(t('io.imported').replace('{name}', name));
    const noisy =
      Object.keys(result.report.dropped).length + Object.keys(result.report.adjusted).length > 0;
    setDialog(noisy ? { kind: 'report', report: result.report } : null);
  };

  const dropProps = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (
        event.currentTarget === event.target ||
        !event.currentTarget.contains(event.relatedTarget as Node)
      ) {
        setDragging(false);
      }
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) importFile(file);
    },
  };

  const close = () => setDialog(null);
  const overlay = (
    <>
      <div className="visually-hidden" role="status" aria-live="polite">
        {message}
      </div>
      {dragging && (
        <div className="drop-hint" aria-hidden="true">
          {t('io.dropHint')}
        </div>
      )}
      {dialog?.kind === 'confirm' && (
        <Modal
          title={t('io.confirmTitle')}
          onClose={close}
          role="alertdialog"
          actions={
            <>
              <button type="button" className="btn" data-autofocus onClick={close}>
                {t('io.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => confirm(dialog.file, dialog.result)}
              >
                {t('io.confirmReplace')}
              </button>
            </>
          }
        >
          <p>
            {t('io.confirmBody')
              .replace('{file}', dialog.file)
              .replace('{parts}', String(dialog.result.score.parts.length))
              .replace('{measures}', String(dialog.result.score.measures.length))}
          </p>
        </Modal>
      )}
      {dialog?.kind === 'report' && (
        <Modal
          title={t('io.reportTitle')}
          onClose={close}
          actions={
            <button type="button" className="btn primary" data-autofocus onClick={close}>
              {t('io.close')}
            </button>
          }
        >
          <p>{t('io.reportIntro')}</p>
          <ReportList title={t('io.reportDropped')} counts={dialog.report.dropped} />
          <ReportList title={t('io.reportAdjusted')} counts={dialog.report.adjusted} />
        </Modal>
      )}
      {dialog?.kind === 'error' && (
        <Modal
          title={t('io.errorTitle')}
          onClose={close}
          role="alertdialog"
          actions={
            <button type="button" className="btn primary" data-autofocus onClick={close}>
              {t('io.close')}
            </button>
          }
        >
          <p>{t(`io.error.${dialog.code}` as MessageKey)}</p>
        </Modal>
      )}
    </>
  );

  return { exportAs, importFile, dropProps, dragging, overlay };
}

function ReportList({
  title,
  counts,
}: {
  title: string;
  counts: Readonly<Record<string, number>>;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  return (
    <section className="report-group">
      <h3>{title}</h3>
      <ul>
        {entries.map(([name, count]) => (
          <li key={name}>
            <code>{name}</code> × {count}
          </li>
        ))}
      </ul>
    </section>
  );
}

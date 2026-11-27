import { useCallback, useState, type DragEvent, type ReactNode } from 'react';
import { Modal } from '../components/Modal';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { ImportErrorCode, ImportReport, ImportResult } from '../musicxml';
import type { EditorStore } from './entry/editorStore';
import type { ExportFormat } from './FileMenu';
import { getPaper } from './paperPref';

/** Same cap as the importer (`MUSICXML_LIMITS.maxInputBytes`), checked before loading the code. */
const MAX_FILE_BYTES = 20_000_000;

type Dialog =
  | { kind: 'confirm'; file: string; result: ImportResult }
  | { kind: 'report'; report: ImportReport }
  | { kind: 'exportReport'; dropped: Readonly<Record<string, number>> }
  | { kind: 'error'; code: ImportErrorCode | 'read' | 'export' };

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
  pickFile: () => void;
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
  const [progress, setProgress] = useState<{ format: string; done: number; total: number } | null>(
    null,
  );

  const finishExport = useCallback(
    (
      file: { bytes: Uint8Array<ArrayBuffer>; mime: string; extension: string },
      dropped: Readonly<Record<string, number>>,
    ) => {
      const name = `${fileSlug(title)}.${file.extension}`;
      download(file.bytes, file.mime, name);
      setMessage(t('io.exported').replace('{name}', name));
      if (Object.keys(dropped).length > 0) setDialog({ kind: 'exportReport', dropped });
    },
    [title, t],
  );

  const exportAs = useCallback(
    (format: ExportFormat) => {
      void (async () => {
        const score = store.getState().score;
        const named = { ...score, meta: { ...score.meta, title } };
        if (format === 'midi' || format === 'pdf' || format === 'png') {
          const label = t(
            format === 'midi'
              ? 'io.exportMidi'
              : format === 'pdf'
                ? 'io.exportPdf'
                : 'io.exportPng',
          );
          setMessage(t('io.exporting').replace('{format}', label));
          setProgress({ format: label, done: 0, total: 0 });
          try {
            // The export code (encoder, page layout, PDF writer, canvas) loads on first use.
            const exporter = await import('../export');
            const file =
              format === 'midi'
                ? await exporter.exportMidi(named, title)
                : await exporter[format === 'pdf' ? 'exportPdf' : 'exportPng'](
                    named,
                    title,
                    getPaper(),
                    (p) => setProgress({ format: label, ...p }),
                  );
            finishExport(file, file.dropped);
          } catch {
            setMessage('');
            setDialog({ kind: 'error', code: 'export' });
          } finally {
            setProgress(null);
          }
          return;
        }
        try {
          const { exportMusicXml } = await import('../musicxml');
          const file = timed('musicxml:export', () => exportMusicXml(named, format));
          finishExport(file, file.dropped);
        } catch {
          setDialog({ kind: 'error', code: 'invalid-score' });
        }
      })();
    },
    [store, title, t, finishExport],
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
      {progress && (
        <div className="export-progress" role="status">
          <span>{t('io.exporting').replace('{format}', progress.format)}</span>
          {progress.total > 1 && (
            <>
              <progress value={progress.done} max={progress.total} aria-hidden="true" />
              <span>
                {t('io.exportProgress')
                  .replace('{done}', String(progress.done))
                  .replace('{total}', String(progress.total))}
              </span>
            </>
          )}
        </div>
      )}
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
      {dialog?.kind === 'exportReport' && (
        <Modal
          title={t('io.exportReportTitle')}
          onClose={close}
          actions={
            <button type="button" className="btn primary" data-autofocus onClick={close}>
              {t('io.close')}
            </button>
          }
        >
          <p>{t('io.exportReportIntro')}</p>
          <ReportList title={t('io.reportDropped')} counts={dialog.dropped} />
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

  /** Opens the file picker without the button (command palette, shortcut). */
  const pickFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.musicxml,.xml,.mxl';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) importFile(file);
    };
    input.click();
  }, [importFile]);

  return { exportAs, importFile, pickFile, dropProps, dragging, overlay };
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

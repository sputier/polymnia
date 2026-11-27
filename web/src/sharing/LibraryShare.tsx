import { useEffect, useState } from 'react';
import { loadScore } from '../api/scores';
import { EditorStore, newEditorScore } from '../editor/entry/editorStore';
import { useMusicXmlIO } from '../editor/musicXmlIO';
import { deserialize } from '../score';
import { ShareDialog } from './ShareDialog';

const noop = () => undefined;

/**
 * The share dialog opened from the library. The score is not open there, so it is fetched to give the dialog the same
 * export actions as the editor's Export menu (the same code path, on a store that only holds that score). Sharing
 * works at once; the export buttons appear when the score has loaded.
 */
export function LibraryShare({
  scoreId,
  title,
  onClose,
}: {
  scoreId: string;
  title: string;
  onClose: () => void;
}) {
  const [store] = useState(() => new EditorStore(newEditorScore(1)));
  const [ready, setReady] = useState(false);
  const io = useMusicXmlIO(store, title, noop);

  useEffect(() => {
    const controller = new AbortController();
    loadScore(scoreId, controller.signal).then(
      ({ text }) => {
        if (controller.signal.aborted) return;
        try {
          store.loadScore(deserialize(text));
          setReady(true);
        } catch {
          // A score that cannot be read cannot be exported: sharing still works.
        }
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [scoreId, store]);

  return (
    <>
      <ShareDialog
        scoreId={scoreId}
        title={title}
        onClose={onClose}
        {...(ready ? { onExport: io.exportAs } : {})}
      />
      {io.overlay}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { Engraver } from '../engraving/engraver';
import { scrollToMeasure } from '../engraving/scrollToMeasure';
import type { View } from './ViewToggle';

export interface SheetViewState {
  view: View;
  setView: (view: View) => void;
  /** Score and chord sheet, one after the other (palette command, key). */
  toggleView: () => void;
  /** Back to the score at a measure (0 based): the score scrolls to it once it is drawn. */
  openMeasure: (index: number) => void;
  /** The part whose diagrams the sheet shows (and the export prints). */
  sheetPart: string | undefined;
  setSheetPart: (id: string) => void;
}

/**
 * Which view the paper shows (#60), shared by the editor and the shared viewer. Not stored: a page
 * opens on the score. Leaving the sheet for a measure scrolls the score there when the engraver is
 * back (the score is not drawn while the sheet is shown).
 */
export function useSheetView(engraver: Engraver | null): SheetViewState {
  const [view, setView] = useState<View>('score');
  const [target, setTarget] = useState<number | null>(null);
  const [sheetPart, setSheetPart] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (view !== 'score' || target === null || !engraver) return;
    return scrollToMeasure(engraver, target, () => setTarget(null));
  }, [view, target, engraver]);

  const toggleView = useCallback(() => setView((v) => (v === 'score' ? 'sheet' : 'score')), []);
  const openMeasure = useCallback((index: number) => {
    setTarget(index);
    setView('score');
  }, []);
  return { view, setView, toggleView, openMeasure, sheetPart, setSheetPart };
}

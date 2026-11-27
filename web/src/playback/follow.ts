import type { Engraver } from '../engraving/engraver';
import type { PlaybackController, PlaybackFrame } from './controller';

/**
 * Connects the playhead to the engraved score: highlight class toggles, the cursor bar and the
 * scrolling. It runs outside React (one call per animation frame at most, and only when the notes
 * under the playhead change), and never re-engraves.
 */
export function followPlayback(controller: PlaybackController, engraver: Engraver): () => void {
  let last = '';
  const off = controller.onFrame((frame: PlaybackFrame) => {
    const key = `${frame.noteIds.join(',')}|${frame.spanIds.join(',')}`;
    if (key === last) return;
    last = key;
    engraver.setPlaying(frame.noteIds);
    const rect = engraver.setPlayCursor(frame.spanIds);
    if (rect) scrollTo(engraver.svg, rect.y, rect.h);
  });
  return () => {
    off();
    engraver.setPlaying([]);
    engraver.setPlayCursor([]);
  };
}

/** Keeps the cursor in view: scrolls only when it leaves the visible part of the score area. */
function scrollTo(svg: SVGSVGElement, y: number, height: number): void {
  const scroller = svg.closest<HTMLElement>('.score-area');
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const top = svg.getBoundingClientRect().top + y;
  const bottom = top + height;
  if (top >= view.top + 24 && bottom <= view.bottom - 24) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollBy({
    top: top - view.top - view.height * 0.25,
    behavior: reduced ? 'auto' : 'smooth',
  });
}

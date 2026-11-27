import type { Engraver } from './engraver';

/**
 * Scrolls the score area so the system that holds `measure` (0 based) is near the top. The layout is
 * complete as soon as the first render started, so this waits (a few frames) for it when the engraver
 * was just created. Returns a function that cancels the wait.
 */
export function scrollToMeasure(
  engraver: Engraver,
  measure: number,
  done?: () => void,
): () => void {
  let frame = 0;
  const started = performance.now();
  const attempt = () => {
    const system = engraver.layout.systems.find(
      (s) => measure >= s.firstMeasure && measure <= s.lastMeasure,
    );
    if (!system) {
      // No layout yet (the first render has not run): the fonts and the first width can take a while on a slow device: keep trying for 15 seconds.
      if (performance.now() - started < 15_000) frame = requestAnimationFrame(attempt);
      else done?.();
      return;
    }
    const scroller = engraver.svg.closest<HTMLElement>('.score-area');
    if (scroller) {
      const top = engraver.svg.getBoundingClientRect().top + system.y;
      scroller.scrollBy({ top: top - scroller.getBoundingClientRect().top - 24, behavior: 'auto' });
    }
    done?.();
  };
  frame = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(frame);
}

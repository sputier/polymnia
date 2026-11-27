import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/i18n';
import { useChordNaming } from './chordNaming';
import type { Score } from '../score/types';
import type { Engraver, ensureChordLibrary as EnsureChordLibrary } from './engraver';
import type { HitResult } from './hitTest';
import { needsChordLibrary } from '../score/diagrams';
import { preloadEngravingFonts } from './fonts';
import './engraving.css';

export interface ScoreViewProps {
  /** Score to engrave. Without it, the "Au clair de la lune" fixture is shown (until documents exist). */
  score?: Score;
  /** Event ids drawn with the selection highlight (class toggle, no re-engrave). */
  selection?: readonly string[];
  /** Event ids drawn with the playback highlight. */
  playing?: readonly string[];
  /** Out-of-range notes: drawn in the warning color with a mark and a tooltip (`text`). */
  warnings?: readonly { id: string; text: string }[];
  /** Called on pointer down with what is under the pointer (null outside every system). */
  onHit?: (hit: HitResult | null, event: React.PointerEvent<HTMLDivElement>) => void;
  /** Text announced politely to screen readers (the selected event description, wired by #19). */
  liveMessage?: string;
  /** Receives the engraver once it exists (and null when it is gone): playback follows the score through it. */
  onEngraver?: (engraver: Engraver | null) => void;
  /** Drawn over the score, in the coordinates of the engraved SVG (the chord symbol text field). */
  overlay?: React.ReactNode;
}

const RESIZE_DEBOUNCE_MS = 120;
/** The first render does not wait longer than this for the music font (it shows up when it arrives). */
const FONT_WAIT_MS = 2500;

/** Test and preview hook: `#/editor?fixture=<name>&width=<px>` (see docs/engraving.md). */
function previewParams(): { fixture?: string; width?: number } {
  const query = window.location.hash.split('?')[1];
  if (!query) return {};
  const params = new URLSearchParams(query);
  const fixture = params.get('fixture') ?? undefined;
  const width = Number(params.get('width'));
  return { ...(fixture ? { fixture } : {}), ...(width > 0 ? { width } : {}) };
}

async function loadFixture(name: string): Promise<Score> {
  if (name === 'accidentals') return (await import('./previewScores')).accidentalsScore();
  if (name === 'benchmark100') return (await import('./previewScores')).benchmarkScore(100);
  const { FIXTURES, auClairDeLaLune } = await import('../score/fixtures');
  return FIXTURES[name] ?? auClairDeLaLune;
}

export function ScoreView({
  score,
  selection,
  playing,
  warnings,
  onHit,
  liveMessage,
  onEngraver,
  overlay,
}: ScoreViewProps) {
  const { t, language } = useI18n();
  const chordNaming = useChordNaming();
  const preview = useMemo(() => previewParams(), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const [engraver, setEngraver] = useState<Engraver | null>(null);
  /** Loads the chord library (diagrams); set with the engraver chunk. */
  const ensureLibrary = useRef<typeof EnsureChordLibrary | null>(null);
  const libraryReady = useRef(false);
  const [width, setWidth] = useState(preview.width ?? 0);
  const [fixtureScore, setFixtureScore] = useState<Score | null>(null);

  const effective = score ?? fixtureScore;

  // Fixture shown while there is no document: loaded lazily, off the first screen.
  useEffect(() => {
    if (score) return;
    let cancelled = false;
    void loadFixture(preview.fixture ?? 'auClairDeLaLune').then((s) => {
      if (!cancelled) setFixtureScore(s);
    });
    return () => {
      cancelled = true;
    };
  }, [score, preview.fixture]);

  // VexFlow is a lazy chunk: it is fetched here, after the first paint.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let created: Engraver | null = null;
    // The music font downloads in parallel with the chunk (preload), then the first render starts.
    preloadEngravingFonts();
    void import('./engraver').then(
      async ({ Engraver: Ctor, loadEngravingFonts, ensureChordLibrary }) => {
        if (cancelled) return;
        ensureLibrary.current = ensureChordLibrary;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          loadEngravingFonts(),
          new Promise<void>((resolve) => (timer = setTimeout(resolve, FONT_WAIT_MS))),
        ]);
        clearTimeout(timer);
        if (cancelled) return;
        created = new Ctor(host);
        setEngraver(created);
      },
    );
    return () => {
      cancelled = true;
      created?.destroy();
      setEngraver(null);
    };
  }, []);

  // Available width: debounced after the first measure.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (preview.width) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setWidth(Math.floor(host.clientWidth));
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(host);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [preview.width]);

  useEffect(() => {
    if (!engraver || !effective || width <= 0) return;
    let cancelled = false;
    const draw = () => {
      // Visible systems now, the others in idle time; layout and hit testing are complete at once.
      engraver.render(effective, width, { progressive: true });
      if (preview.fixture || score) {
        // The test hook appears once every system is engraved. Merged: the editor adds its store.
        void engraver.settled().then(() => {
          if (cancelled) return;
          const w = window as unknown as { __polymnia?: Record<string, unknown> };
          w.__polymnia = { ...w.__polymnia, engraver, score: effective, width };
        });
      }
    };
    if (libraryReady.current || !needsChordLibrary(effective)) draw();
    else {
      // Fretboard diagrams need the chord library, a small lazy chunk fetched once.
      void ensureLibrary.current?.(effective).then(() => {
        libraryReady.current = true;
        if (!cancelled) draw();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [engraver, effective, width, preview.fixture, score, chordNaming]);

  // Screen reader summary of the whole score (the selected event goes through the live region).
  useEffect(() => {
    if (!engraver || !effective) return;
    engraver.svg.setAttribute('role', 'img');
    engraver.svg.setAttribute(
      'aria-label',
      t('score.summary')
        .replace('{title}', effective.meta.title || t('editor.untitled'))
        .replace('{parts}', String(effective.parts.length))
        .replace('{measures}', String(effective.measures.length)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` changes identity on every render; the language is what matters.
  }, [engraver, effective, language]);

  useEffect(() => {
    onEngraver?.(engraver);
    return () => onEngraver?.(null);
  }, [engraver, onEngraver]);

  // Highlights are class toggles: the engraver re-applies them itself after a render.
  useEffect(() => {
    engraver?.setSelection(selection ?? []);
  }, [engraver, selection]);

  useEffect(() => {
    engraver?.setPlaying(playing ?? []);
  }, [engraver, playing]);

  useEffect(() => {
    engraver?.setWarnings(warnings ?? []);
  }, [engraver, warnings]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!engraver || !onHit) return;
    const rect = engraver.svg.getBoundingClientRect();
    onHit(engraver.hitTest(event.clientX - rect.left, event.clientY - rect.top), event);
  };

  return (
    <div className="score-view">
      <div
        ref={hostRef}
        className="score-host"
        style={preview.width ? { width: preview.width } : undefined}
        onPointerDown={handlePointerDown}
      />
      {overlay}
      <div className="visually-hidden" role="status" aria-live="polite">
        {liveMessage}
      </div>
    </div>
  );
}

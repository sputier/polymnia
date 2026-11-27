import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/i18n';
import type { Score } from '../score/types';
import type { Engraver } from './engraver';
import type { HitResult } from './hitTest';
import './engraving.css';

export interface ScoreViewProps {
  /** Score to engrave. Without it, the "Au clair de la lune" fixture is shown (until documents exist). */
  score?: Score;
  /** Event ids drawn with the selection highlight (class toggle, no re-engrave). */
  selection?: readonly string[];
  /** Event ids drawn with the playback highlight. */
  playing?: readonly string[];
  /** Called on pointer down with what is under the pointer (null outside every system). */
  onHit?: (hit: HitResult | null, event: React.PointerEvent<HTMLDivElement>) => void;
  /** Text announced politely to screen readers (the selected event description, wired by #19). */
  liveMessage?: string;
}

const RESIZE_DEBOUNCE_MS = 120;

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

export function ScoreView({ score, selection, playing, onHit, liveMessage }: ScoreViewProps) {
  const { t, language } = useI18n();
  const preview = useMemo(() => previewParams(), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const [engraver, setEngraver] = useState<Engraver | null>(null);
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
    void import('./engraver').then(({ Engraver: Ctor }) => {
      if (cancelled) return;
      created = new Ctor(host);
      setEngraver(created);
    });
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
    engraver.render(effective, width);
    if (preview.fixture) {
      (window as unknown as { __polymnia?: unknown }).__polymnia = {
        engraver,
        score: effective,
        width,
      };
    }
  }, [engraver, effective, width, preview.fixture]);

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

  // Highlights are class toggles: the engraver re-applies them itself after a render.
  useEffect(() => {
    engraver?.setSelection(selection ?? []);
  }, [engraver, selection]);

  useEffect(() => {
    engraver?.setPlaying(playing ?? []);
  }, [engraver, playing]);

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
      <div className="visually-hidden" role="status" aria-live="polite">
        {liveMessage}
      </div>
    </div>
  );
}

/**
 * Engraver: owns the SVG and renders a score into it, one group per system. Re-rendering is
 * incremental: a system whose content and placement are unchanged keeps its DOM nodes, so an edit
 * re-engraves only the system(s) it touches. Selection and playback highlighting are class toggles
 * on existing nodes, never a re-engrave.
 *
 * This module imports VexFlow (through ./draw): load it with a dynamic import().
 */
import { Renderer, type RenderContext } from 'vexflow/bravura';
import type { Score } from '../score/types';
import { eventBox, hitTest, type EventBox, type HitResult } from './hitTest';
import { LayoutCache, layoutScore, type Layout, type SystemLayout } from './layout';
import { drawSystem } from './draw';

export interface RenderStats {
  /** Wall time of the whole render call, ms. */
  readonly ms: number;
  readonly systems: number;
  /** Systems engraved by this call. */
  readonly drawn: number;
  /** Systems whose DOM was reused untouched. */
  readonly reused: number;
  /** Systems whose start modifiers were wider than the layout reserved (a layout bug, expected 0). */
  readonly overflow: number;
}

interface Entry {
  readonly key: string;
  readonly refs: readonly unknown[];
  readonly group: SVGGElement;
  readonly elements: Map<string, SVGElement[]>;
  readonly overflow: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Engraver {
  readonly svg: SVGSVGElement;
  layout: Layout;
  stats: RenderStats = { ms: 0, systems: 0, drawn: 0, reused: 0, overflow: 0 };
  private readonly ctx: RenderContext;
  private readonly overlay: SVGGElement;
  private readonly cache = new LayoutCache();
  private entries: Entry[] = [];
  private eventSystem = new Map<string, number>();
  private selected = new Set<string>();
  private playing = new Set<string>();

  constructor(container: HTMLElement) {
    const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
    this.ctx = renderer.getContext();
    this.ctx.setFillStyle('currentColor');
    this.ctx.setStrokeStyle('currentColor');
    this.svg = container.querySelector('svg')!;
    this.svg.classList.add('pm-score');
    this.overlay = document.createElementNS(SVG_NS, 'g');
    this.overlay.setAttribute('class', 'pm-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.svg.appendChild(this.overlay);
    this.layout = { width: 0, height: 0, systems: [], staves: [] };
  }

  /** Renders `score` for an available width in px. Only changed systems are engraved again. */
  render(score: Score, width: number): RenderStats {
    const t0 = performance.now();
    this.layout = layoutScore(score, { width }, this.cache);
    const layout = this.layout;

    this.eventSystem = new Map();
    for (const system of layout.systems) {
      for (const m of system.measures) {
        for (const list of m.shape.staves)
          for (const e of list) this.eventSystem.set(e.id, system.index);
      }
    }

    const previous = this.entries;
    const reusedEntries = new Set<Entry>();
    const next: Entry[] = [];
    let drawn = 0;
    let overflow = 0;
    layout.systems.forEach((system) => {
      const { key, refs } = systemSignature(score, system, this.eventSystem);
      let entry = previous.find(
        (p) => !reusedEntries.has(p) && p.key === key && sameRefs(p.refs, refs),
      );
      if (entry) {
        reusedEntries.add(entry);
      } else {
        const inSystem = (id: string) => this.eventSystem.get(id) === system.index;
        const result = drawSystem(this.ctx, score, system, score.slurs, inSystem);
        entry = {
          key,
          refs,
          group: result.group,
          elements: result.elements,
          overflow: result.overflow,
        };
        drawn++;
      }
      overflow += entry.overflow;
      entry.group.setAttribute('transform', `translate(0 ${system.y})`);
      this.svg.insertBefore(entry.group, this.overlay);
      next.push(entry);
    });
    for (const old of previous) if (!reusedEntries.has(old)) old.group.remove();
    this.entries = next;

    const height = Math.max(layout.height, 1);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    this.applyHighlights();
    this.stats = {
      ms: performance.now() - t0,
      systems: layout.systems.length,
      drawn,
      reused: layout.systems.length - drawn,
      overflow,
    };
    return this.stats;
  }

  hitTest(x: number, y: number): HitResult | null {
    return hitTest(this.layout, x, y);
  }

  eventBox(eventId: string): EventBox | undefined {
    return eventBox(this.layout, eventId);
  }

  /** Highlights events (class toggle on existing nodes, no re-engrave). */
  setSelection(ids: readonly string[]): void {
    this.selected = new Set(ids);
    this.applyHighlights();
  }

  /** Marks events as playing (class toggle, safe to call at 60 fps). */
  setPlaying(ids: readonly string[]): void {
    const before = this.playing;
    this.playing = new Set(ids);
    for (const id of before) if (!this.playing.has(id)) this.toggle(id, 'pm-playing', false);
    for (const id of this.playing) if (!before.has(id)) this.toggle(id, 'pm-playing', true);
  }

  private toggle(id: string, cls: string, on: boolean): void {
    const sys = this.eventSystem.get(id);
    const els = sys === undefined ? undefined : this.entries[sys]?.elements.get(id);
    els?.forEach((el) => el.classList.toggle(cls, on));
  }

  private applyHighlights(): void {
    for (const entry of this.entries) {
      for (const els of entry.elements.values()) {
        els.forEach((el) => {
          const id = el.getAttribute('data-event-id')!;
          el.classList.toggle('pm-selected', this.selected.has(id));
          el.classList.toggle('pm-playing', this.playing.has(id));
        });
      }
    }
    this.overlay.replaceChildren();
    for (const id of this.selected) {
      const box = eventBox(this.layout, id);
      if (!box) continue;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'pm-sel-bg');
      rect.setAttribute('x', String(box.x - 5));
      rect.setAttribute('y', String(box.y - 4));
      rect.setAttribute('width', String(box.w + 10));
      rect.setAttribute('height', String(box.h + 8));
      rect.setAttribute('rx', '4');
      this.overlay.appendChild(rect);
    }
  }

  destroy(): void {
    this.svg.remove();
    this.entries = [];
  }
}

function sameRefs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Everything a system's drawing depends on: placement (string) and score objects (references). */
function systemSignature(
  score: Score,
  system: SystemLayout,
  eventSystem: ReadonlyMap<string, number>,
): { key: string; refs: unknown[] } {
  const refs: unknown[] = [];
  const first = system.firstMeasure;
  for (let m = Math.max(0, first - 1); m <= system.lastMeasure; m++) {
    for (const slot of system.staves) {
      refs.push(score.parts[slot.partIndex]!.staves[slot.staffIndex]!.measures[m]);
    }
  }
  const slurs = score.slurs
    .filter(
      (s) =>
        eventSystem.get(s.startEventId) === system.index ||
        eventSystem.get(s.endEventId) === system.index,
    )
    .map(
      (s) =>
        `${s.id}:${s.startEventId}:${s.endEventId}:${eventSystem.get(s.startEventId)}:${eventSystem.get(s.endEventId)}`,
    );
  const placement = system.measures.map((m) => [
    m.index,
    m.x,
    m.width,
    m.noteStartX,
    m.noteEndX,
    m.start,
    m.end,
    m.keyFifths,
    m.time,
    m.clefs,
    m.final,
    m.colX,
  ]);
  const names = system.names ? score.parts.map((p) => p.name) : null;
  const key = JSON.stringify([
    system.x,
    system.right,
    system.names,
    names,
    system.staves,
    placement,
    slurs,
    score.parts.map((p) => p.staves.map((s) => s.type)),
  ]);
  return { key, refs };
}

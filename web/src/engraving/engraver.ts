/**
 * Engraver: owns the SVG and renders a score into it, one group per system. Re-rendering is
 * incremental: a system whose content and placement are unchanged keeps its DOM nodes, so an edit
 * re-engraves only the system(s) it touches. Selection and playback highlighting are class toggles
 * on existing nodes, never a re-engrave.
 *
 * This module imports VexFlow (through ./draw): load it with a dynamic import().
 */
import { Renderer, type RenderContext } from 'vexflow/core';
import type { Score } from '../score/types';
import { shortPartName } from '../score/instruments';
import { eventBox, hitTest, type EventBox, type HitResult, type Rect } from './hitTest';
import { getChordNaming } from './chordNaming';
import { LayoutCache, layoutScore, type Layout, type SystemLayout } from './layout';
import { needsChordLibrary } from '../score/diagrams';
import { drawSystem } from './draw';
import { hasShapeLookup, setShapeLookup } from './drawChords';
import './vexflowSetup';

export { loadEngravingFonts } from './vexflowSetup';

/**
 * Loads the chord library (a separate lazy chunk) the first time a score shows fretboard diagrams.
 * Call it before `render`: it does nothing for a score without diagrams and resolves at once afterwards.
 */
export async function ensureChordLibrary(score: Score): Promise<void> {
  if (hasShapeLookup() || !needsChordLibrary(score)) return;
  const { lookupShape } = await import('../chords/library');
  setShapeLookup(lookupShape);
}

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
  /** Time from the call to the first system engraved, ms (0 when nothing had to be engraved). */
  readonly firstSystemMs: number;
  /** False while systems are still queued for idle time (progressive render). */
  readonly complete: boolean;
}

export interface RenderOptions {
  /**
   * Engrave the systems on screen now and the others in idle time (the layout, hit testing and
   * boxes are available at once). `settled()` tells when everything is drawn.
   */
  readonly progressive?: boolean;
}

type IdleScheduler = (
  cb: (d: { timeRemaining(): number }) => void,
  o?: { timeout: number },
) => number;

/** Time slice of one idle chunk, ms. */
const CHUNK_MS = 20;
/**
 * A progressive render engraves the systems on screen in the call itself only while this budget
 * (layout included) allows it: a keystroke must stay under a 60 fps frame. The first system is
 * always engraved (it holds the edit); the other visible ones follow on the next tasks, before
 * idle time.
 */
const SYNC_BUDGET_MS = 6;
/** Starting estimate of the cost of engraving one system, ms (then follows the measures). */
const SYSTEM_COST_MS = 4;

interface Job {
  readonly score: Score;
  queue: Pending[];
  /** Leading queue items that are on screen: drawn one per task, before idle time. */
  urgent: number;
  readonly t0: number;
  drawn: number;
  firstSystemMs: number;
  done: Promise<void>;
  resolve: () => void;
  handle?: number | undefined;
  cancel?: ((handle: number) => void) | undefined;
}

interface Pending {
  readonly system: SystemLayout;
  readonly key: string;
  readonly refs: unknown[];
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
  stats: RenderStats = {
    ms: 0,
    systems: 0,
    drawn: 0,
    reused: 0,
    overflow: 0,
    firstSystemMs: 0,
    complete: true,
  };
  private readonly ctx: RenderContext;
  private readonly overlay: SVGGElement;
  private readonly cursorLayer: SVGGElement;
  private cursor: SVGRectElement | undefined;
  private readonly cache = new LayoutCache();
  /** Size last given to the SVG (width x height). */
  private size = '';
  private entries: (Entry | undefined)[] = [];
  private job: Job | undefined;
  /** Smoothed cost of engraving one system, ms. */
  private systemCost = SYSTEM_COST_MS;
  private eventSystem = new Map<string, number>();
  private selected = new Set<string>();
  private playing = new Set<string>();
  /** Out-of-range events and their tooltip text. */
  private warned = new Map<string, string>();
  private readonly warnLayer: SVGGElement;

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
    this.warnLayer = document.createElementNS(SVG_NS, 'g');
    this.warnLayer.setAttribute('class', 'pm-warn-layer');
    this.svg.appendChild(this.warnLayer);
    this.cursorLayer = document.createElementNS(SVG_NS, 'g');
    this.cursorLayer.setAttribute('class', 'pm-cursor-layer');
    this.cursorLayer.setAttribute('aria-hidden', 'true');
    this.svg.appendChild(this.cursorLayer);
    this.layout = { width: 0, height: 0, systems: [], staves: [] };
  }

  /** Renders `score` for an available width in px. Only changed systems are engraved again. */
  render(score: Score, width: number, options: RenderOptions = {}): RenderStats {
    const t0 = performance.now();
    this.cancelJob();
    this.layout = layoutScore(score, { width }, this.cache);
    const layout = this.layout;

    this.eventSystem = new Map();
    for (const system of layout.systems) {
      for (const m of system.measures) {
        for (const list of m.shape.staves)
          for (const e of list) this.eventSystem.set(e.id, system.index);
      }
    }

    const height = Math.max(layout.height, 1);
    // Only when the size changed: setting an attribute to the same value still invalidates the
    // layout of the whole SVG, which a keystroke would then pay for in the next forced layout.
    const size = `${width}x${height}`;
    if (size !== this.size) {
      this.size = size;
      this.svg.setAttribute('width', String(width));
      this.svg.setAttribute('height', String(height));
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    // Reuse what is unchanged (cheap: signatures only), remember what must be engraved.
    const previous = this.entries.filter((e): e is Entry => e !== undefined);
    const reusedEntries = new Set<Entry>();
    const next: (Entry | undefined)[] = [];
    const pending: Pending[] = [];
    for (const system of layout.systems) {
      const { key, refs } = systemSignature(score, system, this.eventSystem);
      const entry = previous.find(
        (p) => !reusedEntries.has(p) && p.key === key && sameRefs(p.refs, refs),
      );
      if (entry) {
        reusedEntries.add(entry);
        entry.group.setAttribute('transform', `translate(0 ${system.y})`);
      } else {
        pending.push({ system, key, refs });
      }
      next.push(entry);
    }
    for (const old of previous) if (!reusedEntries.has(old)) old.group.remove();
    this.entries = next;

    const total = layout.systems.length;
    const job: Job = {
      score,
      queue: pending,
      urgent: 0,
      t0,
      drawn: 0,
      firstSystemMs: pending.length === 0 ? 0 : -1,
      done: Promise.resolve(),
      resolve: () => {},
    };
    this.job = job;
    job.done = new Promise<void>((resolve) => (job.resolve = resolve));

    // Systems on screen come first, the one holding the selection before the others. Without
    // `progressive` everything is engraved now; with it, only what the budget allows, the rest of
    // the visible ones on the next tasks and the others in idle time.
    const eager = options.progressive ? this.visibleRange() : undefined;
    if (eager) {
      const edited = new Set<number>();
      for (const id of this.selected) {
        const index = this.eventSystem.get(id);
        if (index !== undefined) edited.add(index);
      }
      const visible: Pending[] = [];
      const rest: Pending[] = [];
      for (const p of pending) {
        const on = p.system.y < eager.bottom && p.system.y + p.system.height > eager.top;
        (on ? visible : rest).push(p);
      }
      visible.sort(
        (a, b) => Number(edited.has(b.system.index)) - Number(edited.has(a.system.index)),
      );
      let next = 0;
      while (next < visible.length) {
        const spent = performance.now() - t0;
        if (next > 0 && spent + this.systemCost > SYNC_BUDGET_MS) break;
        this.drawPending(job, visible[next]!);
        next++;
      }
      const later = visible.slice(next).sort((a, b) => a.system.index - b.system.index);
      job.urgent = later.length;
      job.queue = [...later, ...rest];
      if (job.queue.length === 0 && job.firstSystemMs < 0)
        job.firstSystemMs = performance.now() - t0;
    } else {
      for (const p of pending) this.drawPending(job, p);
      job.queue = [];
    }

    if (job.queue.length === 0) this.finishJob(job);
    else this.scheduleChunk(job);

    this.refreshOverlay();
    this.refreshWarnLayer();
    return this.snapshotStats(job, total);
  }

  /** Resolves when every system of the last render call is engraved (immediately if it is). */
  settled(): Promise<void> {
    return this.job ? this.job.done : Promise.resolve();
  }

  private cancelJob(): void {
    const job = this.job;
    if (!job) return;
    if (job.handle !== undefined) job.cancel?.(job.handle);
    this.job = undefined;
    job.resolve(); // nobody waits forever on a superseded render
  }

  /** Vertical range (SVG coordinates) that is on screen, with a small margin. */
  private visibleRange(): { top: number; bottom: number } {
    const rect = this.svg.getBoundingClientRect();
    const margin = 120;
    // Before the first layout of the page the rect is empty: assume the top of the page.
    const viewport = typeof window === 'undefined' ? 800 : window.innerHeight || 800;
    const top = -rect.top - margin;
    const bottom = viewport - rect.top + margin;
    return { top, bottom };
  }

  private drawPending(job: Job, p: Pending): void {
    const { system, key, refs } = p;
    const started = performance.now();
    const inSystem = (id: string) => this.eventSystem.get(id) === system.index;
    const result = drawSystem(this.ctx, job.score, system, job.score.slurs, inSystem);
    const entry: Entry = {
      key,
      refs,
      group: result.group,
      elements: result.elements,
      overflow: result.overflow,
    };
    entry.group.setAttribute('transform', `translate(0 ${system.y})`);
    // Keep the DOM in score order: before the next system already present, else before the overlay.
    let anchor: Node = this.overlay;
    for (let i = system.index + 1; i < this.entries.length; i++) {
      const later = this.entries[i];
      if (later) {
        anchor = later.group;
        break;
      }
    }
    this.svg.insertBefore(entry.group, anchor);
    this.entries[system.index] = entry;
    job.drawn++;
    if (job.firstSystemMs < 0) job.firstSystemMs = performance.now() - job.t0;
    this.applyHighlightsTo(entry);
    this.systemCost = this.systemCost * 0.5 + (performance.now() - started) * 0.5;
  }

  private scheduleChunk(job: Job): void {
    const idle = (globalThis as { requestIdleCallback?: IdleScheduler }).requestIdleCallback;
    const cancelIdle = (globalThis as { cancelIdleCallback?: (h: number) => void })
      .cancelIdleCallback;
    const run = (deadline?: { timeRemaining(): number }) => {
      job.handle = undefined;
      if (this.job !== job) return;
      const start = performance.now();
      if (job.urgent > 0) {
        // On screen: one system per task, so that a key pressed meanwhile is not kept waiting.
        this.drawPending(job, job.queue.shift()!);
        job.urgent--;
      } else {
        const budget = Math.min(deadline?.timeRemaining() ?? CHUNK_MS, CHUNK_MS);
        do {
          const next = job.queue.shift();
          if (!next) break;
          this.drawPending(job, next);
        } while (job.queue.length > 0 && performance.now() - start < budget);
      }
      if (job.queue.length === 0) this.finishJob(job);
      else this.scheduleChunk(job);
    };
    if (idle && job.urgent === 0) {
      job.handle = idle(run, { timeout: 120 });
      // Called as a method of the job it would throw "Illegal invocation": keep `this` as the window.
      job.cancel = (h) => cancelIdle?.call(globalThis, h);
    } else {
      job.handle = setTimeout(() => run(), 0) as unknown as number;
      job.cancel = (h) => clearTimeout(h);
    }
  }

  private finishJob(job: Job): void {
    this.stats = this.snapshotStats(job, this.layout.systems.length);
    this.job = undefined;
    job.resolve();
  }

  private snapshotStats(job: Job, total: number): RenderStats {
    let overflow = 0;
    for (const e of this.entries) overflow += e?.overflow ?? 0;
    const stats: RenderStats = {
      ms: performance.now() - job.t0,
      systems: total,
      drawn: job.drawn,
      reused: this.entries.filter(Boolean).length - job.drawn,
      overflow,
      firstSystemMs: Math.max(job.firstSystemMs, 0),
      complete: job.queue.length === 0,
    };
    this.stats = stats;
    return stats;
  }

  hitTest(x: number, y: number): HitResult | null {
    return hitTest(this.layout, x, y);
  }

  eventBox(eventId: string): EventBox | undefined {
    return eventBox(this.layout, eventId);
  }

  /** Highlights events (class toggle on existing nodes, no re-engrave). */
  setSelection(ids: readonly string[]): void {
    const before = this.selected;
    this.selected = new Set(ids);
    for (const id of before) if (!this.selected.has(id)) this.toggle(id, 'pm-selected', false);
    for (const id of this.selected) if (!before.has(id)) this.toggle(id, 'pm-selected', true);
    this.refreshOverlay();
  }

  /**
   * Out-of-range notes: the note takes the warning color (class `pm-warn`) and a small triangle
   * mark with a tooltip sits above it, so the warning does not rely on color alone.
   */
  setWarnings(list: readonly { id: string; text: string }[]): void {
    const before = this.warned;
    this.warned = new Map(list.map((w) => [w.id, w.text]));
    for (const id of before.keys()) if (!this.warned.has(id)) this.toggle(id, 'pm-warn', false);
    for (const id of this.warned.keys()) if (!before.has(id)) this.toggle(id, 'pm-warn', true);
    this.refreshWarnLayer();
  }

  private refreshWarnLayer(): void {
    this.warnLayer.replaceChildren();
    for (const [id, text] of this.warned) {
      const box = eventBox(this.layout, id);
      if (!box) continue;
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'pm-warn-mark');
      g.setAttribute('data-warn-for', id);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = text;
      const cx = box.x + box.w / 2;
      const top = box.y - 15;
      const tri = document.createElementNS(SVG_NS, 'path');
      tri.setAttribute('d', `M${cx} ${top} l6 11 h-12 z`);
      const bang = document.createElementNS(SVG_NS, 'text');
      bang.setAttribute('x', String(cx));
      bang.setAttribute('y', String(top + 9.5));
      bang.setAttribute('text-anchor', 'middle');
      bang.textContent = '!';
      g.append(title, tri, bang);
      this.warnLayer.appendChild(g);
    }
  }

  /** Marks events as playing (class toggle, safe to call at 60 fps). */
  setPlaying(ids: readonly string[]): void {
    const before = this.playing;
    this.playing = new Set(ids);
    for (const id of before) if (!this.playing.has(id)) this.toggle(id, 'pm-playing', false);
    for (const id of this.playing) if (!before.has(id)) this.toggle(id, 'pm-playing', true);
  }

  /**
   * Draws the playback cursor around the given events (a vertical bar spanning their staves), or
   * hides it. One rect that is moved: no re-engrave, safe at 60 fps. Returns the bar in SVG
   * coordinates so the caller can scroll to it.
   */
  setPlayCursor(ids: readonly string[]): Rect | undefined {
    const boxes = ids.map((id) => eventBox(this.layout, id)).filter((b): b is EventBox => !!b);
    if (boxes.length === 0) {
      this.cursor?.setAttribute('visibility', 'hidden');
      return undefined;
    }
    // Only the events of the system at the left-most column (the playhead is in one place).
    const x = Math.min(...boxes.map((b) => b.x));
    const here = boxes.filter((b) => Math.abs(b.x - x) < 40);
    const top = Math.min(...here.map((b) => b.y)) - 6;
    const bottom = Math.max(...here.map((b) => b.y + b.h)) + 6;
    if (!this.cursor) {
      this.cursor = document.createElementNS(SVG_NS, 'rect');
      this.cursor.setAttribute('class', 'pm-cursor');
      this.cursor.setAttribute('rx', '1.5');
      this.cursorLayer.appendChild(this.cursor);
    }
    const rect = { x: x - 5, y: top, w: 3, h: bottom - top };
    this.cursor.setAttribute('x', String(rect.x));
    this.cursor.setAttribute('y', String(rect.y));
    this.cursor.setAttribute('width', String(rect.w));
    this.cursor.setAttribute('height', String(rect.h));
    this.cursor.removeAttribute('visibility');
    return rect;
  }

  private toggle(id: string, cls: string, on: boolean): void {
    const sys = this.eventSystem.get(id);
    const els = sys === undefined ? undefined : this.entries[sys]?.elements.get(id);
    els?.forEach((el) => el.classList.toggle(cls, on));
  }

  private applyHighlightsTo(entry: Entry): void {
    for (const els of entry.elements.values()) {
      els.forEach((el) => {
        const id = el.getAttribute('data-event-id')!;
        el.classList.toggle('pm-selected', this.selected.has(id));
        el.classList.toggle('pm-playing', this.playing.has(id));
        el.classList.toggle('pm-warn', this.warned.has(id));
      });
    }
  }

  /** Selection backgrounds, from the layout (available even for systems not engraved yet). */
  private refreshOverlay(): void {
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
    this.cancelJob();
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
    m.shape.chords,
  ]);
  const names = system.names
    ? score.parts.map((p) => (system.shortNames ? shortPartName(p) : p.name))
    : null;
  const key = JSON.stringify([
    system.x,
    system.right,
    system.names,
    names,
    system.staves,
    placement,
    slurs,
    score.parts.map((p) => p.staves.map((s) => (s.showRests ? `${s.type}+rests` : s.type))),
    // Diagrams depend on the tuning and the capo; the symbols on the capo shapes option.
    score.parts.map((p) => [p.instrument, p.tuning, p.capo, p.chordDiagrams, p.chordCapoShapes]),
    getChordNaming(),
  ]);
  return { key, refs };
}

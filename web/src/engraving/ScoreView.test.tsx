import { act, render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pianoGrandStaff } from '../score/fixtures';

// VexFlow needs a real canvas and SVG metrics: the engraver itself is tested in the browser
// (e2e/engraving.spec.ts). Here a fake engraver checks the React wiring.
const calls = vi.hoisted(() => ({
  render: [] as { width: number; title: string }[],
  selection: [] as (readonly string[])[],
  playing: [] as (readonly string[])[],
  destroyed: 0,
  fonts: undefined as Promise<void> | undefined,
}));

vi.mock('./engraver', () => ({
  loadEngravingFonts: () => calls.fonts ?? Promise.resolve(),
  Engraver: class {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    constructor(container: HTMLElement) {
      container.appendChild(this.svg);
    }
    settled() {
      return Promise.resolve();
    }
    render(score: { meta: { title: string } }, width: number) {
      calls.render.push({ width, title: score.meta.title });
      return {
        ms: 0,
        systems: 1,
        drawn: 1,
        reused: 0,
        overflow: 0,
        firstSystemMs: 0,
        complete: true,
      };
    }
    setSelection(ids: readonly string[]) {
      calls.selection.push(ids);
    }
    setPlaying(ids: readonly string[]) {
      calls.playing.push(ids);
    }
    hitTest(x: number, y: number) {
      return { systemIndex: 0, partId: 'p', staffId: 's', measureIndex: 0, eventId: `${x},${y}` };
    }
    destroy() {
      calls.destroyed++;
    }
  },
}));

import { ScoreView } from './ScoreView';

let observers: (() => void)[] = [];

beforeEach(() => {
  calls.render = [];
  calls.selection = [];
  calls.playing = [];
  calls.destroyed = 0;
  calls.fonts = undefined;
  observers = [];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  window.location.hash = '';
});

describe('ScoreView', () => {
  it('engraves the given score at the measured width and exposes an accessible summary', async () => {
    render(<ScoreView score={pianoGrandStaff} />);
    await waitFor(() => expect(calls.render).toHaveLength(1));
    expect(calls.render[0]).toEqual({ width: 800, title: pianoGrandStaff.meta.title });
    const svg = document.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg.getAttribute('aria-label')).toContain(pianoGrandStaff.meta.title);
    expect(svg.getAttribute('aria-label')).toContain('1 instrument');
    expect(svg.getAttribute('aria-label')).toContain('4 measure');
  });

  it('shows the Au clair de la lune fixture when no score is given', async () => {
    render(<ScoreView />);
    await waitFor(() => expect(calls.render.at(-1)?.title).toBe('Au clair de la lune'));
  });

  it('forwards selection and playing ids without engraving again', async () => {
    const { rerender } = render(<ScoreView score={pianoGrandStaff} selection={[]} playing={[]} />);
    await waitFor(() => expect(calls.render).toHaveLength(1));
    rerender(<ScoreView score={pianoGrandStaff} selection={['e1']} playing={['e2']} />);
    await waitFor(() => expect(calls.selection.at(-1)).toEqual(['e1']));
    expect(calls.playing.at(-1)).toEqual(['e2']);
    expect(calls.render).toHaveLength(1);
  });

  it('re-engraves when the width changes, debounced', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ScoreView score={pianoGrandStaff} />);
      await waitFor(() => expect(calls.render).toHaveLength(1));
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => 500,
      });
      act(() => {
        observers.forEach((cb) => cb());
        observers.forEach((cb) => cb());
      });
      expect(calls.render).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(calls.render).toHaveLength(2);
      expect(calls.render[1]!.width).toBe(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports what is under the pointer', async () => {
    const onHit = vi.fn();
    const { container } = render(<ScoreView score={pianoGrandStaff} onHit={onHit} />);
    await waitFor(() => expect(calls.render).toHaveLength(1));
    fireEvent.pointerDown(container.querySelector('.score-host')!, { clientX: 0, clientY: 0 });
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit.mock.calls[0]![0]).toMatchObject({ measureIndex: 0, staffId: 's' });
  });

  it('keeps a polite live region for the selected event description', async () => {
    render(<ScoreView score={pianoGrandStaff} liveMessage="C4, quarter note" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('C4, quarter note');
    await waitFor(() => expect(calls.render).toHaveLength(1));
  });

  it('engraves once the music font is loaded, and still engraves if it is very late', async () => {
    let loaded!: () => void;
    calls.fonts = new Promise<void>((resolve) => (loaded = resolve));
    render(<ScoreView score={pianoGrandStaff} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.render).toHaveLength(0); // waiting for the font
    await act(async () => {
      loaded();
    });
    await waitFor(() => expect(calls.render).toHaveLength(1));
  });

  it('does not wait for a font that never arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      calls.fonts = new Promise<void>(() => {});
      render(<ScoreView score={pianoGrandStaff} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await waitFor(() => expect(calls.render).toHaveLength(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys the engraver on unmount', async () => {
    const { unmount } = render(<ScoreView score={pianoGrandStaff} />);
    await waitFor(() => expect(calls.render).toHaveLength(1));
    unmount();
    expect(calls.destroyed).toBeGreaterThan(0);
  });
});

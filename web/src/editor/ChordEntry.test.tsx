import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Engraver } from '../engraving/engraver';
import { layoutScore } from '../engraving/layout';
import { createScore, formatChord, staffChords } from '../score';
import { ChordEntry } from './ChordEntry';
import { EditorStore } from './entry/editorStore';

let store: EditorStore;

/** The part of the editor that hosts the field: remounted per position, like EditorLayout does. */
function Host() {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const fake = { layout: layoutScore(state.score, { width: 800 }) } as unknown as Engraver;
  if (!state.chordEntry) return <p>closed</p>;
  const e = state.chordEntry;
  return (
    <ChordEntry
      key={`${e.staffId}/${e.measure}/${e.tick}`}
      store={store}
      entry={e}
      score={state.score}
      engraver={fake}
    />
  );
}

const chords = () =>
  staffChords(store.getState().score, store.getState().score.parts[0]!.staves[0]!.id).map(
    ({ measure, chord }) => `${measure}:${chord.tick}:${formatChord(chord)}`,
  );
const field = () => screen.getByRole('textbox');
const pos = () => store.getState().chordEntry;

function open() {
  store = new EditorStore(createScore({ measures: 4, instruments: ['guitar-steel'] }));
  render(<Host />);
  store.openChordEntry();
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('ChordEntry', () => {
  it('opens focused, labelled with its place, and described', async () => {
    open();
    const input = await screen.findByRole('textbox', { name: /measure 1, beat 1/i });
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription(/Space moves to the next beat/);
  });

  it('writes a chord with Enter and closes', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'Am7{Enter}');
    expect(chords()).toEqual(['0:0:Am7']);
    expect(pos()).toBeNull();
    expect(screen.getByText('closed')).toBeInTheDocument();
  });

  it('Space writes and moves to the next beat, Tab to the next measure', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'C ');
    expect(pos()).toMatchObject({ measure: 0, tick: 960 });
    await user.type(screen.getByRole('textbox'), 'G7{Tab}');
    expect(pos()).toMatchObject({ measure: 1, tick: 0 });
    await user.type(screen.getByRole('textbox'), 'F');
    await user.keyboard('{Shift>}{ }{/Shift}');
    expect(pos()).toMatchObject({ measure: 0, tick: 2880 });
    expect(chords()).toEqual(['0:0:C', '0:960:G7', '1:0:F']);
  });

  it('shows the symbol that is already there, selected for overtyping', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'Dm{Tab}');
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(field()).toHaveValue('Dm');
    await user.keyboard('Em{Enter}');
    expect(chords()).toEqual(['0:0:Em']);
  });

  it('Shift+Tab goes back one measure', async () => {
    open();
    const user = userEvent.setup();
    store.openChordEntry({ staffId: pos()!.staffId, measure: 2, tick: 960 });
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(pos()).toMatchObject({ measure: 1, tick: 0 });
  });

  it('Escape closes without writing', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'Bb{Escape}');
    expect(chords()).toEqual([]);
    expect(pos()).toBeNull();
  });

  it('keeps the field open on text that is not a chord, and says so', async () => {
    open();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox');
    await user.type(input, 'hello');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Not a chord symbol/);
    await user.keyboard('{Enter}');
    expect(pos()).not.toBeNull();
    expect(chords()).toEqual([]);
    await user.clear(input);
    await user.type(input, 'Cmaj7{Enter}');
    expect(chords()).toEqual(['0:0:Cmaj7']);
  });

  it('removes a chord when the field is emptied', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'C{Enter}');
    store.openChordEntry();
    await user.keyboard('{Backspace}{Enter}');
    expect(chords()).toEqual([]);
  });

  it('previews how the symbol is shown when typed another way', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'rém7');
    expect(screen.getByText('Shown as Dm7')).toBeInTheDocument();
    await user.clear(field());
    await user.type(field(), 'Am7');
    expect(screen.queryByText(/Shown as/)).toBeNull();
  });

  it('keeps a valid chord when the field loses focus, and drops an invalid one', async () => {
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'G');
    await user.click(document.body);
    expect(chords()).toEqual(['0:0:G']);
    expect(pos()).toBeNull();
    store.openChordEntry();
    const again = await screen.findByRole('textbox');
    await user.clear(again);
    await user.type(again, 'zz');
    await user.click(document.body);
    expect(chords()).toEqual(['0:0:G']);
    expect(pos()).toBeNull();
  });

  it('is placed over the score, hidden until the layout is known', async () => {
    open();
    const box = (await screen.findByRole('textbox')).parentElement!;
    expect(box.style.left).not.toBe('');
    expect(box.style.top).not.toBe('');
  });
});

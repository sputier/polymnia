import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguage } from '../i18n/i18n';
import { createScore, putEvent, keyFifthsAt, clefAt, type Pitch } from '../score';

// The engraver (VexFlow) is covered by the browser tests.
vi.mock('../engraving/ScoreView', () => ({ ScoreView: () => <div data-testid="score-view" /> }));
import { EditorLayout } from './EditorLayout';
import { EditorStore } from './entry/editorStore';
import { resetUiMode, setUiMode } from './uiMode';
import { parsePitchName, pitchName, searchInstruments } from './instrumentUi';

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  resetLanguage();
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  localStorage.clear();
  resetUiMode();
  setUiMode('advanced');
});

const P = (step: Pitch['step'], octave: number, alter: Pitch['alter'] = 0): Pitch => ({
  step,
  alter,
  octave,
});

const open = (instruments: string[], measures = 4) => {
  const store = new EditorStore(createScore({ measures, instruments }));
  render(<EditorLayout store={store} />);
  return store;
};

describe('instrument search helpers', () => {
  it('finds instruments by English or French name, accents ignored, grouped by family', () => {
    expect(searchInstruments('violoncelle')[0]!.instruments.map((i) => i.id)).toEqual(['cello']);
    expect(searchInstruments('ukulele').flatMap((g) => g.instruments).length).toBeGreaterThan(4);
    expect(searchInstruments('GUITARE').map((g) => g.family)).toEqual(['fretted']);
    expect(searchInstruments('zzz')).toEqual([]);
    expect(searchInstruments('').length).toBeGreaterThan(3);
  });

  it('parses and prints note names', () => {
    expect(parsePitchName('F#3')).toEqual(P('F', 3, 1));
    expect(parsePitchName('bb2')).toEqual(P('B', 2, -1));
    expect(parsePitchName('H4')).toBeUndefined();
    expect(pitchName(P('E', 2, -1))).toBe('E♭2');
  });
});

describe('instruments panel', () => {
  it('lists the parts and adds an instrument found by its French name', async () => {
    const user = userEvent.setup();
    const store = open(['guitar-steel']);
    const panel = screen.getByRole('complementary', { name: 'Instruments' });
    await user.click(within(panel).getByRole('button', { name: 'Add an instrument' }));
    await user.type(
      within(panel).getByRole('searchbox', { name: 'Search instruments' }),
      'violoncelle',
    );
    await user.click(within(panel).getByRole('button', { name: 'Cello' }));
    expect(store.getState().score.parts.map((p) => p.instrument)).toEqual([
      'guitar-steel',
      'cello',
    ]);
    expect(within(panel).getByRole('button', { name: 'Edit Cello' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('removes a part only after a confirmation', async () => {
    const user = userEvent.setup();
    const store = open(['guitar-steel', 'cello']);
    await user.click(screen.getByRole('button', { name: 'Remove Cello' }));
    expect(store.getState().score.parts).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(store.getState().score.parts).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Steel-string guitar' })).toBeDisabled();
  });

  it('reorders with the buttons and with Alt+ArrowDown', async () => {
    const user = userEvent.setup();
    const store = open(['guitar-steel', 'cello', 'flute']);
    await user.click(screen.getByRole('button', { name: 'Move Cello up' }));
    expect(store.getState().score.parts.map((p) => p.instrument)).toEqual([
      'cello',
      'guitar-steel',
      'flute',
    ]);
    screen.getByRole('button', { name: 'Edit Cello' }).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(store.getState().score.parts.map((p) => p.instrument)).toEqual([
      'guitar-steel',
      'cello',
      'flute',
    ]);
  });

  it('guitar: tuning preset (drop D), custom tuning, capo and staff layout', async () => {
    const user = userEvent.setup();
    const store = open(['guitar-steel']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tuning' }), 'drop-d');
    expect(store.getState().score.parts[0]!.tuning?.[5]).toEqual(P('D', 2));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Capo' }), '2');
    expect(store.getState().score.parts[0]!.capo).toBe(2);
    await user.click(screen.getByRole('radio', { name: 'Standard + TAB' }));
    expect(store.getState().score.parts[0]!.staves.map((s) => s.type)).toEqual(['standard', 'tab']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tuning' }), 'custom');
    const string6 = screen.getByRole('textbox', { name: 'String 6' });
    await user.clear(string6);
    await user.type(string6, 'C2');
    await user.click(screen.getByRole('button', { name: 'Apply tuning' }));
    expect(store.getState().score.parts[0]!.tuning?.[5]).toEqual(P('C', 2));
    await user.clear(string6);
    await user.type(string6, 'nope');
    await user.click(screen.getByRole('button', { name: 'Apply tuning' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use a note name');
  });

  it('ukulele offers the low-G tuning, a cello offers none', async () => {
    const user = userEvent.setup();
    const store = open(['ukulele-tenor']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tuning' }), 'low-g');
    expect(store.getState().score.parts[0]!.tuning?.[3]).toEqual(P('G', 3));
  });

  it('cello settings have no tuning, capo or tablature controls', () => {
    open(['cello']);
    expect(screen.queryByRole('combobox', { name: 'Tuning' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Standard + TAB' })).toBeNull();
  });

  it('the command palette entry opens the picker', async () => {
    const user = userEvent.setup();
    open(['flute']);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(
      await screen.findByRole('combobox', { name: 'Search commands' }),
      'add an instr',
    );
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('searchbox', { name: 'Search instruments' }),
    ).toBeInTheDocument();
  });
});

describe('inspector', () => {
  it('changes the key signature of the measure under the cursor', async () => {
    const user = userEvent.setup();
    const store = open(['cello']);
    act(() => void store.insertMeasure('after'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Key signature' }), '2');
    expect(keyFifthsAt(store.getState().score, 1)).toBe(2);
    expect(keyFifthsAt(store.getState().score, 0)).toBe(0);
    expect(screen.getByText('Measure 2')).toBeInTheDocument();
  });

  it('switches cello clefs: bass, tenor, treble', async () => {
    const user = userEvent.setup();
    const store = open(['cello']);
    act(() => void store.insertMeasure('after'));
    const clef = screen.getByRole('combobox', { name: 'Clef from this measure' });
    expect(
      within(clef)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Bass', 'Tenor (C clef)', 'Treble']);
    await user.selectOptions(clef, 'tenor');
    expect(clefAt(store.getState().score.parts[0]!.staves[0]!, 1)).toBe('tenor');
  });

  it('time signature with a pickup, tempo change and measure buttons', async () => {
    const user = userEvent.setup();
    const store = open(['guitar-steel']);
    await user.clear(screen.getByRole('spinbutton', { name: 'Beats' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Beats' }), '3');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getState().score.measures[0]!.time).toEqual({ beats: 3, beatType: 4 });
    await user.click(screen.getByRole('checkbox', { name: /Pickup measure/ }));
    expect(store.getState().score.measures[0]!.length).toBe(960);

    act(() => void store.insertMeasure('after'));
    const tempo = screen.getByRole('spinbutton', { name: 'Tempo (quarter notes per minute)' });
    await user.clear(tempo);
    await user.type(tempo, '72');
    await user.click(screen.getByRole('button', { name: 'Set tempo' }));
    expect(store.getState().score.measures[1]!.tempoBpm).toBe(72);
    await user.click(screen.getByRole('button', { name: 'Append' }));
    expect(store.getState().score.measures).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Delete measure' }));
    expect(store.getState().score.measures).toHaveLength(5);
  });

  it('lists out-of-range notes with a text message', () => {
    const base = createScore({ measures: 2, instruments: ['guitar-steel'] });
    const score = putEvent({
      staffId: base.parts[0]!.staves[0]!.id,
      measure: 1,
      tick: 0,
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('C', 3)] }, // sounds C2
    }).apply(base);
    render(<EditorLayout store={new EditorStore(score)} />);
    expect(
      screen.getByText(/Measure 2: C2 is outside the range of Steel-string guitar \(E2 to C6\)/),
    ).toBeInTheDocument();
  });
});

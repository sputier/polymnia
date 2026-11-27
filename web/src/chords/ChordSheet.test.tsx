import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChordNaming, setChordNaming } from '../engraving/chordNaming';
import { resetLanguage } from '../i18n/i18n';
import { createScore, parseChord, setChord } from '../score';
import type { Score } from '../score';
import { ChordSheet } from './ChordSheet';

function scoreWith(
  instruments: string[],
  list: readonly (readonly [number, number, string])[],
  measures = 6,
): Score {
  let out = createScore({ measures, instruments });
  const staffId = out.parts[0]!.staves[0]!.id;
  for (const [measure, tick, text] of list)
    out = setChord({ staffId, measure, tick, chord: parseChord(text)! }).apply(out);
  return out;
}

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  localStorage.clear();
  resetLanguage();
  resetChordNaming();
});
afterEach(() => vi.restoreAllMocks());

describe('ChordSheet', () => {
  const score = scoreWith(
    ['guitar-steel'],
    [
      [0, 0, 'C'],
      [1, 0, 'C'],
      [2, 0, 'Am7'],
      [2, 1920, 'G'],
      [3, 0, 'F'],
      [4, 0, 'G7'],
    ],
  );

  it('is a table of rows of four measures, a cell per measure', () => {
    render(<ChordSheet score={score} onMeasure={() => {}} />);
    const table = screen.getByRole('table', { name: /Chord sheet, 6 measures/ });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole('button')).toHaveLength(4);
    expect(within(rows[1]!).getAllByRole('button')).toHaveLength(2);
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('5');
  });

  it('labels the cells: chords, beats of a split measure, repeats and empty measures', () => {
    render(<ChordSheet score={score} onMeasure={() => {}} />);
    expect(screen.getByRole('button', { name: 'Measure 1: C' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Measure 2: same as the previous measure, C' }),
    ).toHaveTextContent('%');
    expect(
      screen.getByRole('button', { name: 'Measure 3: Am7 on beat 1, G on beat 3' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Measure 6: no chord' })).toBeInTheDocument();
  });

  it('goes back to the score at the chosen measure', async () => {
    const onMeasure = vi.fn();
    render(<ChordSheet score={score} onMeasure={onMeasure} />);
    await userEvent.click(screen.getByRole('button', { name: /^Measure 4: F/ }));
    expect(onMeasure).toHaveBeenCalledWith(3);
  });

  it('follows the chord naming option', () => {
    setChordNaming('solfege');
    render(<ChordSheet score={score} onMeasure={() => {}} />);
    expect(screen.getByRole('button', { name: 'Measure 1: Do' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Measure 3: Lam7 au temps|Lam7 on beat 1/ }),
    ).toBeInTheDocument();
  });

  it('shows the diagrams of the chords used, once each, for a guitar part', async () => {
    render(<ChordSheet score={score} onMeasure={() => {}} />);
    const heading = screen.getByRole('heading', { name: 'Chord diagrams' });
    expect(heading).toBeInTheDocument();
    const list = await screen.findByRole('list');
    const figures = within(list).getAllByRole('figure');
    expect(figures.map((f) => f.getAttribute('data-chord'))).toEqual(['C', 'Am7', 'G', 'F', 'G7']);
    expect(within(figures[0]!).getByRole('img')).toHaveAttribute('data-frets', '0,1,0,2,3,-1');
  });

  it('lets the player pick the part when several have strings', async () => {
    const two = createScore({ measures: 2, instruments: ['guitar-steel', 'ukulele-concert'] });
    const staffId = two.parts[0]!.staves[0]!.id;
    const s = setChord({ staffId, measure: 0, tick: 0, chord: parseChord('C')! }).apply(two);
    const onPartChange = vi.fn();
    render(<ChordSheet score={s} onMeasure={() => {}} onPartChange={onPartChange} />);
    const select = screen.getByRole('combobox', { name: 'Instrument' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    await userEvent.selectOptions(select, s.parts[1]!.id);
    expect(onPartChange).toHaveBeenCalledWith(s.parts[1]!.id);
  });

  it('has no diagrams for a piano, and says when there is no chord at all', () => {
    const piano = scoreWith(['piano'], [[0, 0, 'C']]);
    const { unmount } = render(<ChordSheet score={piano} onMeasure={() => {}} />);
    expect(screen.queryByRole('heading', { name: 'Chord diagrams' })).toBeNull();
    unmount();
    render(
      <ChordSheet
        score={createScore({ measures: 2, instruments: ['piano'] })}
        onMeasure={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('no chord symbols');
  });
});

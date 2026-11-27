import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguage } from '../i18n/i18n';

// The engraver (VexFlow) is covered by ScoreView.test.tsx and the browser tests.
vi.mock('../engraving/ScoreView', () => ({ ScoreView: () => <div data-testid="score-view" /> }));
import { EditorLayout } from './EditorLayout';
import { resetUiMode, setUiMode, UI_MODE_STORAGE_KEY } from './uiMode';

function mockMedia(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  resetLanguage();
  mockMedia(false);
  setUiMode('simple');
  localStorage.clear();
  resetUiMode();
});

describe('EditorLayout', () => {
  it('renders landmarks and the status bar', async () => {
    const user = userEvent.setup();
    render(<EditorLayout saveState="saving" />);
    // Note input, then five quarter notes: measure 2, beat 2.
    await user.keyboard('n5cdefg');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Editor status' })).toBeInTheDocument();
    expect(screen.getByText('NOTE INPUT')).toBeInTheDocument();
    expect(screen.getByText('M2 · B2')).toBeInTheDocument();
    expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0);
  });

  it('toggles the instruments panel by button and Ctrl+B', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const toggle = screen.getByRole('button', { name: 'Instruments panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Control>}b{/Control}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the inspector only in Advanced mode and toggles it with Ctrl+I', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    expect(screen.queryByRole('button', { name: 'Inspector panel' })).toBeNull();
    expect(screen.getByText('Need more tools? Switch to Advanced mode')).toBeInTheDocument();

    await user.keyboard('{Alt>}a{/Alt}');
    const toggle = screen.getByRole('button', { name: 'Inspector panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Need more tools? Switch to Advanced mode')).toBeNull();

    await user.keyboard('{Control>}i{/Control}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('persists the Simple/Advanced choice and exposes it with aria-pressed', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveAttribute('aria-pressed', 'false');

    await user.click(advanced);
    expect(advanced).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(UI_MODE_STORAGE_KEY)).toBe('advanced');
  });

  it('keeps working when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<EditorLayout />);
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not fire shortcuts while typing in the title field', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    await user.click(screen.getByRole('textbox', { name: 'Score title' }));
    await user.keyboard('{Control>}b{/Control}{Alt>}a{/Alt}');
    expect(screen.getByRole('button', { name: 'Instruments panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows panels as closable overlays on narrow screens and closes them with Escape', async () => {
    mockMedia(true);
    const user = userEvent.setup();
    render(<EditorLayout />);
    const toggle = screen.getByRole('button', { name: 'Instruments panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('switches between the score and the chord sheet, and a measure takes back to the score (#60)', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    expect(screen.getByTestId('score-view')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'View' });
    await user.click(within(group).getByRole('button', { name: 'Chord sheet' }));
    expect(await screen.findByRole('table', { name: /Chord sheet/ })).toBeInTheDocument();
    expect(screen.queryByTestId('score-view')).toBeNull();
    // The export menu offers the sheet.
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menuitem', { name: 'Chord sheet (PDF)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Chord sheet (PNG)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /^Measure 2:/ }));
    expect(screen.getByTestId('score-view')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Score' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.queryByRole('menuitem', { name: 'Chord sheet (PDF)' })).toBeNull();
  });

  it('Alt+V toggles the chord sheet (#60)', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    await user.keyboard('{Alt>}v{/Alt}');
    expect(await screen.findByRole('table', { name: /Chord sheet/ })).toBeInTheDocument();
    await user.keyboard('{Alt>}v{/Alt}');
    expect(screen.getByTestId('score-view')).toBeInTheDocument();
  });

  it('is translated to French', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr']);
    resetLanguage();
    render(<EditorLayout />);
    expect(screen.getByText('SÉLECTION')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avancé' })).toBeInTheDocument();
  });
});

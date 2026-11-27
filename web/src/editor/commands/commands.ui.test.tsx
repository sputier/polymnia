import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguage, setLanguage } from '../../i18n/i18n';
import { parseCombo, shortcuts } from '../../shortcuts/registry';

// The engraver (VexFlow) is covered by ScoreView.test.tsx and the browser tests.
vi.mock('../../engraving/ScoreView', () => ({ ScoreView: () => <div data-testid="score-view" /> }));
import { EditorLayout } from '../EditorLayout';
import { resetUiMode, setUiMode } from '../uiMode';

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
  localStorage.clear();
  resetLanguage();
  mockMedia(false);
  setUiMode('simple');
  resetUiMode();
});

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}');
  return screen.findByRole('combobox', { name: 'Search commands' });
}

describe('registry', () => {
  it('has no two shortcuts on the same key combo, and Ctrl+K belongs to the palette', async () => {
    render(<EditorLayout />);
    const list = shortcuts.list();
    const combos = list.filter((s) => s.keys).map((s) => JSON.stringify(parseCombo(s.keys)));
    const duplicates = combos.filter((c, i) => combos.indexOf(c) !== i);
    expect(duplicates).toEqual([]);
    expect(list.filter((s) => s.keys === 'Mod+K').map((s) => s.id)).toEqual(['app.palette']);
  });
});

describe('command palette', () => {
  it('opens with Ctrl+K as a combobox over a listbox, and Esc gives the focus back', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const trigger = screen.getByRole('button', { name: 'Open the command palette' });
    trigger.focus();
    const input = await openPalette(user);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(10);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('finds a command by its French or English name and runs it with Enter', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const input = await openPalette(user);
    await user.type(input, 'silence');
    const option = screen.getByRole('option', { selected: true });
    expect(option).toHaveTextContent('Enter a rest');
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    await user.clear(input);
    await user.type(input, 'rest');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Enter a rest');
    // Run a visible effect: Advanced mode shows the inspector toggle.
    await user.clear(input);
    await user.type(input, 'simple advanced');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Inspector panel' })).toBeVisible(),
    );
  });

  it('moves with the arrows, skips disabled commands and shows them disabled', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const input = await openPalette(user);
    const undo = screen.getByRole('option', { name: /^Undo/ });
    expect(undo).toHaveAttribute('aria-disabled', 'true');
    const first = screen.getByRole('option', { selected: true });
    await user.keyboard('{ArrowDown}');
    const second = screen.getByRole('option', { selected: true });
    expect(second).not.toBe(first);
    expect(input).toHaveAttribute('aria-activedescendant', second.id);
    await user.type(input, 'undo');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lists recently used commands first on the next opening', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const input = await openPalette(user);
    await user.type(input, 'dot');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openPalette(user);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Toggle the augmentation dot');
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('is labelled in French when the interface is French', async () => {
    setLanguage('fr');
    const user = userEvent.setup();
    render(<EditorLayout />);
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Rechercher une commande' });
    await user.type(input, 'rest');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Saisir un silence');
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    const input = await openPalette(user);
    await user.tab();
    expect(input).toHaveFocus();
  });

  it('does not let note keys through while it is open', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    await openPalette(user);
    await user.keyboard('n');
    expect(screen.queryByText('NOTE INPUT')).toBeNull();
  });
});

describe('focus mode', () => {
  it('hides the chrome with Alt+F and Esc brings it back', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    expect(screen.getByRole('banner')).toBeVisible();
    await user.keyboard('{Alt>}f{/Alt}');
    const pill = screen.getByText('Focus mode').closest<HTMLElement>('.focus-pill')!;
    expect(within(pill).getByText('Focus mode')).toBeInTheDocument();
    expect(document.querySelector('.editor')).toHaveAttribute('data-focus');
    await user.keyboard('{Escape}');
    expect(document.querySelector('.editor')).not.toHaveAttribute('data-focus');
    expect(screen.queryByText('Focus mode')).toBeNull();
  });
});

describe('cheat sheet', () => {
  it('opens with ? and lists the registry by group', async () => {
    const user = userEvent.setup();
    render(<EditorLayout />);
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const group of ['Note input', 'Edit', 'Navigation', 'View', 'Help']) {
      expect(within(dialog).getByRole('heading', { name: group })).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Enter a rest')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Print' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

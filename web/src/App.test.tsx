import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { LANGUAGE_STORAGE_KEY, resetLanguage } from './i18n/i18n';
import { THEME_STORAGE_KEY } from './theme/theme';

describe('App', () => {
  it('switches language at runtime without reload and remembers it', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
    resetLanguage();
    render(<App />);
    expect(screen.getByText('Compose music in your browser.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /FR/ }));

    expect(screen.getByText('Composez de la musique dans votre navigateur.')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
    expect(screen.getByRole('button', { name: /FR/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches theme at runtime and remembers it', async () => {
    document.documentElement.dataset.theme = 'light';
    resetLanguage();
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /dark theme|thème sombre/i }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('still switches theme when storage is unavailable', async () => {
    document.documentElement.dataset.theme = 'light';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /dark theme|thème sombre/i }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

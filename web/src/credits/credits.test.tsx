import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguage, setLanguage } from '../i18n/i18n';
import { SAMPLE_SET_IDS } from '../playback/instrumentSets';
import CreditsDialog from './CreditsDialog';
import { CREDITS_TEXT, SAMPLE_CREDITS, VOICE_ATTRIBUTION } from './content';

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  resetLanguage();
});

describe('credits content', () => {
  it('lists every sample set, once', () => {
    expect(SAMPLE_CREDITS.map((c) => c.id).sort()).toEqual([...SAMPLE_SET_IDS].sort());
  });

  it('gives every set an author, a license and a source link, and no e-mail address', () => {
    for (const credit of SAMPLE_CREDITS) {
      expect(credit.author, credit.id).not.toBe('');
      expect(credit.license.url, credit.id).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(credit.source, credit.id).toMatch(/^https:\/\//);
      expect(JSON.stringify(credit), credit.id).not.toMatch(/@/);
    }
  });

  it('only uses licenses that need no more than an attribution (CC0, CC BY)', () => {
    for (const credit of SAMPLE_CREDITS)
      expect(['CC0 1.0', 'CC BY 4.0']).toContain(credit.license.name);
  });

  it('is in step with THIRD_PARTY_NOTICES.md', () => {
    const notices = readFileSync(resolve(process.cwd(), '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const credit of SAMPLE_CREDITS) {
      expect(notices, credit.id).toContain(`\`${credit.id}\``);
      expect(notices, credit.id).toContain(credit.source.replace(/\/$/, ''));
    }
    expect(notices).toContain(VOICE_ATTRIBUTION);
  });
});

describe('credits dialog', () => {
  it('shows each set with author and license, and the CC BY attribution', () => {
    render(<CreditsDialog onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'About and credits' });
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(SAMPLE_CREDITS.length);
    const voice = within(dialog).getByRole('row', { name: /Voice/ });
    expect(voice).toHaveTextContent('VocalSet');
    expect(within(voice).getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(dialog).toHaveTextContent(VOICE_ATTRIBUTION);
    expect(dialog).toHaveTextContent(CREDITS_TEXT.en.changes);
    for (const link of within(dialog).getAllByRole('link'))
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('speaks French', async () => {
    await setLanguage('fr');
    render(<CreditsDialog onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'À propos et crédits' });
    expect(within(dialog).getByRole('row', { name: /Violoncelle/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(VOICE_ATTRIBUTION);
  });

  it('closes with the button and with Escape', async () => {
    const onClose = vi.fn();
    render(<CreditsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

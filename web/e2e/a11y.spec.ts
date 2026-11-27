import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { emptyScoreDoc, FakeApi } from './fake-api';

// Accessibility audit (#19, docs/accessibility.md): axe on every screen and main state, in both themes and both
// languages. Light + English and dark + French cover the four combinations of the matrix pairwise (the contrast
// is what changes with the theme, the names and the lengths with the language).
const COMBOS = [
  { name: 'light-en', colorScheme: 'light', locale: 'en-US' },
  { name: 'dark-fr', colorScheme: 'dark', locale: 'fr-FR' },
] as const;

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Zero violation of any impact: serious and critical are the gate, moderate and minor are fixed too. */
async function audit(page: Page, label: string) {
  // Dialogs fade in: a color measured halfway through the animation is not the resting color.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `    ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`)
        .join('\n'),
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

const legal = {
  configured: true,
  operatorName: 'Example Operator',
  contact: 'privacy@polymnia.example',
  contactKind: 'email',
  address: null,
  hostingProvider: 'Example Hosting',
  hostingCountry: 'Exampleland',
  logRetentionDays: 14,
  sessionIdleDays: 7,
  sessionAbsoluteDays: 30,
};

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
}

async function setup(page: Page, fake: FakeApi, hash: string) {
  await mockSignedIn(page);
  await mockAudio(page);
  await page.route('**/api/legal', (route) => route.fulfill({ json: legal }));
  await fake.install(page);
  await page.goto(`/#${hash}`);
}

async function openEditor(page: Page) {
  await mockSignedIn(page);
  await mockAudio(page);
  await page.goto('/#/editor');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!window.__polymnia?.store);
  await page.evaluate(() => document.fonts.ready);
}

for (const combo of COMBOS) {
  test.describe(`axe, ${combo.name}`, () => {
    test.use({
      locale: combo.locale,
      colorScheme: combo.colorScheme,
      viewport: { width: 1280, height: 900 },
    });

    test('sign-in and privacy (signed out)', async ({ page }) => {
      await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
      await page.route('**/api/legal', (route) => route.fulfill({ json: legal }));
      await page.goto('/');
      await expect(page.getByRole('main')).toBeVisible();
      await audit(page, 'sign-in');
      await page.goto('/#/privacy');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'privacy');
    });

    test('contact form, plain and prefilled to report a shared page', async ({ page }) => {
      await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
      await page.route('**/api/legal', (route) => route.fulfill({ json: legal }));
      await page.route('**/api/contact/form-token', (route) =>
        route.fulfill({ json: { token: 'form-token', minFillSeconds: 0 } }),
      );
      await page.goto('/#/contact');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'contact');
      await page.goto('/#/contact?topic=report&page=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'contact, report');
    });

    test('library: empty', async ({ page }) => {
      await setup(page, new FakeApi(), '/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'library, empty');
    });

    test('library: filled, menus, dialogs', async ({ page }) => {
      const fake = new FakeApi();
      fake.add('Old piece', emptyScoreDoc('Old piece', { measures: 12 }));
      fake.add('Duo', emptyScoreDoc('Duo', { measures: 1, instruments: ['violin', 'cello'] }));
      await setup(page, fake, '/');
      await expect(page.getByRole('listitem').first()).toBeVisible();
      await audit(page, 'library, filled');
      await page.locator('li [aria-haspopup="menu"]').first().click();
      await expect(page.getByRole('menu')).toBeVisible();
      await audit(page, 'library, card menu');
      await page.keyboard.press('Escape');
      await page.locator('.account-trigger').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await audit(page, 'library, account menu');
      await page.getByRole('menuitem').last().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'delete-account dialog');
      await page.keyboard.press('Escape');
      await page.locator('.toolbar-actions .btn.primary').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'new-score dialog');
    });

    test('editor: Simple, Advanced with panels, piano, chord field, focus mode', async ({
      page,
    }) => {
      await openEditor(page);
      await audit(page, 'editor, simple');
      await page.keyboard.press('Alt+a');
      await expect(page.locator('#panel-inspector')).toBeVisible();
      await audit(page, 'editor, advanced with inspector');
      await page.keyboard.press('p');
      await expect(page.locator('.pianobar')).toBeVisible();
      await audit(page, 'editor, piano');
      await page.keyboard.press('p');
      await page.keyboard.press('Alt+k');
      await expect(page.locator('.chord-entry input')).toBeVisible();
      await audit(page, 'editor, chord entry');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Alt+f');
      await expect(page.locator('.focus-pill')).toBeVisible();
      await audit(page, 'editor, focus mode');
    });

    test('editor dialogs: palette, cheat sheet, credits', async ({ page }) => {
      await openEditor(page);
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'command palette');
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'cheat sheet');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /About and credits|À propos/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'credits');
    });

    test('score: export menu, share, chord sheet, viewer', async ({ browser, page }) => {
      const fake = new FakeApi();
      const id = fake.add('Shared sonata', emptyScoreDoc('Shared sonata', { measures: 4 }));
      await setup(page, fake, `/scores/${id}`);
      await expect(page.locator('svg.pm-score')).toBeVisible();
      await page.getByRole('button', { name: /^(Export|Exporter)$/ }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await audit(page, 'export menu');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^(Share|Partager)$/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await audit(page, 'share dialog, not shared');
      await dialog.locator('button.primary, button.btn.primary').first().click();
      const link = dialog.locator('input[readonly]').first();
      await expect(link).toBeVisible();
      const url = await link.inputValue();
      await audit(page, 'share dialog, shared');
      await page.keyboard.press('Escape');
      await page
        .getByRole('group', { name: /^(View|Affichage)$/ })
        .getByRole('button')
        .last()
        .click();
      await expect(page.getByRole('table')).toBeVisible();
      await audit(page, 'chord sheet view');

      const visitorContext = await browser.newContext({
        locale: combo.locale,
        colorScheme: combo.colorScheme,
      });
      const visitor = await visitorContext.newPage();
      await mockAudio(visitor);
      await fake.install(visitor);
      await visitor.goto(url);
      await expect(visitor.locator('svg.pm-score')).toBeVisible();
      await audit(visitor, 'shared viewer');
      await visitorContext.close();
    });
  });
}

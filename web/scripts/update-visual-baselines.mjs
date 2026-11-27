// Regenerates (or checks) the Playwright visual baselines inside the official Playwright Docker
// image, so they match what CI renders on Linux. Needs Docker. Usage, from web/:
//   npm run test:visual:update   regenerate e2e/__screenshots__/
//   npm run test:visual:docker   run the visual tests against the committed baselines
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(web, '..'); // the schema/ folder next to web/ is imported by the tests
const { version } = JSON.parse(
  readFileSync(join(web, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'),
);
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const update = process.argv.includes('--update');

// node_modules and dist stay inside the container (anonymous volumes): the host ones are for
// another OS. Only e2e/ (screenshots) is written back to the host.
const script = [
  'set -e',
  'npm ci --no-audit --no-fund',
  `npx playwright test e2e/visual --project=chromium ${update ? '--update-snapshots=all' : ''}`,
].join(' && ');

const args = [
  'run',
  '--rm',
  '--ipc=host',
  '-v',
  `${root}:/repo`,
  '-v',
  '/repo/web/node_modules',
  '-v',
  '/repo/web/dist',
  '-w',
  '/repo/web',
  '-e',
  'CI=',
  image,
  'bash',
  '-c',
  script,
];
console.log(`docker ${args.join(' ')}`);
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);

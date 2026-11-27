// Fails when the initial JavaScript (what index.html loads on the first screen)
// exceeds the budget. Lazy chunks (VexFlow, Tone.js, ...) are not counted.
// Usage: npm run build && npm run size
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 150;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

let html;
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  console.error('dist/index.html not found. Run `npm run build` first.');
  process.exit(2);
}

const initial = new Set();
for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  const tag = match[0];
  const isScript = tag.startsWith('<script') && /type="module"/.test(tag);
  const isPreload = /rel="modulepreload"/.test(tag);
  if (!isScript && !isPreload) continue;
  const ref = /(?:src|href)="([^"]+)"/.exec(tag)?.[1];
  if (ref?.startsWith('/assets/') && ref.endsWith('.js')) initial.add(ref);
}

const gzipKb = (file) => gzipSync(readFileSync(file), { level: 9 }).length / 1024;

let totalJs = 0;
for (const ref of initial) {
  const kb = gzipKb(join(dist, ref));
  totalJs += kb;
  console.log(`  js   ${ref.padEnd(40)} ${kb.toFixed(1)} KB gzip`);
}

const assets = join(dist, 'assets');
const lazy = readdirSync(assets).filter(
  (f) => f.endsWith('.js') && !initial.has(`/assets/${f}`) && statSync(join(assets, f)).isFile(),
);
for (const f of lazy)
  console.log(`  lazy ${f.padEnd(40)} ${gzipKb(join(assets, f)).toFixed(1)} KB gzip`);

const css = readdirSync(assets)
  .filter((f) => f.endsWith('.css'))
  .reduce((sum, f) => sum + gzipKb(join(assets, f)), 0);
console.log(`  css  total ${css.toFixed(1)} KB gzip`);

console.log(`Initial JS: ${totalJs.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (totalJs > BUDGET_KB) {
  console.error(`Over budget by ${(totalJs - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}

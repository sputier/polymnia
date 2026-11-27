// Fails when a budget is exceeded: the initial JavaScript (what index.html loads on the first
// screen), the editor chunk (VexFlow + engraving, lazy, fonts excluded) and the Bravura font file.
// Other lazy chunks (Tone.js, ...) are reported but not budgeted. Also fails when a font is
// embedded as a data URL in a JavaScript chunk (the CSP only allows same-origin font files).
// Usage: npm run build && npm run size
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 150;
const EDITOR_BUDGET_KB = 200; // gzip, the chunk that holds VexFlow (#33)
const BRAVURA_BUDGET_KB = 250; // woff2 bytes as served (1 KB = 1000 bytes)
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

let html;
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  console.error('dist/index.html not found. Run `npm run build` first.');
  process.exit(2);
}

let failed = false;
const fail = (message) => {
  console.error(message);
  failed = true;
};

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
const files = readdirSync(assets).filter((f) => statSync(join(assets, f)).isFile());
const lazy = files.filter((f) => f.endsWith('.js') && !initial.has(`/assets/${f}`));

let editorKb = 0;
for (const f of lazy) {
  const file = join(assets, f);
  const kb = gzipKb(file);
  const isEditor = readFileSync(file, 'utf8').includes('vexflow-core');
  if (isEditor) editorKb += kb;
  console.log(`  lazy ${f.padEnd(40)} ${kb.toFixed(1)} KB gzip${isEditor ? '  (editor)' : ''}`);
}

const embeddedFont = /data:(?:font|application\/(?:font|x-font)[\w-]*)[^"'`]{0,40}base64,/;
for (const f of files.filter((name) => name.endsWith('.js'))) {
  if (embeddedFont.test(readFileSync(join(assets, f), 'utf8')))
    fail(`${f} embeds a font as a data URL: ship fonts as separate hashed files.`);
}

const bravura = files.filter((f) => /^bravura-.+\.woff2$/i.test(f));
if (bravura.length !== 1)
  fail(`Expected exactly one hashed Bravura woff2 in assets, found ${bravura.length}.`);
for (const f of bravura) {
  const kb = statSync(join(assets, f)).size / 1000;
  console.log(`  font ${f.padEnd(40)} ${kb.toFixed(1)} KB woff2`);
  if (kb > BRAVURA_BUDGET_KB)
    fail(
      `${f} is over its budget (${BRAVURA_BUDGET_KB} KB) by ${(kb - BRAVURA_BUDGET_KB).toFixed(1)} KB.`,
    );
}

const css = files
  .filter((f) => f.endsWith('.css'))
  .reduce((sum, f) => sum + gzipKb(join(assets, f)), 0);
console.log(`  css  total ${css.toFixed(1)} KB gzip`);

console.log(`Initial JS: ${totalJs.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (totalJs > BUDGET_KB) fail(`Initial JS over budget by ${(totalJs - BUDGET_KB).toFixed(1)} KB.`);
console.log(`Editor chunk: ${editorKb.toFixed(1)} KB gzip (budget ${EDITOR_BUDGET_KB} KB)`);
if (editorKb === 0) fail('Editor chunk (VexFlow) not found: update this script.');
if (editorKb > EDITOR_BUDGET_KB)
  fail(`Editor chunk over budget by ${(editorKb - EDITOR_BUDGET_KB).toFixed(1)} KB.`);
console.log(`Bravura: budget ${BRAVURA_BUDGET_KB} KB woff2`);
if (failed) process.exit(1);

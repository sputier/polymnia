// Fails when a budget is exceeded: the initial JavaScript (what index.html loads on the first
// screen), the editor chunk (VexFlow + engraving, lazy, fonts excluded) and the Bravura font file.
// The export chunk (MIDI, PDF, PNG; lazy, with the Bravura outlines) is budgeted too.
// The playback chunk (Tone.js + audio engine, lazy) and the sample files are budgeted too. Also fails when a font is
// embedded as a data URL in a JavaScript chunk (the CSP only allows same-origin font files).
// Usage: npm run build && npm run size
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 150;
const EDITOR_BUDGET_KB = 200; // gzip, the chunk that holds VexFlow (#33)
const PLAYBACK_BUDGET_KB = 80; // gzip, the chunk that holds Tone.js (#10)
const EXPORT_BUDGET_KB = 70; // gzip, the chunk with MIDI, PDF and PNG export (#14)
const SAMPLES_BUDGET_KB = 3000; // all sample files together, as served (Ogg Opus)
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
let playbackKb = 0;
let exportKb = 0;
for (const f of lazy) {
  const file = join(assets, f);
  const kb = gzipKb(file);
  const text = readFileSync(file, 'utf8');
  const isEditor = text.includes('vexflow-core');
  const isPlayback = text.includes('ToneAudioBuffer');
  if (isEditor) editorKb += kb;
  const isExport = text.includes('midi-staff-over-15-channels');
  if (isPlayback) playbackKb += kb;
  if (isExport) exportKb += kb;
  console.log(
    `  lazy ${f.padEnd(40)} ${kb.toFixed(1)} KB gzip${isEditor ? '  (editor)' : ''}${isPlayback ? '  (playback)' : ''}${isExport ? '  (export)' : ''}`,
  );
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

const samples = files.filter((f) => f.endsWith('.ogg'));
const samplesKb = samples.reduce((sum, f) => sum + statSync(join(assets, f)).size / 1000, 0);
console.log(
  `  samples ${samples.length} files, ${samplesKb.toFixed(0)} KB (budget ${SAMPLES_BUDGET_KB} KB)`,
);
if (samples.length === 0)
  fail('No .ogg sample in assets: the samples must be separate hashed files.');
if (samplesKb > SAMPLES_BUDGET_KB)
  fail(`Samples over budget by ${(samplesKb - SAMPLES_BUDGET_KB).toFixed(0)} KB.`);

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
console.log(`Playback chunk: ${playbackKb.toFixed(1)} KB gzip (budget ${PLAYBACK_BUDGET_KB} KB)`);
if (playbackKb === 0) fail('Playback chunk (Tone.js) not found: update this script.');
if (playbackKb > PLAYBACK_BUDGET_KB)
  fail(`Playback chunk over budget by ${(playbackKb - PLAYBACK_BUDGET_KB).toFixed(1)} KB.`);
console.log(`Export chunk: ${exportKb.toFixed(1)} KB gzip (budget ${EXPORT_BUDGET_KB} KB)`);
if (exportKb === 0) fail('Export chunk (MIDI, PDF, PNG) not found: update this script.');
if (exportKb > EXPORT_BUDGET_KB)
  fail(`Export chunk over budget by ${(exportKb - EXPORT_BUDGET_KB).toFixed(1)} KB.`);
console.log(`Bravura: budget ${BRAVURA_BUDGET_KB} KB woff2`);
if (failed) process.exit(1);

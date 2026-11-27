// Prints the biggest modules of the initial JavaScript (what index.html loads), from the stats that
// `npm run build:report` writes to dist/stats.json (rollup-plugin-visualizer, raw-data template).
// Usage: npm run build:report && npm run size:report [-- <chunk name fragment>] [--top=25]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let stats;
try {
  stats = JSON.parse(readFileSync(join(dist, 'stats.json'), 'utf8'));
} catch {
  console.error('dist/stats.json not found. Run `npm run build:report` first.');
  process.exit(2);
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = new Set(
  [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]),
);
const args = process.argv.slice(2);
const top = Number(args.find((a) => a.startsWith('--top='))?.slice(6) ?? 25);
const fragment = args.find((a) => !a.startsWith('--'));

const leaves = (node, path = []) =>
  node.children
    ? node.children.flatMap((child) => leaves(child, [...path, node.name]))
    : [{ name: [...path, node.name].join('/'), uid: node.uid }];

for (const chunk of stats.tree.children) {
  const selected = fragment ? chunk.name.includes(fragment) : initial.has(chunk.name);
  if (!selected) continue;
  const rows = leaves(chunk)
    .map((leaf) => {
      const part = stats.nodeParts[leaf.uid];
      return {
        name: leaf.name.replace(/^.*?\/web\//, '').replace(/^[^/]*\//, ''),
        gzip: (part?.gzipLength ?? 0) / 1024,
        raw: (part?.renderedLength ?? 0) / 1024,
      };
    })
    .sort((a, b) => b.gzip - a.gzip);
  const total = rows.reduce((sum, r) => sum + r.gzip, 0);
  console.log(`\n${chunk.name}  (sum of per-module gzip: ${total.toFixed(1)} KB)`);
  for (const r of rows.slice(0, top))
    console.log(
      `  ${r.gzip.toFixed(1).padStart(6)} KB gzip ${r.raw.toFixed(1).padStart(7)} KB raw  ${r.name}`,
    );
}

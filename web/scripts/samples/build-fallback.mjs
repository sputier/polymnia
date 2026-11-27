/* global OfflineAudioContext */
// Builds the AAC (.m4a) fallback of the Ogg Opus samples, for browsers whose Web Audio cannot decode Ogg Opus
// (Safari before 26). Developer tool only, never part of the app build. See docs/playback.md, "Safari".
//
//   node scripts/samples/build-fallback.mjs [set id...]
//
// Every shipped .ogg is decoded by the Chromium of Playwright, written as a 16-bit mono WAV in a temporary folder,
// then encoded to AAC-LC by the Windows Media Foundation encoder (`aac-encode.ps1`, Windows PowerShell). Chromium's
// WebCodecs cannot encode AAC, and no other AAC encoder is available to the project. The fallback is therefore
// derived from the Opus files (a second lossy generation, at 48 kbps: fine for a fallback), not from the originals,
// so it never needs the original recordings and always matches what is shipped.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

if (process.platform !== 'win32') {
  console.error('The AAC encoder used by this tool (Windows Media Foundation) needs Windows.');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, '..', '..', 'src', 'playback', 'samples');
const only = new Set(process.argv.slice(2));
const sets = readdirSync(samples).filter(
  (s) => statSync(join(samples, s)).isDirectory() && (only.size === 0 || only.has(s)),
);

const work = mkdtempSync(join(tmpdir(), 'polymnia-aac-'));

function wav16(pcm, rate) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('http://localhost/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>decode</title>' }),
  );
  await page.goto('http://localhost/');
  for (const set of sets) {
    const dir = join(samples, set);
    const wavDir = join(work, set);
    mkdirSync(wavDir, { recursive: true });
    for (const f of readdirSync(dir).filter((name) => name.endsWith('.ogg'))) {
      const b64 = readFileSync(join(dir, f)).toString('base64');
      const pcmB64 = await page.evaluate(async (data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.buffer);
        const x = decoded.getChannelData(0);
        const out = new Int16Array(x.length);
        for (let i = 0; i < x.length; i++)
          out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
        const raw = new Uint8Array(out.buffer);
        let text = '';
        for (let i = 0; i < raw.length; i += 8192)
          text += String.fromCharCode(...raw.subarray(i, i + 8192));
        return btoa(text);
      }, b64);
      writeFileSync(
        join(wavDir, f.replace(/\.ogg$/, '.wav')),
        wav16(Buffer.from(pcmB64, 'base64'), 48000),
      );
    }
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(here, 'aac-encode.ps1'),
        '-In',
        wavDir,
        '-Out',
        dir,
      ],
      { stdio: 'inherit' },
    );
    const files = readdirSync(dir).filter((name) => name.endsWith('.m4a'));
    const kb = files.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0) / 1000;
    console.log(`== ${set}: ${files.length} .m4a, ${kb.toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

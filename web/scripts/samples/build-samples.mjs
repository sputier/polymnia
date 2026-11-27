/* global OfflineAudioContext, AudioEncoder, AudioData */
// Builds the Ogg Opus samples shipped in src/playback/samples/ from the original recordings.
// Developer tool only (never part of the app build). See docs/playback.md, "Adding an instrument".
//
//   SAMPLES_SRC=<folder with the downloaded originals> node scripts/samples/build-samples.mjs [id...]
//
// Each original (WAV or FLAC) is decoded, mixed to mono, trimmed, faded, normalized and encoded to
// Opus by Chromium's WebCodecs (the Playwright browser the project already uses), then wrapped in an
// Ogg container here. It also measures the pitch of every sample and prints the deviation from the
// note it is filed under: a wrong octave or a detuned file shows up immediately.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { SETS } from './sets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outRoot = join(root, 'src', 'playback', 'samples');
const src = process.env.SAMPLES_SRC;
if (!src) {
  console.error('Set SAMPLES_SRC to the folder holding the original recordings.');
  process.exit(2);
}
const only = new Set(process.argv.slice(2));

// ---- Ogg Opus muxing -------------------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0;
  for (const b of buf) c = ((c << 8) ^ CRC[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c >>> 0;
}
function oggPage(serial, seq, flags, granule, packets, lastContinues = false) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error('page too large');
  const body = Buffer.concat(packets);
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0, 'latin1');
  header[4] = 0;
  header[5] = flags;
  header.writeBigUInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(seq, 18);
  header.writeUInt32LE(0, 22);
  header[26] = lacing.length;
  Buffer.from(lacing).copy(header, 27);
  const page = Buffer.concat([header, body]);
  page.writeUInt32LE(crc32(page), 22);
  void lastContinues;
  return page;
}
function muxOggOpus(packets, totalSamples, preSkip, sampleRate) {
  const serial = 0x504d4e41;
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head[8] = 1;
  head[9] = 1; // mono
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(sampleRate, 12);
  head.writeUInt16LE(0, 16);
  head[18] = 0;
  const vendor = Buffer.from('polymnia');
  const tags = Buffer.concat([Buffer.from('OpusTags'), Buffer.alloc(4), vendor, Buffer.alloc(4)]);
  tags.writeUInt32LE(vendor.length, 8);
  const pages = [oggPage(serial, 0, 2, 0, [head]), oggPage(serial, 1, 0, 0, [tags])];
  let seq = 2;
  const FRAME = 960; // 20 ms at 48 kHz
  for (let i = 0; i < packets.length;) {
    const group = [];
    let lacing = 0;
    while (i < packets.length && lacing + Math.floor(packets[i].length / 255) + 1 <= 250) {
      lacing += Math.floor(packets[i].length / 255) + 1;
      group.push(packets[i++]);
    }
    const last = i >= packets.length;
    const granule = last ? preSkip + totalSamples : preSkip + i * FRAME;
    pages.push(oggPage(serial, seq++, last ? 4 : 0, granule, group));
  }
  return Buffer.concat(pages);
}

// ---- Browser side: decode, process, measure pitch, encode ------------------------------------
async function processInBrowser(page, bytes, opts) {
  return page.evaluate(
    async ({ b64, opts }) => {
      const SR = 48000;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new OfflineAudioContext(1, 1, SR);
      const decoded = await ctx.decodeAudioData(bin.buffer);
      const n = decoded.length;
      const mono = new Float32Array(n);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const d = decoded.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i] / decoded.numberOfChannels;
      }
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
      // Start where the sound starts (a few ms of room before it).
      let start = 0;
      while (start < n && Math.abs(mono[start]) < peak * 0.02) start++;
      start = Math.max(0, start - Math.round(0.004 * SR));
      const maxLen = Math.round(opts.seconds * SR);
      const len = Math.min(n - start, maxLen);
      const out = mono.slice(start, start + len);
      // Fade in 3 ms, fade out the last 0.4 s (or 0.15 s for short samples).
      const fin = Math.round(0.003 * SR);
      for (let i = 0; i < fin && i < len; i++) out[i] *= i / fin;
      const fout = Math.min(Math.round((opts.fadeOut ?? 0.4) * SR), len);
      for (let i = 0; i < fout; i++) out[len - 1 - i] *= (i / fout) * (i / fout);
      // Level: RMS of the first second (loudness matching inside a set), peak limited to 0.95.
      const win = Math.min(len, SR);
      let sum = 0;
      for (let i = 0; i < win; i++) sum += out[i] * out[i];
      const rms = Math.sqrt(sum / win) || 1;
      let gain = opts.targetRms / rms;
      let pk = 0;
      for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i]));
      gain = Math.min(gain, 0.95 / (pk || 1));
      for (let i = 0; i < len; i++) out[i] *= gain;

      // Pitch (autocorrelation on 0.25 s after the attack) -> cents against the filed note.
      const expected = 440 * 2 ** ((opts.midi - 69) / 12);
      const seg = out.subarray(
        Math.min(Math.round(0.15 * SR), Math.max(0, len - 12000)),
        Math.min(Math.round(0.15 * SR) + 12000, len),
      );
      let best = 0;
      let bestLag = 0;
      const minLag = Math.floor(SR / (expected * 2.1));
      const maxLag = Math.ceil(SR / (expected / 2.1));
      const energy = [];
      for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0;
        for (let i = 0; i + lag < seg.length; i += 2) s += seg[i] * seg[i + lag];
        energy.push(s);
        if (s > best) {
          best = s;
          bestLag = lag;
        }
      }
      // Prefer the shortest period that is nearly as strong as the best one (avoids sub-octaves).
      for (let k = 1; k < energy.length - 1; k++) {
        if (energy[k] >= 0.8 * best && energy[k] >= energy[k - 1] && energy[k] >= energy[k + 1]) {
          bestLag = minLag + k;
          break;
        }
      }
      let cents = null;
      if (bestLag) {
        const f = SR / bestLag;
        cents = 1200 * Math.log2(f / expected);
      }

      // Opus encoding, 20 ms frames.
      const packets = [];
      let description;
      const encoder = new AudioEncoder({
        output: (chunk, meta) => {
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          packets.push(Array.from(buf));
          if (meta?.decoderConfig?.description && !description)
            description = Array.from(new Uint8Array(meta.decoderConfig.description));
        },
        error: (e) => {
          throw e;
        },
      });
      encoder.configure({
        codec: 'opus',
        sampleRate: SR,
        numberOfChannels: 1,
        bitrate: opts.bitrate,
        opus: { application: 'audio', frameDuration: 20000, complexity: 10, signal: 'music' },
      });
      const FRAME = 960;
      const frames = Math.ceil(len / FRAME) + 1;
      for (let f = 0; f < frames; f++) {
        const data = new Float32Array(FRAME);
        data.set(out.subarray(f * FRAME, Math.min(len, (f + 1) * FRAME)));
        const ad = new AudioData({
          format: 'f32-planar',
          sampleRate: SR,
          numberOfFrames: FRAME,
          numberOfChannels: 1,
          timestamp: Math.round((f * FRAME * 1e6) / SR),
          data,
        });
        encoder.encode(ad);
        ad.close();
      }
      await encoder.flush();
      return { packets, description, samples: len, cents, gainDb: 20 * Math.log10(gain) };
    },
    { b64: bytes.toString('base64'), opts },
  );
}

const noteMidi = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return (Number(m[3]) + 1) * 12 + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

const browser = await chromium.launch();
const page = await browser.newPage();
// WebCodecs needs a secure context: a fake localhost page served from memory.
await page.route('http://localhost/**', (route) =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>encoder</title>' }),
);
await page.goto('http://localhost/');
let totalBytes = 0;
for (const set of SETS) {
  if (only.size && !only.has(set.id)) continue;
  const dir = join(outRoot, set.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const [note, file] of Object.entries(set.files)) {
    const input = readFileSync(join(src, file));
    const midi = noteMidi(note) + (set.octaveShift ?? 0) * 12;
    const r = await processInBrowser(page, input, {
      midi,
      seconds: set.seconds,
      fadeOut: set.fadeOut,
      bitrate: set.bitrate ?? 40000,
      targetRms: set.rms ?? 0.1,
    });
    const preSkip = r.description ? r.description[10] | (r.description[11] << 8) : 312;
    const ogg = muxOggOpus(
      r.packets.map((p) => Buffer.from(p)),
      r.samples,
      preSkip,
      48000,
    );
    // Files are named after the sounding pitch (sharps written s: a # is a URL fragment in module paths), whatever convention the source used.
    const name = `${'C C# D D# E F F# G G# A A# B'.split(' ')[midi % 12]}${Math.floor(midi / 12) - 1}`;
    writeFileSync(join(dir, `${name.replace('#', 's')}.ogg`), ogg);
    bytes += ogg.length;
    const flag = r.cents === null || Math.abs(r.cents) > 35 ? '  <-- CHECK PITCH' : '';
    console.log(
      `${set.id.padEnd(14)} ${note.padEnd(4)} ${(ogg.length / 1000).toFixed(1).padStart(6)} KB  ${(r.samples / 48000).toFixed(2)} s  ${r.cents === null ? 'n/a' : r.cents.toFixed(0).padStart(5) + ' cents'}${flag}`,
    );
  }
  totalBytes += bytes;
  console.log(
    `== ${set.id}: ${Object.keys(set.files).length} files, ${(bytes / 1000).toFixed(0)} KB`,
  );
}
console.log(`TOTAL ${(totalBytes / 1e6).toFixed(2)} MB`);
await browser.close();

/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { routePreload } from './vite-plugins/routePreload';

// The modules every screen needs, so they travel together in one chunk (see build.rolldownOptions below).
const SHELL =
  /src[\\/](api[\\/]|route[\\/]|theme[\\/]|auth[\\/](session|SignIn|SessionGate|returnTo)|components[\\/](ThemeSwitch|LanguageSwitch)|i18n[\\/]i18n\.ts|library[\\/]deferredDelete|persistence[\\/]saveQueue)/;

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    routePreload(),
    // `npm run build:report` (mode analyze): dist/stats.json lists every module of every chunk, with its
    // gzip size; `npm run size:report` prints the biggest modules of the initial chunk.
    ...(mode === 'analyze'
      ? [visualizer({ filename: 'dist/stats.json', template: 'raw-data', gzipSize: true })]
      : []),
  ],
  server: {
    // The API and the app share one origin in production: do the same in development, so that the
    // session cookie and the antiforgery header work unchanged (see docs/authentication.md).
    proxy: { '/api': { target: 'http://localhost:5080' } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Samples are always separate hashed files (a data URL would defeat the immutable cache and
    // the same-origin media policy); everything else keeps Vite's default 4 KB inlining.
    assetsInlineLimit: (file) => (file.endsWith('.ogg') ? false : undefined),
    rolldownOptions: {
      output: {
        // Few, predictable chunks for the first load (each request costs a round trip): React, and the small shell
        // that every screen shares (session, sign-in, API client, route, language switch). Screens are split by
        // dynamic import (src/route/chunks.ts).
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            { name: 'shell', test: SHELL, priority: 20 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}));

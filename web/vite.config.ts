/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});

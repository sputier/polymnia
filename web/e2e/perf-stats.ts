import { expect, test } from '@playwright/test';

/**
 * Shared by every `@perf` test (Playwright project `perf`, see playwright.config.ts and
 * docs/development.md): the same statistics, the same CI factor, the same report line.
 *
 * Rules: warm up first (discarded), take enough samples, assert the median against the strict
 * budget and the p95 against the budget times CI_FACTOR (shared runners are about twice as slow as
 * the reference laptop, 32 ms against 16 ms for a keystroke, see docs/engraving.md).
 */
export const CI_FACTOR = process.env.CI ? 2 : 1;

export interface Summary {
  n: number;
  median: number;
  p95: number;
  max: number;
}

export function summarize(samples: number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  expect(sorted.length, 'a measurement needs samples').toBeGreaterThan(0);
  return {
    n: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    max: sorted[sorted.length - 1]!,
  };
}

/**
 * Prints `label: n samples, median x ms, p95 y ms, max z ms`, records it as an annotation and
 * asserts: median under `medianMs` (strict, same everywhere), p95 under `p95Ms` (default: the
 * median budget times CI_FACTOR, so a single slow sample is tolerated but a slow tail is not).
 */
export function expectBudget(
  label: string,
  samples: number[],
  budget: { medianMs: number; p95Ms?: number },
): Summary {
  const s = summarize(samples);
  const p95Ms = budget.p95Ms ?? budget.medianMs * CI_FACTOR;
  const line =
    `PERF ${label}: ${s.n} samples, median ${s.median.toFixed(1)} ms (budget ${budget.medianMs}), ` +
    `p95 ${s.p95.toFixed(1)} ms (budget ${p95Ms}), max ${s.max.toFixed(1)} ms`;
  console.log(line);
  test.info().annotations.push({ type: 'perf', description: line });
  expect(s.median, `${label}: median`).toBeLessThan(budget.medianMs);
  expect(s.p95, `${label}: p95`).toBeLessThan(p95Ms);
  return s;
}

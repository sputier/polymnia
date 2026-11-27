import { ApiError } from '../api/client';
import { isNetworkError, SCORE_LIMIT_PROBLEM } from '../api/scores';
import type { MessageKey } from '../i18n/en';
import type { Language } from '../i18n/i18n';
import { getInstrument } from '../score';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "2 hours ago", "yesterday", in the interface language. */
export function relativeTime(iso: string, language: Language, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}

export function fullDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Catalog name of an instrument id, the id itself when it is not in the catalog. */
export function instrumentName(id: string, language: Language): string {
  return getInstrument(id)?.names[language] ?? id;
}

/** Message and, for a rate limit, the delay, for a failed library action. */
export function describeFailure(error: unknown): { key: MessageKey; seconds?: number } {
  if (isNetworkError(error)) return { key: 'library.errorOffline' };
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return { key: 'library.errorRateLimited', seconds: Math.ceil(error.retryAfter ?? 5) };
    }
    if (error.status === 409 && error.problemType === SCORE_LIMIT_PROBLEM) {
      return { key: 'library.errorLimit' };
    }
    if (error.status === 404) return { key: 'library.errorNotFound' };
    if (error.status === 413) return { key: 'library.errorTooLarge' };
  }
  return { key: 'library.errorGeneric' };
}

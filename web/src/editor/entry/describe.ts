/** Spoken descriptions of events and notices (live region, status bar). */
import type { MessageKey } from '../../i18n/en';
import {
  findEvent,
  findStaff,
  timeSignatureAt,
  voiceEventTicks,
  type Duration,
  type NotePitch,
  type Pitch,
  type Score,
} from '../../score';
import { beatOf } from './pitchInput';

type T = (key: MessageKey) => string;

const BASE_KEY = {
  whole: 'duration.whole',
  half: 'duration.half',
  quarter: 'duration.quarter',
  eighth: 'duration.eighth',
  '16th': 'duration.sixteenth',
  '32nd': 'duration.32nd',
} as const satisfies Record<Duration['base'], MessageKey>;

const ALTER_KEY: Record<number, MessageKey> = {
  [-2]: 'describe.doubleFlat',
  [-1]: 'describe.flat',
  1: 'describe.sharp',
  2: 'describe.doubleSharp',
};

/** "C5", "C sharp 5" (names follow the language: "do dièse 5"). */
export function describePitch(p: Pitch, t: T): string {
  const accidental = ALTER_KEY[p.alter];
  const step = t(`step.${p.step}`);
  return accidental ? `${step} ${t(accidental)} ${p.octave}` : `${step}${p.octave}`;
}

export function describeDuration(d: Duration, t: T): string {
  return t(BASE_KEY[d.base]).toLowerCase() + (d.dots ? ` ${t('describe.dotted')}` : '');
}

export function describePitches(pitches: readonly NotePitch[], t: T): string {
  return pitches.map((p) => describePitch(p, t)).join(', ');
}

/** Beat label of a position: whole beats as "2", otherwise "2.5". */
export function positionLabel(score: Score, measure: number, tick: number): string {
  return String(beatOf(timeSignatureAt(score, measure).beatType, tick));
}

/** "C5 quarter, measure 3 beat 2" (or "rest eighth, ..." / "C4, E4, G4 half, ..."). */
export function describeEvent(score: Score, eventId: string, t: T): string {
  const loc = findEvent(score, eventId);
  if (!loc) return '';
  const ticks = voiceEventTicks(loc.voice);
  let tick = 0;
  for (let i = 0; i < loc.index; i++) tick += ticks[i]!;
  const what =
    loc.event.kind === 'rest' ? t('describe.rest') : describePitches(loc.event.pitches, t);
  return (
    `${what} ${describeDuration(loc.event.duration, t)}, ` +
    `${t('describe.measure')} ${loc.measure + 1} ${t('describe.beat')} ${positionLabel(score, loc.measure, tick)}`
  );
}

export interface Notice {
  readonly key: MessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

export function formatNotice(notice: Notice, t: T): string {
  let text: string = t(notice.key);
  for (const [name, value] of Object.entries(notice.params ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

/** Events read out by "Describe the measure" before it summarises the rest ("and 5 more"). */
export const MEASURE_DESCRIPTION_LIMIT = 24;

/**
 * "Measure 3: C5 quarter, rest eighth, E5 half" for one measure of one staff and voice: the text alternative to
 * reading the engraved measure (docs/accessibility.md). Empty string when the staff or the measure does not exist.
 */
export function describeMeasure(
  score: Score,
  staffId: string,
  voice: number,
  measure: number,
  t: T,
): string {
  const at = findStaff(score, staffId);
  const cell = at && score.parts[at.partIndex]!.staves[at.staffIndex]!.measures[measure];
  if (!cell) return '';
  const word = t('describe.measure');
  const head = `${word.charAt(0).toUpperCase()}${word.slice(1)} ${measure + 1}`;
  const events = cell.voices[voice]?.events ?? [];
  if (events.length === 0) return `${head}: ${t('describe.empty')}`;
  const items = events.slice(0, MEASURE_DESCRIPTION_LIMIT).map((e) => {
    const what = e.kind === 'rest' ? t('describe.rest') : describePitches(e.pitches, t);
    return `${what} ${describeDuration(e.duration, t)}`;
  });
  const more = events.length - items.length;
  if (more > 0) items.push(t('describe.more').replace('{count}', String(more)));
  return `${head}: ${items.join(', ')}`;
}

export type PlaybackStatusName = 'playing' | 'paused' | 'stopped';

/** Spoken when playback starts, pauses or stops (never while it runs, never on the first render). */
export function describePlaybackChange(
  previous: PlaybackStatusName,
  next: PlaybackStatusName,
  t: T,
): string {
  if (previous === next) return '';
  return t(
    next === 'playing'
      ? 'playback.started'
      : next === 'paused'
        ? 'playback.paused'
        : 'playback.stopped',
  );
}

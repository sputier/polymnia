/** Spoken descriptions of events and notices (live region, status bar). */
import type { MessageKey } from '../../i18n/en';
import {
  findEvent,
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

import { pitchEquals } from './pitch';
import { durationTicks, timeSignatureTicks } from './ticks';
import type { Clef, Pitch, Score, ScoreEvent, Staff, TimeSignature, Voice } from './types';

/** A tie from `pitch` is valid when the next event of the voice is a note holding the same spelled pitch. */
export function canTie(pitch: Pitch, next: ScoreEvent | undefined): boolean {
  return next?.kind === 'note' && next.pitches.some((p) => pitchEquals(p, pitch));
}

/** Ticks of every event of a voice (tuplet scaling applied; may be fractional only in invalid scores). */
export function voiceEventTicks(voice: Voice): number[] {
  const ratio = new Map<string, number>();
  for (const t of voice.tuplets) for (const id of t.eventIds) ratio.set(id, t.normal / t.actual);
  return voice.events.map((e) => durationTicks(e.duration) * (ratio.get(e.id) ?? 1));
}

export function timeSignatureAt(score: Score, measure: number): TimeSignature {
  for (let i = Math.min(measure, score.measures.length - 1); i >= 0; i--) {
    const t = score.measures[i]?.time;
    if (t) return t;
  }
  return { beats: 4, beatType: 4 };
}

export function keyFifthsAt(score: Score, measure: number): number {
  for (let i = Math.min(measure, score.measures.length - 1); i >= 0; i--) {
    const k = score.measures[i]?.keyFifths;
    if (k !== undefined) return k;
  }
  return 0;
}

/** Tempo in force at a measure (last change at or before it, else the score tempo). */
export function tempoAt(score: Score, measure: number): number {
  for (let i = Math.min(measure, score.measures.length - 1); i >= 0; i--) {
    const t = score.measures[i]?.tempoBpm;
    if (t !== undefined) return t;
  }
  return score.meta.tempoBpm;
}

export function nominalMeasureLength(score: Score, measure: number): number {
  return timeSignatureTicks(timeSignatureAt(score, measure));
}

/** Actual length of a measure in ticks (explicit `length` for pickups, else the time signature). */
export function measureLength(score: Score, measure: number): number {
  return score.measures[measure]?.length ?? nominalMeasureLength(score, measure);
}

export function clefAt(staff: Staff, measure: number): Clef {
  for (let i = Math.min(measure, staff.measures.length - 1); i >= 1; i--) {
    const c = staff.measures[i]?.clef;
    if (c) return c;
  }
  return staff.clef;
}

export interface StaffLocation {
  readonly partIndex: number;
  readonly staffIndex: number;
}
export interface EventLocation extends StaffLocation {
  readonly measure: number;
  readonly voiceIndex: number;
  readonly index: number;
  readonly voice: Voice;
  readonly event: ScoreEvent;
}

export function findStaff(score: Score, staffId: string): StaffLocation | undefined {
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const staves = score.parts[partIndex]!.staves;
    for (let staffIndex = 0; staffIndex < staves.length; staffIndex++) {
      if (staves[staffIndex]!.id === staffId) return { partIndex, staffIndex };
    }
  }
  return undefined;
}

/** Linear scan by stable event id. */
export function findEvent(score: Score, eventId: string): EventLocation | undefined {
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const staves = score.parts[partIndex]!.staves;
    for (let staffIndex = 0; staffIndex < staves.length; staffIndex++) {
      const measures = staves[staffIndex]!.measures;
      for (let measure = 0; measure < measures.length; measure++) {
        const voices = measures[measure]!.voices;
        for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
          const voice = voices[voiceIndex]!;
          const index = voice.events.findIndex((e) => e.id === eventId);
          if (index >= 0) {
            return {
              partIndex,
              staffIndex,
              measure,
              voiceIndex,
              index,
              voice,
              event: voice.events[index]!,
            };
          }
        }
      }
    }
  }
  return undefined;
}

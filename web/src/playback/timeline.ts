/**
 * Score -> timed events. Pure (no audio, no DOM): everything playback needs from the model.
 *
 * Positions are score ticks (960 per quarter). Notes carry the sounding MIDI number (written pitch
 * plus the part transposition; a capo is already part of the written pitch, see docs/score-format.md).
 * Tied notes are merged into one sounding note, so a tie never re-attacks.
 */
import {
  TICKS_PER_QUARTER,
  measureLength,
  nominalMeasureLength,
  pitchToMidi,
  soundingMidi,
  tempoAt,
  timeSignatureAt,
  voiceEventTicks,
} from '../score';
import type { Score } from '../score';

export interface StaffInfo {
  readonly partId: string;
  readonly staffId: string;
  readonly partIndex: number;
  readonly staffIndex: number;
  readonly instrument: string;
}

/** One attack: a pitch with its start and end, ties merged. */
export interface SoundingNote {
  readonly staffId: string;
  readonly partId: string;
  readonly midi: number;
  readonly startTick: number;
  readonly endTick: number;
  /** Every score event this note covers (more than one when tied): they all light up while it sounds. */
  readonly eventIds: readonly string[];
}

/** Where an event sits in time (for the cursor and the highlight). Rests included. */
export interface EventSpan {
  readonly id: string;
  readonly staffId: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly rest: boolean;
}

export interface TempoSegment {
  readonly tick: number;
  readonly bpm: number;
}

export interface Beat {
  readonly tick: number;
  /** First beat of a measure. */
  readonly accent: boolean;
}

export interface Timeline {
  readonly staves: readonly StaffInfo[];
  /** Sorted by start tick. */
  readonly notes: readonly SoundingNote[];
  /** Sorted by start tick. */
  readonly spans: readonly EventSpan[];
  readonly measureStarts: readonly number[];
  readonly totalTicks: number;
  readonly tempo: readonly TempoSegment[];
  readonly beats: readonly Beat[];
}

/** Length of the metronome beat in ticks: the denominator, or a dotted beat in 6/8, 9/8, 12/8. */
export function beatTicks(beats: number, beatType: number): number {
  if (beatType === 8 && beats > 3 && beats % 3 === 0) return 3 * (TICKS_PER_QUARTER / 2);
  return (4 * TICKS_PER_QUARTER) / beatType;
}

interface OpenNote {
  staffId: string;
  partId: string;
  midi: number;
  startTick: number;
  endTick: number;
  eventIds: string[];
}

export function buildTimeline(score: Score): Timeline {
  const measureStarts: number[] = [];
  let total = 0;
  for (let m = 0; m < score.measures.length; m++) {
    measureStarts.push(total);
    total += measureLength(score, m);
  }

  const staves: StaffInfo[] = [];
  const building: OpenNote[] = [];
  const spans: EventSpan[] = [];

  score.parts.forEach((part, partIndex) => {
    const hasStandard = part.staves.some((s) => s.type === 'standard');
    part.staves.forEach((staff, staffIndex) => {
      // The tab staff of a "standard + tab" part repeats the standard staff: it is not played twice.
      if (staff.type === 'tab' && hasStandard) return;
      staves.push({
        partId: part.id,
        staffId: staff.id,
        partIndex,
        staffIndex,
        instrument: part.instrument,
      });
      const voiceCount = Math.max(0, ...staff.measures.map((sm) => sm.voices.length));
      for (let v = 0; v < voiceCount; v++) {
        // Pitches whose tie is still open, by written MIDI number (same spelling = same number).
        let open = new Map<number, OpenNote>();
        for (let m = 0; m < staff.measures.length; m++) {
          const voice = staff.measures[m]!.voices[v];
          if (!voice) {
            open = new Map();
            continue;
          }
          const ticks = voiceEventTicks(voice);
          let offset = 0;
          voice.events.forEach((event, i) => {
            const startTick = measureStarts[m]! + offset;
            const endTick = startTick + ticks[i]!;
            offset += ticks[i]!;
            spans.push({
              id: event.id,
              staffId: staff.id,
              startTick,
              endTick,
              rest: event.kind === 'rest',
            });
            if (event.kind === 'rest') {
              open = new Map();
              return;
            }
            const next = new Map<number, OpenNote>();
            for (const pitch of event.pitches) {
              const key = pitchToMidi(pitch);
              const tied = open.get(key);
              let note: OpenNote;
              if (tied) {
                tied.endTick = endTick;
                tied.eventIds.push(event.id);
                note = tied;
              } else {
                note = {
                  staffId: staff.id,
                  partId: part.id,
                  midi: soundingMidi(pitch, part.transposition),
                  startTick,
                  endTick,
                  eventIds: [event.id],
                };
                building.push(note);
              }
              if (pitch.tieToNext) next.set(key, note);
            }
            open = next;
          });
        }
      }
    });
  });

  const finalNotes: SoundingNote[] = building;

  finalNotes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
  spans.sort((a, b) => a.startTick - b.startTick);

  return {
    staves,
    notes: finalNotes,
    spans,
    measureStarts,
    totalTicks: total,
    tempo: tempoSegments(score),
    beats: beatList(score, measureStarts),
  };
}

function tempoSegments(score: Score): TempoSegment[] {
  const out: TempoSegment[] = [];
  let tick = 0;
  for (let m = 0; m < score.measures.length; m++) {
    const bpm = tempoAt(score, m);
    if (out.length === 0 || out[out.length - 1]!.bpm !== bpm) out.push({ tick, bpm });
    tick += measureLength(score, m);
  }
  if (out.length === 0) out.push({ tick: 0, bpm: score.meta.tempoBpm });
  return out;
}

function beatList(score: Score, measureStarts: readonly number[]): Beat[] {
  const out: Beat[] = [];
  for (let m = 0; m < score.measures.length; m++) {
    const { beats, beatType } = timeSignatureAt(score, m);
    const unit = beatTicks(beats, beatType);
    const nominal = nominalMeasureLength(score, m);
    const length = measureLength(score, m);
    // A pickup (first measure shorter than the time signature) starts partway through a bar.
    const offset = m === 0 ? nominal - length : 0;
    for (let v = Math.ceil(offset / unit) * unit; v - offset < length; v += unit) {
      out.push({ tick: measureStarts[m]! + v - offset, accent: v === 0 });
    }
  }
  return out;
}

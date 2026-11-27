/** Size limits, mirrored in schema/score.v1.schema.json (a test keeps both in sync). */
export const LIMITS = {
  maxParts: 32,
  maxStavesPerPart: 4,
  maxMeasures: 2000,
  maxVoicesPerMeasure: 4,
  maxEventsPerVoice: 512,
  maxPitchesPerChord: 12,
  maxTupletsPerVoice: 128,
  maxTupletEvents: 16,
  maxSlurs: 20000,
  maxTuning: 12,
  maxIdLength: 64,
  maxTitleLength: 200,
  maxNameLength: 100,
  maxInstrumentLength: 64,
  maxFret: 36,
  maxChordsPerMeasure: 32,
  maxQualityLength: 24,
  maxJsonLength: 16_000_000,
} as const;

export const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

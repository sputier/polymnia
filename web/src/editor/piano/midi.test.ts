import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScore, type Pitch } from '../../score';
import { EditorStore } from '../entry/editorStore';
import { CHORD_WINDOW_MS, createChordGrouper, createMidiParser, MidiInput } from './midi';

describe('createMidiParser', () => {
  it('reads note-on and note-off', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 100])).toEqual([{ type: 'on', channel: 0, note: 60, velocity: 100 }]);
    expect(parse([0x83, 64, 20])).toEqual([{ type: 'off', channel: 3, note: 64, velocity: 20 }]);
  });

  it('treats note-on with velocity 0 as note-off', () => {
    expect(createMidiParser()([0x90, 60, 0])).toEqual([
      { type: 'off', channel: 0, note: 60, velocity: 0 },
    ]);
  });

  it('keeps the running status, also across calls', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 90, 62, 90, 64, 0]).map((e) => [e.type, e.note])).toEqual([
      ['on', 60],
      ['on', 62],
      ['off', 64],
    ]);
    expect(parse([65, 80])).toEqual([{ type: 'on', channel: 0, note: 65, velocity: 80 }]);
  });

  it('ignores real-time bytes, control changes and stray data', () => {
    const parse = createMidiParser();
    expect(parse([62, 64])).toEqual([]); // no status yet
    expect(parse([0xf8])).toEqual([]);
    expect(parse([0xb0, 64, 127])).toEqual([]); // sustain pedal: ignored in V1
    expect(parse([0x90, 0xf8, 60, 100]).map((e) => e.note)).toEqual([60]);
    expect(parse([0xc0, 5])).toEqual([]); // program change has one data byte
    expect(parse([0x90, 61])).toEqual([]); // truncated
  });

  it('system exclusive cancels the running status', () => {
    const parse = createMidiParser();
    parse([0x90, 60, 100]);
    expect(parse([0xf0, 1, 2, 3, 0xf7])).toEqual([]);
    expect(parse([61, 100])).toEqual([]);
  });
});

describe('createChordGrouper', () => {
  it('groups notes pressed within the window of the first one', () => {
    const chord = createChordGrouper();
    expect(chord(1000)).toBe(false);
    expect(chord(1020)).toBe(true);
    expect(chord(1000 + CHORD_WINDOW_MS)).toBe(true);
    expect(chord(1000 + CHORD_WINDOW_MS + 1)).toBe(false); // a new note, a new window
    expect(chord(1000 + CHORD_WINDOW_MS + 30)).toBe(true);
  });

  it('measures from the first note: a slow roll is not one endless chord', () => {
    const chord = createChordGrouper();
    expect(chord(0)).toBe(false);
    expect(chord(40)).toBe(true);
    expect(chord(80)).toBe(false);
  });
});

// A minimal MIDIAccess.
class FakePort {
  type = 'input';
  state = 'connected';
  onmidimessage: ((e: { data: Uint8Array | null; timeStamp: number }) => void) | null = null;
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
  send(data: number[], timeStamp: number) {
    this.onmidimessage?.({ data: new Uint8Array(data), timeStamp });
  }
}
class FakeAccess {
  ports = new Map<string, FakePort>();
  onstatechange: ((e: unknown) => void) | null = null;
  inputs = { forEach: (cb: (p: FakePort) => void) => this.ports.forEach(cb) };
  plug(port: FakePort) {
    this.ports.set(port.id, port);
    this.onstatechange?.({ port });
  }
  unplug(id: string) {
    this.ports.delete(id);
    this.onstatechange?.({});
  }
}

function install(request: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: request, configurable: true });
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
});

describe('MidiInput', () => {
  it('is unsupported without Web MIDI and never asks for access by itself', () => {
    const midi = new MidiInput(() => {});
    expect(midi.getState().status).toBe('unsupported');
  });

  it('does not request access before connect()', async () => {
    const request = vi.fn(async () => new FakeAccess());
    install(request);
    const midi = new MidiInput(() => {});
    expect(request).not.toHaveBeenCalled();
    await midi.connect();
    expect(request).toHaveBeenCalledOnce();
    expect(midi.getState().status).toBe('ready');
  });

  it('reports a denied permission, then a failure', async () => {
    install(() => Promise.reject(new DOMException('no', 'SecurityError')));
    const midi = new MidiInput(() => {});
    await midi.connect();
    expect(midi.getState().status).toBe('denied');
    install(() => Promise.reject(new Error('boom')));
    await midi.connect();
    expect(midi.getState().status).toBe('error');
  });

  it('handles hot-plug and the device picker', async () => {
    const access = new FakeAccess();
    install(async () => access);
    const notes: [number, boolean][] = [];
    const midi = new MidiInput((n, c) => notes.push([n, c]));
    await midi.connect();
    expect(midi.getState().devices).toEqual([]);

    const a = new FakePort('a', 'Keys A');
    const b = new FakePort('b', 'Keys B');
    access.plug(a);
    access.plug(b);
    expect(midi.getState().devices.map((d) => d.name)).toEqual(['Keys A', 'Keys B']);
    a.send([0x90, 60, 100], 1000);
    b.send([0x90, 64, 100], 2000);
    expect(notes).toEqual([
      [60, false],
      [64, false],
    ]);

    midi.select('b');
    expect(a.onmidimessage).toBeNull();
    a.send([0x90, 62, 100], 3000); // not listened to
    expect(notes).toHaveLength(2);

    access.unplug('b'); // the chosen device disappears: back to all devices
    expect(midi.getState().selected).toBe('all');
    expect(a.onmidimessage).not.toBeNull();
    midi.disconnect();
    expect(a.onmidimessage).toBeNull();
  });
});

describe('MIDI keyboard into the editor store', () => {
  let access: FakeAccess;
  let port: FakePort;
  let store: EditorStore;

  async function setup(keyFifths = 0) {
    access = new FakeAccess();
    port = new FakePort('k', 'Keys');
    access.ports.set('k', port);
    install(async () => access);
    store = new EditorStore(createScore({ measures: 2, keyFifths }));
    const midi = new MidiInput((n, c) => store.enterMidi(n, c));
    await midi.connect();
    return midi;
  }

  const first = (s: EditorStore): Pitch[] => {
    const ev = s.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events;
    return ev.flatMap((e) => (e.kind === 'note' ? [e.pitches.map((p) => ({ ...p }))] : [])).flat();
  };

  beforeEach(() => vi.restoreAllMocks());

  it('enters notes at the current duration in note input and advances', async () => {
    await setup();
    store.toggleInputMode();
    const heard: Pitch[] = [];
    store.onNoteEntered = (p) => heard.push(p);
    port.send([0x90, 60, 90], 0);
    port.send([0x80, 60, 0], 100);
    port.send([0x90, 62, 90], 500);
    const ev = store.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events;
    expect(ev.filter((e) => e.kind === 'note')).toHaveLength(2);
    expect(first(store).map((p) => `${p.step}${p.octave}`)).toEqual(['C4', 'D4']);
    expect(heard).toHaveLength(2);
  });

  it('turns notes pressed together into a chord', async () => {
    await setup();
    store.toggleInputMode();
    port.send([0x90, 60, 90], 0);
    port.send([0x90, 64, 90], 12);
    port.send([0x90, 67, 90], 30);
    const ev = store.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events;
    expect(ev.filter((e) => e.kind === 'note')).toHaveLength(1);
    expect(first(store).map((p) => `${p.step}${p.octave}`)).toEqual(['C4', 'E4', 'G4']);
    // The next press, later, is a new chord.
    port.send([0x90, 72, 90], 400);
    const notes = () =>
      store
        .getState()
        .score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events.filter((e) => e.kind === 'note');
    expect(notes()).toHaveLength(2);
  });

  it('ignores velocity and the sustain pedal', async () => {
    await setup();
    store.toggleInputMode();
    port.send([0xb0, 64, 127], 0);
    port.send([0x90, 60, 1], 10);
    port.send([0x90, 62, 127], 500);
    expect(first(store)).toHaveLength(2);
  });

  it('spells black keys from the key signature', async () => {
    const spell = async (fifths: number, midi: number) => {
      await setup(fifths);
      store.toggleInputMode();
      port.send([0x90, midi, 90], 0);
      const p = first(store)[0]!;
      return `${p.step}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''}${p.octave}`;
    };
    expect(await spell(0, 61)).toBe('C#4');
    expect(await spell(2, 61)).toBe('C#4');
    expect(await spell(-1, 70)).toBe('Bb4');
    expect(await spell(-3, 63)).toBe('Eb4');
    expect(await spell(1, 66)).toBe('F#4');
    expect(await spell(-2, 61)).toBe('Db4');
  });

  it('does nothing in select mode without a selection but still plays the note', async () => {
    await setup();
    const heard: Pitch[] = [];
    store.onNoteEntered = (p) => heard.push(p);
    port.send([0x90, 60, 90], 0);
    expect(first(store)).toEqual([]);
    expect(heard).toHaveLength(1);
  });
});

/**
 * Web MIDI input (docs/editor.md). Pure parsing and chord grouping, plus `MidiInput`, a small
 * framework-free class that owns the `MIDIAccess`. Access is only requested by `connect()`, which
 * the UI calls from a click. Sustain pedal and velocity are ignored in V1: only note-on and
 * note-off matter, and a note-on with velocity 0 is a note-off.
 */

export interface MidiNoteEvent {
  readonly type: 'on' | 'off';
  /** 0 to 15. */
  readonly channel: number;
  /** MIDI note number, 0 to 127. */
  readonly note: number;
  readonly velocity: number;
}

/**
 * A parser for the bytes of one input port. It keeps the running status (a data byte with no status
 * byte repeats the previous channel message), ignores real-time bytes and other messages.
 */
export function createMidiParser(): (data: ArrayLike<number>) => MidiNoteEvent[] {
  let running = 0;
  return (raw) => {
    // Real-time bytes may be interleaved anywhere, even inside a message: drop them first.
    const data = Array.from(raw).filter((b) => b < 0xf8);
    const out: MidiNoteEvent[] = [];
    let i = 0;
    while (i < data.length) {
      let byte = data[i]!;
      if (byte >= 0xf0) {
        running = 0; // System common or exclusive: cancels the running status.
        i++;
        while (i < data.length && data[i]! < 0x80) i++;
        continue;
      }
      if (byte >= 0x80) {
        running = byte;
        i++;
      } else if (running) {
        byte = running;
      } else {
        i++; // Stray data byte with no status.
        continue;
      }
      const kind = byte & 0xf0;
      const size = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      if (i + size > data.length) break; // Truncated message.
      const d1 = data[i]!;
      const d2 = size === 2 ? data[i + 1]! : 0;
      i += size;
      if (d1 > 127 || d2 > 127) continue;
      if (kind === 0x90) {
        out.push({
          type: d2 === 0 ? 'off' : 'on',
          channel: byte & 0x0f,
          note: d1,
          velocity: d2,
        });
      } else if (kind === 0x80) {
        out.push({ type: 'off', channel: byte & 0x0f, note: d1, velocity: d2 });
      }
    }
    return out;
  };
}

/** Notes pressed within this many milliseconds of the first one form a chord. */
export const CHORD_WINDOW_MS = 50;

/**
 * Tells chords from melodies. The first note-on opens a window; note-ons inside it (measured from
 * the first one, not from the last) join the chord. No timer: it only needs the time stamps, so the
 * first note is entered at once and the next ones are added to it.
 */
export function createChordGrouper(windowMs = CHORD_WINDOW_MS): (timeMs: number) => boolean {
  let start = Number.NEGATIVE_INFINITY;
  return (timeMs) => {
    if (timeMs - start <= windowMs && timeMs >= start) return true;
    start = timeMs;
    return false;
  };
}

export type MidiStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported' | 'error';

export interface MidiDevice {
  readonly id: string;
  readonly name: string;
}

export interface MidiState {
  readonly status: MidiStatus;
  readonly devices: readonly MidiDevice[];
  /** `'all'` listens to every device. */
  readonly selected: string;
}

type Listener = () => void;

/** What the UI needs from `MIDIAccess` (and what tests mock). */
interface PortLike {
  readonly id: string;
  readonly name?: string | null;
  readonly type: string;
  readonly state: string;
  onmidimessage?: ((event: { data: Uint8Array | null; timeStamp: number }) => void) | null;
}
interface AccessLike {
  readonly inputs: { forEach(cb: (port: PortLike) => void): void };
  onstatechange: ((event: unknown) => void) | null;
}
type RequestMidi = (options?: { sysex?: boolean }) => Promise<AccessLike>;

export class MidiInput {
  private state: MidiState = { status: 'idle', devices: [], selected: 'all' };
  private access: AccessLike | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly parsers = new Map<string, ReturnType<typeof createMidiParser>>();
  private readonly isChord = createChordGrouper();
  private attached: PortLike[] = [];

  /** `onNote` gets every note-on; `chord` is true for notes pressed together with the first. */
  constructor(private readonly onNote: (midi: number, chord: boolean) => void) {
    if (!MidiInput.supported()) this.state = { ...this.state, status: 'unsupported' };
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): MidiState => this.state;

  private set(patch: Partial<MidiState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Asks for access. Call it from a user action only: browsers may show a permission prompt. */
  async connect(): Promise<void> {
    if (this.state.status === 'unsupported' || this.state.status === 'requesting') return;
    if (this.access) return;
    this.set({ status: 'requesting' });
    try {
      const request = navigator.requestMIDIAccess.bind(navigator) as unknown as RequestMidi;
      const access = await request({ sysex: false });
      this.access = access;
      access.onstatechange = () => this.refresh();
      this.refresh();
      this.set({ status: 'ready' });
    } catch (e) {
      const denied =
        e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError');
      this.set({ status: denied ? 'denied' : 'error' });
    }
  }

  /** Lets go of the ports (the UI calls it when it goes away). */
  disconnect(): void {
    this.detach();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.set({ status: MidiInput.supported() ? 'idle' : 'unsupported', devices: [] });
  }

  select(id: string): void {
    this.set({ selected: id });
    this.refresh();
  }

  private detach(): void {
    for (const port of this.attached) port.onmidimessage = null;
    this.attached = [];
  }

  /** Hot-plug: rebuilds the device list and rewires the ports. */
  private refresh(): void {
    if (!this.access) return;
    this.detach();
    const ports: PortLike[] = [];
    this.access.inputs.forEach((port) => {
      if (port.type === 'input' && port.state === 'connected') ports.push(port);
    });
    const devices = ports.map((p) => ({ id: p.id, name: p.name?.trim() || p.id }));
    let selected = this.state.selected;
    if (selected !== 'all' && !devices.some((d) => d.id === selected)) selected = 'all';
    for (const port of ports) {
      if (selected !== 'all' && port.id !== selected) continue;
      const parse = this.parsers.get(port.id) ?? createMidiParser();
      this.parsers.set(port.id, parse);
      port.onmidimessage = (event) => {
        if (!event.data) return;
        for (const note of parse(event.data)) {
          if (note.type === 'on') this.onNote(note.note, this.isChord(event.timeStamp));
        }
      };
      this.attached.push(port);
    }
    this.set({ devices, selected });
  }
}

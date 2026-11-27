// The autosave state machine of one open score. Framework free (the editor binds to it with
// useSyncExternalStore) so every rule below is unit-tested with fake timers.
//
// Rules:
// - Edits are debounced (`debounceMs` after the last edit) but never held longer than `maxWaitMs` since the
//   first unsaved edit, so a long typing session still saves.
// - One request at a time: a save never starts while another is in flight, so a score never has two
//   concurrent writes (they would race on the version and conflict with ourselves).
// - The content is read when the request starts, not when the edit happened: the latest state always wins
//   and edits made while a save is in flight are saved by the next one.
// - The edits stay in memory until a save succeeds. Nothing here ever drops them, whatever the error.
import { ApiError } from '../api/client';
import { isNetworkError } from '../api/scores';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'error' | 'unauthorized';

/** Why a save did not go through, for the message shown to the user. */
export type SaveProblem = 'too-large' | 'rejected' | 'server' | 'gone' | 'rate-limited';

export interface SaveSnapshot {
  readonly status: SaveStatus;
  readonly problem: SaveProblem | null;
}

export interface SaveBackend {
  /** Replaces the document, resolves with the new version. */
  saveContent(text: string, version: number): Promise<{ version: number }>;
  /** Renames only (no document sent), resolves with the new version. */
  rename(title: string, version: number): Promise<{ version: number }>;
  /** The version the server holds now (to overwrite after a conflict). */
  currentVersion(): Promise<number>;
}

export interface SaveQueueOptions {
  backend: SaveBackend;
  /** JSON text of the document as it is now, title included. */
  getContent: () => string;
  getTitle: () => string;
  /** The version of the document the editor was loaded from. */
  version: number;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Delays between retries after a network or server failure; the last one repeats. */
  backoffMs?: readonly number[];
  isOnline?: () => boolean;
}

const DEFAULT_BACKOFF = [2000, 4000, 8000, 16000, 30000] as const;
const MAX_RETRY_AFTER_MS = 120_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;

export class SaveQueue {
  private readonly backend: SaveBackend;
  private readonly getContent: () => string;
  private readonly getTitle: () => string;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly backoff: readonly number[];
  private readonly isOnline: () => boolean;

  private version: number;
  private dirtyContent = false;
  private dirtyTitle = false;
  private inFlight = false;
  private attempts = 0;
  private released = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: SaveSnapshot = { status: 'saved', problem: null };
  private readonly listeners = new Set<() => void>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(options: SaveQueueOptions) {
    this.backend = options.backend;
    this.getContent = options.getContent;
    this.getTitle = options.getTitle;
    this.version = options.version;
    this.debounceMs = options.debounceMs ?? 1000;
    this.maxWaitMs = options.maxWaitMs ?? 10_000;
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF;
    this.isOnline =
      options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine);
    pending.add(this);
  }

  // -------------------------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------------------------

  getSnapshot = (): SaveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** True while edits are not safely on the server (waiting, saving, failed or blocked). */
  get hasUnsavedWork(): boolean {
    return this.dirtyContent || this.dirtyTitle || this.inFlight;
  }

  /** The version of the document the server confirmed last. */
  get currentVersion(): number {
    return this.version;
  }

  /** Resolves when everything is saved, or after `timeoutMs` (never rejects). */
  whenIdle(timeoutMs = 5000): Promise<void> {
    if (!this.hasUnsavedWork) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.idleWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.idleWaiters.add(done);
    });
  }

  private set(status: SaveStatus, problem: SaveProblem | null = null): void {
    if (this.snapshot.status === status && this.snapshot.problem === problem) return;
    this.snapshot = { status, problem };
    this.listeners.forEach((l) => l());
  }

  private get blocked(): boolean {
    return this.snapshot.status === 'conflict' || this.snapshot.status === 'unauthorized';
  }

  // -------------------------------------------------------------------------------------------
  // Edits
  // -------------------------------------------------------------------------------------------

  /** The document changed. */
  touch(): void {
    this.dirtyContent = true;
    this.onEdit();
  }

  /** The title changed (saved with the document, or alone with a rename when the document is unchanged). */
  touchTitle(): void {
    this.dirtyTitle = true;
    this.onEdit();
  }

  private onEdit(): void {
    if (this.blocked) return; // The edit is kept; the user resolves the conflict or signs in first.
    // A rejected save is tried again as soon as the document changes (it may have got smaller).
    if (this.snapshot.status === 'error' && this.snapshot.problem !== 'server') this.set('saving');
    if (this.snapshot.status === 'saved') this.set('saving');
    if (this.retryTimer) return; // A retry is already scheduled and will send the latest content.
    if (this.inFlight) return; // The save in flight reschedules when it ends.
    this.armTimers();
  }

  private armTimers(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.run(), this.debounceMs);
    this.maxTimer ??= setTimeout(() => void this.run(), this.maxWaitMs);
  }

  private clearTimers(): void {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.maxTimer);
    this.debounceTimer = undefined;
    this.maxTimer = undefined;
  }

  private clearRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------

  /** Saves now (Ctrl+S, leaving the editor, tab hidden). */
  flush(): Promise<void> {
    this.clearRetry();
    return this.run();
  }

  /** The browser is back online: do not wait for the backoff. */
  retryNow(): void {
    if (this.blocked || !this.hasUnsavedWork) return;
    this.attempts = 0;
    this.clearRetry();
    void this.run();
  }

  /** After signing in again. */
  resumeAfterSignIn(): void {
    if (this.snapshot.status !== 'unauthorized') return;
    this.set('saving');
    this.attempts = 0;
    void this.run();
  }

  private async run(): Promise<void> {
    this.clearTimers();
    if (this.inFlight || this.blocked) return;
    if (!this.dirtyContent && !this.dirtyTitle) return;
    if (!this.isOnline()) {
      this.set('offline');
      this.scheduleRetry();
      return;
    }

    const sendContent = this.dirtyContent;
    this.dirtyContent = false;
    this.dirtyTitle = false;
    this.inFlight = true;
    this.set('saving');
    try {
      const result = sendContent
        ? await this.backend.saveContent(this.getContent(), this.version)
        : await this.backend.rename(this.getTitle(), this.version);
      this.version = result.version;
      this.attempts = 0;
      this.inFlight = false;
      if (this.dirtyContent || this.dirtyTitle) this.armTimers();
      else this.set('saved');
    } catch (error) {
      this.inFlight = false;
      // Whatever happened, the edits are still unsaved.
      if (sendContent) this.dirtyContent = true;
      else this.dirtyTitle = true;
      this.fail(error);
    }
    this.notifyIdle();
  }

  private fail(error: unknown): void {
    if (isNetworkError(error)) {
      this.set('offline');
      this.scheduleRetry();
      return;
    }
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 409) return this.set('conflict');
    if (status === 401) return this.set('unauthorized');
    if (status === 429) {
      const delay = Math.min(
        (error as ApiError).retryAfter
          ? (error as ApiError).retryAfter! * 1000
          : DEFAULT_RETRY_AFTER_MS,
        MAX_RETRY_AFTER_MS,
      );
      this.set('saving', 'rate-limited');
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        void this.run();
      }, delay);
      return;
    }
    if (status === 413) return this.set('error', 'too-large');
    if (status === 404) return this.set('error', 'gone');
    if (status >= 500) {
      this.set('error', 'server');
      this.scheduleRetry();
      return;
    }
    this.set('error', 'rejected');
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = this.backoff[Math.min(this.attempts, this.backoff.length - 1)] ?? 30_000;
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.run();
    }, delay);
  }

  // -------------------------------------------------------------------------------------------
  // Conflicts
  // -------------------------------------------------------------------------------------------

  /** "Keep mine": takes the server's current version and saves the local document over it. */
  async overwrite(): Promise<void> {
    if (this.snapshot.status !== 'conflict') return;
    this.version = await this.backend.currentVersion();
    this.dirtyContent = true;
    this.set('saving');
    await this.run();
  }

  /** "Reload": the editor replaced its document with the server's, at `version`; nothing is left to save. */
  adopt(version: number): void {
    this.clearTimers();
    this.clearRetry();
    this.version = version;
    this.dirtyContent = false;
    this.dirtyTitle = false;
    this.attempts = 0;
    this.set('saved');
    this.notifyIdle();
  }

  // -------------------------------------------------------------------------------------------
  // Lifetime
  // -------------------------------------------------------------------------------------------

  private notifyIdle(): void {
    if (this.hasUnsavedWork) return;
    this.idleWaiters.forEach((done) => done());
    if (this.released) this.dispose();
  }

  /**
   * The editor is closed. Unsaved edits are still sent (and retried): the queue only disappears once it
   * is idle, so leaving the editor never loses a save.
   */
  release(): void {
    this.released = true;
    if (!this.hasUnsavedWork) return this.dispose();
    if (!this.blocked) void this.flush();
  }

  private dispose(): void {
    this.clearTimers();
    this.clearRetry();
    pending.delete(this);
  }
}

/** Queues that may still hold unsaved edits (open or just closed). */
const pending = new Set<SaveQueue>();

/** True while any score has edits that are not on the server: the page asks before it unloads. */
export function hasPendingSaves(): boolean {
  for (const queue of pending) if (queue.hasUnsavedWork) return true;
  return false;
}

/** Test helper: forgets every queue (they belong to the test that made them). */
export function forgetAllSaves(): void {
  pending.clear();
}

/** Resolves once every queue is idle (or after `timeoutMs`): lists and editors read fresh data. */
export async function settleSaves(timeoutMs = 3000): Promise<void> {
  await Promise.all([...pending].map((q) => q.whenIdle(timeoutMs)));
}

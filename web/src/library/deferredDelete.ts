// Delete with undo, without a trash on the server.
//
// The API deletes for good (DELETE has no counterpart), so "undo" cannot restore a deleted score: it would come
// back as a new score with another id (its share links, if any, would be gone). Instead the deletion is deferred:
// the card disappears at once, the request is only sent when the undo window ends. Undo cancels it, so the score
// was never touched. The failure modes are safe: a closed tab sends the pending requests (`keepalive`), and if that
// is not possible the score is simply still there next time.
import { deleteScore } from '../api/scores';

export const UNDO_WINDOW_MS = 8000;

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  commit: (keepalive: boolean) => Promise<void>;
}

const pending = new Map<string, Pending>();

/**
 * Schedules the deletion of a score. `onDone` is called after the request, with the error when it failed (the
 * card must come back then).
 */
export function scheduleDelete(
  id: string,
  onDone: (error?: unknown) => void,
  delayMs = UNDO_WINDOW_MS,
): void {
  cancelDelete(id);
  const commit = async (keepalive: boolean) => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    try {
      await deleteScore(id, { keepalive });
      onDone();
    } catch (error) {
      onDone(error);
    }
  };
  pending.set(id, { timer: setTimeout(() => void commit(false), delayMs), commit });
}

/** Undo: nothing was sent. Returns false when the request is already on its way (too late). */
export function cancelDelete(id: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(id);
  return true;
}

export function hasPendingDeletes(): boolean {
  return pending.size > 0;
}

/** Sends every pending deletion now (the page is going away). */
export function flushDeletes(): void {
  for (const entry of [...pending.values()]) void entry.commit(true);
}

/** Test helper. */
export function forgetDeletes(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}

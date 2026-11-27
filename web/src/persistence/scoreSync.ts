// Remembers the score the server holds (the "base"), so a save can send only what changed since.
//
// The base is the exact score of the last successful save or load; it moves only when the server confirmed a
// save (`commit`), never when a request merely started. After anything that makes it uncertain (a conflict, a
// rejected patch) the queue asks for a full save, which sets a certain base again.
import { serialize, type Score } from '../score';
import { diffScores } from './scoreDiff';

/** One save, prepared from a snapshot of the editor's score. */
export interface SavePlan {
  /** The request body of an incremental save, or `null` when the whole document must be sent. */
  readonly patch: string | null;
  /** The editor's score equals the server's: nothing to send. */
  readonly nothingToSave: boolean;
  /** The whole document of the same snapshot (JSON text). */
  text(): string;
  /** The server accepted this snapshot: it is now the base. */
  commit(): void;
}

export class ScoreSync {
  private base: Score;

  constructor(base: Score) {
    this.base = base;
  }

  /** The server's document was replaced (loaded again): diffs start from it. */
  reset(base: Score): void {
    this.base = base;
  }

  /** A rename saved the title alone: the server's `meta.title` changed, nothing else. */
  renamed(title: string): void {
    this.base = { ...this.base, meta: { ...this.base.meta, title } };
  }

  /** Prepares a save of `current`. With `full`, or when the diff gives up, `patch` is `null`. */
  plan(current: Score, full: boolean): SavePlan {
    const diff = full ? null : diffScores(this.base, current);
    return {
      patch: diff && diff.ops.length > 0 ? diff.text : null,
      nothingToSave: diff !== null && diff.ops.length === 0,
      text: () => serialize(current),
      commit: () => {
        this.base = current;
      },
    };
  }
}

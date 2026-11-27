import type { Command } from './commands/core';
import type { Score } from './types';

interface Entry {
  readonly command: Command;
  readonly inverse: Command;
}

/**
 * Unlimited undo/redo. Each entry stores the command and its inverse (built from the score before
 * the edit, which structural sharing makes cheap). A command that throws leaves the history
 * untouched; a command that changes nothing is not recorded.
 */
export class History {
  private current: Score;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  constructor(initial: Score) {
    this.current = initial;
  }

  get score(): Score {
    return this.current;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  execute(command: Command): Score {
    const before = this.current;
    const after = command.apply(before);
    if (after === before) return before;
    this.undoStack.push({ command, inverse: command.invert(before) });
    this.redoStack = [];
    this.current = after;
    return after;
  }

  undo(): Score {
    const entry = this.undoStack.pop();
    if (!entry) return this.current;
    this.current = entry.inverse.apply(this.current);
    this.redoStack.push(entry);
    return this.current;
  }

  redo(): Score {
    const entry = this.redoStack.pop();
    if (!entry) return this.current;
    this.current = entry.command.apply(this.current);
    this.undoStack.push(entry);
    return this.current;
  }

  /** Starts over from `score` and forgets the history (e.g. after loading a file). */
  reset(score: Score): void {
    this.current = score;
    this.undoStack = [];
    this.redoStack = [];
  }
}

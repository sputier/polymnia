import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  forgetAllSaves,
  hasPendingSaves,
  SaveQueue,
  settleSaves,
  type SaveBackend,
} from './saveQueue';

function setup(overrides: Partial<ConstructorParameters<typeof SaveQueue>[0]> = {}) {
  let content = 'v1';
  let title = 'Title';
  const backend = {
    saveContent: vi.fn<SaveBackend['saveContent']>((_text, version) =>
      Promise.resolve({ version: version + 1 }),
    ),
    savePatch: vi.fn<NonNullable<SaveBackend['savePatch']>>((_patch, version) =>
      Promise.resolve({ version: version + 1 }),
    ),
    rename: vi.fn<SaveBackend['rename']>((_title, version) =>
      Promise.resolve({ version: version + 1 }),
    ),
    currentVersion: vi.fn<SaveBackend['currentVersion']>(() => Promise.resolve(9)),
  };
  const queue = new SaveQueue({
    backend,
    getContent: () => content,
    getTitle: () => title,
    version: 1,
    isOnline: () => true,
    ...overrides,
  });
  return {
    queue,
    backend,
    edit(text: string) {
      content = text;
      queue.touch();
    },
    setTitle(value: string) {
      title = value;
      queue.touchTitle();
    },
  };
}

const statuses = (queue: SaveQueue) => queue.getSnapshot().status;

beforeEach(() => {
  forgetAllSaves();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SaveQueue debounce', () => {
  it('saves once, one second after the last edit', async () => {
    const { queue, backend, edit } = setup();
    edit('a');
    await vi.advanceTimersByTimeAsync(600);
    edit('ab');
    await vi.advanceTimersByTimeAsync(600);
    expect(backend.saveContent).not.toHaveBeenCalled();
    expect(statuses(queue)).toBe('saving');

    await vi.advanceTimersByTimeAsync(500);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    expect(backend.saveContent).toHaveBeenCalledWith('ab', 1);
    expect(statuses(queue)).toBe('saved');
    expect(queue.currentVersion).toBe(2);
  });

  it('saves after the max wait even if edits never pause', async () => {
    const { backend, edit } = setup();
    for (let i = 0; i < 14; i++) {
      edit(`e${i}`);
      await vi.advanceTimersByTimeAsync(800);
    }
    expect(backend.saveContent).toHaveBeenCalled();
    expect(backend.saveContent.mock.calls[0]![0]).toBe('e12');
  });

  it('flush saves at once', async () => {
    const { queue, backend, edit } = setup();
    edit('now');
    await queue.flush();
    expect(backend.saveContent).toHaveBeenCalledWith('now', 1);
  });
});

describe('SaveQueue serialization', () => {
  it('never runs two saves at once and sends the latest content next', async () => {
    const { queue, backend, edit } = setup();
    let release!: (v: { version: number }) => void;
    backend.saveContent.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    edit('first');
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);

    edit('second');
    edit('third');
    await vi.advanceTimersByTimeAsync(5000);
    void queue.flush();
    expect(backend.saveContent).toHaveBeenCalledTimes(1); // still the first one

    release({ version: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.saveContent).toHaveBeenCalledTimes(2);
    expect(backend.saveContent).toHaveBeenLastCalledWith('third', 2);
    expect(statuses(queue)).toBe('saved');
  });
});

describe('SaveQueue rename', () => {
  it('renames alone when only the title changed', async () => {
    const { backend, setTitle, queue } = setup();
    setTitle('New');
    await queue.flush();
    expect(backend.rename).toHaveBeenCalledWith('New', 1);
    expect(backend.saveContent).not.toHaveBeenCalled();
  });

  it('sends the document (which carries the title) when both changed', async () => {
    const { backend, setTitle, edit, queue } = setup();
    setTitle('New');
    edit('x');
    await queue.flush();
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    expect(backend.rename).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.rename).not.toHaveBeenCalled();
  });
});

describe('SaveQueue failures', () => {
  it('goes offline on a network error, retries with backoff and recovers', async () => {
    const { queue, backend, edit } = setup({ backoffMs: [1000, 2000] });
    backend.saveContent
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    edit('a');
    await queue.flush();
    expect(statuses(queue)).toBe('offline');
    expect(queue.hasUnsavedWork).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.saveContent).toHaveBeenCalledTimes(2);
    expect(statuses(queue)).toBe('offline');

    await vi.advanceTimersByTimeAsync(1999);
    expect(backend.saveContent).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.saveContent).toHaveBeenCalledTimes(3);
    expect(statuses(queue)).toBe('saved');
  });

  it('does not send while the browser is offline, and retries at once when it is back', async () => {
    let online = false;
    const { queue, backend, edit } = setup({ isOnline: () => online });
    edit('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.saveContent).not.toHaveBeenCalled();
    expect(statuses(queue)).toBe('offline');

    online = true;
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    expect(statuses(queue)).toBe('saved');
  });

  it('keeps edits made while offline and sends the latest', async () => {
    const { queue, backend, edit } = setup({ backoffMs: [1000] });
    backend.saveContent.mockRejectedValueOnce(new TypeError('offline'));
    edit('a');
    await queue.flush();
    edit('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.saveContent).toHaveBeenLastCalledWith('b', 1);
  });

  it('waits for Retry-After on a 429', async () => {
    const { queue, backend, edit } = setup();
    backend.saveContent.mockRejectedValueOnce(new ApiError(429, { retryAfter: 7 }));
    edit('a');
    await queue.flush();
    expect(queue.getSnapshot()).toEqual({ status: 'saving', problem: 'rate-limited' });
    await vi.advanceTimersByTimeAsync(6900);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(backend.saveContent).toHaveBeenCalledTimes(2);
    expect(statuses(queue)).toBe('saved');
  });

  it('retries a server error with backoff', async () => {
    const { queue, backend, edit } = setup({ backoffMs: [500] });
    backend.saveContent.mockRejectedValueOnce(new ApiError(503));
    edit('a');
    await queue.flush();
    expect(queue.getSnapshot()).toEqual({ status: 'error', problem: 'server' });
    await vi.advanceTimersByTimeAsync(500);
    expect(statuses(queue)).toBe('saved');
  });

  it('reports a body that is too large and retries only after the next edit', async () => {
    const { queue, backend, edit } = setup();
    backend.saveContent.mockRejectedValueOnce(new ApiError(413));
    edit('huge');
    await queue.flush();
    expect(queue.getSnapshot()).toEqual({ status: 'error', problem: 'too-large' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);

    edit('small');
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.saveContent).toHaveBeenCalledTimes(2);
    expect(statuses(queue)).toBe('saved');
  });

  it('stops on a 401 and resumes after signing in again', async () => {
    const { queue, backend, edit } = setup();
    backend.saveContent.mockRejectedValueOnce(new ApiError(401));
    edit('a');
    await queue.flush();
    expect(statuses(queue)).toBe('unauthorized');
    edit('b');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);

    queue.resumeAfterSignIn();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.saveContent).toHaveBeenLastCalledWith('b', 1);
    expect(statuses(queue)).toBe('saved');
  });
});

describe('SaveQueue conflicts', () => {
  async function conflicted() {
    const ctx = setup();
    ctx.backend.saveContent.mockRejectedValueOnce(new ApiError(409));
    ctx.edit('mine');
    await ctx.queue.flush();
    return ctx;
  }

  it('stops at a 409 and keeps the edits', async () => {
    const { queue, backend, edit } = await conflicted();
    expect(statuses(queue)).toBe('conflict');
    expect(queue.hasUnsavedWork).toBe(true);
    edit('more');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
  });

  it('"keep mine" takes the server version and overwrites with the latest content', async () => {
    const { queue, backend, edit } = await conflicted();
    edit('mine+');
    await queue.overwrite();
    expect(backend.currentVersion).toHaveBeenCalled();
    expect(backend.saveContent).toHaveBeenLastCalledWith('mine+', 9);
    expect(statuses(queue)).toBe('saved');
    expect(queue.currentVersion).toBe(10);
  });

  it('"reload" adopts the server version and drops the pending save', async () => {
    const { queue, backend } = await conflicted();
    queue.adopt(5);
    expect(statuses(queue)).toBe('saved');
    expect(queue.hasUnsavedWork).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    expect(queue.currentVersion).toBe(5);
  });
});

describe('pending saves', () => {
  it('reports unsaved work until it is saved, and keeps a released queue alive until then', async () => {
    const { queue, backend, edit } = setup();
    edit('a');
    expect(hasPendingSaves()).toBe(true);
    queue.release(); // the editor is closed: the save still goes out
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.saveContent).toHaveBeenCalledTimes(1);
    await settleSaves();
    expect(hasPendingSaves()).toBe(false);
  });

  it('settleSaves gives up after its timeout', async () => {
    const { queue, backend, edit } = setup();
    backend.saveContent.mockImplementation(() => new Promise(() => {}));
    edit('a');
    void queue.flush();
    let done = false;
    void settleSaves(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1001);
    expect(done).toBe(true);
    queue.adopt(1);
  });
});

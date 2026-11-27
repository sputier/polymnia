import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { forgetAllSaves, SaveQueue, type SaveBackend } from './saveQueue';
import type { SavePlan } from './scoreSync';

interface FakePlan extends SavePlan {
  commit: ReturnType<typeof vi.fn<() => void>>;
}

/** A plan source: each call makes a plan for the document as it is then. */
function planned(patch: string | null = '{"ops":[1]}', nothingToSave = false) {
  const plans: FakePlan[] = [];
  const plan = vi.fn<(full: boolean) => SavePlan>((full) => {
    const made: FakePlan = {
      patch: full ? null : patch,
      nothingToSave: full ? false : nothingToSave,
      text: () => `full#${plans.length - 1}`,
      commit: vi.fn<() => void>(),
    };
    plans.push(made);
    return made;
  });
  return { plan, plans };
}

function setup(
  plan: (full: boolean) => SavePlan,
  overrides: Partial<ConstructorParameters<typeof SaveQueue>[0]> = {},
) {
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
    getContent: () => 'whole document',
    getTitle: () => title,
    plan,
    version: 1,
    isOnline: () => true,
    ...overrides,
  });
  return {
    queue,
    backend,
    edit: () => queue.touch(),
    setTitle(value: string) {
      title = value;
      queue.touchTitle();
    },
  };
}

const status = (queue: SaveQueue) => queue.getSnapshot().status;

beforeEach(() => {
  forgetAllSaves();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SaveQueue incremental saves', () => {
  it('sends the patch, not the document, and moves the base on success', async () => {
    const { plan, plans } = planned();
    const { queue, backend, edit } = setup(plan);
    edit();
    await queue.flush();

    expect(plan).toHaveBeenCalledWith(false);
    expect(backend.savePatch).toHaveBeenCalledWith('{"ops":[1]}', 1);
    expect(backend.saveContent).not.toHaveBeenCalled();
    expect(plans[0]!.commit).toHaveBeenCalledTimes(1);
    expect(queue.currentVersion).toBe(2);
    expect(status(queue)).toBe('saved');
  });

  it('sends nothing when the document equals the server copy', async () => {
    const { plan, plans } = planned(null, true);
    const { queue, backend, edit } = setup(plan);
    edit();
    await queue.flush();

    expect(backend.savePatch).not.toHaveBeenCalled();
    expect(backend.saveContent).not.toHaveBeenCalled();
    expect(plans[0]!.commit).not.toHaveBeenCalled();
    expect(status(queue)).toBe('saved');
    expect(queue.currentVersion).toBe(1);
  });

  it('sends the whole document when the plan has no patch', async () => {
    const { plan, plans } = planned(null);
    const { queue, backend, edit } = setup(plan);
    edit();
    await queue.flush();

    expect(backend.savePatch).not.toHaveBeenCalled();
    expect(backend.saveContent).toHaveBeenCalledWith('full#0', 1);
    expect(plans[0]!.commit).toHaveBeenCalledTimes(1);
  });

  it.each([400, 413])(
    'falls back to the whole document when the server answers %i',
    async (code) => {
      const { plan, plans } = planned();
      const { queue, backend, edit } = setup(plan);
      backend.savePatch.mockRejectedValueOnce(new ApiError(code));
      edit();
      await queue.flush();

      expect(backend.savePatch).toHaveBeenCalledTimes(1);
      // The same snapshot, at the same version.
      expect(plan).toHaveBeenCalledTimes(1);
      expect(backend.saveContent).toHaveBeenCalledWith('full#0', 1);
      expect(plans[0]!.commit).toHaveBeenCalledTimes(1);
      expect(status(queue)).toBe('saved');
      expect(queue.currentVersion).toBe(2);
    },
  );

  it('reports a score too large when the whole document is refused too', async () => {
    const { plan, plans } = planned();
    const { queue, backend, edit } = setup(plan);
    backend.savePatch.mockRejectedValueOnce(new ApiError(413));
    backend.saveContent.mockRejectedValueOnce(new ApiError(413));
    edit();
    await queue.flush();

    expect(status(queue)).toBe('error');
    expect(queue.getSnapshot().problem).toBe('too-large');
    expect(plans[0]!.commit).not.toHaveBeenCalled();
    expect(queue.hasUnsavedWork).toBe(true);
  });

  it('keeps the edits and the base when the connection drops, and retries from the same base', async () => {
    const { plan, plans } = planned();
    const { queue, backend, edit } = setup(plan, { backoffMs: [1000] });
    backend.savePatch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    edit();
    await queue.flush();

    expect(status(queue)).toBe('offline');
    expect(plans[0]!.commit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.savePatch).toHaveBeenCalledTimes(2);
    expect(plans).toHaveLength(2); // planned again, from the document as it is now
    expect(plans[1]!.commit).toHaveBeenCalledTimes(1);
    expect(status(queue)).toBe('saved');
  });

  it('a server error keeps the edits and the base too', async () => {
    const { plan, plans } = planned();
    const { queue, backend, edit } = setup(plan, { backoffMs: [1000] });
    backend.savePatch.mockRejectedValueOnce(new ApiError(503));
    edit();
    await queue.flush();

    expect(status(queue)).toBe('error');
    expect(plans[0]!.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(queue)).toBe('saved');
  });

  it('a conflict stops the saves; "keep mine" sends the whole document, then patches resume', async () => {
    const { plan, plans } = planned();
    const { queue, backend, edit } = setup(plan);
    backend.savePatch.mockRejectedValueOnce(new ApiError(409));
    edit();
    await queue.flush();
    expect(status(queue)).toBe('conflict');
    expect(plans[0]!.commit).not.toHaveBeenCalled();

    await queue.overwrite();
    expect(plan).toHaveBeenLastCalledWith(true);
    expect(backend.saveContent).toHaveBeenCalledWith('full#1', 9);
    expect(plans[1]!.commit).toHaveBeenCalledTimes(1);
    expect(status(queue)).toBe('saved');

    edit();
    await queue.flush();
    expect(plan).toHaveBeenLastCalledWith(false);
    expect(backend.savePatch).toHaveBeenLastCalledWith('{"ops":[1]}', 10);
  });

  it('loading the server version after a conflict goes back to patches at once', async () => {
    const { plan } = planned();
    const { queue, backend, edit } = setup(plan);
    backend.savePatch.mockRejectedValueOnce(new ApiError(409));
    edit();
    await queue.flush();
    expect(status(queue)).toBe('conflict');

    queue.adopt(5);
    edit();
    await queue.flush();
    expect(plan).toHaveBeenLastCalledWith(false);
    expect(backend.savePatch).toHaveBeenLastCalledWith('{"ops":[1]}', 5);
    expect(backend.saveContent).not.toHaveBeenCalled();
  });

  it('a rename alone never goes through the plan', async () => {
    const { plan } = planned();
    const { queue, backend, setTitle } = setup(plan);
    setTitle('New');
    await queue.flush();

    expect(backend.rename).toHaveBeenCalledWith('New', 1);
    expect(plan).not.toHaveBeenCalled();
  });

  it('works with a backend that cannot patch: the whole document is sent', async () => {
    const { plan } = planned();
    const { backend } = setup(plan);
    const withoutPatch = { ...backend, savePatch: undefined };
    const plain = new SaveQueue({
      backend: withoutPatch,
      getContent: () => 'whole document',
      getTitle: () => 'Title',
      plan,
      version: 1,
      isOnline: () => true,
    });
    plain.touch();
    await plain.flush();

    expect(backend.saveContent).toHaveBeenCalledWith('full#0', 1);
    expect(backend.savePatch).not.toHaveBeenCalled();
  });
});
